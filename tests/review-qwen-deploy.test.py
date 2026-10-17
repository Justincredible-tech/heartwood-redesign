"""Focused TLS + cleanup + bounded-listing tests for tools/deploy-ftp.py (codex-021..024). No network.

Proves: plaintext connect -> explicit auth -> certificate inspection -> login ordering (a plain socket
cannot serve getpeercert); no-pin strict-hostname default; pin format refusal before any connection;
pin match/mismatch on control and protected data sockets; FULL-client cleanup on every failure path
(control mismatch, absent certificate, auth error, login error, data-socket failure) with the original
error preserved; env-isolated credentials-file parsing including digit keys; bounded remote listing
(traversal-name guard before recursion, depth cap, file-count cap, finite deadline).
Plus the derived authored-address defaults and the no-embedded-domain rule (tools/site_address.py).
Stdlib only; run via:
    uv run --no-project python tests/review-qwen-deploy.test.py
"""
import ftplib
import hashlib
import importlib.util
import os
import ssl
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

FORK = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('deploy_ftp', FORK / 'tools' / 'deploy-ftp.py')
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)
_site_spec = importlib.util.spec_from_file_location('site_address', FORK / 'tools' / 'site_address.py')
site = importlib.util.module_from_spec(_site_spec)
_site_spec.loader.exec_module(site)

PIN_A = hashlib.sha256(b'cert-a').hexdigest()
PIN_B = hashlib.sha256(b'cert-b').hexdigest()
CREDS = {'host': 'example.invalid', 'user': 'u', 'password': 'p', 'cert_sha256': ''}
CLEAN_ENV = {'FTP_HOST': '', 'FTP_USER': '', 'FTP_PASS': '', 'FTP_CERT_SHA256': ''}


def fake_sock(der):
    class S:
        def __init__(self):
            self.closed = False

        def getpeercert(self, binary_form=False):
            return der

        def settimeout(self, value):
            pass

        def close(self):
            self.closed = True

    return S()


class RecordingFTP:
    """A fake FTP client whose control socket is PLAIN until auth() swaps in a TLS-like socket."""

    instances: list = []
    calls: list = []
    last_context = None
    fail_mode = None

    def __init__(self, context=None):
        RecordingFTP.last_context = context
        self.context = context
        self.expected_pin = None
        self.file = type('F', (), {'closed': False})()

        def close_file():
            self.file.closed = True

        self.file.close = close_file
        self.closed = False
        self.sock = self._plain()
        RecordingFTP.instances.append(self)

    def _plain(self):
        class Plain:
            closed = False

            def getpeercert(self, binary_form=False):
                RecordingFTP.calls.append('cert-read(plain)')
                raise RuntimeError('plaintext control socket has no certificate')

            def settimeout(self, value):
                pass

            def close(self):
                self.closed = True

        return Plain()

    def _tls(self):
        der = None if RecordingFTP.fail_mode == 'cert-absent' else b'cert-a'
        sock = fake_sock(der)
        original = sock.getpeercert

        def logging_getpeercert(binary_form=False):
            RecordingFTP.calls.append('cert-read(tls)')
            return original(binary_form)

        sock.getpeercert = logging_getpeercert
        return sock

    def connect(self, host, port, timeout=None):
        RecordingFTP.calls.append('connect')

    def auth(self):
        RecordingFTP.calls.append('auth')
        if RecordingFTP.fail_mode == 'auth':
            raise RuntimeError('OWNED auth failure')
        self.sock = self._tls()

    def login(self, user, password):
        RecordingFTP.calls.append('login')
        if RecordingFTP.fail_mode == 'login':
            raise RuntimeError('OWNED login failure')

    def prot_p(self):
        RecordingFTP.calls.append('prot_p')
        if RecordingFTP.fail_mode == 'prot_p':
            raise RuntimeError('OWNED prot_p failure')

    def set_pasv(self, value):
        RecordingFTP.calls.append('set_pasv')

    def close(self):
        RecordingFTP.calls.append('close')
        self.closed = True
        if self.file is not None:
            self.file.closed = True
        if self.sock is not None:
            self.sock.closed = True


