"""Focused render-grain.py tests (codex-046): pure fixtures only, no browser, no network, no source mutation.

Proves: day/night recipe derivation (night = the exact grainOf transform); declaration validation before any
mutation (malformed CSS, missing/extra density overrides, bad tile names -> refusal with the tree untouched);
--help and --validate-only run without Pillow or Playwright present; strict flags; the transactional apply
(writes staged + verified, CSS swapped atomically, provenance pinned, obsolete tiles deleted only after the new
references are published); rollback on a write failure restores the previous CSS and leaves old tiles in place;
idempotent re-run for identical bytes.
Stdlib only; run via:
    uv run --no-project python tests/review-qwen-render-grain.test.py

Updated 2026-10-14 (codex-048): validate-only now requires the matching provenance pin and per-tile
content hash + recorded byte count; the post-swap rollback fixture injects at the swap boundary.
Failure-safety and Night-producer fixtures live beside this file in review-qwen-render-grain-safety.test.py.
"""
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FORK = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('render_grain', FORK / 'tools' / 'render-grain.py')
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

DENSITIES = mod.DENSITIES
FINE = ('radial-gradient(circle at 30% 20%, rgb(255 255 255 / .07) 0 .5px, transparent 1.1px) 0 0 / 5px 7px, '
        'radial-gradient(circle at 80% 70%, rgb(0 0 0 / .06) 0 .5px, transparent 1.1px) 2px 3px / 7px 5px, '
        'repeating-linear-gradient(63deg, rgb(255 255 255 / .035) 0 1px, transparent 1px 6px), '
        'repeating-linear-gradient(-19deg, rgb(0 0 0 / .03) 0 1px, transparent 1px 9px)')
JOINED = ' '.join(FINE.split())


def decl(sel, name):
    return f'  {sel}: url(../assets/grain/{name});'


def media(sel, dppx, name):
    return f'@media (min-resolution: {dppx}dppx), (-webkit-min-device-pixel-ratio: {dppx}) {{ :root {{ {sel}: url(../assets/grain/{name}); }} }}'


def fake_name(base, density):
    return f'{base}-256@{density}x.{"a" * 12}.webp'


def fixture_css(sel='--grain-tile', base='grain-fine', overrides=6):
    lines = [':root {', f'  --grain-fine:', '    ' + FINE + ';', decl(sel, fake_name(base, '1'))]
    steps = ['1.125', '1.375', '1.625', '1.875', '2.25', '2.75']
    for i in range(overrides):
        lines.append(media(sel, steps[i], fake_name(base, DENSITIES[i + 1])))
    lines.append('}')
    return '\n'.join(lines) + '\n'


class RecipeTests(unittest.TestCase):
    def test_night_transform_is_exact(self):
        night = mod.night_recipe(fixture_css())
        self.assertNotIn(' .07)', night)
        self.assertIn('rgb(255 255 255 / 0.039)', night)       # 0.07 * 0.55 = 0.0385 -> rounds to 0.039
        self.assertIn('rgb(0 0 0 / 0.078)', night)             # 0.06 * 1.3
        self.assertIn('rgb(255 255 255 / 0.019)', night)       # 0.035 * 0.55
        self.assertEqual(hashlib.sha256(mod.day_recipe(fixture_css()).encode()).hexdigest()[:8],
                         hashlib.sha256(JOINED.encode()).hexdigest()[:8])
        self.assertEqual(night.count('radial-gradient'), 2)
        self.assertEqual(night.count('repeating-linear-gradient'), 2)

    def test_real_site_night_recipe_matches_the_shipped_pin(self):
        css = (FORK / 'source/css/heartwood-site.css').read_text(encoding='utf-8')
        self.assertEqual(hashlib.sha256(mod.night_recipe(css).encode('utf-8')).hexdigest(),
                         '83b6f3e1b85853fddab6e592729697bc5c7ef48d0f90d181248c44816c376dd9')


