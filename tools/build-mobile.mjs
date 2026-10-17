import {resolveBuildFeatures} from '../source/build-features.mjs';
import {capturePreviousOutputs,retireStaleOutputs} from './feature-output.mjs';
import {selectPhoneArt,phoneSourceFeatures,phoneHtmlFeatures,mobileSelector} from './mobile-feature-source.mjs';
import {exclusionOptions} from './supervised-build-options.mjs';
// Compose the phone site from readable source and reviewed, pinned art derivatives.
//   node tools/build-mobile.mjs [--out DIR] (default publish/mobile)
// Node only: ordinary builds never launch a browser, fetch remote content or rewrite source assets.
import { createHash } from 'node:crypto';

import { resolve, join, basename, extname } from 'node:path';

import { parseArgs } from 'node:util';

import assert from 'node:assert/strict';

import { realpath, readFile } from 'node:fs/promises';

import { readContent } from '../source/mobile/content.mjs';

import { artDocs, artMeta } from '../source/mobile/art.mjs';

import { renderPage, positionsCss, modeLock } from '../source/mobile/page.mjs';

import { loadNight, darkCss } from '../source/mobile/night.mjs';

import { loadMobileSources, PHOTO_INPUTS } from './mobile-source-inputs.mjs';
import {grainRows, verifyGrainTileBytes, grainMedia, grainRecipeSha256} from './grain-inputs.mjs';

import { forceColourScheme, fixedPictureArt, MOBILE_SELECT } from './mobile-theme.mjs';

import { svgFromSymbol } from './build-mobile-inputs.mjs';

import { ensureOutputDirectory, writeOutput } from './build-output.mjs';

import { createBuildOrigin, withDeadline } from './mobile-origin.mjs';

import { isBuildMain, runBuildCommand } from './build-cli.mjs';

import { encodeFor } from './mobile-art-encoding.mjs';

const root = await realpath(resolve(import.meta.dirname, '..'));

const M = resolve(root, 'source/mobile');

const MASTERS = resolve(M, 'art/masters'), ENCODED = resolve(M, 'art/encoded');

const sha = b => createHash('sha256').update(b).digest('hex');

// encoder settings per art piece (chosen from rendered comparisons; see tools/BUILD.md "Mobile build"). The sky is the 12-frame
// wingbeat strip: AVIF q40 is indistinguishable from q62 on moving birds and keeps the first screen <= 150 KB.
export { ENCODE, encodeFor } from './mobile-art-encoding.mjs';

export const PHOTOS = PHOTO_INPUTS;

 // pinned author-photo inputs; source URLs are data keys, never fetched
async function encodedArt(name, master, q, encodedManifest, readInput) {
  const key = master.row.sha256.slice(0, 12) + '-' + q.avif + '-' + q.webp, out = {};
  const meta = master.dimensions;
  for (const dpr of [ 2, 3 ]) {
    for (const fmt of [ 'avif', 'webp' ]) {
      const file = join(ENCODED, `${name}@${dpr}x.${key}.${fmt}`);
      const rec = encodedManifest.files[basename(file)], encoded = await readInput(file);
      assert(rec && encoded.length === rec.bytes && sha(encoded) === rec.sha256, 'Encoded source asset changed: ' + basename(file));
      out[`${dpr}x.${fmt}`] = file;
    }
    out[`${dpr}x.px`] = dpr === 3 ? [ meta.width, meta.height ] : [ Math.round(meta.width * 2 / 3), Math.round(meta.height * 2 / 3) ];
  }
  return out;
}

async function encodedPhoto(p, encodedManifest, readInput) {
  const key = p.sha256.slice(0, 12), out = {
    widths: {}
  };
  const meta = p.dimensions;
  out.ratio = meta.height / meta.width;
  for (const w of p.widths) for (const fmt of [ 'avif', 'webp' ]) {
    const file = join(ENCODED, `${p.name}-${w}.${key}.${fmt}`);
    const rec = encodedManifest.files[basename(file)], encoded = await readInput(file);
    assert(rec && encoded.length === rec.bytes && sha(encoded) === rec.sha256, 'Encoded photo source changed: ' + basename(file));
    (out.widths[w] ||= {})[fmt] = file;
  }
  return out;
}

