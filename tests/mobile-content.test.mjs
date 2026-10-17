// Content completeness of the separate phone build: every record, link, destination and page word of the
// original content model is reachable on the phone page, without script (cards are real links) and in full
// through the detail sheet (renderRecord, the same function the page ships).
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,sep} from 'node:path';
import {readContent} from '../source/mobile/content.mjs';
import {esc, renderRecord, TIER_ID, CATS} from '../source/mobile/state.mjs';
import {mobileBuild} from './mobile-build-fixture.mjs';
import {loadMobileSources} from '../tools/mobile-source-inputs.mjs';

const root = resolve(import.meta.dirname, '..');
const inputs=await loadMobileSources({root});
const content = readContent(inputs.markup,{scriptSource:inputs.scriptSource});
const decode = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('the original content model is read in full (136 records, 106 member groups)', () => {
  assert.equal(content.records.length, 136);
  const by = k => content.records.filter(r => r.kind === k).length;
  assert.deepEqual({work: by('work'), gather: by('gather'), news: by('news'), about: by('about'), act: by('act'), group: by('group')}, {work: 7, gather: 2, news: 11, about: 5, act: 5, group: 106});
});

test('105 vs 106: the original chip counts member groups that got a leaf; the data holds 106 groups', () => {
  // the original seats groups on the deep-tone leaves left after the features; there are 105 such leaves
  assert.equal(content.counts.groups, 106);
  assert.equal(content.counts.groupLeaves, 105);
  assert.equal(content.counts.deepLeaves - Math.max(0, content.counts.features - content.counts.brightLeaves), 105);
});

test('every record has a real link card on the page (reachable without script)', async () => {
  const built = await mobileBuild();
  const {html} = built;
  if (!built.existing) { const owned = built.owned, out = built.out; assert(owned && out, 'the shared build exposes its owned directory'); assert(owned.startsWith(sep) && !owned.includes(sep + 'publish' + sep), 'the shared build must never land in a publish/ tree'); assert(out.startsWith(owned + sep), 'the build output must stay inside its owned temp directory'); }
  for (const r of content.records) {
    const cards = [...html.matchAll(new RegExp(`<a [^>]*data-open="${r.id}"[^>]*>`, 'g'))].map(m => m[0]);
    assert(cards.length >= 1, 'no card for ' + r.id);
    const href = decode(/href="([^"]*)"/.exec(cards[0])[1]);
    const expected = r.links && r.links[0] ? r.links[0].url : r.kind === 'group' ? '#network' : '#' + TIER_ID[r.kind];
    assert.equal(href, expected, 'card href for ' + r.id);
  }
});

