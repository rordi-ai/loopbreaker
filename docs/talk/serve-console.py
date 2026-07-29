#!/usr/bin/env python3
"""Local file server for the talk console.

Serves docs/talk/console.html at the root URL (and at /console.html), bound to
127.0.0.1:7333. Put behind `tailscale serve` for tailnet-only HTTPS access.

    python3 docs/talk/serve-console.py
"""
import functools
import http.server
import os
import socketserver

DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 7333


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path in ("/", ""):
            self.path = "/console.html"
        return super().do_GET()


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=DIR)
    with Server(("127.0.0.1", PORT), handler) as httpd:
        print(f"console at http://127.0.0.1:{PORT}/  (root -> console.html)")
        httpd.serve_forever()
