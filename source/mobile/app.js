// The phone page's behaviour. Concatenated after state.mjs inside one IIFE by tools/build-mobile.mjs.
// Rules kept here: every listener is delegated or passive, nothing runs per scroll frame, hidden pages hold every loop,
// and the page is complete without this file (cards are real links, branches are <details>).
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const calm = reducedMotion.matches;                // explicit reduced motion only; SaveData is a network preference (the roots prefetch below)
let DATA = null;                                   // the records, parsed on first need
const data = () => DATA || (DATA = (() => { const d = JSON.parse($('#hw-records').textContent); d.byId = new Map(d.records.map(r => [r.id, r])); return d; })());
root.classList.add('js');
document.addEventListener('touchstart', () => {}, {passive: true});   // lets iOS show :active on a tap, for 1-frame feedback

// ------------------------------------------------------------------ branches (details) and the URL
const branches = $$('details.tier__open');
const branchOf = k => branches.find(d => d.dataset.cat === k);
let syncing = false;
function writeUrl() {
  const open = branches.filter(d => d.open).map(d => d.dataset.cat);
  const params = new URLSearchParams(stateSearch({open, q: find.value})), theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'light' || theme === 'dark') params.set('theme', theme);
  const query = params.toString();               // params.size needs Chrome 113+/FF 112+/Safari 17; toString() is supported everywhere and yields the same string
  const url = location.pathname + (query ? '?' + query : '') + location.hash;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);
}
branches.forEach(d => d.addEventListener('toggle', () => { if (!syncing) writeUrl(); }));
function openCats(list) { syncing = true; list.forEach(k => { const d = branchOf(k); if (d) d.open = true; }); syncing = false; writeUrl(); }

// ------------------------------------------------------------------ taps: categories, records, leaves, menu
let opener = null;
addEventListener('click', e => {                 // window, capture: a record card is ours before anything else sees the click
  const t = e.target;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const menuLink = t.closest('.menu__nav a');
  if (menuLink) $('.menu').open = false;
  const cat = t.closest('a[data-cat]');      // links only: a branch's own <details> also carries data-cat
  if (cat && !t.closest('#sheet')) {
    const k = cat.dataset.cat;
    cat.classList.add('is-picked'); setTimeout(() => cat.classList.remove('is-picked'), 300);
    if (k !== 'group') openCats(k === 'all' ? CATS : [k]);
    return;                                        // the link's own #anchor does the moving: immediate, native, Back-able
  }
  const leaf = t.closest('.leaf');
  if (leaf) { peek(leaf); return; }
  const open = t.closest('[data-open]');
  if (open && open.closest('#groups')) select(+open.dataset.i, false);
  if (open) { e.preventDefault(); e.stopPropagation(); show(open.dataset.open, true, open); return; }
  const m = $('.menu'); if (m.open && !t.closest('.menu')) m.open = false;
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!sheet.hidden) close(); else $('.menu').open = false; } });

// a leaf is an optional preview: first tap lifts it and names its record, a second tap opens it
function peek(leaf) {
  const art = leaf.closest('.tier__art'), slip = $('.slip', art), id = leaf.dataset.peek;
  if (leaf.classList.contains('is-up')) { show(id, true, leaf); return; }
  $$('.leaf.is-up', art).forEach(l => l.classList.remove('is-up'));
  leaf.classList.add('is-up');
  const r = data().byId.get(id);
  slip.innerHTML = `<b>${esc(r.title)}</b> ${esc(r.sum)} <button class="linkish" type="button" data-open="${esc(id)}">Open</button>`;
}

