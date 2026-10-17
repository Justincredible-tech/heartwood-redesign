"""Portable data checks for exact, complete Node source-test acceptance."""
import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest import mock


def load_wrapper():
    entry = Path(__file__).resolve().parents[1] / "tools/test-responsive-build.py"
    spec = importlib.util.spec_from_file_location("heartwood_responsive_wrapper", entry)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


WRAPPER = load_wrapper()


def complete(cases):
    return (f"# tests {cases}\n# pass {cases}\n# fail 0\n"
            "# cancelled 0\n# skipped 0\n# todo 0\n")


class ResponsiveWrapperAcceptance(unittest.TestCase):
    def test_wrapper_selects_the_count_for_each_actual_filename(self):
        results = [SimpleNamespace(returncode=0, stdout=complete(cases), stderr="") for cases in (4, 5)]
        with mock.patch.object(WRAPPER.shutil, "which", return_value="node"), \
                mock.patch.object(WRAPPER.subprocess, "run", side_effect=results) as run:
            WRAPPER.ResponsiveBuild("test_source_and_output_contracts").test_source_and_output_contracts()
        names = [Path(call.args[0][-1]).name for call in run.call_args_list]
        self.assertEqual(names, ["test-responsive-build.mjs", "test-experience-entry.mjs"])

    def test_actual_entry_file_requires_and_accepts_five_cases(self):
        WRAPPER.require_complete_run(complete(5), expected_cases=5)
        with self.assertRaises(AssertionError):
            WRAPPER.require_complete_run(complete(4), expected_cases=5)

    def test_responsive_file_retains_four_required_cases(self):
        WRAPPER.require_complete_run(complete(4), expected_cases=4)
        with self.assertRaises(AssertionError):
            WRAPPER.require_complete_run(complete(5), expected_cases=4)

    def test_empty_or_incomplete_runs_cannot_pass(self):
        for cases in (4, 5):
            for output in ("", complete(0), complete(cases).replace(f"# pass {cases}", "# pass 0")):
                with self.subTest(cases=cases, output=output):
                    with self.assertRaises(AssertionError):
                        WRAPPER.require_complete_run(output, expected_cases=cases)

    def test_skipped_failed_cancelled_or_todo_cases_cannot_pass(self):
        for cases in (4, 5):
            for status in ("skipped", "fail", "cancelled", "todo"):
                output = complete(cases).replace(f"# {status} 0", f"# {status} 1")
                with self.subTest(cases=cases, status=status):
                    with self.assertRaises(AssertionError):
                        WRAPPER.require_complete_run(output, expected_cases=cases)


if __name__ == "__main__":
    unittest.main()
