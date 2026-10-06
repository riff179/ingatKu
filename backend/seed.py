"""Isi data contoh (akun Pak Budi + jadwal hari ini) agar tampilan sama seperti mockup.

Jalankan:  python seed.py
Akun demo: nomor HP 081234567890 / password ingatku123
"""
from __future__ import annotations

import db
import security

DEMO_PHONE = "081234567890"
DEMO_PASSWORD = "ingatku123"

DEMO_SCHEDULE = [
    ("Minum Obat Pagi", "Obat tekanan darah", "obat", "08:00", True),
    ("Kontrol Kesehatan", "Puskesmas Harapan Jaya", "kontrol", "10:00", False),
    ("Minum Obat Siang", "Obat vitamin", "obat", "12:00", False),
    ("Janji dengan Dokter", "RS Sehat Sentosa", "janji", "15:00", False),
    ("Minum Obat Malam", "Obat tekanan darah", "obat", "19:00", False),
]


def seed() -> None:
    db.init_db()
    today = db.local_now().date().isoformat()
    with db.get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE phone = ?", (DEMO_PHONE,)).fetchone()
        if user:
            uid = user["id"]
            conn.execute("DELETE FROM schedules WHERE user_id = ?", (uid,))
            conn.execute("DELETE FROM history WHERE user_id = ?", (uid,))
        else:
            salt, pw_hash = security.hash_password(DEMO_PASSWORD)
            uid = conn.execute(
                "INSERT INTO users (phone, name, salutation, age, pw_salt, pw_hash) VALUES (?, ?, 'Pak', 68, ?, ?)",
                (DEMO_PHONE, "Budi Santoso", salt, pw_hash),
            ).lastrowid
            conn.execute("INSERT INTO settings (user_id) VALUES (?)", (uid,))
        for title, note, kind, time_, done in DEMO_SCHEDULE:
            cur = conn.execute(
                "INSERT INTO schedules (user_id, title, note, kind, date, time, done, done_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (uid, title, note, kind, today, time_, int(done), db.utc_stamp() if done else None),
            )
            db.add_history(conn, uid, title, "selesai" if done else "dibuat", cur.lastrowid)
    print(f"Data contoh siap. Masuk dengan nomor {DEMO_PHONE} dan password {DEMO_PASSWORD}.")


if __name__ == "__main__":
    seed()
