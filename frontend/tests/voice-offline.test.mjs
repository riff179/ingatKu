// Perilaku tanpa internet. Jalankan: node --test frontend/tests/voice-offline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

function setup(voices, onLine) {
  const spoken = [];
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => { throw new Error('offline'); };
  globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
  globalThis.dispatchEvent = () => {};
  globalThis.isSecureContext = true;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.speechSynthesis = {
    paused: false, resume() {}, cancel() {},
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    speak(u) { spoken.push(u.voice.name); setTimeout(() => u.onend(), 0); },
  };
  return spoken;
}
const v = (name, lang, localService) => ({ name, lang, voiceURI: name, localService });

test('offline: suara Indonesia "online" dilewati, pakai suara lokal', async () => {
  const spoken = setup([
    v('Microsoft Gadis Online (Natural)', 'id-ID', false),
    v('Google Bahasa Indonesia', 'id-ID', true),
  ], false);
  const V = await import(`../js/voice.js?o=${Math.random()}`);
  assert.equal(await V.speak('Halo Pak Budi.', 0.85), true);
  assert.deepEqual([...new Set(spoken)], ['Google Bahasa Indonesia']);
});

test('online: suara Natural tetap dipilih', async () => {
  const spoken = setup([
    v('Microsoft Gadis Online (Natural)', 'id-ID', false),
    v('Google Bahasa Indonesia', 'id-ID', true),
  ], true);
  const V = await import(`../js/voice.js?n=${Math.random()}`);
  await V.speak('Halo Pak Budi.', 0.85);
  assert.deepEqual([...new Set(spoken)], ['Microsoft Gadis Online (Natural)']);
});

// ---- Google Cloud TTS (dilayani server): jadi suara utama saat online
function setupGoogle(onLine, ttsFails) {
  const state = setup([v('Google Bahasa Indonesia', 'id-ID', true)], onLine);
  let ttsCalls = 0;
  globalThis.Audio = class { constructor() { this.volume = 1; } pause() {} play() { setTimeout(() => this.onended(), 0); return Promise.resolve(); } };
  globalThis.URL.createObjectURL = () => 'blob:x';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.fetch = async (path) => {
    if (path === '/api/voice/status') return { ok: true, json: async () => ({ stt: false, tts: true, tts_provider: 'google' }) };
    if (path === '/api/voice/tts') {
      ttsCalls += 1;
      if (ttsFails) return { ok: false, status: 501, json: async () => ({ error: 'x' }) };
      return { ok: true, blob: async () => new Blob(['mp3']) };
    }
    throw new Error('offline');
  };
  return { spoken: state, calls: () => ttsCalls };
}

test('Google aktif + online: suara server dipakai', async () => {
  const g = setupGoogle(true, false);
  const V = await import(`../js/voice.js?g1=${Math.random()}`);
  assert.equal(await V.speak('Halo Pak Budi.', 0.85), true);
  assert.equal(g.calls(), 1);
  assert.equal(g.spoken.length, 0);
});

test('Google aktif tapi gagal: jatuh ke suara Indonesia perangkat', async () => {
  const g = setupGoogle(true, true);
  const V = await import(`../js/voice.js?g2=${Math.random()}`);
  assert.equal(await V.speak('Halo Pak Budi.', 0.85), true);
  assert.equal(g.calls(), 1);
  assert.deepEqual([...new Set(g.spoken)], ['Google Bahasa Indonesia']);
});

test('Google aktif tapi offline: langsung suara perangkat, tanpa memanggil server', async () => {
  const g = setupGoogle(false, false);
  const V = await import(`../js/voice.js?g3=${Math.random()}`);
  assert.equal(await V.speak('Halo Pak Budi.', 0.85), true);
  assert.equal(g.calls(), 0);
});
