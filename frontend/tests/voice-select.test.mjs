// Memastikan suara non-Indonesia TIDAK PERNAH dipakai. Jalankan: node --test frontend/tests/voice-select.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

function setup(voices) {
  const spoken = [];
  const events = [];
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => { throw new Error('offline'); };
  globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
  globalThis.dispatchEvent = (e) => events.push(e.type);
  globalThis.isSecureContext = true;
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.speechSynthesis = {
    paused: false, resume() {}, cancel() {},
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    speak(u) { spoken.push({ text: u.text, voice: u.voice.name, lang: u.lang, rate: u.rate }); setTimeout(() => u.onend(), 0); },
  };
  return { spoken, events };
}
const v = (name, lang) => ({ name, lang, voiceURI: name });

test('memilih suara Indonesia terbaik, abaikan suara asing', async () => {
  const { spoken } = setup([v('Google US English', 'en-US'), v('espeak Indonesian compact', 'id-ID'), v('Google Bahasa Indonesia', 'id_ID')]);
  const V = await import(`../js/voice.js?a=${Math.random()}`);
  assert.equal(await V.speak('Waktunya minum obat pukul 08.00. Jangan lupa air putih.', 0.85), true);
  assert.ok(spoken.length >= 2); // dipecah per kalimat
  assert.ok(spoken.every((s) => s.voice === 'Google Bahasa Indonesia' && /^id/i.test(s.lang)));
  assert.match(spoken[0].text, /jam delapan pagi/);
});

test('tanpa suara Indonesia: diam dan beri peringatan, bukan pakai suara Inggris', async () => {
  const { spoken, events } = setup([v('Google US English', 'en-US'), v('Microsoft Zira', 'en-US')]);
  const V = await import(`../js/voice.js?b=${Math.random()}`);
  assert.equal(await V.speak('Halo Pak Budi.', 0.85), false);
  assert.equal(spoken.length, 0);
  assert.deepEqual(events, ['ingatku:novoice']);
});
