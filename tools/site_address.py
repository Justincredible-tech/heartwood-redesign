"""The authored public address of this package, derived from the site source alone.

source/heartwood-site.html carries its own <link rel="canonical">; deployment, meta and credential
discovery derive their defaults from it instead of embedding the domain. Explicit parameters
(--base, --credentials, FTP_HOST, ...) always override the derived defaults.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_PAGE = ROOT / 'source' / 'heartwood-site.html'
CANONICAL = re.compile(r'<link rel="canonical" href="(https://[^/"]+)/([a-z0-9-]+)/[^"]*"')


def authored_parts(page=None):
    """(origin, package) e.g. ('https://web.example', 'package'), from the authored canonical."""
    text = (page or SOURCE_PAGE).read_text(encoding='utf-8')
    match = CANONICAL.search(text)
    if not match:
        raise SystemExit('The authored canonical link was not found in source/heartwood-site.html; pass the address explicitly.')
    return match.group(1), match.group(2)


def authored_origin(page=None):
    return authored_parts(page)[0]


def authored_base(page=None):
    """The public package root with a trailing slash, e.g. https://web.example/package/."""
    origin, package = authored_parts(page)
    return f'{origin}/{package}/'


def host_label(page=None):
    """The first DNS label of the authored origin (the credential namespace), e.g. 'web'."""
    return authored_origin(page).split('//', 1)[1].split('.', 1)[0]
