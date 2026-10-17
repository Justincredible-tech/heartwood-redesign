"""POSIX-native custody cases for render-grain.py, run explicitly (codex-058 split).

Owner-death parent liveness and SIGTERM unwinding are real POSIX semantics; these cases keep their platform
guard so they are never silently skipped inside a required run. Invoke explicitly where POSIX applies:

    uv run --no-project python tests/optional/review-qwen-render-grain-safety-posix.test.py

The required portable safety suite (tests/review-qwen-render-grain-safety.test.py) stays skip-free, and the
standard build and all required portable tests never need these cases.
"""
import hashlib
import importlib.util
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

FORK = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('render_grain', FORK / 'tools' / 'render-grain.py')
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)
SCRIPT = str(FORK / 'tools' / 'render-grain.py')


class PosixCustodyTests(unittest.TestCase):
    PY = sys.executable

    @unittest.skipUnless(os.name == 'posix', 'owner-death custody uses POSIX parent liveness')
    def test_owner_death_retires_the_watched_child_and_cleans(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = Path(tmp)
            token = 'tok' + hashlib.sha256(b'ownerdeath').hexdigest()[:8]
            owned = dirs / (mod.TMP_PREFIX + token + '.stale.tmp')
            owned.write_bytes(b'ours')
            foreign = dirs / 'keep.tmp'
            foreign.write_bytes(b'theirs')
            pidfile = dirs / 'pid.txt'
            bootstrap = (
                'import importlib.util, os, sys, time\n'
                f'spec = importlib.util.spec_from_file_location("render_grain", {SCRIPT!r})\n'
                'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n'
                'assert hasattr(mod, "install_owner_watch"), "install_owner_watch missing"\n'
                'child = mod.install_owner_watch(os.getppid(), sys.argv[1], [sys.argv[2]])\n'
                'open(sys.argv[3], "w").write(str(os.getpid()))\n'
                'time.sleep(30)\n')
            # The watched child must be our direct child: spawn the helper which spawns it, then the helper dies.
            spawn = subprocess.run([self.PY, '-c',
                                    'import subprocess, sys\n'
                                    f'p = subprocess.Popen([sys.executable, "-c", {bootstrap!r}, sys.argv[1], sys.argv[2], sys.argv[3]], stderr=subprocess.DEVNULL)\n'
                                    'open(sys.argv[3], "w").write(str(p.pid))\n'
                                    'import time; time.sleep(0.6)\n',
                                    token, str(dirs), str(pidfile)], capture_output=True, text=True, timeout=30)
            self.assertEqual(spawn.returncode, 0, spawn.stderr)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if not owned.exists():
                    break
                time.sleep(0.1)
            self.assertFalse(owned.exists(), 'owner death cleans the token-scoped files')
            self.assertEqual(foreign.read_bytes(), b'theirs')
            pid = int(pidfile.read_text())
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            else:
                self.fail('the watched child did not retire after its owner died')

    @unittest.skipUnless(os.name == 'posix', 'stop-signal conversion uses POSIX signals')
    def test_sigterm_is_converted_to_a_clean_exit(self):
        bootstrap = (
            'import importlib.util, os, signal, sys, time\n'
            f'spec = importlib.util.spec_from_file_location("render_grain", {SCRIPT!r})\n'
            'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n'
            'assert hasattr(mod, "install_stop_guard"), "install_stop_guard missing"\n'
            'mod.install_stop_guard()\n'
            'open(sys.argv[1], "w").write("ready")\n'
            'time.sleep(30)\n')
        with tempfile.TemporaryDirectory() as tmp:
            ready = Path(tmp, 'ready.txt')
            proc = subprocess.Popen([self.PY, '-c', bootstrap, str(ready)], stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 10
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(ready.exists(), 'guard bootstrap did not become ready')
                proc.send_signal(signal.SIGTERM)
                self.assertEqual(proc.wait(timeout=8), 143, 'SIGTERM must unwind as an explicit 143, not a hard kill')
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5)
                if proc.stderr:
                    proc.stderr.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
