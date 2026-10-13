"""Compare how two git refs look: frozen full-page screenshots at three sizes, measured section by section.

    python tools/quality/visual.py --base v1.0-iterative --head track/008-foundation-spike --out <folder>
    python tools/quality/visual.py --base v1.0-iterative --head v1.0-iterative                 # noise floor

Each ref is built and served by refs.py (base on 8004, head on 8005). Every capture waits for the leaves to
settle, loads lazy images, then freezes every animation at the same moment, so one build captured twice gives the
same pixels. Sizes: desk 1440x900@1x, tablet 768x1024@2x, phone 390x844@2x.

Three bars, per size (thresholds in thresholds.json, measured with base = head):
  section_mean   mean colour of each page section (scene, About ... footer) within 0.5/255 per channel
  structural     share of pixels that differ once both images are blurred enough to hide the paper grain
  regions        connected areas of large difference (over 40/255) outside the moving creatures: none allowed

It writes, per size: base-<size>.png, head-<size>.png, diff-x6-<size>.png (difference, amplified six times) and
large-<size>.png (the large-difference areas in red over a dimmed head image), plus visual.json. Promoted from
review-evidence/007-grain-and-motion-20261012/ab.py and compare.py. Uses Pillow only.
"""
import argparse
import asyncio
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat
from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refs  # noqa: E402

HERE = Path(__file__).resolve().parent
SIZES = {
    'desk': dict(width=1440, height=900, dpr=1, mobile=False),
    'tablet': dict(width=768, height=1024, dpr=2, mobile=True),
    'phone': dict(width=390, height=844, dpr=2, mobile=True),
}
FREEZE_AT_MS = 4200
SECTIONS = """() => [['scene', '.stage'], ...[...document.querySelectorAll('section.layer[id]')].map(s => [s.id, '#' + s.id]),
    ['footer', '.foot']].map(([name, sel]) => { const r = document.querySelector(sel).getBoundingClientRect();
    return [name, Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.right), Math.round(r.bottom + scrollY)]; })"""
MOVERS = """() => [...new Set(document.getAnimations().map(a => a.effect && a.effect.target).filter(Boolean))]
    .filter(el => el.isConnected && !el.closest('.tree')).map(el => { const r = el.getBoundingClientRect();
    return [r.left, r.top + scrollY, r.right, r.bottom + scrollY]; }).filter(([a, b, c, d]) => c > a && d > b)"""
LARGE = 40          # per-channel difference that counts as large
CELL = 8            # device px per cell when looking for connected areas


def thresholds(size):
    file = HERE / 'thresholds.json'
    data = json.loads(file.read_text(encoding='utf-8')).get('visual', {}) if file.is_file() else {}
    return {'section_mean': 0.5, 'structural_pct': 0.05, 'regions': 0, **data.get(size, {})}


async def capture(browser, url, size, path):
    s = SIZES[size]
    context = await browser.new_context(viewport={'width': s['width'], 'height': s['height']}, device_scale_factor=s['dpr'],
                                        is_mobile=s['mobile'], has_touch=s['mobile'], user_agent=refs.user_agent(browser))
    page = await context.new_page()
    await page.goto(url + refs.PAGE, wait_until='load')
    await page.evaluate("""async () => { await document.fonts.ready;
        for (const img of document.images) { img.loading = 'eager'; try { await img.decode(); } catch {} } }""")
    await page.wait_for_timeout(3500)
    await page.evaluate(f"() => document.getAnimations().forEach(a => {{ try {{ a.pause(); a.currentTime = {FREEZE_AT_MS}; }} catch {{}} }})")
    await page.wait_for_timeout(300)
    sections = await page.evaluate(SECTIONS)
    movers = await page.evaluate(MOVERS)
    await page.screenshot(path=str(path), full_page=True, animations='allow')
    await context.close()
    return sections, movers


def mean_rgb(image, box):
    return ImageStat.Stat(image.crop(box)).mean


