// Focused public test (Family B): the phone sheet's data-close jump, writeUrl query building, and the
// skip-link inert set — driven through the exact app.js text in node:vm. Portable: no POSIX paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../source/mobile/app.js', import.meta.url)), 'utf8');
const sheetBlock = src.slice(src.indexOf("const sheet = $('#sheet'), body = $('#sheet-body'), main = $('main');"), src.indexOf('// ------------------------------------------------------------------ member search'));
const urlBlock = src.slice(src.indexOf('// ------------------------------------------------------------------ branches'), src.indexOf('// ------------------------------------------------------------------ taps'));
assert.ok(sheetBlock.length > 500 && urlBlock.length > 300, 'extraction failed');

function sheetFixture({withSkip = false} = {}) {
  const listeners = {}, timers = new Map(), events = [];
  let nextTimer = 1, backCalls = 0, scrollCalls = 0, replaceCalls = 0, lastState;
  const classes = new Set();
  const sheet = {hidden: true, classList: {contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c)}, querySelector: () => ({scrollTop: 0}), addEventListener: (n, fn) => listeners['sheet:' + n] = fn};
  const skip = withSkip ? {inert: false} : undefined;
  const loc = {pathname: '/phone/', search: '', hash: '#leaf-first'};
  const assignUrl = url => { const n = new URL(url, 'https://example.invalid/phone/page.html'); loc.pathname = n.pathname; loc.search = n.search; loc.hash = n.hash; };
  const hist = {
    state: {hwLeaf: 'first', keep: true},
    pushState(s, _t, u) {this.state = s; assignUrl(u);},
    replaceState(s, _t, u) {replaceCalls++; lastState = s; this.state = s; assignUrl(u);},
    back() {backCalls++;},
  };
  const context = {
    '$': s => ({'#sheet': sheet, '#sheet-body': {innerHTML: '', textContent: '', focus(){}}, 'main': {inert: false}, '.top': {inert: false}, '.skip': skip})[s],
    data: () => ({byId: new Map([['first', {id: 'first'}], ['second', {id: 'second'}]]), kinds: {}, pics: {}}),
    renderRecord: () => '<p>x</p>',
    livePhotos: {watch(){}},
    document: {activeElement: {isConnected: true, focus(){}}, querySelector: p => p === '#t-act' ? {scrollIntoView(){scrollCalls++;}} : null},
    history: hist,
    location: loc,
    parseState: (_s, h) => ({leaf: h && h.startsWith('#leaf-') ? h.slice(6) : null}),
    addEventListener: (n, fn) => listeners[n] = fn,
    openCats(){}, CATS: ['act', 'work'],
    setTimeout: (fn, ms) => {const id = nextTimer++; timers.set(id, {fn, ms}); return id;},
    clearTimeout: id => timers.delete(id),
    calm: false,
  };
  vm.runInNewContext(sheetBlock + '\napi={show,hide,close};', context, {timeout: 1000});
  const more = {getAttribute: () => '#t-act', dataset: {cat: 'act'}, closest(sel) {return sel === '[data-close]' ? this : null;}};
  const opener = () => ({isConnected: true, focus(){}});
  return {
    api: context.api, opener, skip, timers,
    clickMore: () => listeners['sheet:click']({target: more, preventDefault(){}}),
    counts: () => ({backCalls, scrollCalls, replaceCalls}),
    lastState: () => lastState, state: () => hist.state, loc: () => ({...loc}),
    addForeign: () => hist.replaceState({hwLeaf: 'first', keep: true, foreignRoute: 'KEEP', nested: {owner: 'OTHER'}}, '', loc.pathname + loc.search + loc.hash),
    flushBack: () => listeners.popstate(),
    fireTimer: id => {const t = timers.get(id); if (t) t.fn();},
  };
}

