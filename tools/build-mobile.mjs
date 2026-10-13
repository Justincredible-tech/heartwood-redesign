// Compose the phone site from readable source and reviewed, pinned art derivatives.
//   node tools/build-mobile.mjs [--out DIR] (default publish/mobile)
// Node only: ordinary builds never launch a browser, fetch remote content or rewrite source assets.
import {createHash} from 'node:crypto';
import {resolve, join, basename, extname} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {readContent} from '../source/mobile/content.mjs';
import {artDocs, artMeta} from '../source/mobile/art.mjs';
import {renderPage, positionsCss, modeLock} from '../source/mobile/page.mjs';
import {loadNight, darkCss} from '../source/mobile/night.mjs';
import {loadMobileSources,PHOTO_INPUTS} from './mobile-source-inputs.mjs';
import {forceColourScheme,fixedPictureArt,MOBILE_SELECT} from './mobile-theme.mjs';
import {imageDimensions,readBuildInput,svgFromSymbol} from './build-mobile-inputs.mjs';
import {ensureOutputDirectory,writeOutput} from './build-output.mjs';

const root = resolve(import.meta.dirname, '..');
const M = resolve(root, 'source/mobile');
const MASTERS = resolve(M, 'art/masters'), ENCODED = resolve(M, 'art/encoded');
const sha = b => createHash('sha256').update(b).digest('hex');

// encoder settings per art piece (chosen from rendered comparisons; see tools/BUILD.md "Mobile build"). The sky is the 12-frame
// wingbeat strip: AVIF q40 is indistinguishable from q62 on moving birds and keeps the first screen <= 150 KB.
export const ENCODE = {
  tree: {avif: 50, webp: 80}, ridges: {avif: 50, webp: 78}, clouds: {avif: 50, webp: 78}, trunk: {avif: 55, webp: 80},
  'tier-l': {avif: 56, webp: 80}, 'tier-r': {avif: 56, webp: 80}, leaves: {avif: 62, webp: 86}, ground: {avif: 55, webp: 80}, roots: {avif: 52, webp: 78},
  sky: {avif: 40, webp: 80}, walk: {avif: 62, webp: 86}, bee: {avif: 62, webp: 86}, flies: {avif: 62, webp: 86},
};
const encodeFor = name => ENCODE[name.replace(/-night$/, '')];   // night bakes use their day piece's settings
export const PHOTOS = PHOTO_INPUTS; // pinned author-photo inputs; source URLs are data keys, never fetched

async function encodedArt(name, png, q) {
  const encodedManifest=JSON.parse((await readBuildInput(join(ENCODED,'manifest.json'))).toString('utf8'));
  const key = sha(png).slice(0, 12) + '-' + q.avif + '-' + q.webp, out = {};
  const meta = imageDimensions(png,'png');
  for (const dpr of [2, 3]) {
    for (const fmt of ['avif', 'webp']) {
      const file = join(ENCODED, `${name}@${dpr}x.${key}.${fmt}`);
      const rec=encodedManifest.files[basename(file)],encoded=await readBuildInput(file);
      assert(rec && encoded.length===rec.bytes && sha(encoded)===rec.sha256,'Encoded source asset changed: '+basename(file));
      out[`${dpr}x.${fmt}`] = file;
    }
    out[`${dpr}x.px`] = dpr === 3 ? [meta.width, meta.height] : [Math.round(meta.width * 2 / 3), Math.round(meta.height * 2 / 3)];
  }
  return out;
}
async function encodedPhoto(p) {
  const input = p.bytes, key = sha(input).slice(0, 12), out = {widths: {}},encodedManifest=JSON.parse((await readBuildInput(join(ENCODED,'manifest.json'))).toString('utf8'));
  const meta = imageDimensions(input,'jpeg'); out.ratio = meta.height / meta.width;
  for (const w of p.widths) for (const fmt of ['avif', 'webp']) {
    const file = join(ENCODED, `${p.name}-${w}.${key}.${fmt}`);
    const rec=encodedManifest.files[basename(file)],encoded=await readBuildInput(file);
    assert(rec && encoded.length===rec.bytes && sha(encoded)===rec.sha256,'Encoded photo source changed: '+basename(file));
    (out.widths[w] ||= {})[fmt] = file;
  }
  return out;
}

