"""Draw the fine half of the paper grain once, into a tile per screen density.

The grain recipe lives in source/css/heartwood-site.css as --grain-fine (flecks and fibres). Painting those
eight gradient layers live on every piece of paper was the slowest part of the first paint, so this script has
Chrome draw exactly that recipe into a transparent 256px tile at each common device-pixel ratio. Each tile is
Chrome's own rendering, stored as lossless WebP, so laying it over a colour gives the same result as painting the
layers over that colour. The flecks and fibres keep their size, spacing, angle, colour and strength; only where
the pattern starts on each piece shifts.

It writes the tiles to source/assets/grain/ with content hashes, points the CSS at them, and records the recipe
hash in grain-provenance.json so test-delivery.py can tell when the recipe changed but the tiles were not
redrawn. Needs Python Playwright with installed Chrome, and Pillow. Run it after editing --grain-fine:

    python render-grain.py
"""
import asyncio
import hashlib
import io
import json
import re
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / 'source/css/heartwood-site.css'
OUT = ROOT / 'source/assets/grain'
TILE = 256                                              # CSS px; every density below gives whole device pixels
DENSITIES = ('1', '1.25', '1.5', '1.75', '2', '2.5', '3')


def recipe(css):
    match = re.search(r'--grain-fine:\s*(.*?);', css, re.S)
    if not match:
        raise SystemExit('No --grain-fine recipe in the stylesheet.')
    return ' '.join(match.group(1).split())


async def render(fine):
    tiles = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        for density in DENSITIES:
            context = await browser.new_context(viewport={'width': TILE, 'height': TILE}, device_scale_factor=float(density))
            page = await context.new_page()
            await page.set_content(
                '<!doctype html><html style="background:transparent"><body style="margin:0;background:transparent">'
                f'<div id="tile" style="width:{TILE}px;height:{TILE}px;background:{fine}"></div></body></html>')
            png = await page.locator('#tile').screenshot(omit_background=True)
            await context.close()
            image = Image.open(io.BytesIO(png)).convert('RGBA')
            side = round(TILE * float(density))
            if image.size != (side, side):
                raise SystemExit(f'Tile at {density}x came out {image.size}, expected {side}px.')
            webp = io.BytesIO()
            image.save(webp, 'WEBP', lossless=True, quality=100, method=6, exact=True)
            if Image.open(io.BytesIO(webp.getvalue())).convert('RGBA').tobytes() != image.tobytes():
                raise SystemExit(f'WebP at {density}x is not lossless.')
            tiles[density] = webp.getvalue()
        await browser.close()
    return tiles


def main():
    css = CSS.read_text(encoding='utf-8')
    fine = recipe(css)
    tiles = asyncio.run(render(fine))
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('grain-fine-*.webp'):
        old.unlink()
    names = {}
    for density, data in tiles.items():
        name = f'grain-fine-{TILE}@{density}x.{hashlib.sha256(data).hexdigest()[:12]}.webp'
        (OUT / name).write_bytes(data)
        names[density] = name
    # Point every --grain-tile declaration at the tile drawn for its density.
    def point(match):
        return f'{match.group(1)}../assets/grain/{names[match.group(2)]}{match.group(3)}'
    updated, count = re.subn(r'(--grain-tile:\s*url\()\.\./assets/grain/grain-fine-\d+@([\d.]+)x\.[0-9a-f]{12}\.webp(\))', point, css)
    if count != len(DENSITIES):
        raise SystemExit(f'Expected {len(DENSITIES)} --grain-tile declarations in the stylesheet, found {count}.')
    CSS.write_text(updated, encoding='utf-8', newline='\n')
    provenance = {
        'recipe_sha256': hashlib.sha256(fine.encode('utf-8')).hexdigest(),
        'tile_css_px': TILE,
        'tiles': {density: {'file': names[density], 'bytes': len(tiles[density])} for density in DENSITIES},
        'renderer': 'Chrome via Playwright, transparent background, lossless WebP verified by decode',
    }
    (OUT / 'grain-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(provenance, indent=2))


if __name__ == '__main__':
    main()
