// Properties of the phone page's pure helpers (fast-check, tests/property-lib.mjs pattern).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fc, check} from './property-lib.mjs';
import {parseState, stateSearch, matches, nearest, CATS} from '../source/mobile/state.mjs';

const norm = q => q.replace(/\s+/g, ' ').trim().slice(0, 80).trim();
test('any state survives the URL: parse(serialize(s)) is s, normalized', () => {
  check(fc.property(fc.subarray(CATS), fc.string({maxLength: 120}), fc.option(fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+){0,3}$/), {nil: null}), (open, q, leaf) => {
    const s = parseState(stateSearch({open, q}), leaf ? '#leaf-' + leaf : '');
    assert.deepEqual(s.open, CATS.filter(c => open.includes(c)));
    assert.equal(s.q, norm(norm(q)));
    assert.equal(s.leaf, leaf);
    assert.equal(stateSearch(s), stateSearch({open, q}), 'serializing again is stable');
  }));
});
test('parseState never throws and never returns an unknown branch, whatever the URL', () => {
  check(fc.property(fc.string(), fc.string(), (search, hash) => {
    const s = parseState('?' + search, '#' + hash);
    assert(s.open.every(c => CATS.includes(c)) && s.q.length <= 80 && (s.leaf === null || /^[a-z0-9-]+$/.test(s.leaf)));
  }));
});
test('member search returns exactly the names that contain the query, in order', () => {
  check(fc.property(fc.array(fc.string({maxLength: 12}), {maxLength: 30}), fc.string({maxLength: 4}), (names, q) => {
    const want = names.map((n, i) => [n, i]).filter(([n]) => n.toLowerCase().includes(q.trim().toLowerCase())).map(([, i]) => i);
    assert.deepEqual(matches(names, q), want);
  }));
});
test('the snap is the brute-force nearest spore', () => {
  const pt = fc.tuple(fc.double({min: 0, max: 375, noNaN: true}), fc.double({min: 0, max: 780, noNaN: true}));
  check(fc.property(fc.array(pt, {minLength: 1, maxLength: 60}), pt, (spores, [x, y]) => {
    const i = nearest(spores, x, y), d = s => (s[0] - x) ** 2 + (s[1] - y) ** 2;
    assert(spores.every(s => d(spores[i]) <= d(s)));
  }));
});
