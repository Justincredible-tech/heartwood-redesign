"""Create a fresh allowlisted server-upload folder; never overwrite a prior package.

By default the folder is the client showcase: the landing page (showcase/index.html) is the homepage, the built
Heartwood site sits beside it as living-tree.html, and the alternative mockups and their preview images come
along. Pass --site-only once a design is chosen to package the built site alone as the homepage.
"""
import argparse
import gzip
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit
import brotli

ROOT = Path(__file__).resolve().parent.parent
PUBLISH = (ROOT / 'publish').resolve()
SHOWCASE = (ROOT / 'showcase').resolve()
MOCKUPS = (ROOT / 'mockups').resolve()
FEATURED = 'living-tree.html'          # the built site's name inside the showcase; the landing page links to it
parser = argparse.ArgumentParser()
parser.add_argument('--name', default='upload-ready')
parser.add_argument('--site-only', action='store_true', help='package only the built site, as index.html')
args = parser.parse_args()
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', args.name):
    raise SystemExit('Use a simple folder name without path components.')
destination = PUBLISH / args.name
if destination.exists():
    raise SystemExit('Folder already exists; preserve it and use --name for a fresh package.')
manifest = json.loads((ROOT / 'tools/build-manifest.json').read_text(encoding='utf-8'))
entry = 'index.html' if args.site_only else FEATURED
files = {}            # packaged path -> source file
made = {}             # packaged path -> bytes produced here (compression sidecars for showcase pages)


def add_compressed(packaged, data):
    """Precompress a page the build did not, verified the same way compress-site.py does."""
    gz = gzip.compress(data, compresslevel=9, mtime=0)
    br = brotli.compress(data, quality=11)
    if gzip.decompress(gz) != data or brotli.decompress(br) != data:
        raise SystemExit('Compression mismatch: ' + packaged)
    made[packaged + '.gz'] = gz
    made[packaged + '.br'] = br


for relative in manifest['generated']:
    if not re.fullmatch(r'heartwood-site\.html|(?:css|js)/heartwood-site\.[0-9a-f]{12}\.(?:css|js)|assets/fonts/[A-Za-z0-9.-]+\.(?:woff2|txt)'
                        r'|assets/grain/grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp|assets/meta/[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)', relative):
        raise SystemExit('Unexpected generated file: ' + relative)
    source = (PUBLISH / relative).resolve()
    if not source.is_relative_to(PUBLISH) or not source.is_file():
        raise SystemExit('Missing or escaped generated asset: ' + relative)
    packaged = entry if relative == 'heartwood-site.html' else relative
    files[packaged] = source
    if source.suffix in ('.html', '.css', '.js'):
        original = source.read_bytes()
        for suffix, decoder in (('.gz', gzip.decompress), ('.br', brotli.decompress)):
            compressed = source.with_name(source.name + suffix)
            if decoder(compressed.read_bytes()) != original:
                raise SystemExit('Compression mismatch: ' + relative + suffix)
            files[packaged + suffix] = compressed

if not args.site_only:
    landing = SHOWCASE / 'index.html'
    if not landing.is_file():
        raise SystemExit('Missing showcase/index.html (the landing page).')
    files['index.html'] = landing
    add_compressed('index.html', landing.read_bytes())
    for preview in sorted((SHOWCASE / 'previews').glob('*.webp')):
        if not re.fullmatch(r'[a-z0-9-]+\.webp', preview.name):
            raise SystemExit('Unexpected preview file: ' + preview.name)
        files['assets/previews/' + preview.name] = preview
    for mockup in sorted(MOCKUPS.glob('*.html')):
        if not re.fullmatch(r'[a-z0-9-]+\.html', mockup.name):
            raise SystemExit('Unexpected mockup file: ' + mockup.name)
        files['mockups/' + mockup.name] = mockup
        add_compressed('mockups/' + mockup.name, mockup.read_bytes())

    # Every local link and image on the landing page must land inside the package.
    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.targets = set()

        def handle_starttag(self, tag, attrs):
            for name, value in attrs:
                if name in ('href', 'src') and value and not urlsplit(value).scheme and not value.startswith('#'):
                    self.targets.add(urlsplit(value).path)
    links = Links()
    page = landing.read_text(encoding='utf-8')
    links.feed(page)
    links.targets.update(url for url in re.findall(r'url\(([^)"\']+)\)', page) if not urlsplit(url).scheme)
    missing = sorted(target for target in links.targets if target not in files)
    if missing or FEATURED not in links.targets:
        raise SystemExit('Landing page links outside the package: ' + ', '.join(missing or ['(no link to ' + FEATURED + ')']))

files['.htaccess'] = PUBLISH / '.htaccess'
if not files['.htaccess'].is_file():
    raise SystemExit('Missing hosting configuration.')
destination.mkdir()
records = []
for relative, source in files.items():
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    data = target.read_bytes()
    assert data == source.read_bytes(), 'Copy mismatch: ' + relative
    records.append({'path': relative, 'source': source.relative_to(ROOT).as_posix(),
                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
for relative, data in made.items():
    target = destination / relative
    target.write_bytes(data)
    assert target.read_bytes() == data, 'Write mismatch: ' + relative
    records.append({'path': relative, 'source': 'compressed by package-upload.py',
                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
assert {path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file()} == set(files) | set(made)
report = {'folder': str(destination), 'layout': 'site-only' if args.site_only else 'showcase', 'entry': 'index.html',
          'site': entry, 'files': records, 'total_files': len(records), 'total_bytes': sum(record['bytes'] for record in records),
          'limits': 'Local packaging only. Apache and remote-content availability require host verification.'}
(ROOT / 'tools/upload-package-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'folder': str(destination), 'layout': report['layout'], 'files': len(records), 'bytes': report['total_bytes']}, indent=2))
