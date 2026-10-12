import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import CleanCSS from 'clean-css';
import { minify as minifyJs } from 'terser';
import { minify as minifyHtml } from 'html-minifier-terser';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(toolsDir);
const source = path.join(root, 'source');
const publish = path.join(root, 'publish');
const hash = data => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

const [htmlSource, cssSource, fontCss, jsSource] = await Promise.all([
  fs.readFile(path.join(source, 'heartwood-site.html'), 'utf8'),
  fs.readFile(path.join(source, 'css/heartwood-site.css'), 'utf8'),
  fs.readFile(path.join(source, 'css/fonts.css'), 'utf8'),
  fs.readFile(path.join(source, 'js/heartwood-site.js'), 'utf8'),
]);
const cssResult = new CleanCSS({ level: 1, rebase: false }).minify(fontCss + '\n' + cssSource);
if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
if (cssResult.warnings.length) console.warn(cssResult.warnings.join('\n'));
const jsResult = await minifyJs(jsSource, {
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

const generated = ['heartwood-site.html', cssPath, jsPath];
await fs.mkdir(path.join(publish, 'css'), { recursive: true });
await fs.mkdir(path.join(publish, 'js'), { recursive: true });
await fs.mkdir(path.join(publish, 'assets/fonts'), { recursive: true });
await fs.mkdir(path.join(publish, 'assets/grain'), { recursive: true });
await fs.writeFile(path.join(publish, cssPath), cssResult.styles);
await fs.writeFile(path.join(publish, jsPath), jsResult.code);
await fs.writeFile(path.join(publish, 'heartwood-site.html'), html);
for (const name of fontFiles) {
  await fs.copyFile(path.join(fontDir, name), path.join(publish, 'assets/fonts', name));
  generated.push('assets/fonts/' + name);
}
for (const name of grainFiles) {
  await fs.copyFile(path.join(grainDir, name), path.join(publish, 'assets/grain', name));
  generated.push('assets/grain/' + name);
}

// Remove only this build's previously recorded, content-fingerprinted outputs.
let previous = [];
try { previous = JSON.parse(await fs.readFile(path.join(toolsDir, 'build-manifest.json'), 'utf8')).generated; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const current = new Set(generated);
for (const relative of previous) {
  if (current.has(relative) || !/^(?:(css|js)\/heartwood-site\.[0-9a-f]{12}\.(css|js)|assets\/logos\/heartwood-logos\.[0-9a-f]{12}\.svg|assets\/grain\/grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp)$/.test(relative)) continue;
  const target = path.resolve(publish, relative);
  if (!target.startsWith(publish + path.sep)) throw new Error('Build cleanup escaped publish.');
  for (const suffix of ['', '.gz', '.br']) await fs.rm(target + suffix, { force: true });
}
const manifest = {
  generated,
  assets: { html: 'heartwood-site.html', css: cssPath, js: jsPath },
  bytes: { html: Buffer.byteLength(html), css: Buffer.byteLength(cssResult.styles), js: Buffer.byteLength(jsResult.code) },
};
await fs.writeFile(path.join(toolsDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const compressed = spawnSync('python', [path.join(toolsDir, 'compress-site.py')], { stdio: 'inherit' });
if (compressed.status !== 0) throw new Error('Compression failed.');
console.log(JSON.stringify(manifest, null, 2));
