"""Artifact fidelity and real HTTP negotiation checks; no browser automation."""
import gzip
import hashlib
import json
import os
import re
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
import brotli
from preview import accepted_encoding
from build_features import manifest_features

ROOT = Path(__file__).resolve().parent.parent
PUBLISH = ROOT / 'publish'
MANIFEST = json.loads((ROOT / 'tools/build-manifest.json').read_text(encoding='utf-8'))
# Default delivery means the complete build. An excluded profile must be chosen
# explicitly; missing/contradictory metadata never silently disables assertions.
FEATURES = manifest_features(MANIFEST, expected=os.environ.get('HEARTWOOD_BUILD_EXCLUDE', []))
# Point this at the preview serving *this* checkout; another copy of the project may hold 8001.
BASE = os.environ.get('HEARTWOOD_PREVIEW', 'http://127.0.0.1:8001/')

class SiteShape(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.elements, self.text = [], []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag == 'link':
            return
        attrs = dict(attrs)
        if tag == 'script':
            attrs.pop('src', None)
        # A missing SVG default attribute is semantically unchanged.
        if tag == 'script' and attrs.get('type') == 'text/javascript':
            attrs.pop('type')
        self.elements.append((tag, attrs))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, text):
        value = re.sub(r'\s+', ' ', text).strip()
        if value:
            self.text.append(value)

def request(relative, encoding=None, headers=None, method='GET'):
    values = dict(headers or {})
    if encoding is not None:
        values['Accept-Encoding'] = encoding
    return urllib.request.urlopen(urllib.request.Request(BASE + relative, headers=values, method=method), timeout=10)