class ValidationTests(unittest.TestCase):
    def test_declarations_extract_base_and_six_overrides(self):
        names, has_base, steps = mod.declared_tiles(fixture_css(), 'day')
        self.assertTrue(has_base)
        self.assertEqual(steps, 6)
        self.assertEqual(len(names), 7)
        self.assertEqual(names[0], fake_name('grain-fine', '1'))

    def test_validate_refuses_malformed_without_touching_anything(self):
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            out = Path(tmp, 'out')
            cases = {
                'no recipe': fixture_css().replace('--grain-fine:', '--not-fine:'),
                'missing base': '\n'.join(l for l in fixture_css().splitlines() if not l.strip().startswith('--grain-tile:')) + '\n',
                'five overrides': fixture_css(overrides=5),
                'bad name': fixture_css().replace(fake_name('grain-fine', '1'), 'grain-fine-256@1x.NOTHASH.webp'),
            }
            for label, text in cases.items():
                css.write_text(text, encoding='utf-8')
                before = css.read_bytes()
                with self.assertRaises(SystemExit, msg=label):
                    mod.validate(text, out, 'day')
                self.assertEqual(css.read_bytes(), before, label)
                self.assertFalse(out.exists(), label)
            css.write_text(fixture_css(), encoding='utf-8')
            plan = mod.validate(css.read_text(), out, 'day')
            self.assertIsNone(plan['pinned'])
            self.assertIsNone(plan['pinMatches'])

    def test_pin_mismatch_reported_not_silently_fixed(self):
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(fixture_css(), encoding='utf-8')
            out = Path(tmp, 'out')
            out.mkdir()
            (out / 'grain-provenance.json').write_text(json.dumps({'recipe_sha256': 'f' * 64}), encoding='utf-8')
            plan = mod.validate(css.read_text(), out, 'day')
            self.assertFalse(plan['pinMatches'])


class TransactionTests(unittest.TestCase):
    def tiles(self, tag):
        return {d: f'webp-{tag}-{d}'.encode() for d in DENSITIES}

    def test_apply_publishes_then_deletes_obsolete(self):
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(fixture_css(), encoding='utf-8')
            out = Path(tmp, 'out')
            out.mkdir()
            old = [fake_name('grain-fine', d) for d in DENSITIES]
            for name in old:
                (out / name).write_bytes(b'old')
            result = mod.apply_transaction(out, css, css.read_text(), 'day', self.tiles('new'))
            new_names = result['names']
            self.assertEqual(sorted(result['removed']), sorted(old))
            for name in new_names:
                self.assertTrue((out / name).exists())
            for name in old:
                self.assertFalse((out / name).exists(), 'obsolete tiles deleted only after the swap')
            updated = css.read_text()
            for name in new_names:
                self.assertIn(name, updated)
            provenance = json.loads((out / 'grain-provenance.json').read_text())
            self.assertEqual(provenance['tiles']['1']['file'], new_names[0])
            self.assertEqual(provenance['recipe_sha256'],
                             hashlib.sha256(JOINED.encode('utf-8')).hexdigest())
            # idempotent re-run: same bytes -> same names, nothing removed, nothing rewritten away
            before_css = css.read_bytes()
            again = mod.apply_transaction(out, css, css.read_text(), 'day', self.tiles('new'))
            self.assertEqual(again['names'], new_names)
            self.assertEqual(again['removed'], [])
            self.assertEqual(css.read_bytes(), before_css)

    def test_failure_before_swap_leaves_tree_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(fixture_css(), encoding='utf-8')
            out = Path(tmp, 'out')
            out.mkdir()
            old = [fake_name('grain-fine', d) for d in DENSITIES]
            for name in old:
                (out / name).write_bytes(b'old')
            # Block the first new tile with a directory at its exact content-hashed path.
            first = self.tiles('new')[DENSITIES[0]]
            blocked = out / f'grain-fine-256@1x.{hashlib.sha256(first).hexdigest()[:12]}.webp'
            blocked.mkdir()
            before = css.read_bytes()
            with self.assertRaises(OSError):
                mod.apply_transaction(out, css, css.read_text(), 'day', self.tiles('new'))
            self.assertEqual(css.read_bytes(), before, 'CSS untouched on a staging failure')
            for name in old:
                self.assertTrue((out / name).exists(), 'old tiles stay until the new set is published')
            self.assertFalse((out / 'grain-provenance.json.tmp').exists())
            self.assertFalse(css.with_name(css.name + '.tmp').exists())

    def test_failure_after_swap_rolls_back_css(self):
        # Updated for codex-048: staged temps are uniquely owned now, so this fixture injects the failure at the
        # publish boundary (_swap) instead of blocking a fixed temp name; the intent is unchanged.
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(fixture_css(), encoding='utf-8')
            out = Path(tmp, 'out')
            out.mkdir()
            before = css.read_bytes()
            real_swap, calls = os.replace, []

            def swap(src, dst):
                calls.append(dst)
                if len(calls) == 2:                      # the provenance swap, after the stylesheet swap
                    raise OSError('injected provenance swap failure')
                return real_swap(src, dst)

            original = getattr(mod, '_swap', None)
            mod._swap = swap
            try:
                with self.assertRaises(OSError):
                    mod.apply_transaction(out, css, css.read_text(), 'day', self.tiles('new'))
            finally:
                if original is None:
                    del mod._swap
                else:
                    mod._swap = original
            self.assertEqual(css.read_bytes(), before, 'CSS restored after a post-swap failure')
            for d in DENSITIES:
                ghost = out / f'grain-fine-256@{d}x.{hashlib.sha256(self.tiles("new")[d]).hexdigest()[:12]}.webp'
                self.assertFalse(ghost.exists(), 'staged tiles removed on rollback')


