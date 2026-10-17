"""Draw the fine half of the paper grain once, into a tile per screen density.

The grain recipe lives in source/css/heartwood-site.css as --grain-fine (flecks and fibres). Painting those
eight gradient layers live on every piece of paper was the slowest part of the first paint, so this script has
Chrome draw exactly that recipe into a transparent 256px tile at each common device-pixel ratio. Each tile is
Chrome's own rendering, stored as lossless WebP, so laying it over a colour gives the same result as painting the
layers over that colour. The flecks and fibres keep their size, spacing, angle, colour and strength; only where
the pattern starts on each piece shifts.

Two recipes exist. `--recipe day` draws the site's own --grain-fine and rewrites the --grain-tile declarations in
the stylesheet. `--recipe night` draws the derived night recipe — the same text with highlights at 0.55 and
shadows at 1.3 (the transform source/taste/taste-dark.mjs grainOf applies) — and only updates the tiles and the
provenance night record: the night --grain-tile-night declarations are generated from that record
(source/taste/taste-dark.mjs darkPalette via tools/build-taste.mjs), so a night render never touches any
authored stylesheet.

It writes the tiles to source/assets/grain/ with content hashes, and records the recipe hash and the seven
content-hashed tile names with their byte counts in grain-provenance.json so the delivery tests can tell when a
recipe changed but the tiles were not redrawn — and so --validate-only can verify the pin, every tile's content
hash and its byte count before anyone trusts the tree.
Needs Python Playwright with installed Chrome, and Pillow — but not for --help or --validate-only:

    python render-grain.py --validate-only                 # day
    python render-grain.py --validate-only --recipe night  # the generated night record
    python render-grain.py --recipe day                    # regenerates tiles + provenance (supervised)
    python render-grain.py --recipe night                  # the derived Night tiles + provenance record

The write is transactional: everything is validated before anything is touched; staged files are verified
before the swap; a failure rolls the staged work back and the tree keeps its previous state; obsolete tiles are
deleted only after every new reference is published and verified. Staged work is written under unique
'.render-grain-<token>.*' names this tool created itself (exclusive create), so foreign files are never
overwritten or removed; a stylesheet or provenance file that changed after it was read refuses the swap; an
existing tile at a content-hashed name with different bytes is refused, not clobbered; rollback failures are
reported, and an unrestorable stylesheet never withdraws the tiles its new references point at.
CLI regeneration is supervised by default: it runs the render in an owned child process (finite deadline,
token-scoped cleanup, owner-death watch) and retires the whole child on timeout, because an in-process wait
cannot interrupt a synchronous Pillow encode or a stalled browser close. The private `--internal-worker`
admission is what the supervisor spawns; programmatic use may still call `_render_tiles`/`apply_transaction`
in process (the fixture suites do), carrying the same raw caveat — only the supervised CLI bounds the whole
tool. `--validate-only`, help and bad flags never spawn anything.
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import signal
import stat
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSS = ROOT / 'source/css/heartwood-site.css'
DEFAULT_OUT = ROOT / 'source/assets/grain'
TILE = 256                                              # CSS px; every density below gives whole device pixels
DENSITIES = ('1', '1.25', '1.5', '1.75', '2', '2.5', '3')
DENSITY_STEPS = ('1.125', '1.375', '1.625', '1.875', '2.25', '2.75')   # media thresholds selecting DENSITIES[1:]
SELECTORS = {'day': '--grain-tile', 'night': '--grain-tile-night'}
EXTS = {'day': 'grain-fine', 'night': 'grain-fine-night'}
TILE_CEILING = 8 * 1024 * 1024                          # bounded read ceiling for one tile
TMP_PREFIX = '.render-grain-'                           # every staged temp is ours, uniquely, under this prefix


def tile_pattern(flavor):
    return rf'{EXTS[flavor]}-\d+@[\d.]+x\.[0-9a-f]{{12}}\.webp'


def day_recipe(css):
    match = re.search(r'--grain-fine:\s*(.*?);', css, re.S)
    if not match:
        raise SystemExit('No --grain-fine recipe in the stylesheet.')
    return ' '.join(match.group(1).split())


def night_recipe(css):
    fine = day_recipe(css)
    night = re.sub(r'rgb\(255 255 255 / ([\d.]+)\)', lambda m: f'rgb(255 255 255 / {float(m.group(1)) * 0.55:.3f})', fine)
    night = re.sub(r'rgb\(0 0 0 / ([\d.]+)\)', lambda m: f'rgb(0 0 0 / {float(m.group(1)) * 1.3:.3f})', night)
    return ' '.join(night.split())


def recipe_for(css, flavor):
    return day_recipe(css) if flavor == 'day' else night_recipe(css)


def declared_tiles(css, flavor):
    """The base declaration and the six density overrides, exactly as the stylesheet holds them."""
    sel = SELECTORS[flavor]
    steps = re.findall(
        rf'@media \(min-resolution: ([\d.]+)dppx\)[^{{]*\{{ :root \{{ {sel}: url\(\.\./assets/grain/([^)]+)\); \}} \}}', css)
    outside = re.sub(
        rf'@media \(min-resolution: [\d.]+dppx\)[^{{]*\{{ :root \{{ {sel}: url\([^)]*\); \}} \}}', '', css)
    base = re.search(rf'{sel}:\s*url\(\.\./assets/grain/([^)]+)\);', outside)
    names = ([base.group(1)] if base else []) + [name for _, name in steps]
    return names, bool(base), len(steps)


def step_densities(css, flavor):
    sel = SELECTORS[flavor]
    return re.findall(rf'@media \(min-resolution: ([\d.]+)dppx\)[^{{]*\{{ :root \{{ {sel}: url\([^)]*\); \}} \}}', css)


def rewritten_css(css, flavor, names):
    """Point one flavor's declarations at the given tiles (names[0] = base, names[1:] = density overrides)."""
    sel = SELECTORS[flavor]
    it = iter(names)
    css = re.sub(rf'({sel}:\s*url\(\.\./assets/grain/)[^)]+(\))', lambda m: m.group(1) + next(it) + m.group(2), css, count=1)
    css = re.sub(
        rf'(@media \(min-resolution: [\d.]+dppx\)[^{{]*\{{ :root \{{ {sel}: url\(\.\./assets/grain/)[^)]+(\); \}} \}})',
        lambda m: m.group(1) + next(it) + m.group(2), css)
    return css


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def stable_bytes(path, ceiling):
    """Stable bounded read of a regular file: (bytes, identity), or (None, None) when absent.

    Refuses symlinks, non-regular files, files over the ceiling and anything that changes while read."""
    path = Path(path)
    try:
        first = os.lstat(path)
    except FileNotFoundError:
        return None, None
    if stat.S_ISLNK(first.st_mode) or not stat.S_ISREG(first.st_mode) or first.st_size > ceiling:
        raise ValueError(f'Not a stable bounded regular file: {path}')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        if _identity(first) != _identity(before):
            raise ValueError(f'Changed while opening: {path}')
        data = bytearray()
        while len(data) <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        if len(data) != before.st_size or _identity(before) != _identity(os.fstat(fd)) or _identity(before) != _identity(os.lstat(path)):
            raise ValueError(f'Changed while reading: {path}')
        return bytes(data), _identity(before)
    finally:
        os.close(fd)


