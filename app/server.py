#!/usr/bin/env python3
"""
MediaCenter Portable Server v2.1
Electron-kompatibel | Python 3.9-3.13 | Windows/Linux/Mac
"""

import http.server
import socketserver
import json
import os
import sys
import re
import mimetypes
import io
import urllib.parse
import threading
import time
import socket
import subprocess
import shutil
import hashlib
import signal
import atexit
from pathlib import Path
from datetime import datetime
from html import escape as html_escape

# ─── Konfiguration ────────────────────────────────────────────────────────────
DEFAULT_PORT = 8080
PORT         = DEFAULT_PORT
HOST         = "0.0.0.0"
BASE_DIR     = Path(__file__).parent.resolve()
MEDIA_DIR    = BASE_DIR / "media"
CACHE_FILE   = BASE_DIR / "api" / "library_cache.json"
CACHE_TTL    = 300
MULTIPLAYER_PID_FILE = BASE_DIR / "games" / "server-ws.pid"

PUBLIC_ROOT_FILES = {
    "index.html",
    "STARTSEITE.html",
    "FILME.html",
    "SERIEN.html",
    "MUSIK.html",
    "FOTOS.html",
    "SPIELE.html",
    "upload.html",
    "manifest.json",
    "sw.js",
    "movie-default.svg",
    "games/lobby.html",
}

PUBLIC_PREFIXES = (
    "api/thumbnails/",
    "css/",
    "js/",
    "components/",
    "images/",
    "media/Images/",
    "media/Thumbnails/",
    "games/solo/",
    "games/multi/",
    "games/shared/",
)

VIDEO_EXT = {
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".m4v", ".3gp",
    ".mpg", ".mpeg", ".ogv", ".ts", ".mts", ".m2ts",
}
AUDIO_EXT = {
    ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".oga", ".opus",
    ".wma", ".aiff", ".aif", ".amr",
}
IMAGE_EXT = {
    ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".svg",
    ".ico", ".avif", ".tif", ".tiff",
}
TEXT_EXT  = {".txt", ".md", ".pdf", ".doc", ".docx", ".html", ".json"}

mimetypes.add_type("video/mp4",          ".mp4")
mimetypes.add_type("video/webm",         ".webm")
mimetypes.add_type("video/x-matroska",   ".mkv")
mimetypes.add_type("video/ogg",          ".ogv")
mimetypes.add_type("video/mpeg",         ".mpeg")
mimetypes.add_type("video/mpeg",         ".mpg")
mimetypes.add_type("video/mp2t",         ".ts")
mimetypes.add_type("video/mp2t",         ".mts")
mimetypes.add_type("video/mp2t",         ".m2ts")
mimetypes.add_type("audio/mpeg",         ".mp3")
mimetypes.add_type("audio/flac",         ".flac")
mimetypes.add_type("audio/ogg",          ".ogg")
mimetypes.add_type("audio/ogg",          ".oga")
mimetypes.add_type("audio/opus",         ".opus")
mimetypes.add_type("audio/aac",          ".aac")
mimetypes.add_type("audio/x-m4a",        ".m4a")
mimetypes.add_type("audio/x-aiff",       ".aiff")
mimetypes.add_type("audio/x-aiff",       ".aif")
mimetypes.add_type("audio/amr",          ".amr")
mimetypes.add_type("image/avif",         ".avif")
mimetypes.add_type("image/tiff",         ".tif")
mimetypes.add_type("image/tiff",         ".tiff")
mimetypes.add_type("image/jpeg",         ".jfif")
mimetypes.add_type("application/json",   ".json")

# ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def format_size(b):
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.2f} TB"


def _clean_name(name: str) -> str:
    return re.sub(r"[_\-]+", " ", name).strip()


def _detect_episode(filename: str):
    """Erkennt Staffel/Episode aus Dateinamen."""
    stem = Path(filename).stem
    for pat, fn in [
        (r"[Ss](\d{1,2})[Ee](\d{1,3})",           lambda m: (int(m.group(1)), int(m.group(2)))),
        (r"(\d{1,2})[xX](\d{1,3})",                lambda m: (int(m.group(1)), int(m.group(2)))),
        (r"[EeSs](\d{1,2})[Ff](\d{1,3})",          lambda m: (int(m.group(1)), int(m.group(2)))),
        (r"[Ee][Pp]\.?\s*(\d{1,3})",               lambda m: (1, int(m.group(1)))),
        (r"(?:[Ee]pisode|[Ff]olge)[_\s\.]*(\d{1,3})", lambda m: (1, int(m.group(1)))),
    ]:
        m = re.search(pat, stem)
        if m:
            return fn(m)
    return None


def _guess_series_from_path(parts):
    series_name = _clean_name(parts[0]) if parts else "Unbekannt"
    season_num  = 1
    for part in parts[1:-1]:
        m = re.search(
            r"(?:[Ss]taffel|[Ss]eason|[Ss]erie)[_\s\-]?(\d+)|\b[Ss](\d{1,2})\b",
            part,
        )
        if m:
            season_num = int(m.group(1) or m.group(2))
            break
    return series_name, season_num


def _ep_title(filename, season, episode):
    stem = Path(filename).stem
    clean = re.sub(
        r"[Ss]\d{1,2}[Ee]\d{1,3}|\d{1,2}[xX]\d{1,3}|[EeSs]\d{1,2}[Ff]\d{1,3}|"
        r"[Ee][Pp]\.?\s*\d+|(?:[Ee]pisode|[Ff]olge)[_\s]\d+",
        "",
        stem,
    ).strip(" -_.")
    tag = f"S{season:02d}E{episode:02d}"
    return f"{tag} \u2013 {clean}" if clean else tag


def _thumb_path(video_path: Path) -> str | None:
    """Gibt relativen Pfad des Thumbnails zurück oder None."""
    key = hashlib.md5(str(video_path).encode()).hexdigest()
    thumb_dir = BASE_DIR / "api" / "thumbnails"
    for ext in (".jpg", ".png", ".webp"):
        t = thumb_dir / f"{key}{ext}"
        if t.exists():
            return f"api/thumbnails/{key}{ext}"
    # thumbnails.json als Fallback
    meta_file = BASE_DIR / "api" / "thumbnails.json"
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            rel  = str(video_path.relative_to(BASE_DIR)).replace("\\", "/")
            if rel in meta:
                return meta[rel]
        except Exception:
            pass
    return None


