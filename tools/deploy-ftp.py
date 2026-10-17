"""Upload a packaged folder to the authored public site over explicit FTPS (destination derived from the site's canonical link; see site_address.py).

Dry run is the default; nothing is sent without --go.

    python deploy-ftp.py ../publish/upload-ready-v2 --credentials <file>          # show the plan
    python deploy-ftp.py ../publish/upload-ready-v2 --credentials <file> --go     # back up, then upload

Credentials are never stored in this repository. They come from FTP_HOST / FTP_USER / FTP_PASS in the
environment, or from the file given by --credentials (KEY=value or "Key: value" lines; host may be omitted).
The default file is ~/.config/<authored host label>/ftp-credentials (derived from the site's canonical link). The server certificate is always chain-verified
against a trusted CA; the hostname must match the connect name unless an explicit certificate pin is set:
FTP_CERT_SHA256 (or cert_sha256 in the file) must be the certificate's 64-hex SHA-256 fingerprint, is
format-checked before any connection, and is enforced on the control connection and every protected data
connection.

With --go, nothing is sent until you click Yes in a dialog on the Windows desktop (default No, closes as No after
five minutes), so an agent cannot deploy on its own; give an agent's command a timeout of at least five minutes.
In Claude Code the command also needs your approval first (~/.claude/hooks/ftp-gate.py).

Safety, because the FTP account reaches the whole hosting account, not just this site:
- every remote path must resolve under public_html/heartwood/ (the guard below), so nothing else is touched;
- before the first write, every file already in that folder is downloaded to deploy-backups/<time>/; every
  server-supplied path is refused unless it resolves inside public_html/heartwood/, and no download can land
  outside deploy-backups/;
- each file goes up under a temporary name, its size is checked, then it is renamed over the old one, so a
  visitor never gets a half-written file; the landing page (index.html) goes last;
- files on the server that are not in the package are reported and left alone.
"""
import argparse
import datetime
import ftplib
import hashlib
import json
import os
import posixpath
import re
import ssl
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))   # same-directory helper; kept loadable under importlib loaders too
from site_address import authored_base, authored_origin, host_label
REMOTE_ROOT = 'public_html/heartwood'
DEFAULT_HOST = 'ftp.' + authored_origin().split('//', 1)[1]   # derived from the authored canonical link
DEFAULT_CREDENTIALS = Path.home() / '.config' / host_label() / 'ftp-credentials'
BACKUPS = ROOT / 'deploy-backups'
MAX_LISTING_DEPTH = 24
MAX_LISTING_ENTRIES = 20000
LISTING_BUDGET_S = 120


def guard(remote):
    """Refuse any path outside public_html/heartwood/. Called for every write and every backup read."""
    if '\0' in remote or '\\' in remote or remote.startswith('/'):
        raise SystemExit(f'Refusing suspicious remote path {remote!r}.')
    normal = posixpath.normpath(remote)
    if normal != REMOTE_ROOT and not normal.startswith(REMOTE_ROOT + '/'):
        raise SystemExit(f'Refusing to touch {remote!r}: outside {REMOTE_ROOT}/.')
    if '..' in normal.split('/'):
        raise SystemExit(f'Refusing path with "..": {remote!r}')
    return normal


def load_credentials(path):
    found = {'host': os.environ.get('FTP_HOST', ''), 'user': os.environ.get('FTP_USER', ''),
             'password': os.environ.get('FTP_PASS', ''), 'cert_sha256': os.environ.get('FTP_CERT_SHA256', '')}
    aliases = {'host': 'host', 'ftp_host': 'host', 'server': 'host',
               'user': 'user', 'username': 'user', 'usernamer': 'user', 'ftp_user': 'user',
               'pass': 'password', 'password': 'password', 'psswrd': 'password', 'ftp_pass': 'password',
               'cert_sha256': 'cert_sha256', 'cert_fingerprint': 'cert_sha256', 'certificate': 'cert_sha256'}
    file = Path(path) if path else DEFAULT_CREDENTIALS
    if file.is_file():
        for line in file.read_text(encoding='utf-8').splitlines():
            match = re.match(r'\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*?)\s*$', line)
            if match and not line.lstrip().startswith('#'):
                key = aliases.get(match.group(1).lower())
                if key and not found[key]:
                    found[key] = match.group(2)
    found['host'] = found['host'] or DEFAULT_HOST
    if not (found['user'] and found['password']):
        raise SystemExit('No FTP credentials: set FTP_USER / FTP_PASS, or pass --credentials <file>.')
    return found


