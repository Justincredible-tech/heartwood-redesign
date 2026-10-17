// Phone live-photo integration (codex-040): the static cover ships the authoritative original inside
// <noscript> with identical alt/dimensions; the local picture is built by the bundle (JS-only, so the two are
// never visible together); the detail sheet marks its canonical original URL; the CSP widens to exactly
// https://heartwood.org; the shared controller ships in the bundle ahead of the page script.
// Runs a private canonical phone build into a fresh temp dir (never publish/).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderRecord} from '../source/mobile/state.mjs';
import {photoSlot} from '../source/mobile/page.mjs';
import {buildMobile} from '../tools/build-mobile.mjs';

const COVER = 'https://heartwood.org/heartbeat/Fall-2026.jpg';
const STUB = {[COVER]: {ratio: 1.44, widths: {'240': {avif: 'assets/a240.avif', webp: 'assets/a240.webp'}, '360': {avif: 'assets/a360.avif', webp: 'assets/a360.webp'}}}};

let built;
async function phoneBuild() {
  if (!built) {
    built = (async () => {
      const out = await realpath(await mkdtemp(join(tmpdir(), 'hw-phone-photos-')));   // canonical: the build rejects symlinked ancestors (macOS /var)
      const result = await buildMobile({out});
      return {out, html: await readFile(join(out, 'day.html'), 'utf8')};
    })();
  }
  return built;
}
test.after(async () => { const r = await built?.catch(() => null); if (r?.out) await rm(r.out, {recursive: true, force: true}); });

test('photoSlot: no-script original-source photo (identical alt/dimensions) + JS-only local picture slot', () => {
  const out = photoSlot(STUB, {src: COVER, alt: 'Current issue'}, {cls: 'issue__img', sizes: '7.5rem'});
  assert.match(out, /^<noscript><img class="issue__img" src="https:\/\/heartwood\.org\/heartbeat\/Fall-2026\.jpg" alt="Current issue" width="240" height="346" loading="lazy" decoding="async"><\/noscript>/);
  assert.match(out, /<span class="photo-host" data-photo-url="https:\/\/heartwood\.org\/heartbeat\/Fall-2026\.jpg" data-photo-alt="Current issue" data-photo-cls="issue__img" data-photo-sizes="7\.5rem"><\/span>$/);
  assert(!out.includes('<picture'), 'no static picture ships for the cover (the local picture is JS-only)');
  assert.throws(() => photoSlot({}, {src: COVER, alt: 'x'}, {cls: 'c', sizes: 's'}), /No phone-sized photo/);
});

test('renderRecord: the sheet figure marks the canonical original URL for the controller', () => {
  const pics = {[COVER]: {ratio: 1.44, avif: 'a.avif 240w', webp: 'a.webp 240w', src: 'a.webp', w: 240}};
  const html = renderRecord({id: 'x', kind: 'news', title: 'T', body: [], links: [], img: {src: COVER, alt: 'Current issue'}}, {news: 'News'}, pics);
  assert.match(html, /<img src="a\.webp" srcset="a\.webp 240w" sizes="\(min-width: 40rem\) 20rem, 70vw" width="240" height="346" alt="Current issue" decoding="async" data-live-photo="https:\/\/heartwood\.org\/heartbeat\/Fall-2026\.jpg">/);
});

test('built page: the no-script original matches the local picture dimensions; the slot carries the canonical URL', async () => {
  const {html} = await phoneBuild();
  const noscript = /<noscript><img class="issue__img" src="https:\/\/heartwood\.org\/heartbeat\/Fall-2026\.jpg" alt="([^"]*)" width="(\d+)" height="(\d+)"[^>]*><\/noscript>/.exec(html);
  assert.ok(noscript, 'the cover original ships inside <noscript>');
  const data = JSON.parse(/<script type="application\/json" id="hw-records">([\s\S]*?)<\/script>/.exec(html)[1]);
  const pic = data.pics[COVER];
  assert.equal(+noscript[2], pic.w, 'identical width to the local picture');
  assert.equal(+noscript[3], Math.round(pic.w * pic.ratio), 'identical height to the local picture');
  assert.match(html, /<span class="photo-host" data-photo-url="https:\/\/heartwood\.org\/heartbeat\/Fall-2026\.jpg"/);
  const scripted = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '<noscript></noscript>').replace(/<script[\s\S]*?<\/script>/g, '');
  assert(!/(?:src|srcset)="[^\"]*https?:/.test(scripted), 'scripted markup must not point at an external sub-resource');
});

test('CSP widens to exactly the heartwood.org origin (img-src + connect-src); connect-src none is gone', async () => {
  const {html} = await phoneBuild();
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  assert(csp.includes("img-src 'self' https://heartwood.org;"), csp);
  assert(csp.includes("connect-src 'self' https://heartwood.org;"), csp);
  assert(!csp.includes("connect-src 'none'"));
});

test('the bundle carries the shared controller ahead of the page script; hydration + the sheet watch are wired', async () => {
  const {out, html} = await phoneBuild();
  const jsPath = /src="(assets\/mobile\.[0-9a-f]+\.js)"/.exec(html)[1];
  const js = readFileSync(join(out, jsPath), 'utf8');
  const shared = js.indexOf('var HeartwoodPhotos');
  assert(shared >= 0, 'the shared controller ships in the bundle');
  assert(js.indexOf("// The phone page's behaviour") > shared, 'the controller must be defined before the page script');
  assert(js.includes('HeartwoodPhotos.create()'), 'the page creates the controller');
  assert(js.includes('livePhotos.watch(body)'), 'the sheet body container is watched after show()');
  assert(js.includes("$$('[data-photo-url]')"), 'the local pictures hydrate from the slots');
  assert(js.includes('photoPicture(slot.dataset.photoUrl'), 'hydration reuses the shared picture builder');
});