class CliTests(unittest.TestCase):
    SCRIPT = str(FORK / 'tools' / 'render-grain.py')

    def run_cli(self, *args):
        return subprocess.run([sys.executable, self.SCRIPT, *args], capture_output=True, text=True, timeout=60)

    def test_help_is_inert_without_third_party_dependencies(self):
        result = self.run_cli('--help')
        self.assertEqual(result.returncode, 0)
        self.assertIn('grain', result.stdout.lower())
        try:
            import PIL  # noqa: F401
            has_pil = True
        except ImportError:
            has_pil = False
        if not has_pil:
            self.assertIn('render', result.stdout, '--help worked without Pillow/Playwright present')

    def test_validate_only_is_read_only_and_fails_closed(self):
        # Updated for codex-048: a missing provenance pin, or tiles whose bytes do not carry their
        # content-hashed name with the recorded byte count, can no longer pass.
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(fixture_css(), encoding='utf-8')
            out = Path(tmp, 'out')
            result = self.run_cli('--validate-only', '--css', str(css), '--out', str(out))
            self.assertEqual(result.returncode, 1, 'declared tiles absent on disk -> nonzero, no writes')
            self.assertFalse(out.exists())
            out.mkdir()
            for d in DENSITIES:
                (out / fake_name('grain-fine', d)).write_bytes(b'x')
            result = self.run_cli('--validate-only', '--css', str(css), '--out', str(out))
            self.assertEqual(result.returncode, 1, 'fake names with no pin and no byte evidence cannot pass: ' + result.stdout)
            tiles = {d: ('tile-' + d).encode() for d in DENSITIES}
            names = [f'grain-fine-256@{d}x.{hashlib.sha256(tiles[d]).hexdigest()[:12]}.webp' for d in DENSITIES]
            steps = ['1.125', '1.375', '1.625', '1.875', '2.25', '2.75']
            lines = [':root {', '  --grain-fine:', '    ' + FINE + ';', decl('--grain-tile', names[0])]
            for i, dppx in enumerate(steps):
                lines.append(media('--grain-tile', dppx, names[i + 1]))
            lines.append('}')
            css.write_text('\n'.join(lines) + '\n', encoding='utf-8')
            for i, d in enumerate(DENSITIES):
                (out / names[i]).write_bytes(tiles[d])
            provenance = {'recipe_sha256': hashlib.sha256(mod.day_recipe(css.read_text(encoding='utf-8')).encode('utf-8')).hexdigest(),
                          'tile_css_px': 256,
                          'tiles': {d: {'file': names[i], 'bytes': len(tiles[d])} for i, d in enumerate(DENSITIES)}}
            (out / 'grain-provenance.json').write_text(json.dumps(provenance), encoding='utf-8')
            result = self.run_cli('--validate-only', '--css', str(css), '--out', str(out))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['declaredAllPresentOnDisk'])
            self.assertTrue(report['pinMatches'])
            self.assertTrue(all(row['ok'] for row in report['tileIntegrity'].values()))

    def test_strict_flags(self):
        self.assertEqual(self.run_cli('--nope').returncode, 2)
        self.assertEqual(self.run_cli('--timeout-s', '10').returncode, 2)
        self.assertEqual(self.run_cli('--recipe', 'dusk').returncode, 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
