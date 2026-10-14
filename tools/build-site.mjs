import {resolveBuildFeatures,applySceneExclusions} from '../source/build-features.mjs';
import {capturePreviousOutputs,retireStaleOutputs,captureGeneratedOutputs,verifyFeatureClosure} from './feature-output.mjs';
import {themePreloads} from './theme-preloads.mjs';
import fs from 'node:fs/promises';

import path from 'node:path';

import crypto from 'node:crypto';

import { fileURLToPath } from 'node:url';

import CleanCSS from 'clean-css';

import { minify as minifyJs } from 'terser';

import { minify as minifyHtml } from 'html-minifier-terser';

import { buildMobile } from './build-mobile.mjs';

import { buildTaste } from './build-taste.mjs';

import { faithfulLeafSource } from '../source/taste/leaf-rendering.mjs';

import { writeOutput, ensureOutputDirectory, isOperatingSystemMetadata } from './build-output.mjs';
import {grainRows, grainFiles, verifyGrainTileBytes, grainPreloadPlan, grainRecipeSha256} from './grain-inputs.mjs';

import { compressBuild } from './compress-site.mjs';

import { experienceEntry } from '../source/taste/experience-entry.mjs';

import { isBuildMain, runBuildCommand, parseBuildFlags } from './build-cli.mjs';

export { parseBuildFlags };

export {isOperatingSystemMetadata};

export async function validateSiteOutput(out, projectRoot) {
  const protectedPaths = ['source', 'tools', '.git', '.audit', 'site', 'evidence'].map(name => path.join(projectRoot, name));
  return ensureOutputDirectory(out, {root: projectRoot, protectedPaths});
}

// Resolve the caller's spelling once; internal paths use the actual project directory.
const toolsDir = await fs.realpath(path.dirname(fileURLToPath(import.meta.url)));

const root = path.dirname(toolsDir);

const source = path.join(root, 'source');

const publish = path.join(root, 'publish');

const hash = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