def normalize_cert_pin(raw):
    """A configured pin must be exactly 64 hex characters (colons allowed) and is validated before any connection."""
    expected = (raw or '').lower().replace(':', '').strip()
    if expected and not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise SystemExit('FTP_CERT_SHA256 must be the 64-hex SHA-256 fingerprint of the server certificate.')
    return expected or None


def _close_quietly(handle):
    try:
        handle.close()
    except Exception:
        pass


def verify_tls_certificate(sock, expected, label):
    """The presented certificate must hash to the pin; any failure (including an unreadable or absent
    certificate) closes the socket before refusing."""
    try:
        der = sock.getpeercert(binary_form=True) if hasattr(sock, 'getpeercert') else None
    except Exception:
        der = None
    if not der:
        _close_quietly(sock)
        raise SystemExit(f'No TLS certificate on the {label}; nothing was sent.')
    if hashlib.sha256(der).hexdigest() != expected:
        _close_quietly(sock)
        raise SystemExit(f'{label.capitalize()} certificate does not match the pinned SHA-256; nothing was sent.')


class PinnedFTP_TLS(ftplib.FTP_TLS):
    """FTPS whose optional certificate pin is enforced on every protected data connection too, and which
    exposes the live data socket so a bounded listing can tighten its read timeout while it streams."""

    expected_pin = None
    current_data_socket = None

    def ntransfercmd(self, cmd, rest=None):
        conn, size = super().ntransfercmd(cmd, rest)
        if self.expected_pin:
            verify_tls_certificate(conn, self.expected_pin, 'data connection')
        self.current_data_socket = conn
        return conn, size


def connect(creds):
    """Explicit FTPS. The control socket from FTP_TLS.connect is plaintext; the TLS handshake happens in
    auth(), so the certificate is inspected and credentials are sent only after that handshake. Without a
    pin the host certificate must match the connect name (strict default). With a pin, and only then, the
    fingerprint replaces hostname matching and is enforced on the control and every protected data socket;
    the chain must still verify against a trusted CA in both modes."""
    expected = normalize_cert_pin(creds.get('cert_sha256'))     # format first: a bad pin opens no connection
    context = ssl.create_default_context()
    context.check_hostname = expected is None                   # a valid pin is the only path off hostname matching
    context.verify_mode = ssl.CERT_REQUIRED
    ftp = PinnedFTP_TLS(context=context)
    ftp.expected_pin = expected
    try:
        ftp.connect(creds['host'], 21, timeout=60)
        ftp.auth()                                              # wrap the control socket before any cert check
        if expected is not None:
            verify_tls_certificate(ftp.sock, expected, 'control connection')
        ftp.login(creds['user'], creds['password'])             # credentials only after control authentication
        ftp.prot_p()
        ftp.set_pasv(True)
    except BaseException:
        _close_quietly(ftp)                                     # FTP.close closes the control file and socket; the original error is never masked
        raise
    return ftp


