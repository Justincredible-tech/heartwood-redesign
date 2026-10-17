import test from 'node:test';

import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { resolve } from 'node:path';

import vm from 'node:vm';

import { createHash } from 'node:crypto';

import { prepareTaste } from '../source/taste/index.mjs';

import { faithfulLeafSource } from '../source/taste/leaf-rendering.mjs';

import { readContent } from '../source/mobile/content.mjs';

import { PHOTO_INPUTS } from '../tools/mobile-source-inputs.mjs';

import { PHONE_COMPOSERS } from '../tools/mobile-origin.mjs';

const root = resolve(import.meta.dirname, '..'), read = path => readFile(resolve(root, path), 'utf8'), inputs = Promise.all([ 'source/heartwood-site.html', 'source/css/heartwood-site.css', 'source/js/heartwood-site.js' ].map(read)), hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('one current faithful/taste wrapper retains every authored leaf and releases offscreen promotion', async () => {
  const [html, css] = await inputs, taste = prepareTaste({
    html: html,
    css: css
  }), faithful = faithfulLeafSource({
    html: html,
    css: css
  }), leaves = markup => [ ...markup.matchAll(/<button\b[^>]*class="leaf [^"]*"[^>]*>/g) ].map(row => row[0]);
  assert.equal(leaves(html).length, 149);
  assert.deepEqual(leaves(taste.html), leaves(html));
  assert.equal((taste.html.match(/class="hw-leaf-layer"/g) || []).length, 149);
  assert(!taste.html.includes('class="leaf-layer"'));
  assert.equal(faithful.html, html);
  for (const generated of [ taste.css, faithful.css ]) assert(generated.includes(':where(html:not(.is-motion-hidden) .stage:not(.is-motion-paused)) .tree .hw-leaf-layer{will-change:transform}'), 'Viewport promotion must not raise specificity above the taste clone override');
  assert(taste.css.includes('.tree .hw-leaf-layer.hw-taste-clone { will-change: auto; }'), 'Keep clone promotion override');
  assert.match(css, /html:not\(\.is-smooth-scroll\)\s*\{\s*scroll-behavior:\s*auto/);
});

test('authored responsive photo renderer preserves upstream360/720/1080 choices at main and taste bases', async () => {
  const [html, , source] = await inputs, block = source.match(/\/\* photos:start \*\/([\s\S]*?)\/\* photos:end \*\//);
  assert(block, 'Adopt the reviewed original-URL-keyed upstream PHOTOS map');
  const start = source.indexOf('  const photo = '), end = source.indexOf('\n  const tree =', start);
  assert(start !== -1 && end > start, 'Responsive photo renderer must be present');
  const context = {};
  vm.runInNewContext(block[1] + ';globalThis.table=PHOTOS;', context, {
    timeout: 50
  });
  const table = context.table;
  assert.equal(Object.keys(table).length, 2);
  const provenance = JSON.parse(await read('source/assets/photos/photos-provenance.json')).photos;
  for (const input of PHOTO_INPUTS) {
    assert.equal(provenance[input.url].source_sha256, input.sha256);
    const copies = table[input.url];
    assert.deepEqual(Array.from(copies, row => row[1]), [ 360, 720, 1080 ]);
    for (const [file, width] of copies) {
      const bytes = await readFile(resolve(root, 'source', file));
      assert(file.includes(hash(bytes).slice(0, 12)));
      assert.equal(bytes.length, provenance[input.url].files.find(row => row.width === width).bytes);
    }
    for (const taste of [ false, true ]) {
      const location = {
        href: 'https://example.invalid/heartwood/' + (taste ? 'taste/scene.html' : 'desktop-day.html')
      }, ctx = {
        URL: URL,
        location: location,
        document: {
          documentElement: {
            dataset: taste ? {
              hwExperience: 'taste'
            } : {}
          }
        },
        PHOTOS: table,
        esc: value => String(value).replace(/[&<>"']/g, c => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          '\'': '&#39;'
        }[c]))
      };
      vm.runInNewContext(source.slice(start, end) + ';globalThis.renderPhoto=photo;', ctx, {
        timeout: 50
      });
      const rendered = ctx.renderPhoto({
        src: input.url,
        alt: 'Author photo'
      }, '17rem');
      assert(rendered.includes('sizes="17rem"'));
      for (const [file, width] of copies) assert(rendered.includes('https://example.invalid/heartwood/' + file + ' ' + width + 'w'));
      assert(rendered.includes('data-live-photo="' + input.url + '"'), 'The publisher URL must remain authoritative for runtime refresh');
    }
  }
  const content = readContent(html, {
    scriptSource: source
  }), pictures = content.records.filter(row => row.img).map(row => row.img.src);
  for (const input of PHOTO_INPUTS) assert(pictures.includes(input.url), 'Phone content must retain the source URL identity of the adopted responsive photo');
});

test('phone-specific derivatives keep original content and current producer inputs', async () => {
  assert(PHONE_COMPOSERS.length > 0);
  assert.equal(new Set(PHONE_COMPOSERS).size, PHONE_COMPOSERS.length);
  for (const path of PHONE_COMPOSERS) {
    assert(/^(?:tools|source)\//.test(path));
    assert((await readFile(resolve(root, path))).length > 0, 'Composer must exist and contain bytes: ' + path);
  }
  const encoded = JSON.parse(await read('source/mobile/art/encoded/manifest.json')).files;
  for (const input of PHOTO_INPUTS) {
    assert.equal(hash(await readFile(resolve(root, input.src))), input.sha256);
    for (const width of input.widths) for (const format of [ 'avif', 'webp' ]) {
      const name = input.name + '-' + width + '.' + input.sha256.slice(0, 12) + '.' + format;
      assert(encoded[name]);
      assert.equal(hash(await readFile(resolve(root, 'source/mobile/art/encoded', name))), encoded[name].sha256);
    }
  }
});

test('Home/header and actual deferred smooth-scroll behavior survive the authored script', async () => {
  const [html, , source] = await inputs;
  assert.match(html, /<body id="top">/);
  assert(!/<header[^>]*id="top"/.test(html));
  assert.match(source, /const top = \$\('\.top'\)/);
  const start = source.indexOf('  const smooth'), end = source.indexOf('  /* --------------------------------------------------------------- header */', start);
  assert(start !== -1 && end > start);
  const frames = [], listeners = new Map, classes = [];
  vm.runInNewContext(source.slice(start, end), {
    document: {
      readyState: 'loading',
      documentElement: {
        classList: {
          add: name => classes.push(name)
        }
      }
    },
    window: {
      addEventListener: (name, fn, options) => listeners.set(name, {
        fn: fn,
        options: options
      })
    },
    requestAnimationFrame: fn => frames.push(fn)
  }, {
    timeout: 50
  });
  assert.deepEqual(classes, []);
  assert.equal(listeners.get('load').options.once, true);
  listeners.get('load').fn();
  assert.deepEqual(classes, []);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(classes, []);
  frames.shift()();
  assert.deepEqual(classes, [ 'is-smooth-scroll' ]);
  assert.equal(listeners.get('pointerdown').options.once, true);
  assert.equal(listeners.get('keydown').options.once, true);
});

test('responsive photo closure keeps every authored output and package path', async () => {
  const [, , script] = await inputs;
  const {verifyResponsivePhotoClosure: verifyResponsivePhotoClosure} = await (import('../tools/build-site-job.mjs'));
  const names = [ ...script.matchAll(/'assets\/photos\/([^']+)'/g) ].map(row => row[1]);
  assert.equal(names.length, 6, 'The two author photos each retain 360/720/1080 widths');
  assert.doesNotThrow(() => verifyResponsivePhotoClosure(script, names));
  const packageSource = await read('tools/package-upload.py');
  assert(packageSource.includes('assets/photos/'), 'Delivery packaging must retain responsive photos');
});

test('production photo guard rejects omitted, extra and duplicate input data', async () => {
  const [, , source] = await inputs;
  const {verifyResponsivePhotoClosure: check} = await (import('../tools/build-site-job.mjs'));
  const names = [ ...source.matchAll(/'assets\/photos\/([^']+)'/g) ].map(row => row[1]);
  assert.equal(names.length, 6);
  assert.doesNotThrow(() => check(source, names));
  assert.throws(() => check(source, names.slice(1)), /disagree/);
  assert.throws(() => check(source, [ ...names, 'unreferenced.webp' ]), /disagree/);
  assert.throws(() => check(source, [ ...names, names[0] ]), /disagree/);
  assert.throws(() => check(source.replace('photos:start', 'photos:broken'), names), /one authored/);
});
