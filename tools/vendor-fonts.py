"""Explicit font import; ordinary builds remain offline.

Import/help/validation/--plan perform no acquisition or writes. --live remains
fail-closed until the canonical persisted request-budget transport is wired.
collect_fonts() accepts that future transport (or a local test fixture); the
transport must enforce its supplied timeout/max_bytes and own cancellation.
No private budget, environment override or implicit download is provided.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

CSS_URL = 'https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Sans:wght@400..700&display=swap'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
LICENSE_FAMILIES = ('instrumentsans', 'youngserif')
TOTAL_SECONDS = 60
STEP_SECONDS = 10
CSS_BYTES = 256 * 1024
FONT_BYTES = 2 * 1024 * 1024
LICENSE_BYTES = 256 * 1024
TOTAL_BYTES = 9 * 1024 * 1024

def license_url(family):
    if family not in LICENSE_FAMILIES:
        raise ValueError('Unknown authored licence family')
    return f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/OFL.txt'

def acquisition_plan():
    return {'stylesheet': CSS_URL, 'user_agent': USER_AGENT,
            'licenses': [license_url(f) for f in LICENSE_FAMILIES],
            'font_count': 4, 'request_count': 7,
            'limits': {'overall_seconds': TOTAL_SECONDS, 'step_seconds': STEP_SECONDS,
                       'css_bytes': CSS_BYTES, 'font_bytes': FONT_BYTES,
                       'license_bytes': LICENSE_BYTES, 'total_bytes': TOTAL_BYTES},
            'live_status': 'UNSUPPORTED', 'reason': 'Canonical persisted request budget not yet integrated'}

def collect_fonts(transport, *, clock=time.monotonic):
    """Collect the exact authored recipe without any filesystem writes.

    The injected transport is responsible for interrupting I/O on its deadline;
    elapsed-time checks here additionally reject late/oversize/incomplete results.
    CLI never installs an unbudgeted transport or invokes this implicitly.
    """
    if not callable(transport):
        raise TypeError('An explicit bounded transport is required')
    deadline = clock() + TOTAL_SECONDS
    total_bytes = 0
    def fetch(url, limit):
        nonlocal total_bytes
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError('Font import overall deadline exceeded')
        timeout = min(STEP_SECONDS, remaining)
        started = clock()
        data = transport(url, headers={'User-Agent': USER_AGENT},
                         timeout_seconds=timeout, max_bytes=min(limit, TOTAL_BYTES-total_bytes))
        if clock() - started > timeout or clock() > deadline:
            raise TimeoutError('Font transport exceeded its deadline')
        if not isinstance(data, bytes) or not data or len(data) > limit:
            raise ValueError('Font response is empty, nonbytes or oversized')
        total_bytes += len(data)
        if total_bytes > TOTAL_BYTES:
            raise ValueError('Font import total byte limit exceeded')
        return data

    css = fetch(CSS_URL, CSS_BYTES).decode('utf-8')
    matches = list(re.finditer(r'/\* (latin(?:-ext)?) \*/\s*(@font-face\s*\{.*?\})', css, re.S))
    if len(matches) != 4:
        raise ValueError('Expected both original families and their Latin / Latin-ext subsets.')
    faces = []
    for match in matches:
        subset, face = match.groups()
        family = re.search(r"font-family:\s*'([^']+)'", face)
        url = re.search(r'url\((https://[^)]+\.woff2)\)', face)
        if family is None or url is None:
            raise ValueError('Authored font CSS face changed')
        faces.append((subset, family.group(1), url.group(1)))
    if sorted((family, subset) for subset, family, _ in faces) != sorted(
            (family, subset) for family in ('Young Serif', 'Instrument Sans') for subset in ('latin', 'latin-ext')):
        raise ValueError('Authored font families/subsets changed')

    files, records = {}, []
    for subset, family, url in faces:
        data = fetch(url, FONT_BYTES)
        digest = hashlib.sha256(data).hexdigest()
        name = family.lower().replace(' ', '-') + '-' + subset + '.' + digest[:12] + '.woff2'
        files['source/assets/fonts/' + name] = data
        css = css.replace(url, '../assets/fonts/' + name)
        records.append({'family': family, 'subset': subset, 'source': url, 'file': name,
                        'bytes': len(data), 'sha256': digest})
    for family in LICENSE_FAMILIES:
        data = fetch(license_url(family), LICENSE_BYTES)
        if b'SIL OPEN FONT LICENSE' not in data:
            raise ValueError('SIL licence response is invalid')
        files['source/assets/fonts/' + family + '-OFL.txt'] = data
    files['source/css/fonts.css'] = css.encode('utf-8')
    files['tools/font-provenance.json'] = (json.dumps({'stylesheet': CSS_URL, 'fonts': records}, indent=2) + '\n').encode('utf-8')
    return {'files': files, 'records': records, 'transport_calls': 7, 'bytes': total_bytes}

def write_bundle(bundle, root):
    """Explicit application after a complete bounded acquisition succeeds."""
    files = bundle.get('files')
    if not isinstance(files, dict) or len(files) != 8:
        raise ValueError('Incomplete font bundle')
    special = {'source/css/fonts.css', 'tools/font-provenance.json'}
    special.update('source/assets/fonts/' + family + '-OFL.txt' for family in LICENSE_FAMILIES)
    for name, data in files.items():
        if not isinstance(name, str) or (name not in special and not re.fullmatch(
                r'source/assets/fonts/(?:young-serif|instrument-sans)-latin(?:-ext)?\.[a-f0-9]{12}\.woff2', name)):
            raise ValueError('Unexpected font bundle path')
        if not isinstance(data, bytes) or not data:
            raise ValueError('Invalid font bundle bytes')
    root = Path(root)
    for name, data in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true', help='Print authored sources and limits without requests or writes')
    mode.add_argument('--live', action='store_true', help='Explicit acquisition; unavailable until canonical request budgets are integrated')
    args = parser.parse_args(argv)
    if args.plan:
        print(json.dumps(acquisition_plan(), indent=2))
        return 0
    import sys
    print(json.dumps({'status': 'UNSUPPORTED', 'observation': 'NOT_RUN', 'requests': 0,
                      'reason': 'Canonical persisted request budget is not integrated; font acquisition is disabled.'}), file=sys.stderr)
    return 64

if __name__ == '__main__':
    raise SystemExit(main())
