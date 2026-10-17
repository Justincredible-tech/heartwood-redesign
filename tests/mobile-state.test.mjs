// State round-trip and the pure helpers the phone page ships (URL state, member search, root snap, detail sheet).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseState, stateSearch, matches, nearest, chain, renderRecord, CATS} from '../source/mobile/state.mjs';
import {artMeta} from '../source/mobile/art.mjs';
import {netData} from '../source/mobile/page.mjs';

test('URL state round-trips: open branches, member search, the open record', () => {
  const cases = [{open: [], q: ''}, {open: ['work'], q: ''}, {open: ['act', 'news'], q: 'sierra club'}, {open: [...CATS], q: 'Kentucky'}];
  for (const s of cases) {
    const search = stateSearch(s), back = parseState(search, '#leaf-forest-watch');
    assert.deepEqual(back, {open: CATS.filter(c => s.open.includes(c)), q: s.q, leaf: 'forest-watch'}, search);
  }
  assert.equal(stateSearch({open: [...CATS]}), '?open=all');
  assert.equal(stateSearch({open: ['news', 'act']}), '?open=act%2Cnews');
});

test('URL state is validated: unknown branches, odd hashes and long queries are dropped or trimmed', () => {
  assert.deepEqual(parseState('?open=work,evil,<script>&q=%20%20a%20%20b%20', '#leaf-../x'), {open: ['work'], q: 'a b', leaf: null});
  assert.deepEqual(parseState('?open=all', '#work'), {open: [...CATS], q: '', leaf: null});
  assert.equal(parseState('?q=' + 'x'.repeat(200), '').q.length, 80);
  assert.equal(parseState('', '#leaf-Forest').leaf, null);
});

test('member search matches the original (case-insensitive substring, list order kept)', () => {
  const names = ['Sierra Club Allegheny Group', 'Tennessee Sierra Club', 'Wild South'];
  assert.deepEqual(matches(names, 'sierra'), [0, 1]);
  assert.deepEqual(matches(names, '  WILD '), [2]);
  assert.deepEqual(matches(names, ''), [0, 1, 2]);
  assert.deepEqual(matches(names, 'zzz'), []);
});

test('the root snap picks the nearest spore, and its accent follows the baked root back to the hub', () => {
  const net = netData(artMeta(106));
  assert.equal(net.spores.length, 106);
  net.spores.forEach((n, i) => {
    const [x, y] = net.nodes[n];
    assert.equal(nearest(net.spores.map(k => net.nodes[k]), x + .4, y - .4), i, 'spore ' + i + ' snaps to itself');
    const pts = chain(net.nodes, net.curves, n);
    assert.deepEqual(pts[0], [net.nodes[0][0], net.nodes[0][1]], 'starts at the hub');
    assert.deepEqual(pts.at(-1), [x, y], 'ends on the spore');
  });
});

test('the detail sheet escapes record text and keeps external links in a new tab', () => {
  const html = renderRecord({id: 'x', kind: 'news', title: 'A <b> & "c"', body: ['<img onerror=1>'], links: [{label: 'Out', url: 'https://example.org/?a=1&b=2'}, {label: 'Mail', url: 'mailto:a@b.c'}]}, {news: 'News'}, {});
  assert(html.includes('A &lt;b&gt; &amp; &quot;c&quot;') && html.includes('&lt;img onerror=1&gt;'));
  assert(html.includes('href="https://example.org/?a=1&amp;b=2" target="_blank" rel="noopener"'));
  assert(/href="mailto:a@b.c">Mail/.test(html), 'mailto opens in place');
  assert(html.includes('href="#t-news" data-cat="news" data-close'));
});
