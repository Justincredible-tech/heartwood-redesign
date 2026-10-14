"""Focused containment tests for tools/package-upload.py (codex-022/024 corrections). No network, no package run.

The tool is a module-level script, so contained_source is exercised from the EXACT shipped source text
(marker extraction), with ROOT pointed at a temporary project. Real-file positives and outside-root cases
use the real filesystem; the symlink-guard BRANCHES are driven with a controlled Path.is_symlink double so
the mandatory cases run on Windows without symlink privilege (portable policy proof) — the real-symlink
behavior itself was verified privately on macOS earlier (receipts under .audit/output/qwen/review-fixes/),
as was the publish-root probe (codex-025: the lexical publish anchor and every generated body/sidecar are
admitted through the same helper before reading).
Stdlib only; run via uv:
    uv run --no-project python tests/review-qwen-package.test.py
"""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock

FORK = Path(__file__).resolve().parents[1]


def load_helper(project_root):
    source = (FORK / 'tools' / 'package-upload.py').read_text(encoding='utf-8')
    start = source.index('def contained_source(')
    end = source.index('\n\n\ndef add_compressed(')
    namespace = {'Path': Path, 'SystemExit': SystemExit, 'ROOT': project_root}
    exec(source[start:end], namespace)  # noqa: S102 - deliberately exercising the shipped helper text
    return namespace['contained_source']


class PackageContainmentTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix='hw-pkg-test-')
        self.tmp = Path(self._tmp.name)
        self.project = self.tmp / 'project'
        (self.project / 'showcase' / 'sub1').mkdir(parents=True)
        (self.project / 'showcase' / 'sub2').mkdir(parents=True)
        (self.project / 'showcase' / 'index.html').write_text('<html></html>\n', encoding='utf-8')
        (self.project / 'showcase' / 'sub2' / 'preview.webp').write_bytes(b'webp')
        self.contained = load_helper(self.project)

    def tearDown(self):
        self._tmp.cleanup()

    def _flagged_symlink(self, *paths):
        """Controlled filesystem double: the named paths report is_symlink() true without real symlinks."""
        flagged = {str(p) for p in paths}

        def fake_is_symlink(self_path):
            return str(self_path) in flagged

        return mock.patch.object(Path, 'is_symlink', fake_is_symlink)

    def test_genuine_nested_file_is_accepted(self):
        got = self.contained(self.project / 'showcase', self.project / 'showcase' / 'sub2' / 'preview.webp')
        self.assertEqual(got, self.project / 'showcase' / 'sub2' / 'preview.webp')

    def test_symlinked_root_is_refused(self):
        link = self.project / 'showcase-link'
        link.mkdir()
        (link / 'index.html').write_text('x', encoding='utf-8')
        with self._flagged_symlink(link):
            with self.assertRaises(SystemExit) as caught:
                self.contained(link, link / 'index.html')
        self.assertIn('symlinked package root', str(caught.exception))

    def test_ancestor_symlink_to_outside_is_refused(self):
        escape = self.project / 'showcase' / 'sub1' / 'escape'
        escape.mkdir()
        (escape / 'file.webp').write_bytes(b'x')
        with self._flagged_symlink(escape):
            with self.assertRaises(SystemExit) as caught:
                self.contained(self.project / 'showcase', escape / 'file.webp')
        self.assertIn('symlinked package ancestor', str(caught.exception))

    def test_ancestor_symlink_inside_project_is_still_refused(self):
        alias = self.project / 'showcase' / 'sub1' / 'alias'
        alias.mkdir()
        (alias / 'preview.webp').write_bytes(b'webp')
        with self._flagged_symlink(alias):
            with self.assertRaises(SystemExit) as caught:
                self.contained(self.project / 'showcase', alias / 'preview.webp')
        self.assertIn('symlinked package ancestor', str(caught.exception))

    def test_final_file_symlink_is_refused(self):
        link = self.project / 'showcase' / 'sub1' / 'link.webp'
        link.write_bytes(b'webp')
        with self._flagged_symlink(link):
            with self.assertRaises(SystemExit) as caught:
                self.contained(self.project / 'showcase', link)
        self.assertIn('symlinked package source', str(caught.exception))

    def test_file_outside_the_root_is_refused(self):
        outside = self.tmp / 'elsewhere'
        outside.mkdir()
        (outside / 'file.txt').write_text('x', encoding='utf-8')
        with self.assertRaises(SystemExit) as caught:
            self.contained(self.project / 'showcase', outside / 'file.txt')
        self.assertIn('is not under its root', str(caught.exception))

    def test_missing_file_is_refused(self):
        with self.assertRaises(SystemExit) as caught:
            self.contained(self.project / 'showcase', self.project / 'showcase' / 'absent.html')
        self.assertIn('escapes the project', str(caught.exception))

    def test_publish_root_symlink_is_refused(self):
        publish = self.project / 'publish'
        publish.mkdir()
        (publish / '.htaccess').write_text('# hosting\n', encoding='utf-8')
        with self._flagged_symlink(publish):
            with self.assertRaises(SystemExit) as caught:
                self.contained(publish, publish / '.htaccess')
        self.assertIn('symlinked package root', str(caught.exception))

    def test_generated_sidecar_ancestor_symlink_is_refused(self):
        assets = self.project / 'publish' / 'assets'
        assets.mkdir(parents=True)
        (assets / 'heartwood-site.0123456789ab.css').write_text('body{}', encoding='utf-8')
        (assets / 'heartwood-site.0123456789ab.css.gz').write_bytes(b'gzip-bytes')
        with self._flagged_symlink(assets):
            with self.assertRaises(SystemExit) as caught:
                self.contained(self.project / 'publish', assets / 'heartwood-site.0123456789ab.css.gz')
        self.assertIn('symlinked package ancestor', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
