"""Server IngatKu: API JSON + berkas frontend statis. Hanya memakai pustaka standar Python.

Jalankan:   python server.py            (http://localhost:8000)
Opsi env:   PORT, HOST, INGATKU_SECRET, INGATKU_DB, INGATKU_TZ_OFFSET, INGATKU_CORS
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import assistant
import db
import security
import voice
from health_content import DISCLAIMER, HEALTH_ARTICLES

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")

FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "frontend").resolve()
MAX_JSON_BYTES = 1 * 1024 * 1024
MAX_AUDIO_BYTES = 10 * 1024 * 1024
KINDS = ("obat", "kontrol", "janji", "lainnya")

PHONE_RE = re.compile(r"^(?:\+62|62|0)8[1-9][0-9]{6,11}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$")


# --------------------------------------------------------------------------- util

class ApiError(Exception):
    def __init__(self, status: int, message: str, field_name: str | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.field = field_name


@dataclass
class RawResponse:
    body: bytes
    content_type: str
    status: int = 200


@dataclass
class Request:
    handler: BaseHTTPRequestHandler
    args: tuple
    query: dict
    user: sqlite3.Row | None = None
    _json: dict | None = field(default=None, repr=False)

    def _read_body(self, limit: int) -> bytes:
        try:
            length = int(self.handler.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "Permintaan tidak valid.")
        if length < 0:
            raise ApiError(400, "Permintaan tidak valid.")
        if length > limit:
            raise ApiError(413, "Data terlalu besar.")
        return self.handler.rfile.read(length) if length else b""

    def json(self) -> dict:
        if self._json is None:
            raw = self._read_body(MAX_JSON_BYTES)
            if not raw:
                self._json = {}
            else:
                try:
                    data = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise ApiError(400, "Format data tidak valid.")
                if not isinstance(data, dict):
                    raise ApiError(400, "Format data tidak valid.")
                self._json = data
        return self._json

    def raw(self, limit: int = MAX_AUDIO_BYTES) -> bytes:
        return self._read_body(limit)

    def q(self, name: str, default: str | None = None) -> str | None:
        values = self.query.get(name)
        return values[0] if values else default


ROUTES: list[tuple[str, re.Pattern, callable, bool]] = []


def route(method: str, pattern: str, auth: bool = True):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn, auth))
        return fn
    return deco


def clean_text(value, field_name: str, label: str, min_len: int, max_len: int, allow_empty: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ApiError(400, f"{label} tidak valid.", field_name)
    value = " ".join(value.split())
    if allow_empty and not value:
        return ""
    if len(value) < min_len:
        raise ApiError(400, f"{label} wajib diisi.", field_name)
    if len(value) > max_len:
        raise ApiError(400, f"{label} terlalu panjang (maksimal {max_len} huruf).", field_name)
    return value


def normalize_phone(raw) -> str:
    p = re.sub(r"[\s\-().]", "", str(raw or ""))
    if not PHONE_RE.match(p):
        raise ApiError(400, "Nomor HP tidak valid. Contoh: 081234567890", "phone")
    if p.startswith("+62"):
        p = "0" + p[3:]
    elif p.startswith("62"):
        p = "0" + p[2:]
    return p


def check_password(pw, field_name: str = "password") -> str:
    if not isinstance(pw, str) or len(pw) < 6:
        raise ApiError(400, "Password minimal 6 karakter.", field_name)
    if len(pw) > 128:
        raise ApiError(400, "Password terlalu panjang.", field_name)
    return pw


def check_date(value, field_name: str = "date") -> str:
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ApiError(400, "Tanggal tidak valid.", field_name)
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ApiError(400, "Tanggal tidak valid.", field_name)
    return value


def check_time(value, field_name: str = "time") -> str:
    if not isinstance(value, str) or not TIME_RE.match(value):
        raise ApiError(400, "Jam tidak valid. Gunakan format 08:00.", field_name)
    return value


def check_kind(value) -> str:
    if value not in KINDS:
        raise ApiError(400, "Jenis jadwal tidak valid.", "kind")
    return value


def check_age(value):
    if value in (None, ""):
        return None
    try:
        age = int(value)
    except (TypeError, ValueError):
        raise ApiError(400, "Usia harus berupa angka.", "age")
    if not 1 <= age <= 120:
        raise ApiError(400, "Usia harus antara 1 dan 120.", "age")
    return age


def check_salutation(value) -> str:
    if value not in ("Pak", "Bu"):
        raise ApiError(400, "Sapaan harus Pak atau Bu.", "salutation")
    return value


def user_to_dict(row: sqlite3.Row) -> dict:
    first = row["name"].split()[0] if row["name"].strip() else ""
    return {
        "id": row["id"],
        "phone": row["phone"],
        "name": row["name"],
        "salutation": row["salutation"],
        "age": row["age"],
        "first_name": first,
        "greeting_name": f"{row['salutation']} {first}".strip(),
    }


SETTINGS_DEFAULT = {"voice_reply": True, "reminder_sound": True, "reminder_vibrate": True, "speech_rate": 0.85}


def settings_for(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute("SELECT * FROM settings WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return dict(SETTINGS_DEFAULT)
    return {
        "voice_reply": bool(row["voice_reply"]),
        "reminder_sound": bool(row["reminder_sound"]),
        "reminder_vibrate": bool(row["reminder_vibrate"]),
        "speech_rate": float(row["speech_rate"]),
    }


def get_owned_schedule(conn: sqlite3.Connection, user_id: int, schedule_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM schedules WHERE id = ? AND user_id = ?", (schedule_id, user_id)).fetchone()
    if not row:
        raise ApiError(404, "Jadwal tidak ditemukan.")
    return row


# --------------------------------------------------------------------------- auth

@route("POST", "/api/auth/register", auth=False)
def register(req: Request):
    body = req.json()
    name = clean_text(body.get("name"), "name", "Nama", 2, 60)
    phone = normalize_phone(body.get("phone"))
    password = check_password(body.get("password"))
    salutation = check_salutation(body.get("salutation", "Pak"))
    age = check_age(body.get("age"))
    salt, pw_hash = security.hash_password(password)
    with db.get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (phone, name, salutation, age, pw_salt, pw_hash) VALUES (?, ?, ?, ?, ?, ?)",
                (phone, name, salutation, age, salt, pw_hash),
            )
        except sqlite3.IntegrityError:
            raise ApiError(409, "Nomor HP ini sudah terdaftar. Silakan masuk.", "phone")
        uid = cur.lastrowid
        conn.execute("INSERT INTO settings (user_id) VALUES (?)", (uid,))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return 201, {"token": security.make_token(uid), "user": user_to_dict(row)}


@route("POST", "/api/auth/login", auth=False)
def login(req: Request):
    body = req.json()
    phone = normalize_phone(body.get("phone"))
    password = body.get("password")
    if not isinstance(password, str) or not password:
        raise ApiError(400, "Password wajib diisi.", "password")
    with db.get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    if not row or not security.verify_password(password, row["pw_salt"], row["pw_hash"]):
        raise ApiError(401, "Nomor HP atau password salah.")
    return {"token": security.make_token(row["id"]), "user": user_to_dict(row)}


# --------------------------------------------------------------------------- profil

@route("GET", "/api/me")
def get_me(req: Request):
    return {"user": user_to_dict(req.user)}


@route("PUT", "/api/me")
def update_me(req: Request):
    body = req.json()
    name = clean_text(body.get("name", req.user["name"]), "name", "Nama", 2, 60)
    salutation = check_salutation(body.get("salutation", req.user["salutation"]))
    age = check_age(body["age"]) if "age" in body else req.user["age"]
    with db.get_db() as conn:
        conn.execute("UPDATE users SET name = ?, salutation = ?, age = ? WHERE id = ?",
                     (name, salutation, age, req.user["id"]))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (req.user["id"],)).fetchone()
    return {"user": user_to_dict(row)}


@route("POST", "/api/me/password")
def change_password(req: Request):
    body = req.json()
    old = body.get("old_password")
    if not isinstance(old, str) or not security.verify_password(old, req.user["pw_salt"], req.user["pw_hash"]):
        raise ApiError(400, "Password lama salah.", "old_password")
    new = check_password(body.get("new_password"), "new_password")
    salt, pw_hash = security.hash_password(new)
    with db.get_db() as conn:
        conn.execute("UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?", (salt, pw_hash, req.user["id"]))
    return {"ok": True}


@route("DELETE", "/api/me/data")
def clear_data(req: Request):
    with db.get_db() as conn:
        conn.execute("DELETE FROM history WHERE user_id = ?", (req.user["id"],))
        conn.execute("DELETE FROM schedules WHERE user_id = ?", (req.user["id"],))
    return {"ok": True}


@route("POST", "/api/me/delete")
def delete_account(req: Request):
    body = req.json()
    pw = body.get("password")
    if not isinstance(pw, str) or not security.verify_password(pw, req.user["pw_salt"], req.user["pw_hash"]):
        raise ApiError(400, "Password salah.", "password")
    with db.get_db() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (req.user["id"],))
    return {"ok": True}


@route("GET", "/api/settings")
def get_settings(req: Request):
    with db.get_db() as conn:
        return {"settings": settings_for(conn, req.user["id"])}


@route("PUT", "/api/settings")
def update_settings(req: Request):
    body = req.json()
    with db.get_db() as conn:
        current = settings_for(conn, req.user["id"])
        for key in ("voice_reply", "reminder_sound", "reminder_vibrate"):
            if key in body:
                if not isinstance(body[key], bool):
                    raise ApiError(400, "Pengaturan tidak valid.", key)
                current[key] = body[key]
        if "speech_rate" in body:
            try:
                rate = float(body["speech_rate"])
            except (TypeError, ValueError):
                raise ApiError(400, "Kecepatan suara tidak valid.", "speech_rate")
            if not 0.6 <= rate <= 1.3:
                raise ApiError(400, "Kecepatan suara harus antara 0.6 dan 1.3.", "speech_rate")
            current["speech_rate"] = rate
        conn.execute(
            "INSERT INTO settings (user_id, voice_reply, reminder_sound, reminder_vibrate, speech_rate) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET "
            "voice_reply = excluded.voice_reply, reminder_sound = excluded.reminder_sound, "
            "reminder_vibrate = excluded.reminder_vibrate, speech_rate = excluded.speech_rate",
            (req.user["id"], int(current["voice_reply"]), int(current["reminder_sound"]),
             int(current["reminder_vibrate"]), current["speech_rate"]),
        )
    return {"settings": current}


# --------------------------------------------------------------------------- jadwal

def _range_bounds(day: date, rng: str) -> tuple[date, date]:
    if rng == "day":
        return day, day
    if rng == "week":
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    if rng == "month":
        start = day.replace(day=1)
        nxt = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return start, nxt - timedelta(days=1)
    raise ApiError(400, "Rentang tidak valid.", "range")


@route("GET", "/api/schedules")
def list_schedules(req: Request):
    day_s = req.q("date") or db.local_now().date().isoformat()
    day = datetime.strptime(check_date(day_s), "%Y-%m-%d").date()
    rng = req.q("range", "day")
    start, end = _range_bounds(day, rng)
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM schedules WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, time, id",
            (req.user["id"], start.isoformat(), end.isoformat()),
        ).fetchall()
    return {"range": rng, "start": start.isoformat(), "end": end.isoformat(),
            "items": [db.schedule_to_dict(r) for r in rows]}


@route("POST", "/api/schedules")
def create_schedule(req: Request):
    body = req.json()
    title = clean_text(body.get("title"), "title", "Judul", 1, 80)
    note = clean_text(body.get("note"), "note", "Keterangan", 0, 120, allow_empty=True)
    kind = check_kind(body.get("kind", "lainnya"))
    day = check_date(body.get("date"))
    time_ = check_time(body.get("time"))
    with db.get_db() as conn:
        cur = conn.execute(
            "INSERT INTO schedules (user_id, title, note, kind, date, time) VALUES (?, ?, ?, ?, ?, ?)",
            (req.user["id"], title, note, kind, day, time_),
        )
        db.add_history(conn, req.user["id"], title, "dibuat", cur.lastrowid)
        row = conn.execute("SELECT * FROM schedules WHERE id = ?", (cur.lastrowid,)).fetchone()
    return 201, {"item": db.schedule_to_dict(row)}


@route("PATCH", r"/api/schedules/(\d+)")
def update_schedule(req: Request):
    sid = int(req.args[0])
    body = req.json()
    with db.get_db() as conn:
        row = get_owned_schedule(conn, req.user["id"], sid)
        title = clean_text(body["title"], "title", "Judul", 1, 80) if "title" in body else row["title"]
        note = clean_text(body["note"], "note", "Keterangan", 0, 120, allow_empty=True) if "note" in body else row["note"]
        kind = check_kind(body["kind"]) if "kind" in body else row["kind"]
        day = check_date(body["date"]) if "date" in body else row["date"]
        time_ = check_time(body["time"]) if "time" in body else row["time"]
        done, done_at, snooze = row["done"], row["done_at"], row["snooze_until"]
        if "done" in body:
            if not isinstance(body["done"], bool):
                raise ApiError(400, "Status tidak valid.", "done")
            if body["done"] != bool(row["done"]):
                done = int(body["done"])
                done_at = db.utc_stamp() if done else None
                db.add_history(conn, req.user["id"], title, "selesai" if done else "dibatalkan", sid)
            if done:
                snooze = None
        if day != row["date"] or time_ != row["time"]:
            snooze = None
        conn.execute(
            "UPDATE schedules SET title = ?, note = ?, kind = ?, date = ?, time = ?, done = ?, done_at = ?, "
            "snooze_until = ? WHERE id = ?",
            (title, note, kind, day, time_, done, done_at, snooze, sid),
        )
        row = conn.execute("SELECT * FROM schedules WHERE id = ?", (sid,)).fetchone()
    return {"item": db.schedule_to_dict(row)}


@route("DELETE", r"/api/schedules/(\d+)")
def delete_schedule(req: Request):
    sid = int(req.args[0])
    with db.get_db() as conn:
        row = get_owned_schedule(conn, req.user["id"], sid)
        db.add_history(conn, req.user["id"], row["title"], "dihapus", sid)
        conn.execute("DELETE FROM schedules WHERE id = ?", (sid,))
    return {"ok": True}


@route("POST", r"/api/schedules/(\d+)/snooze")
def snooze_schedule(req: Request):
    sid = int(req.args[0])
    body = req.json()
    try:
        minutes = int(body.get("minutes", 10))
    except (TypeError, ValueError):
        raise ApiError(400, "Lama tunda tidak valid.", "minutes")
    if not 1 <= minutes <= 120:
        raise ApiError(400, "Lama tunda harus antara 1 dan 120 menit.", "minutes")
    now_s = body.get("now")
    if not isinstance(now_s, str) or not STAMP_RE.match(now_s):
        raise ApiError(400, "Waktu sekarang tidak valid.", "now")
    try:
        base = datetime.strptime(now_s, "%Y-%m-%dT%H:%M")
    except ValueError:
        raise ApiError(400, "Waktu sekarang tidak valid.", "now")
    until = (base + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M")
    with db.get_db() as conn:
        row = get_owned_schedule(conn, req.user["id"], sid)
        conn.execute("UPDATE schedules SET snooze_until = ? WHERE id = ?", (until, sid))
        db.add_history(conn, req.user["id"], row["title"], "ditunda", sid, f"{minutes} menit")
        row = conn.execute("SELECT * FROM schedules WHERE id = ?", (sid,)).fetchone()
    return {"item": db.schedule_to_dict(row)}


@route("GET", "/api/reminders/due")
def due_reminders(req: Request):
    day = check_date(req.q("date"))
    time_ = check_time(req.q("time"))
    now_stamp = f"{day}T{time_}"
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM schedules WHERE user_id = ? AND date = ? AND time <= ? AND done = 0 "
            "AND (snooze_until IS NULL OR snooze_until <= ?) ORDER BY time, id",
            (req.user["id"], day, time_, now_stamp),
        ).fetchall()
    return {"items": [db.schedule_to_dict(r) for r in rows]}


# --------------------------------------------------------------------------- riwayat & info

@route("GET", "/api/history")
def history(req: Request):
    try:
        limit = max(1, min(200, int(req.q("limit", "50"))))
        offset = max(0, int(req.q("offset", "0")))
    except ValueError:
        raise ApiError(400, "Parameter tidak valid.")
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, schedule_id, title, action, detail, created_at FROM history "
            "WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (req.user["id"], limit, offset),
        ).fetchall()
        done_week = conn.execute(
            "SELECT COUNT(*) FROM history WHERE user_id = ? AND action = 'selesai' AND created_at >= ?",
            (req.user["id"], week_ago),
        ).fetchone()[0]
    return {"items": [dict(r) for r in rows], "stats": {"selesai_7_hari": done_week}}


@route("GET", "/api/health-info")
def health_info(req: Request):
    return {"items": HEALTH_ARTICLES, "disclaimer": DISCLAIMER}


# --------------------------------------------------------------------------- suara

@route("GET", "/api/voice/status", auth=False)
def voice_status(req: Request):
    return {"stt": voice.stt_available(), "tts": voice.tts_available(), "tts_provider": voice.tts_provider()}


@route("POST", "/api/voice/stt")
def voice_stt(req: Request):
    ctype = (req.handler.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    suffix = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3",
              "audio/wav": ".wav", "audio/x-wav": ".wav"}.get(ctype)
    if suffix is None:
        raise ApiError(415, "Format audio tidak didukung.")
    audio = req.raw()
    if not audio:
        raise ApiError(400, "Audio kosong.")
    try:
        text = voice.transcribe(audio, suffix)
    except voice.VoiceUnavailable as exc:
        raise ApiError(501, str(exc))
    return {"text": text}


@route("POST", "/api/voice/tts")
def voice_tts(req: Request):
    body = req.json()
    text = clean_text(body.get("text"), "text", "Teks", 1, 1200)
    rate = voice.clamp_rate(body.get("rate", 0.85))
    try:
        audio, mime = voice.synthesize_audio(text, rate)
    except voice.VoiceUnavailable as exc:
        raise ApiError(501, str(exc))
    return RawResponse(audio, mime)


@route("POST", "/api/voice/command")
def voice_command(req: Request):
    body = req.json()
    text = clean_text(body.get("text"), "text", "Perintah", 1, 300)
    now = db.local_now()
    today = datetime.strptime(check_date(body["date"]), "%Y-%m-%d").date() if body.get("date") else now.date()
    now_time = check_time(body["time"]) if body.get("time") else now.strftime("%H:%M")
    with db.get_db() as conn:
        result = assistant.handle_text(conn, req.user, text, today, now_time)
    return result


# --------------------------------------------------------------------------- HTTP handler

class Handler(BaseHTTPRequestHandler):
    server_version = "IngatKu/1.0"

    def log_message(self, fmt, *args):  # log ringkas ke stderr
        if os.environ.get("INGATKU_QUIET"):
            return
        super().log_message(fmt, *args)

    # --- util respons
    def _cors(self):
        origin = os.environ.get("INGATKU_CORS")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None, head: bool = False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self._cors()
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    # --- dispatch
    def _dispatch(self, method: str):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path.startswith("/api/") or path == "/api":
                self._handle_api(method, path, parse_qs(parsed.query))
            elif method in ("GET", "HEAD"):
                self._serve_static(path, head=(method == "HEAD"))
            else:
                self._send_json(405, {"error": "Metode tidak diizinkan."})
        except ApiError as exc:
            payload = {"error": exc.message}
            if exc.field:
                payload["field"] = exc.field
            self._send_json(exc.status, payload)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # jangan bocorkan detail ke klien
            self.log_error("Kesalahan tak terduga: %r", exc)
            try:
                self._send_json(500, {"error": "Terjadi kesalahan di server. Coba lagi."})
            except Exception:
                pass

    def _handle_api(self, method: str, path: str, query: dict):
        path_matched = False
        for r_method, pattern, fn, needs_auth in ROUTES:
            m = pattern.match(path)
            if not m:
                continue
            path_matched = True
            if r_method != method:
                continue
            req = Request(handler=self, args=m.groups(), query=query)
            if needs_auth:
                req.user = self._authenticate()
            result = fn(req)
            if isinstance(result, RawResponse):
                self._send(result.status, result.body, result.content_type, {"Cache-Control": "no-store"})
            elif isinstance(result, tuple):
                self._send_json(result[0], result[1])
            else:
                self._send_json(200, result)
            return
        if path_matched:
            raise ApiError(405, "Metode tidak diizinkan.")
        raise ApiError(404, "Alamat API tidak ditemukan.")

    def _authenticate(self) -> sqlite3.Row:
        header = self.headers.get("Authorization") or ""
        if not header.startswith("Bearer "):
            raise ApiError(401, "Silakan masuk terlebih dahulu.")
        uid = security.verify_token(header[7:].strip())
        if uid is None:
            raise ApiError(401, "Sesi berakhir. Silakan masuk kembali.")
        with db.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not row:
            raise ApiError(401, "Akun tidak ditemukan. Silakan masuk kembali.")
        return row

    def _serve_static(self, path: str, head: bool = False):
        rel = unquote(path).lstrip("/") or "index.html"
        target = (FRONTEND_DIR / rel).resolve()
        if target != FRONTEND_DIR and FRONTEND_DIR not in target.parents:
            raise ApiError(404, "Tidak ditemukan.")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            raise ApiError(404, "Tidak ditemukan.")
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"}, head=head)

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()


def make_server(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    db.init_db()
    ThreadingHTTPServer.daemon_threads = True
    return ThreadingHTTPServer((host, port), Handler)


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = make_server(host, port)
    print(f"IngatKu berjalan di http://{host if host != '0.0.0.0' else 'localhost'}:{port}  (Ctrl+C untuk berhenti)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
