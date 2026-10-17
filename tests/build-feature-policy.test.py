"""Feature metadata cannot turn a missing artifact into a successful delivery."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('build_features', Path(__file__).resolve().parents[1] / 'tools' / 'build_features.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class FeaturePolicyTests(unittest.TestCase):
    def test_all_sixteen_explicit_profiles(self):
        for bits in range(16):
            names = [name for index, name in enumerate(policy.FEATURE_NAMES) if bits & (1 << index)]
            features = policy.resolve_exclusions(names)
            self.assertEqual(policy.manifest_features({'features': features}, expected=names), features)

    def test_missing_contradictory_and_non_boolean_metadata_fail(self):
        for manifest in ({}, {'features': {}}, {'features': dict(policy.resolve_exclusions(), night=0)},
                         {'features': dict(policy.resolve_exclusions(), night=False)},
                         {'features': dict(policy.resolve_exclusions(), excluded=['night', 'night'])}):
            with self.assertRaises(ValueError):
                policy.manifest_features(manifest, expected=[])

    def test_disabled_metadata_cannot_bypass_default_delivery(self):
        with self.assertRaises(ValueError):
            policy.manifest_features({'features': policy.resolve_exclusions(['night'])}, expected=[])

    def test_malformed_profiles_fail(self):
        for value in ('', 'night,', ' night', 'night,night', ['phone', False], {}, False):
            with self.assertRaises(ValueError):
                policy.resolve_exclusions(value)

    def test_legacy_allowance_is_explicit_and_all_enabled(self):
        self.assertEqual(policy.manifest_features({}, allow_legacy=True), policy.resolve_exclusions())
        with self.assertRaises(ValueError):
            policy.manifest_features({}, allow_legacy=True, expected=['night'])


if __name__ == '__main__':
    unittest.main()