def _norm_path(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def is_within_path(path: Path, root: Path) -> bool:
    try:
        return os.path.commonpath([_norm_path(path), _norm_path(root)]) == _norm_path(root)
    except ValueError:
        return False


def is_public_static_path(rel_path: str) -> bool:
    rel = rel_path.replace("\\", "/").lstrip("/")
    if not rel:
        return False
    if rel in PUBLIC_ROOT_FILES:
        return True
    if any(rel.startswith(prefix) for prefix in PUBLIC_PREFIXES):
        parts = rel.split("/")
        if any(part.startswith(".") for part in parts):
            return False
        banned_names = {"server.js", "server.py", "package.json", "package-lock.json", "server-ws.log"}
        if any(part in banned_names for part in parts):
            return False
        if "node_modules" in parts:
            return False
        return True
    return False


def scan_library():
    library = {"movies": [], "series": {}, "music": [], "images": []}

    # Filme
    movies_dir = MEDIA_DIR / "Movies"
    if movies_dir.is_dir():
        for f in sorted(movies_dir.rglob("*")):
            if f.is_file() and f.suffix.lower() in VIDEO_EXT:
                rel = f.relative_to(MEDIA_DIR)
                thumb = _thumb_path(f)
                library["movies"].append({
                    "name":      f.name,
                    "path":      "media/" + str(rel).replace("\\", "/"),
                    "size":      f.stat().st_size,
                    "thumbnail": thumb,
                })

    # Serien
    series_dir = MEDIA_DIR / "Series"
    if series_dir.is_dir():
        all_eps: dict = {}
        for f in sorted(series_dir.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in VIDEO_EXT:
                continue
            rel   = f.relative_to(series_dir)
            parts = list(rel.parts)
            series_name, path_season = _guess_series_from_path(parts)
            ep_info = _detect_episode(f.name)
            if ep_info:
                season_num, ep_num = ep_info
            else:
                season_num = path_season
                ep_num     = 0
            display = _ep_title(f.name, season_num, ep_num)
            all_eps.setdefault(series_name, []).append({
                "name":    f.name,
                "display": display,
                "path":    "media/Series/" + str(f.relative_to(series_dir)).replace("\\", "/"),
                "size":    f.stat().st_size,
                "season":  season_num,
                "episode": ep_num,
                "thumbnail": _thumb_path(f),
            })
        for sname, eps in all_eps.items():
            eps.sort(key=lambda x: (x["season"], x["episode"]))
            by_season: dict = {}
            for ep in eps:
                key = f"S{ep['season']:02d}"
                by_season.setdefault(key, []).append(ep)
            library["series"][sname] = by_season

    # Musik
    music_dir = MEDIA_DIR / "Music"
    if music_dir.is_dir():
        for f in sorted(music_dir.rglob("*")):
            if f.is_file() and f.suffix.lower() in AUDIO_EXT:
                rel = f.relative_to(MEDIA_DIR)
                library["music"].append({
                    "name": f.name,
                    "path": "media/" + str(rel).replace("\\", "/"),
                    "size": f.stat().st_size,
                    "playlist": f.parent.name if f.parent != music_dir else "Alle Songs",
                })

    # Bilder
    images_dir = MEDIA_DIR / "Images"
    if images_dir.is_dir():
        for f in sorted(images_dir.rglob("*")):
            if f.is_file() and f.suffix.lower() in IMAGE_EXT:
                rel = f.relative_to(MEDIA_DIR)
                library["images"].append({
                    "name": f.name,
                    "path": "media/" + str(rel).replace("\\", "/"),
                    "size": f.stat().st_size,
                })

    return library


def get_cached_library():
    if CACHE_FILE.exists():
        age = time.time() - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL:
            try:
                data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
                if "data" in data:
                    return data["data"], True
            except Exception:
                pass
    lib = scan_library()
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps({"time": time.time(), "data": lib}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass
    return lib, False


def invalidate_cache():
    try:
        CACHE_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def try_real_qr(url: str, size: int):
    try:
        import qrcode  # type: ignore
        import qrcode.image.svg  # type: ignore
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10)
        buf = io.BytesIO(); img.save(buf); return buf.getvalue()
    except Exception:
        pass
    try:
        import qrcode  # type: ignore
        img = qrcode.make(url)
        buf = io.BytesIO(); img.save(buf, format="PNG"); return buf.getvalue()
    except Exception:
        return None


def make_qr_svg(text: str, size: int = 200) -> str:
    escaped = text.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}">'
            f'<rect width="{size}" height="{size}" fill="white"/>'
            f'<rect x="10" y="10" width="50" height="50" fill="black"/>'
            f'<rect x="16" y="16" width="38" height="38" fill="white"/>'
            f'<rect x="22" y="22" width="26" height="26" fill="black"/>'
            f'<text x="{size//2}" y="{size//2}" text-anchor="middle" font-size="9" '
            f'font-family="monospace" fill="#333">{escaped[:40]}</text></svg>')


# ─── Embedded WebSocket Chat ─────────────────────────────────────────────────
import hashlib as _hashlib
import base64 as _base64
import struct as _struct

_ws_clients = {}
_ws_history = []
_ws_lock    = threading.Lock()
_WS_MAX_HIST = 80
_ws_id_seq  = [0]

def _ws_gen_id():
    _ws_id_seq[0] += 1
    return f"c{_ws_id_seq[0]:08x}"

def _ws_pick_color(name):
    colors = ['#FFD700','#4ade80','#60a5fa','#f472b6','#fb923c','#a78bfa','#34d399','#f87171']
    h = 0
    for c in name: h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return colors[abs(h) % len(colors)]

def _ws_accept_key(key):
    magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    return _base64.b64encode(_hashlib.sha1((key + magic).encode()).digest()).decode()

def _ws_read_exact(rfile, n):
    buf = b''
    while len(buf) < n:
        chunk = rfile.read(n - len(buf))
        if not chunk: raise ConnectionError("ws closed")
        buf += chunk
    return buf

