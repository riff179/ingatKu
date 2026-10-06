// Mengubah teks tampilan menjadi teks yang enak DIUCAPKAN dalam Bahasa Indonesia.
// Mesin suara sering salah membaca "08.00", "10 mg", "3x1", atau singkatan sehingga
// terdengar seperti aksen asing. Di sini semuanya dieja dalam kata Indonesia baku.

const SATUAN = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
  'sepuluh', 'sebelas'];

/** Angka bulat -> kata ("125" -> "seratus dua puluh lima"). */
export function terbilang(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `minus ${terbilang(-n)}`;
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh${n % 10 ? ` ${SATUAN[n % 10]}` : ''}`;
  if (n < 200) return `seratus${n % 100 ? ` ${terbilang(n % 100)}` : ''}`;
  if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ''}`;
  if (n < 2000) return `seribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ''}`;
  if (n < 1e6) return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ''}`;
  if (n < 1e9) return `${terbilang(Math.floor(n / 1e6))} juta${n % 1e6 ? ` ${terbilang(n % 1e6)}` : ''}`;
  return String(n).split('').map((d) => SATUAN[Number(d)]).join(' ');
}

const BULAN = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september',
  'oktober', 'november', 'desember'];

function jam(h, m) {
  if (h > 23 || m > 59) return null;
  let kata = `jam ${terbilang(h)}`;
  if (m) kata += ` lewat ${terbilang(m)} menit`;
  return kata;
}

function periode(h) {
  if (h >= 4 && h < 11) return 'pagi';
  if (h >= 11 && h < 15) return 'siang';
  if (h >= 15 && h < 18) return 'sore';
  return 'malam';
}

/** Jam 24 jam -> "jam delapan pagi", "jam tujuh lewat tiga puluh menit malam". */
function jamLengkap(h, m, sebutPeriode) {
  const j12 = h % 12 === 0 ? 12 : h % 12;
  const dasar = jam(j12, m);
  if (!dasar) return null;
  return sebutPeriode ? `${dasar} ${periode(h)}` : dasar;
}

const UNIT = [
  [/\bmg\b/gi, 'miligram'],
  [/\bmcg\b|µg/gi, 'mikrogram'],
  [/\bkg\b/gi, 'kilogram'],
  [/\bml\b/gi, 'mililiter'],
  [/\bcc\b/gi, 'sese'],
  [/\bmmhg\b/gi, 'milimeter air raksa'],
  [/\bmg\/dl\b/gi, 'miligram per desiliter'],
  [/\bkm\b/gi, 'kilometer'],
  [/°c\b/gi, 'derajat celsius'],
];

const SINGKATAN = [
  [/\bwib\b/gi, 'waktu Indonesia barat'],
  [/\bwita\b/gi, 'waktu Indonesia tengah'],
  [/\bwit\b/gi, 'waktu Indonesia timur'],
  [/\bdr\.\s*/gi, 'dokter '],
  [/\bdrg\.\s*/gi, 'dokter gigi '],
  [/\bsdh\b/gi, 'sudah'],
  [/\bblm\b/gi, 'belum'],
  [/\byg\b/gi, 'yang'],
  [/\bdgn\b/gi, 'dengan'],
  [/\butk\b/gi, 'untuk'],
  [/\bdll\b/gi, 'dan lain-lain'],
  [/\bdsb\b/gi, 'dan seterusnya'],
  [/\bRS\b/g, 'rumah sakit'],
  [/\bRSU\b/g, 'rumah sakit umum'],
  [/\bRSUD\b/g, 'rumah sakit umum daerah'],
  [/\bBPJS\b/g, 'be pe je es'],
  [/\bTD\b/g, 'tekanan darah'],
  [/\bGD\b/g, 'gula darah'],
];

/** Ubah teks agar diucapkan jelas dalam Bahasa Indonesia. */
export function normalizeForSpeech(input) {
  let t = String(input ?? '');

  // Buang markdown, emoji, dan tanda yang dibacakan aneh.
  t = t.replace(/[*_`#>~|]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\(([^)]*)\)/g, ', $1,')
    .replace(/\s*[;:]\s+/g, ', ')
    .replace(/\s*[/\\]\s*/g, ' atau ')
    .replace(/&/g, ' dan ');

  // Tanggal 05/10/2026 atau 2026-10-05 -> "lima Oktober dua ribu dua puluh enam".
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => {
    const b = BULAN[Number(mo) - 1];
    return b ? `${terbilang(Number(d))} ${b} ${terbilang(Number(y))}` : m;
  });
  t = t.replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, (m, d, mo, y) => {
    const b = BULAN[Number(mo) - 1];
    return b ? `${terbilang(Number(d))} ${b} ${terbilang(Number(y))}` : m;
  });

  // Jam: "pukul 08.00", "jam 8:30", "08.00 WIB", "pukul 19.30".
  t = t.replace(/\b(pukul|jam)\s+(\d{1,2})[.:](\d{2})\b(?:\s*(pagi|siang|sore|malam))?/gi, (m, kata, h, mi, p) => {
    const hh = Number(h);
    const mm = Number(mi);
    if (hh > 23 || mm > 59) return m;
    // Bila sudah ada kata "pagi/siang/..." pakai jam 12-an; bila belum, tambahkan sendiri.
    return p ? `${jam(hh % 12 || 12, mm)} ${p.toLowerCase()}` : jamLengkap(hh, mm, true);
  });
  t = t.replace(/\b(\d{1,2})[.:](\d{2})\b(?=\s*(?:waktu|wib|wita|wit|\.|,|$))/gi, (m, h, mi) => {
    const hh = Number(h);
    const mm = Number(mi);
    return hh <= 23 && mm <= 59 ? jamLengkap(hh, mm, true) : m;
  });
  t = t.replace(/\b(pukul|jam)\s+(\d{1,2})\b(?!\s*[.:]\d)/gi, (m, kata, h) => `jam ${terbilang(Number(h))}`);

  // Dosis "3x1" / "3 x 1 hari" -> "tiga kali satu".
  t = t.replace(/\b(\d+)\s*[x×]\s*(\d+)\b/gi, (m, a, b) => `${terbilang(Number(a))} kali ${terbilang(Number(b))}`);

  // Pecahan desimal: "1,5" atau "1.5" sebelum satuan -> "satu koma lima".
  t = t.replace(/\b(\d+)[,.](\d{1,2})\b(?=\s*(?:mg|ml|kg|cc|°c|miligram|liter|tablet|kapsul|sendok))/gi,
    (m, a, b) => `${terbilang(Number(a))} koma ${b.split('').map((d) => SATUAN[Number(d)]).join(' ')}`);

  // Tekanan darah 120/80.
  t = t.replace(/\b(\d{2,3})\s*(?:atau|\/)\s*(\d{2,3})\b(?=\s*(?:mmhg|milimeter))/gi,
    (m, a, b) => `${terbilang(Number(a))} per ${terbilang(Number(b))}`);

  // Satuan dan singkatan (sebelum angka dieja agar "10 mg" tetap terdeteksi).
  for (const [re, kata] of UNIT) t = t.replace(re, kata);
  for (const [re, kata] of SINGKATAN) t = t.replace(re, kata);

  // Sisa angka biasa.
  t = t.replace(/\b\d+\b/g, (m) => (m.length > 9 ? m.split('').map((d) => SATUAN[Number(d)]).join(' ') : terbilang(Number(m))));

  // Rapikan spasi dan tanda baca ganda supaya jeda terdengar wajar.
  t = t.replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

/** Pecah menjadi kalimat pendek: dibaca satu per satu dengan jeda, lebih mudah diikuti lansia. */
export function splitSentences(text, maxLen = 140) {
  const raw = String(text || '').match(/[^.!?\n]+[.!?]*/g) || [];
  const out = [];
  for (const part of raw) {
    let s = part.trim();
    if (!s) continue;
    while (s.length > maxLen) {
      let cut = s.lastIndexOf(',', maxLen);
      if (cut < 40) cut = s.lastIndexOf(' ', maxLen);
      if (cut < 1) cut = maxLen;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