def _swap(src, dst):
    os.replace(src, dst)                                # atomic publish boundary (failure fixtures patch this)


def _restore(path, data):
    with open(path, 'wb') as handle:                    # rollback write boundary
        handle.write(data)


def _dispose(path):
    os.unlink(path)                                     # removal boundary


def _tmp_path(directory, token, tag):
    return Path(directory) / f'{TMP_PREFIX}{token}.{tag}.tmp'


def _write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o644)
    try:
        view = memoryview(data)
        offset = 0
        while offset < len(view):
            offset += os.write(fd, view[offset:offset + 65536])
    finally:
        os.close(fd)


def _stage_tile(out_dir, name, data, created):
    """Exclusive create for our payload; an existing file at the content-hashed name is either byte-identical
    (idempotent, left alone) or a conflict this tool refuses to overwrite. Only files we created are recorded."""
    target = out_dir / name
    if target.exists():
        try:
            existing, _ = stable_bytes(target, TILE_CEILING)
        except ValueError:
            raise OSError(f'Refusing to overwrite {name}: not a stable regular file')
        if existing == data:
            return
        raise OSError(f'Refusing to overwrite {name}: bytes on disk differ from the content-hashed payload')
    _write_new(target, data)
    created.append(target)


def _records(section, flavor):
    """The provenance section's tile record, exactly as the producer writes it: seven densities in order."""
    tiles = section.get('tiles') if isinstance(section, dict) else None
    if not isinstance(tiles, dict) or list(tiles.keys()) != list(DENSITIES):
        raise SystemExit(f'Provenance {flavor} tiles must be the seven densities in producer order. Nothing was written.')
    out = []
    for density in DENSITIES:
        record = tiles[density]
        if not isinstance(record, dict) or not isinstance(record.get('file'), str) or not isinstance(record.get('bytes'), int) or record['bytes'] <= 0:
            raise SystemExit(f'Provenance {flavor} record {density} is malformed. Nothing was written.')
        if not re.fullmatch(tile_pattern(flavor), record['file']) or f'@{density}x.' not in record['file']:
            raise SystemExit(f'Provenance {flavor} record {density} does not name its producer tile. Nothing was written.')
        out.append(record)
    return out


