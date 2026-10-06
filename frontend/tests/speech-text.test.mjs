// Jalankan: node --test frontend/tests/speech-text.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForSpeech as n, splitSentences, terbilang } from '../js/speech-text.js';

test('terbilang', () => {
  assert.equal(terbilang(0), 'nol');
  assert.equal(terbilang(11), 'sebelas');
  assert.equal(terbilang(125), 'seratus dua puluh lima');
  assert.equal(terbilang(2026), 'dua ribu dua puluh enam');
});

test('jam dibaca natural', () => {
  assert.equal(n('pukul 08.00'), 'jam delapan pagi');
  assert.equal(n('pukul 19.30'), 'jam tujuh lewat tiga puluh menit malam');
  assert.equal(n('jam 8 pagi'), 'jam delapan pagi');
});

test('dosis, satuan, singkatan', () => {
  assert.equal(n('10 mg, 3x1'), 'sepuluh miligram, tiga kali satu');
  assert.match(n('kontrol ke dr. Rina di RSUD'), /dokter Rina di rumah sakit umum daerah/);
});

test('emoji dan markdown dibuang, tidak ada digit tersisa', () => {
  const out = n('**Halo** 😊 ada 12 kegiatan');
  assert.equal(out, 'Halo ada dua belas kegiatan');
  assert.ok(!/\d/.test(n('Senin, 5 Oktober 2026, pukul 13.15 WIB, 120/80 mmHg')));
});

test('kalimat dipecah pendek', () => {
  const parts = splitSentences('Satu. Dua! ' + 'kata '.repeat(60));
  assert.ok(parts.length >= 4);
  assert.ok(parts.every((p) => p.length <= 141));
});
