// Focused public regression (batch-078 corr-081 item 2): decorative is-plain leaves (no data-item) must
// never open the dialog or run the fly/flip animation, while real leaves and programmatic item-backed
// opens keep working. Reads the shipped source and re-executes the exact guard lines in a stub context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');

test('the leaf click path and open() refuse itemless decorative leaves', async () => {
  const js = await read('source/js/heartwood-site.js');
  assert.match(js, /if \(leaf && leaf\.dataset\.item\) open\(leaf\);/,
    'the tree click handler must require an item-bearing leaf');
  assert.match(js, /if \(!item && !leaf\.dataset\.item\) return;/,
    'open() must refuse a leaf without an item and no explicit item');
  assert.match(js, /if \(state === 'opening'\) return;/,
    'the Tab handler must let navigation proceed during the opening phase');
});

test('the shipped open() guard lines behave: plain blocked, real and programmatic allowed, busy preserved', async () => {
  const js = await read('source/js/heartwood-site.js');
  const match = /async function open\(leaf, back, item\) \{[^\n]*\n(\s*if \(state !== 'idle'\) return;)\n(\s*if \(!item && !leaf\.dataset\.item\) return;)/.exec(js);
  assert.ok(match, 'the state and item guards must be the first statements of open()');
  const guards = match[1] + '\n' + match[2];
  const probe = new Function('leaf', 'back', 'item', 'state', `'use strict';\n${guards}\nreturn 'opened';`);
  assert.notEqual(probe({ dataset: {} }, undefined, undefined, 'idle'), 'opened', 'a plain decorative leaf must be blocked');
  assert.equal(probe({ dataset: { item: 'brochure' } }, undefined, undefined, 'idle'), 'opened', 'a real leaf opens');
  assert.equal(probe({ dataset: {} }, undefined, { id: 'x' }, 'idle'), 'opened', 'a programmatic item-backed open is preserved');
  assert.notEqual(probe({ dataset: { item: 'brochure' } }, undefined, undefined, 'open'), 'opened', 'the busy state still refuses new opens');
});
