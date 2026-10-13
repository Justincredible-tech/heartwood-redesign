"""Pure source contracts for the desktop variants; no browser or network is started."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


class TasteSourceTests(unittest.TestCase):
    def test_readable_source_variants_and_original_geometry(self):
        node = os.environ.get("NODE") or shutil.which("node")
        self.assertTrue(node, "Install the repository's Node toolchain first")
        result = subprocess.run(
            [node, str(ROOT / "tests/taste-source.test.mjs")],
            cwd=ROOT, capture_output=True, text=True, timeout=15, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # Node 22/24 choose TAP or the spec reporter for a directly run test file.
        # Require the complete summary in either formatter, including zero skips.
        for label, count in (("tests", 5), ("pass", 5), ("fail", 0),
                             ("cancelled", 0), ("skipped", 0)):
            self.assertRegex(result.stdout, re.compile(
                rf"^(?:#|ℹ) {label} {count}$", re.MULTILINE), result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