// the project direction, 2026-10-12: keep BOTH the branch cards and the matching soil sections, as the original pairs each leaf with its section.
// Every Get involved, Gatherings and News record is reachable from its branch AND from its soil section. The soil News section shows the
// current issue and the back issues itself and reaches the other posts through its "Posts and the podcast" link to the News branch.
test('every Get involved, Gatherings and News record is reachable from its branch and from its soil section', async () => {
  const {html} = await mobileBuild();
  const sections = Object.fromEntries([...html.matchAll(/<section\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map(m => [m[1], m[2]]));
  const SOIL = {act: 'support', gather: 'gatherings', news: 'news'};
  const opens = (sec, id) => new RegExp(`<a [^>]*data-open="${id}"`).test(sections[sec] || '');
  const postsLink = /<a [^>]*href="#t-news"[^>]*data-cat="news"[^>]*>Posts and the podcast<\/a>/.test(sections.news || '');
  let n = 0;
  for (const [kind, soil] of Object.entries(SOIL)) {
    assert(sections[TIER_ID[kind]] && sections[soil], `both the ${kind} branch and the ${soil} soil section exist`);
    content.records.filter(x => x.kind === kind).forEach((r, i) => {
      assert(opens(TIER_ID[kind], r.id), `${r.id}: no card on its branch #${TIER_ID[kind]}`);
      const post = kind === 'news' && i > 0 && !r.backIssue;      // the current issue and the back issues are on the soil section itself
      assert(opens(soil, r.id) || (post && postsLink), `${r.id}: not reachable from its soil section #${soil}`);
      n++;
    });
  }
  assert.equal(n, 5 + 2 + 11);
});

test('every record field and every original link is in its detail sheet', async () => {
  const {html} = await mobileBuild();
  const data = JSON.parse(/<script type="application\/json" id="hw-records">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.records.length, content.records.length);
  let links = 0;
  for (const r of content.records) {
    const shipped = data.records.find(x => x.id === r.id);
    for (const k of ['title', 'sum', 'meta', 'date', 'body', 'list', 'tiers', 'links', 'img', 'url']) assert.deepEqual(shipped[k], r[k], `${r.id}.${k}`);
    const sheet = renderRecord(shipped, data.kinds, data.pics);
    for (const t of [r.title, ...r.body, ...(r.list || [])]) assert(sheet.includes(esc(t)), 'sheet text missing: ' + r.id);
    for (const [n, p] of r.tiers || []) assert(sheet.includes(esc(n)) && sheet.includes(esc(p) + ' / year'), 'tier missing: ' + r.id);
    for (const l of r.links || []) { assert(sheet.includes(`href="${esc(l.url)}"`) && sheet.includes(esc(l.label)), 'link missing: ' + r.id + ' ' + l.url); links++; }
    if (r.img) assert(sheet.includes(`alt="${esc(r.img.alt)}"`) && data.pics[r.img.src], 'picture missing: ' + r.id);
    assert(sheet.includes(`href="#${TIER_ID[r.kind]}"`), 'way back to the category: ' + r.id);
  }
  assert(links >= 60, 'expected the original record links, got ' + links);
});

test('every destination the original page names is on the phone page', async () => {
  const {html} = await mobileBuild();
  const hrefs = new Set([...html.matchAll(/href="([^"]*)"/g)].map(m => decode(m[1])));
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const desktopModeLinks = new Set(['taste/?theme=dark']);   // the original's data-hw-mode control points at the desktop taste experience; the phone ships its own day/night pages, so that destination is intentionally not carried
  for (const l of content.pageLinks) {
    if (desktopModeLinks.has(l.href)) continue;
    assert(hrefs.has(l.href), 'missing destination ' + l.href + ' (' + l.label + ')');
    if (l.href.startsWith('#')) assert(ids.has(l.href.slice(1)), 'anchor target missing: ' + l.href);
  }
  for (const id of ['about', 'work', 'gatherings', 'news', 'network', 'support', 'top']) assert(ids.has(id), 'original section id missing: ' + id);
  for (const k of CATS) assert(ids.has(TIER_ID[k]), 'category branch missing: ' + k);
  for (const h of hrefs) if (h.startsWith('#') && h.length > 1) assert(ids.has(h.slice(1)), 'in-page link to nowhere: ' + h);
});

test('the page words of every section, the councils and the founder are present', async () => {
  const {html} = await mobileBuild();
  const P = content.page, S = P.sections, has = t => assert(html.includes(esc(t)), 'missing text: ' + t.slice(0, 60));
  [P.h1, P.footer.say, ...P.footer.address].forEach(has);
  for (const s of Object.values(S)) { has(s.horizon); has(s.title); if (s.lede) has(s.lede); }
  [S.about.say, ...S.about.text, ...S.network.councilTitles, ...S.network.founder].forEach(has);
  for (const [name, where, role] of [...content.council.coordinating, ...content.council.extended]) { has(name); has(where); if (role) has(role); }
});

test('a named section menu reaches every part of the page', async () => {
  const {html} = await mobileBuild();
  const menu = /<nav class="menu__nav"[\s\S]*?<\/nav>/.exec(html)[0];
  for (const h of ['#top', '#t-act', '#work', '#t-gather', '#t-news', '#about', '#network', '#news', '#gatherings', '#support', '#contact']) assert(menu.includes(`href="${h}"`), 'menu lacks ' + h);
});
