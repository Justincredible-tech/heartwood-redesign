"""Prepare a reviewed local-photo bundle; never download or edit source in place.

Pass every literal authored img.src URL with its locally downloaded original:
  uv run --offline --no-project --no-sync python tools/import-photos.py \
    --out /path/to/new-review-folder <url> <file> [<url> <file> ...]

Review the proposed heartwood-site.js, photos-provenance.json and derivatives,
then copy them into source as one reviewed change. Unrelated author files are
never deleted. Existing matching derivatives are retained byte-for-byte.
New encoding needs the project's pinned Pillow; no browser is launched.
"""
import argparse
import hashlib
import io
import json
import os
import re
import stat
import struct
import sys
from pathlib import Path

WIDTHS = (360, 720, 1080)
QUALITY = 86
METHOD = 6
PILLOW = '12.0.0'
MAX_SOURCE = 16 * 1024 * 1024
MAX_TEXT = 1024 * 1024
MAX_WEBP = 4 * 1024 * 1024
MAX_PIXELS = 32_000_000
MARKER = '.hw-photo-owner'
BLOCK = re.compile(r'/\* photos:start \*/.*?/\* photos:end \*/', re.S)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(path, ceiling):
    """One admitted fd, <= ceiling+1 bytes, with before/after incarnation checks."""
    visible_before = os.lstat(path)
    if not stat.S_ISREG(visible_before.st_mode) or visible_before.st_size > ceiling:
        raise ValueError('Not a bounded regular file: ' + str(path))
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > ceiling or (before.st_dev, before.st_ino) != (visible_before.st_dev, visible_before.st_ino):
            raise ValueError('Not a bounded regular file: ' + str(path))
        data = bytearray()
        while len(data) <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        key = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        visible = os.lstat(path)
        if key(before) != key(after) or key(before) != key(visible) or len(data) != before.st_size:
            raise ValueError('Input changed while reading: ' + str(path))
        return bytes(data), {'path': str(path), 'dev': before.st_dev, 'ino': before.st_ino,
                             'bytes': len(data), 'sha256': sha(data), 'mtime_ns': before.st_mtime_ns,
                             'ctime_ns': before.st_ctime_ns}
    finally:
        os.close(fd)


def webp_size(data):
    if len(data) < 30 or data[:4] != b'RIFF' or data[8:12] != b'WEBP' or struct.unpack('<I', data[4:8])[0] + 8 != len(data):
        raise ValueError('Invalid WebP container')
    if data[12:16] == b'VP8X':
        return (int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1)
    if data[12:16] == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a':
        return (int.from_bytes(data[26:28], 'little') & 0x3fff, int.from_bytes(data[28:30], 'little') & 0x3fff)
    if data[12:16] == b'VP8L' and data[20] == 0x2f:
        bits = int.from_bytes(data[21:25], 'little')
        return ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    raise ValueError('Unsupported WebP dimension header')


