"""Where the low-end idle GPU time goes: per thread name, base vs head, interleaved."""
import asyncio, collections, json, sys
sys.path.insert(0, r'D:/projects/Heartwood-v2/tools/quality')
import perf, refs
from playwright.async_api import async_playwright

async def one(pw, url):
    p = perf.PROFILES['lowend']
    b = await pw.chromium.launch(channel='chrome', args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': p['width'], 'height': p['height']}, device_scale_factor=p['dpr'], is_mobile=True, has_touch=True, user_agent=refs.user_agent(b))
    pg = await ctx.new_page(); cdp = await ctx.new_cdp_session(pg)
    await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', p['network']); await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
    await pg.goto(url + refs.PAGE, wait_until='load', timeout=180000); await pg.wait_for_timeout(4000)
    await b.start_tracing(page=pg, categories=perf.CATEGORIES + ['disabled-by-default-devtools.timeline.invalidationTracking'])
    await pg.wait_for_timeout(5000)
    ev = json.loads(await b.stop_tracing())['traceEvents']; await b.close()
    names = perf.thread_names(ev); outer = {(e['pid'], e['tid']) for e in ev if e.get('name') == 'ThreadControllerImpl::RunTask'}
    per = collections.Counter(); raster_tasks = collections.Counter()
    for e in ev:
        if e.get('ph') != 'X': continue
        t = (e['pid'], e['tid']); n = names.get(t, '?')
        if e.get('name') == ('ThreadControllerImpl::RunTask' if t in outer else 'RunTask') and perf.thread_kind(n):
            per[n.split('/')[0]] += e.get('dur', 0) / 5000
        if e.get('name') in ('RasterTask', 'PaintLayer', 'Paint', 'UpdateLayer', 'Layerize', 'PrePaint'): raster_tasks[e['name']] += e.get('dur', 0) / 5000
    return {k: round(v, 1) for k, v in per.most_common(6)}, {k: round(v, 1) for k, v in raster_tasks.most_common()}

async def main():
    async with async_playwright() as pw:
        with refs.serve('track/008-foundation-spike', 8004, log=lambda *a: None) as base, refs.serve('ea6daeb', 8005, log=lambda *a: None) as head:
            for i in range(3):
                for side, url in (('base', base), ('head', head)) if i % 2 == 0 else (('head', head), ('base', base)):
                    threads, tasks = await one(pw, url); print(side, threads, tasks, flush=True)
asyncio.run(main())