export async function buildMobile({out: out, sourceRoot: sourceRoot, writer: writer = writeOutput, exclude} = {}) {
  const features=resolveBuildFeatures(exclude);
  assert(features.phone,'A direct phone build cannot exclude phone');
  sourceRoot = await realpath(resolve(sourceRoot || root));
  const origin = await createBuildOrigin({
    root: root,
    sourceRoot: sourceRoot || root
  }), readInput = origin.read;
  await origin.captureComposers();
  const inputs = await loadMobileSources({
    root: root,
    sourceRoot: sourceRoot,
    readInput: readInput,
    inspectInput: origin.inspect,
    releaseInput: origin.release
  });
  const content = readContent(inputs.markup, {
    scriptSource: inputs.scriptSource
  });
  const grainProvenance = JSON.parse((await readInput(join(root, 'source/assets/grain/grain-provenance.json'))).toString('utf8'));
  const nightGrainRows = grainProvenance.night ? grainRows(grainProvenance.night, {flavor: 'night', expectedRecipeSha256: grainRecipeSha256(inputs.upstreamCss, 'night')}) : null;
  const nightSet = await loadNight(root, {
    siteCss: inputs.artCss,
    nightTile: Boolean(nightGrainRows)
  });
  const docs = selectPhoneArt(artDocs(inputs.artSource, content.counts.groups, nightSet),features), meta = artMeta(content.counts.groups);
  const index = JSON.parse((await readInput(join(MASTERS, 'masters.json'))).toString('utf8'));
  const encodedManifest = JSON.parse((await readInput(join(ENCODED, 'manifest.json'))).toString('utf8'));
  assert(encodedManifest.schema === 1 && encodedManifest.files, 'Expected the reviewed encoded source index');
  out = resolve(out || resolve(root, 'publish/mobile'));
  assert(out !== root && ![ 'source', 'tools', '.git', '.audit' ].some(dir => out === resolve(root, dir) || out.startsWith(resolve(root, dir) + '/')), 'Mobile output must not overwrite source or tools');
  assert(!resolve(out).startsWith(resolve(root, 'site') + '/') && resolve(out) !== resolve(root, 'site'), 'build-mobile never writes into site/ (publishing is a separate, verified step)');
  out = await withDeadline('validate phone output', () => ensureOutputDirectory(out, {
    root: root,
    protectedPaths: [ 'source', 'tools', '.git', '.audit', 'site' ].map(dir => resolve(root, dir))
  }));
  let previousManifest;
  try {previousManifest=JSON.parse((await readFile(join(out,'manifest.json'))).toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const previous=await capturePreviousOutputs(out,previousManifest,{phone:true});
  await withDeadline('create phone asset output', () => ensureOutputDirectory(join(out, 'assets')));
  const assets = new Map;
 // logical name -> public path
    const files = [];
  const emit = async (logical, buf, ext) => {
    const name = logical.replace(/[^a-z0-9@.-]/gi, '-') + '.' + sha(buf).slice(0, 16) + ext;
    await withDeadline('write phone asset ' + name, () => writer(out, 'assets/' + name, buf));
    assets.set(logical, 'assets/' + name);
    files.push({
      path: 'assets/' + name,
      bytes: buf.length,
      sha256: sha(buf)
    });
    return 'assets/' + name;
  };
  const grainNames = { day: {}, night: {} };
  const grainOrder = { day: [], night: [] };
  // The grain recipe is the site stylesheet that carries --grain-fine (exactly as render-grain.py reads
  // it); inputs.artCss is the cut-paper paper reference and carries no recipe.
  for (const [ flavor, rows ] of [ [ 'day', grainRows(grainProvenance, {flavor: 'day', expectedRecipeSha256: grainRecipeSha256(inputs.upstreamCss, 'day')}) ], [ 'night', features.night ? nightGrainRows : null ] ]) {
    if (!rows) continue;
    for (const row of rows) {
      const bytes = await readInput(join(root, 'source/assets/grain', row.file));
      verifyGrainTileBytes(row, bytes);
      grainNames[flavor][row.density] = (await emit('grain-' + flavor + '@' + row.density + 'x', bytes, '.webp')).replace('assets/', '');
      grainOrder[flavor].push(row.density);
    }
  }
  const art = {}, artOrigin = [], photoOrigin = [];
  for (const d of docs) {
    const rec = index[d.name];
    assert(rec, `No baked master for "${d.name}": rebake the source mobile art for ${d.name}`);
    assert.equal(rec.doc, sha(d.html), `The art source for "${d.name}" changed; regenerate its reviewed source assets before building`);
    const masterPath = 'source/mobile/art/masters/' + d.name + '@3x.png', master = await origin.inspect(join(root, masterPath), 'png');
    assert.equal(master.row.sha256, rec.png, 'master PNG does not match masters.json: ' + d.name);
    const dims = master.dimensions;
    assert.equal(rec.w, d.w, 'master document width changed');
    assert.equal(rec.h, d.h, 'master document height changed');
    assert.equal(dims.width, d.w * 3, 'master pixel width changed');
    assert.equal(dims.height, d.h * 3, 'master pixel height changed');
    const recipe = {
      name: d.name,
      documentSha256: sha(d.html),
      width: d.w,
      height: d.h,
      mask: !!d.mask,
      master: {
        path: masterPath,
        sha256: rec.png,
        bytes: master.row.bytes,
        width: dims.width,
        height: dims.height
      },
      encodings: []
    };
    artOrigin.push(recipe);
    if (d.mask) continue;
 // checked fresh like the art, never shipped (the crown mask verify-mobile reads)
        const q = encodeFor(d.name), enc = await encodedArt(d.name, master, q, encodedManifest, readInput);
    art[d.name] = {
      w: d.w,
      h: d.h,
      px2: enc['2x.px'],
      px3: enc['3x.px']
    };
    for (const k of [ '2x.avif', '2x.webp', '3x.avif', '3x.webp' ]) {
      const [d2, fmt] = k.split('.'), bytes = await readInput(enc[k]);
      art[d.name][k] = await emit(`${d.name}@${d2}`, bytes, '.' + fmt);
      recipe.encodings.push({
        sourcePath: 'source/mobile/art/encoded/' + basename(enc[k]),
        publishedPath: art[d.name][k],
        format: fmt,
        dpr: Number(d2[0]),
        bytes: bytes.length,
        sha256: sha(bytes),
        width: enc[d2 + '.px'][0],
        height: enc[d2 + '.px'][1],
        settings: fmt === 'avif' ? {
          quality: q.avif,
          effort: 7,
          chromaSubsampling: '4:2:0'
        } : {
          quality: q.webp,
          alphaQuality: 90,
          effort: 6,
          smartSubsample: true
        },
        resize: d2 === '2x' ? 'lanczos3' : 'original'
      });
      origin.release(enc[k]);
    }
  }
  const photos = {};
  for (const p of inputs.photos) {
    const e = await encodedPhoto(p, encodedManifest, readInput);
    photos[p.url] = {
      ratio: e.ratio,
      widths: {}
    };
    const recipe = {
      name: p.name,
      sourcePath: p.src,
      sourceSha256: p.sha256,
      sourceBytes: p.inputBytes,
      encodings: []
    };
    photoOrigin.push(recipe);
    for (const [w, f] of Object.entries(e.widths)) {
      photos[p.url].widths[w] = {};
      for (const fmt of [ 'avif', 'webp' ]) {
        const bytes = await readInput(f[fmt]), publishedPath = await emit(`${p.name}-${w}`, bytes, '.' + fmt);
        photos[p.url].widths[w][fmt] = publishedPath;
        recipe.encodings.push({
          sourcePath: 'source/mobile/art/encoded/' + basename(f[fmt]),
          publishedPath: publishedPath,
          format: fmt,
          width: Number(w),
          bytes: bytes.length,
          sha256: sha(bytes),
          settings: fmt === 'avif' ? {
            quality: 52,
            effort: 7
          } : {
            quality: 78,
            effort: 6
          }
        });
        origin.release(f[fmt]);
      }
    }
  }
  for (const license of inputs.licenses) await emit(license.name, license.bytes, '.txt');
  const fonts = {};
  for (const f of inputs.fonts) fonts[f.logical] = await emit(basename(f.logical, '.woff2'), f.bytes, '.woff2');
  const logo = await emit('logo', Buffer.from(svgFromSymbol(content.page.logo, '#000')), '.svg');
 // a mask: the page paints it in his logo colour, or cream
    const mark = await emit('mark', Buffer.from(svgFromSymbol(content.page.mark, '#000')), '.svg');
  const icons = [];
  for (const icon of inputs.icons) icons.push({
    rel: icon.rel,
    type: icon.type,
    sizes: icon.sizes,
    href: await emit(icon.name, icon.bytes, extname(icon.path))
  });
  // CSS: mobile.css + generated positions + the night layer, with @art/@font/@svg references resolved
    const viewBox = /viewBox="([^\"]+)"/.exec(content.page.logo)?.[1]?.split(/\s+/).map(Number);
  assert(viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0, 'Final logo needs a finite positive viewBox');
  let css = (await readInput(join(M, 'mobile.css'))).toString('utf8') + `\n:root { --tulip: ${meta.tulip}; --logo-ratio: ${viewBox[2]} / ${viewBox[3]}; --logo: ${inputs.logoColour}; }\n` + positionsCss(meta) + (features.night?darkCss(nightSet):'');
  if(!features.night)css=forceColourScheme(css,'light');
  css = css.replace(/@art\(([\w-]+)\)/g, (_, n) => {
    const a = art[n];
    assert(a, 'unknown art ' + n);
    return imageSet(a);
  }).replace(/@font\(([^)]+)\)/g, (_, f) => {
    assert(fonts[f], 'unknown font ' + f);
    return 'url(' + fonts[f].replace('assets/', '') + ')';
  }).replace(/@svg\((logo|mark)\)/g, (_, k) => 'url(' + (k === 'logo' ? logo : mark).replace('assets/', '') + ')')
    .replace(/@grain-(day|night)-([\d.]+)x/g, (_, flavor, density) => {
      const name = grainNames[flavor][density];
      assert(name, 'unknown grain tile ' + flavor + '@' + density + 'x');
      return name;
    });
  assert(!/@(art|font|svg)\(/.test(css), 'unresolved asset reference in mobile.css');
  assert(!/@grain-(day|night)-[\d.]+x/.test(css), 'unresolved grain tile reference in mobile.css');
  let state = (await readInput(join(M, 'state.mjs'))).toString('utf8').replace(/^export /gm, '');
  let app = (await readInput(join(M, 'app.js'))).toString('utf8');
  ({state,app,css}=phoneSourceFeatures({state,app,css},features));
  // the shared live-photo controller ships in the same bundle, ahead of the page script (source/js/live-photos.js)
  const shared = (await readInput(join(root, 'source/js/live-photos.js'))).toString('utf8');
  const jsPath = await emit('mobile', Buffer.from(`(()=>{'use strict';\n${shared}\n${state}\n${app}\n})();\n`), '.js');
  // the two Latin faces every first screen uses (headline: Young Serif, text: Instrument Sans) arrive with the stylesheet, not after it
    const preload = [ '3qTpojO2nS2VtkB3KtkQZ1t93kY.woff2', 'pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2' ].map(f => fonts[f]);
  const grainPreloadsFor = theme => {
    const flavor = theme === 'dark' ? 'night' : 'day';
    return grainOrder[flavor].map((density, i) => ({ href: 'assets/' + grainNames[flavor][density], media: grainMedia(i) }));
  };
  for (const theme of features.night?[ 'light', 'dark' ]:['light']) {
    const cssPath = await emit('mobile-' + theme, Buffer.from(forceColourScheme(css, theme)), '.css'), lockHash = 'sha256-' + createHash('sha256').update(modeLock(theme)).digest('base64');
    const html = phoneHtmlFeatures(renderPage({
      content: content,
      meta: meta,
      art: fixedPictureArt(art, theme),
      photos: photos,
      css: cssPath,
      js: jsPath,
      lockHash: lockHash,
      icons: icons,
      fonts: preload,
      grain: grainPreloadsFor(theme),
      theme: theme,
      themeColor: theme === 'dark' ? nightSet.header : '#f3eedd'
    }),features), path = theme === 'dark' ? 'night.html' : 'day.html';
    await withDeadline('write phone ' + path, () => writer(out, path, html));
    files.push({
      path: path,
      bytes: Buffer.byteLength(html),
      sha256: sha(html)
    });
  }
  const select=mobileSelector(features)||MOBILE_SELECT;
  const selectHash = 'sha256-' + createHash('sha256').update(select).digest('base64');
  const title = content.page.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${selectHash}'; base-uri 'none'"><title>${title}</title><script>${select}<\/script><noscript><meta http-equiv="refresh" content="0;url=day.html"></noscript></head><body><a href="day.html">Open Heartwood</a></body></html>`;
  await withDeadline('write phone index', () => writer(out, 'index.html', html));
  files.unshift({
    path: 'index.html',
    bytes: Buffer.byteLength(html),
    sha256: sha(html)
  });
  const artifact = sha(files.map(f => f.path + ':' + f.sha256).sort().join('\n'));
  const buildOrigin = await origin.finish({
    art: artOrigin,
    photos: photoOrigin
  });
  const manifest = {
    features,
    artifact: artifact,
    built: 'tools/build-mobile.mjs',
    origin: buildOrigin,
    source: {
      path: 'source/heartwood-site.html',
      sha256: sha(inputs.markup),
      inputs: buildOrigin.inputs
    },
    records: content.counts.records,
    groups: content.counts.groups,
    groupLeaves: content.counts.groupLeaves,
    art: art,
    photos: photos,
    files: files
  };
  await retireStaleOutputs(out,previous,[...files.map(file=>file.path),'manifest.json']);
  await withDeadline('write phone manifest', () => writer(out, 'manifest.json', JSON.stringify(manifest, null, 1) + '\n'));
  return {
    out: out,
    artifact: artifact,
    manifest: manifest,
    html: html,
    content: content,
    meta: meta
  };
}

// image-set with AVIF first and WebP fallback, for @2x and @3x screens; the plain url() line before it serves old engines
export function imageSet(a) {
  const u = p => 'url(' + p.replace('assets/', '') + ')';
  return `${u(a['2x.webp'])};background-image:-webkit-image-set(${u(a['2x.webp'])} 2x,${u(a['3x.webp'])} 3x);background-image:image-set(${u(a['2x.avif'])} type("image/avif") 2x,${u(a['2x.webp'])} type("image/webp") 2x,${u(a['3x.avif'])} type("image/avif") 3x,${u(a['3x.webp'])} type("image/webp") 3x)`;
}

if (await isBuildMain(import.meta.url)) {
  try {
    const {values: values} = parseArgs({
      options: {
        out: {
          type: 'string'
        },
        exclude: {type:'string'},
        help: {
          type: 'boolean'
        }
      }
    });
    const features=exclusionOptions(process.argv.slice(2),values.exclude);
    if (values.help) console.log('Usage: node tools/build-mobile.mjs [--out DIR] [--exclude=night,tree-effects,network-effects]'); else {
      assert(features.phone,'A direct phone build cannot exclude phone');
      if (values.out === '') throw new Error('--out requires a nonempty directory');
      const out = resolve(values.out || resolve(root, 'publish/mobile'));
      await runBuildCommand('phone', async ({writer: writer, onStep: onStep}) => {
        onStep('verify inputs and compose phone');
        const result = await buildMobile({
          out: out,
          writer: writer, exclude: features.excluded
        });
        console.log(JSON.stringify({
          out: result.out,
          artifact: result.artifact,
          records: result.manifest.records
        }));
      });
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  }
}