class DeployTlsTests(unittest.TestCase):
    def setUp(self):
        RecordingFTP.instances = []
        RecordingFTP.calls = []
        RecordingFTP.last_context = None
        RecordingFTP.fail_mode = None

    def run_connect(self, creds):
        with mock.patch.object(mod, 'PinnedFTP_TLS', RecordingFTP):
            return mod.connect(creds)

    def test_ordering_no_pin_auth_before_login_and_strict_hostname_default(self):
        self.run_connect(dict(CREDS))
        self.assertEqual(RecordingFTP.calls, ['connect', 'auth', 'login', 'prot_p', 'set_pasv'],
                         'without a pin there is no certificate read; auth still precedes login')
        self.assertNotIn('cert-read(plain)', RecordingFTP.calls, 'a plain socket can never be inspected')
        ctx = RecordingFTP.last_context
        self.assertTrue(ctx.check_hostname, 'without a pin the hostname must be verified (strict default)')
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)

    def test_pin_match_control_then_login_with_hostname_replaced(self):
        self.run_connect(dict(CREDS, cert_sha256=PIN_A))
        self.assertEqual(RecordingFTP.calls, ['connect', 'auth', 'cert-read(tls)', 'login', 'prot_p', 'set_pasv'])
        self.assertFalse(RecordingFTP.last_context.check_hostname, 'a valid pin replaces hostname matching')
        self.assertEqual(RecordingFTP.last_context.verify_mode, ssl.CERT_REQUIRED)

    def test_control_mismatch_closes_the_whole_client_before_login(self):
        with self.assertRaises(SystemExit) as caught:
            self.run_connect(dict(CREDS, cert_sha256=PIN_B))
        self.assertIn('Control connection certificate does not match', str(caught.exception))
        ftp = RecordingFTP.instances[0]
        self.assertTrue(ftp.closed, 'FTP.close must run on a certificate failure')
        self.assertTrue(ftp.file.closed, 'the control file must be released')
        self.assertNotIn('login', RecordingFTP.calls)

    def test_absent_certificate_closes_the_whole_client(self):
        RecordingFTP.fail_mode = 'cert-absent'
        with self.assertRaises(SystemExit) as caught:
            self.run_connect(dict(CREDS, cert_sha256=PIN_A))
        self.assertIn('No TLS certificate on the control connection', str(caught.exception))
        ftp = RecordingFTP.instances[0]
        self.assertTrue(ftp.closed)
        self.assertTrue(ftp.file.closed)
        self.assertNotIn('login', RecordingFTP.calls)

    def test_auth_error_closes_whole_client_and_reraises_original(self):
        RecordingFTP.fail_mode = 'auth'
        with self.assertRaises(RuntimeError) as caught:
            self.run_connect(dict(CREDS))
        self.assertEqual(str(caught.exception), 'OWNED auth failure')
        ftp = RecordingFTP.instances[0]
        self.assertTrue(ftp.closed)
        self.assertTrue(ftp.file.closed)

    def test_login_error_closes_whole_client_and_reraises_original(self):
        RecordingFTP.fail_mode = 'login'
        with self.assertRaises(RuntimeError) as caught:
            self.run_connect(dict(CREDS))
        self.assertEqual(str(caught.exception), 'OWNED login failure')
        ftp = RecordingFTP.instances[0]
        self.assertTrue(ftp.closed)
        self.assertTrue(ftp.file.closed)

    def test_prot_p_error_closes_whole_client_and_reraises_original(self):
        RecordingFTP.fail_mode = 'prot_p'
        with self.assertRaises(RuntimeError) as caught:
            self.run_connect(dict(CREDS))
        self.assertEqual(str(caught.exception), 'OWNED prot_p failure')
        ftp = RecordingFTP.instances[0]
        self.assertTrue(ftp.closed, 'prot_p failures are inside the cleanup try')
        self.assertTrue(ftp.file.closed)

    def test_malformed_pins_open_no_connection(self):
        for bad in ['XYZ', 'aa:bb:cc', 'g' * 64, 'a' * 63, 'a' * 65]:
            with self.assertRaises(SystemExit):
                self.run_connect(dict(CREDS, cert_sha256=bad))
        self.assertEqual(RecordingFTP.instances, [], 'a bad pin must be refused before any connection')

    def test_colon_separated_pin_format_is_accepted_after_normalization(self):
        raw = ':'.join(PIN_A[i:i + 2] for i in range(0, 64, 2))
        self.assertEqual(mod.normalize_cert_pin(raw), PIN_A)
        self.assertIsNone(mod.normalize_cert_pin(''))

    def test_certificate_less_socket_is_refused_and_closed(self):
        absent = fake_sock(None)
        with self.assertRaises(SystemExit) as caught:
            mod.verify_tls_certificate(absent, PIN_A, 'control connection')
        self.assertIn('No TLS certificate', str(caught.exception))
        self.assertTrue(absent.closed, 'even the absent-certificate path must close the socket')
        unreadable = fake_sock(b'x')
        unreadable.getpeercert = lambda binary_form=False: (_ for _ in ()).throw(RuntimeError('unreadable'))
        with self.assertRaises(SystemExit):
            mod.verify_tls_certificate(unreadable, PIN_A, 'control connection')
        self.assertTrue(unreadable.closed, 'an exception from getpeercert must also close and refuse')

    def test_protected_data_socket_pin_enforced(self):
        instance = mod.PinnedFTP_TLS(context=ssl.create_default_context())
        instance.expected_pin = PIN_A
        good, bad, absent = fake_sock(b'cert-a'), fake_sock(b'cert-b'), fake_sock(None)
        with mock.patch.object(ftplib.FTP_TLS, 'ntransfercmd', return_value=(good, None)):
            conn, size = instance.ntransfercmd('RETR x')
        self.assertIs(conn, good)
        with mock.patch.object(ftplib.FTP_TLS, 'ntransfercmd', return_value=(bad, None)):
            with self.assertRaises(SystemExit) as caught:
                instance.ntransfercmd('RETR x')
        self.assertIn('Data connection certificate does not match', str(caught.exception))
        self.assertTrue(bad.closed, 'a mismatching data socket must be closed')
        with mock.patch.object(ftplib.FTP_TLS, 'ntransfercmd', return_value=(absent, None)):
            with self.assertRaises(SystemExit) as caught:
                instance.ntransfercmd('RETR x')
        self.assertIn('No TLS certificate on the data connection', str(caught.exception))
        self.assertTrue(absent.closed, 'a certificate-less data socket must be closed')

    def test_unpinned_instance_does_not_inspect_data_sockets(self):
        instance = mod.PinnedFTP_TLS(context=ssl.create_default_context())
        plain = fake_sock(None)
        with mock.patch.object(ftplib.FTP_TLS, 'ntransfercmd', return_value=(plain, None)):
            conn, size = instance.ntransfercmd('RETR x')
        self.assertIs(conn, plain)

    def test_credentials_file_parses_digit_keys_and_pin_env_isolated(self):
        with tempfile.TemporaryDirectory(prefix='hw-deploy-creds-') as tmp:
            path = Path(tmp) / 'credentials'
            path.write_text(f'FTP_USER = u\nFTP_PASS = p\ncert_sha256 = {PIN_A}\n', encoding='utf-8')
            with mock.patch.dict(os.environ, CLEAN_ENV):
                creds = mod.load_credentials(str(path))
        self.assertEqual(creds['user'], 'u')
        self.assertEqual(creds['password'], 'p')
        self.assertEqual(creds['cert_sha256'], PIN_A, 'keys containing digits (cert_sha256) must parse from a file')

    def test_file_pin_mismatch_refused_before_login_env_isolated(self):
        with tempfile.TemporaryDirectory(prefix='hw-deploy-creds-') as tmp:
            path = Path(tmp) / 'credentials'
            path.write_text(f'FTP_USER=u\nFTP_PASS=p\ncert_fingerprint={PIN_B}\n', encoding='utf-8')
            with mock.patch.dict(os.environ, CLEAN_ENV):
                creds = mod.load_credentials(str(path))
        self.assertEqual(creds['cert_sha256'], PIN_B, 'cert_fingerprint is an accepted file alias')
        with self.assertRaises(SystemExit) as caught:
            self.run_connect(creds)
        self.assertIn('Control connection certificate does not match', str(caught.exception))
        self.assertNotIn('login', RecordingFTP.calls)