def jpeg_recipe_size(data):
    """Cached JPEG metadata only: real SOF dimensions/EXIF orientation, no decode."""
    if data[:2] != b'\xff\xd8':
        raise ValueError('Exact cached reuse supports JPEG originals; encode other formats with pinned Pillow')
    offset, size, orientation = 2, None, 1
    while offset < len(data):
        if data[offset] != 0xff:
            raise ValueError('Invalid JPEG marker')
        while offset < len(data) and data[offset] == 0xff:
            offset += 1
        if offset == len(data):
            raise ValueError('Truncated JPEG marker')
        marker = data[offset]
        offset += 1
        if marker in (0xd9, 0xda):
            break
        if marker in range(0xd0, 0xd8) or marker == 0x01:
            continue
        if offset + 2 > len(data):
            raise ValueError('Truncated JPEG segment')
        length = int.from_bytes(data[offset:offset + 2], 'big')
        if length < 2 or offset + length > len(data):
            raise ValueError('Invalid JPEG segment length')
        segment = data[offset + 2:offset + length]
        offset += length
        if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
            if len(segment) < 6 or segment[5] not in (1, 3):
                raise ValueError('Cached JPEG must have RGB/L components')
            size = (int.from_bytes(segment[3:5], 'big'), int.from_bytes(segment[1:3], 'big'))
        elif marker == 0xe2 and segment.startswith(b'ICC_PROFILE\0'):
            raise ValueError('Cached JPEG contains an ICC profile')
        elif marker == 0xe1 and segment.startswith(b'Exif\0\0'):
            tiff = segment[6:]
            if len(tiff) < 8 or tiff[:2] not in (b'II', b'MM'):
                raise ValueError('Invalid EXIF byte order')
            order = 'little' if tiff[:2] == b'II' else 'big'
            if int.from_bytes(tiff[2:4], order) != 42:
                raise ValueError('Invalid EXIF TIFF marker')
            start = int.from_bytes(tiff[4:8], order)
            if start + 2 > len(tiff):
                raise ValueError('Invalid EXIF directory')
            count = int.from_bytes(tiff[start:start + 2], order)
            if count > 512 or start + 2 + count * 12 > len(tiff):
                raise ValueError('Invalid EXIF entry count')
            for i in range(count):
                entry = tiff[start + 2 + i * 12:start + 14 + i * 12]
                if int.from_bytes(entry[:2], order) == 0x112:
                    if int.from_bytes(entry[2:4], order) != 3 or int.from_bytes(entry[4:8], order) != 1:
                        raise ValueError('Invalid EXIF orientation field')
                    orientation = int.from_bytes(entry[8:10], order)
                    if orientation not in range(1, 9):
                        raise ValueError('Invalid EXIF orientation')
    if not size or min(size) < 1 or size[0] * size[1] > MAX_PIXELS:
        raise ValueError('Invalid cached JPEG dimensions')
    return size[::-1] if orientation >= 5 else size



def supported_format(data):
    """Technical decoder allowlist; no external-program image plugins."""
    if data[:3] == b'\xff\xd8\xff':
        return 'JPEG'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'PNG'
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'WEBP'
    raise ValueError('Supported local photos are JPEG, PNG or WebP')

def original_recipe_size(data):
    if data[:2] == b'\xff\xd8':
        return jpeg_recipe_size(data)
    # Non-JPEG originals remain supported with the author's existing pinned
    # Pillow. Header/EXIF inspection does not rebake or fully decode an image.
    from PIL import Image, __version__ as pillow_version
    if pillow_version != PILLOW:
        raise ValueError('Non-JPEG metadata needs pinned Pillow ' + PILLOW + '; found ' + pillow_version)
    format_name = supported_format(data)
    with io.BytesIO(data) as stream, Image.open(stream, formats=[format_name]) as image:
        if image.format != format_name:
            raise ValueError('Photo decoder format disagrees with signature')
        if image.width * image.height > MAX_PIXELS or image.mode not in ('RGB', 'L') or image.info.get('icc_profile'):
            raise ValueError('Cached original must be <=32MP plain sRGB RGB/L without ICC')
        size = image.size
        return size[::-1] if image.getexif().get(0x112, 1) in (5, 6, 7, 8) else size


def photo_roles(js):
    if len(BLOCK.findall(js)) != 1:
        raise ValueError('Expected exactly one photos:start/end block')
    roles = re.findall(r"\bimg\s*:\s*\{\s*src\s*:\s*ORIGIN\s*\+\s*'([^']+)'", js)
    if len(roles) != len(re.findall(r'\bimg\s*:\s*\{', js)) or not roles or len(roles) > 16:
        raise ValueError('Each authored img.src must be a supported literal ORIGIN path (1..16 photos)')
    if any(not p.startswith('/') or not re.fullmatch(r'/[A-Za-z0-9_./-]+', p) or '..' in p.split('/') for p in roles):
        raise ValueError('Invalid authored photo path')
    return sorted(set('https://heartwood.org' + p for p in roles))


def slug(url):
    return re.sub(r'[^a-z0-9]+', '-', url.rsplit('/', 1)[1].rsplit('.', 1)[0].lower()).strip('-')


def encode(original, width):
    from PIL import Image
    with original.resize((width, round(original.height * width / original.width)), Image.Resampling.LANCZOS) as image:
        with io.BytesIO() as buffer:
            image.save(buffer, 'WEBP', quality=QUALITY, method=METHOD)
            return image.size, buffer.getvalue()


