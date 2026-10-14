"""Favicons and link-preview (share) images, drawn from the real artwork.

- Favicon: the tree mark (`hw-mark` in source/assets/logos/heartwood-logos.svg) in cream on a Heartwood-green
  rounded square, which stays legible on light and dark browser tabs. SVG, a 32px PNG, and a 180px square for
  iPhone home screens (iOS rounds its corners itself, so that one is full-bleed).
- Share images, 1200x630: the Living Tree hero exactly as the built site draws it, and a card for the showcase
  landing page that frames that hero beside the wordmark.

Files land in source/assets/meta/ with content hashes, so a changed image gets a new URL and link-preview caches
pick it up. The tags are rewritten between `<!-- meta:start -->` and `<!-- meta:end -->` in the site source, the
landing page, and the two mockups that have no icon of their own. Share images need absolute URLs, so the public
base address is a parameter.

Run after a build, then build again (the build copies these files):

    npm run build && python render-meta-images.py && npm run build

Needs Python Playwright with installed Chrome, and Pillow.
"""
import argparse
import asyncio
import base64
import hashlib
import html
import io
import re
import sys
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))   # same-directory helper; kept loadable under importlib loaders too
from site_address import authored_base
SOURCE = ROOT / 'source'
OUT = SOURCE / 'assets/meta'
LOGOS = (SOURCE / 'assets/logos/heartwood-logos.svg').read_text(encoding='utf-8')
GREEN, CREAM, INK, PAPER = '#3f6b3f', '#fbf8ee', '#1e2a21', '#fbf8ee'

# page -> (path from the page to the package root, share image or None, title, description, page URL suffix)
PAGES = {
    SOURCE / 'heartwood-site.html': ('', 'living-tree', None, None, 'living-tree.html'),
    ROOT / 'showcase/index.html': ('', 'showcase', None, None, ''),
    ROOT / 'mockups/concept-b-atlas.html': ('../', None, None, None, None),
    ROOT / 'mockups/concept-c-rings.html': ('../', None, None, None, None),
}


def symbol(name):
    match = re.search(rf'<symbol id="{name}" viewBox="([^"]+)"[^>]*>(.*?)</symbol>', LOGOS, re.S)
    return match.group(1), match.group(2)


def icon_svg(pad, radius):
    (x, y, w, h), inner = [float(v) for v in symbol('hw-mark')[0].split()], symbol('hw-mark')[1]
    side = max(w, h) * (1 + 2 * pad)
    left, top = x + w / 2 - side / 2, y + h / 2 - side / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left:g} {top:g} {side:g} {side:g}">'
            f'<rect x="{left:g}" y="{top:g}" width="{side:g}" height="{side:g}" rx="{side * radius:g}" fill="{GREEN}"/>'
            f'<g color="{CREAM}" style="color:{CREAM}">{inner.strip()}</g></svg>')


async def render(built):
    images = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        context = await browser.new_context(device_scale_factor=2)
        page = await context.new_page()
        # Favicons: the SVG itself, then rasterised sizes.
        images['favicon.svg'] = icon_svg(.10, .22).encode('utf-8')
        for name, size, svg in (('favicon-32.png', 32, icon_svg(.10, .22)), ('apple-touch-icon.png', 180, icon_svg(.16, 0))):
            await page.set_viewport_size({'width': size, 'height': size})
            await page.set_content(f'<html style="margin:0;background:transparent"><body style="margin:0;background:transparent">'
                                   f'<img src="data:image/svg+xml;base64,{base64.b64encode(svg.encode()).decode()}" width="{size}" height="{size}" style="display:block"></body></html>')
            await page.wait_for_timeout(200)
            shot = Image.open(io.BytesIO(await page.screenshot(omit_background=True))).convert('RGBA')
            out = io.BytesIO()
            shot.resize((size, size), Image.LANCZOS).save(out, 'PNG', optimize=True)
            images[name] = out.getvalue()
        # The Living Tree hero, as the built site draws it, creatures caught mid-flight.
        await page.set_viewport_size({'width': 1440, 'height': 756})
        await page.goto(built.as_uri())
        await page.wait_for_timeout(3500)
        await page.evaluate("document.getAnimations().forEach(a => { try { a.pause(); a.currentTime = 7300 } catch (e) {} })")
        await page.wait_for_timeout(300)
        hero = Image.open(io.BytesIO(await page.screenshot())).convert('RGB')
        out = io.BytesIO()
        hero.resize((1200, 630), Image.LANCZOS).save(out, 'JPEG', quality=88, optimize=True, progressive=True)
        images['share-living-tree.jpg'] = out.getvalue()
        # The showcase card: wordmark and words on paper, the hero framed beside them.
        hero_png = io.BytesIO()
        hero.save(hero_png, 'PNG')
        hero_uri = 'data:image/png;base64,' + base64.b64encode(hero_png.getvalue()).decode()
        view, inner = symbol('hw-logo')
        fonts = SOURCE / 'assets/fonts'
        serif = next(fonts.glob('young-serif-latin.*.woff2')).as_uri()
        sans = next(fonts.glob('instrument-sans-latin.*.woff2')).as_uri()
        grain = sorted((SOURCE / 'assets/grain').glob('grain-fine-256@2x.*.webp'))[0].as_uri()
        card = f'''<!doctype html><html><head><style>
@font-face{{font-family:S;src:url({serif})}} @font-face{{font-family:I;font-weight:400 700;src:url({sans})}}
html,body{{margin:0;width:1200px;height:630px;overflow:hidden}}
body{{background:url({grain}) 0 0/256px 256px,{PAPER};color:{INK};font-family:I;display:grid;grid-template-columns:470px 1fr;align-items:center}}
.l{{padding:0 0 0 64px}} .k{{font:600 17px/1 I;letter-spacing:.16em;text-transform:uppercase;color:{GREEN};margin:26px 0 14px}}
svg{{display:block;height:118px;width:auto;color:#20241f;margin-left:-6px}}
h1{{font:400 50px/1.06 S;margin:0}} p{{font:400 21px/1.4 I;color:#55655a;margin:18px 0 0;max-width:22ch}}
.f{{margin-right:-90px;border-radius:14px;overflow:hidden;background:#e9e3cf;border:1px solid #c4b994;box-shadow:0 2px 3px rgb(30 42 33/.1),0 28px 50px -22px rgb(30 42 33/.45)}}
.b{{height:30px;display:flex;gap:7px;align-items:center;padding:0 14px;border-bottom:1px solid #c4b994}} .b i{{width:10px;height:10px;border-radius:50%;background:#c4b994}}
.f img{{display:block;width:100%}}
</style></head><body><div class="l"><svg viewBox="{view}">{inner}</svg><div class="k">Website redesign</div>
<h1>A new home for Heartwood online</h1><p>One recommended design and five alternatives to explore.</p></div>
<div class="f"><div class="b"><i></i><i></i><i></i></div><img src="{hero_uri}"></div></body></html>'''
        await page.set_viewport_size({'width': 1200, 'height': 630})
        await page.set_content(card)
        await page.evaluate('document.fonts.ready')
        await page.wait_for_timeout(400)
        shot = Image.open(io.BytesIO(await page.screenshot())).convert('RGB')
        out = io.BytesIO()
        shot.resize((1200, 630), Image.LANCZOS).save(out, 'JPEG', quality=88, optimize=True, progressive=True)
        images['share-showcase.jpg'] = out.getvalue()
        await browser.close()
    return images


