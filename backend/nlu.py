"""Pemahaman perintah suara Bahasa Indonesia berbasis aturan (tanpa model tambahan).

Contoh perintah yang dipahami:
  - "Ingatkan saya minum obat jam 8 pagi"      -> membuat pengingat
  - "Cek jadwal besok"                          -> membacakan jadwal
  - "Sudah minum obat"                          -> menandai obat selesai
  - "Putar berita hari ini"                     -> membacakan tips kesehatan hari ini
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

DAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
               "September", "Oktober", "November", "Desember"]

_NUM_WORDS = {
    "satu": 1, "dua": 2, "tiga": 3, "empat": 4, "lima": 5, "enam": 6, "tujuh": 7,
    "delapan": 8, "sembilan": 9, "sepuluh": 10, "sebelas": 11, "dua belas": 12,
}
_NUM_ALT = "|".join(sorted((re.escape(w) for w in _NUM_WORDS), key=len, reverse=True))
_NUM_WORD_RE = re.compile(rf"\b(jam|pukul|setengah)\s+({_NUM_ALT})\b")

_TIME_RE = re.compile(r"\b(?:jam|pukul)\s+(\d{1,2})(?:[.:](\d{2}))?(?:\s*(pagi|siang|sore|malam))?")
_HALF_RE = re.compile(r"\b(?:jam|pukul)\s+setengah\s+(\d{1,2})(?:\s*(pagi|siang|sore|malam))?")
_WEEKDAYS = {"senin": 0, "selasa": 1, "rabu": 2, "kamis": 3, "jumat": 4, "sabtu": 5}
_WEEKDAY_RE = re.compile(r"\b(?:hari\s+)?(senin|selasa|rabu|kamis|jumat|sabtu)\b|\bhari\s+minggu\b")

_CREATE_RE = re.compile(r"\b(ingatkan|ingetin|ingatin|pengingat|tambah(?:kan)?\s+jadwal|buat(?:kan)?\s+jadwal|catat\s+jadwal)\b")
_LIST_RE = re.compile(r"\b(jadwal|agenda)\b")
_LIST_VERB_RE = re.compile(r"\b(cek|lihat|apa|ada|tampilkan|baca|bacakan|beritahu|sebutkan)\b")
_DONE_RE = re.compile(r"\b(sudah|udah|telah)\b.*\b(minum|makan)\b|\btandai\s+selesai\b")
_TIP_RE = re.compile(r"\b(berita|informasi\s+kesehatan|tips?\s+kesehatan|kabar)\b")
_HELP_RE = re.compile(r"\b(bantuan|tolong\s+saya|bisa\s+apa|apa\s+saja)\b")

EXAMPLES = [
    "Ingatkan saya minum obat jam 8 pagi",
    "Cek jadwal besok",
    "Putar berita hari ini",
]


@dataclass
class Intent:
    name: str                      # create | list | done | tip | help | unknown
    title: str = ""
    kind: str = "lainnya"
    day: date | None = None
    time: str | None = None        # "HH:MM"
    day_explicit: bool = False


def normalize(text: str) -> str:
    t = (text or "").lower().strip()
    t = t.replace("jum'at", "jumat").replace("jum’at", "jumat")
    t = re.sub(r"[^\w\s.:]", " ", t)           # buang tanda baca selain titik/titik dua
    t = re.sub(r"(?<!\d)[.:]|[.:](?!\d)", " ", t)  # titik/titik dua yang bukan bagian jam
    t = _NUM_WORD_RE.sub(lambda m: f"{m.group(1)} {_NUM_WORDS[m.group(2)]}", t)
    return re.sub(r"\s+", " ", t).strip()


def _to_24h(hour: int, period: str | None) -> int:
    if period == "pagi":
        return 0 if hour == 12 else hour
    if period == "siang":
        return hour if hour in (11, 12) else (hour + 12 if hour < 11 else hour)
    if period == "sore":
        return hour + 12 if hour < 12 else hour
    if period == "malam":
        if hour == 12:
            return 0
        return hour + 12 if 6 <= hour <= 11 else hour
    return hour


def parse_time(t: str) -> str | None:
    """Ambil jam dari teks ternormalisasi. Kembalikan 'HH:MM' atau None."""
    m = _HALF_RE.search(t)
    if m:
        n = int(m.group(1))
        period = m.group(2)
        if not 1 <= n <= 12:
            return None
        if n == 1 and period is None:
            n = 13
        total = (_to_24h(n, period) * 60 - 30) % 1440
        return f"{total // 60:02d}:{total % 60:02d}"
    m = _TIME_RE.search(t)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2)) if m.group(2) else 0
    period = m.group(3)
    if period and not 1 <= hour <= 12:
        return None
    hour = _to_24h(hour, period)
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return f"{hour:02d}:{minute:02d}"


def parse_day(t: str, today: date) -> tuple[date, bool]:
    """Kembalikan (tanggal, eksplisit_disebut)."""
    if re.search(r"\blusa\b", t):
        return today + timedelta(days=2), True
    if re.search(r"\bbesok\b", t):
        return today + timedelta(days=1), True
    if re.search(r"\bhari ini\b", t):
        return today, True
    m = _WEEKDAY_RE.search(t)
    if m:
        target = _WEEKDAYS[m.group(1)] if m.group(1) else 6
        delta = (target - today.weekday()) % 7 or 7
        return today + timedelta(days=delta), True
    return today, False


def infer_kind(title: str) -> str:
    low = title.lower()
    if re.search(r"\b(obat|vitamin|suplemen|tablet|kapsul|pil)\b", low):
        return "obat"
    if re.search(r"\b(kontrol|periksa|cek kesehatan|check ?up)\b", low):
        return "kontrol"
    if re.search(r"\b(dokter|janji|rumah sakit|puskesmas|klinik)\b", low):
        return "janji"
    return "lainnya"


def _clean_title(t: str) -> str:
    s = _HALF_RE.sub(" ", t)
    s = _TIME_RE.sub(" ", s)
    s = _WEEKDAY_RE.sub(" ", s)
    s = re.sub(r"\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam)\b", " ", s)
    s = _CREATE_RE.sub(" ", s)
    s = re.sub(r"\b(tolong|mohon|saya|aku|kami|untuk|pada|jam|pukul|ya|dong|deh|jadwal)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:1].upper() + s[1:] if s else ""


def parse_command(text: str, today: date) -> Intent:
    t = normalize(text)
    if not t:
        return Intent("unknown")

    if _CREATE_RE.search(t):
        title = _clean_title(t) or "Pengingat"
        day, explicit = parse_day(t, today)
        return Intent("create", title=title, kind=infer_kind(title), day=day,
                      time=parse_time(t), day_explicit=explicit)

    if _DONE_RE.search(t):
        return Intent("done")

    if _TIP_RE.search(t):
        return Intent("tip")

    if _LIST_RE.search(t) and (_LIST_VERB_RE.search(t) or parse_day(t, today)[1]):
        day, _ = parse_day(t, today)
        return Intent("list", day=day)

    if _HELP_RE.search(t):
        return Intent("help")

    return Intent("unknown")


def speak_time(hhmm: str) -> str:
    return "pukul " + hhmm.replace(":", ".")


def describe_day(d: date, today: date) -> str:
    delta = (d - today).days
    if delta == 0:
        return "hari ini"
    if delta == 1:
        return "besok"
    if delta == 2:
        return "lusa"
    return f"hari {DAY_NAMES[d.weekday()]}, {d.day} {MONTH_NAMES[d.month - 1]} {d.year}"
