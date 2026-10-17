"""File-backed photo guardian/worker. Stdlib only; no multiprocessing bootstrap."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import signal
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid

MAX_FRAME = 4 * 1024 * 1024
STARTUP = 4.0
SHUTDOWN = 8.0
MARKER = '.hw-photo-owner'


def encode_frame(value):
    body = json.dumps(value, allow_nan=False, separators=(',', ':')).encode()
    if not body or len(body) > MAX_FRAME:
        raise ValueError('Photo message exceeds4MiB')
    return struct.pack('>I', len(body)) + body


def decode_frame(data):
    if len(data) < 4:
        raise EOFError('Incomplete photo frame header')
    size = struct.unpack('>I', data[:4])[0]
    if not 0 < size <= MAX_FRAME:
        raise ValueError('Invalid photo frame size')
    if len(data) != size + 4:
        raise EOFError('Incomplete/trailing photo frame payload')
    value = json.loads(data[4:], parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite photo message')))
    if not isinstance(value, dict):
        raise ValueError('Photo protocol requires an object')
    return value


def read_regular(path, ceiling):
    first = os.lstat(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        before = os.fstat(fd)
        key = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if not stat.S_ISREG(before.st_mode) or before.st_size > ceiling or key(first) != key(before):
            raise ValueError('Not a stable bounded regular photo input')
        data = bytearray()
        while len(data) <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        if len(data) != before.st_size or key(before) != key(os.fstat(fd)) or key(before) != key(os.lstat(path)):
            raise ValueError('Photo input changed while reading')
        return bytes(data)
    finally:
        os.close(fd)


def launcher_handle(pid, expected=None):
    if os.name == 'posix':
        return lambda: os.getppid() == pid, lambda: None, 0
    if os.name != 'nt':
        raise RuntimeError('Unsupported photo lifecycle platform')
    import ctypes
    from ctypes import wintypes
    import _winapi
    handle = _winapi.OpenProcess(0x00101000, False, pid)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    creation, exited, kernel_time, user_time = (wintypes.FILETIME() for _ in range(4))
    get_times = kernel.GetProcessTimes
    get_times.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    get_times.restype = wintypes.BOOL
    if not get_times(handle, *(ctypes.byref(x) for x in (creation, exited, kernel_time, user_time))):
        _winapi.CloseHandle(handle)
        raise ctypes.WinError(ctypes.get_last_error())
    birth = creation.dwLowDateTime | creation.dwHighDateTime << 32
    if expected is not None and birth != expected:
        _winapi.CloseHandle(handle)
        raise RuntimeError('Photo launcher incarnation changed')
    def live():
        value = _winapi.WaitForSingleObject(handle, 0)
        if value not in (0, 258):
            raise RuntimeError('Unexpected owned Windows launcher wait result')
        return value == 258
    return live, lambda: _winapi.CloseHandle(handle), birth


class Link:
    """Complete-frame IO is isolated from the deadline/owner watcher."""
    def __init__(self, incoming, outgoing, control, owned=True):
        self.incoming, self.outgoing, self.control = incoming, outgoing, control
        self.owned, self.closed = owned, threading.Event()
        self.received, self.pending = queue.Queue(16), queue.Queue(16)
        self.reader = threading.Thread(target=self._reader, daemon=True)
        self.writer = threading.Thread(target=self._writer, daemon=True)
        with control.resource_lock:
            control.check()
            control.links.append(self)
            self.reader.start()
            self.writer.start()

    def _read(self, size):
        data = bytearray()
        while len(data) < size:
            chunk = os.read(self.incoming.fileno(), min(65536, size - len(data)))
            if not chunk:
                raise EOFError('Photo owner/peer pipe closed before complete frame')
            data.extend(chunk)
        return bytes(data)

    def _reader(self):
        try:
            while True:
                header = self._read(4)
                size = struct.unpack('>I', header)[0]
                if not 0 < size <= MAX_FRAME:
                    raise ValueError('Photo frame size outside ceiling')
                value = decode_frame(header + self._read(size))
                self.received.put(value, timeout=.1)
        except BaseException as error:
            try:
                self.received.put(error, timeout=.1)
            except queue.Full:
                self.control.stop(125, 'Photo incoming queue exceeded16 frames')

    def _writer(self):
        while True:
            pending = self.pending.get()
            if pending is None:
                return
            body, completed, errors = pending
            try:
                offset = 0
                while offset < len(body):
                    count = os.write(self.outgoing.fileno(), body[offset:offset + 65536])
                    if count <= 0:
                        raise BrokenPipeError('Photo peer write made no progress')
                    offset += count
            except BaseException as error:
                errors.append(error)
            finally:
                completed.set()

    def send(self, value, timeout=2):
        if self.closed.is_set():
            raise EOFError('Photo link closed')
        completed, errors = threading.Event(), []
        self.pending.put((encode_frame(value), completed, errors), timeout=.1)
        if not completed.wait(timeout):
            raise TimeoutError('stuck at complete photo frame write')
        if errors:
            raise errors[0]

    def recv(self, timeout=.025):
        try:
            value = self.received.get(timeout=timeout)
        except queue.Empty:
            return None
        if isinstance(value, BaseException):
            raise value
        return value

    def close(self):
        self.closed.set()
        while True:
            try:
                body, completed, errors = self.pending.get_nowait()
                errors.append(EOFError('Photo link closing'))
                completed.set()
            except queue.Empty:
                break
        self.pending.put_nowait(None)
        if self.owned:
            # Direct child was reaped first; its raw FileIO pipes now reach EOF.
            self.incoming.close()
            self.outgoing.close()
            self.reader.join(timeout=.25)
            self.writer.join(timeout=.25)
            if self.reader.is_alive() or self.writer.is_alive():
                raise RuntimeError('Owned photo IO thread did not retire')


def retire(child, graceful=False):
    if child.poll() is not None:
        return
    if graceful:
        if child.stdin:
            child.stdin.close()
        try:
            child.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            pass
    child.terminate()
    try:
        child.wait(timeout=.5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=1)


def remove_bundle(record):
    if not record:
        return
    path = Path(record['path'])
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != (record['dev'], record['ino']):
        raise RuntimeError('Preserved changed/foreign photo bundle')
    entries = []
    with os.scandir(path) as listing:
        for entry in listing:
            if len(entries) >= 64:
                raise RuntimeError('Photo bundle census exceeds64 entries')
            entries.append(entry)
    known = {row['name']: row for row in record['files']}
    marker = record.get('marker')
    if marker:
        known[MARKER] = marker
    for entry in entries:
        current = entry.stat(follow_symlinks=False)
        owned = known.get(entry.name)
        if not owned or not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (owned['dev'], owned['ino']):
            raise RuntimeError('Preserved unknown/changed photo bundle file: ' + entry.name)
    if marker:
        data = read_regular(path / MARKER, 4096)
        if (not record['token'].encode().startswith(data)) or (not record.get('partial_marker') and data != record['token'].encode()):
            raise RuntimeError('Preserved photo bundle with changed ownership marker')
    for entry in entries:
        os.unlink(path / entry.name)
    os.rmdir(path)


class Control:
    """Watchers start BEFORE Popen and before complete-frame input/output."""
    def __init__(self, owner_pid, owner_birth, timeout, role):
        self.owner_pid, self.owner_birth, self.role = owner_pid, owner_birth, role
        self.end = time.monotonic() + timeout
        self.phase_end, self.phase = min(self.end, time.monotonic() + STARTUP), 'startup owner admission'
        self.children, self.record = [], None
        self.links, self.resource_lock = [], threading.RLock()
        self.keep, self.final_code, self.reason = False, None, None
        self.ready, self.done, self.returned = threading.Event(), threading.Event(), threading.Event()
        self.admission = threading.Event()
        self.admission.set()
        self.started_stop, self.release = None, lambda: None
        self.on_closed, self.handlers = None, {}
        for name, code in [('SIGINT', 130), ('SIGTERM', 143), ('SIGHUP', 129), ('SIGBREAK', 130)]:
            if hasattr(signal, name):
                sig = getattr(signal, name)
                self.handlers[sig] = signal.signal(sig, lambda s, f, c=code: self.stop(c, 'stop signal'))
        self.watcher = threading.Thread(target=self._watch, daemon=True)
        self.hard_clock = threading.Thread(target=self._hard_ceiling, daemon=True)
        self.watcher.start()
        self.hard_clock.start()
        if not self.ready.wait(STARTUP):
            self.stop(124, 'stuck at initial photo launcher handle admission')
            self.finish(124)

    def phase_at(self, label, seconds):
        self.check()
        self.phase, self.phase_end = label[:300], min(self.end, time.monotonic() + seconds)

    def stop(self, code, reason):
        if self.final_code is None:
            self.final_code, self.reason, self.started_stop = code, reason, time.monotonic()

    def check(self):
        if self.final_code is not None:
            error = RuntimeError(self.reason or 'Photo role stopped')
            error.exit_code = self.final_code or 125
            raise error

    def spawn(self, role, timeout):
        self.phase_at('launch owned file-backed ' + role, STARTUP)
        # Constant, finite argv; no pickled job is written during Popen.
        _, release, birth = launcher_handle(os.getpid()) if os.name == 'nt' else (None, lambda: None, 0)
        release()
        args = [sys.executable, str(Path(__file__).resolve()), '--role', role,
                '--owner', str(os.getpid()), '--birth', str(birth), '--timeout', str(timeout)]
        child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=None, bufsize=0, start_new_session=os.name == 'posix')
        self.children.append(child)  # actual Popen handle retained until reaped
        if self.final_code is not None:
            retire(child)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream:
                    stream.close()
        self.check()  # no job delivery if retirement happened during startup
        return child

    def _watch(self):
        errors = []
        try:
            live, self.release, _ = launcher_handle(self.owner_pid, self.owner_birth if os.name == 'nt' else None)
            if self.owner_pid <= 1 or not live():
                self.stop(143, 'Photo original launcher retired before admission')
            self.ready.set()
            while self.final_code is None:
                if not live():
                    self.stop(143, 'Photo original launcher retired')
                elif time.monotonic() > self.phase_end:
                    self.stop(124, 'stuck at ' + self.phase + '; waiting on owned photo role')
                else:
                    time.sleep(.025)
        except BaseException as error:
            self.stop(125, 'Photo owner/watch failure: ' + str(error))
            self.ready.set()
        try:
            for child in self.children:
                retire(child, graceful=self.role == 'client')
            if not self.keep:
                if not self.admission.wait(STARTUP):
                    raise RuntimeError('Photo output admission did not settle')
                remove_bundle(self.record)
        except BaseException as error:
            errors.append(str(error))
            self.final_code = 125
        try:
            if self.on_closed:
                self.on_closed({'type': 'closed', 'code': self.final_code, 'error': self.reason,
                                'cleanup': errors, 'retained': self.keep and not errors})
        except BaseException:
            pass  # EOF client cannot receive a receipt; no cleanup success invented
        finally:
            try:
                with self.resource_lock:
                    for link in self.links:
                        link.close()
            except BaseException as error:
                self.final_code = 125
                self.reason = 'Photo channel cleanup failed: ' + str(error)
            self.release()
            self.done.set()

    def _hard_ceiling(self):
        while not self.returned.is_set():
            if self.final_code is None and time.monotonic() > self.phase_end:
                self.stop(124, 'stuck at ' + self.phase)
            if self.started_stop is not None and time.monotonic() - self.started_stop >= SHUTDOWN:
                os._exit(125)  # own process only; incomplete cleanup never exits success
            time.sleep(.025)

    def finish(self, code, reason=None):
        self.stop(code, reason)
        if not self.done.wait(SHUTDOWN):
            os._exit(125)
        for child in self.children:
            if os.name == 'nt' and getattr(child, '_handle', None) is not None:
                child._handle.Close()  # only our reaped Popen process HANDLE
        self.children.clear()
        self.links.clear()
        for sig, handler in self.handlers.items():
            signal.signal(sig, handler)
        self.returned.set()
        self.watcher.join(timeout=.1)
        self.hard_clock.join(timeout=.1)
        return self.final_code


def admit_output(job, control):
    if not job.get('out'):
        return None
    control.admission.clear()
    try:
        control.check()
        out, root = Path(job['out']), Path(job['root']).resolve(strict=True)
        parent = out.parent.resolve(strict=True)
        if out != parent / out.name or root == out or root in out.parents:
            raise ValueError('Photo bundle must be a new canonical path outside project')
        out.mkdir(mode=0o700)
        info = os.lstat(out)
        if not stat.S_ISDIR(info.st_mode):
            raise RuntimeError('Photo output directory incarnation changed')
        record = {'path': str(out), 'dev': info.st_dev, 'ino': info.st_ino,
                  'token': str(uuid.uuid4()), 'files': [], 'marker': None, 'partial_marker': True}
        control.record = record
        fd = os.open(out / MARKER, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            marker = os.fstat(fd)
            record['marker'] = {'name': MARKER, 'dev': marker.st_dev, 'ino': marker.st_ino}
            data = record['token'].encode()
            if os.write(fd, data) != len(data):
                raise OSError('Partial photo owner marker write')
            record['partial_marker'] = False
        finally:
            os.close(fd)
        control.check()
        return record
    finally:
        control.admission.set()


def output_matches(record):
    info = os.lstat(record['path'])
    if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != (record['dev'], record['ino']):
        raise RuntimeError('Photo output incarnation changed')
    if read_regular(Path(record['path']) / MARKER, 4096) != record['token'].encode():
        raise RuntimeError('Photo output owner marker changed')


def reserve_output(record, request):
    import re
    name = request.get('name')
    if not record or not isinstance(name, str) or len(name.encode()) > 240 or not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name == MARKER or len(record['files']) >= 63:
        raise ValueError('Invalid bounded photo output name/count')
    output_matches(record)
    fd = os.open(Path(record['path']) / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        info = os.fstat(fd)
        row = {'name': name, 'dev': info.st_dev, 'ino': info.st_ino}
        record['files'].append(row)
        return row
    finally:
        os.close(fd)


class WorkerPipe:
    def __init__(self, link, control, job):
        self.link, self.control, self.job = link, control, job

    def send(self, value):
        self.control.check()
        self.link.send(value)

    def _reply(self, kind, request):
        until = time.monotonic() + STARTUP
        while time.monotonic() < until:
            self.control.check()
            value = self.link.recv()
            if value is not None:
                if value.get('type') != kind or value.get('request') != request:
                    raise ValueError('Unexpected photo output ownership reply')
                return value
        raise TimeoutError('stuck at owned photo output acknowledgement')

    def put(self, out, name, data):
        if len(data) > MAX_FRAME:
            raise ValueError('Photo bundle file exceeds4MiB')
        request = str(uuid.uuid4())
        self.send({'type': 'write_request', 'request': request, 'name': name})
        row = self._reply('write_admitted', request)['record']
        owner = self.job['output_record']
        output_matches(owner)
        fd = os.open(Path(out) / name, os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size or (info.st_dev, info.st_ino) != (row['dev'], row['ino']):
                raise RuntimeError('Photo reserved output incarnation changed')
            offset = 0
            while offset < len(data):
                self.control.check()
                count = os.write(fd, data[offset:offset + 65536])
                if count <= 0:
                    raise OSError('Photo output write made no progress')
                offset += count
        finally:
            os.close(fd)
        self.send({'type': 'write_complete', 'request': request, 'name': name,
                   'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        self._reply('write_verified', request)


def load_operation(spec):
    file = Path(spec['path'])
    data = read_regular(file, 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != spec['sha256']:
        raise ValueError('Photo producer source epoch changed before import')
    module_spec = importlib.util.spec_from_file_location('owned_photo_operation', file)
    module = importlib.util.module_from_spec(module_spec)
    exec(compile(data, str(file), 'exec'), module.__dict__)
    operation = getattr(module, spec['name'])
    if not callable(operation):
        raise ValueError('Photo producer operation missing')
    return module, operation


def guardian(link, job, control):
    control.phase_at('admit photo output', STARTUP)
    record = admit_output(job, control)
    link.send({'type': 'admitted', 'record': record})
    child = control.spawn('worker', job['timeout'] + SHUTDOWN)
    worker = Link(child.stdout, child.stdin, control)
    job['output_record'] = record
    worker.send({'type': 'job', 'job': job})
    link.send({'type': 'owned_worker', 'guardian_pid': os.getpid(), 'worker_pid': child.pid, 'record': record})
    control.phase_at('worker startup', min(STARTUP, job['phase_timeout']))
    while True:
        control.check()
        incoming = link.recv(0)
        if incoming is not None:
            if incoming.get('type') != 'stop':
                raise ValueError('Unexpected photo client request before result')
            error = RuntimeError('Photo client stopped')
            error.exit_code = incoming.get('code', 143)
            raise error
        message = worker.recv()
        if message is None:
            if child.poll() is not None:
                raise RuntimeError('Photo worker exited without a result')
            continue
        kind = message.get('type')
        if kind == 'phase':
            control.phase_at(message['name'], job['phase_timeout'])
            link.send(message)
        elif kind == 'write_request':
            control.admission.clear()
            try:
                control.check()
                row = reserve_output(record, message)
                worker.send({'type': 'write_admitted', 'request': message['request'], 'record': row})
            finally:
                control.admission.set()
        elif kind == 'write_complete':
            output_matches(record)
            row = next((r for r in record['files'] if r['name'] == message['name']), None)
            info = os.lstat(Path(record['path']) / message['name'])
            if not row or (info.st_dev, info.st_ino) != (row['dev'], row['ino']):
                raise RuntimeError('Photo completed output ownership changed')
            data = read_regular(Path(record['path']) / message['name'], MAX_FRAME)
            if len(data) != message['bytes'] or hashlib.sha256(data).hexdigest() != message['sha256']:
                raise ValueError('Photo completed output hash/size changed')
            row.update(bytes=message['bytes'], sha256=message['sha256'])
            worker.send({'type': 'write_verified', 'request': message['request']})
        elif kind == 'error':
            raise RuntimeError(message['message'])
        elif kind == 'result':
            control.phase_at('retire completed photo worker', STARTUP)
            child.wait(timeout=2)
            if child.returncode != 0:
                raise RuntimeError('Photo worker failed after result')
            producer, _ = load_operation(job['operation'])
            result = producer.admit_result(message['result'], job)
            if record and (not record['files'] or any('sha256' not in row for row in record['files'])):
                raise ValueError('Photo output has incomplete file ownership receipts')
            link.send({'type': 'provisional', 'result': result})
            control.phase_at('client completed-bundle commit', 2)
            while True:
                control.check()
                committed = link.recv()
                if committed is not None:
                    if committed.get('type') != 'commit':
                        raise RuntimeError('Photo client did not commit completed bundle')
                    control.keep = True
                    return
        else:
            raise ValueError('Unknown photo worker message')


def worker(link, job, control):
    control.phase_at('import admitted photo producer', min(STARTUP, job['phase_timeout']))
    module, operation = load_operation(job['operation'])
    pipe = WorkerPipe(link, control, job)
    module._OWNED_PIPE = pipe
    control.phase_at('photo producer operation', job['timeout'])
    result = operation(job, pipe)
    pipe.send({'type': 'result', 'result': result})


def validate_job(job):
    import math
    if not isinstance(job, dict) or not isinstance(job.get('pairs'), list) or len(job['pairs']) > 16 or not isinstance(job.get('root'), str) or any(not isinstance(pair, (list, tuple)) or len(pair) != 2 for pair in job['pairs']):
        raise ValueError('Bounded photo job shape required')
    for field in ('timeout', 'phase_timeout'):
        if not isinstance(job.get(field), (int, float)) or not math.isfinite(job[field]) or not 0 < job[field] <= (300 if field == 'timeout' else 60):
            raise ValueError('Finite positive photo deadlines required')
    if job['phase_timeout'] > job['timeout']:
        raise ValueError('Photo phase ceiling exceeds overall')
    if 'operation' in job:
        spec = job['operation']
        if not isinstance(spec, dict) or not isinstance(spec.get('path'), str) or not isinstance(spec.get('name'), str) or not spec['name'].isidentifier() or len(spec['name']) > 80 or not isinstance(spec.get('sha256'), str) or len(spec['sha256']) != 64 or any(c not in '0123456789abcdef' for c in spec['sha256']):
            raise ValueError('Exact bounded photo producer source descriptor required')
    for value in [job['root'], job.get('out')] + [s for pair in job['pairs'] for s in pair]:
        if value is not None and (not isinstance(value, str) or not value or '\0' in value or len(value.encode('utf-8')) > 4096):
            raise ValueError('Photo paths/URL fields require nonempty <=4KiB UTF-8 strings')
    encode_frame({'type': 'job', 'job': job})


def run_job(job, operation_file, operation_name='produce', finalize=None):
    validate_job(job)
    owner = os.getppid()
    if owner <= 1:
        raise RuntimeError('Photo import needs a live foreground launcher')
    control = Control(owner, None, job['timeout'] + SHUTDOWN, 'client')
    code, receipt, closed = 1, None, None
    try:
        control.phase_at('admit producer source and canonical bundle parent', STARTUP)
        source = read_regular(operation_file, 1024 * 1024)
        job = dict(job, operation={'path': str(Path(operation_file).resolve()),
                                 'name': operation_name, 'sha256': hashlib.sha256(source).hexdigest()})
        if job.get('out'):
            requested = Path(job['out'])
            job['out'] = str(requested.parent.resolve(strict=True) / requested.name)
        validate_job(job)
        child = control.spawn('guardian', job['timeout'])
        link = Link(child.stdout, child.stdin, control)
        link.send({'type': 'job', 'job': job})
        control.phase_at('owned photo guardian', job['timeout'] + SHUTDOWN)
        while closed is None:
            control.check()
            value = link.recv()
            if value is None:
                if child.poll() is not None:
                    raise RuntimeError('Photo guardian exited without cleanup receipt')
                continue
            kind = value.get('type')
            if kind == 'owned_worker':
                print('@@photos-owned ' + json.dumps(dict(value, client_pid=os.getpid())), file=sys.stderr, flush=True)
            elif kind == 'phase':
                print('[photos] ' + value['name'], file=sys.stderr, flush=True)
            elif kind == 'provisional':
                receipt = value['result']
                control.check()
                link.send({'type': 'commit'})
            elif kind == 'closed':
                closed = value
            elif kind != 'admitted':
                raise ValueError('Unknown photo guardian response')
        child.wait(timeout=2)
        control.check()
        if child.returncode or closed['code'] or closed['cleanup'] or not closed['retained'] or not receipt:
            error = RuntimeError(closed.get('error') or 'Photo job did not cleanly complete')
            error.exit_code = closed['code'] or 125
            raise error
        if finalize:
            control.phase_at('write completed CLI receipt', STARTUP)
            finalize(receipt)
        code = 0
        return receipt
    except BaseException as error:
        code = getattr(error, 'exit_code', 124 if isinstance(error, TimeoutError) else 1)
        raise
    finally:
        final_code = control.finish(code)
        if final_code != code:
            error = RuntimeError(control.reason or 'Photo cleanup did not complete')
            error.exit_code = final_code or 125
            raise error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=('guardian', 'worker'), required=True)
    parser.add_argument('--owner', type=int, required=True)
    parser.add_argument('--birth', type=int, required=True)
    parser.add_argument('--timeout', type=float, required=True)
    args = parser.parse_args(argv)
    if args.owner <= 1 or not 0 < args.timeout <= 308 or args.birth < 0:
        parser.error('Valid retained owner/finite role timeout required')
    control = Control(args.owner, args.birth, args.timeout, args.role)
    link = Link(sys.stdin.buffer, sys.stdout.buffer, control, owned=False)
    if args.role == 'guardian':
        control.on_closed = lambda value: link.send(value, timeout=.5)
    code, error = 1, None
    try:
        while True:
            control.check()
            message = link.recv()
            if message is not None:
                if message.get('type') != 'job':
                    raise ValueError('Initial owned photo job required')
                break
        job = message['job']
        validate_job(job)
        (guardian if args.role == 'guardian' else worker)(link, job, control)
        code = 0
    except BaseException as failure:
        error = str(failure)
        code = getattr(failure, 'exit_code', 124 if isinstance(failure, TimeoutError) else 143 if isinstance(failure, (EOFError, BrokenPipeError)) else 1)
        if args.role == 'worker':
            try:
                link.send({'type': 'error', 'message': type(failure).__name__ + ': ' + error[:2000]}, timeout=.5)
            except BaseException:
                pass
    return control.finish(code, error)


if __name__ == '__main__':
    raise SystemExit(main())
