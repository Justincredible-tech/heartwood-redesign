"""Track 016 A/B: run once against the baseline build and once against the change, both served on 8003.

    python -I check016.py <label> <outdir>

Writes <outdir>/<label>.json and settled screenshots <outdir>/<label>-*.png. Animations are frozen at the same
time point before every screenshot, so two runs of the same build give identical pixels.
"""
import asyncio, json, random, statistics, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8003/heartwood-site.html"
LABEL, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
CHROME = ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"]

FREEZE = """() => { for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = 4000; } catch {} } }"""
FRAMES_START = """() => { window.__f = []; let last = performance.now();
  const tick = t => { window.__f.push(t - last); last = t; if (window.__on) requestAnimationFrame(tick); };
  window.__on = true; requestAnimationFrame(tick); }"""
FRAMES_STOP = "() => { window.__on = false; return window.__f.slice(1); }"


def stats(f):
    f = sorted(f); q = lambda p: f[min(len(f) - 1, int(p * len(f)))]
    return {"n": len(f), "p50": round(q(.5), 1), "p95": round(q(.95), 1), "max": round(f[-1], 1), "over20": sum(x > 20 for x in f), "over50": sum(x > 50 for x in f)}


async def layer_count(cdp):
    box = {}
    cdp.on("LayerTree.layerTreeDidChange", lambda ev: box.__setitem__("l", ev.get("layers") or box.get("l", [])))
    await cdp.send("LayerTree.enable"); await asyncio.sleep(1.0); await cdp.send("LayerTree.disable")
    ls = [l for l in box.get("l", []) if l.get("drawsContent")]
    return len(ls), round(sum(l["width"] * l["height"] for l in ls) * 4 / 2**20, 1)


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"


async def new_page(b, ua=True, **ctx_args):
    # heartwood.org refuses the HeadlessChrome user agent, which would hide the baseline's hot-linked photos
    ctx = await b.new_context(**({"viewport": {"width": 1440, "height": 900}} | ({"user_agent": UA} if ua else {}) | ctx_args))
    pg = await ctx.new_page(); log = {"errors": [], "console": [], "external": [], "failed": []}
    pg.on("pageerror", lambda e: log["errors"].append(str(e)))
    pg.on("console", lambda m: m.type in ("error", "warning") and log["console"].append(m.text))
    pg.on("request", lambda r: not r.url.startswith(("http://127.0.0.1", "data:", "blob:")) and log["external"].append(r.url))
    pg.on("requestfailed", lambda r: log["failed"].append(r.url))
    return ctx, pg, log


async def settle(pg, ms=4000):
    await pg.goto(BASE, wait_until="load"); await pg.wait_for_timeout(ms)