def _ws_recv_frame(rfile):
    h = _ws_read_exact(rfile, 2); b1, b2 = h[0], h[1]
    opcode = b1 & 0x0F; masked = (b2 & 0x80) != 0; ln = b2 & 0x7F
    if ln == 126: ln = _struct.unpack('>H', _ws_read_exact(rfile, 2))[0]
    elif ln == 127: ln = _struct.unpack('>Q', _ws_read_exact(rfile, 8))[0]
    mask = _ws_read_exact(rfile, 4) if masked else b''
    data = _ws_read_exact(rfile, ln)
    if masked: data = bytes(data[i] ^ mask[i % 4] for i in range(ln))
    return opcode, data

def _ws_send_frame(wfile, opcode, data):
    if isinstance(data, str): data = data.encode('utf-8')
    ln = len(data); hdr = bytearray([0x80 | opcode])
    if ln < 126: hdr.append(ln)
    elif ln < 65536: hdr += bytearray([126]) + _struct.pack('>H', ln)
    else: hdr += bytearray([127]) + _struct.pack('>Q', ln)
    try: wfile.write(bytes(hdr) + data); wfile.flush()
    except Exception: pass

def _ws_send(wfile, obj):
    _ws_send_frame(wfile, 0x1, json.dumps(obj, ensure_ascii=False))

def _ws_broadcast(obj, exclude=None):
    msg = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    with _ws_lock: clients = list(_ws_clients.values())
    for c in clients:
        if c['id'] == exclude: continue
        try: _ws_send_frame(c['wfile'], 0x1, msg)
        except Exception: pass

def _ws_send_to(cid, obj):
    with _ws_lock: c = _ws_clients.get(cid)
    if c:
        try: _ws_send(c['wfile'], obj)
        except Exception: pass

def _ws_users():
    with _ws_lock: lst = list(_ws_clients.values())
    return sorted(
        [{'id': c['id'], 'name': c['name'], 'color': c['color'], 'isVoice': c.get('isVoice', False)}
         for c in lst if c.get('name')],
        key=lambda u: u['name']
    )

def _ws_bcast_users():
    _ws_broadcast({'action': 'chat_users', 'users': _ws_users()})

def _ws_handle(cid, raw, wfile):
    try: d = json.loads(raw)
    except Exception: return
    act = d.get('action', '')
    if act == 'global_chat_join':
        name = str(d.get('name', '')).strip()[:24]
        if not name: return
        with _ws_lock:
            c = _ws_clients.get(cid)
            if not c: return
            was_named = bool(c.get('name'))
            c['name'] = name; c['color'] = _ws_pick_color(name)
            hist = list(_ws_history)
        _ws_send(wfile, {'action': 'global_chat_history', 'messages': hist})
        if not was_named:
            m = {'action': 'global_chat_message', 'name': '🔔 System',
                 'message': f'{name} ist beigetreten', 'color': '#666', 'ts': int(time.time()*1000)}
            with _ws_lock:
                _ws_history.append(m)
                if len(_ws_history) > _WS_MAX_HIST: _ws_history.pop(0)
            _ws_broadcast(m)
        _ws_bcast_users()
    elif act == 'global_chat':
        with _ws_lock:
            c = _ws_clients.get(cid)
            if not c or not c.get('name'): return
            name, color = c['name'], c['color']
        text = str(d.get('message', '')).strip()[:300]
        if not text: return
        m = {'action': 'global_chat_message', 'name': name, 'username': name,
             'message': text, 'color': color, 'ts': int(time.time()*1000)}
        with _ws_lock:
            _ws_history.append(m)
            if len(_ws_history) > _WS_MAX_HIST: _ws_history.pop(0)
        _ws_broadcast(m)
    elif act == 'typing':
        with _ws_lock:
            c = _ws_clients.get(cid)
            if not c or not c.get('name'): return
            name = c['name']
        _ws_broadcast({'action': 'typing', 'name': name}, exclude=cid)
    elif act == 'voice_join':
        with _ws_lock:
            c = _ws_clients.get(cid)
            if not c or not c.get('name'): return
            c['isVoice'] = True; name = c['name']
        peers = [u for u in _ws_users() if u.get('isVoice') and u['id'] != cid]
        _ws_send(wfile, {'action': 'voice_peers', 'peers': peers})
        _ws_broadcast({'action': 'voice_user_joined', 'user': {'id': cid, 'name': name}}, exclude=cid)
        _ws_bcast_users()
    elif act == 'voice_leave':
        with _ws_lock:
            c = _ws_clients.get(cid)
            if c: c['isVoice'] = False
        _ws_broadcast({'action': 'voice_user_left', 'userId': cid})
        _ws_bcast_users()
    elif act == 'voice_signal':
        with _ws_lock:
            c = _ws_clients.get(cid); fname = c['name'] if c else ''
        _ws_send_to(d.get('targetId', ''), {
            'action': 'voice_signal', 'fromId': cid, 'fromName': fname,
            'signalType': d.get('signalType', ''), 'payload': d.get('payload'),
        })


# ─── Request Handler ──────────────────────────────────────────────────────────

class MediaHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # silence normal request logs

    def log_error(self, fmt, *args):
        pass

    # ── WebSocket Upgrade ─────────────────────────────────────────────────────
    def _is_ws_upgrade(self):
        return (self.headers.get('Upgrade', '').lower() == 'websocket'
                and 'Sec-WebSocket-Key' in self.headers)

    def _handle_websocket(self):
        key = self.headers.get('Sec-WebSocket-Key', '').strip()
        accept = _ws_accept_key(key)
        self.send_response(101)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        self.end_headers()
        self.wfile.flush()

        cid = _ws_gen_id()
        with _ws_lock:
            _ws_clients[cid] = {'id': cid, 'name': '', 'color': '#FFD700',
                                 'isVoice': False, 'wfile': self.wfile}
        # send welcome
        _ws_send(self.wfile, {'action': 'welcome', 'id': cid})
        try:
            while True:
                opcode, data = _ws_recv_frame(self.rfile)
                if opcode == 0x8:  # close
                    break
                if opcode == 0x9:  # ping → pong
                    _ws_send_frame(self.wfile, 0xA, data)
                    continue
                if opcode in (0x1, 0x2):
                    _ws_handle(cid, data.decode('utf-8', errors='replace'), self.wfile)
        except Exception:
            pass
        finally:
            with _ws_lock:
                _ws_clients.pop(cid, None)
            _ws_broadcast({'action': 'voice_user_left', 'userId': cid})
            _ws_bcast_users()

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type",  "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, msg, code=400):
        self.send_json({"success": False, "error": msg}, code)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        # WebSocket upgrade intercept (chat on same port, any path)
        if self._is_ws_upgrade():
            self._handle_websocket()
            return

        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path.rstrip("/") or "/"
        query  = urllib.parse.parse_qs(parsed.query)

        routes = {
            "/api/library":      self._api_library,
            "/api/library.php":  self._api_library,
            "/api/qrcode-url":   self._api_qrcode_url,
            "/api/qrcode-url.php": self._api_qrcode_url,
            "/api/thumbnail":    self._api_thumbnail_list,
            "/api/thumbnail.php": self._api_thumbnail_list,
            "/api/trash":        self._api_trash_get,
            "/api/trash.php":    self._api_trash_get,
            "/api/music_meta":   self._api_music_meta_get,
            "/api/music_meta.php": self._api_music_meta_get,
            "/api/music-meta":   self._api_music_meta_get,
            "/api/image-meta":   self._api_get_image_meta,
        }

        if path in routes:
            routes[path]()
        elif path in ("/api/media", "/api/media.php"):
            self._api_media(query)
        elif path in ("/api/qrcode", "/api/qrcode.php"):
            self._api_qrcode(query)
        elif path.startswith("/api/thumbnail/") and not path.startswith("/api/thumbnails/"):
            self._api_thumbnail_file(path)
        elif path in ("/games/verify", "/games/verify.html") or path.startswith("/games/verify"):
            self._games_verify(query)
        else:
            self._serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path.rstrip("/") or "/"

        routes = {
            "/api/upload":          self._api_upload,
            "/api/upload.php":      self._api_upload,
            "/api/trash":           self._api_trash_post,
            "/api/trash.php":       self._api_trash_post,
            "/api/thumbnail":       self._api_thumbnail_upload,
            "/api/thumbnail.php":   self._api_thumbnail_upload,
            "/api/movie/thumbnail": self._api_save_thumbnail,
            "/api/delete":          self._api_delete,
            "/api/delete.php":      self._api_delete,
            "/api/image-meta":      self._api_save_image_meta,
            "/api/music_meta":      self._api_music_meta_post,
            "/api/music_meta.php":  self._api_music_meta_post,
            "/api/music-meta":      self._api_music_meta_post,
        }

        if path in routes:
            routes[path]()
        else:
            self.send_error_json(f"POST nicht gefunden: {path}", 404)

    # ── Library ───────────────────────────────────────────────────────────────
    def _api_library(self):
        try:
            lib, cached = get_cached_library()
            self.send_json({"success": True, "data": lib, "cached": cached})
        except Exception as e:
            self.send_json({
                "success": False, "error": str(e),
                "data": {"movies": [], "series": {}, "music": [], "images": []},
            }, 500)

    # ── Media Streaming (Range-Support) ───────────────────────────────────────
    def _api_media(self, query):
        file_param = query.get("file", [""])[0]
        if not file_param:
            self.send_error_json("file parameter missing"); return
        try:
            rel = Path(urllib.parse.unquote(file_param))
            file_path = (BASE_DIR / rel).resolve()
            if not is_within_path(file_path, MEDIA_DIR):
                raise ValueError("Path traversal")
        except Exception:
            self.send_error_json("Invalid path", 403); return

        if not file_path.exists() or not file_path.is_file():
            self.send_error_json("File not found", 404); return

        mime, _ = mimetypes.guess_type(str(file_path))
        mime     = mime or "application/octet-stream"
        size     = file_path.stat().st_size
        range_hdr = self.headers.get("Range")

        if range_hdr:
            m = re.match(r"bytes=(\d+)-(\d*)", range_hdr)
            if m:
                start = int(m.group(1))
                end   = int(m.group(2)) if m.group(2) else size - 1
                if end - start > 50 * 1024 * 1024:
                    end = start + 50 * 1024 * 1024 - 1
                end    = min(end, size - 1)
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type",   mime)
                self.send_header("Content-Range",  f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges",  "bytes")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control",  "public, max-age=31536000")
                self.end_headers()
                with open(file_path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk: break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
                return

        self.send_response(200)
        self.send_header("Content-Type",   mime)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges",  "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control",  "public, max-age=31536000")
        self.end_headers()
        with open(file_path, "rb") as f:
            shutil.copyfileobj(f, self.wfile)

    # ── QR-Code ───────────────────────────────────────────────────────────────
    def _api_qrcode(self, query):
        url  = query.get("url",  [""])[0]
        try:
            size = int(query.get("size", ["200"])[0])
        except (TypeError, ValueError):
            self.send_error_json("size must be integer", 400); return
        size = max(64, min(size, 1024))
        if not url:
            self.send_error_json("url missing"); return
        qr = try_real_qr(url, size)
        if qr:
            ct = "image/svg+xml" if qr[:5] in (b"<?xml", b"<svg ") else "image/png"
            self.send_response(200)
            self.send_header("Content-Type",   ct)
            self.send_header("Content-Length", str(len(qr)))
            self.end_headers()
            self.wfile.write(qr)
        else:
            self.send_json({
                "success": True,
                "qrcode": (f"https://api.qrserver.com/v1/create-qr-code/"
                           f"?size={size}x{size}&data={urllib.parse.quote(url)}"),
                "url": url,
            })

    def _api_qrcode_url(self):
        ip  = get_local_ip()
        url = f"http://{ip}:{PORT}/"
        self.send_json({"success": True, "url": url, "ip": ip, "port": PORT})

    # ── Thumbnails ────────────────────────────────────────────────────────────
    def _api_thumbnail_list(self):
        meta_file = BASE_DIR / "api" / "thumbnails.json"
        try:
            thumbs = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
            self.send_json({"success": True, "thumbnails": thumbs})
        except Exception as e:
            self.send_error_json(str(e), 500)

    def _api_thumbnail_file(self, path):
        encoded   = path[len("/api/thumbnail/"):]
        file_param = urllib.parse.unquote(encoded)
        try:
            rel = Path(file_param)
            file_path = (BASE_DIR / rel).resolve()
            if not str(file_path).startswith(str(BASE_DIR)):
                raise ValueError
        except Exception:
            self.send_error_json("Invalid path", 403); return

        key       = hashlib.md5(str(file_path).encode()).hexdigest()
        thumb_dir = BASE_DIR / "api" / "thumbnails"
        for ext in (".jpg", ".png", ".webp"):
            thumb = thumb_dir / f"{key}{ext}"
            if thumb.exists():
                mime, _ = mimetypes.guess_type(str(thumb))
                data = thumb.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type",   mime or "image/jpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control",  "public, max-age=86400")
                self.end_headers()
                self.wfile.write(data)
                return
        self.send_error_json("Not found", 404)

    def _api_thumbnail_upload(self):
        try:
            ct = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in ct:
                self.send_error_json("multipart required"); return
            length  = int(self.headers.get("Content-Length", 0))
            body    = self.rfile.read(length)
            bnd_m   = re.search(r"boundary=(.+?)(?:\s|$)", ct)
            if not bnd_m:
                self.send_error_json("No boundary"); return
            parts   = _parse_multipart(body, bnd_m.group(1).strip().strip('"'))
            media_path = (parts.get("media_path", {}).get("data", b"") or b"").decode(errors="replace").strip()
            thumb_data = parts.get("thumbnail", {}).get("data", b"")
            thumb_name = parts.get("thumbnail", {}).get("filename") or ""
            if not media_path or not thumb_data:
                self.send_error_json("Missing data"); return
            ext = (Path(thumb_name).suffix or ".jpg").lower()
            if ext not in (".jpg",".jpeg",".png",".gif",".webp"): ext = ".jpg"
            if ext == ".jpeg": ext = ".jpg"
            meta_file = BASE_DIR / "api" / "thumbnails.json"
            thumb_dir = BASE_DIR / "api" / "thumbnails"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            thumbs = {}
            if meta_file.exists():
                try: thumbs = json.loads(meta_file.read_text(encoding="utf-8"))
                except: pass
            if media_path in thumbs:
                old = BASE_DIR / thumbs[media_path].replace("/", os.sep)
                if old.exists(): old.unlink(missing_ok=True)
            fname  = hashlib.md5(media_path.encode()).hexdigest() + ext
            target = thumb_dir / fname
            target.write_bytes(thumb_data)
            rel_path = "api/thumbnails/" + fname
            thumbs[media_path] = rel_path
            meta_file.write_text(json.dumps(thumbs, ensure_ascii=False, indent=2), encoding="utf-8")
            self.send_json({"success": True, "path": rel_path})
        except Exception as e:
            self.send_error_json(str(e), 500)

    def _api_save_thumbnail(self):
        try:
            ct = self.headers.get("Content-Type","")
            if "multipart/form-data" not in ct:
                self.send_error_json("multipart required"); return
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length)
            bnd_m  = re.search(r"boundary=(.+)$", ct)
            if not bnd_m:
                self.send_error_json("No boundary"); return
            parts  = _parse_multipart(body, bnd_m.group(1).strip())
            raw    = (parts.get("video_path",{}).get("data",b"") or
                      parts.get("movie",{}).get("data",b"")).decode(errors="replace").strip()
            td     = parts.get("thumbnail",{}).get("data",b"")
            tm     = parts.get("thumbnail",{}).get("mime","image/jpeg")
            if not raw or not td:
                self.send_error_json("Missing data"); return
            ext = ".jpg" if "jpeg" in tm else ".png"
            try:
                fp = (BASE_DIR / Path(raw)).resolve()
                if not str(fp).startswith(str(BASE_DIR)): raise ValueError
            except:
                self.send_error_json("Invalid path", 403); return
            key = hashlib.md5(str(fp).encode()).hexdigest()
            (BASE_DIR / "api" / "thumbnails").mkdir(parents=True, exist_ok=True)
            (BASE_DIR / "api" / "thumbnails" / f"{key}{ext}").write_bytes(td)
            invalidate_cache()
            self.send_json({"success": True})
        except Exception as e:
            self.send_error_json(str(e), 500)

    # ── Papierkorb ────────────────────────────────────────────────────────────
    def _api_trash_get(self):
        meta_file = BASE_DIR / "api" / "trash_meta.json"
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
            cleaned = False
            for key in list(meta.keys()):
                tp = BASE_DIR / meta[key]["trashFile"].replace("/", os.sep)
                if not tp.exists():
                    del meta[key]; cleaned = True
            if cleaned:
                meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            self.send_json({"success": True, "items": list(meta.values())})
        except Exception as e:
            self.send_error_json(str(e), 500)

    def _api_trash_post(self):
        trash_dir = MEDIA_DIR / "Trash"
        meta_file = BASE_DIR / "api" / "trash_meta.json"
        trash_dir.mkdir(parents=True, exist_ok=True)
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length) if length else b"{}"
            data   = json.loads(body) if body else {}
        except Exception:
            self.send_error_json("JSON body required", 400); return

        action = data.get("action", "move")

        def load_meta():
            if meta_file.exists():
                try: return json.loads(meta_file.read_text(encoding="utf-8"))
                except: pass
            return {}

        def save_meta(m):
            meta_file.parent.mkdir(parents=True, exist_ok=True)
            meta_file.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")

        if action == "move":
            fp = (data.get("path") or "").strip()
            if not fp:
                self.send_error_json("Kein Pfad", 400); return
            full = (BASE_DIR / fp.replace("/", os.sep)).resolve()
            if not str(full).startswith(str(MEDIA_DIR)):
                self.send_error_json("Ungültiger Pfad", 400); return
            if not full.is_file():
                self.send_error_json("Datei nicht gefunden", 404); return
            name      = full.name
            trash_key = hashlib.md5((fp + str(time.time())).encode()).hexdigest()
            dest      = trash_dir / f"{trash_key}_{name}"
            try: shutil.move(str(full), str(dest))
            except Exception:
                shutil.copy2(str(full), str(dest)); full.unlink(missing_ok=True)
            meta = load_meta()
            meta[trash_key] = {
                "key": trash_key, "name": name, "origPath": fp.replace("\\","/"),
                "trashFile": f"media/Trash/{trash_key}_{name}",
                "size": dest.stat().st_size, "type": data.get("type","unknown"),
                "deletedAt": int(time.time()*1000),
            }
            save_meta(meta); invalidate_cache()
            self.send_json({"success": True, "key": trash_key}); return

        if action == "restore":
            key  = (data.get("key") or "").strip()
            meta = load_meta()
            if key not in meta:
                self.send_error_json("Nicht im Papierkorb", 404); return
            item = meta[key]
            tp   = BASE_DIR / item["trashFile"].replace("/", os.sep)
            orig = BASE_DIR / item["origPath"].replace("/", os.sep)
            if not tp.exists():
                del meta[key]; save_meta(meta)
                self.send_error_json("Datei nicht gefunden", 404); return
            orig.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(tp), str(orig))
            del meta[key]; save_meta(meta); invalidate_cache()
            self.send_json({"success": True}); return

        if action == "delete_perm":
            key  = (data.get("key") or "").strip()
            meta = load_meta()
            if key not in meta:
                self.send_error_json("Nicht im Papierkorb", 404); return
            tp = BASE_DIR / meta[key]["trashFile"].replace("/", os.sep)
            if tp.exists():
                try: tp.unlink()
                except PermissionError:
                    self.send_error_json("Datei gesperrt", 500); return
                except Exception as e:
                    self.send_error_json(str(e), 500); return
            del meta[key]; save_meta(meta); invalidate_cache()
            self.send_json({"success": True}); return

        if action == "empty":
            meta = load_meta()
            deleted = failed = 0
            for key, item in list(meta.items()):
                tp = BASE_DIR / item["trashFile"].replace("/", os.sep)
                if tp.exists():
                    try: tp.unlink(); deleted += 1
                    except: failed += 1
                else: deleted += 1
                del meta[key]
            save_meta(meta)
            self.send_json({"success": True, "deleted": deleted, "failed": failed}); return

        if action == "move_series":
            sname  = (data.get("series") or "").strip()
            sdir   = (MEDIA_DIR / "Series" / sname).resolve()
            if not is_within_path(sdir, MEDIA_DIR / "Series"):
                self.send_error_json("Ungueltiger Serienpfad", 400); return
            if not sdir.is_dir():
                self.send_error_json("Serienordner nicht gefunden", 404); return
            meta = load_meta(); moved = 0
            for f in sdir.rglob("*"):
                if not f.is_file() or f.suffix.lower() not in VIDEO_EXT: continue
                rel = f.relative_to(BASE_DIR).as_posix()
                tk  = hashlib.md5((rel+str(time.time())+str(moved)).encode()).hexdigest()
                dst = trash_dir / f"{tk}_{f.name}"
                try: shutil.move(str(f), str(dst))
                except Exception:
                    try: shutil.copy2(str(f), str(dst)); f.unlink(missing_ok=True)
                    except: continue
                meta[tk] = {"key":tk,"name":f.name,"origPath":rel,
                    "trashFile":f"media/Trash/{tk}_{f.name}",
                    "size":dst.stat().st_size,"type":"series","seriesName":sname,
                    "deletedAt":int(time.time()*1000)}
                moved += 1
            save_meta(meta)
            for d in sorted(sdir.rglob("*"),reverse=True):
                if d.is_dir():
                    try: d.rmdir()
                    except: pass
            try: sdir.rmdir()
            except: pass
            invalidate_cache()
            self.send_json({"success":True,"moved":moved,"series":sname}); return

        self.send_error_json("Unbekannte Aktion", 400)

    # ── Musik-Metadaten ───────────────────────────────────────────────────────
    def _api_music_meta_get(self):
        meta_file = BASE_DIR / "api" / "music_meta.json"
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
            self.send_json({"success": True, "data": data})
        except Exception as e:
            self.send_error_json(str(e), 500)

    def _api_music_meta_post(self):
        meta_file = BASE_DIR / "api" / "music_meta.json"
        meta_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body) if body else {}
            incoming = payload.get("data", payload)
            if not isinstance(incoming, dict):
                self.send_error_json("data must be object", 400); return
            existing = {}
            if meta_file.exists():
                try: existing = json.loads(meta_file.read_text(encoding="utf-8"))
                except: pass
            existing.update(incoming)
            meta_file.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
            self.send_json({"success": True})
        except Exception as e:
            self.send_error_json(str(e), 500)

    # ── Bildmetadaten ─────────────────────────────────────────────────────────
    def _api_get_image_meta(self):
        meta_file = BASE_DIR / "api" / "image_metadata.json"
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
            self.send_json({"success": True, "data": data})
        except Exception as e:
            self.send_error_json(str(e), 500)

    def _api_save_image_meta(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length) if length else b""
            req    = json.loads(body)
            path_key = req.get("path","").strip()
            title    = req.get("title","").strip()[:200]
            desc     = req.get("description","").strip()[:1000]
            if not path_key:
                self.send_error_json("path required"); return
            meta_file = BASE_DIR / "api" / "image_metadata.json"
            meta_file.parent.mkdir(parents=True, exist_ok=True)
            try: meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
            except: meta = {}
            if title or desc:
                meta[path_key] = {"title": title, "description": desc}
            else:
                meta.pop(path_key, None)
            meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            self.send_json({"success": True})
        except Exception as e:
            self.send_error_json(str(e), 500)

    # ── Upload ────────────────────────────────────────────────────────────────
    def _api_upload(self):
        try:
            ct = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in ct:
                self.send_error_json("multipart required"); return
            bnd_m = re.search(r"boundary=(.+?)(?:\s*$|;)", ct)
            if not bnd_m:
                self.send_error_json("No boundary"); return
            boundary    = bnd_m.group(1).strip().encode()
            total_len   = int(self.headers.get("Content-Length", 0))
            if total_len <= 0:
                self.send_error_json("Content-Length missing"); return

            CHUNK = 1024 * 1024
            header_buf = b""
            while len(header_buf) < 8192:
                c = self.rfile.read(1)
                if not c: break
                header_buf += c
                if b"\r\n\r\n" in header_buf: break

            disp_m = re.search(rb'filename="([^"]+)"', header_buf)
            if not disp_m:
                self.send_error_json("No filename"); return

            filename = disp_m.group(1).decode(errors="replace")
            filename = Path(filename).name
            ext      = Path(filename).suffix.lower()

            if ext in VIDEO_EXT:
                ep = _detect_episode(filename)
                if ep:
                    s, e_ = ep
                    stem  = re.sub(
                        r"[Ss]\d{1,2}[Ee]\d{1,3}|\d{1,2}[xX]\d{1,3}|[EeSs]\d{1,2}[Ff]\d{1,3}|"
                        r"[Ee][Pp]\.?\s*\d+|(?:[Ee]pisode|[Ff]olge)[_\s]\d+", "", Path(filename).stem
                    ).strip(" -_.")
                    sname  = _clean_name(stem) or "Unbekannt"
                    dest   = MEDIA_DIR / "Series" / sname / f"S{s:02d}" / filename
                    ftype  = "series"
                else:
                    dest  = MEDIA_DIR / "Movies" / filename
                    ftype = "video"
            elif ext in AUDIO_EXT:
                dest  = MEDIA_DIR / "Music"  / filename; ftype = "audio"
            elif ext in IMAGE_EXT:
                dest  = MEDIA_DIR / "Images" / filename; ftype = "image"
            elif ext in TEXT_EXT:
                dest  = MEDIA_DIR / filename; ftype = "text"
            else:
                self.send_error_json(f"Format nicht unterstützt: {ext}"); return

            dest.parent.mkdir(parents=True, exist_ok=True)
            end_marker = b"\r\n--" + boundary
            remaining  = total_len - len(header_buf)
            after      = header_buf.split(b"\r\n\r\n", 1)
            write_buf  = after[1] if len(after) > 1 else b""
            bytes_written = 0

            with open(dest, "wb") as fout:
                while True:
                    to_read = min(CHUNK, remaining)
                    if to_read <= 0: break
                    chunk = self.rfile.read(to_read)
                    if not chunk: break
                    remaining -= len(chunk)
                    write_buf += chunk
                    pos = write_buf.find(end_marker)
                    if pos != -1:
                        fout.write(write_buf[:pos]); bytes_written += pos; break
                    safe = len(write_buf) - len(end_marker)
                    if safe > 0:
                        fout.write(write_buf[:safe]); bytes_written += safe
                        write_buf = write_buf[safe:]

            invalidate_cache()
            self.send_json({"success": True, "file": filename, "size": bytes_written, "type": ftype})
        except Exception as e:
            self.send_error_json(str(e), 500)

    # ── Löschen ───────────────────────────────────────────────────────────────
    def _api_delete(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length) if length else b""
            data   = json.loads(body)
            fp     = data.get("file", "").strip()
            if not fp:
                self.send_error_json("file missing"); return
            try:
                full = (BASE_DIR / Path(fp)).resolve()
                if not str(full).lower().startswith(str(MEDIA_DIR).lower()):
                    raise ValueError("Outside media dir")
            except Exception as e:
                self.send_error_json(str(e), 403); return
            if not full.exists():
                self.send_error_json("Not found", 404); return
            full.unlink()
            key = hashlib.md5(str(full).encode()).hexdigest()
            for ext in (".jpg",".png",".webp"):
                t = BASE_DIR / "api" / "thumbnails" / f"{key}{ext}"
                if t.exists(): t.unlink()
            parent = full.parent
            for _ in range(3):
                if parent in (MEDIA_DIR, BASE_DIR): break
                try:
                    if not any(parent.iterdir()): parent.rmdir()
                except: break
                parent = parent.parent
            invalidate_cache()
            self.send_json({"success": True, "deleted": fp})
        except Exception as e:
            self.send_error_json(str(e), 500)

    # ── Games E-Mail-Verifizierung ────────────────────────────────────────────
    def _games_verify(self, query):
        token = (query.get("token") or [""])[0].strip()
        ok, msg = False, "Kein Token."
        try:
            games_dir = str(BASE_DIR / "games")
            if games_dir not in sys.path:
                sys.path.insert(0, games_dir)
            from auth import verify_token  # type: ignore
            ok, msg = verify_token(token)
        except Exception as e:
            msg = str(e)
        status = "✅ E-Mail bestätigt" if ok else "❌ Link ungültig"
        body_content = (
            "<h1 style='color:#2ecc71'>✅ Bestätigt!</h1><p>Du kannst dich jetzt anmelden.</p>"
            if ok else
            f"<h1 style='color:#e74c3c'>❌ Ungültig</h1><p>{html_escape(msg)}</p>"
        )
        html = (f'<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">'
                f'<meta name="viewport" content="width=device-width,initial-scale=1">'
                f'<title>{html_escape(status)}</title>'
                f'<style>body{{font-family:system-ui;background:#0a0a0a;color:#fff;'
                f'min-height:100vh;display:flex;align-items:center;justify-content:center}}'
                f'.box{{background:#1a1a2e;border:2px solid #FFD700;border-radius:16px;'
                f'padding:32px;text-align:center;max-width:360px}}'
                f'a{{color:#FFD700;font-weight:700}}</style></head>'
                f'<body><div class="box">{body_content}'
                f'<p style="margin-top:16px"><a href="/games/lobby.html">→ Zur Lobby</a></p>'
                f'</div></body></html>')
        enc = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type",   "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(enc)))
        self.end_headers()
        self.wfile.write(enc)

    # ── Statische Dateien ─────────────────────────────────────────────────────
    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        try:
            rel       = path.lstrip("/")
            file_path = (BASE_DIR / rel).resolve()
            if not is_within_path(file_path, BASE_DIR):
                self.send_error(403); return
        except Exception:
            self.send_error(400); return

        if not is_public_static_path(rel):
            self.send_error(403); return
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.exists():
            self.send_error(404); return

        mime, _ = mimetypes.guess_type(str(file_path))
        mime    = mime or "application/octet-stream"
        data    = file_path.read_bytes()

        self.send_response(200)
        self.send_header("Content-Type",   mime)
        self.send_header("Content-Length", str(len(data)))
        if mime == "text/html":
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            # Allow getUserMedia (microphone) over HTTP for LAN use (insecure origin bypass)
            self.send_header("Permissions-Policy", "microphone=*, camera=*")
            self.send_header("Feature-Policy",     "microphone 'self'; camera 'self'")
        elif mime.startswith(("image/","video/","audio/")):
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)


