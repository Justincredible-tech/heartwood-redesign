"""Upload a packaged folder to https://justincredible.tech/heartwood/ over explicit FTPS.

Dry run is the default; nothing is sent without --go.

    python deploy-ftp.py ../publish/upload-ready-v2 --credentials <file>          # show the plan
    python deploy-ftp.py ../publish/upload-ready-v2 --credentials <file> --go     # back up, then upload

Credentials are never stored in this repository. They come from FTP_HOST / FTP_USER / FTP_PASS in the
environment, or from the file given by --credentials (KEY=value or "Key: value" lines; host may be omitted).
The default file is ~/.config/justincredible/ftp-credentials.

Safety, because the FTP account reaches the whole hosting account, not just this site:
- every remote path must resolve under public_html/heartwood/ (the guard below), so nothing else is touched;
- before the first write, every file already in that folder is downloaded to deploy-backups/<time>/;
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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = 'public_html/heartwood'
DEFAULT_HOST = 'ftp.justincredible.tech'
DEFAULT_CREDENTIALS = Path.home() / '.config/justincredible/ftp-credentials'
BACKUPS = ROOT / 'deploy-backups'


def guard(remote):
    """Refuse any path outside public_html/heartwood/. Called for every write."""
    normal = posixpath.normpath(remote)
    if normal != REMOTE_ROOT and not normal.startswith(REMOTE_ROOT + '/'):
        raise SystemExit(f'Refusing to touch {remote!r}: outside {REMOTE_ROOT}/.')
    if '..' in normal.split('/'):
        raise SystemExit(f'Refusing path with "..": {remote!r}')
    return normal


def load_credentials(path):
    found = {'host': os.environ.get('FTP_HOST', ''), 'user': os.environ.get('FTP_USER', ''),
             'password': os.environ.get('FTP_PASS', '')}
    aliases = {'host': 'host', 'ftp_host': 'host', 'server': 'host',
               'user': 'user', 'username': 'user', 'usernamer': 'user', 'ftp_user': 'user',
               'pass': 'password', 'password': 'password', 'psswrd': 'password', 'ftp_pass': 'password'}
    file = Path(path) if path else DEFAULT_CREDENTIALS
    if file.is_file():
        for line in file.read_text(encoding='utf-8').splitlines():
            match = re.match(r'\s*([A-Za-z_]+)\s*[:=]\s*(.*?)\s*$', line)
            if match and not line.lstrip().startswith('#'):
                key = aliases.get(match.group(1).lower())
                if key and not found[key]:
                    found[key] = match.group(2)
    found['host'] = found['host'] or DEFAULT_HOST
    if not (found['user'] and found['password']):
        raise SystemExit('No FTP credentials: set FTP_USER / FTP_PASS, or pass --credentials <file>.')
    return found


def connect(creds):
    """Explicit FTPS only. The host presents HostGator's wildcard certificate, which does not name the
    customer subdomain, so hostname checking is off; the chain must still verify against a trusted CA."""
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_REQUIRED
    ftp = ftplib.FTP_TLS(context=context)
    ftp.connect(creds['host'], 21, timeout=60)
    ftp.login(creds['user'], creds['password'])
    ftp.prot_p()
    ftp.set_pasv(True)
    return ftp


def remote_files(ftp, directory):
    """Every file under a remote directory, recursively: {path: size}."""
    files = {}
    try:
        entries = list(ftp.mlsd(directory))
    except ftplib.error_perm:
        return files
    for name, facts in entries:
        if name in ('.', '..'):
            continue
        path = f'{directory}/{name}'
        if facts.get('type') == 'dir':
            files.update(remote_files(ftp, path))
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
    parser.add_argument('--credentials', help='credentials file (default ~/.config/justincredible/ftp-credentials)')
    parser.add_argument('--go', action='store_true', help='actually back up and upload; without it, only plan')
    args = parser.parse_args()
    folder = Path(args.folder).resolve()
    if not (folder / 'index.html').is_file() or not (folder / '.htaccess').is_file():
        raise SystemExit(f'{folder} does not look like an upload package (needs index.html and .htaccess).')
    local = plan(folder)
    creds = load_credentials(args.credentials)
    ftp = connect(creds)
    try:
        existing = remote_files(ftp, REMOTE_ROOT)
        targets = {guard(f'{REMOTE_ROOT}/{p.relative_to(folder).as_posix()}'): p for p in local}
        print(f'{len(local)} files, {sum(p.stat().st_size for p in local):,} bytes -> {REMOTE_ROOT}/')
        print(f'on the server now: {len(existing)} files; replaced: {len(set(existing) & set(targets))}; '
              f'new: {len(set(targets) - set(existing))}')
        for extra in sorted(set(existing) - set(targets)):
            print('  left alone (not in package):', extra)
        if not args.go:
            print('Dry run: nothing sent. Add --go to back up and upload.')
            return
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = BACKUPS / f'heartwood-{stamp}'
        for remote in sorted(existing):
            target = backup / remote
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
