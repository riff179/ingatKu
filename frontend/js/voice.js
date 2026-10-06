// Suara: mendengar (STT) dan berbicara (TTS).
// Prioritas: Whisper/VITS di server bila tersedia, jika tidak memakai Web Speech API milik browser.
import { api } from './api.js';
import { normalizeForSpeech, splitSentences } from './speech-text.js';

export class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const NO_SPEECH = 'Suara Anda tidak terdengar. Coba lagi, bicara lebih dekat ke mikrofon.';

let capsPromise = null;

export function capabilities() {
  if (!capsPromise) {
    capsPromise = (async () => {
      let server = { stt: false, tts: false };
      try { server = await api.voiceStatus(); } catch { /* server tidak menjawab */ }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const secure = window.isSecureContext !== false;
      return {
        secure,
        serverStt: !!server.stt && secure && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia,
        serverTts: !!server.tts,
        ttsProvider: server.tts_provider || null, // 'google' | 'local' | null
        browserStt: !!SR && secure,
        browserTts: 'speechSynthesis' in window,
      };
    })();
  }
  return capsPromise;
}

function pickMime() {
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return list.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

function micError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new VoiceError('denied', 'Izin mikrofon ditolak. Aktifkan izin mikrofon di pengaturan peramban, lalu coba lagi.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new VoiceError('no-mic', 'Mikrofon tidak ditemukan di perangkat ini.');
  }
  return new VoiceError('mic', 'Mikrofon tidak bisa digunakan. Coba lagi.');
}

function listenServer(onLevel) {
  let stream = null;
  let recorder = null;
  let ctx = null;
  let timer = null;
  let cancelled = false;
  let heard = false;
  let rejectFn = null;

  const cleanup = () => {
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx && ctx.close) ctx.close().catch(() => {});
    stream = null;
    ctx = null;
  };
  const stopRecorder = () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const promise = new Promise((resolve, reject) => {
    rejectFn = reject;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        reject(micError(e));
        return;
      }
      if (cancelled) {
        cleanup();
        reject(new VoiceError('cancelled', ''));
        return;
      }
      const mime = pickMime();
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        cleanup();
        reject(new VoiceError('record', 'Perekaman suara tidak didukung di peramban ini.'));
        return;
      }
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = () => {
        cleanup();
        reject(new VoiceError('record', 'Perekaman gagal. Coba lagi.'));
      };
      recorder.onstop = async () => {
        cleanup();
        if (cancelled) return reject(new VoiceError('cancelled', ''));
        if (!heard) return reject(new VoiceError('no-speech', NO_SPEECH));
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
          const text = await api.stt(blob);
          if (cancelled) return reject(new VoiceError('cancelled', ''));
          if (!text) return reject(new VoiceError('no-speech', NO_SPEECH));
          resolve(text);
        } catch (e) {
          reject(e);
        }
      };

      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const started = Date.now();
      let lastVoice = started;
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const x = (buf[i] - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (onLevel) onLevel(Math.min(1, rms * 6));
        const now = Date.now();
        if (rms > 0.035) {
          heard = true;
          lastVoice = now;
        }
        if ((heard && now - lastVoice > 1500) || now - started > 12000 || (!heard && now - started > 7000)) stopRecorder();
      }, 100);
      recorder.start();
    })();
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        cleanup();
        if (rejectFn) rejectFn(new VoiceError('cancelled', ''));
      }
    },
  };
}

function listenBrowser() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'id-ID';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  // Tanpa internet, Chrome/Edge baru bisa mengenali ucapan langsung di perangkat (tanpa server Google).
  if (navigator.onLine === false && 'processLocally' in rec) rec.processLocally = true;
  let settled = false;
  let cancelled = false;
  const promise = new Promise((resolve, reject) => {
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(cancelled ? new VoiceError('cancelled', '') : err);
    };
    rec.onresult = (e) => {
      if (settled) return;
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) {
        settled = true;
        resolve(text);
      } else {
        fail(new VoiceError('no-speech', NO_SPEECH));
      }
    };
    rec.onerror = (e) => {
      const code = e.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        fail(new VoiceError('denied', 'Izin mikrofon ditolak. Aktifkan izin mikrofon di pengaturan peramban, lalu coba lagi.'));
      } else if (code === 'no-speech' || code === 'aborted') {
        fail(new VoiceError('no-speech', NO_SPEECH));
      } else if (code === 'language-not-supported') {
        fail(new VoiceError('offline-lang', 'Pengenalan suara Bahasa Indonesia belum terpasang untuk mode tanpa internet. Sambungkan internet sekali, atau ketuk salah satu contoh perintah.'));
      } else if (code === 'network') {
        fail(new VoiceError('network', 'Pengenalan suara peramban butuh internet. Pasang model suara di server (python3 download_models.py), atau ketuk salah satu contoh perintah.'));
      } else {
        fail(new VoiceError(code || 'error', 'Pengenalan suara gagal. Coba lagi.'));
      }
    };
    rec.onend = () => fail(new VoiceError('no-speech', NO_SPEECH));
    try {
      rec.start();
    } catch {
      fail(new VoiceError('start', 'Mikrofon tidak bisa dimulai. Coba lagi.'));
    }
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      try { rec.abort(); } catch { /* abaikan */ }
    },
  };
}

