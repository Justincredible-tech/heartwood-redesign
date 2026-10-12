"""Preview images for the showcase landing page (showcase/previews/).

Living Tree is captured from the built site (desktop 1440x900, and a 390x844 phone at 2x). Each alternative mockup
is captured as a whole page, which the landing page scrolls through on hover. Run after a build:

    python render-previews.py                    # everything
    python render-previews.py --only living-tree # just the Living Tree pair

Needs Python Playwright with installed Chrome, and Pillow.
"""
import argparse
import asyncio
import io
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'showcase/previews'
MOCKUPS = {'evergreen': '01-evergreen.html', 'rally': '02-rally.html', 'fieldnotes': '03-fieldnotes.html',
           'atlas': 'concept-b-atlas.html', 'rings': 'concept-c-rings.html'}


def save(png, name, width, quality):
    image = Image.open(io.BytesIO(png)).convert('RGB')
    if image.width != width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    image.save(OUT / name, 'WEBP', quality=quality, method=6)
    print(f'wrote showcase/previews/{name} {image.size[0]}x{image.size[1]} {(OUT / name).stat().st_size // 1024} KB')


async def capture(browser, url, width, height, scale, mobile, full_page):
    context = await browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=scale,
                                        is_mobile=mobile, has_touch=mobile)
    page = await context.new_page()
    await page.goto(url, wait_until='load', timeout=60000)
    await page.wait_for_timeout(3500)                    # let the leaves grow in and the fonts settle
    png = await page.screenshot(full_page=full_page)
    await context.close()
    return png


async def main(only):
    built = ROOT / 'publish/heartwood-site.html'
    if not built.is_file():
        raise SystemExit('Build first: npm run build')
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        if only in (None, 'living-tree'):
            save(await capture(browser, built.as_uri(), 1440, 900, 1, False, False), 'living-tree-desktop.webp', 1440, 82)
            save(await capture(browser, built.as_uri(), 390, 844, 2, True, False), 'living-tree-phone.webp', 600, 80)
        if only in (None, 'mockups'):
            for name, file in MOCKUPS.items():
                save(await capture(browser, (ROOT / 'mockups' / file).as_uri(), 1440, 900, 1, False, True), f'{name}-page.webp', 880, 76)
        await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', choices=['living-tree', 'mockups'])
    asyncio.run(main(parser.parse_args().only))
