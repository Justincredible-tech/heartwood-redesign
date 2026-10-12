"""Lossless precompression, with round-trip verification for every text asset."""
import gzip
import json
from pathlib import Path
import brotli

ROOT = Path(__file__).resolve().parent.parent
PUBLISH = ROOT / 'publish'
manifest = json.loads((ROOT / 'tools/build-manifest.json').read_text(encoding='utf-8'))
sizes = {}
for relative in manifest['generated']:
    target = (PUBLISH / relative).resolve()
    assert target.is_relative_to(PUBLISH.resolve())
    if target.suffix not in ('.html', '.css', '.js', '.svg'):
        continue
    raw = target.read_bytes()
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    br = brotli.compress(raw, quality=11)
    assert gzip.decompress(gz) == raw and brotli.decompress(br) == raw
    target.with_name(target.name + '.gz').write_bytes(gz)
    target.with_name(target.name + '.br').write_bytes(br)
    sizes[relative] = {'raw': len(raw), 'gzip': len(gz), 'brotli': len(br)}
(ROOT / 'tools/compression-report.json').write_text(json.dumps(sizes, indent=2) + '\n', encoding='utf-8')
print(json.dumps(sizes, indent=2))
