import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import CleanCSS from 'clean-css';
import { minify as minifyJs } from 'terser';
import { minify as minifyHtml } from 'html-minifier-terser';
import {buildMobile} from './build-mobile.mjs';
import {buildTaste} from './build-taste.mjs';
import {faithfulLeafSource} from '../source/taste/leaf-rendering.mjs';
import {removeRecordedFingerprint,writeOutput} from './build-output.mjs';
import {experienceEntry} from '../source/taste/experience-entry.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(toolsDir);
const source = path.join(root, 'source');
const publish = path.join(root, 'publish');
const hash = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
let compressionChild=null;
let buildStep='read authored sources';
const stopChild=signal=>{if(compressionChild&&compressionChild.exitCode===null&&compressionChild.signalCode===null)compressionChild.kill(signal);};
const buildDeadline=setTimeout(()=>{console.error('stuck at '+buildStep+'; whole-run deadline exceeded');stopChild('SIGKILL');process.exit(124);},300000);buildDeadline.unref();
for(const [signal,code]of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])process.once(signal,()=>{process.exitCode=code;stopChild('SIGTERM');setTimeout(()=>{stopChild('SIGKILL');process.exit(code);},1500).unref();});

const [htmlSource, cssSource, fontCss, jsSource] = await Promise.all([
  fs.readFile(path.join(source, 'heartwood-site.html'), 'utf8'),
  fs.readFile(path.join(source, 'css/heartwood-site.css'), 'utf8'),
  fs.readFile(path.join(source, 'css/fonts.css'), 'utf8'),
  fs.readFile(path.join(source, 'js/heartwood-site.js'), 'utf8'),
]);
const leaf=faithfulLeafSource({html:htmlSource,css:cssSource});
buildStep='compose phone';console.log('[build] '+buildStep);
const mobile=await buildMobile();
const localPhotos=Object.fromEntries(Object.entries(mobile.manifest.photos).map(([url,photo])=>{
  const file=photo.widths['720']?.webp;
  if(!file||!mobile.manifest.files.some(row=>row.path===file))throw Error('Reviewed 720px photo missing for '+url);
  return [url,'mobile/'+file];
}));
if(Object.keys(localPhotos).length!==2)throw Error('Expected the two current author photos');
buildStep='compile desktop';console.log('[build] '+buildStep);
const cssResult = new CleanCSS({ level: 1, rebase: false }).minify(fontCss + '\n' + cssSource + '\n' + leaf.css);
if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
if (cssResult.warnings.length) console.warn(cssResult.warnings.join('\n'));
const jsResult = await minifyJs('const HW_LOCAL_PHOTOS='+JSON.stringify(localPhotos)+';\n'+leaf.js + '\n' + jsSource, {
  ecma: 2020,
  module: false,
  compress: { passes: 2, unsafe: false },
  mangle: { toplevel: false },
  format: { comments: false },
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
const grainFiles = (await fs.readdir(grainDir)).filter(name => /^grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp$/.test(name));
const grainBase = cssSource.match(/--grain-tile:\s*url\(\.\.\/assets\/grain\/([^)]+)\);/);
const grainSteps = [...cssSource.matchAll(/@media \(min-resolution: ([\d.]+)dppx\)[^{]*\{ :root \{ --grain-tile: url\(\.\.\/assets\/grain\/([^)]+)\); \} \}/g)]
  .map(m => ({ from: Number(m[1]), name: m[2] }));
const grainTiles = [{ from: 0, name: grainBase && grainBase[1] }, ...grainSteps];
if (!grainBase || grainTiles.length !== grainFiles.length || grainTiles.some(t => !grainFiles.includes(t.name))) {
  throw new Error('Grain tiles and stylesheet disagree; run tools/render-grain.py.');
}
const grainPreloads = grainTiles.map((tile, i) => {
  const next = grainTiles[i + 1];
  const media = [tile.from && `(min-resolution: ${tile.from}dppx)`, next && `(max-resolution: ${(next.from - .001).toFixed(3)}dppx)`]
    .filter(Boolean).join(' and ');
  return `<link rel="preload" href="assets/grain/${tile.name}" as="image" type="image/webp" media="${media}" fetchpriority="high">`;
});
const preloads = [...latinFonts.map(name => `<link rel="preload" href="assets/fonts/${name}" as="font" type="font/woff2" crossorigin>`), ...grainPreloads].join('\n');
let html = htmlSource
  .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/g, '')
  .replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^\"]+" rel="stylesheet">/, preloads)
  .replace('<link rel="stylesheet" href="css/heartwood-site.css">', `<link rel="stylesheet" href="${cssPath}">`)
  .replace('<script src="js/heartwood-site.js"></script>', `<script src="${jsPath}"></script>`);
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
  removeOptionalTags: false,
});
// Keep the authored viewport value byte-exact too; the minifier strips its space.
const viewport = htmlSource.match(/<meta name="viewport" content="([^"]+)">/);
if (!viewport) throw new Error('Missing source viewport contract.');
html = html.replace(/(<meta name=viewport content=")[^"]+(">)/, (_, start, end) => start + viewport[1] + end);

const generated = ['heartwood-site.html', 'desktop-day.html', 'experience-entry.html', cssPath, jsPath];
await fs.mkdir(path.join(publish, 'css'), { recursive: true });
await fs.mkdir(path.join(publish, 'js'), { recursive: true });
await fs.mkdir(path.join(publish, 'assets/fonts'), { recursive: true });
await fs.mkdir(path.join(publish, 'assets/grain'), { recursive: true });
await fs.mkdir(path.join(publish, 'assets/meta'), { recursive: true });
await fs.writeFile(path.join(publish, cssPath), cssResult.styles);
await fs.writeFile(path.join(publish, jsPath), jsResult.code);
await fs.writeFile(path.join(publish, 'heartwood-site.html'), html);
await writeOutput(publish,'desktop-day.html',html);
await writeOutput(publish,'experience-entry.html',experienceEntry('main',{htmlSource}));
for (const name of fontFiles) {
  await fs.copyFile(path.join(fontDir, name), path.join(publish, 'assets/fonts', name));
  generated.push('assets/fonts/' + name);
}
for (const name of grainFiles) {
  await fs.copyFile(path.join(grainDir, name), path.join(publish, 'assets/grain', name));
  generated.push('assets/grain/' + name);
}
// Favicons and link-preview images (see tools/render-meta-images.py).
const metaDir = path.join(source, 'assets/meta');
for (const name of await fs.readdir(metaDir)) {
  if (!/^[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)$/.test(name)) throw new Error('Unexpected file in assets/meta: ' + name);
  await fs.copyFile(path.join(metaDir, name), path.join(publish, 'assets/meta', name));
  generated.push('assets/meta/' + name);
}

generated.push(...mobile.manifest.files.map(file=>'mobile/'+file.path),'mobile/manifest.json');
buildStep='compile taste';console.log('[build] '+buildStep);
const taste=await buildTaste({root,htmlSource,cssSource,fontCss,authoredJsPath:jsPath,preloads});
generated.push(...taste.generated);

// Remove only this build's previously recorded, content-fingerprinted outputs.
let previous = [];
try { previous = JSON.parse(await fs.readFile(path.join(toolsDir, 'build-manifest.json'), 'utf8')).generated; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const current = new Set(generated);
for (const relative of previous) {
  if (!current.has(relative)) await removeRecordedFingerprint(publish,relative);
}
const manifest = {
  generated,
  assets: { html: 'heartwood-site.html', css: cssPath, js: jsPath },
  bytes: { html: Buffer.byteLength(html), css: Buffer.byteLength(cssResult.styles), js: Buffer.byteLength(jsResult.code) },
};
await fs.writeFile(path.join(toolsDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
buildStep='compress public text assets';console.log('[build] '+buildStep);
await new Promise((done,fail)=>{
  compressionChild=spawn('python',[path.join(toolsDir,'compress-site.py')],{stdio:'inherit'});
  const timeout=setTimeout(()=>{stopChild('SIGKILL');fail(Error('stuck at compression; 120-second deadline exceeded'));},120000);
  compressionChild.once('error',error=>{clearTimeout(timeout);fail(error);});
  compressionChild.once('close',(code,signal)=>{clearTimeout(timeout);compressionChild=null;code===0&&!signal?done():fail(Error('Compression failed: '+(signal||code)));});
});
clearTimeout(buildDeadline);
console.log(JSON.stringify(manifest, null, 2));
