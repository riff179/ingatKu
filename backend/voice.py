"""Pengenalan ucapan (Whisper) dan sintesis suara (VITS) Bahasa Indonesia.

Keduanya OPSIONAL. Jika pustakanya belum dipasang, endpoint suara mengembalikan 501 dan
frontend otomatis memakai Web Speech API milik browser sebagai cadangan.

Pasang (opsional):
    pip install faster-whisper                      # STT (Whisper)
    pip install transformers torch numpy            # TTS lokal (VITS: facebook/mms-tts-ind)

Suara utama (bila diatur): Google Cloud Text-to-Speech lewat REST, tanpa pustaka tambahan.
    GOOGLE_TTS_API_KEY=...            # kunci API (hanya dibaca server, tidak dikirim ke browser)
    INGATKU_GOOGLE_VOICE=id-ID-Wavenet-A   # opsional; contoh lain: id-ID-Standard-A, id-ID-Chirp3-HD-Autonoe
Jika Google tidak terjangkau (offline/kuota), server memakai VITS lokal bila tersedia.
"""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import re
import tempfile
import threading
import urllib.error
import urllib.request
import wave
from functools import lru_cache
from xml.sax.saxutils import escape

_lock = threading.Lock()
_stt_model = None
_tts_bundle = None

# Model suara disimpan lokal di backend/models/ agar jalan TANPA internet.
# Unduh sekali (saat ada internet) dengan: python3 download_models.py
MODELS_DIR = os.environ.get("INGATKU_MODELS_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
LOCAL_STT = os.path.join(MODELS_DIR, "whisper-small")
LOCAL_TTS = os.path.join(MODELS_DIR, "mms-tts-ind")


class VoiceUnavailable(RuntimeError):
    pass


def stt_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def tts_local_available() -> bool:
    return all(importlib.util.find_spec(m) is not None for m in ("transformers", "torch", "numpy"))


def google_configured() -> bool:
    return bool(os.environ.get("GOOGLE_TTS_API_KEY", "").strip())


def tts_available() -> bool:
    return google_configured() or tts_local_available()


def tts_provider() -> str | None:
    """'google' bila Cloud TTS diatur, 'local' bila hanya VITS, None bila tidak ada."""
    if google_configured():
        return "google"
    return "local" if tts_local_available() else None


def _get_stt():
    global _stt_model
    if _stt_model is None:
        from faster_whisper import WhisperModel  # impor lambat: hanya saat dipakai

        device = os.environ.get("INGATKU_DEVICE", "cpu")
        compute = "float16" if device == "cuda" else "int8"
        local = os.path.isdir(LOCAL_STT)
        name = os.environ.get("INGATKU_WHISPER_MODEL") or (LOCAL_STT if local else "small")
        try:
            _stt_model = WhisperModel(name, device=device, compute_type=compute,
                                      local_files_only=os.path.isdir(name))
        except Exception as exc:  # model belum diunduh dan tidak ada internet
            raise VoiceUnavailable(
                "Model pengenalan suara belum ada di komputer ini. Jalankan 'python3 download_models.py' "
                "satu kali saat ada internet.") from exc
    return _stt_model


def transcribe(audio: bytes, suffix: str = ".webm") -> str:
    if not stt_available():
        raise VoiceUnavailable("Pengenalan suara di server belum dipasang (faster-whisper).")
    with _lock:
        model = _get_stt()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio)
            path = f.name
        try:
            segments, _info = model.transcribe(
                path,
                language="id",
                beam_size=5,
                vad_filter=True,
                initial_prompt="Ingatkan saya minum obat jam 8 pagi. Cek jadwal besok. Putar berita hari ini.",
            )
            return " ".join(seg.text.strip() for seg in segments).strip()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


