"""Compare page performance of two git refs: desktop and an emulated low-end phone, medians of several runs.

    python tools/quality/perf.py --base v1.0-iterative --head track/008-foundation-spike
    python tools/quality/perf.py --base v1.0-iterative --head v1.0-iterative --runs 5   # noise floor

Each ref is built and served by refs.py (base on 8004, head on 8005). Every run launches a fresh Chrome with the
cache disabled, records a trace of the load and of an idle window while the scene animates, then takes a memory
dump. Runs alternate base, head, head, base... so a slow spell on the machine falls on both sides.

Measures, per profile (median of the runs):
  first_paint_ms     first contentful paint
  blocked_ms         total blocking time after first paint (long-task time over 50 ms)
  main_paint_ms      main-thread Paint + PrePaint + Layerize during the load
  gpu_ms_per_s       raster, GPU and compositor thread time per second while idle and animating
  layers             layers that draw content, once settled
  renderer_mb        renderer heap (partition_alloc + blink_gc + malloc) after settling
  gpu_mb             GPU process memory after settling

A head value worse than base by more than that profile's threshold in thresholds.json (relative, with an absolute
floor; default 5%) is a REGRESSION. Promoted from review-evidence/007-grain-and-motion-20261012/prof.py and mem.py.
"""
import argparse
import asyncio
import json
import statistics
import sys
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refs  # noqa: E402

HERE = Path(__file__).resolve().parent
PROFILES = {
    'desktop': dict(width=1440, height=900, dpr=1, mobile=False, cpu=1, network=None),
    'lowend': dict(width=390, height=844, dpr=2, mobile=True, cpu=6,
                   network=dict(offline=False, latency=150, downloadThroughput=1.6e6 / 8, uploadThroughput=750e3 / 8)),
}
METRICS = ('first_paint_ms', 'blocked_ms', 'main_paint_ms', 'gpu_ms_per_s', 'layers', 'renderer_mb', 'gpu_mb')
CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'viz', 'toplevel']
IDLE_S = 5


def thresholds(profile):
    file = HERE / 'thresholds.json'
    return json.loads(file.read_text(encoding='utf-8')).get('perf', {}).get(profile, {}) if file.is_file() else {}


def thread_names(events):
    return {(e['pid'], e['tid']): e['args']['name'] for e in events if e.get('ph') == 'M' and e.get('name') == 'thread_name'}


def thread_kind(name):
    if name == 'CrRendererMain':
        return 'main'
    if 'Raster' in name or name in ('Compositor', 'CrGpuMain', 'VizCompositorThread') or 'Viz' in name:
        return 'gpu'
    return None


def window_time(events, names, start, end, kind=None, event_names=None):
    """Microseconds inside [start, end] on one kind of thread: of the named events, or else of top-level tasks.

    A task can appear both as ThreadControllerImpl::RunTask and as a nested RunTask; each thread is counted by the
    outer name when it has any, so nothing is counted twice.
    """
    outer = {(e['pid'], e['tid']) for e in events if e.get('name') == 'ThreadControllerImpl::RunTask'}
    total = 0
    for e in events:
        if e.get('ph') != 'X':
            continue
        thread = (e['pid'], e['tid'])
        if event_names is None:
            wanted = 'ThreadControllerImpl::RunTask' if thread in outer else 'RunTask'
            if e.get('name') != wanted:
                continue
        elif e.get('name') not in event_names:
            continue
        if thread_kind(names.get(thread, '')) != kind:
            continue
        a, b = e['ts'], e['ts'] + e.get('dur', 0)
        if b >= start and a <= end:
            total += min(b, end) - max(a, start)
    return total


async def layer_count(cdp):
    found = asyncio.get_running_loop().create_future()
    cdp.on('LayerTree.layerTreeDidChange', lambda e: e.get('layers') and not found.done() and found.set_result(e['layers']))
    await cdp.send('LayerTree.enable')
    try:
        layers = await asyncio.wait_for(found, 10)
    except asyncio.TimeoutError:
        return None
    finally:
        await cdp.send('LayerTree.disable')
    return sum(1 for layer in layers if layer.get('drawsContent'))


async def memory(browser):
    session = await browser.new_browser_cdp_session()
    chunks, done = [], asyncio.get_running_loop().create_future()
    session.on('Tracing.dataCollected', lambda e: chunks.extend(e['value']))
    session.on('Tracing.tracingComplete', lambda e: done.done() or done.set_result(True))
    await session.send('Tracing.start', {'traceConfig': {'includedCategories': ['disabled-by-default-memory-infra'],
                                                         'memoryDumpConfig': {'triggers': []}}, 'transferMode': 'ReportEvents'})
    await asyncio.sleep(0.5)
    await session.send('Tracing.requestMemoryDump', {'deterministic': True, 'levelOfDetail': 'detailed'})
    await session.send('Tracing.end')
    await done
    processes = {e['pid']: e['args']['name'] for e in chunks if e.get('ph') == 'M' and e.get('name') == 'process_name'}
    result = {'renderer_mb': 0.0, 'gpu_mb': 0.0}
    for e in chunks:
        if e.get('ph') != 'v':
            continue
        allocators = e['args']['dumps'].get('allocators', {})
        size = lambda key: int(allocators.get(key, {}).get('attrs', {}).get('size', {}).get('value', '0'), 16) / 2**20
        process = processes.get(e['pid'], '')
        if process == 'Renderer':
            result['renderer_mb'] = max(result['renderer_mb'], size('partition_alloc') + size('blink_gc') + size('malloc'))
        elif process == 'GPU Process':
            result['gpu_mb'] = max(result['gpu_mb'], size('gpu') + size('shared_image') or size('malloc'))
    return {k: round(v, 1) for k, v in result.items()}