def tags(prefix, names, share, base, page_url, title, description):
    lines = [f'<link rel="icon" href="{prefix}assets/meta/{names["favicon.svg"]}" type="image/svg+xml">',
             f'<link rel="icon" href="{prefix}assets/meta/{names["favicon-32.png"]}" type="image/png" sizes="32x32">',
             f'<link rel="apple-touch-icon" href="{prefix}assets/meta/{names["apple-touch-icon.png"]}">',
             f'<meta name="theme-color" content="{GREEN}">']
    if share:
        image = f'{base}assets/meta/{names[f"share-{share}.jpg"]}'
        alt = ('The Living Tree design: a cut-paper tree in a meadow, its roots spreading underground'
               if share == 'living-tree' else 'Heartwood website redesign: the Living Tree design and five alternatives')
        lines += [f'<link rel="canonical" href="{base}{page_url}">',
                  '<meta property="og:type" content="website">',
                  '<meta property="og:site_name" content="Heartwood">',
                  f'<meta property="og:url" content="{base}{page_url}">',
                  f'<meta property="og:title" content="{html.escape(title)}">',
                  f'<meta property="og:description" content="{html.escape(description)}">',
                  f'<meta property="og:image" content="{image}">',
                  '<meta property="og:image:type" content="image/jpeg">',
                  '<meta property="og:image:width" content="1200">',
                  '<meta property="og:image:height" content="630">',
                  f'<meta property="og:image:alt" content="{alt}">',
                  '<meta name="twitter:card" content="summary_large_image">',
                  f'<meta name="twitter:title" content="{html.escape(title)}">',
                  f'<meta name="twitter:description" content="{html.escape(description)}">',
                  f'<meta name="twitter:image" content="{image}">',
                  f'<meta name="twitter:image:alt" content="{alt}">']
    return '<!-- meta:start -->\n' + '\n'.join(lines) + '\n<!-- meta:end -->'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default=None, help='public address of the package root (default: the authored canonical base from source/heartwood-site.html)')
    args = parser.parse_args()
    base = (args.base or authored_base()).rstrip('/') + '/'
    built = ROOT / 'publish/heartwood-site.html'
    if not built.is_file():
        raise SystemExit('Build first: npm run build')
    images = asyncio.run(render(built))
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        old.unlink()
    names = {}
    for name, data in images.items():
        stem, ext = name.rsplit('.', 1)
        names[name] = f'{stem}.{hashlib.sha256(data).hexdigest()[:12]}.{ext}'
        (OUT / names[name]).write_bytes(data)
    # The two pages that get shared keep their own titles; drop the landing page's old hand-written og tags.
    shares = {'living-tree': ('Heartwood: the Living Tree design',
                              'A cut-paper tree where every leaf opens a piece of Heartwood: campaigns, gatherings, news and member groups.'),
              'showcase': ('Heartwood website redesign: design concepts',
                           'One recommended design and five alternatives, each a clickable mockup.')}
    for page, (prefix, share, _, _, url) in PAGES.items():
        text = page.read_text(encoding='utf-8')
        text = re.sub(r'<meta property="og:(?:title|description)" content="[^"]*">\n', '', text) if share == 'showcase' else text
        title, description = shares.get(share, (None, None))
        block = tags(prefix, names, share, base, url, title, description)
        if '<!-- meta:start -->' in text:
            text = re.sub(r'<!-- meta:start -->.*?<!-- meta:end -->', lambda _: block, text, flags=re.S)
        else:
            text, count = re.subn(r'(<meta name="description" content="[^"]*">)', lambda m: m.group(1) + '\n' + block, text, count=1)
            if count != 1:
                raise SystemExit(f'No <meta name="description"> to anchor the tags in {page}')
        page.write_text(text, encoding='utf-8', newline='\n')
        print('tagged', page.relative_to(ROOT))
    for name in names.values():
        print('wrote source/assets/meta/' + name, (OUT / name).stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
