"""Import the supplied vector logos without changing their path geometry.

Invoke this script from any directory; it resolves project paths from its own location.
The renamed originals and sprite stay in source. The HTML shares each logo symbol once.
"""
from copy import deepcopy
import hashlib
from pathlib import Path
import re
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / 'finalLogos'
OUTPUT = ROOT / 'source' / 'assets' / 'logos'
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)

LOGOS = (
    ('Heartwood-Young-Serif-oak-wordmark-transparent - Copy.svg',
     'heartwood-wordmark-original.svg', 'hw-logo', '0 0 2706 905', 9),
    ('hardwood-T-11-oak-curved-forks-transparent.svg',
     'heartwood-oak-original.svg', 'hw-mark', '142 110 970 1031', 1),
)


def geometry(element):
    """All artwork attributes except the single themeable paint value."""
    return [(child.tag, {key: value for key, value in child.attrib.items() if key != 'fill'})
            for child in element.iter() if child.tag not in (f'{{{NS}}}title', f'{{{NS}}}desc')]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sprite = ET.Element(f'{{{NS}}}svg')
    for supplied, renamed, identifier, view_box, path_count in LOGOS:
        original = (INPUT / supplied).read_bytes()
        logo = ET.fromstring(original)
        assert logo.attrib['viewBox'] == view_box
        assert len(logo.findall(f'.//{{{NS}}}path')) == path_count
        assert all(child.tag not in (f'{{{NS}}}script', f'{{{NS}}}image', f'{{{NS}}}foreignObject')
                   for child in logo.iter())
        (OUTPUT / renamed).write_bytes(original)
        symbol = ET.SubElement(sprite, f'{{{NS}}}symbol', {
            'id': identifier, 'viewBox': view_box, 'preserveAspectRatio': 'xMidYMid meet',
        })
        for child in logo:
            if child.tag not in (f'{{{NS}}}title', f'{{{NS}}}desc'):
                symbol.append(deepcopy(child))
        before = [entry for child in logo if child.tag not in (f'{{{NS}}}title', f'{{{NS}}}desc')
                  for entry in geometry(child)]
        for child in symbol.iter():
            if 'fill' in child.attrib:
                assert child.attrib['fill'] == '#20241f', 'Unexpected supplied logo paint'
                child.attrib['fill'] = 'currentColor'
        after = [entry for child in symbol for entry in geometry(child)]
        assert before == after, 'Logo geometry changed during import'
        assert (OUTPUT / renamed).read_bytes() == original
        print(f'{supplied} -> {renamed}: viewBox={view_box}, paths={path_count}, '
              f'sha256={hashlib.sha256(original).hexdigest()}')
    payload = ET.tostring(sprite, encoding='utf-8', xml_declaration=True) + b'\n'
    (OUTPUT / 'heartwood-logos.svg').write_bytes(payload)
    print(f'heartwood-logos.svg: {len(payload)} bytes, sha256={hashlib.sha256(payload).hexdigest()}')
    page = ROOT / 'source' / 'heartwood-site.html'
    html = page.read_bytes()
    old_anchor = b'<!-- Shared icon artwork. Approved Heartwood logos are in the cached external SVG sprite. -->'
    anchor = b'<!-- Approved Heartwood vector logos, imported from finalLogos with unchanged geometry. -->'
    if old_anchor in html:
        html = html.replace(old_anchor, anchor, 1)
    assert html.count(anchor) == 1, 'Missing or duplicate logo import anchor'
    symbols = []
    for symbol, (_, _, identifier, _, _) in zip(sprite, LOGOS):
        identifier_bytes = identifier.encode('ascii')
        inline = ET.tostring(symbol, encoding='utf-8').replace(
            f' xmlns="{NS}"'.encode('ascii'), b'', 1)
        pattern = rb'<symbol\b(?=[^>]*\bid="' + identifier_bytes + rb'")[^>]*>[\s\S]*?</symbol>'
        matches = list(re.finditer(pattern, html))
        assert len(matches) <= 1, 'Duplicate inline logo symbol'
        if matches:
            match = matches[0]
            html = html[:match.start()] + inline + html[match.end():]
        else:
            symbols.append(inline)
        external = b'assets/logos/heartwood-logos.svg#' + identifier_bytes
        html = html.replace(external, b'#' + identifier_bytes)
        assert html.count(b'<use href="#' + identifier_bytes + b'"/>') == (2 if identifier == 'hw-logo' else 7)
    if symbols:
        html = html.replace(anchor, anchor + b'\n' + b'\n'.join(symbols), 1)
    page.write_bytes(html)
    print('Source HTML: each approved symbol defined once; all nine uses are internal fragments')


if __name__ == '__main__':
    main()
