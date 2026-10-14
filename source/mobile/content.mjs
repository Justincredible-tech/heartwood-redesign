// Reads the buddy's readable fork markup plus its explicitly supplied content JS.
// The legacy inline reader remains available only for archive comparison callers.
// Returns everything the phone build shows:
// every record exactly as the original content model builds it, and the static words/links of the page.
// The model and its item mapping are the ORIGINAL code, run in a VM (like tools/prerender-content.mjs);
// static text is read from the markup with fail-closed patterns, so a changed capture stops the build.
import assert from 'node:assert/strict';
import vm from 'node:vm';

const scripts = html => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
const once = (src, marker) => { const i = src.indexOf(marker); assert(i !== -1 && i === src.lastIndexOf(marker), 'Expected one boundary: ' + marker); return i; };
const between = (src, a, b) => src.slice(once(src, a), once(src, b));
const decode = s => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
  : ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '})[e.toLowerCase()]);
const text = html => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
function one(src, re, what) { const m = [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))]; assert.equal(m.length, 1, 'Expected exactly one ' + what); return m[0]; }
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({
  href: decode(/\bhref="([^"]*)"/.exec(m[1])[1]), open: /\bdata-open="([^"]*)"/.exec(m[1])?.[1] || null, label: text(m[2]),
}));