// ------------------------------------------------------------------ the detail sheet (a route: #leaf-<id>)
const sheet = $('#sheet'), body = $('#sheet-body'), main = $('main');
let pushed = false, pending = null, hideTimer = 0, backPending = false, nextOpen = null;
const leafState = id => { const base = history.state && typeof history.state === 'object' ? {...history.state} : {}; if (id === null) delete base.hwLeaf; else base.hwLeaf = id; return Object.keys(base).length ? base : null; };   // only the owned hwLeaf key is set or cleared; foreign state data is preserved; an empty result stays null
function show(id, push, from) {
  const d = data(), r = d.byId.get(id);
  if (!r) return false;
  clearTimeout(hideTimer);
  body.innerHTML = renderRecord(r, d.kinds, d.pics);
  if (!sheet.classList.contains('is-open')) opener = from || document.activeElement;
  if (sheet.hidden) { sheet.hidden = false; void sheet.offsetWidth; }       // one style flush so the paper unfolds from its start
  main.inert = true; $('.top').inert = true;
  const skip = $('.skip'); if (skip) skip.inert = true;      // the skip link is a body child; keep it out of the open modal's reach
  sheet.classList.add('is-open');
  sheet.querySelector('.sheet__paper').scrollTop = 0;
  body.focus({preventScroll: true});
  if (push) {
    const url = location.pathname + location.search + '#leaf-' + id;
    if (backPending) {                 // keep new paper responsive while the previous Back is in flight
      nextOpen = {id, url}; history.replaceState(leafState(id), '', url);
    } else history.pushState(leafState(id), '', url);
    pushed = true;
  }
  livePhotos.watch(body);                     // the sheet body just received the figure; known images are skipped
  return true;
}
function hide() {
  if (sheet.hidden || !sheet.classList.contains('is-open')) return;
  sheet.classList.remove('is-open'); main.inert = false; $('.top').inert = false;
  const skip = $('.skip'); if (skip) skip.inert = false;
  hideTimer = setTimeout(() => { sheet.hidden = true; body.textContent = ''; }, calm ? 0 : 280);
  if (opener && opener.isConnected) opener.focus({preventScroll: true});
  opener = null;
}
function close() {
  if (sheet.hidden || !sheet.classList.contains('is-open')) return;
  hide();                                                       // start the tuck immediately; popstate may arrive later
  if (backPending) { nextOpen = null; pushed = false; history.replaceState(leafState(null), '', location.pathname + location.search); return; }   // clear only the owned marker; foreign fields survive; empty results stay null
  if (pushed) { pushed = false; backPending = true; history.back(); return; } // Forward still reopens the same record
  history.replaceState(leafState(null), '', location.pathname + location.search);
}
sheet.addEventListener('click', e => {
  if (e.target.closest('.sheet__back, .sheet__close') || e.target === sheet) { close(); return; }
  const more = e.target.closest('[data-close]');
  if (more) { e.preventDefault(); pending = more.getAttribute('href'); openCats(CATS.includes(more.dataset.cat) ? [more.dataset.cat] : []); const returning = pushed && !backPending; close(); if (!returning) jump(); }   // when no Back is dispatched, this handler must move the tree itself
});
function jump() { if (!pending) return; const el = document.querySelector(pending); pending = null; if (el) el.scrollIntoView({block: 'start'}); }
addEventListener('popstate', () => {
  const next = nextOpen; backPending = false; nextOpen = null;
  if (next && sheet.classList.contains('is-open')) {
    // The new record is already rendered and focused. Commit it after traversal;
    // do not render twice or let the old popstate tuck away the new paper.
    history.pushState(leafState(next.id), '', next.url); pushed = true; jump(); return;
  }
  const s = parseState(location.search, location.hash);
  if (s.leaf) { pushed = !!(history.state && history.state.hwLeaf); show(s.leaf, false); } else { pushed = false; hide(); }
  jump();
});

// ------------------------------------------------------------------ member search (results first) and the roots
const find = $('#group-find'), list = $('#groups'), rows = $$('li', list), tally = $('#group-tally'), none = $('.groups__none'), all = $('.groups__all');
const names = rows.map(li => li.textContent);
let urlTimer = 0;
function filter() {
  const q = find.value.trim(), hit = new Set(matches(names, q));
  rows.forEach((li, i) => { li.hidden = !hit.has(i); });
  list.classList.toggle('is-searching', !!q);
  tally.textContent = hit.size === names.length ? names.length + ' member groups' : hit.size + ' of ' + names.length + ' member groups';
  none.hidden = hit.size > 0; all.hidden = !!q || list.classList.contains('is-all');
  clearTimeout(urlTimer); urlTimer = setTimeout(writeUrl, 250);
}
find.addEventListener('input', filter);
find.addEventListener('focus', () => {                              // keep the results above the on-screen keyboard
  const top = find.getBoundingClientRect().top, head = $('.top').offsetHeight;
  if (top > innerHeight * .3 || top < head) scrollTo(0, scrollY + top - head - 12);
});
find.addEventListener('keydown', e => { if (e.key === 'Enter') find.blur(); });
none.addEventListener('click', e => { if (e.target.closest('[data-clear]')) { find.value = ''; filter(); find.focus(); } });
all.addEventListener('click', () => { list.classList.add('is-all'); all.hidden = true; all.setAttribute('aria-expanded', 'true'); rows[8] && $('a', rows[8]).focus(); });

