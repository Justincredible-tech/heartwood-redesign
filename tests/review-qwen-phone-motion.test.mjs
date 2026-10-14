// Focused regression (codex-042/044, tests first): the authored phone scene keeps its loops only while the
// document/browser is focused AND visible AND the group is on screen; reduced-motion is the explicit off
// switch; SaveData stays a network preference for the optional roots prefetch. Local vm/event harness — no
// waits, no browser, no network. Always exercise the source in this checkout; replay controls stay private.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const sourcePath = fileURLToPath(new URL('../source/mobile/app.js', import.meta.url));
const src = readFileSync(sourcePath, 'utf8');
const start = src.indexOf('// ------------------------------------------------------------------ ambient motion');
const end = src.indexOf('// ------------------------------------------------------------------ live photos');
const block = src.slice(start, end);
assert.ok(start >= 0 && end > start && block.length > 200, 'extract the exact ambient-motion block from app.js');

function harness({reduced = false, hidden = false, hasFocus = true} = {}) {
  const classes = new Set();
  const root = {
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
  };
  const listeners = {window: {}, document: {}, mql: {}};
  const timers = [];
  const groups = Array.from({length: 3}, () => ({classes: new Set()}));
  for (const g of groups) g.classList = {toggle: (c, force) => { if (force) g.classes.add(c); else g.classes.delete(c); }};
  const observed = [], observers = [];
  class IO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(el) { observed.push(el); }
  }
  const mql = {matches: reduced, addEventListener: (name, fn) => { listeners.mql[name] = fn; }};
  let focusFlag = true;
  const documentStub = {hidden, addEventListener: (name, fn) => { listeners.document[name] = fn; }};
  if (hasFocus) documentStub.hasFocus = () => focusFlag;
  const context = {
    root,
    reducedMotion: mql,
    calm: reduced,
    $$: () => groups,
    addEventListener: (name, fn) => { listeners.window[name] = fn; },
    document: documentStub,
    IntersectionObserver: IO,
    window: {IntersectionObserver: IO},
    setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; },
    clearTimeout: () => {},
  };
  vm.runInNewContext(block, context, {timeout: 1000});
  return {
    classes, groups, observed, observers, listeners, timers,
    visibility: value => { documentStub.hidden = value; listeners.document.visibilitychange(); },
    pagelife: which => listeners.window[which](),
    preference: value => { mql.matches = value; listeners.mql.change(); },
    blur: () => { focusFlag = false; listeners.window.blur(); },
    focus: () => { focusFlag = true; listeners.window.focus(); },
    intersect: (...flags) => observers[0].cb(flags.map((f, i) => ({target: groups[i], isIntersecting: f}))),
  };
}

test('calm is only explicit reduced motion; SaveData keeps its prefetch role', () => {
  const calmLine = src.split('\n').find(l => l.includes('const calm ='));
  assert.ok(calmLine.includes('reducedMotion.matches'), calmLine);
  assert.ok(!calmLine.includes('saveData'), 'SaveData must not stand in for an animation preference: ' + calmLine);
  assert.match(src, /if \(!\(navigator\.connection && navigator\.connection\.saveData\)\)/, 'SaveData still guards the optional roots prefetch');
});

test('a visible foreground stays running past the old 9 s; no wake timers are ever registered', async () => {
  const h = harness();
  assert.equal(h.classes.has('is-live'), true, 'authored loops run while the document is focused and visible');
  assert.equal(h.timers.length, 0, 'no idle/freeze timer exists');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.classes.has('is-live'), true, 'still running in the foreground');
  assert.equal(h.timers.length, 0);
});

test('offscreen groups pause via their own class; hidden documents pause everything and resume on return', () => {
  const h = harness();
  h.intersect(true, false, true);
  assert.equal(h.groups[0].classes.has('on'), true);
  assert.equal(h.groups[1].classes.has('on'), false, 'offscreen group stays paused');
  assert.equal(h.groups[2].classes.has('on'), true);
  h.visibility(true);
  assert.equal(h.classes.has('is-live'), false, 'hidden page holds every loop');
  h.visibility(false);
  assert.equal(h.classes.has('is-live'), true);
  h.pagelife('pagehide');
  assert.equal(h.classes.has('is-live'), false);
  h.pagelife('pageshow');
  assert.equal(h.classes.has('is-live'), true);
});

test('blur pauses; focus resumes only when focused AND visible AND not reduced', () => {
  const h = harness();
  assert.equal(h.classes.has('is-live'), true);
  h.blur();
  assert.equal(h.classes.has('is-live'), false, 'blur holds the loops');
  h.focus();
  assert.equal(h.classes.has('is-live'), true, 'focus resumes');
  h.visibility(true);
  h.focus();
  assert.equal(h.classes.has('is-live'), false, 'a focus event while hidden must not resume');
  h.visibility(false);
  h.focus();
  assert.equal(h.classes.has('is-live'), true);
  h.preference(true);
  h.focus();
  assert.equal(h.classes.has('is-live'), false, 'explicit reduced motion still wins over focus');
});

test('without document.hasFocus the condition falls back to visibility', () => {
  const h = harness({hasFocus: false});
  assert.equal(h.classes.has('is-live'), true, 'visible fallback runs');
  h.blur();
  assert.equal(h.classes.has('is-live'), false, 'blur still holds');
  h.focus();
  assert.equal(h.classes.has('is-live'), true, 'focus still resumes with the fallback');
  h.visibility(true);
  assert.equal(h.classes.has('is-live'), false);
  h.visibility(false);
  assert.equal(h.classes.has('is-live'), true);
});

test('reduced motion stops animation and a live preference change resumes without reload', () => {
  const h = harness({reduced: true});
  assert.equal(h.classes.has('is-live'), false, 'explicit reduced motion stops the scene');
  h.preference(false);
  assert.equal(h.classes.has('is-live'), true, 'a live change back resumes');
  h.preference(true);
  assert.equal(h.classes.has('is-live'), false);
});

test('only owned listeners exist: focus/blur/pagehide/pageshow, visibilitychange, one preference observer', () => {
  const h = harness();
  assert.deepEqual(Object.keys(h.listeners.window).sort(), ['blur', 'focus', 'pagehide', 'pageshow']);
  assert.deepEqual(Object.keys(h.listeners.document), ['visibilitychange']);
  assert.deepEqual(Object.keys(h.listeners.mql), ['change'], 'one preference observer, no repeated allocations');
  assert.equal(h.observed.length, 3, 'the three ambient groups are observed');
});
