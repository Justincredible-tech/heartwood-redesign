// The phone page, rendered at build time from the original content (mobile/content.mjs) and the art
// coordinates (mobile/art.mjs). Static HTML: every record has a card with a real href, so nothing depends on
// script to be reachable; the script adds the paper detail sheet, the leaf lift, search and the root snap.
import {esc, KIND_TONE, TIER_ID} from './state.mjs';

const at = (attrs) => Object.entries(attrs).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? ' ' + k : ` ${k}="${esc(v)}"`).join('');
const mark = t => `<span class="leafmark ${t}" aria-hidden="true"></span>`;
const ext = url => /^https?:/.test(url) ? ' target="_blank" rel="noopener"' : '';
const primary = r => (r.links && r.links[0] && r.links[0].url) || '#' + TIER_ID[r.kind];
const cap = (tag, text, attrs = {}) => `<${tag}${at({...attrs, 'aria-label': text})}><span class="cap" aria-hidden="true">${esc(text[0])}</span><span aria-hidden="true">${esc(text.slice(1))}</span></${tag}>`;
const horizon = t => `<p class="horizon"><span class="mark" aria-hidden="true"></span>${esc(t)}</p>`;
// a baked piece with its night cut first (only for dark mode), AVIF before WebP, @2x and @3x. Phone rule: art on the first two screens
// (the branches) is eager; art further down is lazy, and app.js fetches and decodes it three screens ahead of a fling.
function picture(art, name, {cls, alt = '', lazy = true}) {
  const a = art[name], d = art[name + '-night'], set = (x, f) => `${x['2x.' + f]} 2x, ${x['3x.' + f]} 3x`;
  const dark = d ? `<source media="(prefers-color-scheme: dark)" type="image/avif" srcset="${set(d, 'avif')}"><source media="(prefers-color-scheme: dark)" type="image/webp" srcset="${set(d, 'webp')}">` : '';
  return `<picture>${dark}<source type="image/avif" srcset="${set(a, 'avif')}"><img class="${cls}" src="${a['2x.webp']}" srcset="${set(a, 'webp')}" width="${a.w}" height="${a.h}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async"></picture>`;
}
export const DARK_LOCK = `if(matchMedia('(prefers-color-scheme: dark)').matches){const m=document.createElement('meta');m.name='darkreader-lock';document.head.append(m)}`;
export const modeLock = theme => theme === 'dark' ? `document.documentElement.dataset.hwTheme='night';{const m=document.createElement('meta');m.name='darkreader-lock';document.head.append(m)}` : theme === 'light' ? `document.documentElement.dataset.hwTheme='day'` : DARK_LOCK;
export function photo(photos, img, {cls, sizes, lazy = true}) {
  const p = photos[img.src];
  if (!p) throw Error('No phone-sized photo for ' + img.src);
  const set = f => Object.entries(p.widths).map(([w, x]) => `${x[f]} ${w}w`).join(', ');
  const [w0] = Object.keys(p.widths);
  return `<picture><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}"><img class="${cls}" src="${p.widths[w0].webp}" srcset="${set('webp')}" sizes="${sizes}" width="${w0}" height="${Math.round(w0 * p.ratio)}" alt="${esc(img.alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async"></picture>`;
}
// a paper card for one record; href is the record's own first destination, so it works without script
function card(r, kinds, {kicker = true, cls = 'card'} = {}) {
  const k = r.meta || r.date;
  return `<li><a class="${cls}" href="${esc(primary(r))}"${ext(primary(r))} data-open="${esc(r.id)}">`
    + (kicker && k ? `<span class="card__kicker">${esc(k)}</span>` : '')
    + `<h3>${esc(r.title)}</h3>` + (r.kind === 'group' ? '' : `<p>${esc(r.sum)}</p>`)
    + `<span class="card__go">${mark('t2')}${esc(r.go || 'Open the leaf')}</span></a></li>`;
}
const count = (records, kind) => records.filter(r => r.kind === kind).length;