class FakeListingFTP:
    """Inert FTP double whose retrlines streams MLSD-format lines, exercising the REAL bounded callback.
    `endless` deliberately produces lines without limit, matching production ftplib's buffered-mlsd risk."""

    def __init__(self, tree, endless=False):
        self.tree = tree          # directory -> [MLSD line, ...]
        self.endless = endless
        self.listed = []
        self.sock = type('S', (), {'settimeout': lambda s, v: None})()
        self.current_data_socket = None

    def retrlines(self, cmd, callback):
        directory = cmd.split(' ', 1)[1] if ' ' in cmd else ''
        self.listed.append(directory)
        if self.endless:
            i = 0
            while True:
                callback(f'type=file;size=1; f{i}.txt')
                i += 1
        for line in self.tree.get(directory, []):
            callback(line)


class RemoteListingBoundsTests(unittest.TestCase):
    def test_traversal_names_are_refused_during_collection(self):
        tree = {'public_html/heartwood': ['type=dir;size=0; a/../../esc', 'type=file;size=3; ok.txt']}
        ftp = FakeListingFTP(tree)
        with self.assertRaises(SystemExit) as caught:
            mod.remote_files(ftp, 'public_html/heartwood')
        self.assertIn('Refusing', str(caught.exception))
        self.assertEqual(ftp.listed, ['public_html/heartwood'], 'the refused path must never be listed')

    def test_endless_listing_is_aborted_promptly_by_the_entry_budget(self):
        with mock.patch.object(mod, 'MAX_LISTING_ENTRIES', 5):
            with self.assertRaises(SystemExit) as caught:
                mod.remote_files(FakeListingFTP({}, endless=True), 'public_html/heartwood')
        self.assertIn('exceeds 5 entries', str(caught.exception))

    def test_entry_count_includes_directories_and_ignored_types(self):
        lines = ['type=dir;size=0; d'] + ['type=link; x'] * 4
        with mock.patch.object(mod, 'MAX_LISTING_ENTRIES', 3):
            with self.assertRaises(SystemExit) as caught:
                mod.remote_files(FakeListingFTP({'public_html/heartwood': lines}), 'public_html/heartwood')
        self.assertIn('exceeds 3 entries', str(caught.exception))

    def test_depth_bound(self):
        tree = {}
        directory = 'public_html/heartwood'
        for _ in range(mod.MAX_LISTING_DEPTH + 2):
            tree[directory] = ['type=dir;size=0; d', 'type=file;size=1; f.txt']
            directory += '/d'
        with self.assertRaises(SystemExit) as caught:
            mod.remote_files(FakeListingFTP(tree), 'public_html/heartwood')
        self.assertIn('deeper than', str(caught.exception))

    def test_expired_deadline_is_refused(self):
        with self.assertRaises(SystemExit) as caught:
            mod.remote_files(FakeListingFTP({}), 'public_html/heartwood', deadline=time.monotonic() - 1)
        self.assertIn('time budget', str(caught.exception))

    def test_normal_tree_still_returns_files(self):
        tree = {'public_html/heartwood': ['type=file;size=10; a.css', 'type=dir;size=0; sub', 'type=link; skip'],
                'public_html/heartwood/sub': ['type=file;size=20; b.js']}
        files = mod.remote_files(FakeListingFTP(tree), 'public_html/heartwood')
        self.assertEqual(files, {'public_html/heartwood/a.css': 10, 'public_html/heartwood/sub/b.js': 20})

    def test_names_with_spaces_keep_their_byte_spelling(self):
        tree = {'public_html/heartwood': ['type=file;size=7;  spaced name.txt', 'type=file;size=3; trail.txt ']}
        files = mod.remote_files(FakeListingFTP(tree), 'public_html/heartwood')
        self.assertEqual(files, {'public_html/heartwood/ spaced name.txt': 7,
                                 'public_html/heartwood/trail.txt ': 3},
                         'a space inside a legitimate filename must never be stripped before backup')