def phase(pipe, name):
    pipe.send({'type': 'phase', 'name': name[:300]})



def put(out, name, data):
    if _OWNED_PIPE is None:
        raise RuntimeError('Photo output requires the owned guardian/worker API')
    _OWNED_PIPE.put(out, name, data)

def produce(job, pipe):
    """Heavy decode/encode runs only in the guardian-owned worker."""
    root = Path(job['root']).resolve(strict=True)
    js_path = root / 'source/js/heartwood-site.js'
    phase(pipe, 'admit authored source and complete photo inputs')
    js_bytes, js_input = read_regular(js_path, MAX_TEXT)
    js = js_bytes.decode('utf-8')
    urls = photo_roles(js)
    pairs = job['pairs']
    if len(pairs) != len(urls) or len({p[0] for p in pairs}) != len(pairs) or sorted(p[0] for p in pairs) != urls:
        raise ValueError('Pass every authored photo exactly once: ' + ', '.join(urls))
    names = [slug(url) for url in urls]
    if len(set(names)) != len(names) or any(not name for name in names):
        raise ValueError('Photo URL filenames collide')
    asset_dir = root / 'source/assets/photos'
    old = {}
    _, importer_input = read_regular(Path(__file__).resolve(strict=True), MAX_TEXT)
    inputs = [js_input, importer_input]
    old_path = asset_dir / 'photos-provenance.json'
    if old_path.exists():
        old_bytes, old_input = read_regular(old_path, MAX_TEXT)
        inputs.append(old_input)
        old = json.loads(old_bytes).get('photos', {})
        if not isinstance(old, dict):
            raise ValueError('Invalid existing photo provenance')
    out = Path(job['out']) if job.get('out') else None
    records, entries, origins = {}, [], {}
    for url, file in pairs:
        phase(pipe, 'admit local original ' + url)
        data, original_input = read_regular(file, MAX_SOURCE)
        supported_format(data)
        inputs.append(original_input)
        prior = old.get(url)
        files = []
        if prior and prior.get('source_sha256') == sha(data) and prior.get('source_bytes') == len(data):
            dimensions = prior.get('source_size')
            if not isinstance(dimensions, list) or len(dimensions) != 2 or any(type(n) is not int or n < 1 for n in dimensions) or dimensions[0] * dimensions[1] > MAX_PIXELS or prior.get('quality') != QUALITY:
                raise ValueError('Invalid retained photo recipe: ' + url)
            if tuple(dimensions) != original_recipe_size(data):
                raise ValueError('Retained source dimensions/orientation disagree with original JPEG: ' + url)
            wanted = [w for w in WIDTHS if w <= dimensions[0]]
            prior_files = prior.get('files')
            if not wanted or not isinstance(prior_files, list) or [f.get('width') for f in prior_files] != wanted:
                raise ValueError('Incomplete retained derivative set: ' + url)
            for f in prior_files:
                name, w, h = f.get('file'), f.get('width'), f.get('height')
                if type(h) is not int or h != round(dimensions[1] * w / dimensions[0]) or not isinstance(name, str) or not re.fullmatch(re.escape(slug(url)) + '-' + str(w) + r'\.[0-9a-f]{12}\.webp', name):
                    raise ValueError('Invalid retained derivative: ' + url)
                encoded, encoded_input = read_regular(asset_dir / name, MAX_WEBP)
                if len(encoded) != f.get('bytes') or sha(encoded)[:12] != name.rsplit('.', 2)[1] or webp_size(encoded) != (w, h):
                    raise ValueError('Retained derivative bytes/hash/dimensions disagree: ' + name)
                inputs.append(encoded_input)
                files.append(dict(f))
                if out:
                    put(out, name, encoded)
            records[url] = dict(prior)
            origins[url] = {'status': 'REUSED_EXACT_BYTES', 'encoding_toolchain': 'UNPROVED_LEGACY',
                            'source_sha256': sha(data)}
        else:
            if not out:
                records[url] = {'source_sha256': sha(data), 'source_bytes': len(data),
                                'planned_widths': list(WIDTHS)}
                origins[url] = {'status': 'ENCODING_REQUIRED', 'pinned_pillow': PILLOW,
                                'dimensions_profile_and_codec': 'CHECKED_DURING_BOUNDED_ENCODING'}
                continue
            phase(pipe, 'decode local original ' + url)
            from PIL import Image, ImageOps, __version__ as pillow_version, features
            if pillow_version != PILLOW:
                raise ValueError('New encoding needs pinned Pillow ' + PILLOW + '; found ' + pillow_version)
            Image.MAX_IMAGE_PIXELS = MAX_PIXELS
            format_name = supported_format(data)
            with io.BytesIO(data) as original_buffer, Image.open(original_buffer, formats=[format_name]) as opened:
                if opened.format != format_name:
                    raise ValueError('Photo decoder format disagrees with signature')
                if opened.width * opened.height > MAX_PIXELS or opened.info.get('icc_profile') or opened.mode not in ('RGB', 'L'):
                    raise ValueError('Photo must be <=32MP plain sRGB RGB/L without ICC profile: ' + file)
                with ImageOps.exif_transpose(opened) as oriented, oriented.convert('RGB') as original:
                    dimensions = list(original.size)
                    for width in WIDTHS:
                        if width > original.width:
                            break
                        phase(pipe, 'encode ' + url + ' ' + str(width) + 'w')
                        (w, h), encoded = encode(original, width)
                        if len(encoded) > MAX_WEBP:
                            raise ValueError('Encoded photo exceeds4MiB')
                        name = slug(url) + '-' + str(w) + '.' + sha(encoded)[:12] + '.webp'
                        files.append({'file': name, 'width': w, 'height': h, 'bytes': len(encoded)})
                        if out:
                            put(out, name, encoded)
            if not files:
                raise ValueError('Photo narrower than minimum360px: ' + file)
            records[url] = {'source_sha256': sha(data), 'source_bytes': len(data), 'source_size': dimensions,
                            'quality': QUALITY, 'files': files}
            origins[url] = {'status': 'ENCODED_CURRENT', 'pillow': pillow_version,
                            'webp': features.version('webp'), 'resample': 'LANCZOS', 'method': METHOD}
        sizes = ', '.join("['assets/photos/" + f['file'] + "', " + str(f['width']) + ']'
                          for f in files)
        entries.append("  '" + url + "': [" + sizes + '],')
    block = '/* photos:start */\nconst PHOTOS = {\n' + '\n'.join(entries) + '\n};\n/* photos:end */'
    proposed = BLOCK.sub(lambda _: block, js)
    phase(pipe, 'verify all observed source inputs unchanged')
    for expected in inputs:
        _, actual = read_regular(expected['path'], MAX_SOURCE if expected['path'] in [p[1] for p in pairs] else MAX_WEBP)
        if actual != expected:
            raise ValueError('Input changed during photo import: ' + expected['path'])
    receipt = {'status': 'REVIEW_BUNDLE_ONLY' if out else 'VALIDATED_PLAN', 'source_js': js_input,
               'inputs': inputs, 'photos': origins, 'recipe': {'widths': list(WIDTHS), 'quality': QUALITY,
               'method': METHOD, 'resample': 'LANCZOS', 'exif': 'transpose', 'crop': 'entire original'},
               'source_application': 'NOT_APPLIED', 'platform_execution': sys.platform,
               'python': sys.version.split()[0], 'importer_sha256': importer_input['sha256'],
               'producer_disk_epoch': 'MATCHED_BEFORE_AFTER_WORKER_OPERATION',
               'parsed_module_before_entry': 'UNPROVED',
               'toolchain_scope': 'New encoding records Pillow/WebP versions; complete package/native closure is not claimed'}
    if out:
        put(out, 'heartwood-site.js', proposed.encode('utf-8'))
        put(out, 'photos-provenance.json', (json.dumps({'photos': records}, indent=2) + '\n').encode())
        put(out, 'import-receipt.json', (json.dumps(receipt, indent=2) + '\n').encode())
    return receipt


