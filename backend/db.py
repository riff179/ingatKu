"""Lapisan database SQLite (pustaka standar)."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    salutation  TEXT NOT NULL DEFAULT 'Pak' CHECK (salutation IN ('Pak', 'Bu')),
    age         INTEGER,
    pw_salt     TEXT NOT NULL,
    pw_hash     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS schedules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'lainnya' CHECK (kind IN ('obat', 'kontrol', 'janji', 'lainnya')),
    date         TEXT NOT NULL,
    time         TEXT NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    done_at      TEXT,
    snooze_until TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_schedules_user_date ON schedules (user_id, date, time);

CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('selesai', 'dibatalkan', 'ditunda', 'dibuat', 'dihapus', 'suara')),
    detail      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_history_user ON history (user_id, id DESC);

CREATE TABLE IF NOT EXISTS settings (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    voice_reply      INTEGER NOT NULL DEFAULT 1,
    reminder_sound   INTEGER NOT NULL DEFAULT 1,
    reminder_vibrate INTEGER NOT NULL DEFAULT 1,
    speech_rate      REAL    NOT NULL DEFAULT 0.85
);
"""


def db_path() -> Path:
    env = os.environ.get("INGATKU_DB")
    if env:
        path = Path(env)
    else:
        path = Path(os.environ.get("INGATKU_DATA_DIR", Path(__file__).resolve().parent / "data")) / "ingatku.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def get_db():
    conn = sqlite3.connect(db_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(SCHEMA)


def local_now() -> datetime:
    """Waktu lokal server (default WIB, UTC+7; ubah lewat INGATKU_TZ_OFFSET)."""
    offset = int(os.environ.get("INGATKU_TZ_OFFSET", "7"))
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=offset))).replace(tzinfo=None)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def add_history(conn: sqlite3.Connection, user_id: int, title: str, action: str,
                schedule_id: int | None = None, detail: str = "") -> None:
    conn.execute(
        "INSERT INTO history (user_id, schedule_id, title, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, schedule_id, title, action, detail, utc_stamp()),
    )


def schedule_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "note": row["note"],
        "kind": row["kind"],
        "date": row["date"],
        "time": row["time"],
        "done": bool(row["done"]),
        "done_at": row["done_at"],
        "snooze_until": row["snooze_until"],
    }
