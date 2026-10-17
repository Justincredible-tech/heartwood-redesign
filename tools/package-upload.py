"""Create a fresh allowlisted server-upload folder; never overwrite a prior package.

By default the folder is the client showcase: the landing page (showcase/index.html) is the homepage, the built
Heartwood site sits beside it as living-tree.html, and the alternative mockups and their preview images come
along. Pass --site-only once a design is chosen to package the built site alone as the homepage; a site-only
package retargets the packaged documents' canonical and og:url to the package root, because no
living-tree.html ships in that layout.
"""
import argparse
import gzip
import hashlib
import json
import os
from html.parser import HTMLParser
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit
import brotli
from build_features import manifest_features
from site_address import authored_base

ROOT = Path(__file__).resolve().parent.parent
PUBLISH = ROOT / 'publish'             # lexical: admission must see the real spelling, never a resolved target
SHOWCASE = ROOT / 'showcase'           # lexical for the same reason
MOCKUPS = ROOT / 'mockups'             # lexical for the same reason
FEATURED = 'living-tree.html'          # the built site's name inside the showcase; the landing page links to it
AUTHORED_BASE = authored_base()        # the public package root with a trailing slash, from the authored canonical
CANONICAL_ENTRY_URL = AUTHORED_BASE + FEATURED   # the authored canonical names the showcase entry
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
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_PACKAGE_BYTES = 256 * 1024 * 1024


def build_output_records(manifest, generated):
    """Return one verified digest record per generated file; refuse anything less.

    Provenance is a gate, not a hint. The checked-in manifest predates digest recording, so it has no
    `outputs`; packaging it is refused here, before any source is read, with the rebuild that fixes it.
    """
    outputs = manifest.get('outputs')
    if outputs is None:
        raise SystemExit('Build manifest has no output provenance (outputs); rebuild with '
                         '`node tools/build-site.mjs` before packaging (the checked-in manifest predates digest recording).')
    if not isinstance(outputs, list) or not outputs:
        raise SystemExit('Build manifest output provenance (outputs) is empty; rebuild with '
                         '`node tools/build-site.mjs` before packaging.')
    if len(outputs) > len(generated):
        raise SystemExit('Build manifest has more output provenance records than generated files; rebuild with '
                         '`node tools/build-site.mjs`.')
    records = {}
    for record in outputs:
        if not isinstance(record, dict):
            raise SystemExit('Build manifest output provenance contains a non-object record; rebuild with '
                             '`node tools/build-site.mjs`.')
        path = record.get('path')
        if type(path) is not str or not path:
            raise SystemExit('Build manifest output provenance has a record without a path; rebuild with '
                             '`node tools/build-site.mjs`.')
        if path in records:
            raise SystemExit('Build manifest records duplicate output provenance: ' + path + '; rebuild with '
                             '`node tools/build-site.mjs`.')
        size = record.get('bytes')
        digest = record.get('sha256')
        if type(size) is not int or size < 0 or size > MAX_SOURCE_BYTES:
            raise SystemExit('Build manifest records an invalid size for ' + path + '; rebuild with '
                             '`node tools/build-site.mjs`.')
        if type(digest) is not str or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise SystemExit('Build manifest records an invalid sha256 for ' + path + '; rebuild with '
                             '`node tools/build-site.mjs`.')
        records[path] = {'bytes': size, 'sha256': digest}
    missing = sorted(set(generated) - set(records))
    extra = sorted(set(records) - set(generated))
    if missing or extra:
        detail = []
        if missing:
            detail.append('missing ' + ', '.join(missing[:4]) + ('…' if len(missing) > 4 else ''))
        if extra:
            detail.append('unrecorded ' + ', '.join(extra[:4]) + ('…' if len(extra) > 4 else ''))
        raise SystemExit('Build output provenance does not cover its manifest (' + '; '.join(detail) + '); '
                         'rebuild with `node tools/build-site.mjs` before packaging.')
    return records


output_records = build_output_records(manifest, generated)
entry = 'index.html' if args.site_only else FEATURED
files = {}            # packaged path -> (verified snapshot bytes, source label)
made = {}             # packaged path -> bytes produced here (compression sidecars for transformed pages)
snapshot_bytes = 0    # bounded: the whole package is held once, never re-read from disk


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


