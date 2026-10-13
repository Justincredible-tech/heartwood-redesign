import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageChops
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
async def main():
    r = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome")
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA); pg = await ctx.new_page()
        await pg.goto("http://127.0.0.1:8003/heartwood-site.html", wait_until="load"); await pg.wait_for_timeout(2500)
        wc = "() => [document.getElementById('stage').classList.contains('is-motion-paused'), getComputedStyle(document.querySelector('.tree .leaf-layer')).willChange]"
        r["at_top"] = await pg.evaluate(wc)
        await pg.evaluate("() => document.getElementById('net').scrollIntoView({block:'center', behavior:'instant'})"); await pg.wait_for_timeout(800)
        r["at_network"] = await pg.evaluate(wc)
        await pg.evaluate("() => scrollTo({top: 0, behavior: 'instant'})"); await pg.wait_for_timeout(800)
        r["back_top"] = await pg.evaluate(wc)
        await ctx.close()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA); pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("requestfailed", lambda q: errs.append("failed " + q.url))
        await pg.goto(Path("D:/projects/Heartwood-fork-perf/source/heartwood-site.html").as_uri(), wait_until="load"); await pg.wait_for_timeout(2500)
        r["file_wrapped"] = await pg.evaluate("() => document.querySelectorAll('.tree .leaf-layer').length")
        await pg.evaluate("() => document.querySelector('.issue__cover').scrollIntoView({block:'center', behavior:'instant'})"); await pg.wait_for_timeout(1500)
        r["file_cover"] = await pg.evaluate("() => { const i = document.querySelector('.issue__cover img'); return i && [i.complete, i.naturalWidth, i.currentSrc.split('/').pop()]; }")
        r["file_errors"] = [e for e in errs if 'fonts.g' not in e]
        await ctx.close(); await b.close()
    D = Path("ab016b")
    for n in ("d1-news", "d2-news"):
        d = ImageChops.difference(Image.open(D / f"base-{n}.png").convert("RGB"), Image.open(D / f"new-{n}.png").convert("RGB")).convert("L")
        r[n + "_diff_bbox"] = d.point(lambda v: 255 if v > 8 else 0).getbbox()
    print(json.dumps(r))
asyncio.run(main())