export function positionsCss(meta) {   // tag anchors, leaf slots, the flock's film strip: classes, because the page's CSP allows no inline style
  const T = meta.tree, out = [];
  for (const t of meta.tags) {          // the tag's inner end (its punched hole) at the end of its twig; it hangs outwards from there
    const x = t.x / T.w * 100, y = (t.y / T.h * 100).toFixed(2);
    // --reach: tree edge to twig end (the landscape string; the tree is var(--th) tall and T.w/T.h as wide)
    out.push(`.tree .tg-${t.kind}{top:${y}%;${t.side < 0 ? `right:${(100 - x).toFixed(2)}%` : `left:${x.toFixed(2)}%`};--reach:calc(var(--th) * ${t.side < 0 ? t.x : T.w - t.x} / ${T.h})}`);
  }
  for (const side of ['l', 'r']) meta.slots[side].forEach((s, i) => out.push(`.tier--${side} .slot-${i}{left:${(s.x / meta.tier.w * 100).toFixed(2)}%;top:${(s.y / meta.tier.h * 100).toFixed(2)}%;--a:${s.a}deg}`));
  out.push(`.tones{--cell:${meta.leafCell}px}`);
  // the wingbeat layer: the flock's window flies (mobile.css fly), the film strip inside it steps through the baked frames
  const {w, h, frames, loop} = meta.flock;
  out.push(`.crit--sky{width:${w}px;height:${h}px}.crit--wings{width:${w}px;height:${h * frames}px;background-size:${w}px ${h * frames}px;--flap-loop:${loop}s;--flap-frames:${frames}}`);
  return out.join('\n') + '\n';
}

