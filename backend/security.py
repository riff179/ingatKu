"""Keamanan: hash password (PBKDF2) dan token bertanda tangan (HMAC-SHA256).

Hanya memakai pustaka standar Python.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 hari

_secret_cache: bytes | None = None


def _data_dir() -> Path:
    path = Path(os.environ.get("INGATKU_DATA_DIR", Path(__file__).resolve().parent / "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _secret() -> bytes:
    """Kunci penanda tangan token. Dari env INGATKU_SECRET, atau dibuat otomatis sekali."""
    global _secret_cache
    if _secret_cache is not None:
        return _secret_cache
    env = os.environ.get("INGATKU_SECRET")
    if env:
        _secret_cache = env.encode("utf-8")
        return _secret_cache
    path = _data_dir() / ".secret"
    if path.exists():
        _secret_cache = path.read_bytes()
    else:
        _secret_cache = secrets.token_bytes(32)
        path.write_bytes(_secret_cache)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return _secret_cache


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    _, candidate = hash_password(password, salt_hex)
    return hmac.compare_digest(candidate, hash_hex)


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(user_id: int, ttl: int = TOKEN_TTL_SECONDS) -> str:
    payload = json.dumps({"uid": int(user_id), "exp": int(time.time()) + ttl}, separators=(",", ":")).encode()
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    return f"{_b64e(payload)}.{_b64e(sig)}"


def verify_token(token: str) -> int | None:
    """Kembalikan user_id jika token sah dan belum kedaluwarsa, selain itu None."""
    try:
        payload_part, sig_part = token.split(".", 1)
        payload = _b64d(payload_part)
        sig = _b64d(sig_part)
        expected = hmac.new(_secret(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(payload)
        if int(data["exp"]) < time.time():
            return None
        return int(data["uid"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None
