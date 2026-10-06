"""Unduh model suara Bahasa Indonesia ke backend/models/ (jalankan SEKALI, saat ada internet).

Setelah itu IngatKu bisa berbicara dan mendengar TANPA internet.

    pip install faster-whisper transformers torch numpy huggingface_hub
    python3 download_models.py            # unduh semuanya (~600 MB)
    python3 download_models.py tts        # hanya suara (VITS, ~145 MB)
    python3 download_models.py stt        # hanya pengenalan ucapan (Whisper small, ~480 MB)
"""
from __future__ import annotations

import sys

import voice

MODELS = {
    # nama: (repo di Hugging Face, folder tujuan)
    "tts": ("facebook/mms-tts-ind", voice.LOCAL_TTS),   # suara Indonesia (MMS-TTS, VITS)
    "stt": ("Systran/faster-whisper-small", voice.LOCAL_STT),  # Whisper small
}


def main(argv: list[str]) -> int:
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Pasang dulu: pip install huggingface_hub")
        return 1
    wanted = [a for a in argv if a in MODELS] or list(MODELS)
    for key in wanted:
        repo, dest = MODELS[key]
        print(f"Mengunduh {repo} -> {dest}")
        try:
            snapshot_download(repo_id=repo, local_dir=dest)
        except Exception as exc:  # tanpa internet / repo tidak terjangkau
            print(f"Gagal mengunduh {repo}: {exc}")
            return 1
    print("Selesai. Jalankan server.py; suara dan mikrofon sekarang bekerja tanpa internet.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
