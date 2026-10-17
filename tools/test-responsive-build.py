"""Bounded source/build regression checks using the repository's required Node runtime."""
import shutil
import subprocess
import unittest
import re
from pathlib import Path

def require_complete_run(output, expected_cases=4):
    expected = {'tests': expected_cases, 'pass': expected_cases, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', output, re.MULTILINE)}
    if counts != expected:
        raise AssertionError('Incomplete Node acceptance run: ' + repr(counts))

class ResponsiveBuild(unittest.TestCase):
    def test_source_and_output_contracts(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'The required Node runtime is missing')
        for filename, expected_cases in (('test-responsive-build.mjs', 4), ('test-experience-entry.mjs', 5)):
            with self.subTest(filename=filename):
                result = subprocess.run([node, '--test-reporter=tap', str(Path(__file__).with_name(filename))], capture_output=True, text=True, timeout=20, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                require_complete_run(result.stdout, expected_cases=expected_cases)

    def test_empty_or_skipped_success_is_rejected(self):
        complete = '# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
        require_complete_run(complete)
        for output in ('', complete.replace('# tests 4', '# tests 0'), complete.replace('# pass 4', '# pass 0').replace('# skipped 0', '# skipped 4')):
            with self.assertRaises(AssertionError):
                require_complete_run(output)

if __name__ == '__main__':
    unittest.main()
