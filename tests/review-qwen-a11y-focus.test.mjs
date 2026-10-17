// Focused public regression (batch-078 A11Y-01 corrections): a keyboard-focused leaf keeps its focus
// ring inside a filtered crown, and the open dialog's inert set includes the skip link.
// Reads the authored source only: pure Node, no browser, no build, no network. The visual browser/AT
// check for these behaviors stays in the browser lane and is not claimed by this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const CSS = 'source/css/heartwood-site.css';
const JS = 'source/js/heartwood-site.js';

test('a filtered, keyboard-focused leaf is excluded from the dim rule so its ring filter survives', async () => {
  const css = await read(CSS);
  const ring = /\.leaf:focus-visible\s*\{([^}]*)\}/.exec(css);
  assert(ring, 'The leaf focus-visible ring rule must exist');
  assert.match(ring[1], /filter:/, 'The ring is drawn with filter: drop-shadow; a dim filter would replace it');
  assert.match(ring[1], /var\(--focus\)/, 'The ring keeps the focus token');
  const dim = /\.tree\.is-filtered \.leaf:not\(\.is-lit\):not\(:focus-visible\)\s*\{([^}]*)\}/.exec(css);
  assert(dim, 'The filtered-leaf dim rule must exclude :focus-visible for focused leaves');
  assert.match(dim[1], /opacity:\s*\.24/, 'The filtered crown still dims unpicked leaves');
  assert.match(dim[1], /filter:\s*saturate\(\.3\)/, 'The dim still desaturates unpicked leaves');
  // Both selectors live on the same sheet; the ring rule must stay authored before the dim rule so the
  // exclusion (not a later override) is what protects the ring.
  assert.ok(css.indexOf('.leaf:focus-visible') < css.indexOf('.tree.is-filtered .leaf:not(.is-lit):not(:focus-visible)'));
});

test('the page inert set collects the skip link beside [data-page] and toggles both flags', async () => {
  const js = await read(JS);
  const declaration = /const page\s*=\s*\[\.\.\.document\.querySelectorAll\('([^']+)'\)\];/.exec(js);
  assert(declaration, 'The inert set declaration must be present');
  assert.equal(declaration[1], '[data-page], a.skip', 'The skip link is outside [data-page] and must be collected');
  const locked = /page\.forEach\(el => \{ el\.inert = true; \}\);/.exec(js);
  const unlocked = /page\.forEach\(el => \{ el\.inert = false; \}\);/.exec(js);
  assert(locked, 'Opening the dialog must lock the inert set');
  assert(unlocked, 'Closing the dialog must unlock the inert set');
  assert.equal(js.indexOf(locked[0]), js.lastIndexOf(locked[0]), 'Exactly one lock statement is expected');
  assert.equal(js.indexOf(unlocked[0]), js.lastIndexOf(unlocked[0]), 'Exactly one unlock statement is expected');
  // Order inside the flight: lock after the lifted state is set; unlock after it is removed and before
  // focus returns to the leaf.
  assert.ok(js.indexOf(locked[0]) > js.indexOf("document.body.classList.add('is-lifted')"));
  assert.ok(js.indexOf(unlocked[0]) > js.indexOf("document.body.classList.remove('is-lifted')"));
  assert.ok(js.indexOf(unlocked[0]) < js.indexOf('(a.back || a.leaf).focus('));
  // Execute the shipped declaration and toggles against a stub DOM: both the page wrappers and the
  // skip link receive inert, then both are released. Probe arrays stay in this realm so the assertion
  // compares real arrays (a vm-created array carries the vm realm's prototype).
  const pageEl = {};
  const skipEl = {};
  const asked = [];
  const flags = { locked: [], unlocked: [] };
  vm.runInNewContext(
    `${declaration[0]}\n${locked[0]}\nflags.locked.push(pageEl.inert, skipEl.inert)\n${unlocked[0]}\nflags.unlocked.push(pageEl.inert, skipEl.inert)`,
    {
      document: { querySelectorAll: selector => { asked.push(selector); return [pageEl, skipEl]; } },
      pageEl,
      skipEl,
      flags,
    }
  );
  assert.deepEqual(asked, ['[data-page], a.skip']);
  assert.deepEqual(flags.locked, [true, true], 'Both the page set and the skip link must be inert while the dialog is open');
  assert.deepEqual(flags.unlocked, [false, false], 'Closing must release the page set and the skip link');
});