def _get_tts():
    global _tts_bundle
    if _tts_bundle is None:
        from transformers import AutoTokenizer, VitsModel

        local = os.path.isdir(LOCAL_TTS)
        name = os.environ.get("INGATKU_TTS_MODEL") or (LOCAL_TTS if local else "facebook/mms-tts-ind")
        try:
            model = VitsModel.from_pretrained(name, local_files_only=os.path.isdir(name))
            tokenizer = AutoTokenizer.from_pretrained(name, local_files_only=os.path.isdir(name))
        except Exception as exc:  # model belum diunduh dan tidak ada internet
            raise VoiceUnavailable(
                "Model suara Indonesia belum ada di komputer ini. Jalankan 'python3 download_models.py' "
                "satu kali saat ada internet.") from exc
        model.eval()
        # Pengaturan agar ucapan lebih stabil dan jelas (kurang "bergoyang") untuk pendengar lansia.
        model.noise_scale = 0.5
        model.noise_scale_duration = 0.6
        _tts_bundle = (tokenizer, model)
    return _tts_bundle


MIN_RATE, MAX_RATE = 0.6, 1.3
PAUSE_SECONDS = 0.45  # jeda antarkalimat pada kecepatan 1.0
PEAK = 0.92  # normalisasi volume: keluaran VITS cenderung pelan


def clamp_rate(rate) -> float:
    try:
        value = float(rate)
    except (TypeError, ValueError):
        return 0.85
    return round(min(MAX_RATE, max(MIN_RATE, value)), 2)


def split_sentences(text: str, max_len: int = 140) -> list[str]:
    """Pecah teks menjadi kalimat pendek agar tiap kalimat dibaca utuh dan jelas."""
    out: list[str] = []
    for part in re.findall(r"[^.!?\n]+[.!?]*", text):
        s = part.strip()
        while len(s) > max_len:
            cut = s.rfind(",", 0, max_len)
            if cut < 40:
                cut = s.rfind(" ", 0, max_len)
            if cut < 1:
                cut = max_len
            out.append(s[: cut + 1].strip())
            s = s[cut + 1:].strip()
        if s:
            out.append(s)
    return out


def _tts_text(sentence: str) -> str:
    """Model hanya mengenal huruf kecil; tanda baca berlebih dibuang, koma dan titik dijaga untuk jeda."""
    t = sentence.lower()
    t = re.sub(r"[^a-z\s,.\-?!']", " ", t)  # angka sudah dieja oleh klien
    return re.sub(r"\s+", " ", t).strip()


@lru_cache(maxsize=256)
def _synth_sentence(sentence: str, rate: float):
    """Waveform float32 untuk satu kalimat. Di-cache per (kalimat, kecepatan)."""
    import numpy as np
    import torch

    tokenizer, model = _get_tts()
    text = _tts_text(sentence)
    if not text:
        return np.zeros(0, dtype=np.float32)
    model.speaking_rate = rate  # >1 lebih cepat, <1 lebih pelan (dihitung model, bukan sekadar playbackRate)
    inputs = tokenizer(text, return_tensors="pt")
    torch.manual_seed(555)  # hasil konsisten untuk kalimat yang sama
    with torch.no_grad():
        waveform = model(**inputs).waveform
    return waveform.squeeze().cpu().numpy().astype(np.float32)


def synthesize(text: str, rate: float = 0.85) -> bytes:
    """Kembalikan audio WAV (mono, 16-bit), dibaca per kalimat dengan jeda."""
    if not tts_local_available():
        raise VoiceUnavailable("Sintesis suara di server belum dipasang (transformers + torch).")
    import numpy as np

    rate = clamp_rate(rate)
    text = " ".join(text.split())
    with _lock:
        _tokenizer, model = _get_tts()
        sr = int(model.config.sampling_rate)
        gap = np.zeros(int(sr * PAUSE_SECONDS / rate), dtype=np.float32)
        pieces = []
        for sentence in split_sentences(text):
            wave_part = _synth_sentence(sentence, rate)
            if wave_part.size:
                pieces.append(wave_part)
                pieces.append(gap)
        if not pieces:
            raise VoiceUnavailable("Teks tidak berisi kata yang bisa diucapkan.")
        audio = np.concatenate(pieces[:-1])
        peak = float(np.max(np.abs(audio))) or 1.0
        audio = audio * (PEAK / peak)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# --------------------------------------------------------------------------- Google Cloud TTS

GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"
GOOGLE_DEFAULT_VOICE = "id-ID-Wavenet-A"
GOOGLE_TIMEOUT = 10  # detik
GOOGLE_PITCH = -1.0  # semitone; sedikit rendah agar lebih mudah didengar lansia


def _google_voice() -> str:
    name = os.environ.get("INGATKU_GOOGLE_VOICE", "").strip() or GOOGLE_DEFAULT_VOICE
    return name if name.startswith("id-ID-") else GOOGLE_DEFAULT_VOICE  # hanya suara Indonesia


def _google_payload(text: str, rate: float, voice_name: str) -> dict:
    voice = {"languageCode": "id-ID", "name": voice_name}
    if "chirp" in voice_name.lower():
        # Chirp 3 HD tidak mendukung SSML, speakingRate, maupun pitch: kirim teks biasa.
        return {"input": {"text": text}, "voice": voice,
                "audioConfig": {"audioEncoding": "MP3", "sampleRateHertz": 24000}}
    pause_ms = int(PAUSE_SECONDS * 1000 / rate)
    body = f'<break time="{pause_ms}ms"/>'.join(escape(s) for s in split_sentences(text))
    return {
        "input": {"ssml": f"<speak>{body}</speak>"},
        "voice": voice,
        "audioConfig": {"audioEncoding": "MP3", "sampleRateHertz": 24000,
                        "speakingRate": rate, "pitch": GOOGLE_PITCH,
                        "volumeGainDb": 0.0, "effectsProfileId": ["handheld-class-device"]},
    }


@lru_cache(maxsize=128)
def _google_synthesize(text: str, rate: float, voice_name: str) -> bytes:
    """MP3 dari Google Cloud TTS. Di-cache per (teks, kecepatan, suara) agar hemat kuota."""
    key = os.environ.get("GOOGLE_TTS_API_KEY", "").strip()
    if not key:
        raise VoiceUnavailable("Kunci Google Cloud TTS belum diatur (GOOGLE_TTS_API_KEY).")
    req = urllib.request.Request(
        GOOGLE_TTS_URL,
        data=json.dumps(_google_payload(text, rate, voice_name)).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "X-Goog-Api-Key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=GOOGLE_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        audio = base64.b64decode(data["audioContent"])
    except urllib.error.HTTPError as exc:
        # Pesan Google (mis. API belum diaktifkan / kuota habis) dicatat, bukan dikirim ke pengguna.
        detail = exc.read()[:300].decode("utf-8", "replace").replace(key, "***")
        print(f"[voice] Google TTS HTTP {exc.code}: {detail}")
        raise VoiceUnavailable("Layanan suara Google menolak permintaan. Periksa kunci API dan kuota.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise VoiceUnavailable("Tidak bisa menghubungi layanan suara Google (periksa internet).") from exc
    except (KeyError, ValueError) as exc:
        raise VoiceUnavailable("Jawaban layanan suara Google tidak valid.") from exc
    if not audio:
        raise VoiceUnavailable("Layanan suara Google tidak mengembalikan audio.")
    return audio


def synthesize_audio(text: str, rate: float = 0.85) -> tuple[bytes, str]:
    """Kembalikan (audio, mime). Google Cloud TTS dulu; bila gagal, VITS lokal (jika ada)."""
    rate = clamp_rate(rate)
    text = " ".join(text.split())
    if google_configured():
        try:
            return _google_synthesize(text, rate, _google_voice()), "audio/mpeg"
        except VoiceUnavailable:
            if not tts_local_available():
                raise
    return synthesize(text, rate), "audio/wav"