def large_regions(diff, movers, dpr):
    """Connected groups of CELL x CELL cells that are mostly large difference and touch no moving creature."""
    mask = diff.point(lambda v: 255 if v > LARGE else 0)
    w, h = (mask.width + CELL - 1) // CELL, (mask.height + CELL - 1) // CELL
    cells = mask.resize((w, h), Image.Resampling.BOX).load()
    moving = Image.new('L', (w, h), 0)
    for left, top, right, bottom in movers:
        moving.paste(255, (int(left * dpr // CELL) - 1, int(top * dpr // CELL) - 1,
                           int(right * dpr // CELL) + 2, int(bottom * dpr // CELL) + 2))
    moving = moving.load()
    hot = {(x, y) for y in range(h) for x in range(w) if cells[x, y] > 64 and not moving[x, y]}
    regions = []
    while hot:
        start = hot.pop(); queue, members = deque([start]), [start]
        while queue:
            x, y = queue.popleft()
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in hot:
                    hot.remove(n); queue.append(n); members.append(n)
        if len(members) >= 2:          # a lone cell is anti-aliasing, not a region
            xs, ys = [m[0] for m in members], [m[1] for m in members]
            regions.append({'cells': len(members), 'box_css_px': [round(min(xs) * CELL / dpr), round(min(ys) * CELL / dpr),
                                                                  round((max(xs) + 1) * CELL / dpr), round((max(ys) + 1) * CELL / dpr)]})
    return sorted(regions, key=lambda r: -r['cells']), mask


def compare(size, base_png, head_png, sections, movers, out):
    s, limit = SIZES[size], thresholds(size)
    base, head = Image.open(base_png).convert('RGB'), Image.open(head_png).convert('RGB')
    result = {'size': f"{s['width']}x{s['height']}@{s['dpr']}x", 'pixels': list(base.size)}
    failures = []
    if base.size != head.size:              # still compare the shared part, so the report shows where it starts
        failures.append(f'page size differs: base {base.size[0]}x{base.size[1]}, head {head.size[0]}x{head.size[1]}')
        common = (0, 0, min(base.width, head.width), min(base.height, head.height))
        base, head = base.crop(common), head.crop(common)
    diff = ImageChops.difference(base, head).convert('L')
    Image.eval(diff, lambda v: min(255, v * 6)).save(out / f'diff-x6-{size}.png')
    worst = 0.0
    result['sections'] = {}
    for name, left, top, right, bottom in sections:
        box = tuple(round(v * s['dpr']) for v in (left, top, right, bottom))
        b, h = mean_rgb(base, box), mean_rgb(head, box)
        shift = max(abs(x - y) for x, y in zip(b, h))
        worst = max(worst, shift)
        result['sections'][name] = round(shift, 3)
    radius = 2 * s['dpr']                     # wider than a grain fleck, narrower than any cut-paper edge
    soft = ImageChops.difference(base.filter(ImageFilter.GaussianBlur(radius)), head.filter(ImageFilter.GaussianBlur(radius))).convert('L')
    histogram = soft.histogram()
    result['structural_pct'] = round(100 * sum(histogram[9:]) / (base.width * base.height), 4)
    regions, mask = large_regions(diff, movers, s['dpr'])
    result['regions'] = regions[:20]
    overlay = Image.blend(head, Image.new('RGB', head.size, (0, 0, 0)), 0.6)
    overlay.paste((255, 40, 40), mask=mask)
    overlay.save(out / f'large-{size}.png')
    if worst > limit['section_mean']:
        failures.append(f"section mean colour moved {worst:.2f}/255 (limit {limit['section_mean']})")
    if result['structural_pct'] > limit['structural_pct']:
        failures.append(f"structural difference {result['structural_pct']}% (limit {limit['structural_pct']}%)")
    if len(regions) > limit['regions']:
        failures.append(f"{len(regions)} large-difference regions outside the creatures (limit {limit['regions']})")
    result['section_mean_worst'] = round(worst, 3)
    result['verdict'] = 'FAIL' if failures else 'PASS'
    result['reasons'] = failures
    return result


async def run(args):
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'base': args.base, 'head': args.head, 'sizes': {}}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel='chrome', args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
        try:
            with refs.serve(args.base, 8004) as base_url, refs.serve(args.head, 8005) as head_url:
                for size in args.sizes:
                    base_png, head_png = args.out / f'base-{size}.png', args.out / f'head-{size}.png'
                    sections, movers = await capture(browser, base_url, size, base_png)
                    _, head_movers = await capture(browser, head_url, size, head_png)
                    report['sizes'][size] = compare(size, base_png, head_png, sections, movers + head_movers, args.out)
                    r = report['sizes'][size]
                    print(f"[visual] {size}: {r['verdict']} {'; '.join(r.get('reasons', [])) or r.get('reason', '')}", flush=True)
        finally:
            await browser.close()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', default='v1.0-iterative')
    parser.add_argument('--head', required=True)
    parser.add_argument('--sizes', default='desk,tablet,phone')
    parser.add_argument('--out', type=Path, default=Path('visual-out'))
    args = parser.parse_args()
    args.sizes = [s for s in args.sizes.split(',') if s]
    unknown = set(args.sizes) - set(SIZES)
    if unknown:
        parser.error('unknown size: ' + ', '.join(sorted(unknown)))
    report = asyncio.run(run(args))
    (args.out / 'visual.json').write_text(json.dumps(report, indent=1) + '\n', encoding='utf-8', newline='\n')
    for size, r in report['sizes'].items():
        print(f"{size} {r['size']}: {r['verdict']}  section mean worst {r.get('section_mean_worst')}/255, "
              f"structural {r.get('structural_pct')}%, regions {len(r.get('regions', []))}")
    sys.exit(0 if all(r['verdict'] == 'PASS' for r in report['sizes'].values()) else 1)


if __name__ == '__main__':
    main()