/** Mulai mendengarkan. Mengembalikan { promise: Promise<string>, cancel() }. */
export function listen({ onLevel } = {}) {
  let handle = null;
  let cancelled = false;
  const promise = (async () => {
    const c = await capabilities();
    if (cancelled) throw new VoiceError('cancelled', '');
    if (c.serverStt) {
      handle = listenServer(onLevel);
      if (!c.browserStt) return handle.promise;
      try {
        return await handle.promise;
      } catch (e) {
        // Model server belum diunduh (501) atau server tak terjangkau: coba pengenalan milik peramban.
        if (cancelled || !(e && e.message) || ['cancelled', 'denied', 'no-mic', 'no-speech', 'record', 'mic'].includes(e.code)) throw e;
        handle = listenBrowser();
      }
    } else if (c.browserStt) handle = listenBrowser();
    else {
      throw new VoiceError(
        'unsupported',
        c.secure
          ? 'Peramban ini belum mendukung mikrofon. Silakan ketuk salah satu contoh perintah di bawah.'
          : 'Mikrofon hanya bisa dipakai lewat alamat https atau localhost. Silakan ketuk salah satu contoh perintah di bawah.',
      );
    }
    return handle.promise;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (handle) handle.cancel();
    },
  };
}

// ---------------------------------------------------------------- berbicara (TTS)
// Tujuan: suara Bahasa Indonesia asli (tanpa aksen asing), jelas, pelan, dan berjeda untuk lansia.
// Aturan keras: TIDAK PERNAH berbicara memakai suara non-Indonesia. Jika perangkat tidak punya
// suara Indonesia, aplikasi memberi tahu pengguna, bukan membaca dengan suara Inggris.

const PREF_KEY = 'ingatku.voicepref'; // 'auto' | 'server' | voiceURI (tersimpan per perangkat)
const ID_LANG = /^id([-_]|$)|^in[-_]id$/i; // Android lama memakai "in-ID"
const GOOD_SCORE = 35; // di atas ini dianggap suara berkualitas baik
const PITCH = 0.95; // sedikit lebih rendah: lebih mudah didengar telinga lansia
const PAUSE_MS = 450; // jeda antarkalimat pada kecepatan 1.0

export function getVoicePref() {
  try { return localStorage.getItem(PREF_KEY) || 'auto'; } catch { return 'auto'; }
}
export function setVoicePref(v) {
  try { localStorage.setItem(PREF_KEY, v || 'auto'); } catch { /* abaikan */ }
}

let voicesCache = null;
function loadVoices(timeout = 2000) {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (voicesCache) return Promise.resolve(voicesCache);
  const synth = window.speechSynthesis;
  return new Promise((resolve) => {
    const have = synth.getVoices();
    if (have.length) { voicesCache = have; resolve(have); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener('voiceschanged', finish);
      const list = synth.getVoices();
      if (list.length) voicesCache = list; // jika kosong, coba lagi lain kali
      resolve(list);
    };
    synth.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeout);
  });
}

function scoreVoice(v) {
  const n = `${v.name || ''}`.toLowerCase();
  let s = 0;
  if (/natural|neural|online/.test(n)) s += 50; // Microsoft Edge: Gadis/Ardi Online (Natural)
  if (/google/.test(n)) s += 40; // Chrome/Android: Google Bahasa Indonesia
  if (/damayanti/.test(n)) s += 35; // iPhone/Mac
  if (/gadis|ardi/.test(n)) s += 20;
  if (/enhanced|premium/.test(n)) s += 10;
  if (/compact|espeak/.test(n)) s -= 25; // robotik
  if (/^id[-_]id$/i.test(v.lang || '')) s += 5;
  return s;
}