class DeliveryTests(unittest.TestCase):
    def test_supplied_logo_geometry_and_originals_preserved(self):
        namespace = '{http://www.w3.org/2000/svg}'
        sprite = ET.parse(ROOT / 'source/assets/logos/heartwood-logos.svg').getroot()
        pairs = [('Heartwood-Young-Serif-oak-wordmark-transparent - Copy.svg', 'heartwood-wordmark-original.svg', 'hw-logo'),
                 ('hardwood-T-11-oak-curved-forks-transparent.svg', 'heartwood-oak-original.svg', 'hw-mark')]
        def geometry(root):
            return [(child.tag, {key: value for key, value in child.attrib.items() if key != 'fill'})
                    for branch in root for child in branch.iter()
                    if child.tag not in (namespace + 'title', namespace + 'desc')]
        for supplied, renamed, identifier in pairs:
            original = (ROOT / 'finalLogos' / supplied).read_bytes()
            self.assertEqual(original, (ROOT / 'source/assets/logos' / renamed).read_bytes())
            source = ET.fromstring(original)
            symbol = sprite.find(namespace + 'symbol' + "[@id='" + identifier + "']")
            self.assertIsNotNone(symbol)
            self.assertEqual(source.attrib['viewBox'], symbol.attrib['viewBox'])
            self.assertEqual(geometry(source), geometry(symbol))
            self.assertTrue(all(child.attrib['fill'] == 'currentColor' for child in symbol.iter() if 'fill' in child.attrib))
        published = (PUBLISH / 'heartwood-site.html').read_text(encoding='utf-8')
        ET.register_namespace('', 'http://www.w3.org/2000/svg')
        embedded_symbols = [SiteShape(fragment) for fragment in re.findall(r'<symbol\b.*?</symbol>', published, re.DOTALL)]
        for symbol in sprite:
            expected = SiteShape(ET.tostring(symbol, encoding='unicode'))
            actual = next(shape for shape in embedded_symbols if shape.elements[0][1].get('id') == symbol.attrib['id'])
            for shape in (expected, actual):
                for _, attrs in shape.elements:
                    attrs.pop('xmlns', None)
            self.assertEqual(expected.elements, actual.elements)

    def test_html_preserves_artwork_elements_attributes_and_text(self):
        authored = (ROOT / 'source/heartwood-site.html').read_text(encoding='utf-8')
        published = (PUBLISH / 'heartwood-site.html').read_text(encoding='utf-8')
        controller = '<script src="js/live-photos.js"></script>'
        self.assertEqual(authored.count(controller), 1, 'the shared controller is bundled exactly once')
        authored = authored.replace(controller, '')
        compiled = (PUBLISH / MANIFEST['assets']['js']).read_text(encoding='utf-8')
        self.assertIn('HeartwoodPhotos.create', compiled, 'bundling must retain the live-photo controller and its caller')
        self.assertNotIn('js/live-photos.js', published)
        if not FEATURES['night']:
            authored, count = re.subn(r'<a\b[^>]*\bdata-hw-mode[^>]*>[\s\S]*?</a>', '', authored)
            self.assertEqual(count, 1, 'exactly the unavailable mode control is removed')
        if not FEATURES['night'] or not FEATURES['phone']:
            # This first dispatcher is deliberately rebuilt by feature policy.
            # All later script/art/content text and all elements stay exact.
            authored, count = re.subn(r'(<script>)[\s\S]*?(</script>)', r'\1\2', authored, count=1)
            self.assertEqual(count, 1)
            published, count = re.subn(r'(<script>)[\s\S]*?(</script>)', r'\1\2', published, count=1)
            self.assertEqual(count, 1)
        before = SiteShape(authored)
        after = SiteShape(published)
        self.assertEqual(before.elements, after.elements)
        self.assertEqual(before.text, after.text)

    def test_available_route_families_match_the_requested_profile(self):
        generated = MANIFEST['generated']
        self.assertTrue(generated)
        self.assertEqual(len(generated), len(set(generated)))
        for route in ('heartwood-site.html', 'desktop-day.html', 'experience-entry.html', 'taste/index.html', 'taste/scene.html'):
            self.assertIn(route, generated)
            self.assertTrue((PUBLISH / route).is_file())
        if FEATURES['phone']:
            for route in ('mobile/index.html', 'mobile/day.html', 'mobile/manifest.json'):
                self.assertIn(route, generated)
            self.assertEqual('mobile/night.html' in generated, FEATURES['night'])
        else:
            self.assertFalse(any(path.startswith('mobile/') for path in generated))
            for route in ('mobile/index.html', 'mobile/day.html', 'mobile/night.html', 'mobile/manifest.json'):
                self.assertFalse((PUBLISH / route).exists(), 'stale excluded phone route: ' + route)
        if not FEATURES['night']:
            for route in ('heartwood-site.html', 'taste/scene.html', 'experience-entry.html', 'taste/index.html'):
                body = (PUBLISH / route).read_text(encoding='utf-8')
                self.assertNotIn('data-hw-mode', body)
                self.assertNotIn('mobile/night.html', body)
                self.assertNotIn('>Night</a>', body)

    def test_all_text_compression_round_trips(self):
        for relative in MANIFEST['generated']:
            target = PUBLISH / relative
            if target.suffix not in ('.html', '.css', '.js', '.svg'):
                continue
            data = target.read_bytes()
            self.assertEqual(gzip.decompress(Path(str(target) + '.gz').read_bytes()), data)
            self.assertEqual(brotli.decompress(Path(str(target) + '.br').read_bytes()), data)

    def test_encoding_quality_and_rejections(self):
        both = {'br', 'gzip'}
        self.assertEqual(accepted_encoding('gzip, br', both), 'br')
        self.assertEqual(accepted_encoding('br;q=0, gzip', both), 'gzip')
        self.assertEqual(accepted_encoding('br;q=.5, gzip;q=.9', both), 'gzip')
        self.assertEqual(accepted_encoding('br;q=0, gzip;q=0', both), 'identity')
        self.assertIsNone(accepted_encoding('br;q=0, gzip;q=0, identity;q=0', both))

    def test_http_brotli_gzip_identity_are_exact(self):
        for encoding, decode in [('br', brotli.decompress), ('gzip', gzip.decompress), ('identity', lambda data: data)]:
            for relative in MANIFEST['assets'].values():
                with request(relative, encoding) as response:
                    data = response.read()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers.get('Content-Encoding', 'identity'), encoding)
                    self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
                    self.assertEqual(decode(data), (PUBLISH / relative).read_bytes())
                    self.assertEqual(int(response.headers['Content-Length']), len(data))

    def test_hash_assets_cache_and_html_revalidate(self):
        for key, relative in MANIFEST['assets'].items():
            with request(relative, 'br') as response:
                cache = response.headers['Cache-Control']
                self.assertIn('immutable' if key != 'html' else 'no-cache', cache)
                etag = response.headers['ETag']
            try:
                response = request(relative, 'br', {'If-None-Match': etag})
            except urllib.error.HTTPError as response:
                self.assertEqual(response.code, 304)
            else:
                response.close()
                self.fail('Expected HTTP304 for same representation')
            with request(relative, 'identity', {'If-None-Match': etag}) as response:
                self.assertEqual(response.status, 200)

    def test_fonts_exact_and_available(self):
        for record in json.loads((ROOT / 'tools/font-provenance.json').read_text())['fonts']:
            relative = 'assets/fonts/' + record['file']
            self.assertEqual((PUBLISH / relative).read_bytes(), (ROOT / 'source' / relative).read_bytes())
            with request(relative) as response:
                self.assertEqual(response.headers.get_content_type(), 'font/woff2')
                self.assertEqual(len(response.read()), record['bytes'])

    def test_grain_tiles_match_recipe_and_are_delivered(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('render_grain', ROOT / 'tools' / 'render-grain.py')
        grain_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(grain_mod)
        css = (ROOT / 'source/css/heartwood-site.css').read_text(encoding='utf-8')
        fine = ' '.join(re.search(r'--grain-fine:\s*(.*?);', css, re.S).group(1).split())
        provenance = json.loads((ROOT / 'source/assets/grain/grain-provenance.json').read_text(encoding='utf-8'))
        self.assertEqual(hashlib.sha256(fine.encode('utf-8')).hexdigest(), provenance['recipe_sha256'],
                         '--grain-fine changed since the tiles were drawn: run tools/render-grain.py')
        built_css = (PUBLISH / MANIFEST['assets']['css']).read_text(encoding='utf-8')
        html = (PUBLISH / 'heartwood-site.html').read_text(encoding='utf-8')
        for record in provenance['tiles'].values():
            relative = 'assets/grain/' + record['file']
            self.assertIn(relative, MANIFEST['generated'])
            self.assertEqual((PUBLISH / relative).read_bytes(), (ROOT / 'source' / relative).read_bytes())
            self.assertIn('../' + relative, built_css)
            self.assertEqual(html.count('href=' + relative + ' '), 1, 'each tile is preloaded exactly once')
            with request(relative) as response:
                self.assertEqual(response.headers.get_content_type(), 'image/webp')
                self.assertIn('immutable', response.headers['Cache-Control'])
                self.assertEqual(len(response.read()), record['bytes'])
        night = provenance.get('night')
        self.assertIsNotNone(night, 'the night grain section must be pinned once the night tiles are adopted')
        self.assertEqual(hashlib.sha256(grain_mod.night_recipe(css).encode('utf-8')).hexdigest(), night['recipe_sha256'],
                         'the night recipe changed since the night tiles were drawn: run tools/render-grain.py --recipe night')
        taste_css_files = sorted((PUBLISH / 'css').glob('heartwood-taste.*.css'))
        self.assertEqual(len(taste_css_files), 1, 'exactly one taste stylesheet')
        taste_css = taste_css_files[0].read_text(encoding='utf-8')
        if FEATURES['night']:
            self.assertIn('var(--grain-tile-night)', taste_css)
        else:
            self.assertNotIn('grain-tile-night', taste_css)
        for record in night['tiles'].values():
            relative = 'assets/grain/' + record['file']
            self.assertNotIn(record['file'], html, 'the day page must not reference night tiles')
            if FEATURES['night']:
                self.assertIn(relative, MANIFEST['generated'])
                self.assertEqual((PUBLISH / relative).read_bytes(), (ROOT / 'source' / relative).read_bytes())
                self.assertIn('../' + relative, taste_css)
                with request(relative) as response:
                    self.assertEqual(response.headers.get_content_type(), 'image/webp')
                    self.assertIn('immutable', response.headers['Cache-Control'])
                    self.assertEqual(len(response.read()), record['bytes'])
            else:
                self.assertNotIn(relative, MANIFEST['generated'])
                self.assertFalse((PUBLISH / relative).exists(), 'stale excluded Night grain: ' + relative)
                self.assertNotIn(record['file'], taste_css)

    def test_photos_are_local_small_and_delivered(self):
        provenance = json.loads((ROOT / 'source/assets/photos/photos-provenance.json').read_text(encoding='utf-8'))['photos']
        script = (PUBLISH / MANIFEST['assets']['js']).read_text(encoding='utf-8')
        source_js = (ROOT / 'source/js/heartwood-site.js').read_text(encoding='utf-8')
        self.assertEqual(len(provenance), 2, 'the Heartbeat cover and the Forest Council poster')
        for url, record in provenance.items():
            self.assertIn("ORIGIN + '" + url.removeprefix('https://heartwood.org') + "'", source_js, 'the page still names the original')
            self.assertIn(url, script, 'the built script maps the original address to its copies')
            for photo in record['files']:
                relative = 'assets/photos/' + photo['file']
                self.assertIn(relative, MANIFEST['generated'])
                self.assertIn(relative, script)
                self.assertEqual((PUBLISH / relative).read_bytes(), (ROOT / 'source' / relative).read_bytes())
                self.assertLess(photo['bytes'], 450_000)
                with request(relative) as response:
                    self.assertEqual(response.headers.get_content_type(), 'image/webp')
                    self.assertIn('immutable', response.headers['Cache-Control'])
                    self.assertEqual(len(response.read()), photo['bytes'])

    def test_favicons_and_share_images(self):
        html = (PUBLISH / 'heartwood-site.html').read_text(encoding='utf-8')
        landing = (ROOT / 'showcase/index.html').read_text(encoding='utf-8')
        icons = re.findall(r'<link rel=(?:icon|apple-touch-icon) href=(assets/meta/[^ >]+)', html)
        self.assertEqual(len(icons), 3, 'svg, 32px png and apple-touch icon')
        types = {'.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg'}
        for relative in icons:
            self.assertIn(relative, MANIFEST['generated'])
            with request(relative) as response:
                self.assertEqual(response.headers.get_content_type(), types[Path(relative).suffix])
                self.assertIn('immutable', response.headers['Cache-Control'])
        for page, text in (('living tree', html), ('landing page', landing)):
            image = re.search(r'<meta property="?og:image"? content="?(https://[^" >]+)', text)
            self.assertIsNotNone(image, f'{page} has an absolute og:image')
            relative = 'assets/meta/' + image.group(1).rsplit('/', 1)[1]
            self.assertIn(relative, MANIFEST['generated'])
            data = (PUBLISH / relative).read_bytes()
            self.assertEqual(data[:3], b'\xff\xd8\xff', 'share image is a JPEG')
            self.assertIn('summary_large_image', text)
        for href in re.findall(r'href="(assets/meta/[^"]+)"', landing):
            self.assertIn(href, MANIFEST['generated'], 'landing page icons exist in the build')

    def test_no_directory_or_development_file_exposure(self):
        for relative in ['agents/tech-lead.md', '.conductor/project.md', 'css/', '../tools/package.json', '%2e%2e/tools/package.json']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(relative)
            self.assertEqual(error.exception.code, 404)

    def test_unacceptable_encoding_and_head(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            request('heartwood-site.html', 'br;q=0, gzip;q=0, identity;q=0')
        self.assertEqual(error.exception.code, 406)
        with request('heartwood-site.html', 'br', method='HEAD') as response:
            self.assertEqual(response.read(), b'')
            self.assertGreater(int(response.headers['Content-Length']), 0)

if __name__ == '__main__':
    unittest.main(verbosity=2)
