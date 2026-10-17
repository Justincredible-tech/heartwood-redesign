import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import types
import unittest

TARGET = Path(os.environ.get('HW_FONT_IMPORT_TARGET', Path(__file__).resolve().parents[1] / 'tools/vendor-fonts.py'))

def assert_inert_source(source):
    tree = ast.parse(source)
    forbidden = {'fetch', 'urlopen', 'mkdir', 'write_bytes', 'write_text'}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if (isinstance(node, ast.If) and isinstance(node.test, ast.Compare)
                and isinstance(node.test.left, ast.Name) and node.test.left.id == '__name__'
                and len(node.test.ops) == 1 and isinstance(node.test.ops[0], ast.Eq)
                and len(node.test.comparators) == 1
                and isinstance(node.test.comparators[0], ast.Constant)
                and node.test.comparators[0].value == '__main__'):
            continue
        for call in ast.walk(node):
            if isinstance(call, ast.Call):
                name = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, 'attr', '')
                if name in forbidden:
                    raise AssertionError('Module import has top-level acquisition/write: ' + name)

def load():
    assert_inert_source(TARGET.read_text())
    spec = importlib.util.spec_from_file_location('review_font_import', TARGET)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class FontImportTests(unittest.TestCase):
    def test_import_source_is_inert(self):
        load()

    def test_help_invalid_and_live_are_inert_nonacquisition(self):
        assert_inert_source(TARGET.read_text())
        with tempfile.TemporaryDirectory(prefix='heartwood-font-cli-') as folder:
            before = list(Path(folder).rglob('*'))
            for args, code in [(['--help'], 0), (['--bad-option'], 2), ([], 2), (['--live'], 64), (['--plan'], 0)]:
                result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--cli-fixture', *args], cwd=folder,
                    env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'HW_ALLOW_EXTERNAL': 'force', 'HW_FONT_IMPORT_TARGET': str(TARGET)},
                    capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, code, result.stderr)
                if args == ['--live']:
                    report = json.loads(result.stderr)
                    self.assertEqual(report['status'], 'UNSUPPORTED')
                    self.assertEqual(report['requests'], 0)
                self.assertEqual(list(Path(folder).rglob('*')), before)

    def test_recipe_matches_author_styles_names_and_licenses(self):
        m = load()
        faces=[]
        for family in ['Young Serif', 'Instrument Sans']:
            for subset in ['latin', 'latin-ext']:
                url='https://fonts.gstatic.com/' + family.replace(' ', '-') + '-' + subset + '.woff2'
                faces.append((family, subset, url))
        css='\n'.join('/* '+subset+' */\n@font-face { font-family: \''+family+'\'; src: url('+url+'); }' for family,subset,url in faces)
        payloads={m.CSS_URL:css.encode(), **{url:('fixture:'+url).encode() for _,_,url in faces},
                  **{m.license_url(family):b'SIL OPEN FONT LICENSE\nfixture' for family in ['instrumentsans','youngserif']}}
        calls=[]
        def transport(url, **options):
            calls.append((url,options));return payloads[url]
        bundle=m.collect_fonts(transport)
        expected_css=css
        expected_records=[]
        for family,subset,url in faces:
            data=payloads[url];digest=hashlib.sha256(data).hexdigest()
            name=family.lower().replace(' ', '-')+'-'+subset+'.'+digest[:12]+'.woff2'
            expected_css=expected_css.replace(url,'../assets/fonts/'+name)
            expected_records.append({'family':family,'subset':subset,'source':url,'file':name,'bytes':len(data),'sha256':digest})
            self.assertEqual(bundle['files']['source/assets/fonts/'+name],data)
        self.assertEqual(bundle['files']['source/css/fonts.css'],expected_css.encode())
        self.assertEqual(bundle['records'],expected_records)
        self.assertEqual(json.loads(bundle['files']['tools/font-provenance.json']),{'stylesheet':m.CSS_URL,'fonts':expected_records})
        for family in ['instrumentsans','youngserif']:
            self.assertEqual(bundle['files']['source/assets/fonts/'+family+'-OFL.txt'],payloads[m.license_url(family)])
        self.assertEqual(len(calls),7)
        self.assertTrue(all(0 < o['timeout_seconds'] <= 10 and o['max_bytes'] > 0 for _,o in calls))
        with tempfile.TemporaryDirectory(prefix='heartwood-font-output-') as folder:
            m.write_bundle(bundle, folder)
            for name, data in bundle['files'].items():
                self.assertEqual((Path(folder) / name).read_bytes(), data)

    def test_bounds_reject_bad_face_count_oversize_and_elapsed_step(self):
        m=load();calls=[]
        def wrong(url,**options):
            calls.append(url);return b'not four faces'
        with self.assertRaises(ValueError):m.collect_fonts(wrong)
        self.assertEqual(len(calls),1)
        with self.assertRaises(ValueError):m.collect_fonts(lambda *_a,**_k:b'x'*(256*1024+1))
        current=[0]
        def delayed(_url,**_options):
            current[0]+=11;return b'css'
        with self.assertRaises(TimeoutError):m.collect_fonts(delayed,clock=lambda:current[0])

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--cli-fixture':
        sys.dont_write_bytecode = True
        def deny_effects(event, args):
            if event in ('socket.connect', 'urllib.Request', 'os.mkdir', 'os.remove', 'os.rename'):
                raise AssertionError('Inert CLI attempted external/filesystem effect: ' + event)
            if event == 'open':
                mode = args[1] or ''
                flags = args[2] if isinstance(args[2], int) else 0
                if any(c in mode for c in 'wax+') or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                    raise AssertionError('Inert CLI attempted file write')
        sys.addaudithook(deny_effects)
        sys.argv = [str(TARGET), *sys.argv[2:]]
        runpy.run_path(str(TARGET), run_name='__main__')
    else:
        unittest.main()
