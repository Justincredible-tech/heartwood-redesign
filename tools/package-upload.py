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
from build_features import manifest_features

ROOT = Path(__file__).resolve().parent.parent
PUBLISH = ROOT / 'publish'             # lexical: admission must see the real spelling, never a resolved target
SHOWCASE = ROOT / 'showcase'           # lexical for the same reason
MOCKUPS = ROOT / 'mockups'             # lexical for the same reason
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
if PUBLISH.is_symlink():
    raise SystemExit(f'Refusing symlinked publish root: {PUBLISH}')   # admitted before any manifest/source/output work
manifest = json.loads((ROOT / 'tools/build-manifest.json').read_text(encoding='utf-8'))
try:
    features = manifest_features(manifest, allow_legacy=True)
except ValueError as error:
    raise SystemExit(str(error)) from error
generated = manifest.get('generated')
if not isinstance(generated, list) or not generated or len(generated) > 2048 or len(set(generated)) != len(generated):
    raise SystemExit('Build manifest has no unique bounded output roster')
required = {'heartwood-site.html', 'desktop-day.html', 'experience-entry.html', 'taste/index.html', 'taste/scene.html'}
if features['phone']:
    required.update({'mobile/index.html', 'mobile/day.html', 'mobile/manifest.json'})
    if features['night']:
        required.add('mobile/night.html')
if not required.issubset(generated):
    raise SystemExit('Build manifest omits required route families')
if not features['phone'] and any(path.startswith('mobile/') for path in manifest['generated']):
    raise SystemExit('Excluded phone files in build manifest')
if not features['night'] and any(path == 'mobile/night.html' or re.search(r'mobile/assets/[^/]*-night(?:@|\.)', path) for path in manifest['generated']):
    raise SystemExit('Excluded night files in build manifest')
output_records = {record['path']: record for record in manifest.get('outputs', [])}
if output_records and set(output_records) != set(manifest['generated']):
    raise SystemExit('Build output provenance does not cover its manifest')
entry = 'index.html' if args.site_only else FEATURED
files = {}            # packaged path -> source file
made = {}             # packaged path -> bytes produced here (compression sidecars for showcase pages)


def contained_source(root, path):
    """A package source must be a real file whose lexical root and every relative ancestor stay inside the
    canonical project: no symlinked root, no symlinked directory along the way, no symlinked file, and
    nothing resolving outside ROOT. (Junctions/reparse points are covered by the resolved check; no native
    Windows execution is claimed here.)"""
    if root.is_symlink():
        raise SystemExit(f'Refusing symlinked package root: {root}')
    try:
        relative = path.relative_to(root)
    except ValueError:
        raise SystemExit(f'Package source is not under its root: {path}')
    walked = root
    for part in relative.parts[:-1]:
        walked = walked / part
        if walked.is_symlink():
            raise SystemExit(f'Refusing symlinked package ancestor: {walked}')
    if path.is_symlink():
        raise SystemExit(f'Refusing symlinked package source: {path}')
    resolved = path.resolve()
    if not resolved.is_relative_to(ROOT.resolve()) or not resolved.is_file():
        raise SystemExit(f'Package source escapes the project: {path}')
    return path


def add_compressed(packaged, data):
    """Precompress a page the build did not, verified the same way compress-site.py does."""
    gz = gzip.compress(data, compresslevel=9, mtime=0)
    br = brotli.compress(data, quality=11)
    if gzip.decompress(gz) != data or brotli.decompress(br) != data:
        raise SystemExit('Compression mismatch: ' + packaged)
    made[packaged + '.gz'] = gz
    made[packaged + '.br'] = br