def validate(css_text, out_dir, flavor):
    """Everything that must hold before any mutation. Returns a plan; raises SystemExit on any problem."""
    recipe = recipe_for(css_text, flavor)
    sha = hashlib.sha256(recipe.encode('utf-8')).hexdigest()
    names = []
    if flavor == 'day':
        names, has_base, step_count = declared_tiles(css_text, flavor)
        if not has_base or step_count != len(DENSITIES) - 1:
            raise SystemExit(f'{SELECTORS[flavor]} declarations incomplete: base={has_base}, overrides={step_count} '
                             f'(expected 1 + {len(DENSITIES) - 1}). Nothing was written.')
        steps = step_densities(css_text, flavor)
        if tuple(steps) != DENSITY_STEPS:
            raise SystemExit(f'--grain-tile density steps {steps} do not match the producer order {list(DENSITY_STEPS)}. Nothing was written.')
        for name in names:
            if not re.fullmatch(tile_pattern(flavor), name):
                raise SystemExit(f'Unexpected tile name in {SELECTORS[flavor]}: {name}. Nothing was written.')
        if f'@{DENSITIES[0]}x.' not in names[0]:
            raise SystemExit(f'Base {SELECTORS[flavor]} is not the {DENSITIES[0]}x producer tile. Nothing was written.')
        for i, density in enumerate(DENSITIES[1:]):
            if f'@{density}x.' not in names[i + 1]:
                raise SystemExit(f'Override {i + 1} is not the {density}x tile for {DENSITY_STEPS[i]}dppx. Nothing was written.')
    provenance_path = Path(out_dir) / 'grain-provenance.json'
    raw, _ = stable_bytes(provenance_path, 1024 * 1024)
    provenance = json.loads(raw.decode('utf-8')) if raw is not None else None
    section = None
    if provenance is not None:
        section = provenance if flavor == 'day' else (provenance.get('night') or None)
        if section is not None and not isinstance(section, dict):
            raise SystemExit(f'Malformed provenance {flavor} section. Nothing was written.')
    records, record_issues = None, []
    if section is not None:
        try:
            records = _records(section, flavor)
        except SystemExit as issue:
            record_issues.append(str(issue))
    declared = list(names)
    if flavor == 'night' and records is not None:
        declared = [record['file'] for record in records]
    pinned = section.get('recipe_sha256') if isinstance(section, dict) else None
    return {'flavor': flavor, 'recipe': recipe, 'recipe_sha256': sha, 'names': names, 'declared': declared,
            'pinned': pinned, 'pinMatches': None if pinned is None else pinned == sha,
            'records': records, 'recordIssues': record_issues, 'sectionPresent': section is not None,
            'provenance_sha256': None if raw is None else hashlib.sha256(raw).hexdigest()}


