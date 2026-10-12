"""One-time asset import; ordinary site builds work entirely offline afterward."""
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'source' / 'assets' / 'fonts'
FONTS.mkdir(parents=True, exist_ok=True)
CSS_URL = 'https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Sans:wght@400..700&display=swap'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=30) as response:
        return response.read()

css = fetch(CSS_URL).decode('utf-8')
records = []
for match in list(re.finditer(r'/\* (latin(?:-ext)?) \*/\s*(@font-face\s*\{.*?\})', css, re.S)):
    subset, face = match.groups()
    family = re.search(r"font-family:\s*'([^']+)'", face).group(1)
    url = re.search(r'url\((https://[^)]+\.woff2)\)', face).group(1)
    data = fetch(url)
    digest = hashlib.sha256(data).hexdigest()
    name = family.lower().replace(' ', '-') + '-' + subset + '.' + digest[:12] + '.woff2'
    (FONTS / name).write_bytes(data)
    css = css.replace(url, '../assets/fonts/' + name)
    records.append({'family': family, 'subset': subset, 'source': url, 'file': name, 'bytes': len(data), 'sha256': digest})

assert len(records) == 4, 'Expected both original families and their Latin / Latin-ext subsets.'
for family in ('instrumentsans', 'youngserif'):
    url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/OFL.txt'
    data = fetch(url)
    assert b'SIL OPEN FONT LICENSE' in data
    (FONTS / (family + '-OFL.txt')).write_bytes(data)

(ROOT / 'source' / 'css' / 'fonts.css').write_text(css, encoding='utf-8', newline='\n')
(ROOT / 'tools' / 'font-provenance.json').write_text(json.dumps({'stylesheet': CSS_URL, 'fonts': records}, indent=2) + '\n', encoding='utf-8')
print(json.dumps(records, indent=2))
