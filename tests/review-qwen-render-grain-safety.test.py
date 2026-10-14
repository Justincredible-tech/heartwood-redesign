"""Failure-safety and Night-producer fixtures for render-grain.py (codex-048 item 2), tests first.

Written against the sealed pre-048 source ed4765b7... These prove:
- the Night producer path is real: night validation reads the provenance record (the generated
  declarations' actual producer), not imaginary --grain-tile-night declarations in authored CSS; a
  night apply rewrites tiles + provenance only and never touches any stylesheet;
- validate-only verifies the pin, every declared tile's content hash and byte count, provenance
  density order/count, and fails closed on anything missing;
- foreign temp files are never clobbered (staged temps are uniquely owned); an existing tile at a
  content-hashed name with different bytes is refused, not overwritten; a stylesheet or provenance
  changed after it was read is refused before the swap; rollback failures are reported, and an
  unrestorable stylesheet never withdraws the tiles its new references point at;
- owned-child custody: finite deadline retirement, owner-death retirement, SIGTERM conversion to a
  clean exit, token-scoped cleanup that never touches foreign files.

Stdlib only; no browser, no network, no source mutation; run via:
    uv run --no-project python tests/review-qwen-render-grain-safety.test.py
POSIX-native custody cases (owner death, SIGTERM) live in
tests/optional/review-qwen-render-grain-safety-posix.test.py (codex-058 split); this required suite is
skip-free.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

FORK = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('render_grain', FORK / 'tools' / 'render-grain.py')
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

DENSITIES = mod.DENSITIES
STEPS = ('1.125', '1.375', '1.625', '1.875', '2.25', '2.75')
FINE = ('radial-gradient(circle at 30% 20%, rgb(255 255 255 / .07) 0 .5px, transparent 1.1px) 0 0 / 5px 7px, '
        'radial-gradient(circle at 80% 70%, rgb(0 0 0 / .06) 0 .5px, transparent 1.1px) 2px 3px / 7px 5px, '
        'repeating-linear-gradient(63deg, rgb(255 255 255 / .035) 0 1px, transparent 1px 6px), '
        'repeating-linear-gradient(-19deg, rgb(0 0 0 / .03) 0 1px, transparent 1px 9px)')
SCRIPT = str(FORK / 'tools' / 'render-grain.py')


def media(sel, dppx, name):
    return f'@media (min-resolution: {dppx}dppx), (-webkit-min-device-pixel-ratio: {dppx}) {{ :root {{ {sel}: url(../assets/grain/{name}); }} }}'


def canonical_name(flavor, density, data):
    ext = mod.EXTS[flavor]
    return f'{ext}-{mod.TILE}@{density}x.{hashlib.sha256(data).hexdigest()[:12]}.webp'


def day_css(names, steps=STEPS):
    lines = [':root {', '  --grain-fine:', '    ' + FINE + ';', f'  --grain-tile: url(../assets/grain/{names[0]});']
    for i, dppx in enumerate(steps):
        lines.append(media('--grain-tile', dppx, names[i + 1]))
    lines.append('}')
    return '\n'.join(lines) + '\n'


def fixture_tiles(flavor, tag):
    return {d: f'webp-{flavor}-{tag}-{d}'.encode() for d in DENSITIES}


def section_for(flavor, css_text, tiles, tag):
    names = [canonical_name(flavor, d, tiles[d]) for d in DENSITIES]
    recipe = mod.recipe_for(css_text, flavor)
    section = {'recipe_sha256': hashlib.sha256(recipe.encode('utf-8')).hexdigest(), 'tile_css_px': mod.TILE,
               'tiles': {d: {'file': names[i], 'bytes': len(tiles[d])} for i, d in enumerate(DENSITIES)}}
    if flavor == 'night':
        section['transform'] = 'whites x0.55, blacks x1.3 (source/taste/taste-dark.mjs grainOf)'
    return section


def write_tiles(out, flavor, tiles):
    for d in DENSITIES:
        (out / canonical_name(flavor, d, tiles[d])).write_bytes(tiles[d])


def run_cli(*args):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, timeout=120)


class ConstantsTests(unittest.TestCase):
    def test_producer_constants_are_exposed(self):
        self.assertEqual(mod.DENSITY_STEPS, STEPS)
        self.assertEqual(mod.TMP_PREFIX, '.render-grain-')
        self.assertGreaterEqual(mod.TILE_CEILING, 1024 * 1024)


class NightProducerTests(unittest.TestCase):
    def night_tree(self, tmp):
        css = Path(tmp, 'fixture.css')
        css.write_text(day_css([canonical_name('day', d, fixture_tiles('day', 'day')[d]) for d in DENSITIES]), encoding='utf-8')
        out = Path(tmp, 'out')
        out.mkdir()
        day = fixture_tiles('day', 'day')
        write_tiles(out, 'day', day)
        provenance = section_for('day', css.read_text(encoding='utf-8'), day, 'day')
        old_night = fixture_tiles('night', 'old')
        write_tiles(out, 'night', old_night)
        provenance['night'] = section_for('night', css.read_text(encoding='utf-8'), old_night, 'old')
        (out / 'grain-provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')
        return css, out, provenance

    def test_validate_only_night_reads_provenance_not_imaginary_css_declarations(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, _ = self.night_tree(tmp)
            for flavor in ('night', 'day'):
                result = run_cli('--validate-only', '--recipe', flavor, '--css', str(css), '--out', str(out))
                self.assertEqual(result.returncode, 0, flavor + ': ' + result.stdout + result.stderr)
                report = json.loads(result.stdout)
                self.assertTrue(report['pinMatches'], flavor)
                self.assertTrue(report['declaredAllPresentOnDisk'], flavor)
                self.assertEqual(len(report['declaredTiles']), 7, flavor)

    def test_night_apply_writes_tiles_and_provenance_only_never_any_css(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, provenance = self.night_tree(tmp)
            css_before = css.read_bytes()
            day_section_before = {key: provenance[key] for key in ('recipe_sha256', 'tile_css_px', 'tiles')}   # the day record is the provenance top level
            tiles = fixture_tiles('night', 'new')
            result = mod.apply_transaction(out, css, css.read_text(encoding='utf-8'), 'night', tiles)
            self.assertEqual(css.read_bytes(), css_before, 'a night render must not touch any stylesheet')
            new_names = [canonical_name('night', d, tiles[d]) for d in DENSITIES]
            self.assertEqual(result['names'], new_names)
            self.assertEqual(len(result['removed']), 7, 'the seven superseded night tiles are dropped after the swap')
            for i, d in enumerate(DENSITIES):
                self.assertTrue((out / new_names[i]).read_bytes() == tiles[d])
            updated = json.loads((out / 'grain-provenance.json').read_text(encoding='utf-8'))
            for key, value in day_section_before.items():
                self.assertEqual(updated.get(key), value, 'the day record is untouched by a night render')
            self.assertEqual(updated['night']['tiles'][DENSITIES[0]]['file'], new_names[0])
            self.assertEqual(updated['night']['recipe_sha256'],
                             hashlib.sha256(mod.night_recipe(css.read_text(encoding='utf-8')).encode('utf-8')).hexdigest())
            self.assertIn('transform', updated['night'])

    def test_real_tree_validate_only_runs_for_day_and_night(self):
        result = run_cli('--validate-only', '--recipe', 'night')
        self.assertEqual(result.returncode, 0, 'the documented night validation command must run on the real tree: ' + result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report['pinMatches'])
        self.assertEqual(len(report['declaredTiles']), 7)
        day = run_cli('--validate-only', '--recipe', 'day')
        self.assertEqual(day.returncode, 0, day.stdout + day.stderr)


class ValidateOnlyStrictnessTests(unittest.TestCase):
    def consistent_tree(self, tmp, write_provenance=True):
        css = Path(tmp, 'fixture.css')
        css.write_text(day_css([canonical_name('day', d, fixture_tiles('day', 'v')[d]) for d in DENSITIES]), encoding='utf-8')
        out = Path(tmp, 'out')
        out.mkdir()
        tiles = fixture_tiles('day', 'v')
        write_tiles(out, 'day', tiles)
        if write_provenance:
            (out / 'grain-provenance.json').write_text(
                json.dumps(section_for('day', css.read_text(encoding='utf-8'), tiles, 'v'), indent=2), encoding='utf-8')
        return css, out

    def test_validate_only_requires_a_matching_provenance_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out = self.consistent_tree(tmp, write_provenance=False)
            result = run_cli('--validate-only', '--css', str(css), '--out', str(out))
            self.assertEqual(result.returncode, 1, 'a missing provenance pin cannot be a pass: ' + result.stdout)

    def test_validate_only_verifies_every_declared_tile_hash_and_byte_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out = self.consistent_tree(tmp)
            names = json.loads((out / 'grain-provenance.json').read_text())['tiles']
            tampered = out / names['2']['file']
            data = bytearray(tampered.read_bytes())
            data[0] ^= 0xFF
            tampered.write_bytes(bytes(data))
            result = run_cli('--validate-only', '--css', str(css), '--out', str(out))
            self.assertEqual(result.returncode, 1, 'tampered bytes must fail even though the name is present: ' + result.stdout)

    def test_validate_only_refuses_wrong_density_order_in_the_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out = self.consistent_tree(tmp)
            provenance = json.loads((out / 'grain-provenance.json').read_text())
            tiles = provenance['tiles']
            provenance['tiles'] = {d: tiles[d] for d in ('1', '1.5', '1.25', '1.75', '2', '2.5', '3')}
            (out / 'grain-provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')
            result = run_cli('--validate-only', '--css', str(css), '--out', str(out))
            self.assertEqual(result.returncode, 1, 'density order/count is part of the producer record: ' + result.stdout)

    def test_stylesheet_density_steps_must_match_the_producer_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            tiles = fixture_tiles('day', 's')
            names = [canonical_name('day', d, tiles[d]) for d in DENSITIES]
            swapped = day_css(names, steps=('1.375', '1.125', '1.625', '1.875', '2.25', '2.75'))
            css = Path(tmp, 'fixture.css')
            css.write_text(swapped, encoding='utf-8')
            with self.assertRaises(SystemExit):
                mod.validate(swapped, Path(tmp, 'out'), 'day')


class ForeignAndAdmissionTests(unittest.TestCase):
    def day_fixture(self, tmp):
        tiles = fixture_tiles('day', 'f')
        names = [canonical_name('day', d, tiles[d]) for d in DENSITIES]
        css = Path(tmp, 'fixture.css')
        css.write_text(day_css(names), encoding='utf-8')
        out = Path(tmp, 'out')
        out.mkdir()
        return css, out, tiles

    def test_foreign_fixed_name_temp_files_are_never_clobbered(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, tiles = self.day_fixture(tmp)
            foreign_css_tmp = css.with_name(css.name + '.tmp')
            foreign_css_tmp.write_bytes(b'foreign css temp')
            foreign_prov_tmp = out / 'grain-provenance.json.tmp'
            foreign_prov_tmp.write_bytes(b'foreign provenance temp')
            mod.apply_transaction(out, css, css.read_text(encoding='utf-8'), 'day', tiles)
            self.assertEqual(foreign_css_tmp.read_bytes(), b'foreign css temp', 'a foreign css temp is not ours to remove')
            self.assertEqual(foreign_prov_tmp.read_bytes(), b'foreign provenance temp', 'a foreign provenance temp is not ours to remove')
            self.assertEqual([p.name for p in sorted(css.parent.iterdir()) if p.name.startswith(getattr(mod, 'TMP_PREFIX', '.render-grain-'))], [])
            self.assertEqual([p.name for p in sorted(out.iterdir()) if p.name.startswith(getattr(mod, 'TMP_PREFIX', '.render-grain-'))], [])

    def test_existing_content_hash_tile_with_wrong_bytes_is_refused_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, tiles = self.day_fixture(tmp)
            name = canonical_name('day', DENSITIES[0], tiles[DENSITIES[0]])
            junk = out / name
            junk.write_bytes(b'junk at a content-hashed name')
            css_before = css.read_bytes()
            with self.assertRaises((OSError, SystemExit)):
                mod.apply_transaction(out, css, css.read_text(encoding='utf-8'), 'day', tiles)
            self.assertEqual(junk.read_bytes(), b'junk at a content-hashed name', 'refused, not overwritten')
            self.assertEqual(css.read_bytes(), css_before)
            self.assertFalse((out / 'grain-provenance.json').exists())

    def test_stylesheet_changed_after_it_was_read_is_refused_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, tiles = self.day_fixture(tmp)
            stale_text = css.read_text(encoding='utf-8')
            concurrent = stale_text.replace('  --grain-fine:', '  /* concurrent edit */\n  --grain-fine:')
            css.write_text(concurrent, encoding='utf-8')
            with self.assertRaises((OSError, SystemExit, ValueError)):
                mod.apply_transaction(out, css, stale_text, 'day', tiles)
            self.assertEqual(css.read_text(encoding='utf-8'), concurrent, 'the concurrent edit is preserved')
            self.assertEqual([p.name for p in out.iterdir()], [], 'nothing was staged')

    def test_provenance_changed_mid_run_is_refused_before_the_swap(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, tiles = self.day_fixture(tmp)
            provenance_path = out / 'grain-provenance.json'
            provenance_path.write_text(json.dumps({'recipe_sha256': 'f' * 64, 'tile_css_px': mod.TILE,
                                                   'tiles': {d: {'file': canonical_name('day', d, b'old-' + d.encode()), 'bytes': 9} for d in DENSITIES}}), encoding='utf-8')
            concurrent = provenance_path.read_bytes().replace(b'f' * 64, b'e' * 64)
            real_swap = os.replace
            calls = []

            def swap_injecting(src, dst):
                calls.append(dst)
                if len(calls) == 1:                      # after the stylesheet swap, a concurrent writer edits the provenance
                    provenance_path.write_bytes(concurrent)
                return real_swap(src, dst)

            original = mod._swap if hasattr(mod, '_swap') else None
            mod._swap = swap_injecting
            try:
                with self.assertRaises((OSError, SystemExit, ValueError)):
                    mod.apply_transaction(out, css, css.read_text(encoding='utf-8'), 'day', tiles)
            finally:
                if original is not None:
                    mod._swap = original
                else:
                    del mod._swap
            self.assertEqual(provenance_path.read_bytes(), concurrent, 'the concurrent provenance write is preserved')
            self.assertFalse((out / canonical_name('day', DENSITIES[0], tiles[DENSITIES[0]])).exists(),
                             'staged tiles are withdrawn when the swap is refused')


class RollbackDisciplineTests(unittest.TestCase):
    def day_fixture(self, tmp):
        tiles = fixture_tiles('day', 'r')
        names = [canonical_name('day', d, tiles[d]) for d in DENSITIES]
        css = Path(tmp, 'fixture.css')
        css.write_text(day_css(names), encoding='utf-8')
        out = Path(tmp, 'out')
        out.mkdir()
        return css, out, tiles

    def patch(self, name, replacement):
        original = getattr(mod, name, None)
        setattr(mod, name, replacement)
        return (name, original)

    def unpatch(self, records):
        for name, original in records:
            if original is None:
                delattr(mod, name)
            else:
                setattr(mod, name, original)

    def failing_second_swap(self):
        real = os.replace
        calls = []

        def swap(src, dst):
            calls.append(dst)
            if len(calls) == 2:
                raise OSError('injected provenance swap failure')
            return real(src, dst)
        return swap

    def test_unrestorable_stylesheet_keeps_the_new_tiles_and_reports_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, tiles = self.day_fixture(tmp)
            patches = [self.patch('_swap', self.failing_second_swap()),
                       self.patch('_restore', lambda *a, **k: (_ for _ in ()).throw(OSError('restore denied')))]
            stderr = io.StringIO()
            try:
                with contextlib.redirect_stderr(stderr):
                    with self.assertRaises(BaseException) as caught:
                        mod.apply_transaction(out, css, css.read_text(encoding='utf-8'), 'day', tiles)
            finally:
                self.unpatch(patches)
            self.assertIn('rollback', (str(caught.exception) + stderr.getvalue()).lower(),
                          'an unrestorable stylesheet must be reported')
            for d in DENSITIES:
                self.assertTrue((out / canonical_name('day', d, tiles[d])).exists(),
                                'tiles the live stylesheet references are never withdrawn when the stylesheet cannot be restored')

    def test_rollback_cleanup_failures_are_reported_not_swallowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            css, out, tiles = self.day_fixture(tmp)
            patches = [self.patch('_swap', self.failing_second_swap()),
                       self.patch('_dispose', lambda *a, **k: (_ for _ in ()).throw(OSError('locked')))]
            stderr = io.StringIO()
            try:
                with contextlib.redirect_stderr(stderr):
                    with self.assertRaises(BaseException) as caught:
                        mod.apply_transaction(out, css, css.read_text(encoding='utf-8'), 'day', tiles)
            finally:
                self.unpatch(patches)
            self.assertIn('locked', str(caught.exception) + stderr.getvalue(),
                          'a cleanup failure must be surfaced, not swallowed')
            self.assertEqual(css.read_text(encoding='utf-8'), day_css([canonical_name('day', d, tiles[d]) for d in DENSITIES]),
                             'the stylesheet was restored by the rollback')


class CustodyTests(unittest.TestCase):
    PY = sys.executable

    def sleeper(self, seconds):
        return [self.PY, '-c', f'import time; time.sleep({seconds})']

    def test_custody_deadline_retires_a_stuck_child_and_cleans_owned_files(self):
        run = getattr(mod, 'supervised_run', None)
        self.assertIsNotNone(run, 'render-grain.py must expose supervised_run for owned renderer custody')
        with tempfile.TemporaryDirectory() as tmp:
            dirs = [Path(tmp)]
            token = 'tok' + hashlib.sha256(b'deadline').hexdigest()[:8]
            owned = dirs[0] / (mod.TMP_PREFIX + token + '.stale.tmp')
            owned.write_bytes(b'ours')
            foreign = dirs[0] / 'unrelated.tmp'
            foreign.write_bytes(b'theirs')
            started = time.monotonic()
            result = run(self.sleeper(60), 1.0, dirs, token=token)
            elapsed = time.monotonic() - started
            self.assertTrue(result['timedOut'])
            self.assertNotEqual(result['code'], 0)
            self.assertLess(elapsed, 8.0, 'the deadline is finite')
            self.assertFalse(owned.exists(), 'owned token files are cleaned')
            self.assertEqual(foreign.read_bytes(), b'theirs', 'foreign files are never touched')
            self.assertEqual(list(dirs[0].glob(mod.TMP_PREFIX + token + '.*')), [])

    def test_custody_child_failure_returns_nonzero_without_leftovers(self):
        run = getattr(mod, 'supervised_run', None)
        self.assertIsNotNone(run, 'render-grain.py must expose supervised_run for owned renderer custody')
        with tempfile.TemporaryDirectory() as tmp:
            dirs = [Path(tmp)]
            token = 'tok' + hashlib.sha256(b'failure').hexdigest()[:8]
            result = run([self.PY, '-c', 'import sys; sys.exit(3)'], 30.0, dirs, token=token)
            self.assertEqual(result['code'], 3)
            self.assertFalse(result['timedOut'])
            self.assertEqual(list(dirs[0].glob(mod.TMP_PREFIX + token + '.*')), [])

    def test_default_regeneration_goes_through_the_supervised_child(self):
        run = getattr(mod, 'supervised_run', None)
        self.assertIsNotNone(run, 'render-grain.py must expose supervised_run for owned renderer custody')
        captured = {}
        original = mod.supervised_run

        def fake_supervised(argv, timeout_s, dirs, token=None):
            captured['argv'] = argv
            return {'code': 1, 'timedOut': False, 'cleaned': []}

        mod.supervised_run = fake_supervised
        try:
            with tempfile.TemporaryDirectory() as tmp:
                css = Path(tmp, 'fixture.css')
                css.write_text(':root { --not-fine: 1; }\n', encoding='utf-8')
                out = Path(tmp, 'out')
                code = mod.main(['--css', str(css), '--out', str(out)])
        finally:
            mod.supervised_run = original
        self.assertEqual(code, 1)
        argv = captured.get('argv')
        self.assertIsNotNone(argv, 'default regeneration must run in an owned supervised child')
        self.assertEqual(argv[0], sys.executable)
        self.assertIn('--internal-worker', argv)

    def test_validate_only_never_supervises_and_still_fails_closed(self):
        called = {'count': 0}
        original = mod.supervised_run

        def fake_supervised(*args, **kwargs):
            called['count'] += 1
            return {'code': 0, 'timedOut': False, 'cleaned': []}

        mod.supervised_run = fake_supervised
        try:
            with tempfile.TemporaryDirectory() as tmp:
                css = Path(tmp, 'fixture.css')
                css.write_text(day_css([canonical_name('day', d, fixture_tiles('day', 'z')[d]) for d in DENSITIES]), encoding='utf-8')
                out = Path(tmp, 'out')
                code = mod.main(['--validate-only', '--css', str(css), '--out', str(out)])
        finally:
            mod.supervised_run = original
        self.assertEqual(called['count'], 0, 'validate-only is inert and never spawns a child')
        self.assertEqual(code, 1, 'a missing provenance pin still fails closed')

    def test_cli_default_regeneration_fails_closed_without_a_renderer_and_leaves_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(':root { --not-fine: 1; }\n', encoding='utf-8')
            out = Path(tmp, 'out')
            result = run_cli('--css', str(css), '--out', str(out))
            self.assertNotIn(result.returncode, (0, 2), 'the default supervised regeneration must run and fail closed: ' + result.stderr)
            self.assertFalse(out.exists(), 'nothing is staged when validation fails inside the child')
            self.assertEqual([p.name for p in Path(tmp).iterdir() if p.name.startswith(mod.TMP_PREFIX)], [])

    def test_cli_supervised_fails_closed_without_a_renderer_and_leaves_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            css = Path(tmp, 'fixture.css')
            css.write_text(':root { --not-fine: 1; }\n', encoding='utf-8')
            out = Path(tmp, 'out')
            result = run_cli('--supervised', '--css', str(css), '--out', str(out))
            self.assertNotIn(result.returncode, (0, 2), 'the supervised path must run and fail closed: ' + result.stderr)
            self.assertFalse(out.exists(), 'nothing is staged when validation fails inside the child')
            self.assertEqual([p.name for p in Path(tmp).iterdir() if p.name.startswith(mod.TMP_PREFIX)], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