export function readContent(html, {scriptSource} = {}) {
  const allScripts = scripts(html);
  const s = scriptSource === undefined ? allScripts : allScripts.filter(m => /\bsrc="js\/heartwood-site\.js"/.test(m[0]));
  let code;
  if (scriptSource === undefined) {
    assert.equal(s.length, 2, 'Expected the original two inline scripts');
    code = s[1][1];
  } else {
    assert.equal(typeof scriptSource, 'string', 'External content script must be source text');
    assert.equal(s.length, 1, 'Expected the upstream single external script');
    assert.equal(s[0][1].trim(), '', 'External source markup must not mix inline script');
    assert(/\bsrc="js\/heartwood-site\.js"/.test(s[0][0]), 'Expected the upstream readable JS link');
    // The upstream concatenation starts with the DOM-dependent leaf-lift IIFE.
    // Only its content model and item mapper may execute in this isolated VM.
    code = scriptSource.slice(once(scriptSource, "const ORIGIN = 'https://heartwood.org';"));
  }
  const model = code.slice(0, once(code, '\n(() => {') + 1);
  const itemsChunk = between(code, '  const items = new Map();', '  /* ------------------------------------------------------ leaves <- items */');
  const ctx = vm.createContext({out: null}, {codeGeneration: {strings: false, wasm: false}});
  new vm.Script(model + itemsChunk + '\nout = {records: [...items.values()], kinds: KINDS, site: SITE};', {filename: 'original-content-model.js'}).runInContext(ctx, {timeout: 2000});
  const {records, kinds, site} = JSON.parse(JSON.stringify(ctx.out));
  for (const r of records) delete r.note;            // maintainer remarks, never shown on the page

  const markup = html.slice(0, s[0].index);
  // ---- why the chip says 105 and the list 106: the original seats items on leaves by paper tone; groups take the
  // deep-tone leaves left after the features that spilled off the bright ones. Count it the same way.
  const leafTones = [...markup.matchAll(/<button\b[^>]*\bclass="([^"]*\bleaf\b[^"]*)"/g)].map(m => (m[1].match(/\bt(\d)\b/) || [, '5'])[1]);
  const bright = leafTones.filter(t => t === '5').length, deep = leafTones.filter(t => !/[56]/.test(t)).length;
  const features = records.filter(r => ['work', 'gather', 'news', 'about'].includes(r.kind)).length;
  const groups = records.filter(r => r.kind === 'group').length;
  const groupLeaves = Math.max(0, Math.min(groups, deep - Math.max(0, features - bright)));

  // ---- static page words and links
  const section = id => one(markup, new RegExp(`<section class="layer" id="${id}"[\\s\\S]*?</section>`), 'section ' + id)[0];
  const head = sec => ({
    horizon: text(one(sec, /<p class="horizon">([\s\S]*?)<\/p>/, 'horizon')[1]),
    title: text(one(sec, /<h2 id="[^"]+">([\s\S]*?)<\/h2>/, 'h2')[1]),
    lede: (sec.match(/<p class="lede">([\s\S]*?)<\/p>/) || [])[1] ? text(sec.match(/<p class="lede">([\s\S]*?)<\/p>/)[1]) : null,
  });
  const ids = ['about', 'work', 'gatherings', 'news', 'network', 'support'];
  const sections = Object.fromEntries(ids.map(id => [id, head(section(id))]));
  const about = section('about');
  sections.about.say = text(one(about, /<p class="about__say">([\s\S]*?)<\/p>/, 'about say')[1]);
  sections.about.text = [...one(about, /<div class="about__text"[^>]*>([\s\S]*?)<\/div>/, 'about text')[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => text(m[1]));
  sections.about.more = links(one(about, /<div class="more">([\s\S]*?)<\/div>/, 'about more')[1]);
  sections.news.more = links(one(section('news'), /<div class="more">([\s\S]*?)<\/div>/, 'news more')[1]);
  const net = section('network');
  sections.network.findLabel = text(one(net, /<label[^>]*for="group-find">([\s\S]*?)<\/label>/, 'finder label')[1]);
  sections.network.findPlaceholder = one(net, /<input id="group-find"[^>]*placeholder="([^"]*)"/, 'finder')[1];
  const founder = one(net, /<h3[^>]*>Founder<\/h3><ul><li>([^<]*)<span>([^<]*)<\/span><\/li><\/ul>/, 'founder');
  sections.network.councilTitles = [...net.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(m => text(m[1]));
  sections.network.founder = [decode(founder[1]), decode(founder[2])];

  const header = one(markup, /<header class="top"[\s\S]*?<\/header>/, 'header')[0];
  const nav = links(one(header, /<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/, 'nav')[1]);
  const hero = one(markup, /<div class="hero__lead">([\s\S]*?)<div class="key"/, 'hero')[1];
  const skip = links(one(markup, /<a class="skip"[^>]*>[\s\S]*?<\/a>/, 'skip link')[0])[0];
  const foot = one(markup, /<footer class="foot">([\s\S]*?)<\/footer>/, 'footer')[1];
  const footer = {
    say: text(one(foot, /<p class="foot__say">([\s\S]*?)<\/p>/, 'footer say')[1]),
    address: one(foot, /<address>([\s\S]*?)<\/address>/, 'address')[1].split(/<br\s*\/?>/).map(text),
    addressLinks: links(one(foot, /<address>([\s\S]*?)<\/address>/, 'address')[1]),
    navs: [...foot.matchAll(/<nav aria-label="([^"]*)"><h3>([^<]*)<\/h3><ul>([\s\S]*?)<\/ul><\/nav>/g)].map(m => ({label: m[1], title: m[2], links: links(m[3])})),
  };
  assert.equal(footer.navs.length, 3, 'Expected three footer navs');
  const page = {
    title: text(one(html, /<title>([\s\S]*?)<\/title>/, 'title')[1]),
    description: decode(one(html, /<meta name="description" content="([^"]*)"/, 'description')[1]),
    h1: text(one(hero, /<h1>([\s\S]*?)<\/h1>/, 'h1')[1]),
    cta: links(one(hero, /<div class="hero__cta">([\s\S]*?)<\/div>/, 'hero cta')[1]),
    keyTitle: text(one(markup, /<p class="key__title"[^>]*>([\s\S]*?)<\/p>/, 'key title')[1]),
    nav, skip, footer, sections,
    logo: one(markup, /<symbol id="hw-logo"[\s\S]*?<\/symbol>/, 'logo')[0],
    mark: one(markup, /<symbol id="hw-mark"[\s\S]*?<\/symbol>/, 'mark')[0],
  };
  // every destination the original page itself names (outside the records), for the completeness tests
  const pageLinks = [...nav, ...page.cta, skip, ...sections.about.more, ...sections.news.more, ...footer.addressLinks, ...footer.navs.flatMap(n => n.links)];
  return {records, kinds, council: site.council, snapshot: site.snapshot, page, pageLinks,
    counts: {records: records.length, groups, groupLeaves, leaves: leafTones.length, brightLeaves: bright, deepLeaves: deep, features}};
}
