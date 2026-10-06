import base64
import io
import json
import os
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import voice  # noqa: E402


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def ok_response(audio=b"ID3fake-mp3"):
    return FakeResp(json.dumps({"audioContent": base64.b64encode(audio).decode()}).encode())


class GoogleTtsTests(unittest.TestCase):
    def setUp(self):
        voice._google_synthesize.cache_clear()
        self.env = mock.patch.dict(os.environ, {"GOOGLE_TTS_API_KEY": "kunci-uji"})
        self.env.start()
        os.environ.pop("INGATKU_GOOGLE_VOICE", None)

    def tearDown(self):
        self.env.stop()

    def test_provider_and_availability(self):
        self.assertTrue(voice.tts_available())
        self.assertEqual(voice.tts_provider(), "google")
        with mock.patch.dict(os.environ, {"GOOGLE_TTS_API_KEY": ""}):
            self.assertFalse(voice.google_configured())

    def test_request_is_indonesian_ssml_with_key_in_header(self):
        seen = {}

        def fake(req, timeout):
            seen["req"], seen["timeout"] = req, timeout
            return ok_response()

        with mock.patch("urllib.request.urlopen", fake):
            audio, mime = voice.synthesize_audio("Halo Pak Budi. Waktunya minum obat & istirahat.", 0.85)
        self.assertEqual((audio, mime), (b"ID3fake-mp3", "audio/mpeg"))
        req = seen["req"]
        self.assertNotIn("kunci-uji", req.full_url)  # kunci tidak di URL
        self.assertEqual(req.get_header("X-goog-api-key"), "kunci-uji")
        body = json.loads(req.data)
        self.assertEqual(body["voice"], {"languageCode": "id-ID", "name": "id-ID-Wavenet-A"})
        self.assertEqual(body["audioConfig"]["speakingRate"], 0.85)
        ssml = body["input"]["ssml"]
        self.assertTrue(ssml.startswith("<speak>") and ssml.endswith("</speak>"))
        self.assertIn('<break time="529ms"/>', ssml)  # 450 ms / 0.85
        self.assertIn("&amp;", ssml)  # karakter XML di-escape

    def test_non_indonesian_voice_is_ignored(self):
        with mock.patch.dict(os.environ, {"INGATKU_GOOGLE_VOICE": "en-US-Wavenet-D"}):
            self.assertEqual(voice._google_voice(), "id-ID-Wavenet-A")
        with mock.patch.dict(os.environ, {"INGATKU_GOOGLE_VOICE": "id-ID-Standard-B"}):
            self.assertEqual(voice._google_voice(), "id-ID-Standard-B")

    def test_chirp_voice_uses_plain_text(self):
        payload = voice._google_payload("Halo.", 0.85, "id-ID-Chirp3-HD-Autonoe")
        self.assertEqual(payload["input"], {"text": "Halo."})
        self.assertNotIn("speakingRate", payload["audioConfig"])

    def test_result_is_cached(self):
        calls = []

        def fake(req, timeout):
            calls.append(1)
            return ok_response()

        with mock.patch("urllib.request.urlopen", fake):
            voice.synthesize_audio("Halo.", 0.85)
            voice.synthesize_audio("Halo.", 0.85)
        self.assertEqual(len(calls), 1)

    def test_offline_without_local_model_raises_unavailable(self):
        def fake(req, timeout):
            raise urllib.error.URLError("offline")

        with mock.patch("urllib.request.urlopen", fake), \
                mock.patch.object(voice, "tts_local_available", lambda: False):
            with self.assertRaises(voice.VoiceUnavailable):
                voice.synthesize_audio("Halo.", 0.85)

    def test_offline_falls_back_to_local_voice(self):
        def fake(req, timeout):
            raise urllib.error.URLError("offline")

        with mock.patch("urllib.request.urlopen", fake), \
                mock.patch.object(voice, "tts_local_available", lambda: True), \
                mock.patch.object(voice, "synthesize", lambda t, r: b"RIFFlocal"):
            self.assertEqual(voice.synthesize_audio("Halo.", 0.85), (b"RIFFlocal", "audio/wav"))

    def test_http_error_does_not_leak_details(self):
        def fake(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(b'{"error":"API key kunci-uji"}'))

        with mock.patch("urllib.request.urlopen", fake), \
                mock.patch.object(voice, "tts_local_available", lambda: False):
            with self.assertRaises(voice.VoiceUnavailable) as cm:
                voice.synthesize_audio("Halo.", 0.85)
        self.assertNotIn("kunci-uji", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