export async function buildMobile({out, sourceRoot} = {}) {
  const inputs=await loadMobileSources({root,sourceRoot});
  const content = readContent(inputs.markup,{scriptSource:inputs.scriptSource});
  const nightSet = await loadNight(root,{siteCss:inputs.artCss});
  const docs = artDocs(inputs.artSource, content.counts.groups, nightSet), meta = artMeta(content.counts.groups);
  const index = JSON.parse((await readBuildInput(join(MASTERS, 'masters.json'))).toString('utf8'));
  out = resolve(out || resolve(root,'publish/mobile'));
  assert(out !== root && !['source','tools','.git','.audit'].some(dir => out === resolve(root,dir) || out.startsWith(resolve(root,dir) + '/')), 'Mobile output must not overwrite source or tools');
  assert(!resolve(out).startsWith(resolve(root, 'site') + '/') && resolve(out) !== resolve(root, 'site'), 'build-mobile never writes into site/ (publishing is a separate, verified step)');
  out=await ensureOutputDirectory(out,{root,protectedPaths:['source','tools','.git','.audit','site'].map(dir=>resolve(root,dir))});
  await ensureOutputDirectory(join(out,'assets'));
  const assets = new Map();       // logical name -> public path
  const files = [];
  const emit = async (logical, buf, ext) => {
    const name = logical.replace(/[^a-z0-9@.-]/gi, '-') + '.' + sha(buf).slice(0, 16) + ext;
    await writeOutput(out,'assets/'+name,buf); assets.set(logical, 'assets/' + name); files.push({path: 'assets/' + name, bytes: buf.length, sha256: sha(buf)});
    return 'assets/' + name;
  };
  const art = {};
  for (const d of docs) {
    const rec = index[d.name];
    assert(rec, `No baked master for "${d.name}": rebake the source mobile art for ${d.name}`);
    assert.equal(rec.doc,sha(d.html),`The art source for "${d.name}" changed; regenerate its reviewed source assets before building`);
    const png = await readBuildInput(join(MASTERS, d.name + '@3x.png'));
    assert.equal(sha(png), rec.png, 'master PNG does not match masters.json: ' + d.name);
    if (d.mask) continue;          // checked fresh like the art, never shipped (the crown mask verify-mobile reads)
    const enc = await encodedArt(d.name, png, encodeFor(d.name));
    art[d.name] = {w: d.w, h: d.h, px2: enc['2x.px'], px3: enc['3x.px']};
    for (const k of ['2x.avif', '2x.webp', '3x.avif', '3x.webp']) { const [d2, fmt] = k.split('.'); art[d.name][k] = await emit(`${d.name}@${d2}`, await readBuildInput(enc[k]), '.' + fmt); }
  }
  const photos = {};
  for (const p of inputs.photos) { const e = await encodedPhoto(p); photos[p.url] = {ratio: e.ratio, widths: {}};
    for (const [w, f] of Object.entries(e.widths)) photos[p.url].widths[w] = {avif: await emit(`${p.name}-${w}`, await readBuildInput(f.avif), '.avif'), webp: await emit(`${p.name}-${w}`, await readBuildInput(f.webp), '.webp')}; }
  for(const license of inputs.licenses)await emit(license.name,license.bytes,'.txt');
  const fonts = {};
  for (const f of inputs.fonts) fonts[f.logical] = await emit(basename(f.logical, '.woff2'), f.bytes, '.woff2');
  const logo = await emit('logo', Buffer.from(svgFromSymbol(content.page.logo, '#000')), '.svg');     // a mask: the page paints it in his logo colour, or cream
  const mark = await emit('mark', Buffer.from(svgFromSymbol(content.page.mark, '#000')), '.svg');
  const icons=[];for(const icon of inputs.icons)icons.push({rel:icon.rel,type:icon.type,sizes:icon.sizes,href:await emit(icon.name,icon.bytes,extname(icon.path))});

  // CSS: mobile.css + generated positions + the night layer, with @art/@font/@svg references resolved
  const viewBox=/viewBox="([^\"]+)"/.exec(content.page.logo)?.[1]?.split(/\s+/).map(Number);
  assert(viewBox?.length===4&&viewBox.every(Number.isFinite)&&viewBox[2]>0&&viewBox[3]>0,'Final logo needs a finite positive viewBox');
  let css = (await readBuildInput(join(M,'mobile.css'))).toString('utf8') + `\n:root { --tulip: ${meta.tulip}; --logo-ratio: ${viewBox[2]} / ${viewBox[3]}; --logo: ${inputs.logoColour}; }\n` + positionsCss(meta) + darkCss(nightSet);
  css = css.replace(/@art\(([\w-]+)\)/g, (_, n) => { const a = art[n]; assert(a, 'unknown art ' + n); return imageSet(a); })
    .replace(/@font\(([^)]+)\)/g, (_, f) => { assert(fonts[f], 'unknown font ' + f); return 'url(' + fonts[f].replace('assets/', '') + ')'; })
    .replace(/@svg\((logo|mark)\)/g, (_, k) => 'url(' + (k === 'logo' ? logo : mark).replace('assets/', '') + ')');
  assert(!/@(art|font|svg)\(/.test(css), 'unresolved asset reference in mobile.css');
  const state = (await readBuildInput(join(M,'state.mjs'))).toString('utf8').replace(/^export /gm, '');
  const app = (await readBuildInput(join(M,'app.js'))).toString('utf8');
  const jsPath = await emit('mobile', Buffer.from(`(()=>{'use strict';\n${state}\n${app}\n})();\n`), '.js');
  // the two Latin faces every first screen uses (headline: Young Serif, text: Instrument Sans) arrive with the stylesheet, not after it
  const preload = ['3qTpojO2nS2VtkB3KtkQZ1t93kY.woff2', 'pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2'].map(f => fonts[f]);
  for(const theme of ['light','dark']){
    const cssPath=await emit('mobile-'+theme,Buffer.from(forceColourScheme(css,theme)),'.css'),lockHash='sha256-'+createHash('sha256').update(modeLock(theme)).digest('base64');
    const html=renderPage({content,meta,art:fixedPictureArt(art,theme),photos,css:cssPath,js:jsPath,lockHash,icons,fonts:preload,theme,themeColor:theme==='dark'?nightSet.header:'#f3eedd'}),path=theme==='dark'?'night.html':'day.html';
    await writeOutput(out,path,html);files.push({path,bytes:Buffer.byteLength(html),sha256:sha(html)});
  }
  const selectHash='sha256-'+createHash('sha256').update(MOBILE_SELECT).digest('base64');
  const title=content.page.title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${selectHash}'; base-uri 'none'"><title>${title}</title><script>${MOBILE_SELECT}</script><noscript><meta http-equiv="refresh" content="0;url=day.html"></noscript></head><body><a href="day.html">Open Heartwood</a></body></html>`;
  await writeOutput(out,'index.html',html);files.unshift({path:'index.html',bytes:Buffer.byteLength(html),sha256:sha(html)});
  const artifact = sha(files.map(f => f.path + ':' + f.sha256).sort().join('\n'));
  const manifest = {artifact, built: 'tools/build-mobile.mjs', source: {path: 'source/heartwood-site.html', sha256: sha(inputs.markup),inputs:inputs.provenance}, records: content.counts.records,
    groups: content.counts.groups, groupLeaves: content.counts.groupLeaves, art, photos, files};
  await writeOutput(out,'manifest.json',JSON.stringify(manifest,null,1)+'\n');
  return {out, artifact, manifest, html, content, meta};
}
// image-set with AVIF first and WebP fallback, for @2x and @3x screens; the plain url() line before it serves old engines
export function imageSet(a) {
  const u = p => 'url(' + p.replace('assets/', '') + ')';
  return `${u(a['2x.webp'])};background-image:-webkit-image-set(${u(a['2x.webp'])} 2x,${u(a['3x.webp'])} 3x);background-image:image-set(${u(a['2x.avif'])} type("image/avif") 2x,${u(a['2x.webp'])} type("image/webp") 2x,${u(a['3x.avif'])} type("image/avif") 3x,${u(a['3x.webp'])} type("image/webp") 3x)`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for(const [signal,code]of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])process.once(signal,()=>process.exit(code));
  const {values}=parseArgs({options:{out:{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log('Usage: node tools/build-mobile.mjs [--out DIR]');}
  else {const timer=setTimeout(()=>{console.error('Mobile build exceeded its ten-minute deadline');process.exit(124);},600000);try{const result=await buildMobile({out:values.out});console.log(JSON.stringify({out:result.out,artifact:result.artifact,files:result.manifest.files.length}));}finally{clearTimeout(timer);}}
}