export function verifyResponsivePhotoClosure(jsSource, photoFiles) {
  const blocks = [ ...jsSource.matchAll(/\/\* photos:start \*\/([\s\S]*?)\/\* photos:end \*\//g) ];
  if (blocks.length !== 1) throw new Error('Expected one authored responsive photo block');
  const referenced = new Set([ ...blocks[0][1].matchAll(/'assets\/photos\/([^']+)'/g) ].map(match => match[1]));
  const present = new Set(photoFiles);
  if (!referenced.size || referenced.size > 64 || present.size !== photoFiles.length || present.size !== referenced.size || [ ...referenced ].some(name => !present.has(name))) {
    throw new Error('Authored responsive photos and supplied files disagree');
  }
}

export async function buildSite({writer: writer = writeOutput, onStep: onStep = () => {}, exclude} = {}) {
  const features=resolveBuildFeatures(exclude);
  await validateSiteOutput(publish, root);
  let oldManifest;
  try {oldManifest=JSON.parse(await fs.readFile(path.join(toolsDir,'build-manifest.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const previous=await capturePreviousOutputs(publish,oldManifest);
  let buildStep = 'read authored sources';
  onStep(buildStep);
  const [htmlSource, cssSource, fontCss, jsSource, photoSource] = await Promise.all([ fs.readFile(path.join(source, 'heartwood-site.html'), 'utf8'), fs.readFile(path.join(source, 'css/heartwood-site.css'), 'utf8'), fs.readFile(path.join(source, 'css/fonts.css'), 'utf8'), fs.readFile(path.join(source, 'js/heartwood-site.js'), 'utf8'), fs.readFile(path.join(source, 'js/live-photos.js'), 'utf8') ]);
  const leaf = faithfulLeafSource({
    html: htmlSource,
    css: cssSource
  });
  buildStep = 'compose phone';
  onStep(buildStep);
  const mobile = features.phone ? await buildMobile({
    exclude: features.excluded,
    sourceRoot: root,
    out: path.join(publish, 'mobile'),
    writer: writer
  }) : null;
  if (mobile && Object.keys(mobile.manifest.photos).length !== 2) throw Error('Expected the two current author photos');
  buildStep = 'compile desktop';
  onStep(buildStep);
  const cssResult = new CleanCSS({
    level: 1,
    rebase: false
  }).minify(fontCss + '\n' + cssSource + '\n' + leaf.css);
  if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
  if (cssResult.warnings.length) console.warn(cssResult.warnings.join('\n'));
  const jsResult = await minifyJs(photoSource + '\n' + leaf.js + '\n' + jsSource, {
    ecma: 2020,
    module: false,
    compress: {
      passes: 2,
      unsafe: false
    },
    mangle: {
      toplevel: false
    },
    format: {
      comments: false
    }
  });
  if (!jsResult.code) throw new Error('Empty JavaScript build.');
  const cssPath = 'css/heartwood-site.' + hash(cssResult.styles) + '.css';
  const jsPath = 'js/heartwood-site.' + hash(jsResult.code) + '.js';
  const fontDir = path.join(source, 'assets/fonts');
  const fontFiles = await fs.readdir(fontDir);
  const latinFonts = fontFiles.filter(name => /-latin\.[0-9a-f]{12}\.woff2$/.test(name));
  if (latinFonts.length !== 2) throw new Error('Expected the two exact Latin font files.');
  // The paper-grain tiles (see tools/render-grain.py). Read which tile each screen density takes from the
  // stylesheet itself, and preload exactly that one, so the grain arrives with the first paint.
    const grainDir = path.join(source, 'assets/grain');
  const grainDirFiles = (await fs.readdir(grainDir)).filter(name => /^grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp$/.test(name));
  const grainBase = cssSource.match(/--grain-tile:\s*url\(\.\.\/assets\/grain\/([^)]+)\);/);
  const grainSteps = [ ...cssSource.matchAll(/@media \(min-resolution: ([\d.]+)dppx\)[^{]*\{ :root \{ --grain-tile: url\(\.\.\/assets\/grain\/([^)]+)\); \} \}/g) ].map(m => ({
    from: Number(m[1]),
    name: m[2]
  }));
  const grainTiles = [ {
    from: 0,
    name: grainBase && grainBase[1]
  }, ...grainSteps ];
  const grainProvenance = JSON.parse(await fs.readFile(path.join(grainDir, 'grain-provenance.json'), 'utf8'));
  const dayRows = grainRows(grainProvenance, {flavor: 'day', expectedRecipeSha256: grainRecipeSha256(cssSource, 'day')});
  if (!grainBase || grainTiles.length !== dayRows.length || grainDirFiles.length !== dayRows.length ||
      grainTiles.some(t => !grainDirFiles.includes(t.name)) || grainFiles(dayRows).some(name => !grainTiles.some(t => t.name === name))) {
    throw new Error('Grain tiles and stylesheet disagree; run tools/render-grain.py.');
  }
  const grainPreloads = grainTiles.map((tile, i) => {
    const next = grainTiles[i + 1];
    const media = [ tile.from && `(min-resolution: ${tile.from}dppx)`, next && `(max-resolution: ${(next.from - .001).toFixed(3)}dppx)` ].filter(Boolean).join(' and ');
    return `<link rel="preload" href="assets/grain/${tile.name}" as="image" type="image/webp" media="${media}" fetchpriority="high">`;
  });
  const preloads = [ ...latinFonts.map(name => `<link rel="preload" href="assets/fonts/${name}" as="font" type="font/woff2" crossorigin>`), ...grainPreloads ].join('\n');
  let html = applySceneExclusions(htmlSource,features.excluded).replace('<script src="js/live-photos.js"></script>', '').replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/g, '').replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^\"]+" rel="stylesheet">/, preloads).replace('<link rel="stylesheet" href="css/heartwood-site.css">', `<link rel="stylesheet" href="${cssPath}">`).replace('<script src="js/heartwood-site.js"><\/script>', `<script src="${jsPath}"><\/script>`);
  if (html === htmlSource || html.includes('fonts.googleapis.com') || !html.includes(cssPath) || !html.includes(jsPath)) {
    throw new Error('Source asset references did not match the build contract.');
  }
  html = await minifyHtml(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeAttributeQuotes: true,
    caseSensitive: true,
    keepClosingSlash: true,
    // Preserve all inline artwork geometry and event handlers as authored.
    minifyCSS: false,
    minifyJS: false,
    removeOptionalTags: false
  });
  // Keep the authored viewport value byte-exact too; the minifier strips its space.
    const viewport = htmlSource.match(/<meta name="viewport" content="([^"]+)">/);
  if (!viewport) throw new Error('Missing source viewport contract.');
  html = html.replace(/(<meta name=viewport content=")[^"]+(">)/, (_, start, end) => start + viewport[1] + end);
  const generated = [ 'heartwood-site.html', 'desktop-day.html', 'experience-entry.html', cssPath, jsPath ];
  await ensureOutputDirectory(path.join(publish, 'css'));
  await ensureOutputDirectory(path.join(publish, 'js'));
  await ensureOutputDirectory(path.join(publish, 'assets/fonts'));
  await ensureOutputDirectory(path.join(publish, 'assets/grain'));
  await ensureOutputDirectory(path.join(publish, 'assets/meta'));
  await ensureOutputDirectory(path.join(publish, 'assets/photos'));
  await writer(publish, cssPath, cssResult.styles);
  await writer(publish, jsPath, jsResult.code);
  await writer(publish, 'heartwood-site.html', html);
  await writer(publish, 'desktop-day.html', html);
  await writer(publish, 'experience-entry.html', experienceEntry('main', {
    htmlSource: htmlSource, exclude: features.excluded
  }));
  for (const name of fontFiles) {
    await writer(publish, 'assets/fonts/' + name, await fs.readFile(path.join(fontDir, name)));
    generated.push('assets/fonts/' + name);
  }
  for (const row of dayRows) {
    const bytes = await fs.readFile(path.join(grainDir, row.file));
    verifyGrainTileBytes(row, bytes);
    await writer(publish, 'assets/grain/' + row.file, bytes);
    generated.push('assets/grain/' + row.file);
  }
  // The dedicated night tiles ship for the night routes; the day page never preloads or references them.
  const nightRows = features.night && grainProvenance.night ? grainRows(grainProvenance.night, {flavor: 'night', expectedRecipeSha256: grainRecipeSha256(cssSource, 'night')}) : null;
  if (nightRows) {
    const nightFiles = (await fs.readdir(grainDir)).filter(name => /^grain-fine-night-\d+@[\d.]+x\.[0-9a-f]{12}\.webp$/.test(name));
    for (const row of nightRows) {
      if (!nightFiles.includes(row.file)) throw new Error('Night grain tiles and provenance disagree; run tools/render-grain.py --recipe night.');
      const bytes = await fs.readFile(path.join(grainDir, row.file));
      verifyGrainTileBytes(row, bytes);
      await writer(publish, 'assets/grain/' + row.file, bytes);
      generated.push('assets/grain/' + row.file);
    }
  }
  // Favicons and link-preview images (see tools/render-meta-images.py).
    const metaDir = path.join(source, 'assets/meta');
  for (const name of await fs.readdir(metaDir)) {
    if (!/^[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)$/.test(name)) throw new Error('Unexpected file in assets/meta: ' + name);
    await writer(publish, 'assets/meta/' + name, await fs.readFile(path.join(metaDir, name)));
    generated.push('assets/meta/' + name);
  }
  // Adopt the reviewed responsive copies without bypassing the owned writer.
    const photoDir = path.join(source, 'assets/photos');
  const photoFiles = (await fs.readdir(photoDir)).filter(name => name !== 'photos-provenance.json' && !isOperatingSystemMetadata(name));
  if (!photoFiles.length || photoFiles.length > 64) throw new Error('Expected a bounded responsive photo set');
  verifyResponsivePhotoClosure(jsSource, photoFiles);
  for (const name of photoFiles) {
    const match = /^[a-z0-9-]+-\d+\.([0-9a-f]{12})\.webp$/.exec(name);
    if (!match || !jsSource.includes('\'assets/photos/' + name + '\'')) throw new Error('Unexpected or unused photo: ' + name);
    const bytes = await fs.readFile(path.join(photoDir, name));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || hash(bytes) !== match[1]) throw new Error('Photo fingerprint/size changed: ' + name);
    await writer(publish, 'assets/photos/' + name, bytes);
    generated.push('assets/photos/' + name);
  }
  if(mobile)generated.push(...mobile.manifest.files.map(file => 'mobile/' + file.path), 'mobile/manifest.json');
  buildStep = 'compile taste';
  onStep(buildStep);
  const nightGrainPreloads = nightRows ? grainPreloadPlan(nightRows).map(entry =>
    `<link rel="preload" href="assets/grain/${entry.file}" as="image" type="image/webp" media="${entry.media}" fetchpriority="high">`) : null;
  const tastePreloads = [ ...latinFonts.map(name => `<link rel="preload" href="assets/fonts/${name}" as="font" type="font/woff2" crossorigin>`), themePreloads(grainPreloads.join('\n'),nightGrainPreloads?.join('\n')??null) ].join('\n');
  const taste = await buildTaste({
    exclude: features.excluded,
    root: root,
    htmlSource: htmlSource,
    cssSource: cssSource,
    fontCss: fontCss,
    authoredJsPath: jsPath,
    preloads: tastePreloads,
    writer: writer
  });
  generated.push(...taste.generated);
  const removed=await retireStaleOutputs(publish,previous,generated);
  const manifest = {
    features, removed, outputs: await captureGeneratedOutputs(publish,generated),
    generated: generated,
    assets: {
      html: 'heartwood-site.html',
      css: cssPath,
      js: jsPath
    },
    bytes: {
      html: Buffer.byteLength(html),
      css: Buffer.byteLength(cssResult.styles),
      js: Buffer.byteLength(jsResult.code)
    }
  };
  verifyFeatureClosure(manifest);
  await writer(toolsDir, 'build-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  buildStep = 'compress public text assets';
  onStep(buildStep);
  await compressBuild({
    root: root,
    publish: publish,
    manifest: manifest,
    writer: writer
  });
  return manifest;
}

// The normal build runs here, in one Node process. Supervision is explicitly opt-in.
if (await isBuildMain(import.meta.url)) {
  try {
    const flags = parseBuildFlags(process.argv.slice(2));
    if (flags.help) {
      console.log('Usage: node tools/build-site.mjs [--exclude=night,phone,tree-effects,network-effects]\nBuild desktop, taste and phone scenes, then compress their text assets.');
    } else {
      await runBuildCommand('site', async ({onStep: onStep, writer: writer}) => {
        const manifest = await buildSite({
          onStep: onStep,
          writer: writer, exclude: flags.exclude
        });
        console.log(JSON.stringify(manifest, null, 2));
      });
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  }
}