def validate_only_report(css_text, out_dir, flavor):
    """The read-only verification: matching pin, producer-shaped record, every tile's content hash and its
    recorded byte count. Returns {'ok', 'report'}; nothing is ever written."""
    plan = validate(css_text, out_dir, flavor)
    issues = list(plan['recordIssues'])
    ok = plan['pinMatches'] is True and plan['records'] is not None and not issues
    declared = [] if plan['records'] is None else [record['file'] for record in plan['records']]
    if flavor == 'day' and plan['records'] is not None and sorted(plan['names']) != sorted(declared):
        ok = False
        issues.append('declared --grain-tile names do not match the provenance record')
    integrity, tiles_on_disk = {}, []
    out_dir = Path(out_dir)
    if out_dir.exists():
        tiles_on_disk = sorted(p.name for p in out_dir.glob(f'{EXTS[flavor]}-*.webp'))
    for record in (plan['records'] or []):
        name = record['file']
        disk_issues = []
        data = None
        try:
            data, _ = stable_bytes(out_dir / name, TILE_CEILING)
        except ValueError as problem:
            disk_issues.append(str(problem))
        if data is None and not disk_issues:
            disk_issues.append('missing on disk')
        if data is not None:
            if hashlib.sha256(data).hexdigest()[:12] not in name:
                disk_issues.append('content hash does not match the name')
            if len(data) != record['bytes']:
                disk_issues.append(f"byte count {len(data)} does not match the record's {record['bytes']}")
        integrity[name] = {'ok': not disk_issues, 'issues': disk_issues,
                           'bytesRecorded': record['bytes'], 'bytesOnDisk': None if data is None else len(data)}
        if disk_issues:
            ok = False
    report = {'flavor': plan['flavor'], 'recipe_sha256': plan['recipe_sha256'],
              'declaredTiles': declared, 'tilesOnDisk': tiles_on_disk,
              'declaredAllPresentOnDisk': all(name in tiles_on_disk for name in declared),
              'pinnedRecipeSha256': plan['pinned'], 'pinMatches': plan['pinMatches'],
              'tileIntegrity': integrity, 'issues': issues}
    return {'ok': bool(ok), 'report': report}


def _render_tiles(recipe, overall_s, step_s):
    """Chrome draws the recipe at each density; returns {density: webp_bytes}. Imports happen here on purpose.

    The wait_for bounds the awaited steps only: a synchronous Pillow encode or a stalled browser close cannot
    be interrupted in process. The CLI's default supervised regeneration bounds the whole tool by running
    this in an owned child the supervisor can retire at its deadline; programmatic in-process callers (the
    fixture suites) keep this raw caveat."""
    import asyncio
    import io
    from PIL import Image
    from playwright.async_api import async_playwright

    async def render():
        tiles = {}
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', headless=True)
            try:
                for density in DENSITIES:
                    async def one_step():
                        context = await browser.new_context(viewport={'width': TILE, 'height': TILE},
                                                            device_scale_factor=float(density))
                        try:
                            page = await context.new_page()
                            await page.set_content(
                                '<!doctype html><html style="background:transparent"><body style="margin:0;background:transparent">'
                                f'<div id="tile" style="width:{TILE}px;height:{TILE}px;background:{recipe}"></div></body></html>')
                            png = await page.locator('#tile').screenshot(omit_background=True)
                        finally:
                            await context.close()
                        image = Image.open(io.BytesIO(png)).convert('RGBA')
                        side = round(TILE * float(density))
                        if image.size != (side, side):
                            raise SystemExit(f'Tile at {density}x came out {image.size}, expected {side}px.')
                        webp = io.BytesIO()
                        image.save(webp, 'WEBP', lossless=True, quality=100, method=6, exact=True)
                        if Image.open(io.BytesIO(webp.getvalue())).convert('RGBA').tobytes() != image.tobytes():
                            raise SystemExit(f'WebP at {density}x is not lossless.')
                        return webp.getvalue()
                    tiles[density] = await asyncio.wait_for(one_step(), timeout=step_s)
            finally:
                await browser.close()
        return tiles

    return asyncio.run(asyncio.wait_for(render(), timeout=overall_s))


