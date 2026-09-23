#!/usr/bin/env python3
"""Serve only this project's game files on loopback, without dependencies."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote
import argparse
import os
import stat

ROOT = Path(__file__).resolve().parent.parent

class Handler(SimpleHTTPRequestHandler):
    # System MIME databases (including Windows file associations) must not make
    # ES modules text/plain: browsers reject that with nosniff enabled.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.css': 'text/css',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def game_file(self):
        """Resolve an allowed regular file, without traversal or symlinks."""
        try:
            path = unquote(self.path.split('?', 1)[0], errors='strict')
        except (UnicodeError, ValueError):
            return None
        if not path.startswith('/') or any(ord(c) < 32 or ord(c) == 127 for c in path):
            return None
        if any(c in path for c in ('\\', ':', '?', '#')):
            return None
        if path == '/':
            path = '/index.html'
        parts = path[1:].split('/')
        # Reject traversal itself rather than normalizing it into an allowed
        # route. The decoded check also catches encoded separators/dot segments.
        if any(not part or part.startswith('.') for part in parts):
            return None
        root_asset = len(parts) == 1 and parts[0] in {
            'index.html', 'style.css', 'elements.html', 'elements.css',
        }
        source_asset = len(parts) > 1 and parts[0] == 'src' and parts[-1].endswith('.js')
        if not (root_asset or source_asset):
            return None
        candidate = ROOT
        try:
            for part in parts:
                candidate = candidate / part
                if candidate.is_symlink():
                    return None
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(ROOT)
            if not resolved.is_file():
                return None
        except (OSError, RuntimeError, ValueError):
            return None
        return resolved

    def send_head(self):
        # Both inherited GET and HEAD handlers call this method. Never delegate
        # path translation or directory listing to SimpleHTTPRequestHandler.
        path = self.game_file()
        if path is None:
            self.send_error(404)
            return None
        try:
            source = path.open('rb')
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode):
                source.close()
                self.send_error(404)
                return None
        except OSError:
            self.send_error(404)
            return None
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(info.st_size))
        self.send_header('Last-Modified', self.date_time_string(info.st_mtime))
        self.end_headers()
        return source

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8420)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'SPACEFORTRESS -> http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
