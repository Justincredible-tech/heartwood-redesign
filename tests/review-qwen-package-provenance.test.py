"""Provenance-gate regressions for tools/package-upload.py (codex-081 item 3).

Each case runs the shipped packager as a subprocess against a temporary project whose tools/ holds
byte-identical copies of package-upload.py, build_features.py and site_address.py. The fixture is
hermetic: a synthetic publish/showcase tree, no network, no node build. brotli is required:
    UV_OFFLINE=1 uv run --offline --no-project --with brotli python tests/review-qwen-package-provenance.test.py

The owned rebuild + real packaging integration is opt-in (HW_PACKAGE_INTEGRATION=1) because it runs
node and writes a temporary publish tree; it follows the verified recipe (rsync source/tools/showcase/
mockups, symlink tools/node_modules, node build-site.mjs, copy publish/.htaccess, then package).
"""
import gzip
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import brotli

FORK = Path(__file__).resolve().parents[1]
TOOLS = FORK / 'tools'
PYTHON = sys.executable

BASE = 'https://web.example/package/'
ENTRY = BASE + 'living-tree.html'
ROUTES = ('heartwood-site.html', 'desktop-day.html', 'experience-entry.html', 'taste/index.html', 'taste/scene.html')
CSS = 'css/heartwood-site.0123456789ab.css'
JS = 'js/heartwood-site.0123456789ab.js'
GENERATED = ROUTES + (CSS, JS)


def page(title):
    return ('<html lang="en"><head><link rel="canonical" href="' + ENTRY + '">'
            '<meta property="og:url" content="' + ENTRY + '"></head>'
            '<body>' + title + '</body></html>\n').encode('utf-8')


MAIN_PAGE = page('Heartwood')
ENTRY_PAGE = page('Entry')
BODIES = {
    'heartwood-site.html': MAIN_PAGE,   # the real tree ships these two identical
    'desktop-day.html': MAIN_PAGE,
    'experience-entry.html': ENTRY_PAGE,
    'taste/index.html': page('Taste index'),
    'taste/scene.html': page('Taste scene'),
    CSS: b'body{color:#123456}\n',
    JS: b'console.log("heartwood");\n',
}
LANDING = b'<html><body><a href="living-tree.html">site</a> <img src="assets/previews/one.webp"></body></html>\n'
MOCKUP = b'<html><body>mockup</body></html>\n'
PREVIEW = b'RIFF-webp-preview'
FEATURES = {'night': False, 'phone': False, 'treeEffects': True, 'networkEffects': True,
            'excluded': ['night', 'phone']}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def healthy_manifest(publish):
    return {
        'features': dict(FEATURES),
        'generated': list(GENERATED),
        'outputs': [{'path': relative, 'bytes': len(BODIES[relative]), 'sha256': digest(BODIES[relative])}
                    for relative in GENERATED],
    }