def apply_transaction(out_dir, css_path, css_text, flavor, tiles, token=None, plan=None):
    """Stage everything, verify it all, then swap; restore on failure; delete obsolete tiles only afterwards.

    flavor='night' publishes the tiles and the provenance night record only — the night declarations are
    generated from that record, so no stylesheet is involved. Admission: the stylesheet bytes and the
    provenance bytes must still be exactly what the plan was built from, or the swap is refused."""
    out_dir, css_path = Path(out_dir), Path(css_path)
    token = token or secrets.token_hex(8)
    plan = plan or validate(css_text, out_dir, flavor)
    if flavor == 'night' and plan['sectionPresent'] and plan['records'] is None:
        raise SystemExit('Refusing a night render over a malformed night provenance record: ' + '; '.join(plan['recordIssues']))
    css_bytes = css_text.encode('utf-8')
    css_now, _ = stable_bytes(css_path, 4 * 1024 * 1024)
    if css_now != css_bytes:
        raise SystemExit('Stylesheet changed since it was read; nothing was written.')
    provenance_path = out_dir / 'grain-provenance.json'
    prov_before, _ = stable_bytes(provenance_path, 1024 * 1024)
    prov_sha = None if prov_before is None else hashlib.sha256(prov_before).hexdigest()
    if plan['provenance_sha256'] != prov_sha:
        raise SystemExit('Provenance changed since it was read; nothing was written.')
    names, payload = [], {}
    for density in DENSITIES:
        data = tiles[density]
        name = f'{EXTS[flavor]}-{TILE}@{density}x.{hashlib.sha256(data).hexdigest()[:12]}.webp'
        names.append(name)
        payload[name] = data
    out_dir.mkdir(parents=True, exist_ok=True)
    created, tmps, css_swapped, css_restored = [], [], False, None
    try:
        for name in names:
            _stage_tile(out_dir, name, payload[name], created)
        if flavor == 'day':
            css_tmp = _tmp_path(css_path.parent, token, 'stylesheet')
            _write_new(css_tmp, rewritten_css(css_text, flavor, names).encode('utf-8'))
            tmps.append(css_tmp)
            for name in names:
                staged, _ = stable_bytes(out_dir / name, TILE_CEILING)
                if staged != payload[name]:
                    raise SystemExit(f'Staged tile failed verification: {name}')
            check = css_tmp.read_text(encoding='utf-8')
            verified, has_base, step_count = declared_tiles(check, flavor)
            if not has_base or step_count != len(DENSITIES) - 1 or sorted(verified) != sorted(names):
                raise SystemExit('Staged stylesheet failed verification.')
            css_re, _ = stable_bytes(css_path, 4 * 1024 * 1024)
            if css_re != css_bytes:
                raise SystemExit('Stylesheet changed during staging; the swap was refused.')
            _swap(css_tmp, css_path)
            css_swapped = True
        provenance = json.loads(prov_before.decode('utf-8')) if prov_before is not None else {}
        section = {'recipe_sha256': plan['recipe_sha256'],
                   'tile_css_px': TILE,
                   'tiles': {density: {'file': names[i], 'bytes': len(payload[names[i]])} for i, density in enumerate(DENSITIES)},
                   'renderer': 'Chrome via Playwright, transparent background, lossless WebP verified by decode'}
        if flavor == 'night':
            section['transform'] = 'whites x0.55, blacks x1.3 (source/taste/taste-dark.mjs grainOf)'
            provenance['night'] = section
        else:
            provenance.update(section)
        prov_tmp = _tmp_path(out_dir, token, 'provenance')
        _write_new(prov_tmp, (json.dumps(provenance, indent=2) + '\n').encode('utf-8'))
        tmps.append(prov_tmp)
        prov_re, _ = stable_bytes(provenance_path, 1024 * 1024)
        prov_re_sha = None if prov_re is None else hashlib.sha256(prov_re).hexdigest()
        if prov_re_sha != prov_sha:
            raise SystemExit('Provenance changed during staging; the swap was refused.')
        _swap(prov_tmp, provenance_path)
    except BaseException as error:
        notes = []
        if css_swapped:
            try:
                _restore(css_path, css_bytes)
                css_restored = True
            except OSError as restore_error:
                css_restored = False
                notes.append(f'stylesheet rollback FAILED ({restore_error}); the {len(created)} new tile(s) stay on disk '
                             'because the live stylesheet still references them')
        if not (css_swapped and css_restored is False):
            for path in created:
                if not path.exists():
                    continue
                try:
                    _dispose(path)
                except OSError as cleanup_error:
                    notes.append(f'staged tile could not be removed ({path.name}): {cleanup_error}')
        for tmp in tmps:
            if not tmp.exists():
                continue
            try:
                _dispose(tmp)
            except OSError as cleanup_error:
                notes.append(f'staged temp could not be removed ({tmp.name}): {cleanup_error}')
        if notes:
            message = f'{error}; rollback notes: ' + '; '.join(notes)
            print('render-grain: ' + message, file=sys.stderr)
            raise type(error)(message) from error
        raise
    # Every new reference is published and verified; only now drop the tiles nothing references any more.
    removed = []
    for name in plan['declared']:
        if name in set(names):
            continue
        target = out_dir / name
        if target.exists():
            target.unlink()
            removed.append(name)
    return {'names': names, 'removed': removed}


