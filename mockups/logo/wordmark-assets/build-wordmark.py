"""Compose the wordmark from real Young Serif outlines and the imagegen oak asset."""
from pathlib import Path
import base64
import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'wordmark-assets'
font_path = ASSETS / 'YoungSerif-Regular.ttf'
font = TTFont(font_path)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font['head'].unitsPerEm
size = 400
metrics = ImageFont.truetype(str(font_path), size)
scale = size / units
ink = '#20241f'
paper = '#f3f0e9'
margin = 190
tree_height = 560
tree_bounds = (162, 132, 1092, 1117)
tree_scale = tree_height / (tree_bounds[3] - tree_bounds[1])
slot = 220
baseline = 170 + tree_height
left_width = metrics.getlength('Hear')
right_width = metrics.getlength('wood')
width = round(margin * 2 + left_width + slot + right_width)
height = round(baseline + 175)

def outlined_word(word, start_x):
    x = start_x
    paths = []
    previous = ''
    for char in word:
        if previous:
            x += metrics.getlength(previous + char) - metrics.getlength(previous) - metrics.getlength(char)
        pen = SVGPathPen(glyphs)
        glyphs[cmap[ord(char)]].draw(pen)
        paths.append(f'<path d="{pen.getCommands()}" transform="translate({x:.4f} {baseline}) scale({scale} {-scale})"/>')
        x += metrics.getlength(char)
        previous = char
    return '\n'.join(paths)

center_x = margin + left_width + slot / 2
tree_x = center_x - (tree_bounds[0] + tree_bounds[2]) / 2 * tree_scale
tree_y = baseline - tree_bounds[3] * tree_scale
tree_size = 1254 * tree_scale
asset = base64.b64encode((ASSETS / 'oak-T-11-transparent.png').read_bytes()).decode('ascii')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
<title id="title">Heartwood wordmark</title>
<desc id="desc">Young Serif lettering, with the letter t replaced by the selected oak T icon. Single charcoal color on a warm neutral background.</desc>
<defs>
  <filter id="cleanAlpha" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="0" intercept="1"/><feFuncG type="linear" slope="0" intercept="1"/><feFuncB type="linear" slope="0" intercept="1"/><feFuncA type="linear" slope="1.1" intercept="-0.1"/></feComponentTransfer></filter>
  <mask id="oakShape" maskUnits="userSpaceOnUse" x="0" y="0" width="{width}" height="{height}" style="mask-type:alpha">
    <image x="{tree_x:.5f}" y="{tree_y:.5f}" width="{tree_size:.5f}" height="{tree_size:.5f}" filter="url(#cleanAlpha)" xlink:href="data:image/png;base64,{asset}"/>
  </mask>
</defs>
<rect width="{width}" height="{height}" fill="{paper}"/>
<g fill="{ink}">
{outlined_word('Hear', margin)}
<rect width="{width}" height="{height}" mask="url(#oakShape)"/>
{outlined_word('wood', margin + left_width + slot)}
</g>
</svg>
'''
output = ROOT / 'Heartwood-Young-Serif-oak-wordmark.svg'
output.write_text(svg, encoding='utf-8')
print(json.dumps({'svg': str(output), 'viewBox': [width, height], 'font': font['name'].getDebugName(1), 'treeHeight': tree_height, 'baseline': baseline, 'ink': ink, 'background': paper}))