def _bounded_mlsd(ftp, directory, deadline, budget):
    """Collect one MLSD response through ftplib's retrlines callback so an endless or huge listing is
    aborted DURING collection (stock FTP.mlsd buffers the whole response before yielding anything and
    cannot be bounded). Every line counts against the shared entry budget and the deadline, the live
    data socket's read timeout is tightened to the remaining time, and every parsed path is guard()ed
    before it is recorded."""
    rows = []

    def collect(line):
        budget['entries'] += 1
        if budget['entries'] > MAX_LISTING_ENTRIES:
            raise SystemExit(f'Remote listing exceeds {MAX_LISTING_ENTRIES} entries; nothing was sent.')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SystemExit('Remote listing exceeded its time budget; nothing was sent.')
        data_socket = getattr(ftp, 'current_data_socket', None)
        if data_socket is not None:
            try:
                data_socket.settimeout(remaining)
            except (AttributeError, OSError, ValueError):
                pass
        facts_text, _, name = line.rstrip('\r\n').partition(' ')     # ftplib's parser: first-space partition, name byte spelling preserved
        facts = {}
        for token in facts_text.split(';'):
            key, _, value = token.partition('=')
            if key and _:
                facts[key.strip().lower()] = value.strip()
        if name in ('.', '..'):
            return
        rows.append((guard(f'{directory}/{name}'), facts))

    try:
        ftp.retrlines(f'MLSD {directory}', collect)
    except ftplib.error_perm:
        return []
    return rows


def remote_files(ftp, directory, deadline=None, depth=0, budget=None):
    """Every file under a remote directory, recursively: {path: size}. Bounded and guarded: one shared
    entry budget and one finite deadline are enforced during collection (see _bounded_mlsd), every path
    is guard()ed before it is listed or recursed into, and the control and live data sockets' read
    timeouts are tightened to the actual remaining time rather than a fixed minimum."""
    files = {}
    deadline = deadline if deadline is not None else time.monotonic() + LISTING_BUDGET_S
    if budget is None:
        budget = {'entries': 0}
    if depth > MAX_LISTING_DEPTH:
        raise SystemExit(f'Remote listing is deeper than {MAX_LISTING_DEPTH} levels; nothing was sent.')
    directory = guard(directory)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SystemExit('Remote listing exceeded its time budget; nothing was sent.')
    try:
        ftp.sock.settimeout(remaining)
    except (AttributeError, OSError, ValueError):
        pass
    try:
        rows = _bounded_mlsd(ftp, directory, deadline, budget)
    finally:
        if hasattr(ftp, 'current_data_socket'):
            ftp.current_data_socket = None
    for path, facts in rows:
        if facts.get('type') == 'dir':
            files.update(remote_files(ftp, path, deadline, depth + 1, budget))
        elif facts.get('type') == 'file':
            files[path] = int(facts.get('size', 0))
    return files


def ensure_dirs(ftp, directory, made):
    parts = guard(directory).split('/')
    for i in range(2, len(parts) + 1):          # never creates public_html itself
        path = '/'.join(parts[:i])
        if path in made:
            continue
        try:
            ftp.mkd(path)
        except ftplib.error_perm as error:
            if not str(error).startswith('550'):
                raise
        made.add(path)


DIALOG_TIMEOUT_MS = 300_000


def desktop_confirm(question):
    """Ask on the Windows desktop before anything is written; only an explicit Yes goes ahead.

    This is the confirmation an agent cannot give for you: the dialog appears on your screen and needs a click.
    No, closing it, the five-minute timeout, no desktop to show it on, or any error all mean nothing is sent.
    There is deliberately no flag or environment variable that skips it.
    """
    if sys.platform != 'win32':
        print('The deploy confirmation dialog needs Windows; nothing was sent.', file=sys.stderr)
        return False
    try:
        import ctypes
        yes_no, warning, default_no, system_modal, foreground, topmost = 0x4, 0x30, 0x100, 0x1000, 0x10000, 0x40000
        box = ctypes.windll.user32.MessageBoxTimeoutW
        box.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_ushort, ctypes.c_uint]
        box.restype = ctypes.c_int
        answer = box(None, question + '\n\nNothing has been sent yet. This closes as "No" after five minutes.',
                     'FTP deploy: confirm', yes_no | warning | default_no | system_modal | foreground | topmost, 0, DIALOG_TIMEOUT_MS)
        return answer == 6                         # IDYES
    except Exception as error:
        print(f'Could not show the confirmation dialog ({error}); nothing was sent.', file=sys.stderr)
        return False


