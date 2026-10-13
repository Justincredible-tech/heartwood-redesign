"""Build any git ref of this repo into its own scratch worktree and serve it, for side-by-side measurement.

    python tools/quality/refs.py --ref v1.0-iterative --dry-run      # what would be built, and where
    python tools/quality/refs.py --ref v2 --port 8005 --keep          # build, serve until Ctrl-C

perf.py and visual.py use serve() to put a base ref on 8004 and a head ref on 8005 (registered in
D:/projects/PORTS.md). Each ref is checked out with `git worktree add --detach` under the system temp folder,
built with its own tools (`npm ci`, `npm run build`), and served by its own tools/preview.py, which refuses a
port that is already in use. A built worktree is reused until --rebuild. The ref WORKTREE means this checkout as
it is on disk, already built.

Before anything is measured, the page served on the port is compared byte for byte with the build on disk, so a
stray server on the same port cannot be measured by mistake.
"""
import argparse
import contextlib
import hashlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CACHE = Path(tempfile.gettempdir()) / 'heartwood-quality'
PAGE = 'heartwood-site.html'


def git(*args, cwd=REPO):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def resolve(ref):
    """(commit sha or 'WORKTREE', checkout folder) for a ref."""
    if ref == 'WORKTREE':
        return 'WORKTREE', REPO
    sha = git('rev-parse', '--verify', ref + '^{commit}')
    return sha, CACHE / sha[:12]


def user_agent(browser):
    """Plain desktop Chrome. heartwood.org refuses the HeadlessChrome user agent, which would silently drop v1's
    hot-linked photos from every capture and make the old page shorter than visitors see it."""
    return (f'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
            f'Chrome/{browser.version} Safari/537.36')


def port_free(port):
    with socket.socket() as probe:
        return probe.connect_ex(('127.0.0.1', port)) != 0


def build(ref, rebuild=False, log=print):
    """Check out and build `ref`; return its checkout folder."""
    sha, folder = resolve(ref)
    if sha == 'WORKTREE':
        if not (folder / 'publish' / PAGE).is_file():
            raise SystemExit('WORKTREE has no build: run `npm run build` in tools/ first.')
        return folder
    marker = folder / '.quality-built'
    if marker.is_file() and not rebuild:
        return folder
    if not folder.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        log(f'[refs] checking out {ref} ({sha[:12]}) into {folder}')
        git('worktree', 'add', '--detach', str(folder), sha)
    npm = shutil.which('npm') or 'npm'
    tools = folder / 'tools'
    log(f'[refs] building {ref}')
    subprocess.run([npm, 'ci', '--ignore-scripts', '--no-fund', '--no-audit'], cwd=tools, check=True, capture_output=True)
    subprocess.run([npm, 'run', 'build'], cwd=tools, check=True, capture_output=True)
    marker.write_text(sha + '\n', encoding='utf-8')
    return folder


def served_page_matches(url, folder):
    request = urllib.request.Request(url + PAGE, headers={'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=5) as response:
        served = response.read()
    return hashlib.sha256(served).digest() == hashlib.sha256((folder / 'publish' / PAGE).read_bytes()).digest()


@contextlib.contextmanager
def serve(ref, port, rebuild=False, log=print):
    """Build `ref`, serve it on 127.0.0.1:`port`, yield its base URL; stop the server on exit."""
    folder = build(ref, rebuild, log)
    if not port_free(port):
        raise SystemExit(f'Port {port} is already in use; stop that server first (see D:/projects/PORTS.md).')
    server = subprocess.Popen([sys.executable, 'preview.py', '--port', str(port)], cwd=folder / 'tools',
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/'
    try:
        for _ in range(100):
            if server.poll() is not None:
                raise SystemExit(f'preview.py for {ref} exited early (code {server.returncode}).')
            try:
                if served_page_matches(url, folder):
                    break
                raise SystemExit(f'Port {port} serves a different page than the {ref} build: refusing to measure it.')
            except OSError:
                time.sleep(0.1)
        else:
            raise SystemExit(f'preview.py for {ref} did not answer on {port}.')
        log(f'[refs] {ref} on {url}')
        yield url
    finally:
        server.terminate()
        try:
            server.wait(5)
        except subprocess.TimeoutExpired:
            server.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--ref', required=True, help='any git ref, or WORKTREE for this checkout as built')
    parser.add_argument('--port', type=int, default=8005)
    parser.add_argument('--dry-run', action='store_true', help='report what would happen; build and serve nothing')
    parser.add_argument('--rebuild', action='store_true')
    parser.add_argument('--keep', action='store_true', help='serve until Ctrl-C')
    parser.add_argument('--remove', action='store_true', help="delete this ref's scratch worktree")
    args = parser.parse_args()
    sha, folder = resolve(args.ref)
    if args.dry_run:
        built = sha == 'WORKTREE' and (folder / 'publish' / PAGE).is_file() or (folder / '.quality-built').is_file()
        print(f'ref {args.ref} -> {sha}\nfolder {folder}\nbuilt {built}\nport {args.port} free {port_free(args.port)}')
        return
    if args.remove:
        if sha != 'WORKTREE' and folder.exists():
            git('worktree', 'remove', '--force', str(folder))
            print('removed', folder)
        return
    with serve(args.ref, args.port, args.rebuild) as url:
        print(url + PAGE)
        if args.keep:
            with contextlib.suppress(KeyboardInterrupt):
                while True:
                    time.sleep(1)


if __name__ == '__main__':
    main()