# ─── Multipart-Parser ────────────────────────────────────────────────────────

def _parse_multipart(body: bytes, boundary: str) -> dict:
    sep   = ("--" + boundary).encode()
    parts = {}
    for seg in body.split(sep):
        seg = seg.strip(b"\r\n")
        if not seg or seg in (b"--", ("--" + boundary + "--").encode()):
            continue
        if b"\r\n\r\n" not in seg:
            continue
        hdr_raw, content = seg.split(b"\r\n\r\n", 1)
        content     = content.rstrip(b"\r\n")
        headers_str = hdr_raw.decode(errors="replace")
        name_m  = re.search(r'name="([^"]+)"',     headers_str)
        fname_m = re.search(r'filename="([^"]+)"',  headers_str)
        ct_m    = re.search(r"Content-Type:\s*(.+)",headers_str, re.IGNORECASE)
        name = name_m.group(1) if name_m else "unknown"
        parts[name] = {
            "data":     content,
            "filename": fname_m.group(1) if fname_m else name,
            "mime":     ct_m.group(1).strip() if ct_m else "application/octet-stream",
        }
    return parts


# ─── Multiplayer WebSocket ────────────────────────────────────────────────────

_multiplayer_proc = None


def kill_pid(pid: int):
    if not pid or pid <= 0:
        return
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        except Exception:
            pass
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass


def kill_pid_file_target(pid_file: Path):
    try:
        if pid_file.exists():
            pid = int(pid_file.read_text(encoding="utf-8").strip())
            kill_pid(pid)
    except Exception:
        pass
    try:
        pid_file.unlink(missing_ok=True)
    except Exception:
        pass


def stop_multiplayer():
    global _multiplayer_proc
    if _multiplayer_proc and _multiplayer_proc.poll() is None:
        _multiplayer_proc.terminate()
        try:
            _multiplayer_proc.wait(timeout=3)
        except Exception:
            _multiplayer_proc.kill()
    _multiplayer_proc = None
    try:
        MULTIPLAYER_PID_FILE.unlink(missing_ok=True)
    except Exception:
        pass

def start_multiplayer():
    global _multiplayer_proc
    games_dir   = BASE_DIR / "games"
    node_server = games_dir / "server.js"
    py_server   = games_dir / "server.py"
    electron_node = os.environ.get("MEDIACENTER_NODE_RUNTIME", "").strip()

    kill_pid_file_target(MULTIPLAYER_PID_FILE)

    if electron_node and node_server.exists():
        try:
            env = os.environ.copy()
            env["ELECTRON_RUN_AS_NODE"] = "1"
            safe_print("  Multiplayer: Electron-Node (Port 8765)")
            _multiplayer_proc = subprocess.Popen(
                [electron_node, str(node_server)], cwd=str(games_dir),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
            )
            MULTIPLAYER_PID_FILE.write_text(str(_multiplayer_proc.pid), encoding="utf-8")
            return True
        except Exception:
            pass

    for node_cmd in ("node", "nodejs"):
        try:
            result = subprocess.run([node_cmd, "--version"], capture_output=True, timeout=3)
            if result.returncode == 0 and node_server.exists():
                safe_print("  Multiplayer: Node.js (Port 8765)")
                _multiplayer_proc = subprocess.Popen(
                    [node_cmd, str(node_server)], cwd=str(games_dir),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                MULTIPLAYER_PID_FILE.write_text(str(_multiplayer_proc.pid), encoding="utf-8")
                return True
        except Exception:
            pass

    if py_server.exists():
        try:
            safe_print("  Multiplayer: Python WebSocket (Port 8765)")
            _multiplayer_proc = subprocess.Popen(
                [sys.executable, str(py_server)], cwd=str(games_dir),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            MULTIPLAYER_PID_FILE.write_text(str(_multiplayer_proc.pid), encoding="utf-8")
            return True
        except Exception as e:
            safe_print(f"  Multiplayer nicht verfuegbar: {e}")
    return False


# ─── TCP-Server ──────────────────────────────────────────────────────────────

class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads      = True


def safe_print(text):
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"), flush=True)


def find_free_port(start=8080, tries=50):
    for i in range(tries):
        p = start + i
        try:
            with socket.socket() as s:
                s.bind(("", p)); return p
        except OSError:
            continue
    return start


def main():
    global PORT
    if len(sys.argv) >= 2:
        try: PORT = int(sys.argv[1])
        except ValueError: PORT = DEFAULT_PORT
    elif os.environ.get("MEDIACENTER_PORT"):
        try: PORT = int(os.environ["MEDIACENTER_PORT"])
        except ValueError: PORT = DEFAULT_PORT
    else:
        PORT = find_free_port(DEFAULT_PORT)

    # Port-Datei sofort schreiben
    try:
        (BASE_DIR / "server.port").write_text(str(PORT), encoding="utf-8")
    except Exception:
        pass

    # PID-Datei
    try:
        (BASE_DIR / "server.pid").write_text(str(os.getpid()), encoding="utf-8")
    except Exception:
        pass

    # Windows: UTF-8 Konsole
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ip = get_local_ip()
    safe_print("")
    safe_print("=" * 52)
    safe_print("   MediaCenter Portable Server v2.1")
    safe_print("=" * 52)
    safe_print(f"   Lokal:  http://localhost:{PORT}/")
    safe_print(f"   LAN:    http://{ip}:{PORT}/")
    safe_print(f"   Pfad:   {BASE_DIR}")
    safe_print("   Stop:   STRG+C")
    safe_print("=" * 52)
    safe_print("")

    atexit.register(stop_multiplayer)
    for sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if sig is None:
            continue
        try:
            signal.signal(sig, lambda *_: (stop_multiplayer(), sys.exit(0)))
        except Exception:
            pass

    start_multiplayer()

    with ThreadedServer((HOST, PORT), MediaHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            safe_print("\n  Server wird beendet...")
            safe_print("  Fertig.")
        finally:
            stop_multiplayer()


if __name__ == "__main__":
    main()
