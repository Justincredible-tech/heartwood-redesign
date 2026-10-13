"""Cut reviewable side-by-sides (before | after | difference x4) from visual.py's full-page captures."""
import json, sys
from pathlib import Path
from PIL import Image, ImageChops

src, out = Path(sys.argv[1]), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
DPR = {'desk': 1, 'tablet': 2, 'phone': 2}


def side(size, box_css, name, max_w=1800):
    d = DPR[size]
    a = Image.open(src / f'base-{size}.png').convert('RGB'); b = Image.open(src / f'head-{size}.png').convert('RGB')
    box = tuple(int(v * d) for v in box_css)
    a, b = a.crop(box), b.crop(box)
    diff = ImageChops.difference(a, b).convert('L').point(lambda v: min(255, v * 4)).convert('RGB')
    w, h = a.size
    row = Image.new('RGB', (w * 3 + 40, h), (255, 255, 255))
    for i, im in enumerate((a, b, diff)):
        row.paste(im, (i * (w + 20), 0))
    if row.width > max_w:
        row = row.resize((max_w, round(row.height * max_w / row.width)), Image.Resampling.LANCZOS)
    row.save(out / f'{name}.jpg', quality=90)


stage = {'desk': (0, 0, 1440, 1000), 'tablet': (0, 0, 768, 1024), 'phone': (0, 0, 390, 844)}
for size, box in stage.items():
    side(size, box, f'scene-{size}')
side('desk', (300, 330, 700, 480), 'meadow-desk-zoom', max_w=2400)
report = json.loads((src / 'visual.json').read_text(encoding='utf-8'))
gravel = report['sizes']['desk'].get('gravel_box')
print('written to', out)
