"""Compatibility CLI for the public Node compression job.

The encoder lives in compress-site.mjs. This file has no Brotli dependency,
starts nothing on import and never launches a shell.
"""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys


class BuildStopped(Exception):
    def __init__(self, signum):
        self.signum = signum


def retire_child(child):
    """Retire only the child handle this invocation started, within eight seconds."""
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=4)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=4)


def run_node(executable, entry):
    child = None
    previous = {}
    def stopped(signum, frame):
        raise BuildStopped(signum)
    try:
        signals = [signal.SIGINT, signal.SIGTERM]
        if hasattr(signal, "SIGHUP"):
            signals.append(signal.SIGHUP)
        for signum in signals:
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, stopped)
        # Popen quotes the argument vector for Windows; no shell or CRT execv.
        child = subprocess.Popen([executable, str(entry)])
        status = child.wait(timeout=300)
        return status if status >= 0 else 128 - status
    except subprocess.TimeoutExpired:
        retire_child(child)
        print("Node compression exceeded 300 seconds", file=sys.stderr)
        return 124
    except BuildStopped as error:
        retire_child(child)
        return 128 + error.signum
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main(args=None):
    args = list(sys.argv[1:] if args is None else args)
    if args in (["--help"], ["-h"]):
        print("Usage: uv run python tools/compress-site.py\n"
              "Compress recorded public outputs using the Node job (300-second limit).\n"
              "Node22 or newer is required; HW_BUILD_NODE may name its executable.")
        return 0
    if args:
        print("Unknown compression option: " + str(args[0]), file=sys.stderr)
        return 1
    candidate = os.environ.get("HW_BUILD_NODE", "node")
    executable = shutil.which(candidate)
    if executable is None:
        print("Node22 or newer was not found: " + candidate, file=sys.stderr)
        return 1
    entry = Path(__file__).resolve().with_name("compress-site.mjs")
    if not entry.is_file():
        print("Public compression entry is missing: " + str(entry), file=sys.stderr)
        return 1
    try:
        return run_node(executable, entry)
    except OSError as error:
        print("Could not run public compression: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