function indonesianVoices(all) {
  // Tanpa internet, suara dengan localService === false (mis. Edge "Online (Natural)") tidak bisa bicara.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return all
    .filter((v) => ID_LANG.test(v.lang || '') && !(offline && v.localService === false))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

/** Daftar pilihan suara untuk layar Pengaturan. */
export async function voiceOptions() {
  const [c, all] = await Promise.all([capabilities(), loadVoices()]);
  return {
    server: c.serverTts,
    browser: indonesianVoices(all).map((v) => ({ id: v.voiceURI, name: v.name, good: scoreVoice(v) >= GOOD_SCORE })),
  };
}

/** Putuskan mesin suara yang dipakai. Mengembalikan { engine: 'server'|'browser'|'none', voice }. */
async function chooseEngine(c) {
  const pref = getVoicePref();
  const voices = indonesianVoices(await loadVoices());
  const picked = pref !== 'auto' && pref !== 'server' ? voices.find((v) => v.voiceURI === pref) : null;
  const best = picked || voices[0] || null;
  if (pref === 'server' && c.serverTts) return { engine: 'server', voice: best };
  if (picked) return { engine: 'browser', voice: picked };
  // Google Cloud TTS diatur di server: jadi suara utama selama ada internet.
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (pref === 'auto' && c.serverTts && c.ttsProvider === 'google' && online) return { engine: 'server', voice: best };
  if (best && scoreVoice(best) >= GOOD_SCORE) return { engine: 'browser', voice: best };
  if (c.serverTts) return { engine: 'server', voice: best };
  if (best) return { engine: 'browser', voice: best };
  return { engine: 'none', voice: null };
}

let currentAudio = null;
let currentDone = null;
let speakToken = 0;
let warnedNoVoice = false;

export function stopSpeaking() {
  speakToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentDone) {
    const done = currentDone;
    currentDone = null;
    done();
  }
}

/** Tunggu ms milidetik; berhenti lebih awal bila stopSpeaking() dipanggil. */
function wait(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { currentDone = null; resolve(); }, ms);
    currentDone = () => { clearTimeout(t); resolve(); };
  });
}

function utter(text, voice, rate) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang || 'id-ID';
    u.rate = Math.min(1.3, Math.max(0.5, rate));
    u.pitch = PITCH;
    u.volume = 1;
    // Pengaman: sebagian peramban kadang tidak memicu onend (galat Chrome pada ucapan panjang).
    const guard = setTimeout(() => { synth.cancel(); finish(); }, 4000 + (text.length * 110) / u.rate);
    function finish() {
      clearTimeout(guard);
      currentDone = null;
      resolve();
    }
    u.onend = finish;
    u.onerror = finish;
    currentDone = finish;
    synth.speak(u);
  });
}

async function speakBrowser(sentences, rate, voice, mine) {
  const synth = window.speechSynthesis;
  synth.cancel();
  if (synth.paused) synth.resume();
  for (let i = 0; i < sentences.length; i += 1) {
    if (mine !== speakToken) return;
    await utter(sentences[i], voice, rate);
    if (mine !== speakToken) return;
    if (i < sentences.length - 1) await wait(PAUSE_MS / Math.max(rate, 0.6));
  }
}

async function speakServer(text, rate, mine) {
  const blob = await api.tts(text, rate);
  if (mine !== speakToken) return true;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = 1;
  currentAudio = audio;
  try {
    await new Promise((resolve, reject) => {
      currentDone = resolve;
      audio.onended = resolve;
      audio.onerror = reject;
      audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
    currentDone = null;
    if (currentAudio === audio) currentAudio = null;
  }
  return true;
}

function warnNoVoice() {
  if (warnedNoVoice) return;
  warnedNoVoice = true;
  window.dispatchEvent(new CustomEvent('ingatku:novoice'));
}

/**
 * Ucapkan teks dalam Bahasa Indonesia. Tidak pernah melempar galat; selesai saat ucapan berakhir
 * atau dihentikan. Mengembalikan true bila berhasil diucapkan dengan suara Indonesia.
 */
export async function speak(text, rate = 0.85) {
  const clean = normalizeForSpeech(text);
  if (!clean) return false;
  stopSpeaking();
  const mine = speakToken;
  const c = await capabilities();
  if (mine !== speakToken) return false;
  const { engine, voice } = await chooseEngine(c);
  if (mine !== speakToken) return false;

  if (engine === 'server') {
    try {
      return await speakServer(clean, rate, mine);
    } catch { /* jatuh ke suara Indonesia milik perangkat bila ada */ }
    if (mine !== speakToken) return false;
  }
  if (voice && c.browserTts) {
    await speakBrowser(splitSentences(clean), rate, voice, mine);
    return true;
  }
  warnNoVoice();
  return false;
}