async def hover_runs(b, dpr, runs=3):
    out = []
    for run in range(runs):
        ctx, pg, log = await new_page(b, device_scale_factor=dpr); cdp = await ctx.new_cdp_session(pg)
        await settle(pg)
        r = {"dpr": dpr}
        r["layers_top"], r["layer_mb_top"] = await layer_count(cdp)
        leaves = await pg.evaluate("""() => [...document.querySelectorAll('.tree button.leaf .leaf__face')].map(f => {
            const r = f.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })
            .filter(([x, y]) => x > 0 && y > 90 && x < innerWidth && y < innerHeight)""")
        rnd = random.Random(run); await pg.evaluate(FRAMES_START)
        for _ in range(100):
            x, y = rnd.choice(leaves); await pg.mouse.move(x, y, steps=4); await pg.wait_for_timeout(60)
        await pg.wait_for_timeout(400); r["tree"] = stats(await pg.evaluate(FRAMES_STOP))
        r["tag_shown"] = await pg.evaluate("() => document.querySelector('#leaftag').classList.contains('is-on')")
        # scroll the tree away, measure layers, then fling back to it and time the frames
        await pg.mouse.move(5, 895)
        await pg.evaluate("() => document.getElementById('net').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(1500)
        r["layers_away"], r["layer_mb_away"] = await layer_count(cdp)
        await pg.evaluate(FRAMES_START)
        for _ in range(30):
            await pg.mouse.wheel(0, -400); await pg.wait_for_timeout(30)
        await pg.wait_for_timeout(1500); r["scroll_back"] = stats(await pg.evaluate(FRAMES_STOP))
        # Network hover
        await pg.evaluate("() => document.getElementById('net').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(1500)
        spores = await pg.evaluate("""() => [...document.querySelectorAll('#net [data-path]')].map(s => {
            const r = s.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }).filter(([x, y]) => y > 90 && y < innerHeight)""")
        await pg.evaluate(FRAMES_START)
        for _ in range(100):
            x, y = rnd.choice(spores); await pg.mouse.move(x, y, steps=4); await pg.wait_for_timeout(60)
        await pg.wait_for_timeout(400); r["network"] = stats(await pg.evaluate(FRAMES_STOP))
        r["log"] = log; out.append(r); await ctx.close()
    return out


async def load_runs(b, runs=7):
    out = []
    for _ in range(runs):
        ctx, pg, log = await new_page(b); cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        await pg.goto(BASE, wait_until="load"); await pg.wait_for_timeout(1500)
        out.append(await pg.evaluate("""() => new Promise(done => { const r = {lt: 0, ltn: 0};
          new PerformanceObserver(l => { for (const e of l.getEntries()) r.lcp = e.startTime; }).observe({type: 'largest-contentful-paint', buffered: true});
          new PerformanceObserver(l => { for (const e of l.getEntries()) { r.lt += e.duration; r.ltn++; } }).observe({type: 'longtask', buffered: true});
          r.fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime; setTimeout(() => done(r), 300); })"""))
        await ctx.close()
    med = lambda k: round(statistics.median(r.get(k) or 0 for r in out), 1)
    return {"fcp": med("fcp"), "lcp": med("lcp"), "longtask_ms": med("lt"), "longtasks": med("ltn"), "runs": out}


async def shots(b, dpr, tag):
    ctx, pg, log = await new_page(b, device_scale_factor=dpr)
    await settle(pg); res = {}
    async def snap(name, clip=None):
        await pg.evaluate(FREEZE); await pg.wait_for_timeout(150)
        await pg.screenshot(path=str(OUT / f"{LABEL}-{tag}-{name}.png"), clip=clip)
        await pg.evaluate("() => { for (const a of document.getAnimations()) { try { a.play(); } catch {} } }")
    res["wrapped"] = await pg.evaluate("() => document.querySelectorAll('.tree .leaf-layer').length")
    res["leaf_buttons"] = await pg.evaluate("() => document.querySelectorAll('.tree button.leaf').length")
    await snap("idle")
    face = pg.locator(".tree button.leaf[data-leaf] .leaf__face").nth(40); box = await face.bounding_box()
    await pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); await pg.wait_for_timeout(900); await snap("hover")
    await pg.mouse.move(5, 895); await pg.wait_for_timeout(700)
    await pg.locator('.nav a[data-kind="news"]').hover(); await pg.wait_for_timeout(900); await snap("filter")
    await pg.mouse.move(5, 895); await pg.wait_for_timeout(900)
    leaf = pg.locator(".tree button.leaf[data-leaf]").nth(40); await leaf.focus(); await snap("focus")
    await pg.keyboard.press("Enter"); await pg.wait_for_timeout(2600)
    res["dialog_open"] = await pg.evaluate("() => document.getElementById('dialog').matches('[open], .is-open') || getComputedStyle(document.getElementById('dialog')).visibility !== 'hidden'")
    await snap("dialog")
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(2600)
    res["focus_returned"] = await pg.evaluate("() => document.activeElement === document.querySelectorAll('.tree button.leaf[data-leaf]')[40]")
    await snap("closed")
    # Forest Council poster in its dialog
    opener = pg.locator('.tree button.leaf[data-leaf="forest-council"]')
    if await opener.count():
        await opener.focus(); await pg.keyboard.press("Enter")
    else:
        await pg.evaluate("() => document.querySelector('[data-open=\"forest-council\"]').click()")
    await pg.wait_for_timeout(2600)
    fig = pg.locator("#dialog figure img")
    await fig.evaluate("img => img.complete ? 0 : new Promise(r => { img.onload = r; img.onerror = r; })")
    await pg.wait_for_timeout(300)
    res["poster"] = await fig.evaluate("img => ({src: img.currentSrc.split('/').pop(), w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, natural: img.naturalWidth})")
    fb = await pg.locator("#dialog figure").bounding_box()
    await snap("poster", clip=fb)
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(2600)
    # Heartbeat cover in the News section
    await pg.evaluate("() => document.querySelector('.issue__cover').scrollIntoView({block:'center', behavior:'instant'})"); await pg.wait_for_timeout(800)
    cover = pg.locator(".issue__cover img")
    await cover.evaluate("img => img.complete ? 0 : new Promise(r => { img.onload = r; img.onerror = r; })"); await pg.wait_for_timeout(300)
    res["cover"] = await cover.evaluate("img => ({src: img.currentSrc.split('/').pop(), w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, natural: img.naturalWidth})")
    cb = await pg.locator(".issue__cover").bounding_box(); await snap("cover", clip=cb)
    await snap("news")
    res["log"] = log; await ctx.close(); return res


async def navigation(b):
    ctx, pg, log = await new_page(b); r = {}
    await settle(pg, 1500)
    for which, sel in (("header_logo", ".top .brand"), ("footer_logo", ".foot .brand")):
        await pg.evaluate("() => scrollTo({top: 4000, behavior: 'instant'})"); await pg.wait_for_timeout(400)
        if which == "footer_logo":
            await pg.evaluate("() => document.querySelector('.foot').scrollIntoView({behavior:'instant'})"); await pg.wait_for_timeout(400)
        await pg.click(sel); await pg.wait_for_timeout(2500)
        r[which + "_scrollY"] = await pg.evaluate("scrollY")
    await pg.evaluate("() => scrollTo({top: 4000, behavior: 'instant'})"); await pg.wait_for_timeout(400)
    r["header_stuck_at_4000"] = await pg.evaluate("() => document.querySelector('.top').classList.contains('is-stuck')")
    await pg.evaluate("() => scrollTo({top: 0, behavior: 'instant'})"); await pg.wait_for_timeout(400)
    r["header_unstuck_at_0"] = not await pg.evaluate("() => document.querySelector('.top').classList.contains('is-stuck')")
    await pg.click('.nav a[href="#support"]'); await pg.wait_for_timeout(150)
    mid = await pg.evaluate("scrollY"); await pg.wait_for_timeout(2500)
    r["menu_nav_smooth"] = {"150ms": mid, "final": await pg.evaluate("scrollY")}
    r["skip_link"] = None
    await pg.evaluate("() => scrollTo({top: 0, behavior: 'instant'})"); await pg.wait_for_timeout(300)
    await pg.keyboard.press("Tab"); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(2000)
    r["skip_link"] = await pg.evaluate("() => Math.round(document.getElementById('about').getBoundingClientRect().top)")
    r["log"] = log; await ctx.close()
    for frag in ("#support", "#network", "#news"):
        ctx, pg, log = await new_page(b)
        await pg.add_init_script("window.__ys=[];(function t(){window.__ys.push(Math.round(scrollY));if(window.__ys.length<240)requestAnimationFrame(t)})()")
        await pg.goto(BASE + frag, wait_until="load"); await pg.wait_for_timeout(3500)
        ys = await pg.evaluate("window.__ys")
        r[frag] = {"final_scrollY": ys[-1], "positions": len(set(ys)), "target_top": await pg.evaluate(f"() => Math.round(document.querySelector('{frag}').getBoundingClientRect().top)")}
        await ctx.close()
    # member search and topic chip still work
    ctx, pg, log = await new_page(b); await settle(pg, 1500)
    r["search"] = await pg.evaluate("""async () => { const i = document.querySelector('#net-list input, input[type=search]'); if (!i) return 'no search box';
        document.getElementById('net-list').open = true; i.value = 'Kentucky'; i.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise(r => setTimeout(r, 300));
        return [...document.querySelectorAll('#net-list li')].filter(li => li.offsetParent).map(li => li.textContent.trim()).slice(0, 5); }""")
    r["search_log"] = log; await ctx.close()
    return r


async def phone_and_motion(b):
    r = {}
    ctx, pg, log = await new_page(b, viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    cdp = await ctx.new_cdp_session(pg); await settle(pg)
    r["phone_layers"], r["phone_layer_mb"] = await layer_count(cdp)
    r["phone_will_change"] = await pg.evaluate("() => { const l = document.querySelector('.tree .leaf-layer'); return l ? getComputedStyle(l).willChange : 'no wrapper'; }")
    await pg.evaluate(FREEZE); await pg.wait_for_timeout(150); await pg.screenshot(path=str(OUT / f"{LABEL}-phone-idle.png"))
    await pg.locator(".tree button.leaf[data-leaf] .leaf__face").nth(20).tap(); await pg.wait_for_timeout(2600)
    r["phone_tap_opens"] = await pg.evaluate("() => getComputedStyle(document.getElementById('dialog')).visibility !== 'hidden'")
    r["phone_log"] = log; await ctx.close()
    ctx, pg, log = await new_page(b, reduced_motion="reduce"); await settle(pg, 1500)
    leaf = pg.locator(".tree button.leaf[data-leaf]").nth(40); await leaf.focus(); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(800)
    r["reduced_opens"] = await pg.evaluate("() => getComputedStyle(document.getElementById('dialog')).visibility !== 'hidden'")
    await pg.keyboard.press("Escape"); await pg.wait_for_timeout(800)
    r["reduced_focus_back"] = await pg.evaluate("() => document.activeElement === document.querySelectorAll('.tree button.leaf[data-leaf]')[40]")
    await pg.evaluate("() => scrollTo({top: 4000, behavior: 'instant'})"); await pg.click(".top .brand"); await pg.wait_for_timeout(600)
    r["reduced_home_scrollY"] = await pg.evaluate("scrollY")
    r["reduced_log"] = log; await ctx.close()
    return r


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", args=CHROME)
        res = {"label": LABEL}
        res["shots_dpr1"] = await shots(b, 1, "d1")
        res["shots_dpr2"] = await shots(b, 2, "d2")
        res["shots_dpr1_repeat"] = await shots(b, 1, "d1r")
        res["nav"] = await navigation(b)
        res["phone_motion"] = await phone_and_motion(b)
        res["load"] = await load_runs(b)
        res["hover"] = await hover_runs(b, 1) + await hover_runs(b, 2)
        await b.close()
        wk = await p.webkit.launch() if True else None
        try:
            ctx, pg, log = await new_page(wk, ua=False); await settle(pg)
            r = {"wrapped": await pg.evaluate("() => document.querySelectorAll('.tree .leaf-layer').length")}
            await pg.evaluate(FREEZE); await pg.wait_for_timeout(150); await pg.screenshot(path=str(OUT / f"{LABEL}-webkit-idle.png"))
            face = pg.locator(".tree button.leaf[data-leaf] .leaf__face").nth(40); bx = await face.bounding_box()
            await pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); await pg.wait_for_timeout(900)
            r["tag_shown"] = await pg.evaluate("() => document.querySelector('#leaftag').classList.contains('is-on')")
            await pg.evaluate(FREEZE); await pg.wait_for_timeout(150); await pg.screenshot(path=str(OUT / f"{LABEL}-webkit-hover.png"))
            await pg.mouse.move(5, 895); await pg.wait_for_timeout(500)
            await pg.locator(".tree button.leaf[data-leaf]").nth(40).focus(); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(2600)
            r["dialog"] = await pg.evaluate("() => getComputedStyle(document.getElementById('dialog')).visibility !== 'hidden'")
            await pg.keyboard.press("Escape"); await pg.wait_for_timeout(2600)
            r["focus_back"] = await pg.evaluate("() => document.activeElement === document.querySelectorAll('.tree button.leaf[data-leaf]')[40]")
            await pg.evaluate("() => scrollTo({top: 4000, behavior: 'instant'})"); await pg.wait_for_timeout(300)
            await pg.evaluate("() => document.querySelector('.top .brand').click()"); await pg.wait_for_timeout(2500); r["home_scrollY"] = await pg.evaluate("scrollY")
            r["log"] = log; res["webkit"] = r; await ctx.close()
        finally:
            await wk.close()
    (OUT / f"{LABEL}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print("done", LABEL)

asyncio.run(main())