class Fixture:
    """A temporary project that runs the shipped packager with a controlled manifest and source tree."""

    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory(prefix='hw-pkg-prov-')
        self.root = Path(self._tmp.name) / 'project'
        (self.root / 'tools').mkdir(parents=True)
        (self.root / 'source').mkdir()
        for name in ('package-upload.py', 'build_features.py', 'site_address.py'):
            shutil.copyfile(TOOLS / name, self.root / 'tools' / name)
        (self.root / 'source' / 'heartwood-site.html').write_text(
            '<html><head><link rel="canonical" href="' + ENTRY + '"></head></html>\n', encoding='utf-8')
        self.write_publish()
        self.write_showcase()
        self.manifest = healthy_manifest(self.root / 'publish')
        self.write_manifest(self.manifest)

    def cleanup(self):
        self._tmp.cleanup()

    def write_publish(self):
        publish = self.root / 'publish'
        for relative, data in BODIES.items():
            target = publish / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            if target.suffix in ('.html', '.css', '.js'):
                target.with_name(target.name + '.gz').write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
                target.with_name(target.name + '.br').write_bytes(brotli.compress(data, quality=11))
        (publish / '.htaccess').write_bytes(b'# hosting\n')

    def write_showcase(self):
        showcase = self.root / 'showcase'
        (showcase / 'previews').mkdir(parents=True)
        (showcase / 'index.html').write_bytes(LANDING)
        (showcase / 'previews' / 'one.webp').write_bytes(PREVIEW)
        mockups = self.root / 'mockups'
        mockups.mkdir()
        (mockups / 'one.html').write_bytes(MOCKUP)

    def write_manifest(self, manifest):
        (self.root / 'tools' / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n',
                                                                 encoding='utf-8')

    def run(self, name='corr081', *extra, optimize=False):
        command = [PYTHON] + (['-O'] if optimize else []) + [
            str(self.root / 'tools' / 'package-upload.py'), '--name', name, *extra]
        return subprocess.run(command, cwd=self.root / 'tools', text=True, capture_output=True, timeout=120)

    @property
    def package(self):
        return self.root / 'publish' / 'corr081'


def assert_refused(case, result, *needles, rebuild=True):
    case.assertNotEqual(result.returncode, 0, 'the packager must exit non-zero\n' + result.stdout + result.stderr)
    for needle in needles:
        case.assertIn(needle, result.stderr, 'the refusal must name the cause\n' + result.stderr)
    if rebuild:
        case.assertIn('rebuild', result.stderr, 'the refusal must name the rebuild that fixes it\n' + result.stderr)


class ManifestProvenanceRefusalTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.cleanup)

    def test_manifest_without_outputs_is_refused(self):
        # Hermetic: a manifest without provenance must be refused. Never read the ambient checked-in file,
        # whose state depends on whether a build has already run in this checkout (the delivery dry-run
        # builds before the public tests, which regenerates tools/build-manifest.json with outputs).
        without = {key: value for key, value in self.fixture.manifest.items() if key != 'outputs'}
        self.fixture.write_manifest(without)
        result = self.fixture.run()
        assert_refused(self, result, 'no output provenance')
        self.assertFalse(self.fixture.package.exists(), 'a refused manifest must not create a package')

    def test_empty_outputs_is_refused(self):
        self.fixture.manifest['outputs'] = []
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'output provenance (outputs) is empty')

    def test_duplicate_output_records_are_refused(self):
        duplicated = dict(self.fixture.manifest['outputs'][0])
        self.fixture.manifest['outputs'][1] = duplicated
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'duplicate output provenance')

        self.fixture.manifest['outputs'].append(dict(self.fixture.manifest['outputs'][0]))
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'more output provenance records than generated files')

    def test_incomplete_output_coverage_is_refused(self):
        self.fixture.manifest['outputs'] = self.fixture.manifest['outputs'][:-1]
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'does not cover its manifest', 'missing ' + JS)

    def test_unrecorded_extra_output_is_refused(self):
        self.fixture.manifest['outputs'][-1] = {'path': 'js/stray.0123456789ab.js',
                                                'bytes': 1, 'sha256': '0' * 64}
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'does not cover its manifest', 'unrecorded ')

    def test_invalid_digest_record_is_refused(self):
        self.fixture.manifest['outputs'][0]['sha256'] = 'not-a-digest'
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'invalid sha256')

    def test_invalid_size_record_is_refused(self):
        self.fixture.manifest['outputs'][0]['bytes'] = -1
        self.fixture.write_manifest(self.fixture.manifest)
        assert_refused(self, self.fixture.run(), 'invalid size')


class SourceSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.cleanup)

    def test_digest_mismatch_is_refused(self):
        (self.fixture.root / 'publish' / CSS).write_bytes(b'body{color:#654321}\n')
        assert_refused(self, self.fixture.run('corr081', '--site-only'), 'changed before packaging', 'sha256')

    def test_size_mismatch_is_refused_before_reading(self):
        (self.fixture.root / 'publish' / JS).write_bytes(BODIES[JS] + b'// shifted\n')
        assert_refused(self, self.fixture.run('corr081', '--site-only'), 'size changed before packaging')

    def test_symlink_at_the_copy_boundary_is_refused(self):
        source = self.fixture.root / 'publish' / CSS
        alias = self.fixture.root / 'publish' / 'alias.css'
        alias.write_bytes(BODIES[CSS])
        source.unlink()
        os.symlink(alias, source)
        assert_refused(self, self.fixture.run('corr081', '--site-only'), 'symlinked package source', rebuild=False)

    def test_healthy_site_only_package_retargets_exactly_four_documents(self):
        result = self.fixture.run('corr081', '--site-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        package = self.fixture.package
        documents = ['index.html', 'desktop-day.html', 'taste/index.html', 'taste/scene.html']
        occurrences = 0
        for relative in documents:
            data = (package / relative).read_bytes()
            self.assertNotIn(ENTRY.encode(), data, 'the entry URL must be retargeted in ' + relative)
            occurrences += data.count(BASE.encode())
        self.assertEqual(occurrences, 8, 'exactly canonical + og:url in each of the four documents')
        self.assertTrue((package / '.htaccess').is_file())
        for relative in documents:
            body = (package / relative).read_bytes()
            self.assertEqual(gzip.decompress((package / (relative + '.gz')).read_bytes()), body)
            self.assertEqual(brotli.decompress((package / (relative + '.br')).read_bytes()), body)
        report = json.loads((self.fixture.root / 'tools' / 'upload-package-manifest.json').read_text())
        self.assertEqual(report['layout'], 'site-only')
        self.assertEqual(report['total_files'], len([p for p in package.rglob('*') if p.is_file()]))
        for record in report['files']:
            self.assertEqual(digest((package / record['path']).read_bytes()), record['sha256'])

    def test_healthy_showcase_package_preserves_presentation(self):
        result = self.fixture.run('corr081show')
        self.assertEqual(result.returncode, 0, result.stderr)
        package = self.fixture.root / 'publish' / 'corr081show'
        self.assertEqual((package / 'living-tree.html').read_bytes(), ENTRY_PAGE)
        desktop = (package / 'desktop-day.html').read_bytes()
        self.assertIn(b'data-hw-public-entry="living-tree.html"', desktop)
        self.assertIn(ENTRY.encode(), (package / 'taste/index.html').read_bytes(),
                      'showcase must not run the site-only retarget')
        self.assertEqual((package / 'index.html').read_bytes(), LANDING)
        self.assertEqual(gzip.decompress((package / 'index.html.gz').read_bytes()), LANDING)
        self.assertTrue((package / 'assets/previews/one.webp').is_file())
        self.assertTrue((package / 'mockups/one.html').is_file())


def load_snapshot_helpers(project_root):
    """Extract the shipped containment + snapshot helpers, exactly as shipped."""
    source = (FORK / 'tools' / 'package-upload.py').read_text(encoding='utf-8')
    start = source.index('def contained_source(')
    end = source.index('\n\n\ndef add_compressed(')
    namespace = {'Path': Path, 'SystemExit': SystemExit, 'ROOT': project_root,
                 'os': os, 'stat': stat, 'hashlib': hashlib, 'MAX_SOURCE_BYTES': 64 * 1024 * 1024,
                 'snapshot_bytes': 0}
    exec(source[start:end], namespace)  # noqa: S102 - deliberately exercising the shipped helper text
    return namespace


class SwapAfterSnapshotTests(unittest.TestCase):
    """The copy must carry the bytes that were verified, even when the path changes after the read."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix='hw-pkg-swap-')
        self.root = Path(self._tmp.name) / 'project'
        (self.root / 'publish').mkdir(parents=True)
        self.addCleanup(self._tmp.cleanup)
        self.helpers = load_snapshot_helpers(self.root)
        self.original = b'verified page bytes\n'
        self.swapped = b'post-validation replacement\n'
        self.source = self.root / 'publish' / 'page.html'
        self.source.write_bytes(self.original)
        self.record = {'bytes': len(self.original), 'sha256': digest(self.original)}

    def test_path_swap_after_the_read_cannot_reach_the_copy(self):
        read_verified = self.helpers['read_verified']
        write_verified = self.helpers['write_verified']
        real_read = os.read
        state = {'swapped': False}

        def swapping_read(descriptor, length):
            data = real_read(descriptor, length)
            if data and not state['swapped']:
                state['swapped'] = True
                replacement = self.source.with_name('replacement.tmp')
                replacement.write_bytes(self.swapped)
                os.replace(replacement, self.source)   # same path, new inode, after the snapshot
            return data

        with mock.patch.object(os, 'read', swapping_read):
            snapshot = read_verified(self.root / 'publish', self.source, self.record, 'page.html')
        self.assertEqual(snapshot, self.original, 'the snapshot holds exactly the verified bytes')
        self.assertEqual(self.source.read_bytes(), self.swapped, 'the controlled swap really happened')
        output = self.root / 'package'
        output.mkdir()
        write_verified(output, 'page.html', snapshot)
        self.assertEqual((output / 'page.html').read_bytes(), self.original,
                         'the copy carries the verified bytes, never the swapped path content')

    def test_a_later_read_refuses_the_same_generation_drift(self):
        read_verified = self.helpers['read_verified']
        self.assertEqual(read_verified(self.root / 'publish', self.source, self.record, 'page.html'), self.original)
        self.source.write_bytes(self.swapped)
        with self.assertRaises(SystemExit) as caught:
            read_verified(self.root / 'publish', self.source, self.record, 'page.html')
        self.assertIn('changed before packaging', str(caught.exception))


class OptimizedInterpreterTests(unittest.TestCase):
    """python -O strips bare asserts; the safety path must still refuse and still package."""

    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.cleanup)

    def test_the_shipped_packager_contains_no_bare_assert(self):
        source = (TOOLS / 'package-upload.py').read_text(encoding='utf-8')
        offenders = [line for line in source.splitlines() if line.lstrip().startswith('assert ')]
        self.assertEqual(offenders, [], 'safety checks must be explicit exceptions, not asserts')

    def test_digest_mismatch_is_refused_under_python_O(self):
        (self.fixture.root / 'publish' / CSS).write_bytes(b'body{color:#654321}\n')
        result = self.fixture.run('corr081', optimize=True)
        assert_refused(self, result, 'changed before packaging', 'sha256')

    def test_a_healthy_package_is_written_under_python_O(self):
        result = self.fixture.run('corr081', '--site-only', optimize=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        package = self.fixture.package
        self.assertTrue((package / 'index.html').is_file())
        self.assertEqual((package / 'desktop-day.html').read_bytes().count(b'data-hw-public-entry'), 0)
        files = sorted(p.relative_to(package).as_posix() for p in package.rglob('*') if p.is_file())
        expected = {'index.html', 'desktop-day.html', 'taste/index.html', 'taste/scene.html', CSS, JS, '.htaccess'}
        expected |= {name + suffix for name in ('index.html', 'desktop-day.html', 'taste/index.html',
                                                'taste/scene.html', CSS, JS) for suffix in ('.gz', '.br')}
        self.assertEqual(files, sorted(expected))


# The opt-in owned-build integration tests moved to tests/package-provenance-integration.py.
# They are intentionally NOT part of the *.test.py public roster: the roster rejects skipped runs,
# and the integration needs an owned rebuild plus the default uv cache with brotli. Run it with:
#   uv run --offline --no-project python tests/package-provenance-integration.py


if __name__ == '__main__':
    unittest.main()
