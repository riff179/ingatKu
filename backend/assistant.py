"""Menjalankan perintah suara/teks terhadap database."""
from __future__ import annotations

import sqlite3
from datetime import date

import nlu
from db import add_history, schedule_to_dict, utc_stamp
from health_content import HEALTH_ARTICLES


def _greeting(user: sqlite3.Row | dict) -> str:
    first = str(user["name"]).split()[0] if str(user["name"]).strip() else ""
    return f"{user['salutation']} {first}".strip()


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def handle_text(conn: sqlite3.Connection, user: sqlite3.Row | dict, text: str,
                today: date, now_time: str) -> dict:
    g = _greeting(user)
    uid = user["id"]
    intent = nlu.parse_command(text, today)
    result = {"intent": intent.name, "transcript": text, "reply": "", "changed": False,
              "schedule": None, "schedules": []}

    if intent.name == "create":
        if not intent.time:
            result["reply"] = (f"Maaf {g}, jam berapa Anda ingin diingatkan? "
                               "Coba ucapkan lagi, misalnya: ingatkan saya minum obat jam 8 pagi.")
            result["intent"] = "need_time"
            return result
        day = intent.day or today
        if not intent.day_explicit and _minutes(intent.time) < _minutes(now_time):
            day = date.fromordinal(today.toordinal() + 1)  # jam hari ini sudah lewat -> besok
        cur = conn.execute(
            "INSERT INTO schedules (user_id, title, note, kind, date, time) VALUES (?, ?, '', ?, ?, ?)",
            (uid, intent.title[:80], intent.kind, day.isoformat(), intent.time),
        )
        sid = cur.lastrowid
        add_history(conn, uid, intent.title[:80], "dibuat", sid, "lewat perintah suara")
        row = conn.execute("SELECT * FROM schedules WHERE id = ?", (sid,)).fetchone()
        result["schedule"] = schedule_to_dict(row)
        result["changed"] = True
        result["reply"] = (f"Baik {g}, saya akan mengingatkan Anda {intent.title.lower()} "
                           f"{nlu.speak_time(intent.time)} {nlu.describe_day(day, today)}.")
        return result

    if intent.name == "list":
        day = intent.day or today
        rows = conn.execute(
            "SELECT * FROM schedules WHERE user_id = ? AND date = ? ORDER BY time, id",
            (uid, day.isoformat()),
        ).fetchall()
        items = [schedule_to_dict(r) for r in rows]
        result["schedules"] = items
        label = nlu.describe_day(day, today)
        if not items:
            result["reply"] = f"{g}, tidak ada jadwal untuk {label}."
        else:
            parts = []
            for it in items:
                part = f"{nlu.speak_time(it['time'])}, {it['title'].lower()}"
                if it["done"]:
                    part += " sudah selesai"
                parts.append(part)
            result["reply"] = f"{g}, jadwal {label} ada {len(items)} kegiatan. " + ". ".join(parts) + "."
        return result

    if intent.name == "done":
        rows = conn.execute(
            "SELECT * FROM schedules WHERE user_id = ? AND date = ? AND kind = 'obat' AND done = 0 ORDER BY time, id",
            (uid, today.isoformat()),
        ).fetchall()
        if not rows:
            result["reply"] = f"{g}, tidak ada jadwal obat yang belum selesai hari ini."
            return result
        now_m = _minutes(now_time)
        best = min(rows, key=lambda r: abs(_minutes(r["time"]) - now_m))
        stamp = utc_stamp()
        conn.execute("UPDATE schedules SET done = 1, done_at = ?, snooze_until = NULL WHERE id = ?",
                     (stamp, best["id"]))
        add_history(conn, uid, best["title"], "selesai", best["id"], "lewat perintah suara")
        row = conn.execute("SELECT * FROM schedules WHERE id = ?", (best["id"],)).fetchone()
        result["schedule"] = schedule_to_dict(row)
        result["changed"] = True
        result["reply"] = f"Bagus, {g}. {best['title']} pukul {best['time'].replace(':', '.')} sudah saya catat selesai."
        return result

    if intent.name == "tip":
        article = HEALTH_ARTICLES[today.timetuple().tm_yday % len(HEALTH_ARTICLES)]
        result["reply"] = (f"Tips kesehatan hari ini, {article['title']}. "
                           f"{article['body'][0]} {article['tips'][0]}")
        return result

    if intent.name == "help":
        result["reply"] = (f"{g}, Anda bisa mengatakan: " + "; ".join(nlu.EXAMPLES) + ".")
        return result

    result["intent"] = "unknown"
    result["reply"] = (f"Maaf {g}, saya belum mengerti. Coba katakan, misalnya: " + "; ".join(nlu.EXAMPLES) + ".")
    return result
