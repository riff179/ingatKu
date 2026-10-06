"""Uji integrasi API IngatKu. Jalankan:  python -m unittest discover -s tests -v   (dari folder backend)"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_tmp = tempfile.TemporaryDirectory()
os.environ["INGATKU_DATA_DIR"] = _tmp.name
os.environ["INGATKU_DB"] = str(Path(_tmp.name) / "test.db")
os.environ["INGATKU_QUIET"] = "1"
os.environ["INGATKU_SECRET"] = "rahasia-uji"

import server  # noqa: E402


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        _tmp.cleanup()

    def call(self, method, path, body=None, token=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", ctype)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req) as resp:
                payload = resp.read()
                return resp.status, (json.loads(payload) if resp.headers.get_content_type() == "application/json" else payload)
        except urllib.error.HTTPError as err:
            payload = err.read()
            try:
                return err.code, json.loads(payload)
            except json.JSONDecodeError:
                return err.code, payload

    def register(self, phone="081234500001", name="Budi Santoso", password="rahasia1", **extra):
        status, data = self.call("POST", "/api/auth/register",
                                 {"phone": phone, "name": name, "password": password, **extra})
        self.assertEqual(status, 201, data)
        return data["token"], data["user"]

    # ---------------------------------------------------------------- auth
    def test_register_login_and_me(self):
        token, user = self.register(phone="0812-3450-0002", salutation="Pak")
        self.assertEqual(user["phone"], "081234500002")
        self.assertEqual(user["greeting_name"], "Pak Budi")
        status, data = self.call("POST", "/api/auth/login", {"phone": "+6281234500002", "password": "rahasia1"})
        self.assertEqual(status, 200)
        status, data = self.call("GET", "/api/me", token=data["token"])
        self.assertEqual(data["user"]["name"], "Budi Santoso")

    def test_duplicate_wrong_password_and_validation(self):
        self.register(phone="081234500003")
        status, data = self.call("POST", "/api/auth/register",
                                 {"phone": "081234500003", "name": "Ani", "password": "rahasia1"})
        self.assertEqual(status, 409)
        status, _ = self.call("POST", "/api/auth/login", {"phone": "081234500003", "password": "salah-salah"})
        self.assertEqual(status, 401)
        status, data = self.call("POST", "/api/auth/register", {"phone": "123", "name": "Ani", "password": "rahasia1"})
        self.assertEqual((status, data.get("field")), (400, "phone"))
        status, data = self.call("POST", "/api/auth/register", {"phone": "081234500009", "name": "Ani", "password": "123"})
        self.assertEqual((status, data.get("field")), (400, "password"))

    def test_auth_required_and_bad_token(self):
        self.assertEqual(self.call("GET", "/api/me")[0], 401)
        self.assertEqual(self.call("GET", "/api/me", token="abc.def")[0], 401)
        self.assertEqual(self.call("GET", "/api/schedules")[0], 401)

    def test_update_profile_and_password(self):
        token, _ = self.register(phone="081234500004")
        status, data = self.call("PUT", "/api/me", {"name": "Siti Aminah", "salutation": "Bu", "age": 70}, token)
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["greeting_name"], "Bu Siti")
        self.assertEqual(self.call("PUT", "/api/me", {"age": 500}, token)[0], 400)
        self.assertEqual(self.call("POST", "/api/me/password", {"old_password": "x", "new_password": "baru-baru"}, token)[0], 400)
        self.assertEqual(self.call("POST", "/api/me/password", {"old_password": "rahasia1", "new_password": "baru-baru"}, token)[0], 200)
        self.assertEqual(self.call("POST", "/api/auth/login", {"phone": "081234500004", "password": "baru-baru"})[0], 200)

    # ---------------------------------------------------------------- jadwal
    def test_schedule_crud_and_ranges(self):
        token, _ = self.register(phone="081234500005")
        day = "2026-10-07"  # Rabu
        status, data = self.call("POST", "/api/schedules",
                                 {"title": "Minum Obat Pagi", "note": "Obat tekanan darah", "kind": "obat",
                                  "date": day, "time": "08:00"}, token)
        self.assertEqual(status, 201)
        sid = data["item"]["id"]
        self.call("POST", "/api/schedules", {"title": "Kontrol", "kind": "kontrol", "date": "2026-10-09", "time": "10:00"}, token)
        self.call("POST", "/api/schedules", {"title": "Janji", "kind": "janji", "date": "2026-10-20", "time": "15:00"}, token)

        _, d = self.call("GET", f"/api/schedules?date={day}&range=day", token=token)
        self.assertEqual([i["title"] for i in d["items"]], ["Minum Obat Pagi"])
        _, d = self.call("GET", f"/api/schedules?date={day}&range=week", token=token)
        self.assertEqual((d["start"], d["end"], len(d["items"])), ("2026-10-05", "2026-10-11", 2))
        _, d = self.call("GET", f"/api/schedules?date={day}&range=month", token=token)
        self.assertEqual((d["start"], d["end"], len(d["items"])), ("2026-10-01", "2026-10-31", 3))
        _, d = self.call("GET", "/api/schedules?date=2026-02-10&range=month", token=token)
        self.assertEqual(d["end"], "2026-02-28")

        status, data = self.call("PATCH", f"/api/schedules/{sid}", {"done": True}, token)
        self.assertTrue(data["item"]["done"])
        self.assertIsNotNone(data["item"]["done_at"])
        status, data = self.call("PATCH", f"/api/schedules/{sid}", {"done": False, "time": "09:00"}, token)
        self.assertEqual((data["item"]["done"], data["item"]["time"]), (False, "09:00"))
        self.assertEqual(self.call("PATCH", f"/api/schedules/{sid}", {"time": "25:00"}, token)[0], 400)
        self.assertEqual(self.call("DELETE", f"/api/schedules/{sid}", token=token)[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/schedules/{sid}", token=token)[0], 404)

    def test_schedule_validation(self):
        token, _ = self.register(phone="081234500006")
        base = {"title": "X", "kind": "obat", "date": "2026-10-07", "time": "08:00"}
        for bad in ({"title": ""}, {"kind": "lain"}, {"date": "2026-02-31"}, {"date": "07-10-2026"}, {"time": "8:00"}):
            status, _ = self.call("POST", "/api/schedules", {**base, **bad}, token)
            self.assertEqual(status, 400, bad)

    def test_isolation_between_users(self):
        t1, _ = self.register(phone="081234500007")
        t2, _ = self.register(phone="081234500008")
        _, d = self.call("POST", "/api/schedules", {"title": "Rahasia", "kind": "obat", "date": "2026-10-07", "time": "08:00"}, t1)
        sid = d["item"]["id"]
        self.assertEqual(self.call("PATCH", f"/api/schedules/{sid}", {"done": True}, t2)[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/schedules/{sid}", token=t2)[0], 404)
        _, d = self.call("GET", "/api/schedules?date=2026-10-07", token=t2)
        self.assertEqual(d["items"], [])

    def test_due_and_snooze(self):
        token, _ = self.register(phone="081234500010")
        _, d = self.call("POST", "/api/schedules", {"title": "Obat", "kind": "obat", "date": "2026-10-07", "time": "08:00"}, token)
        sid = d["item"]["id"]
        _, d = self.call("GET", "/api/reminders/due?date=2026-10-07&time=07:59", token=token)
        self.assertEqual(d["items"], [])
        _, d = self.call("GET", "/api/reminders/due?date=2026-10-07&time=08:00", token=token)
        self.assertEqual(len(d["items"]), 1)
        status, _ = self.call("POST", f"/api/schedules/{sid}/snooze", {"minutes": 10, "now": "2026-10-07T08:00"}, token)
        self.assertEqual(status, 200)
        _, d = self.call("GET", "/api/reminders/due?date=2026-10-07&time=08:09", token=token)
        self.assertEqual(d["items"], [])
        _, d = self.call("GET", "/api/reminders/due?date=2026-10-07&time=08:10", token=token)
        self.assertEqual(len(d["items"]), 1)
        self.assertEqual(self.call("POST", f"/api/schedules/{sid}/snooze", {"minutes": 0, "now": "2026-10-07T08:00"}, token)[0], 400)
        self.call("PATCH", f"/api/schedules/{sid}", {"done": True}, token)
        _, d = self.call("GET", "/api/reminders/due?date=2026-10-07&time=09:00", token=token)
        self.assertEqual(d["items"], [])
        # jadwal hari lain tidak muncul
        self.call("POST", "/api/schedules", {"title": "Kemarin", "kind": "obat", "date": "2026-10-06", "time": "08:00"}, token)
        _, d = self.call("GET", "/api/reminders/due?date=2026-10-07&time=12:00", token=token)
        self.assertEqual(d["items"], [])

    def test_history_settings_health(self):
        token, _ = self.register(phone="081234500011")
        _, d = self.call("POST", "/api/schedules", {"title": "Obat", "kind": "obat", "date": "2026-10-07", "time": "08:00"}, token)
        self.call("PATCH", f"/api/schedules/{d['item']['id']}", {"done": True}, token)
        _, h = self.call("GET", "/api/history", token=token)
        self.assertEqual([i["action"] for i in h["items"]], ["selesai", "dibuat"])
        self.assertEqual(h["stats"]["selesai_7_hari"], 1)
        _, s = self.call("GET", "/api/settings", token=token)
        self.assertTrue(s["settings"]["voice_reply"])
        _, s = self.call("PUT", "/api/settings", {"voice_reply": False, "speech_rate": 1.1}, token)
        self.assertEqual((s["settings"]["voice_reply"], s["settings"]["speech_rate"]), (False, 1.1))
        _, s = self.call("GET", "/api/settings", token=token)
        self.assertFalse(s["settings"]["voice_reply"])
        self.assertEqual(self.call("PUT", "/api/settings", {"speech_rate": 5}, token)[0], 400)
        self.assertEqual(self.call("PUT", "/api/settings", {"voice_reply": "ya"}, token)[0], 400)
        _, info = self.call("GET", "/api/health-info", token=token)
        self.assertGreaterEqual(len(info["items"]), 4)
        self.assertIn("disclaimer", info)

    # ---------------------------------------------------------------- suara
    def test_voice_commands(self):
        token, _ = self.register(phone="081234500012", name="Budi Santoso")
        today, now = "2026-10-07", "09:00"

        def cmd(text):
            status, data = self.call("POST", "/api/voice/command", {"text": text, "date": today, "time": now}, token)
            self.assertEqual(status, 200, data)
            return data

        r = cmd("Ingatkan saya minum obat jam 8 pagi")  # sudah lewat jam 09:00 -> besok
        self.assertEqual((r["intent"], r["schedule"]["date"], r["schedule"]["time"], r["schedule"]["kind"]),
                         ("create", "2026-10-08", "08:00", "obat"))
        self.assertIn("besok", r["reply"])
        r = cmd("ingatkan saya kontrol ke dokter hari ini jam 3 sore")
        self.assertEqual((r["schedule"]["date"], r["schedule"]["time"], r["schedule"]["kind"]), ("2026-10-07", "15:00", "kontrol"))
        r = cmd("ingatkan saya minum obat besok pagi")
        self.assertEqual((r["intent"], r["changed"]), ("need_time", False))
        r = cmd("Cek jadwal besok")
        self.assertEqual(len(r["schedules"]), 1)
        self.assertIn("Budi", r["reply"])
        r = cmd("cek jadwal lusa")
        self.assertIn("tidak ada jadwal", r["reply"])
        self.call("POST", "/api/schedules", {"title": "Minum Obat Siang", "kind": "obat", "date": today, "time": "12:00"}, token)
        r = cmd("sudah minum obat")
        self.assertEqual((r["intent"], r["schedule"]["done"], r["schedule"]["time"]), ("done", True, "12:00"))
        r = cmd("sudah minum obat")
        self.assertFalse(r["changed"])
        r = cmd("Putar berita hari ini")
        self.assertEqual(r["intent"], "tip")
        self.assertTrue(r["reply"].startswith("Tips kesehatan hari ini"))
        r = cmd("blablabla")
        self.assertEqual(r["intent"], "unknown")
        self.assertEqual(self.call("POST", "/api/voice/command", {"text": ""}, token)[0], 400)

    def test_voice_endpoints_without_models(self):
        token, _ = self.register(phone="081234500013")
        status, data = self.call("GET", "/api/voice/status")
        self.assertEqual(status, 200)
        self.assertEqual(set(data), {"stt", "tts", "tts_provider"})
        if not data["tts"]:
            self.assertEqual(self.call("POST", "/api/voice/tts", {"text": "Halo"}, token)[0], 501)
        if not data["stt"]:
            self.assertEqual(self.call("POST", "/api/voice/stt", raw=b"abc", ctype="audio/webm", token=token)[0], 501)
        self.assertEqual(self.call("POST", "/api/voice/stt", raw=b"abc", ctype="text/plain", token=token)[0], 415)

    # ---------------------------------------------------------------- data & statis
    def test_clear_data_and_delete_account(self):
        token, _ = self.register(phone="081234500014")
        self.call("POST", "/api/schedules", {"title": "A", "kind": "obat", "date": "2026-10-07", "time": "08:00"}, token)
        self.assertEqual(self.call("DELETE", "/api/me/data", token=token)[0], 200)
        _, d = self.call("GET", "/api/schedules?date=2026-10-07", token=token)
        self.assertEqual(d["items"], [])
        self.assertEqual(self.call("POST", "/api/me/delete", {"password": "salah"}, token)[0], 400)
        self.assertEqual(self.call("POST", "/api/me/delete", {"password": "rahasia1"}, token)[0], 200)
        self.assertEqual(self.call("GET", "/api/me", token=token)[0], 401)

    def test_static_files_and_errors(self):
        status, body = self.call("GET", "/")
        self.assertIn(status, (200, 404))  # 404 jika frontend belum ada
        self.assertEqual(self.call("GET", "/api/tidak-ada")[0], 404)
        self.assertEqual(self.call("GET", "/../backend/server.py")[0], 404)
        self.assertEqual(self.call("GET", "/%2e%2e/backend/server.py")[0], 404)
        self.assertEqual(self.call("POST", "/api/health-info", {})[0], 405)
        status, _ = self.call("POST", "/api/auth/register", raw=b"{bukan json", ctype="application/json")
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()


class VoiceHelperTests(unittest.TestCase):
    def test_split_sentences_pendek(self):
        import voice
        parts = voice.split_sentences("Halo Pak Budi. " + "kata " * 60 + "selesai!")
        self.assertGreaterEqual(len(parts), 3)
        self.assertTrue(all(len(p) <= 141 for p in parts))

    def test_clamp_rate(self):
        import voice
        self.assertEqual(voice.clamp_rate("abc"), 0.85)
        self.assertEqual(voice.clamp_rate(9), 1.3)
        self.assertEqual(voice.clamp_rate(0.1), 0.6)

    def test_tts_text_hanya_huruf(self):
        import voice
        self.assertEqual(voice._tts_text("Jam delapan, minum obat (Amlodipin)!"), "jam delapan, minum obat amlodipin !")