def read_verified(root, path, record=None, label=None):
    """Read a package source exactly once and return the bytes that were verified.

    The descriptor is the read anchor: O_NOFOLLOW refuses a symlink swapped in before the open, the
    recorded size and digest refuse a same-generation rewrite before the read, and callers copy the
    returned snapshot instead of re-opening `path`, so a rewrite after the read cannot reach the package.
    """
    source = contained_source(root, path)
    name = label or source.as_posix()
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        descriptor = os.open(source, flags)
    except OSError as error:
        raise SystemExit(f'Cannot open package source without following a link: {name}: {error.strerror}') from error
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise SystemExit(f'Package source is not a regular file: {name}')
        if record is not None and info.st_size != record['bytes']:
            raise SystemExit(f'Build output size changed before packaging: {name} '
                             f'(recorded {record["bytes"]}, found {info.st_size}); rebuild with `node tools/build-site.mjs`.')
        chunks = []
        total = 0
        while True:
            chunk = os.read(descriptor, 1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_SOURCE_BYTES:
                raise SystemExit(f'Package source exceeds the bounded read limit: {name}')
            chunks.append(chunk)
    finally:
        os.close(descriptor)
    data = b''.join(chunks)
    if record is not None:
        if len(data) != record['bytes']:
            raise SystemExit(f'Build output size changed before packaging: {name} '
                             f'(recorded {record["bytes"]}, read {len(data)}); rebuild with `node tools/build-site.mjs`.')
        digest = hashlib.sha256(data).hexdigest()
        if digest != record['sha256']:
            raise SystemExit(f'Build output changed before packaging: {name} '
                             f'(sha256 {digest} != recorded {record["sha256"]}); rebuild with `node tools/build-site.mjs`.')
    return data


def write_verified(destination_root, relative, data):
    """Write one packaged file from verified in-memory bytes; the path is never read again as a source."""
    target = destination_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    try:
        descriptor = os.open(target, flags, 0o644)
    except OSError as error:
        raise SystemExit(f'Cannot create packaged file: {target}: {error.strerror}') from error
    try:
        view = memoryview(data)
        offset = 0
        while offset < len(view):
            written = os.write(descriptor, view[offset:])
            if written <= 0:
                raise SystemExit('Short write while packaging: ' + relative)
            offset += written
    except OSError as error:
        raise SystemExit(f'Cannot write packaged file: {target}: {error.strerror}') from error
    finally:
        os.close(descriptor)
    if target.read_bytes() != data:
        raise SystemExit('Packaged copy does not match the verified source bytes: ' + relative)


def account_snapshot(size):
    """Keep the whole-package snapshot bounded; a build larger than this is refused, not held twice."""
    global snapshot_bytes
    snapshot_bytes += size
    if snapshot_bytes > MAX_PACKAGE_BYTES:
        raise SystemExit('Package sources exceed the bounded snapshot limit of '
                         f'{MAX_PACKAGE_BYTES} bytes; refusing to hold an unbounded package.')


def add_compressed(packaged, data):
    """Precompress a page the build did not, verified the same way compress-site.py does."""
    gz = gzip.compress(data, compresslevel=9, mtime=0)
    br = brotli.compress(data, quality=11)
    if gzip.decompress(gz) != data or brotli.decompress(br) != data:
        raise SystemExit('Compression mismatch: ' + packaged)
    made[packaged + '.gz'] = gz
    made[packaged + '.br'] = br
    account_snapshot(len(gz) + len(br))


for relative in manifest['generated']:
    if not re.fullmatch(r'(?:heartwood-site|desktop-day|experience-entry)\.html|(?:css|js)/heartwood-site\.[0-9a-f]{12}\.(?:css|js)|assets/fonts/[A-Za-z0-9.-]+\.(?:woff2|txt)'
                        r'|assets/grain/(?:grain-fine(?:-night)?-\d+@[\d.]+x\.[0-9a-f]{12}|[A-Za-z0-9@._-]+\.[0-9a-f]{12,16})\.webp|assets/meta/[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)'
                        r'|assets/photos/[a-z0-9-]+-\d+\.[0-9a-f]{12}\.webp'
                        r'|taste/(?:index|scene)\.html|(?:css|js)/heartwood-taste(?:-head)?\.[0-9a-f]{12}\.(?:css|js)'
                        r'|mobile/(?:index|day|night)\.html|mobile/manifest\.json|mobile/assets/[A-Za-z0-9@._-]+\.[0-9a-f]{16}\.(?:avif|webp|woff2|svg|png|css|js|txt)', relative):
        raise SystemExit('Unexpected generated file: ' + relative)
    # Legacy Day tile names remain supported; every generated file now carries exact producer
    # provenance, so new tile families are covered by the gate above rather than by a Night substring.
    source = PUBLISH / relative
    body = read_verified(PUBLISH, source, output_records[relative], relative)
    account_snapshot(len(body))
    packaged = entry if relative == 'experience-entry.html' else 'desktop-day.html' if relative == 'heartwood-site.html' else relative
    prior = files.get(packaged)
    if prior is not None and prior[0] != body:
        raise SystemExit('Conflicting packaged body: ' + packaged)
    if not args.site_only and packaged == 'desktop-day.html':
        data = body.replace(b'<html ', b'<html data-hw-public-entry="living-tree.html" ', 1)
        if data == body:
            raise SystemExit('Missing packaged body root element')
        if packaged in made:
            if made[packaged] != data:
                raise SystemExit('Conflicting packaged main scene')
            continue
        made[packaged] = data
        account_snapshot(len(data))
        add_compressed(packaged, data)
        continue
    if args.site_only and packaged.endswith('.html'):
        data = body.replace(CANONICAL_ENTRY_URL.encode(), AUTHORED_BASE.encode())
        if data != body:
            if packaged in made:
                if made[packaged] != data:
                    raise SystemExit('Conflicting packaged document: ' + packaged)
                continue
            made[packaged] = data
            account_snapshot(len(data))
            add_compressed(packaged, data)
            continue
    files[packaged] = (body, 'publish/' + relative)
    if source.suffix in ('.html', '.css', '.js'):
        for suffix, decoder in (('.gz', gzip.decompress), ('.br', brotli.decompress)):
            compressed = read_verified(PUBLISH, source.with_name(source.name + suffix), None, relative + suffix)
            account_snapshot(len(compressed))
            if decoder(compressed) != body:
                raise SystemExit('Compression mismatch: ' + relative + suffix)
            files[packaged + suffix] = (compressed, 'publish/' + relative + suffix)

if not args.site_only:
    landing = read_verified(SHOWCASE, SHOWCASE / 'index.html', None, 'showcase/index.html')
    account_snapshot(len(landing))
    files['index.html'] = (landing, 'showcase/index.html')
    add_compressed('index.html', landing)
    for preview in sorted((SHOWCASE / 'previews').glob('*.webp')):
        if not re.fullmatch(r'[a-z0-9-]+\.webp', preview.name):
            raise SystemExit('Unexpected preview file: ' + preview.name)
        data = read_verified(SHOWCASE, preview, None, 'showcase/previews/' + preview.name)
        account_snapshot(len(data))
        files['assets/previews/' + preview.name] = (data, 'showcase/previews/' + preview.name)
    for mockup in sorted(MOCKUPS.glob('*.html')):
        if not re.fullmatch(r'[a-z0-9-]+\.html', mockup.name):
            raise SystemExit('Unexpected mockup file: ' + mockup.name)
        data = read_verified(MOCKUPS, mockup, None, 'mockups/' + mockup.name)
        account_snapshot(len(data))
        files['mockups/' + mockup.name] = (data, 'mockups/' + mockup.name)
        add_compressed('mockups/' + mockup.name, data)

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
    page = landing.decode('utf-8')
    links.feed(page)
    links.targets.update(url for url in re.findall(r'url\(([^)"\']+)\)', page) if not urlsplit(url).scheme)
    missing = sorted(target for target in links.targets if target not in files)
    if missing or FEATURED not in links.targets:
        raise SystemExit('Landing page links outside the package: ' + ', '.join(missing or ['(no link to ' + FEATURED + ')']))

htaccess = read_verified(PUBLISH, PUBLISH / '.htaccess', None, 'publish/.htaccess')
account_snapshot(len(htaccess))
files['.htaccess'] = (htaccess, 'publish/.htaccess')
overlap = set(files) & set(made)
if overlap:
    raise SystemExit('Build outputs claim the same packaged path twice: ' + ', '.join(sorted(overlap)))
destination.mkdir()
records = []
for relative, (data, source_label) in files.items():
    write_verified(destination, relative, data)
    records.append({'path': relative, 'source': source_label,
                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
for relative, data in made.items():
    write_verified(destination, relative, data)
    records.append({'path': relative, 'source': 'created by package-upload.py',
                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
expected = set(files) | set(made)
actual = {path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file()}
if actual != expected:
    raise SystemExit('Package tree does not match the verified plan (missing: ' +
                     ', '.join(sorted(expected - actual) or ['none']) + '; unexpected: ' +
                     ', '.join(sorted(actual - expected) or ['none']) + ').')
if len(records) != len(expected):
    raise SystemExit('Package manifest does not describe each packaged file exactly once '
                     f'({len(records)} records for {len(expected)} files).')
report = {'features': features, 'folder': str(destination), 'layout': 'site-only' if args.site_only else 'showcase', 'entry': 'index.html',
          'site': entry, 'files': records, 'total_files': len(records), 'total_bytes': sum(record['bytes'] for record in records),
          'limits': 'Local packaging only. Apache and remote-content availability require host verification.'}
(ROOT / 'tools/upload-package-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'folder': str(destination), 'layout': report['layout'], 'files': len(records), 'bytes': report['total_bytes']}, indent=2))
