// Pure helpers shared by the build (Node) and the phone page (concatenated into its script, `export` removed).
// Everything here is deterministic and side-effect free, so tests can drive it directly.
export const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
export const CATS = ['act', 'work', 'gather', 'news', 'about'];                  // the categories with a branch (About is the trunk)
export const KIND_TONE = {act: 't6', work: 't5', gather: 't5', news: 't5', about: 't5', group: 't2'};   // his leaf tones per kind
export const TIER_ID = {act: 't-act', work: 'work', gather: 't-gather', news: 't-news', about: 'about', group: 'network'};
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// URL <-> state. ?open=work,news (or all) &q=<member search>  #leaf-<record id> (the original's deep-link form)
export function parseState(search, hash) {
  const p = new URLSearchParams(search || '');
  const raw = (p.get('open') || '').split(',').map(s => s.trim());
  const open = raw.includes('all') ? [...CATS] : CATS.filter(c => raw.includes(c));
  const q = (p.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  const m = /^#leaf-(.+)$/.exec(hash || '');
  return {open, q, leaf: m && ID.test(m[1]) ? m[1] : null};
}
export function stateSearch({open = [], q = ''}) {
  const p = new URLSearchParams();
  const set = CATS.filter(c => open.includes(c));
  if (set.length) p.set('open', set.length === CATS.length ? 'all' : set.join(','));
  const t = String(q).replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  if (t) p.set('q', t);
  const s = p.toString();
  return s ? '?' + s : '';
}
// member search, as the original: case-insensitive substring of the name
export const matches = (titles, q) => { const t = String(q).trim().toLowerCase(); return titles.map((n, i) => [n, i]).filter(([n]) => n.toLowerCase().includes(t)).map(([, i]) => i); };
// nearest spore to a point (squared distance; the first one wins a tie)
export function nearest(points, x, y) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < points.length; i++) { const dx = points[i][0] - x, dy = points[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  return best;
}
// the root from the hub to node i, as one polyline (each node's curve starts at its parent)
export function chain(nodes, curves, i) {
  const segs = [];
  for (let k = i, guard = 0; nodes[k][2] >= 0 && guard < nodes.length; k = nodes[k][2], guard++) segs.unshift(curves[k]);
  const pts = [];
  segs.forEach((c, s) => { for (let j = s ? 2 : 0; j < c.length; j += 2) pts.push([c[j], c[j + 1]]); });
  return pts;
}
// The shared local-picture markup for one photo: AVIF source, WebP img, and the canonical original URL
// marked for the live-photo controller (data-live-photo). Used by the detail sheet and the page hydration.
export function photoPicture(url, pic, alt, {cls, sizes, lazy = false} = {}) {
  return `<picture><source type="image/avif" srcset="${esc(pic.avif)}" sizes="${esc(sizes)}"><img${cls ? ` class="${esc(cls)}"` : ''} src="${esc(pic.src)}" srcset="${esc(pic.webp)}" sizes="${esc(sizes)}" width="${pic.w}" height="${Math.round(pic.w * pic.ratio)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" data-live-photo="${esc(url)}"></picture>`;
}
// The detail sheet for one record: the same fields, order and wording as the original panel (fill()).
export function renderRecord(r, kinds, pics) {
  const tone = KIND_TONE[r.kind] || 't2', mark = `<span class="leafmark ${tone}" aria-hidden="true"></span>`;
  const label = kinds[r.kind], meta = r.meta || r.date, pic = r.img && pics[r.img.src];
  const out = u => /^https?:/.test(u);
  const link = (l, i) => `<a class="btn ${i ? 'btn--quiet' : 'btn--ink'}" href="${esc(l.url)}"${out(l.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}${i ? '' : '<span class="ico" aria-hidden="true"></span>'}</a>`;
  return `<p class="sheet__kind">${mark}${esc(label)}</p><h2 id="sheet-title">${esc(r.title)}</h2>`
    + (meta ? `<p class="sheet__meta">${esc(meta)}</p>` : '')
    + `<div class="sheet__text">`
    + (pic ? `<figure>${photoPicture(r.img.src, pic, r.img.alt, {sizes: '(min-width: 40rem) 20rem, 70vw'})}</figure>` : '')
    + r.body.map(p => `<p>${esc(p)}</p>`).join('')
    + (r.list ? `<ul class="dots">${r.list.map(t => `<li>${mark}<span>${esc(t)}</span></li>`).join('')}</ul>` : '')
    + (r.tiers ? `<ul class="tiers">${r.tiers.map(([n, p]) => `<li><span>${esc(n)}</span><b>${esc(p)} / year</b></li>`).join('')}</ul>` : '')
    + `</div><div class="sheet__links">${(r.links || []).map(link).join('')}</div>`
    + `<p class="sheet__more"><a href="#${TIER_ID[r.kind]}" data-cat="${esc(r.kind)}" data-close>See everything under ${esc(label.toLowerCase())}</a></p>`;
}