const NET = JSON.parse($('#hw-net').textContent);
const stage = $('.net__stage'), pathEl = $('.net__path path'), dot = $('.net__path circle'), pin = $('.net__pin');
let picked = -1;
function select(i, showPin = true) {
  if (!(i >= 0 && i < NET.spores.length)) return;
  picked = i;
  const n = NET.spores[i], pts = chain(NET.nodes, NET.curves, n);
  pathEl.setAttribute('d', 'M' + pts.map(p => p[0] + ' ' + p[1]).join('L'));
  dot.setAttribute('cx', NET.nodes[n][0]); dot.setAttribute('cy', NET.nodes[n][1]);
  stage.classList.add('is-picked');
  rows.forEach((li, k) => li.classList.toggle('is-sel', k === i));
  if (showPin) {
    $('.net__n', pin).textContent = i + 1; $('.net__name', pin).textContent = names[i];
    pin.hidden = false; pin.classList.toggle('is-low', NET.nodes[n][1] > NET.h * .62);
  }
}
$('.net__open').addEventListener('click', e => { if (picked >= 0) show($('a', rows[picked]).dataset.open, true, e.currentTarget); });
let down = null;                                                     // a tap (not a swipe) near the roots snaps to the nearest member
stage.addEventListener('pointerdown', e => { if (e.isPrimary && !e.target.closest('.net__pin')) down = {x: e.clientX, y: e.clientY, t: e.timeStamp}; }, {passive: true});
stage.addEventListener('pointercancel', () => { down = null; }, {passive: true});
stage.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || e.timeStamp - down.t > 600) { down = null; return; }
  down = null;
  const b = $('.net__img').getBoundingClientRect(), x = (e.clientX - b.left) / b.width * NET.w, y = (e.clientY - b.top) / b.height * NET.h;
  if (x < 0 || y < 0 || x > NET.w || y > NET.h) return;
  select(nearest(NET.spores.map(n => NET.nodes[n]), x, y));
}, {passive: true});

// ------------------------------------------------------------------ the hero tags hang in the margins beside their branches. If one would
// run off the screen or touch another (big text, a narrow phone), they become a list instead: a tag is never slid onto the leaves.
const tree = $('.tree'), tags = $$('.tree .tag');
function fitTags() {
  tree.classList.remove('is-flow');
  const vw = root.clientWidth, edge = 4, r = tags.map(t => t.getBoundingClientRect());
  tree.classList.toggle('is-flow', r.some((a, i) => a.left < edge || a.right > vw - edge || r.some((b, j) => j > i && a.left < b.right + 2 && b.left < a.right + 2 && a.top < b.bottom + 2 && b.top < a.bottom + 2)));
}

// ------------------------------------------------------------------ rotation / resize: stay at the same place in the same section
let mark = null, markTimer = 0, lastW = root.clientWidth;
function remember() {          // the card, row or section under the header, and how far into it we are
  const head = $('.top').offsetHeight, pick = y => { const h = document.elementFromPoint(root.clientWidth / 2, head + y); return h && h.closest('li, .tier__art, .bark, .issue, .finder, .net, .council, .foot, section'); };
  let el = null;
  for (const y of [10, 24, 44, 72, 110]) { el = pick(y); if (el && el.tagName !== 'SECTION' && el.getBoundingClientRect().bottom > head + 40) break; }   // the card or row being read, not the sliver of the one before it
  mark = el ? {el, dy: el.getBoundingClientRect().top - head} : null;
}
addEventListener('scroll', () => { clearTimeout(markTimer); markTimer = setTimeout(remember, 120); }, {passive: true});
addEventListener('resize', () => {
  if (root.clientWidth === lastW) return;              // the keyboard or the Safari toolbar changed only the height
  lastW = root.clientWidth; fitTags();
  if (mark && mark.el.isConnected && scrollY > 0) {        // again after the next frames, once text and images have re-flowed
    const m = mark, put = () => scrollTo(0, scrollY + m.el.getBoundingClientRect().top - $('.top').offsetHeight - m.dy);
    put(); requestAnimationFrame(() => { put(); requestAnimationFrame(put); });
  }
});