def admit_result(result, job):
    expected = 'REVIEW_BUNDLE_ONLY' if job.get('out') else 'VALIDATED_PLAN'
    if not isinstance(result, dict) or result.get('status') != expected or result.get('source_application') != 'NOT_APPLIED':
        raise ValueError('Empty/invalid photo worker result')
    photos, inputs = result.get('photos'), result.get('inputs')
    if not isinstance(photos, dict) or not photos or sorted(photos) != sorted(p[0] for p in job['pairs']) or not isinstance(inputs, list) or len(inputs) < 3 or not result.get('source_js'):
        raise ValueError('Incomplete photo worker result')
    if result.get('recipe') != {'widths': list(WIDTHS), 'quality': QUALITY, 'method': METHOD,
                               'resample': 'LANCZOS', 'exif': 'transpose', 'crop': 'entire original'}:
        raise ValueError('Photo worker recipe changed')
    allowed = ('REUSED_EXACT_BYTES', 'ENCODED_CURRENT') if job.get('out') else ('REUSED_EXACT_BYTES', 'ENCODING_REQUIRED')
    if any(not isinstance(value, dict) or value.get('status') not in allowed for value in photos.values()):
        raise ValueError('Photo worker did not perform its declared work')
    return result



_OWNED_PIPE = None
_RUNTIME = None