for relative in manifest['generated']:
    if not re.fullmatch(r'(?:heartwood-site|desktop-day|experience-entry)\.html|(?:css|js)/heartwood-site\.[0-9a-f]{12}\.(?:css|js)|assets/fonts/[A-Za-z0-9.-]+\.(?:woff2|txt)'
                        r'|assets/grain/(?:grain-fine(?:-night)?-\d+@[\d.]+x\.[0-9a-f]{12}|[A-Za-z0-9@._-]+\.[0-9a-f]{12,16})\.webp|assets/meta/[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)'
                        r'|assets/photos/[a-z0-9-]+-\d+\.[0-9a-f]{12}\.webp'
                        r'|taste/(?:index|scene)\.html|(?:css|js)/heartwood-taste(?:-head)?\.[0-9a-f]{12}\.(?:css|js)'
                        r'|mobile/(?:index|day|night)\.html|mobile/manifest\.json|mobile/assets/[A-Za-z0-9@._-]+\.[0-9a-f]{16}\.(?:avif|webp|woff2|svg|png|css|js|txt)', relative):
        raise SystemExit('Unexpected generated file: ' + relative)
    # Legacy Day tile names remain supported. New tile families need the exact
    # producer's manifest provenance, rather than admission by a Night substring.
    if relative.startswith('assets/grain/') and not re.fullmatch(r'assets/grain/grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp', relative) and relative not in output_records:
        raise SystemExit('New grain asset has no build provenance: ' + relative)
    source = contained_source(PUBLISH, PUBLISH / relative)      # symlinked ancestors/files and escapes refused before reading
    if relative in output_records:
        body = source.read_bytes()
        recorded = output_records[relative]
        if len(body) != recorded['bytes'] or hashlib.sha256(body).hexdigest() != recorded['sha256']:
            raise SystemExit('Build output changed before packaging: ' + relative)
    packaged = entry if relative == 'experience-entry.html' else 'desktop-day.html' if relative == 'heartwood-site.html' else relative
    if packaged in files and files[packaged].read_bytes() != source.read_bytes():
        raise SystemExit('Conflicting packaged body: ' + packaged)
    if not args.site_only and packaged == 'desktop-day.html':
        original = source.read_bytes()
        data = original.replace(b'<html ', b'<html data-hw-public-entry="living-tree.html" ', 1)
        if data == original:
            raise SystemExit('Missing packaged body root element')
        if packaged in made:
            if made[packaged] != data:
                raise SystemExit('Conflicting packaged main scene')
            continue
        made[packaged] = data
        add_compressed(packaged, data)
        continue
    files[packaged] = source
    if source.suffix in ('.html', '.css', '.js'):
        original = source.read_bytes()
        for suffix, decoder in (('.gz', gzip.decompress), ('.br', brotli.decompress)):
            compressed = contained_source(PUBLISH, source.with_name(source.name + suffix))
            if decoder(compressed.read_bytes()) != original:
                raise SystemExit('Compression mismatch: ' + relative + suffix)
            files[packaged + suffix] = compressed

if not args.site_only:
    landing = contained_source(SHOWCASE, SHOWCASE / 'index.html')
    files['index.html'] = landing
    add_compressed('index.html', landing.read_bytes())
    for preview in sorted((SHOWCASE / 'previews').glob('*.webp')):
        if not re.fullmatch(r'[a-z0-9-]+\.webp', preview.name):
            raise SystemExit('Unexpected preview file: ' + preview.name)
        files['assets/previews/' + preview.name] = contained_source(SHOWCASE, preview)
    for mockup in sorted(MOCKUPS.glob('*.html')):
        if not re.fullmatch(r'[a-z0-9-]+\.html', mockup.name):
            raise SystemExit('Unexpected mockup file: ' + mockup.name)
        files['mockups/' + mockup.name] = contained_source(MOCKUPS, mockup)
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

files['.htaccess'] = contained_source(PUBLISH, PUBLISH / '.htaccess')
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
    records.append({'path': relative, 'source': 'created by package-upload.py',
                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
assert {path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file()} == set(files) | set(made)
report = {'features': features, 'folder': str(destination), 'layout': 'site-only' if args.site_only else 'showcase', 'entry': 'index.html',
          'site': entry, 'files': records, 'total_files': len(records), 'total_bytes': sum(record['bytes'] for record in records),
          'limits': 'Local packaging only. Apache and remote-content availability require host verification.'}
(ROOT / 'tools/upload-package-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'folder': str(destination), 'layout': report['layout'], 'files': len(records), 'bytes': report['total_bytes']}, indent=2))