// ------------------------------------------------------------------ ambient motion: runs while focused, visible and on screen — each group still pauses offscreen.
// The authored scene keeps its loops for as long as a person watches; blur, hidden pages and locks hold them.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(en => en.target.classList.toggle('on', en.isIntersecting)));
  $$('.birds, .bees, .bugs').forEach(el => io.observe(el));
}
const focused = () => typeof document.hasFocus === 'function' ? document.hasFocus() : !document.hidden;   // reasonable support
const syncMotion = () => root.classList.toggle('is-live', !reducedMotion.matches && !document.hidden && focused());
reducedMotion.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);
addEventListener('focus', syncMotion);
addEventListener('blur', () => root.classList.remove('is-live'));
addEventListener('pagehide', () => root.classList.remove('is-live'));
addEventListener('pageshow', syncMotion);
syncMotion();

// ------------------------------------------------------------------ live photos: the no-script markup carries the original-source
// photo; the local picture is built here (JS-only, so the two are never visible together) and the shared controller
// refreshes it in place — once for the static page, and again whenever the detail sheet is inserted.
const livePhotos = HeartwoodPhotos.create();
$$('[data-photo-url]').forEach(slot => {
  const pic = (data().pics || {})[slot.dataset.photoUrl];
  if (!pic) return;
  slot.innerHTML = photoPicture(slot.dataset.photoUrl, pic, slot.dataset.photoAlt, {cls: slot.dataset.photoCls, sizes: slot.dataset.photoSizes, lazy: slot.dataset.photoEager === undefined});
});
livePhotos.watch(document);

// ------------------------------------------------------------------ art ahead of a fling: a phone's own lazy-load margin is about a screen, which a
// fling crosses in a tenth of a second. Lazy art is fetched three screens ahead and every picture is decoded before it scrolls in.
if ('IntersectionObserver' in window) {
  const ahead = new IntersectionObserver(es => es.forEach(en => { if (!en.isIntersecting) return; const i = en.target; ahead.unobserve(i); i.loading = 'eager'; i.decode().catch(() => {}); }), {rootMargin: '300% 0px'});
  $$('picture img').forEach(i => ahead.observe(i));
}
// the roots are the one big piece far down (a fling from the top reaches them in a third of a second): fetched once the page has loaded and
// gone quiet, unless the visitor asked to save data. Photos stay on demand.
const early = () => setTimeout(() => { const r = $('.net__img'); if (r && r.loading === 'lazy') { r.loading = 'eager'; r.decode().catch(() => {}); } }, 1200);
if (!(navigator.connection && navigator.connection.saveData)) { if (document.readyState === 'complete') early(); else addEventListener('load', early, {once: true}); }

// ------------------------------------------------------------------ arrive: restore what the URL says
const start = parseState(location.search, location.hash);
if (start.open.length) { syncing = true; start.open.forEach(k => { const d = branchOf(k); if (d) d.open = true; }); syncing = false; }
if (start.q) { find.value = start.q; filter(); }
if (start.leaf && !show(start.leaf, false)) history.replaceState(leafState(null), '', location.pathname + location.search);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTags); else fitTags();
if ('ResizeObserver' in window) { let w = 0; new ResizeObserver(([e]) => { const h = Math.round(e.contentRect.height); if (h !== w) fitTags(); w = h; }).observe($('.hero h1')); }   // include the first delivered layout: text may change before that callback
addEventListener('pageshow', e => { if (e.persisted) fitTags(); });
