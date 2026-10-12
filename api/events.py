"""Vercel Python Function: real API refresh on first open of the day.
Read-only public feed; SEOUL_API_KEY is an environment variable, never bundled in client assets.
Vercel CDN caches successful early/morning slots separately for 10 hours. Failure responses never cached.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
import json
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from scripts.update_data import fetch_all, build_feed

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?', 1)[0].rstrip('/') != '/api/events':
            return self._reply(404, {'error':'not_found'})
        from urllib.parse import parse_qs, urlparse
        args = parse_qs(urlparse(self.path).query)
        if any(x not in ('slot',) for x in args) or args.get('slot', ['morning'])[0] not in ('early', 'morning'):
            return self._reply(400, {'error':'invalid_query'})
        key = os.environ.get('SEOUL_API_KEY', '').strip()
        if not key:
            return self._reply(503, {'error': 'api_key_not_configured'})
        try:
            now = datetime.now(ZoneInfo('Asia/Seoul'))
            rows, count = fetch_all(key)
            if count == 0:
                raise RuntimeError('서울시 API returned empty dataset')
            payload = build_feed(rows, {'mode': 'preview', 'items': []}, now, count)
            if not payload['items']:
                raise RuntimeError('No verified matching data')
            return self._reply(200, payload, 'public, max-age=0, s-maxage=36000, stale-while-revalidate=1800')
        except Exception as e:
            print('서울시 API refresh failed:', type(e).__name__, str(e))
            return self._reply(503, {'error':'source_unavailable'})

    def _reply(self, code, obj, cache='no-store'):
        body=json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control',cache)
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(body)
