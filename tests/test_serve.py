"""The loopback preview exposes game assets only, on GET and HEAD alike."""
import http.client
import importlib.util
import mimetypes
from pathlib import Path
import tempfile
import threading
import unittest


spec = importlib.util.spec_from_file_location(
    'spacefortress_server', Path(__file__).resolve().parents[1] / 'tools' / 'serve.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class QuietHandler(preview.Handler):
    def log_message(self, *args):
        pass


class PreviewAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='spacefortress-server-test-')
        cls.base = Path(cls.scratch.name)
        cls.root = cls.base / 'game'
        cls.root.mkdir()
        cls.original_root = preview.ROOT
        preview.ROOT = cls.root.resolve()
        cls.assets = {
            'index.html': '<!doctype html><title>Colony</title>',
            'elements.html': '<!doctype html><title>Lab</title>',
            'style.css': 'body { margin: 0; }',
            'elements.css': 'canvas { display: block; }',
            'src/app.js': 'export const game = true;',
            'src/nested/helper.js': 'export const helper = true;',
        }
        for name, content in {
            **cls.assets,
            '.env': 'private test fixture',
            'README.md': 'non-game test fixture',
            '.runtime-qa/profile.js': 'private test profile',
            'src/.private.js': 'hidden source fixture',
            'src/settings.json': '{}',
        }.items():
            target = cls.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf-8')
        (cls.root / 'src/directory.js').mkdir()
        cls.server = preview.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()
        preview.ROOT = cls.original_root
        cls.scratch.cleanup()

    def request(self, method, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def assert_denied(self, path):
        for method in ('GET', 'HEAD'):
            with self.subTest(method=method, path=path):
                status, headers, body = self.request(method, path)
                self.assertEqual(status, 404)
                self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                if method == 'HEAD':
                    self.assertEqual(body, b'')

    def test_allowed_get_assets_and_query_strings(self):
        for name, content in self.assets.items():
            for suffix in ('', '?cache=1'):
                with self.subTest(name=name, suffix=suffix):
                    status, headers, body = self.request('GET', '/' + name + suffix)
                    self.assertEqual(status, 200)
                    self.assertEqual(body, content.encode('utf-8'))
                    self.assertEqual(headers['Cache-Control'], 'no-cache')
        self.assertEqual(self.request('GET', '/')[2], self.assets['index.html'].encode())
        self.assertEqual(self.request('GET', '/src/%61pp.js')[2], self.assets['src/app.js'].encode())

    def test_allowed_head_reports_asset_length_without_body(self):
        for name, content in self.assets.items():
            with self.subTest(name=name):
                status, headers, body = self.request('HEAD', '/' + name)
                self.assertEqual(status, 200)
                self.assertEqual(int(headers['Content-Length']), len(content.encode('utf-8')))
                self.assertEqual(body, b'')
        self.assertEqual(self.request('HEAD', '/')[0], 200)

    def test_private_files_and_non_javascript_source_files_are_denied(self):
        for path in ('/.env', '/README.md', '/.runtime-qa/profile.js',
                     '/src/.private.js', '/src/settings.json', '/missing.js'):
            self.assert_denied(path)

    def test_literal_and_encoded_traversal_are_denied(self):
        for path in (
            '/src/../README.md', '/src/../index.html', '/src/./app.js',
            '/src/%2e%2e/README.md', '/src/%2E%2E%2Findex.html',
            '/src/%2e/app.js', '/src/..%5CREADME.md',
            '/src/%252e%252e/README.md', '/src/%2e%2e%5cindex.html',
            '/src/app.js%00', '/src/%ff.js', '/src/C:/app.js',
            '/src//app.js', '/src/app.js:private.js',
        ):
            self.assert_denied(path)

    def test_directories_have_no_index_or_listing(self):
        for path in ('/src', '/src/', '/src/nested/', '/src/directory.js'):
            self.assert_denied(path)

    def test_symlink_files_and_directories_are_denied(self):
        external = self.base / 'outside.js'
        external.write_text('outside fixture', encoding='utf-8')
        links = (
            (self.root / 'src/escape.js', external),
            (self.root / 'src/alias.js', self.root / 'src/app.js'),
            (self.root / 'src/linked', self.root / 'src/nested'),
        )
        created = []
        try:
            for link, target in links:
                try:
                    link.symlink_to(target, target_is_directory=target.is_dir())
                except (OSError, NotImplementedError):
                    self.skipTest('This platform does not permit creating test symlinks.')
                created.append(link)
            for path in ('/src/escape.js', '/src/alias.js', '/src/linked/helper.js'):
                self.assert_denied(path)
        finally:
            for link in created:
                link.unlink()

    def test_javascript_and_css_mime_ignore_system_associations(self):
        previous = {extension: mimetypes.types_map.get(extension) for extension in ('.js', '.css')}
        try:
            for extension in previous:
                mimetypes.add_type('text/plain', extension)
            for path, expected in (('/src/app.js', 'text/javascript'), ('/style.css', 'text/css')):
                for method in ('GET', 'HEAD'):
                    with self.subTest(path=path, method=method):
                        status, headers, _ = self.request(method, path)
                        self.assertEqual(status, 200)
                        self.assertEqual(headers['Content-Type'], expected)
                        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        finally:
            for extension, value in previous.items():
                if value is None:
                    mimetypes.types_map.pop(extension, None)
                else:
                    mimetypes.types_map[extension] = value


if __name__ == '__main__':
    unittest.main()
