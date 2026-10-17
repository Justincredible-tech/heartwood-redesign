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
import re
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

FORK = Path(__file__).resolve().parents[1]


def load_helper(project_root):
    source = (FORK / 'tools' / 'package-upload.py').read_text(encoding='utf-8')
    start = source.index('def contained_source(')
    end = source.index('\n\n\ndef read_verified(')
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


def shipped_packager_text():
    return (FORK / 'tools' / 'package-upload.py').read_text(encoding='utf-8')


def authored_base_value():
    """The package root the packager derives from the authored canonical (tools/site_address.py)."""
    namespace = {'__file__': str(FORK / 'tools' / 'site_address.py'), 'Path': Path, 're': re, 'SystemExit': SystemExit}
    exec((FORK / 'tools' / 'site_address.py').read_text(encoding='utf-8'), namespace)  # noqa: S102 - the shipped derivation
    return namespace['authored_base']()


def retarget_branch():
    """The exact shipped site-only retarget branch, located by explicit markers so a shape change fails."""
    text = shipped_packager_text()
    start = text.index("    if args.site_only and packaged.endswith('.html'):")
    end = text.index('    files[packaged] = (body,', start)
    branch = text[start:end]
    if 'CANONICAL_ENTRY_URL.encode()' not in branch or 'continue' not in branch:
        raise AssertionError('The shipped site-only retarget branch changed shape')
    return text, branch


def run_retarget_branch(document, packaged, site_only):
    """Execute the shipped branch once for one packaged document; returns the made-bytes mapping.

    The branch text is exec'd verbatim inside a single-pass loop (its `continue` statements need an
    enclosing loop and the real caller's loop is the generated-file walk). Sidecar compression is
    stubbed to the same keys with the page bytes; the compression itself is proven by the packaging
    runs and tools/compress-site.py, not here.
    """
    _, branch = retarget_branch()
    made = {}

    def add_compressed(name, data):
        made[name + '.gz'] = data
        made[name + '.br'] = data

    class Source:
        def __init__(self, data):
            self.data = data

        def read_bytes(self):
            return self.data

    base = authored_base_value()
    namespace = {
        'args': SimpleNamespace(site_only=site_only),
        'packaged': packaged,
        'source': Source(document),
        'body': document,
        'made': made,
        'add_compressed': add_compressed,
        'account_snapshot': lambda size: None,
        'CANONICAL_ENTRY_URL': base + 'living-tree.html',
        'AUTHORED_BASE': base,
        'SystemExit': SystemExit,
    }
    wrapped = 'def run_once():\n    for _once in (1,):\n' + textwrap.indent(branch, '    ') + '        break\n'
    exec(wrapped, namespace)  # noqa: S102 - deliberately exercising the shipped branch text
    namespace['run_once']()
    return made


class SiteOnlyCanonicalRetargetTests(unittest.TestCase):
    """SEO-01: a site-only package retargets canonical/og:url to the authored package root, and only there."""

    def setUp(self):
        self.base = authored_base_value()
        self.entry = self.base + 'living-tree.html'

    def built_document(self):
        return (
            '<html><head>\n'
            f'<link rel="canonical" href="{self.entry}">\n'
            f'<meta property="og:url" content="{self.entry}">\n'
            f'<meta property="og:image" content="{self.base}assets/meta/share-living-tree.93562ea2526a.jpg">\n'
            f'<link rel="icon" href="{self.base}assets/meta/favicon.18b614f14a69.svg">\n'
            '</head><body>Heartwood</body></html>\n'
        ).encode('utf-8')

    def mobile_document(self):
        return (
            '<html><head>\n'
            f'<link rel="icon" href="{self.base}assets/meta/favicon.18b614f14a69.svg">\n'
            '</head><body>Phone</body></html>\n'
        ).encode('utf-8')

    def test_every_packaged_document_carrying_the_entry_is_retargeted_in_site_only_mode(self):
        for packaged in ('index.html', 'desktop-day.html', 'taste/index.html', 'taste/scene.html'):
            with self.subTest(packaged=packaged):
                document = self.built_document()
                made = run_retarget_branch(document, packaged, site_only=True)
                expected = document.replace(self.entry.encode(), self.base.encode())
                self.assertIn(packaged, made, 'A document carrying the authored entry URL must be retargeted')
                self.assertEqual(made[packaged], expected)
                self.assertNotIn(self.entry.encode(), made[packaged])
                self.assertIn((self.base + 'assets/meta/share-living-tree.93562ea2526a.jpg').encode(), made[packaged],
                              'Only the entry URL changes; other absolute asset URLs keep their bytes')
                self.assertEqual(sorted(name for name in made if name != packaged), [packaged + '.br', packaged + '.gz'],
                                 'A retargeted page is written with both compression sidecars')

    def test_documents_without_the_entry_are_left_byte_identical(self):
        made = run_retarget_branch(self.mobile_document(), 'mobile/day.html', site_only=True)
        self.assertEqual(made, {}, 'A document without the entry URL falls through to the unchanged copy path')
        made = run_retarget_branch(self.built_document(), 'index.html', site_only=True)
        self.assertIn('index.html', made, 'Positive control: the same call shape retargets when the entry is present')

    def test_the_retarget_is_limited_to_html_documents_and_site_only_mode(self):
        entry_in_css = ('/* ' + self.entry + ' */').encode('utf-8')
        self.assertEqual(run_retarget_branch(entry_in_css, 'css/heartwood-site.0123456789ab.css', site_only=True), {},
                         'Non-HTML packaged files keep their bytes even if the URL string appears')
        self.assertEqual(run_retarget_branch(self.built_document(), 'index.html', site_only=False), {},
                         'Showcase packaging must not run the site-only retarget')

    def test_the_entry_and_package_root_derive_from_the_authored_canonical(self):
        text, _ = retarget_branch()
        self.assertIn("FEATURED = 'living-tree.html'", text)
        self.assertIn('AUTHORED_BASE = authored_base()', text)
        self.assertIn('CANONICAL_ENTRY_URL = AUTHORED_BASE + FEATURED', text)
        authored = (FORK / 'source' / 'heartwood-site.html').read_text(encoding='utf-8')
        self.assertIn(f'<link rel="canonical" href="{self.entry}">', authored)
        self.assertIn(f'<meta property="og:url" content="{self.entry}">', authored)
        showcase = (FORK / 'showcase' / 'index.html').read_text(encoding='utf-8')
        self.assertIn(f'<link rel="canonical" href="{self.base}">', showcase,
                      'The site-only target equals the authored showcase landing canonical')

    def test_showcase_drop_in_marker_stays_separate_from_the_site_only_retarget(self):
        text, _ = retarget_branch()
        self.assertIn("if not args.site_only and packaged == 'desktop-day.html':", text)
        self.assertIn('data-hw-public-entry="living-tree.html"', text)
        self.assertIn("if args.site_only and packaged.endswith('.html'):", text)


if __name__ == '__main__':
    unittest.main()
