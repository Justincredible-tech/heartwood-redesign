# Opt-in owned-build integration for tools/package-upload.py (corr-081 item 3).
#
# Intentionally NOT a *.test.py file: the required public roster rejects skipped runs, and this
# integration needs an owned rebuild (~5 s) plus real packaging via the default uv cache with
# brotli (~11 s). Run it on demand:
#
#   uv run --offline --no-project python tests/package-provenance-integration.py
#
# The light, hermetic provenance tests stay in tests/review-qwen-package-provenance.test.py and ARE
# part of the required roster.
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

FORK = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def tree_listing(root):
    rows = []
    for path in root.rglob('*'):
        if path.is_file():
            relative = './' + path.relative_to(root).as_posix()
            rows.append((relative, digest(path.read_bytes())))
    rows.sort()
    text = ''.join(f'{value}  {relative}\n' for relative, value in rows)
    return hashlib.sha256(text.encode('utf-8')).hexdigest(), len(rows), text


def authored_base():
    """The package root the real source declares, e.g. https://host/package/."""
    text = (FORK / 'source' / 'heartwood-site.html').read_text(encoding='utf-8')
    match = re.search(r'<link rel="canonical" href="(https://[^/"]+)/([a-z0-9-]+)/[^"]*"', text)
    if not match:
        raise AssertionError('the authored canonical is missing from source/heartwood-site.html')
    return f'{match.group(1)}/{match.group(2)}/'


REAL_BASE = authored_base()
REAL_ENTRY = REAL_BASE + 'living-tree.html'


class OwnedBuildIntegrationTests(unittest.TestCase):
    """The verified recipe: owned copy, node build, real packaging, emitted-package verification."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix='hw-pkg-integration-')
        cls.root = Path(cls._tmp.name) / 'project'
        cls.root.mkdir()
        for name in ('source', 'tools', 'showcase', 'mockups'):
            target = cls.root / name
            target.mkdir()
            subprocess.run(['rsync', '-a', '--exclude', 'node_modules', '--exclude', '__pycache__',
                            str(FORK / name) + '/', str(target) + '/'],
                           check=True, capture_output=True, text=True)
        os.symlink(FORK / 'tools' / 'node_modules', cls.root / 'tools' / 'node_modules')
        build = subprocess.run(['node', 'build-site.mjs'], cwd=cls.root / 'tools',
                               capture_output=True, text=True, timeout=900)
        if build.returncode != 0:
            raise AssertionError('owned build failed:\n' + build.stdout[-4000:] + build.stderr[-4000:])
        shutil.copyfile(FORK / 'publish' / '.htaccess', cls.root / 'publish' / '.htaccess')
        cls.build_log = build.stdout

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def package(self, name, *extra):
        command = ['uv', 'run', '--offline', '--no-project', '--with', 'brotli', 'python',
                   'package-upload.py', '--name', name, *extra]
        env = dict(os.environ, UV_OFFLINE='1')
        return subprocess.run(command, cwd=self.root / 'tools', capture_output=True, text=True,
                              timeout=600, env=env)

    @staticmethod
    def retain(name, text):
        """Optionally keep the produced listing under the lane evidence dir."""
        target = os.environ.get('HW_PACKAGE_EVIDENCE_DIR')
        if target:
            Path(target).mkdir(parents=True, exist_ok=True)
            (Path(target) / name).write_text(text, encoding='utf-8')

    def test_site_only_package_matches_the_pinned_shape(self):
        result = self.package('corr081', '--site-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        package = self.root / 'publish' / 'corr081'
        tree, count, listing = tree_listing(package)
        self.assertEqual(count, 209, 'site-only package file count\n' + listing[:2000])
        sources = {'index.html': 'experience-entry.html', 'desktop-day.html': 'desktop-day.html',
                   'taste/index.html': 'taste/index.html', 'taste/scene.html': 'taste/scene.html'}
        retargeted = 0
        for document, source in sources.items():
            before = (self.root / 'publish' / source).read_bytes()
            after = (package / document).read_bytes()
            self.assertEqual(before.count(REAL_ENTRY.encode()), 2,
                             f'{source} should carry canonical + og:url')
            self.assertNotIn(REAL_ENTRY.encode(), after)
            self.assertEqual(after, before.replace(REAL_ENTRY.encode(), REAL_BASE.encode()),
                             document + ' must differ from its source only by the two entry URLs')
            retargeted += before.count(REAL_ENTRY.encode())
        self.assertEqual(retargeted, 8, 'exactly four documents / eight URL occurrences are retargeted')
        published_mobile = self.root / 'publish' / 'mobile'
        packaged_mobile = package / 'mobile'
        published = {p.relative_to(published_mobile).as_posix(): digest(p.read_bytes())
                     for p in published_mobile.rglob('*') if p.is_file()}
        copied = {p.relative_to(packaged_mobile).as_posix(): digest(p.read_bytes())
                  for p in packaged_mobile.rglob('*') if p.is_file()}
        self.assertEqual(sorted(copied), sorted(set(copied) & set(published)),
                         'every packaged mobile file must exist in the owned build')
        self.assertEqual({name: copied[name] for name in copied},
                         {name: published[name] for name in copied},
                         'packaged mobile files must be byte-identical to the owned build')
        print(f'INTEGRATION mobile packaged={len(copied)} published={len(published)} '
              f'not-shipped={len(set(published) - set(copied))}')
        self.retain('package-tree-site-only.txt', listing)
        self.retain('packager-site-only.log', result.stdout + result.stderr)
        print(f'INTEGRATION site-only files={count} tree={tree}')

    def test_showcase_package_matches_the_pinned_shape(self):
        result = self.package('corr081show')
        self.assertEqual(result.returncode, 0, result.stderr)
        package = self.root / 'publish' / 'corr081show'
        tree, count, listing = tree_listing(package)
        self.assertEqual(count, 234, 'showcase package file count\n' + listing[:2000])
        self.assertEqual((package / 'living-tree.html').read_bytes(),
                         (self.root / 'publish' / 'experience-entry.html').read_bytes())
        self.assertIn(b'data-hw-public-entry="living-tree.html"', (package / 'desktop-day.html').read_bytes())
        self.retain('package-tree-showcase.txt', listing)
        self.retain('packager-showcase.log', result.stdout + result.stderr)
        print(f'INTEGRATION showcase files={count} tree={tree}')


if __name__ == '__main__':
    unittest.main()
