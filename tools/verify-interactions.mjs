/** Browser regressions against a served artifact, never a source-injected page.
 * node tools/verify-interactions.mjs
 * HW_SITE_ROOT=/tmp/heartwood-pristine-20261011/site HW_REPORT=output/playwright/interactions-baseline.json node tools/verify-interactions.mjs
 * Requires the review's installed playwright-core and an installed Chrome.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, devices } from './browser-deps.mjs';
import { createPreviewServer } from './serve.mjs';
import { ensureToolRuntime } from './tool-runtime.mjs';
import { guardBrowser, guardLaunchOptions, managedLaunch, listenServer, closeServer ,browserToolCLI} from './browser-test-lib.mjs';   // network guard: no traffic beyond loopback

browserToolCLI({});
const siteRoot = resolve(process.env.HW_SITE_ROOT || new URL('../publish', import.meta.url).pathname);
const route = process.env.HW_ROUTE || 'optimized';
const reportPath = resolve(process.env.HW_REPORT || 'output/playwright/interactions.json');
const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.HW_CHROME || process.env.HW_BROWSER_EXECUTABLE || (process.platform === 'darwin' && existsSync(mac) ? mac : undefined);
const report = {
  generatedAt: new Date().toISOString(), siteRoot, route,
  htmlSha256: createHash('sha256').update(await readFile(resolve(siteRoot, route, 'index.html'))).digest('hex'),
  cases: [],
};
const runtime = ensureToolRuntime(); await runtime.ready;
const server = await createPreviewServer({ siteRoot });
await listenServer(server,{runtime});
const base = `http://127.0.0.1:${server.address().port}`;
let browser, guard;
const opened = page => page.waitForFunction(() => !document.getElementById('dialog').hidden && document.activeElement.id === 'dialog-close', null, { timeout: 6500 });
const idle = page => page.waitForFunction(() => !window.leafLift.busy(), null, { timeout: 6500 });
const state = page => page.evaluate(() => ({
  hash: location.hash, hidden: document.getElementById('dialog').hidden,
  state: window.leafLift.state?.() ?? (window.leafLift.busy() ? 'busy' : 'idle'),
  focus: document.activeElement.tagName + '#' + document.activeElement.id,
  tabindex: document.activeElement.getAttribute('tabindex'),
  flyers: document.querySelectorAll('#lift .flyer').length,
  events: window.__interactionEvents,
}));

async function check(name, run, { reducedMotion = 'no-preference', device = null } = {}) {
  if (process.env.HW_CASES && !new RegExp(process.env.HW_CASES).test(name)) return;   // focused rerun: HW_CASES='<regex of case names>'
  const context = await browser.newContext({ ...(device || { viewport: { width: 1365, height: 768 } }), reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__interactionEvents = [];
    for (const type of ['leaf:pick', 'leaf:open', 'leaf:close']) document.addEventListener(type, event => window.__interactionEvents.push({ type, time: performance.now(), reason: event.detail.reason }));
  });
  const result = { name };
  try {
    await page.goto(`${base}/${route}/#work`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.leafLift && document.querySelector('.tree button.leaf[data-item="forest-watch"]'));
    await run(page, context, result);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    result.passed = true;
  } catch (error) {
    result.passed = false; result.error = error.message;
  } finally {
    result.final = await state(page).catch(() => ({ url: page.url() }));
    result.pageErrors = errors;
    report.cases.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}${result.error ? ': ' + result.error.split('\n')[0] : ''}`);
    await context.close();
  }
}

try {
  browser = await managedLaunch(chromium,{ executablePath, headless: true, ...guardLaunchOptions('chromium') },{runtime});
  guard = guardBrowser(browser);
  for (const selector of ['.tree button.leaf[data-item="forest-watch"]', 'a.card[data-open="biomass"]']) {
    await check('double click opens once: ' + selector, async (page, context, result) => {
      const target = page.locator(selector);
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(3500); // Original canopy entrance must finish before a real pointer hit.
      await target.dblclick({ force: true });
      await opened(page);
      result.open = await state(page);
      assert.equal(result.open.events.filter(event => event.type === 'leaf:pick').length, 1);
      assert.equal(result.open.events.filter(event => event.type === 'leaf:open').length, 1);
      assert.equal(result.open.events.filter(event => event.type === 'leaf:close').length, 0);
      const [pick, open] = result.open.events;
      assert.ok(open.time - pick.time >= 1800, 'The full 1.86 second opening sequence must remain.');
      await page.mouse.dblclick(4, 300);
      await idle(page);
      assert.equal((await state(page)).flyers, 0);
    });
  }
  for (const elapsed of [100, 900, 1650]) {
    await check('second scrim click during opening at ' + elapsed + ' ms', async page => {
      await page.locator('a.card[data-open="forest-watch"]').click();
      await page.waitForTimeout(elapsed);
      await page.mouse.click(4, 300);
      await opened(page);
      const actual = await state(page);
      assert.equal(actual.hash, '#leaf-forest-watch');
      assert.equal(actual.events.filter(event => event.type === 'leaf:close').length, 0);
    });
  }
  await check('See everything preserves heading focus until next Tab', async (page, context, result) => {
    await page.locator('a.card[data-open="forest-council"]').focus();
    await page.keyboard.press('Enter');
    await opened(page);
    for (let i = 0; i < 12; i++) {
      if (await page.evaluate(() => document.activeElement.matches('#dialog [data-close]'))) break;
      await page.keyboard.press('Tab');
    }
    assert.equal(await page.evaluate(() => document.activeElement.matches('#dialog [data-close]')), true);
    const href = await page.evaluate(() => document.activeElement.getAttribute('href'));
    await page.keyboard.press('Enter');
    await idle(page);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => location.hash), href);
    result.focus = await page.evaluate(() => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      const heading = target.querySelector('h1, h2, h3') || target;
      return { correct: document.activeElement === heading, tabindex: heading.getAttribute('tabindex') };
    });
    assert.equal(result.focus.correct, true, 'Destination heading retains focus');
    assert.equal(result.focus.tabindex, '-1');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      return (target.querySelector('h1, h2, h3') || target).hasAttribute('tabindex');
    }), false, 'Blur restores the heading tabindex');
  }, { reducedMotion: 'reduce' });
  await check('reloaded owned entry closes with Back and supports Forward', async (page, context, result) => {
    const cdp = await context.newCDPSession(page);
    const before = await cdp.send('Page.getNavigationHistory');
    await page.locator('a.card[data-open="forest-watch"]').click();
    await opened(page);
    await page.reload({ waitUntil: 'load' });
    await opened(page);
    await page.keyboard.press('Escape');
    await idle(page);
    await page.waitForFunction(() => location.hash === '#work');
    const after = await cdp.send('Page.getNavigationHistory');
    result.history = { before: before.currentIndex, after: after.currentIndex };
    assert.equal(after.currentIndex, before.currentIndex, 'Close returns to the existing entry, with no duplicate Back stop');
    await page.goForward();
    await opened(page);
    assert.equal((await state(page)).hash, '#leaf-forest-watch');
  }, { reducedMotion: 'reduce' });
  await check('direct leaf link closes on this page', async page => {
    await page.goto(`${base}/${route}/#leaf-forest-watch`, { waitUntil: 'load' });
    await opened(page);
    await page.keyboard.press('Escape');
    await idle(page);
    assert.equal(new URL(page.url()).pathname, `/${route}/`);
    assert.equal(new URL(page.url()).hash, '');
  }, { reducedMotion: 'reduce' });
  for (const action of ['Escape', 'Back']) {
    await check(action + ' during opening cancels and immediately releases the scrim', async page => {
      await page.locator('a.card[data-open="forest-watch"]').click();
      await page.waitForTimeout(100);
      if (action === 'Escape') await page.keyboard.press('Escape');
      else await page.goBack();
      await idle(page);
      const hit = await page.evaluate(() => ({
        pointerEvents: getComputedStyle(document.getElementById('scrim')).pointerEvents,
        scrimAtPoint: document.elementFromPoint(4, 300)?.id === 'scrim',
        locked: !!document.querySelector('[inert], [data-page][aria-hidden="true"]'),
      }));
      assert.deepEqual(hit, { pointerEvents: 'none', scrimAtPoint: false, locked: false });
      assert.equal((await state(page)).flyers, 0);
      await page.waitForFunction(() => location.hash === '#work');
    });
  }
  // Back on an opened member circle returns the page to rest: no lit route, no circle left focused (it would relight its route).
  for (const phone of [false, true]) for (const when of ['opening', 'open']) {
    await check('history.back() after a circle open (' + when + (phone ? ', Pixel 7 tap' : ', mouse') + ') leaves the page at rest', async (page, context, result) => {
      // Start without a fragment, like a visitor arriving at the page: Back to a #section would itself move focus to that section.
      await page.goto(`${base}/${route}/`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.leafLift);
      const spore = page.locator('.spore[data-open]').first();
      await spore.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.evaluate(() => document.addEventListener('leaf:close', () => { window.__closeState = { active: document.activeElement?.className || document.activeElement?.tagName, lit: document.querySelectorAll('.net__hyphae .is-lit').length }; }));
      if (phone) await spore.tap();
      else { await spore.click(); await page.mouse.move(4, 300); }   // hover is not the subject: only focus may relight the route
      if (when === 'open') await opened(page); else await page.waitForTimeout(100);
      await page.evaluate(() => history.back());
      await idle(page);
      await page.waitForTimeout(150);
      result.atClose = await page.evaluate(() => window.__closeState);
      result.rest = await page.evaluate(() => ({ hidden: document.getElementById('dialog').hidden, lit: document.querySelectorAll('.net__hyphae .is-lit').length,
        sporeFocused: !!document.activeElement?.closest?.('.spore'), lifted: document.body.classList.contains('is-lifted') }));
      assert.deepEqual(result.rest, { hidden: true, lit: 0, sporeFocused: false, lifted: false });
      if (phone) await page.touchscreen.tap(4, 300); else await page.mouse.click(4, 300);   // a neutral press must not bring anything back
      assert.equal(await page.evaluate(() => document.querySelectorAll('.net__hyphae .is-lit').length), 0);
    }, phone ? { device: devices['Pixel 7'] } : {});
  }
} finally {
  try{await browser?.close();}finally{await closeServer(server);}
  try { guard?.assert(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
if (report.cases.some(result => !result.passed)) process.exitCode = 1;
console.log(reportPath);