async def measure(playwright, url, profile):
    p = PROFILES[profile]
    browser = await playwright.chromium.launch(channel='chrome', args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    try:
        context = await browser.new_context(viewport={'width': p['width'], 'height': p['height']}, device_scale_factor=p['dpr'],
                                            is_mobile=p['mobile'], has_touch=p['mobile'], user_agent=refs.user_agent(browser))
        page = await context.new_page()
        cdp = await context.new_cdp_session(page)
        await cdp.send('Network.enable')
        await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
        if p['network']:
            await cdp.send('Network.emulateNetworkConditions', p['network'])
        await cdp.send('Emulation.setCPUThrottlingRate', {'rate': p['cpu']})
        await page.add_init_script("""window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries())
            window.__lt.push([e.startTime, e.duration]); }).observe({type: 'longtask', buffered: true});""")
        await browser.start_tracing(page=page, categories=CATEGORIES)
        await page.goto(url + refs.PAGE, wait_until='load', timeout=180000)
        await page.wait_for_timeout(2500)
        nav = await page.evaluate("""() => { const f = performance.getEntriesByName('first-contentful-paint')[0];
            const fcp = f ? f.startTime : 0;
            return {fcp, blocked: window.__lt.filter(([s]) => s > fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0)}; }""")
        await page.wait_for_timeout(IDLE_S * 1000)
        trace = json.loads(await browser.stop_tracing())['traceEvents']
        layers = await layer_count(cdp)
        await cdp.send('HeapProfiler.collectGarbage')       # so memory is not read mid-way through a GC cycle
        mem = await memory(browser)
    finally:
        await browser.close()
    names = thread_names(trace)
    main = [e for e in trace if e.get('ph') == 'X' and names.get((e['pid'], e['tid'])) == 'CrRendererMain']
    start, end = min(e['ts'] for e in main), max(e['ts'] + e.get('dur', 0) for e in main)
    idle_start = end - IDLE_S * 1e6
    return {
        'first_paint_ms': round(nav['fcp']),
        'blocked_ms': round(nav['blocked']),
        'main_paint_ms': round(window_time(trace, names, start, idle_start, 'main', {'Paint', 'PrePaint', 'Layerize'}) / 1000),
        'gpu_ms_per_s': round(window_time(trace, names, idle_start, end, 'gpu') / 1000 / IDLE_S, 1),
        'layers': layers,
        **mem,
    }


def compare(base_runs, head_runs, limits):
    rows = []
    for metric in METRICS:
        b = statistics.median(r[metric] for r in base_runs if r[metric] is not None)
        h = statistics.median(r[metric] for r in head_runs if r[metric] is not None)
        limit = limits.get(metric, {})
        allowed = max(limit.get('relative', 0.05) * b, limit.get('absolute', 0))
        change = (h - b) / b * 100 if b else 0.0
        rows.append({'metric': metric, 'base': b, 'head': h, 'change_pct': round(change, 1), 'allowed': round(allowed, 1),
                     'verdict': 'REGRESSION' if h - b > allowed else ('better' if b - h > allowed else 'same')})
    return rows


async def run(args):
    results = {}
    async with async_playwright() as playwright:
        with refs.serve(args.base, 8004) as base_url, refs.serve(args.head, 8005) as head_url:
            for profile in args.profiles:
                runs = {'base': [], 'head': []}
                for url in (base_url, head_url):          # warm-up, discarded: the first Chrome start is cold
                    await measure(playwright, url, profile)
                for i in range(args.runs):
                    order = (('base', base_url), ('head', head_url)) if i % 2 == 0 else (('head', head_url), ('base', base_url))
                    for side, url in order:
                        runs[side].append(await measure(playwright, url, profile))
                        print(f'[perf] {profile} run {i + 1} {side}: {runs[side][-1]}', flush=True)
                results[profile] = {'runs': runs, 'comparison': compare(runs['base'], runs['head'], thresholds(profile))}
    return results


def table(results, args):
    lines = [f'# Performance: {args.head} against {args.base}', '',
             f'{args.runs} runs per side per profile, medians. Chrome, fresh browser per run, cache disabled.', '']
    for profile, result in results.items():
        p = PROFILES[profile]
        lines += [f'## {profile} ({p["width"]}x{p["height"]}@{p["dpr"]}x, CPU {p["cpu"]}x{", slow 4G" if p["network"] else ""})', '',
                  '| Measure | Base | Head | Change | Allowed | Verdict |', '|---|---:|---:|---:|---:|---|']
        lines += [f'| {r["metric"]} | {r["base"]} | {r["head"]} | {r["change_pct"]:+.1f}% | {r["allowed"]} | {r["verdict"]} |'
                  for r in result['comparison']]
        lines.append('')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', default='v1.0-iterative')
    parser.add_argument('--head', required=True)
    parser.add_argument('--profiles', default='desktop,lowend')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--out', type=Path, help='folder for perf.md and perf.json')
    args = parser.parse_args()
    args.profiles = [p for p in args.profiles.split(',') if p]
    unknown = set(args.profiles) - set(PROFILES)
    if unknown:
        parser.error('unknown profile: ' + ', '.join(sorted(unknown)))
    results = asyncio.run(run(args))
    report = table(results, args)
    print(report)
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / 'perf.md').write_text(report + '\n', encoding='utf-8', newline='\n')
        (args.out / 'perf.json').write_text(json.dumps(results, indent=1) + '\n', encoding='utf-8', newline='\n')
    regressions = [(p, r['metric']) for p, res in results.items() for r in res['comparison'] if r['verdict'] == 'REGRESSION']
    sys.exit(1 if regressions else 0)


if __name__ == '__main__':
    main()
