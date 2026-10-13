"""Focused perf probe of whatever build is on 8003: first paint, tree hover (1x, 2x), Network hover (1x)."""
import asyncio, json, random, statistics, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8003/heartwood-site.html"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
START = """() => { window.__f = []; let last = performance.now();
  const tick = t => { window.__f.push(t - last); last = t; if (window.__on) requestAnimationFrame(tick); };
  window.__on = true; requestAnimationFrame(tick); }"""
STOP = "() => { window.__on = false; return window.__f.slice(1); }"


def st(f):
    f = sorted(f); q = lambda p: f[min(len(f) - 1, int(p * len(f)))]
    return [round(q(.95), 1), round(f[-1], 1), sum(x > 20 for x in f)]


async def sweep(pg, sel, seed):
    pts = await pg.evaluate(f"""() => [...document.querySelectorAll('{sel}')].map(f => {{
        const r = f.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }})
        .filter(([x, y]) => x > 0 && y > 90 && x < innerWidth && y < innerHeight)""")
    rnd = random.Random(seed); await pg.evaluate(START)
    for _ in range(100):
        x, y = rnd.choice(pts); await pg.mouse.move(x, y, steps=4); await pg.wait_for_timeout(60)
    await pg.wait_for_timeout(400); return st(await pg.evaluate(STOP))


async def main():
    label = sys.argv[1]; out = {"label": label, "fcp": [], "tree1": [], "tree2": [], "net1": []}
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", args=["--enable-gpu-rasterization", "--ignore-gpu-blocklist"])
        for _ in range(5):
            ctx = await b.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA); pg = await ctx.new_page()
            cdp = await ctx.new_cdp_session(pg); await cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
            await pg.goto(BASE, wait_until="load"); await pg.wait_for_timeout(1200)
            out["fcp"].append(round(await pg.evaluate("performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0")))
            await ctx.close()
        for dpr, key, runs in ((1, "tree1", 2), (2, "tree2", 2)):
            for run in range(runs):
                ctx = await b.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA, device_scale_factor=dpr); pg = await ctx.new_page()
                await pg.goto(BASE, wait_until="load"); await pg.wait_for_timeout(4000)
                out[key].append(await sweep(pg, ".tree button.leaf .leaf__face", run))
                if dpr == 1:
                    await pg.mouse.move(5, 895)
                    await pg.evaluate("() => document.getElementById('net').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(1500)
                    out["net1"].append(await sweep(pg, "#net [data-path]", run))
                await ctx.close()
        await b.close()
    print(json.dumps(out))

asyncio.run(main())