def plan(folder):
    files = sorted(p for p in folder.rglob('*') if p.is_file())
    def order(p):
        rel = p.relative_to(folder).as_posix()
        if rel.startswith('index.html'):
            return (3, rel)                       # the landing page last, once everything it links to is up
        if rel == '.htaccess':
            return (2, rel)
        if rel.endswith(('.html', '.html.br', '.html.gz')):
            return (1, rel)
        return (0, rel)
    return sorted(files, key=order)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', help='a package made by package-upload.py, e.g. ../publish/upload-ready-v2')
    parser.add_argument('--credentials', help='credentials file (default: the derived ~/.config/<authored host label>/ftp-credentials)')
    parser.add_argument('--go', action='store_true', help='actually back up and upload; without it, only plan')
    args = parser.parse_args()
    folder = Path(args.folder).resolve()
    if not (folder / 'index.html').is_file() or not (folder / '.htaccess').is_file():
        raise SystemExit(f'{folder} does not look like an upload package (needs index.html and .htaccess).')
    local = plan(folder)
    creds = load_credentials(args.credentials)
    ftp = connect(creds)
    try:
        existing = {guard(remote): size for remote, size in remote_files(ftp, REMOTE_ROOT).items()}
        targets = {guard(f'{REMOTE_ROOT}/{p.relative_to(folder).as_posix()}'): p for p in local}
        print(f'{len(local)} files, {sum(p.stat().st_size for p in local):,} bytes -> {REMOTE_ROOT}/')
        print(f'on the server now: {len(existing)} files; replaced: {len(set(existing) & set(targets))}; '
              f'new: {len(set(targets) - set(existing))}')
        for extra in sorted(set(existing) - set(targets)):
            print('  left alone (not in package):', extra)
        if not args.go:
            print('Dry run: nothing sent. Add --go to back up and upload.')
            return
        question = (f'Upload {len(local)} files ({sum(p.stat().st_size for p in local) / 1e6:.1f} MB) from\n{folder.name}\n'
                    f'to {authored_base()} ?\n\nReplaces {len(set(existing) & set(targets))} files on the live site; '
                    f'adds {len(set(targets) - set(existing))}.')
        print('Waiting for confirmation on the desktop...', flush=True)
        if not desktop_confirm(question):
            raise SystemExit('Not confirmed on the desktop: nothing was sent.')
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = BACKUPS / f'heartwood-{stamp}'
        for remote in sorted(existing):
            target = backup / remote
            if not target.resolve().is_relative_to(backup.resolve()):
                raise SystemExit(f'Refusing backup target outside {backup.name}/: {remote}')
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('wb') as handle:
                ftp.retrbinary(f'RETR {remote}', handle.write)
            if target.stat().st_size != existing[remote]:
                raise SystemExit(f'Backup of {remote} is incomplete; nothing has been uploaded.')
        print(f'backed up {len(existing)} files to {backup}')
        made, record = set(), []
        for remote, path in targets.items():
            ensure_dirs(ftp, posixpath.dirname(remote), made)
            temporary = guard(remote + '.uploading')
            with path.open('rb') as handle:
                ftp.storbinary(f'STOR {temporary}', handle)
            size = path.stat().st_size
            if ftp.size(temporary) != size:
                raise SystemExit(f'Size mismatch after uploading {remote}; stopped. Backup: {backup}')
            try:
                ftp.rename(temporary, remote)            # replaces the old file in one step on this host
            except ftplib.error_perm:
                ftp.delete(remote)
                ftp.rename(temporary, remote)
            record.append({'path': remote, 'bytes': size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            print('  up', remote)
        (backup / 'deploy-record.json').write_text(json.dumps(
            {'when': stamp, 'from': str(folder), 'remote': REMOTE_ROOT, 'files': record}, indent=2) + '\n', encoding='utf-8')
        print(f'done: {len(record)} files. Record and backup: {backup}')
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


if __name__ == '__main__':
    main()