export function renderPage({content, meta, art, photos, css, js, lockHash, icons, fonts = [], theme, themeColor = '#f3eedd'}) {
  const {records, kinds, page, council} = content, S = page.sections;
  const by = kind => records.filter(r => r.kind === kind);
  const byId = Object.fromEntries(records.map(r => [r.id, r]));
  const label = k => k === 'group' ? 'Member groups' : kinds[k].label;
  const browse = ['act', 'work', 'gather', 'news', 'about'];
  const allCount = browse.reduce((n, k) => n + count(records, k), 0);
  const href = k => '#' + TIER_ID[k];

  // ---------------------------------------------------------------- arrival: compact header, one line of purpose, the whole tree
  const tags = meta.tags.filter(t => t.kind !== 'all').map(t => `<a class="tag tg-${t.kind} ${t.side < 0 ? 'tag--l' : 'tag--r'}" href="${href(t.kind)}" data-cat="${t.kind}">${mark(KIND_TONE[t.kind])}<span class="tag__name">${esc(label(t.kind))}</span><small class="tag__n">${count(records, t.kind)}</small></a>`).join('');
  const hero = `<section class="hero" aria-labelledby="hero-h">
<div class="hero__lead">${cap('h1', page.h1, {id: 'hero-h'})}
<div class="hero__cta">${page.cta.map((l, i) => `<a class="btn ${i ? 'btn--quiet' : 'btn--gold'}" href="${esc(l.href)}"${l.open ? ` data-open="${esc(l.open)}"` : ''}${ext(l.href)}>${esc(l.label)}${i ? '' : '<span class="ico" aria-hidden="true"></span>'}</a>`).join('')}</div></div>
<div class="scene"><div class="birds" aria-hidden="true"><i class="crit crit--sky"><i class="crit crit--wings"></i></i></div>
<div class="tree" role="group" aria-labelledby="key-h"><p class="visually-hidden" id="key-h">${esc(page.keyTitle.replace(/:$/, ''))}: the tree's branches</p>
<div class="tags">${tags}<a class="tag tag--all tag--r tg-all" href="${href('act')}" data-cat="all">${mark('t3')}<span class="tag__name">All</span><small class="tag__n">${allCount}</small></a></div></div></div>
</section>`;

  // ---------------------------------------------------------------- the climb: one branch tier per category
  const LEDE = {work: S.work.lede, gather: S.gatherings.lede, act: S.support.lede, news: null};
  const HOR = {act: S.support.horizon, work: S.work.horizon, gather: S.gatherings.horizon, news: S.news.horizon};
  const cats = ['act', 'work', 'gather', 'news'];
  const tier = (k, i) => {
    const side = i % 2 ? 'r' : 'l', list = by(k), t = KIND_TONE[k];
    const leaves = list.slice(0, meta.slots[side].length).map((r, j) => `<button class="leaf slot-${j}${j ? '' : ' leaf--rep'}" type="button" data-peek="${esc(r.id)}" aria-label="Preview: ${esc(r.title)}"><span class="leaf__rest tones ${t}"></span><span class="leaf__up tones ${t}"></span></button>`).join('');
    return `<section class="tier tier--${side}" id="${TIER_ID[k]}" aria-labelledby="h-${k}"><h2 class="visually-hidden" id="h-${k}">${esc(label(k))}</h2>
<div class="tier__art">${picture(art, 'tier-' + side, {cls: 'tier__img', lazy: false})}${leaves}${i ? '' : '<div class="bees" aria-hidden="true"><i class="crit crit--bee"></i><i class="crit crit--flies"></i></div>'}<p class="slip" role="status" aria-live="polite"></p></div>
<details class="tier__open" data-cat="${k}"><summary class="tag tag--tier" id="tag-${k}">${mark(t)}<span class="tag__name">${esc(label(k))}</span><small class="tag__n">${list.length}</small><span class="tag__hint" aria-hidden="true"></span></summary>
<div class="tier__body"><p class="tier__bar"><span>${esc(HOR[k])}</span><a href="${href('act')}" data-cat="all" class="tier__all">All</a></p>${LEDE[k] ? `<p class="tier__lede">${esc(LEDE[k])}</p>` : ''}
<ul class="cards">${list.map(r => card(r, kinds)).join('')}</ul></div></details>
</section>`;
  };
  const climb = `<div class="climb">${cats.map(tier).join('\n')}</div>`;

  // ---------------------------------------------------------------- the trunk: About
  const trunk = `<section class="trunk" id="about" aria-labelledby="about-h"><div class="bark">${horizon(S.about.horizon)}${cap('h2', S.about.title, {id: 'about-h'})}
<p class="about__say">${esc(S.about.say)}</p>${S.about.text.map(p => `<p class="about__text">${esc(p)}</p>`).join('')}
<div class="more">${S.about.more.map((l, i) => `<a class="btn ${i ? 'btn--quiet' : ''}" href="${esc(l.href)}"${ext(l.href)} data-open="${esc(l.open)}">${esc(l.label)}${i ? '' : '<span class="ico" aria-hidden="true"></span>'}</a>`).join('')}</div>
<details class="tier__open" data-cat="about"><summary class="tag tag--tier" id="tag-about">${mark('t5')}<span class="tag__name">${esc(label('about'))}</span><small class="tag__n">${count(records, 'about')}</small><span class="tag__hint" aria-hidden="true"></span></summary>
<div class="tier__body"><ul class="cards">${by('about').map(r => card(r, kinds)).join('')}</ul></div></details></div></section>`;

  // ---------------------------------------------------------------- the roots: search first, the roots as companion
  const groups = by('group');
  const person = ([name, where, role]) => `<li>${esc(name)}${role ? ', ' + esc(role) : ''}<span>${esc(where)}</span></li>`;
  const roots = `<section class="roots" id="network" aria-labelledby="network-h"><div class="bugs" aria-hidden="true"><i class="crit crit--walk"></i></div><div class="roots__head">${horizon(S.network.horizon)}${cap('h2', S.network.title, {id: 'network-h'})}<p class="lede">${esc(S.network.lede)}</p></div>
<div class="finder" role="search"><label class="visually-hidden" for="group-find">${esc(S.network.findLabel)}</label><input id="group-find" type="search" placeholder="${esc(S.network.findPlaceholder)}" autocomplete="off" enterkeyhint="search" aria-controls="groups">
<output id="group-tally" for="group-find" aria-live="polite">${groups.length} member groups</output></div>
<ul class="groups" id="groups">${groups.map((g, i) => `<li${i >= 8 ? ' class="more-row"' : ''}><a href="${esc(g.url || '#network')}"${g.url ? ext(g.url) : ''} data-open="${esc(g.id)}" data-i="${i}">${esc(g.title)}</a></li>`).join('')}</ul>
<p class="groups__none" hidden>No member group matches. <button type="button" class="linkish" data-clear>Clear the search</button></p>
<button class="btn groups__all" type="button" aria-controls="groups" aria-expanded="false">Show all ${groups.length}</button>
<figure class="net" aria-labelledby="net-cap"><figcaption id="net-cap" class="net__cap">Every member group is a spore on the roots. Tap near one to find it.</figcaption>
<div class="net__stage">${picture(art, 'roots', {cls: 'net__img'})}<svg class="net__path" viewBox="0 0 ${meta.roots.w} ${meta.roots.h}" aria-hidden="true" focusable="false"><path d=""/><circle r="10" cx="-20" cy="-20"/></svg>
<div class="net__pin" role="status" aria-live="polite" hidden><span class="net__kicker">Member group <span class="net__n"></span> of ${groups.length}</span><b class="net__name"></b><button class="btn btn--gold net__open" type="button">Open</button></div></div></figure>
<div class="council"><div><h3>${esc(S.network.councilTitles[0])}</h3><ul>${council.coordinating.map(person).join('')}</ul></div>
<div><h3>${esc(S.network.councilTitles[1])}</h3><ul>${council.extended.map(person).join('')}</ul><h3>${esc(S.network.councilTitles[2])}</h3><ul>${person(S.network.founder)}</ul></div></div></section>`;

  // ---------------------------------------------------------------- soil strata: newsletter, gatherings, support, footer
  const [issue, ...restNews] = by('news');
  const back = restNews.filter(n => n.backIssue);
  const link = (l, i) => `<a class="btn ${i ? 'btn--quiet' : 'btn--ink'}" href="${esc(l.url)}"${ext(l.url)}>${esc(l.label)}${i ? '' : '<span class="ico" aria-hidden="true"></span>'}</a>`;
  const news = `<section class="stratum stratum--clay" id="news" aria-labelledby="news-h"><div class="stratum__in">${horizon(S.news.horizon)}${cap('h2', S.news.title, {id: 'news-h'})}
<article class="issue card"><a class="issue__cover" href="${esc(issue.links[0].url)}"${ext(issue.links[0].url)} data-open="${esc(issue.id)}">${photo(photos, issue.img, {cls: 'issue__img', sizes: '7.5rem'})}</a>
<div class="issue__text"><span class="card__kicker">Heartbeat · ${esc(issue.date)}</span><h3>${esc(issue.title)}</h3><p>${esc(issue.sum)}</p></div>
<div class="issue__links">${issue.links.map(link).join('')}</div>
<ul class="issue__back" aria-label="Back issues">${back.map(b => `<li><a href="${esc(b.links[0].url)}"${ext(b.links[0].url)} data-open="${esc(b.id)}">${esc(b.date)}</a></li>`).join('')}</ul></article>
<div class="more">${S.news.more.map(l => `<a class="btn" href="${esc(l.href)}"${ext(l.href)}>${esc(l.label)}<span class="ico" aria-hidden="true"></span></a>`).join('')}<a class="btn btn--quiet" href="#${TIER_ID.news}" data-cat="news">Posts and the podcast</a></div></div></section>`;
  const gatherings = `<section class="stratum stratum--sand" id="gatherings" aria-labelledby="gather-h"><div class="stratum__in">${horizon(S.gatherings.horizon)}${cap('h2', S.gatherings.title, {id: 'gather-h'})}<p class="lede">${esc(S.gatherings.lede)}</p>
<ul class="gatherings">${by('gather').map((it, i) => `<li><a class="card gathering" href="${esc(primary(it))}"${ext(primary(it))} data-open="${esc(it.id)}"><span class="season season--${i ? 'fall' : 'spring'}">${i ? 'Fall' : 'Spring'}</span><h3>${esc(it.title)}</h3><p class="when">${esc(it.meta)}</p><p>${esc(it.sum)}</p><span class="card__go">${mark('t2')}${esc(it.go)}</span></a></li>`).join('')}</ul></div></section>`;
  const acts = by('act');
  const supportCards = acts.map((it, i) => `<li${i ? '' : ' class="span2"'}><a class="card${i ? '' : ' card--gold'}" href="${esc(primary(it))}"${ext(primary(it))} data-open="${esc(it.id)}"><h3>${esc(it.title)}</h3><p>${esc(it.sum)}</p>`
    + (it.tiers ? `<ul class="tiers">${it.tiers.slice(0, 3).map(([n, p]) => `<li><span>${esc(n)}</span><b>${esc(p)}</b></li>`).join('')}</ul>` : '')
    + (!i && it.list ? `<ul class="tiers">${it.list.map(t => `<li><span>${esc(t)}</span></li>`).join('')}</ul>` : '')
    + `<span class="card__go">${mark('t2')}${esc(it.go)}</span></a></li>`).join('');
  const F = page.footer;
  const footer = `<footer class="foot" id="contact"><a class="brand" href="#top" aria-label="Heartwood, back to the top"><span class="brand__logo"></span></a><p class="foot__say">${esc(F.say)}</p>
<address>${esc(F.address[0])}<br>${F.addressLinks.map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</address>
${F.navs.map(n => `<nav aria-label="${esc(n.label)}"><h3>${esc(n.title)}</h3><ul>${n.links.map(l => `<li><a href="${esc(l.href)}"${l.open ? ` data-open="${esc(l.open)}"` : ''}${ext(l.href)}>${esc(l.label)}</a></li>`).join('')}</ul></nav>`).join('')}</footer>`;
  const support = `<section class="stratum stratum--bedrock" id="support" aria-labelledby="support-h"><div class="stratum__in">${horizon(S.support.horizon)}${cap('h2', S.support.title, {id: 'support-h'})}<p class="lede">${esc(S.support.lede)}</p>
<ul class="cards support">${supportCards}</ul>${footer}</div></section>`;

  // ---------------------------------------------------------------- header and the named section menu
  const menu = [['Up the tree', [['The tree', '#top'], ...cats.map(k => [label(k), href(k)])]],
    ['Trunk and roots', [['About', '#about'], ['Network', '#network']]],
    ['In the soil', [['Heartbeat', '#news'], ['Events', '#gatherings'], ['Support', '#support'], ['Contact', '#contact']]]];
  const donate = page.nav.find(l => l.open === 'donate');
  const header = `<header class="top" id="top"><a class="brand" href="#top" aria-label="Heartwood, home"><span class="brand__logo"></span></a>
<a class="btn btn--gold top__donate" href="${esc(donate.href)}"${ext(donate.href)} data-open="donate">${esc(donate.label)}</a>
<details class="menu"><summary class="menu__btn">Menu</summary><nav class="menu__nav" aria-label="Sections">${menu.map(([h, ls]) => `<p class="menu__h">${esc(h)}</p><ul>${ls.map(([t, u]) => `<li><a href="${u}">${esc(t)}</a></li>`).join('')}</ul>`).join('')}</nav></details></header>`;

  const data = JSON.stringify(recordData(content, photos)).replace(/</g, '\\u003c');
  const net = JSON.stringify(netData(meta)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; script-src 'self' '${lockHash}'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<script>${modeLock(theme)}</script>
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="theme-color" content="${themeColor}">
<meta name="color-scheme" content="light dark">
${icons.map(icon => `<link rel="${esc(icon.rel)}" href="${esc(icon.href)}"${icon.type ? ` type="${esc(icon.type)}"` : ''}${icon.sizes ? ` sizes="${esc(icon.sizes)}"` : ''}>`).join('\n')}
${fonts.map(f => `<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>\n`).join('')}<link rel="stylesheet" href="${css}">
<script defer src="${js}"></script>
</head>
<body>
<a class="skip" href="${esc(page.skip.href)}">${esc(page.skip.label)}</a>
${header}
<main>
<div class="sky">${hero}
${climb}
${trunk}</div>
${roots}
<div class="strata">${news}
${gatherings}
${support}</div>
</main>
<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden><div class="sheet__paper"><div class="sheet__bar"><button class="sheet__back" type="button">Back</button><button class="sheet__close" type="button" aria-label="Close">×</button></div><article class="sheet__body" id="sheet-body" tabindex="-1"></article></div></div>
<script type="application/json" id="hw-records">${data}</script>
<script type="application/json" id="hw-net">${net}</script>
</body>
</html>
`;
}
// the root network, compact: nodes [x, y, parent] and each node's curve; spores are node indices in member order
export function netData(meta) {
  const {w, h, nodes, curves, spores} = meta.roots;
  return {w, h, nodes, curves, spores};
}
// what the detail sheet needs: every record field the original panel shows, and phone-sized photo sources
export function recordData(content, photos) {
  const keep = ['id', 'kind', 'title', 'sum', 'meta', 'date', 'body', 'list', 'tiers', 'links', 'img', 'go', 'url'];
  const records = content.records.map(r => Object.fromEntries(keep.filter(k => r[k] != null).map(k => [k, r[k]])));
  const pics = Object.fromEntries(Object.entries(photos).map(([url, p]) => [url, {ratio: p.ratio,
    avif: Object.entries(p.widths).map(([w, x]) => `${x.avif} ${w}w`).join(', '), webp: Object.entries(p.widths).map(([w, x]) => `${x.webp} ${w}w`).join(', '),
    src: Object.values(p.widths)[0].webp, w: +Object.keys(p.widths)[0]}]));
  const kinds = Object.fromEntries(Object.entries(content.kinds).map(([k, v]) => [k, v.label]));
  return {records, kinds, pics};
}