def runtime_module():
    global _RUNTIME
    if _RUNTIME is None:
        import importlib.util
        file = Path(__file__).resolve().with_name('photo-import-runtime.py')
        spec = importlib.util.spec_from_file_location('photo_import_runtime', file)
        _RUNTIME = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_RUNTIME)
    return _RUNTIME


def supervise(job, operation=produce):
    file = Path(operation.__globals__['__file__']).resolve()
    return runtime_module().run_job(job, file, operation.__name__)


def print_receipt(receipt):
    # A non-reading stdout consumer cannot hold the foreground CLI indefinitely.
    import threading
    body = (json.dumps(receipt, indent=2, allow_nan=False) + '\n').encode()
    if len(body) > 4 * 1024 * 1024:
        raise ValueError('Photo CLI receipt exceeds4MiB')
    completed, errors = threading.Event(), []
    def write():
        try:
            offset = 0
            while offset < len(body):
                count = os.write(sys.stdout.fileno(), body[offset:offset + 65536])
                if count <= 0:
                    raise BrokenPipeError('Photo stdout write made no progress')
                offset += count
        except BaseException as error:
            errors.append(error)
        finally:
            completed.set()
    threading.Thread(target=write, daemon=True).start()
    if not completed.wait(4):
        raise TimeoutError('stuck at completed photo CLI receipt write')
    if errors:
        raise errors[0]

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent,
                        help='Project whose literal authored photo roles are being updated')
    parser.add_argument('--out', type=Path, help='New review bundle directory outside the project; never overwrite')
    parser.add_argument('--plan', action='store_true', help='Validate and report without retaining output')
    parser.add_argument('--timeout', type=float, default=120, help='Overall seconds ceiling (0..300; default120)')
    parser.add_argument('--phase-timeout', type=float, default=30, help='Per-phase seconds ceiling (0..60; default30)')
    parser.add_argument('pairs', nargs='+', metavar='URL_OR_FILE')
    args = parser.parse_args(argv)
    if len(args.pairs) % 2 or not 0 < args.timeout <= 300 or not 0 < args.phase_timeout <= 60 or args.phase_timeout > args.timeout or args.plan == bool(args.out):
        parser.error('Pass URL/file pairs and exactly one of --plan or --out; deadlines must be finite valid ceilings')
    pairs = [[url, str(Path(file).absolute())] for url, file in zip(args.pairs[::2], args.pairs[1::2])]
    job = {'root': str(args.root.absolute()), 'out': str(args.out.absolute()) if args.out else None,
           'pairs': pairs, 'timeout': args.timeout, 'phase_timeout': args.phase_timeout}
    try:
        runtime_module().run_job(job, Path(__file__).resolve(), finalize=print_receipt)
    except BaseException as error:
        print('[photos] FAILED: ' + str(error), file=sys.stderr)
        return getattr(error, 'exit_code', 124 if isinstance(error, TimeoutError) else 1)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
