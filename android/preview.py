"""Preview the bundled frontend on loopback; no Android tools or npm install needed."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import webbrowser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('port must be between 0 and 65535')
    root = Path(__file__).resolve().parent
    assets = root / 'work/android-app/assets'
    if not (assets / 'index.html').is_file():
        parser.error('Run this script from the extracted complete engineering package.')

    class Handler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

    handler = partial(Handler, directory=str(root))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError:
        if args.port == 0:
            raise
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    url = 'http://127.0.0.1:%s/' % server.server_port + __import__('urllib.parse', fromlist=['quote']).quote('打开预览.html')
    print('Suike frontend preview: ' + url, flush=True)
    print('Press Ctrl+C to stop. Native Android features require the Android app.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
