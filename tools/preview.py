"""Loopback-only static preview with actual precompressed response negotiation."""
import argparse
import hashlib
import json
import mimetypes
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
PUBLISH = (ROOT / 'publish').resolve()

def accepted_encoding(value, available):
    if not value:
        return 'identity'
    weights = {}
    for entry in value.split(','):
        parts = [part.strip() for part in entry.split(';')]
        coding, quality = parts[0].lower(), 1.0
        for parameter in parts[1:]:
            if parameter.lower().startswith('q='):
                try:
                    quality = max(0.0, min(1.0, float(parameter[2:])))
                except ValueError:
                    quality = 0.0
        weights[coding] = quality
    choices = [(weights.get(coding, weights.get('*', 0.0)), 2 - index, coding)
               for index, coding in enumerate(('br', 'gzip')) if coding in available]
    if 'identity' in weights:
        choices.append((weights['identity'], 0, 'identity'))
    acceptable = [choice for choice in choices if choice[0] > 0]
    if acceptable:
        return max(acceptable)[2]
    return 'identity' if weights.get('identity', weights.get('*', 1.0)) > 0 else None

class PreviewHandler(SimpleHTTPRequestHandler):
    server_version = 'HeartwoodPreview/1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLISH), **kwargs)

    def send_head(self):
        parsed = urlsplit(self.path)
        relative = unquote(parsed.path).lstrip('/')
        if not relative:
            relative = 'heartwood-site.html'
        manifest = json.loads((ROOT / 'tools/build-manifest.json').read_text(encoding='utf-8'))
        if relative not in set(manifest['generated']):
            self.send_error(404, 'Not a public site asset')
            return None
        target = (PUBLISH / relative).resolve()
        if not target.is_relative_to(PUBLISH) or not target.is_file():
            self.send_error(404)
            return None
        available = {encoding for encoding, extension in (('br', '.br'), ('gzip', '.gz'))
                     if target.with_name(target.name + extension).is_file()}
        encoding = accepted_encoding(self.headers.get('Accept-Encoding', ''), available)
        if encoding is None:
            self.send_error(406, 'No acceptable representation')
            return None
        selected = target if encoding == 'identity' else target.with_name(target.name + ('.br' if encoding == 'br' else '.gz'))
        data = selected.read_bytes()
        etag = '"' + hashlib.sha256(data).hexdigest()[:24] + '-' + encoding + '"'
        cached = etag in [value.strip() for value in self.headers.get('If-None-Match', '').split(',')]
        self.send_response(304 if cached else 200)
        public_types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain'}
        self.send_header('Content-Type', public_types.get(target.suffix, mimetypes.guess_type(str(target))[0] or 'application/octet-stream'))
        self.send_header('ETag', etag)
        self.send_header('Vary', 'Accept-Encoding')
        self.send_header('X-Heartwood-Preview', '1')
        fingerprinted = bool(re.search(r'\.[0-9a-f]{12}\.(?:css|js|svg|woff2|webp)$', relative))
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if fingerprinted else 'no-cache')
        if encoding != 'identity':
            self.send_header('Content-Encoding', encoding)
        if not cached:
            self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if cached:
            return None
        return selected.open('rb')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()
    if not (ROOT / 'tools/build-manifest.json').is_file():
        raise SystemExit('Build first: cd tools; npm run build')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), PreviewHandler)
    except OSError as error:
        raise SystemExit(f'Cannot bind loopback port {args.port}: {error}. Existing listeners are never replaced.')
    print(f'Heartwood compressed preview: http://127.0.0.1:{args.port}/heartwood-site.html', flush=True)
    server.serve_forever()
