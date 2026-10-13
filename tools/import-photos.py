"""Make small local copies of the heartwood.org photos the page shows.

The Heartbeat cover and the Forest Council poster are linked from heartwood.org as full-size JPEGs (2.3 MB and
4.9 MB, about 3000 x 4100 px), but the page never shows them wider than 17rem. This script resizes each original
to a few widths, saves them as WebP with content hashes in source/assets/photos/, records where each came from in
photos-provenance.json, and rewrites the PHOTOS block in source/js/heartwood-site.js so the page uses them. The
original address stays the key, and every link still points at heartwood.org.

Download the originals yourself (heartwood.org turns away non-browser clients), then pass each address with its file:

    python import-photos.py https://heartwood.org/heartbeat/Fall-2026.jpg Fall-2026.jpg [<url> <file> ...]

Every photo the page uses must be passed on each run; files no longer named are removed. Needs Pillow.
"""
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'source/assets/photos'
JS = ROOT / 'source/js/heartwood-site.js'
WIDTHS = (360, 720, 1080)          # 17rem at 1x, 2x and 3x, rounded up
QUALITY = 86


def slug(url):
    return re.sub(r'[^a-z0-9]+', '-', url.rsplit('/', 1)[1].rsplit('.', 1)[0].lower()).strip('-')


def encode(original, width):
    image = original.resize((width, round(original.height * width / original.width)), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, 'WEBP', quality=QUALITY, method=6)
    return image.size, buffer.getvalue()


def main(args):
    if not args or len(args) % 2:
        raise SystemExit(__doc__)
    pairs = list(zip(args[::2], args[1::2]))
    js = JS.read_text(encoding='utf-8')
    for url, _ in pairs:
        if not url.startswith('https://heartwood.org/') or "ORIGIN + '" + url[len('https://heartwood.org'):] + "'" not in js:
            raise SystemExit('Not a photo the page uses: ' + url)
    OUT.mkdir(parents=True, exist_ok=True)
    provenance, keep, entries = {}, set(), []
    for url, file in pairs:
        data = Path(file).read_bytes()
        opened = Image.open(io.BytesIO(data))
        if opened.info.get('icc_profile') or opened.mode not in ('RGB', 'L'):
            raise SystemExit('Colour profile or ' + opened.mode + ' in ' + file + ': convert it to plain sRGB first.')
        original = ImageOps.exif_transpose(opened).convert('RGB')
        files = []
        for width in WIDTHS:
            if width > original.width:
                break
            (w, h), webp = encode(original, width)
            name = f'{slug(url)}-{w}.{hashlib.sha256(webp).hexdigest()[:12]}.webp'
            (OUT / name).write_bytes(webp)
            keep.add(name)
            files.append({'file': name, 'width': w, 'height': h, 'bytes': len(webp)})
        provenance[url] = {'source_sha256': hashlib.sha256(data).hexdigest(), 'source_bytes': len(data),
                           'source_size': list(original.size), 'quality': QUALITY, 'files': files}
        sizes = ', '.join(f"['assets/photos/{f['file']}', {f['width']}]" for f in files)
        entries.append(f"  '{url}': [{sizes}],")
    for stale in OUT.glob('*.webp'):
        if stale.name not in keep:
            stale.unlink()
    (OUT / 'photos-provenance.json').write_text(json.dumps({'photos': provenance}, indent=2) + '\n', encoding='utf-8', newline='\n')
    block = '/* photos:start */\nconst PHOTOS = {\n' + '\n'.join(entries) + '\n};\n/* photos:end */'
    js, count = re.subn(r'/\* photos:start \*/.*?/\* photos:end \*/', lambda _: block, js, flags=re.S)
    if count != 1:
        raise SystemExit('Expected one photos:start/end block in ' + str(JS))
    JS.write_text(js, encoding='utf-8', newline='\n')   # the repo stores LF; Windows text mode would write CRLF
    for url, record in provenance.items():
        print(url, record['source_bytes'], '->', ', '.join(f"{f['width']}w {f['bytes']}" for f in record['files']))


if __name__ == '__main__':
    main(sys.argv[1:])
