"""Track 008 spike: turn a slice of the v1 artwork into inline SVG, in place, on the spike branch only.

    python tools/spike/svgify.py            # rewrites source/heartwood-site.html and prints what it converted

Converts, from inline clip-path pieces to SVG paths with class names:
  - every hero `.cut hills` and `.cut band` layer (the meadow grass and the flowers) into one
    <svg viewBox="0 0 1508 1047"> per layer, each piece a <path class="piece">, using the roadmap transform
        x = (left + px * width / 100) * 1508 / 100,   y = (top + py * height / 100) * 1047 / 100
  - the gravel stratum's stones into an SVG path each. Strata stones are placed in % of their stratum minus
    artwork-scale offsets and keep their own size, so they cannot share one stretched viewBox; each keeps its v1
    box (an <i class="stone">, since Chrome ignores CSS x/y/width/height on a nested <svg>) holding a 0..100 viewBox.
and adds the single grain overlays (.grain-sheet), moving the birds above the hero one so their texture stays
their own. Anything that does not match the expected v1 shape stops the script: it never guesses.
The page must be the v1 source; running it twice fails on purpose.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / 'source/heartwood-site.html'
W, H = 1508, 1047
NUM = r'-?\d+(?:\.\d+)?'
HERO_PIECE = re.compile(rf'<i style="left:({NUM})%;top:({NUM})%;width:({NUM})%;height:({NUM})%;clip-path:polygon\((evenodd,)?([^)]*)\)"></i>')
STONE_PIECE = re.compile(rf'<i(?: class="(stone--(?:tablet|phone)-hidden)")? style="left:calc\(({NUM})% - ({NUM}) \* var\(--u\)\);'
                         rf'top:calc\(({NUM})% - ({NUM}) \* var\(--u\)\);width:calc\(({NUM}) \* var\(--u\)\);height:calc\(({NUM}) \* var\(--u\)\);'
                         rf'clip-path:polygon\((evenodd,)?([^)]*)\)"></i>')


def fmt(v):
    return f'{v:.3f}'.rstrip('0').rstrip('.') or '0'


def points(polygon):
    out = []
    for pair in polygon.split(','):
        x, y = pair.split()
        if not (x.endswith('%') and y.endswith('%')):
            raise SystemExit('Non-percentage polygon point: ' + pair)
        out.append((float(x[:-1]), float(y[:-1])))
    return out


def path(pts):
    return 'M' + 'L'.join(f'{fmt(x)} {fmt(y)}' for x, y in pts) + 'Z'


def whole(pattern, inner, what):
    """All of `inner` must be pieces of `pattern`; return the matches."""
    found = list(pattern.finditer(inner))
    if ''.join(m.group(0) for m in found) != inner:
        raise SystemExit(f'Unexpected markup inside {what}: {inner[:200]!r}')
    return found


def hero_layer(match):
    classes, style, inner = match.group(1), match.group(2), match.group(3)
    paths = []
    for p in whole(HERO_PIECE, inner, classes):
        left, top, width, height = (float(p.group(i)) for i in range(1, 5))
        pts = [((left + px * width / 100) * W / 100, (top + py * height / 100) * H / 100) for px, py in points(p.group(6))]
        rule = '' if p.group(5) else ' fill-rule="nonzero"'
        paths.append(f'<path class="piece" d="{path(pts)}"{rule}/>')
    style_attr = f' style="{style}"' if style else ''
    hero_layer.count += len(paths)
    return (f'<svg class="{classes}"{style_attr} viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true" '
            f'focusable="false">{"".join(paths)}</svg>')


hero_layer.count = 0


def stones_layer(match):
    classes, style, inner = match.group(1), match.group(2), match.group(3)
    stones = []
    for p in whole(STONE_PIECE, inner, classes):
        hide = p.group(1)
        box = (f'left:calc({p.group(2)}% - {p.group(3)} * var(--u));top:calc({p.group(4)}% - {p.group(5)} * var(--u));'
               f'width:calc({p.group(6)} * var(--u));height:calc({p.group(7)} * var(--u))')
        rule = '' if p.group(8) else ' fill-rule="nonzero"'
        cls = 'stone' + (f' {hide}' if hide else '')
        # Chrome ignores CSS x/y/width/height on a nested <svg>, so each stone keeps its v1 box as an HTML element
        stones.append(f'<i class="{cls}" style="{box}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">'
                      f'<path class="piece" d="{path(points(p.group(9)))}"{rule}/></svg></i>')
    stones_layer.count += len(stones)
    style_attr = f' style="{style}"' if style else ''
    return f'<div aria-hidden="true" class="{classes}"{style_attr}>{"".join(stones)}</div>'


stones_layer.count = 0


def tear_clip(stratum):
    """The gravel grain sheet reaches 18 artwork units below its stratum and is cut along the lower torn edge."""
    tear = re.search(r'<i class="tear" style="--c:#ddd4c1;--c2:#ddd4c1;clip-path:polygon\(([^)]*)\)"></i>', stratum)
    if not tear:
        raise SystemExit('Gravel stratum lost its pale torn edge.')
    pts = points(tear.group(1))
    if pts[:2] != [(0, 0), (100, 0)]:
        raise SystemExit('Torn edge no longer starts along its top: ' + tear.group(1)[:60])
    edge = ','.join(f'{fmt(x)}% calc(100% - {fmt(36 - y * .36)} * var(--u))' for x, y in pts[2:])
    return f'polygon(0 0,100% 0,{edge})'


def main():
    html = HTML.read_text(encoding='utf-8')
    if 'grain-sheet' in html:
        raise SystemExit('Already converted (grain-sheet present). Start from the v1 source.')
    before = len(html.encode('utf-8'))
    scene_start, scene_end = html.index('<div class="scene" aria-hidden="true">'), html.index('<div class="cut soil"')
    scene = html[scene_start:scene_end]
    hero = re.compile(r'<div class="(cut (?:hills|band(?: flowers)?))"(?: style="([^"]*)")?>(.*?)</div>(?=\n)')
    scene, layers = hero.subn(hero_layer, scene)
    birds = re.search(r'\n(\s*)<!-- birds:[^\n]*\n\s*<div class="birds">.*?</div>(?=\n\s*<svg class="cut band)', scene, re.S)
    if not birds:
        raise SystemExit('Birds are no longer directly before the meadow bands.')
    scene = scene.replace(birds.group(0), '', 1)
    last_band = scene.rindex('</svg>') + len('</svg>')
    indent = birds.group(1)
    sheet = f'\n{indent}<!-- one sheet of paper grain over all the static scenery above; the birds fly over it with their own -->\n{indent}<div class="grain-sheet" aria-hidden="true"></div>'
    scene = scene[:last_band] + sheet + birds.group(0) + scene[last_band:]
    html = html[:scene_start] + scene + html[scene_end:]

    gravel_start = html.index('<div class="stratum stratum--gravel"')
    gravel_end = html.index('\n', gravel_start)
    stratum = html[gravel_start:gravel_end]
    clip = tear_clip(stratum)
    stones = re.compile(r'<div aria-hidden="true" class="(cut stones(?: stones--bed| stones--in)?)"(?: style="([^"]*)")?>(.*?)</div>')
    stratum, stone_layers = stones.subn(stones_layer, stratum)
    stratum += f'<div class="grain-sheet grain-sheet--torn" aria-hidden="true" style="clip-path:{clip}"></div>'
    html = html[:gravel_start] + stratum + html[gravel_end:]

    HTML.write_text(html, encoding='utf-8', newline='\n')
    after = len(html.encode('utf-8'))
    print(f'hero: {layers} layers, {hero_layer.count} pieces -> paths')
    print(f'gravel stratum: {stone_layers} stones layers, {stones_layer.count} stones -> box + svg + path')
    print(f'source HTML {before:,} -> {after:,} bytes')


if __name__ == '__main__':
    sys.exit(main())