class AuthoredAddressTests(unittest.TestCase):
    def test_derived_defaults_match_the_authored_canonical(self):
        origin, package = site.authored_parts()
        self.assertEqual(site.authored_base(), f'{origin}/{package}/')
        self.assertTrue(site.authored_base().startswith('https://'))
        host = origin.split('//', 1)[1]
        self.assertEqual(mod.DEFAULT_HOST, 'ftp.' + host)
        self.assertEqual(mod.DEFAULT_CREDENTIALS, Path.home() / '.config' / host.split('.', 1)[0] / 'ftp-credentials')
        self.assertEqual(site.host_label(), host.split('.', 1)[0])

    def test_tool_sources_do_not_embed_the_domain(self):
        label = site.host_label().lower()
        for tool in ['deploy-ftp.py', 'render-meta-images.py', 'site_address.py']:
            text = (FORK / 'tools' / tool).read_text(encoding='utf-8').lower()
            self.assertNotIn(label, text, tool + ' must derive the address from the site source, not embed it')

    def test_missing_canonical_fails_with_an_explicit_message(self):
        with tempfile.TemporaryDirectory(prefix='hw-site-address-') as tmp:
            page = Path(tmp) / 'page.html'
            page.write_text('<html></html>', encoding='utf-8')
            with self.assertRaises(SystemExit) as caught:
                site.authored_base(page)
            self.assertIn('canonical', str(caught.exception))

    def test_render_meta_derives_when_base_is_omitted(self):
        text = (FORK / 'tools' / 'render-meta-images.py').read_text(encoding='utf-8')
        self.assertIn('args.base or authored_base()', text)
        self.assertIn('default=None', text)


if __name__ == '__main__':
    unittest.main()
