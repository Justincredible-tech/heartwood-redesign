"""Temporary loopback comparison: expose only the three preserved site assets."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

EVIDENCE = Path(__file__).resolve().parent.parent / 'review-evidence/003-performance-20261012'
ROUTES = {
    '/heartwood-site.html': ('before.html', 'text/html'),
    '/css/heartwood-site.css': ('before.css', 'text/css'),
    '/js/heartwood-site.js': ('before.js', 'text/javascript'),
}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        asset = ROUTES.get(urlsplit(self.path).path)
        if asset is None:
            self.send_error(404)
            return
        data = (EVIDENCE / asset[0]).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', asset[1])
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8002), Handler)
    print('Baseline comparison only: http://127.0.0.1:8002/heartwood-site.html', flush=True)
    server.serve_forever()