# ------------------------------------------------------------------ owned renderer custody (optional)
_photo_module = None


def _photo_runtime():
    """The portable sibling guardian/worker runtime, loaded lazily (its launcher handle and retire() are
    reused for owned-child custody; nothing else from it is needed here)."""
    global _photo_module
    if _photo_module is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location('render_grain_photo_runtime',
                                                      Path(__file__).resolve().with_name('photo-import-runtime.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _photo_module = module
    return _photo_module


def _launcher_alive(owner_pid):
    if owner_pid is None or owner_pid <= 1:
        return False
    live, release, _ = _photo_runtime().launcher_handle(owner_pid)
    try:
        return live()
    finally:
        release()


def _clean_owned(dirs, token):
    """Best-effort removal of only this token's staged files (and its marker), bounded and symlink-safe."""
    removed = []
    for directory in dirs:
        directory = Path(directory)
        if not directory.is_dir():
            continue
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            continue
        for entry in entries[:4096]:
            if not entry.name.startswith(TMP_PREFIX + token + '.'):
                continue
            try:
                info = os.lstat(entry)
                if stat.S_ISREG(info.st_mode):
                    _dispose(entry)
                    removed.append(entry.name)
            except OSError:
                continue
    return removed


def _stop(signum, frame, code):
    raise SystemExit(code)


def install_stop_guard():
    """SIGINT/SIGTERM/SIGHUP/SIGBREAK unwind as an explicit exit code (and run the transaction rollback)
    instead of a hard kill. Returns the previous handlers for restore_stop_guard()."""
    previous = {}
    for name, code in (('SIGINT', 130), ('SIGTERM', 143), ('SIGHUP', 129), ('SIGBREAK', 130)):
        if not hasattr(signal, name):
            continue
        sig = getattr(signal, name)
        try:
            previous[sig] = signal.signal(sig, lambda signum, frame, c=code: _stop(signum, frame, c))
        except ValueError:
            pass                                        # not the main thread: nothing to install
    return previous


def restore_stop_guard(previous):
    for sig, handler in (previous or {}).items():
        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):
            pass


def supervised_run(child_argv, timeout_s, dirs, token=None):
    """Run one owned child under a finite deadline. Always reaps the child, then removes the ownership marker
    and any token-scoped staged files. Returns {'code', 'timedOut', 'cleaned'}; raises only when the
    supervision machinery itself cannot run."""
    token = token or secrets.token_hex(8)
    dirs = [Path(d) for d in dirs]
    marker = dirs[0] / f'{TMP_PREFIX}{token}.owner'
    marker.parent.mkdir(parents=True, exist_ok=True)
    _write_new(marker, json.dumps({'token': token, 'dirs': [str(d) for d in dirs], 'supervisor': os.getpid()}).encode('utf-8'))
    child = None
    timed_out = False
    try:
        child = subprocess.Popen(child_argv, start_new_session=(os.name == 'posix'))
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if child.poll() is not None:
                break
            if not _launcher_alive(os.getppid()):
                timed_out = False
                break
            time.sleep(0.05)
        else:
            timed_out = True
        if child.poll() is None:
            _photo_runtime().retire(child)
        child.wait(timeout=5)
        return {'code': child.returncode, 'timedOut': timed_out, 'cleaned': _clean_owned(dirs, token)}
    finally:
        if child is not None and child.poll() is None:
            _photo_runtime().retire(child)
        if marker.exists():
            try:
                _dispose(marker)
            except OSError:
                pass


def install_owner_watch(owner_pid, token, dirs, poll_s=0.1, on_owner_gone=None):
    """Daemon watch: if the launcher retires, clean this token's files and exit 143 (or call on_owner_gone for
    tests/embedding). Nothing else is touched. Returns the thread."""
    def watch():
        while True:
            if not _launcher_alive(owner_pid):
                _clean_owned(dirs, token)
                if on_owner_gone is not None:
                    on_owner_gone()
                    return
                os._exit(143)                           # own process only
            time.sleep(poll_s)
    thread = threading.Thread(target=watch, daemon=True)
    thread.start()
    return thread


def supervised_main(args):
    token = secrets.token_hex(8)
    dirs = [Path(args.css).resolve().parent, Path(args.out).resolve()]
    child_argv = [sys.executable, str(Path(__file__).resolve()),
                  '--recipe', args.recipe, '--css', str(args.css), '--out', str(args.out),
                  '--timeout-s', str(args.timeout_s), '--step-timeout-s', str(args.step_timeout_s),
                  '--internal-worker', '--owned-token', token, '--owner-pid', str(os.getpid())]
    previous = install_stop_guard()
    install_owner_watch(os.getppid(), token, dirs)
    try:
        result = supervised_run(child_argv, args.timeout_s + 8.0, dirs, token=token)
    finally:
        restore_stop_guard(previous)
    code = result['code']
    if isinstance(code, int) and code >= 0:
        return code                      # 0 = the child finished successfully; positive = its own failure code
    return 124 if result['timedOut'] else 1   # signals/unexpected states keep the previous classification


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--recipe', choices=('day', 'night'), default='day', help='which fine recipe to draw (default: day)')
    parser.add_argument('--validate-only', action='store_true',
                        help='check the stylesheet, provenance pin, tile hashes and byte counts; no browser, network or writes')
    parser.add_argument('--css', type=Path, default=DEFAULT_CSS, help='stylesheet holding the recipe and declarations')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT, help='tile output directory')
    parser.add_argument('--timeout-s', type=int, default=90, help='overall deadline in seconds (60..90)')
    parser.add_argument('--step-timeout-s', type=int, default=60, help='per-tile deadline in seconds (60..90)')
    parser.add_argument('--supervised', action='store_true',
                        help='(default) run the render in an owned child process with a finite deadline and token-scoped cleanup; kept for compatibility')
    parser.add_argument('--internal-worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--owned-token', help=argparse.SUPPRESS)
    parser.add_argument('--owner-pid', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.owned_token is not None and (len(args.owned_token) != 16 or any(c not in '0123456789abcdef' for c in args.owned_token)):
        parser.error('--owned-token must be 16 lowercase hex characters')
    if args.owner_pid is not None and args.owner_pid <= 0:
        parser.error('--owner-pid must be a positive process id')
    if not (60 <= args.timeout_s <= 90) or not (60 <= args.step_timeout_s <= 90):
        parser.error('Deadlines must be60..90seconds')
    if args.validate_only:
        css_raw, _ = stable_bytes(args.css, 4 * 1024 * 1024)
        if css_raw is None:
            raise SystemExit(f'No stylesheet at {args.css}')
        result = validate_only_report(css_raw.decode('utf-8'), args.out, args.recipe)
        print(json.dumps(result['report'], indent=2))
        return 0 if result['ok'] else 1
    if not args.internal_worker:
        return supervised_main(args)          # the public regeneration path: an owned, finitely bounded child
    css_raw, _ = stable_bytes(args.css, 4 * 1024 * 1024)
    if css_raw is None:
        raise SystemExit(f'No stylesheet at {args.css}')
    css_text = css_raw.decode('utf-8')
    plan = validate(css_text, args.out, args.recipe)
    previous = install_stop_guard()
    if args.owned_token and args.owner_pid:
        install_owner_watch(args.owner_pid, args.owned_token, [args.css.resolve().parent, args.out.resolve()])
    try:
        tiles = _render_tiles(plan['recipe'], args.timeout_s, min(args.step_timeout_s, args.timeout_s))
        result = apply_transaction(args.out, args.css, css_text, args.recipe, tiles, token=args.owned_token, plan=plan)
    finally:
        restore_stop_guard(previous)
    print(json.dumps({'flavor': args.recipe, 'tiles': result['names'], 'removed': result['removed']}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