test('PH-1: a reloaded deep link jumps directly on data-close (no Back dispatched)', () => {
  const f = sheetFixture();
  f.api.show('first', false, f.opener());                // reloaded #leaf-first: pushed=false, state keeps hwLeaf
  assert.equal(f.counts().backCalls, 0);
  f.clickMore();
  assert.equal(f.counts().backCalls, 0, 'no Back for an unpushed record');
  assert.equal(f.counts().scrollCalls, 1, 'the tree must move itself when no Back will');
});

test('PH-1: a pushed open keeps the Back path and does not double-jump', () => {
  const f = sheetFixture();
  f.api.show('first', true, f.opener());
  f.clickMore();
  assert.equal(f.counts().backCalls, 1, 'pushed closes keep the Back');
  assert.equal(f.counts().scrollCalls, 0, 'no direct jump; popstate owns it');
});

test('PH-1: the backPending replaceState path jumps directly with no extra Back', () => {
  const f = sheetFixture();
  f.api.show('first', true, f.opener());
  f.api.close();                                          // pushed -> back() + backPending
  f.api.show('second', true, f.opener());                 // newopen under a pending Back -> replaceState
  const before = f.counts().backCalls;
  f.clickMore();
  assert.equal(f.counts().backCalls, before, 'no second Back');
  assert.equal(f.counts().scrollCalls, 1, 'no Back means the handler must jump');
});

test('PH-1b: the unpushed close clears only the owned hwLeaf key and strips the hash', () => {
  const f = sheetFixture();
  f.api.show('first', false, f.opener());
  f.api.close();
  const state = f.lastState();
  assert.equal(state.keep, true, 'foreign state data survives');
  assert.equal('hwLeaf' in state, false, 'the stale owned marker is cleared');
  assert.equal(f.loc().hash, '', 'the deep-link hash is stripped with the close');
});

test('PH-1c: a pending-Back reopen preserves foreign state through the traversal commit', () => {
  const f = sheetFixture();
  f.api.show('first', true, f.opener());
  f.api.close();                                   // Back dispatched; the reopen will race it
  f.addForeign();                                  // a cooperating caller owns fields on the current entry
  f.api.show('second', true, f.opener());          // pending branch: same-entry replacement
  let state = f.lastState();
  assert.equal(state.hwLeaf, 'second', 'the owned marker tracks the visible record');
  assert.equal(state.foreignRoute, 'KEEP', 'the same-entry replacement keeps foreign fields');
  f.flushBack();                                   // execute the queued popstate boundary
  state = f.state();
  assert.equal(state.hwLeaf, 'second', 'the committed entry still carries the owned marker');
  assert.equal(state.foreignRoute, 'KEEP', 'foreign state survives the traversal commit');
  assert.equal(state.nested.owner, 'OTHER');
});

test('PH-4: the skip link joins and leaves the inert set; an absent skip is tolerated', () => {
  const f = sheetFixture({withSkip: true});
  f.api.show('first', true, f.opener());
  assert.equal(f.skip.inert, true);
  f.api.close();
  assert.equal(f.skip.inert, false);
  const g = sheetFixture();
  g.api.show('first', true, g.opener());
  g.api.close();
  assert.ok(true, 'no throw without a skip element');
});

function urlFixture(search, value) {
  const calls = [];
  const context = {
    '$$': () => [], branches: [],
    '$': () => undefined,
    find: {value},
    stateSearch: ({q}) => (q ? 'q=' + q : ''),
    location: {pathname: '/phone/', search, hash: '#leaf-first'},
    history: {state: {}, replaceState: (s, _, u) => calls.push(u)},
    URLSearchParams,
  };
  vm.runInNewContext(urlBlock + '\napi={writeUrl};', context, {timeout: 1000});
  context.api.writeUrl();
  return calls;
}

test('PH-3: writeUrl builds the same URLs with the universally supported string check', () => {
  assert.deepEqual(urlFixture('', 'x'), ['/phone/?q=x#leaf-first']);
  assert.deepEqual(urlFixture('', ''), [], 'unchanged URL means no replaceState');
  assert.deepEqual(urlFixture('?theme=dark', 'x'), ['/phone/?q=x&theme=dark#leaf-first']);
});
