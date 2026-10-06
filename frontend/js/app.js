// IngatKu - aplikasi satu halaman (tanpa framework, tanpa proses build).
import { api, auth } from './api.js';
import * as V from './voice.js';
import { icons, kindIcon, logoSvg, coupleSvg, avatarSvg, robotSvg } from './icons.js';
import {
  esc, ymd, hm, stamp, parseYmd, addDays, addMonths, longDate, shortDay, rangeLabel, sameDay, toast, DAY_NAMES, MONTH_NAMES,
} from './util.js';

const $view = document.getElementById('view');
const $overlay = document.getElementById('overlay');
const PUBLIC_ROUTES = new Set(['splash', 'login', 'register']);
const KINDS = [['obat', 'Obat'], ['kontrol', 'Kontrol'], ['janji', 'Janji'], ['lainnya', 'Lainnya']];

const state = {
  user: null,
  settings: { voice_reply: true, reminder_sound: true, reminder_vibrate: true, speech_rate: 0.85 },
  today: [],
  jadwal: { range: 'day', date: new Date(), items: [], loading: false },
  health: null,
  reminder: null,
  returnTo: '#/home',
  rerender: null,
  reload: null,
};
let routeToken = 0;
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

/* ====================================================================== util tampilan */

function setView(html) {
  $view.innerHTML = html;
  $view.onclick = null;
  $view.onsubmit = null;
  $view.oninput = null;
}

function bindActions(map) {
  $view.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !$view.contains(el)) return;
    const fn = map[el.dataset.action];
    if (fn) fn(el, e);
  };
}

function bindForms(map) {
  $view.onsubmit = (e) => {
    e.preventDefault();
    const form = e.target.closest('form[data-form]');
    if (form && map[form.dataset.form]) map[form.dataset.form](form);
  };
  $view.oninput = (e) => clearFormError(e.target.closest('form'));
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function setBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.textContent = 'Memproses...';
    btn.disabled = true;
  } else {
    if (btn.dataset.label !== undefined) btn.innerHTML = btn.dataset.label;
    btn.disabled = false;
  }
}

function showFormError(form, err) {
  const p = form.querySelector('.form-error');
  if (p) p.textContent = err.message || 'Terjadi kesalahan. Coba lagi.';
  if (err.field && form.elements[err.field]) {
    form.elements[err.field].setAttribute('aria-invalid', 'true');
    form.elements[err.field].focus();
  }
}

function clearFormError(form) {
  if (!form) return;
  const p = form.querySelector('.form-error');
  if (p) p.textContent = '';
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

function navHtml(active) {
  const items = [
    ['home', '#/home', 'Beranda', icons.home],
    ['jadwal', '#/jadwal', 'Jadwal', icons.calendar],
    ['riwayat', '#/riwayat', 'Riwayat', icons.history],
    ['pengaturan', '#/pengaturan', 'Pengaturan', icons.settings],
  ];
  return `<nav class="nav" aria-label="Menu utama">${items
    .map(([key, href, label, icon]) => `<a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`)
    .join('')}</nav>`;
}

function tileClass(it) {
  if (it.kind === 'obat') {
    const h = parseInt(it.time.slice(0, 2), 10);
    return h < 11 ? 'green' : h < 17 ? 'orange' : 'indigo';
  }
  return { kontrol: 'blue', janji: 'purple' }[it.kind] || 'teal';
}

function schedRow(it, { withTime = false } = {}) {
  const label = `${it.done ? 'Batalkan selesai' : 'Tandai selesai'}: ${it.title}`;
  return `<div class="sched">
    <button class="sched-main" data-action="open" data-id="${it.id}">
      ${withTime ? `<span class="sched-time">${esc(it.time)}</span>` : ''}
      <span class="tile ${tileClass(it)}">${kindIcon(it.kind)}</span>
      <span class="sched-text"><strong>${esc(it.title)}</strong><small>${esc(withTime ? it.note : it.time)}</small></span>
    </button>
    <button class="check ${it.done ? 'on' : ''}" data-action="toggle" data-id="${it.id}" role="checkbox" aria-checked="${it.done}" aria-label="${esc(label)}">${it.done ? icons.check : ''}</button>
  </div>`;
}

/* ====================================================================== sheet & dialog */

let sheetState = null;

function closeSheet() {
  if (!sheetState) return;
  const s = sheetState;
  sheetState = null;
  document.removeEventListener('keydown', s.keyHandler);
  s.wrap.remove();
  try { if (s.prevFocus && s.prevFocus.focus) s.prevFocus.focus(); } catch { /* abaikan */ }
  if (s.onClose) s.onClose();
}

function openSheet({ title, html, on = {}, onClose }) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
    <div class="grab"></div>
    <div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2><button type="button" data-sheet-close aria-label="Tutup">${icons.x}</button></div>
    <div class="sheet-body">${html}</div></div>`;
  $overlay.appendChild(wrap);
  const sheet = wrap.firstElementChild;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
    const el = e.target.closest('[data-sheet]');
    if (el && on.click && on.click[el.dataset.sheet]) on.click[el.dataset.sheet](el, e);
  });
  wrap.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.closest('form[data-sform]');
    if (f && on.submit && on.submit[f.dataset.sform]) on.submit[f.dataset.sform](f);
  });
  wrap.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && on.change && on.change[el.dataset.change]) on.change[el.dataset.change](el, e);
  });
  wrap.addEventListener('input', (e) => {
    clearFormError(e.target.closest('form'));
    const el = e.target.closest('[data-input]');
    if (el && on.input && on.input[el.dataset.input]) on.input[el.dataset.input](el, e);
  });
  const keyHandler = (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('button, input, select, a[href]')].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keyHandler);
  sheetState = { wrap, keyHandler, prevFocus: document.activeElement, onClose };
  if (on.mount) on.mount(sheet);
  const auto = sheet.querySelector('[autofocus]');
  (auto || sheet).focus();
  return sheet;
}

function confirmDialog({ title, message, confirmText = 'Ya', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(v);
    };
    openSheet({
      title,
      html: `<p class="msg">${esc(message)}</p><div class="stack">
        <button class="btn ${danger ? 'btn-danger-soft' : 'btn-primary'}" data-sheet="yes">${esc(confirmText)}</button>
        <button class="btn btn-gray" data-sheet="no">Batal</button></div>`,
      on: { click: { yes: () => finish(true), no: () => finish(false) } },
      onClose: () => finish(false),
    });
  });
}

/* ====================================================================== jadwal: data bersama */

const findItem = (id) => state.today.find((i) => i.id === id) || state.jadwal.items.find((i) => i.id === id);

function applyItem(updated) {
  for (const arr of [state.today, state.jadwal.items]) {
    const i = arr.findIndex((x) => x.id === updated.id);
    if (i >= 0) arr[i] = updated;
  }
}

async function toggleDone(id) {
  const item = findItem(id);
  if (!item) return;
  const want = !item.done;
  const before = { ...item };
  applyItem({ ...item, done: want });
  if (state.rerender) state.rerender();
  try {
    const { item: saved } = await api.updateSchedule(id, { done: want });
    applyItem(saved);
    toast(want ? 'Tercatat selesai' : 'Status selesai dibatalkan');
  } catch (e) {
    applyItem(before);
    toast(e.message);
  }
  if (state.rerender) state.rerender();
}

function openDetail(id) {
  const it = findItem(id);
  if (!it) return;
  openSheet({
    title: 'Detail Jadwal',
    html: `<div class="detail-head"><span class="tile ${tileClass(it)}">${kindIcon(it.kind)}</span>
        <div><h3>${esc(it.title)}</h3><p>${esc(longDate(parseYmd(it.date)))}, pukul ${esc(it.time)}</p></div></div>
      ${it.note ? `<p class="msg">${esc(it.note)}</p>` : ''}
      <div class="stack">
        <button class="btn btn-primary" data-sheet="toggle">${icons.check}${it.done ? 'Batalkan Selesai' : 'Tandai Selesai'}</button>
        <button class="btn btn-soft" data-sheet="edit">${icons.edit}Ubah</button>
        <button class="btn btn-danger-soft" data-sheet="delete">${icons.trash}Hapus</button>
      </div>`,
    on: {
      click: {
        toggle: async () => { closeSheet(); await toggleDone(id); },
        edit: () => openScheduleForm(it),
        delete: async () => {
          const ok = await confirmDialog({ title: 'Hapus jadwal?', message: `Jadwal "${it.title}" akan dihapus.`, confirmText: 'Hapus', danger: true });
          if (!ok) return;
          try {
            await api.deleteSchedule(id);
            toast('Jadwal dihapus');
            if (state.reload) await state.reload();
          } catch (e) { toast(e.message); }
        },
      },
    },
  });
}

function openScheduleForm(item = null, defaults = {}) {
  const isEdit = !!item;
  const val = item || { title: '', note: '', kind: 'obat', date: defaults.date || ymd(new Date()), time: defaults.time || '08:00' };
  let kind = val.kind;
  openSheet({
    title: isEdit ? 'Ubah Jadwal' : 'Tambah Jadwal',
    html: `<form data-sform="schedule" novalidate>
      <div class="field"><label for="f-title">Judul</label>
        <div class="input-wrap"><input id="f-title" name="title" maxlength="80" value="${esc(val.title)}" placeholder="Contoh: Minum obat pagi" autocomplete="off" autofocus></div></div>
      <div class="field"><label for="f-note">Keterangan (boleh kosong)</label>
        <div class="input-wrap"><input id="f-note" name="note" maxlength="120" value="${esc(val.note)}" placeholder="Contoh: Obat tekanan darah" autocomplete="off"></div></div>
      <div class="field"><span id="kind-label" class="field-label" style="display:block;font-weight:700;margin-bottom:6px;font-size:.95rem">Jenis</span>
        <div class="chips-row" role="group" aria-labelledby="kind-label">
          ${KINDS.map(([k, l]) => `<button type="button" class="pick" data-sheet="kind" data-kind="${k}" aria-pressed="${k === kind}">${l}</button>`).join('')}
        </div></div>
      <div class="date-time">
        <div class="field"><label for="f-date">Tanggal</label><div class="input-wrap"><input id="f-date" name="date" type="date" value="${esc(val.date)}"></div></div>
        <div class="field"><label for="f-time">Jam</label><div class="input-wrap"><input id="f-time" name="time" type="time" value="${esc(val.time)}"></div></div>
      </div>
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Simpan</button>
    </form>`,
    on: {
      click: {
        kind: (el) => {
          kind = el.dataset.kind;
          el.closest('.chips-row').querySelectorAll('.pick').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
        },
      },
      submit: {
        schedule: async (form) => {
          const payload = {
            title: form.elements.title.value.trim(),
            note: form.elements.note.value.trim(),
            kind,
            date: form.elements.date.value,
            time: form.elements.time.value,
          };
          if (!payload.title) return showFormError(form, { message: 'Judul wajib diisi.', field: 'title' });
          if (!payload.date) return showFormError(form, { message: 'Tanggal wajib diisi.', field: 'date' });
          if (!payload.time) return showFormError(form, { message: 'Jam wajib diisi.', field: 'time' });
          const btn = form.querySelector('button[type=submit]');
          setBusy(btn, true);
          try {
            if (isEdit) await api.updateSchedule(item.id, payload);
            else await api.createSchedule(payload);
            closeSheet();
            toast('Jadwal disimpan');
            if (state.reload) await state.reload();
          } catch (e) {
            setBusy(btn, false);
            showFormError(form, e);
          }
        },
      },
    },
  });
}

/* ====================================================================== layar: splash, masuk, daftar */

function viewSplash() {
  const slides = [
    'Sahabat Digital untuk\nHidup Lebih Sehat dan Mandiri',
    'Pengingat obat dengan\nsuara yang jelas',
    'Cukup bicara,\ntanpa perlu mengetik',
    'Catat kontrol dan janji\ndengan dokter',
    'Tips kesehatan harian\nuntuk lansia',
  ];
  let idx = 0;
  setView(`<div class="screen splash">
    ${logoSvg(84, 'splash')}
    <h1 class="brand">IngatKu</h1>
    <p class="tagline" id="tagline" aria-live="off"></p>
    ${coupleSvg()}
    <div class="dots" role="group" aria-label="Halaman pengantar">
      ${slides.map((_, i) => `<button type="button" data-action="dot" data-i="${i}" aria-label="Halaman ${i + 1}"></button>`).join('')}
    </div>
    <button class="btn btn-primary" data-action="start">Mulai</button>
    <p class="after">Sudah punya akun? <button class="link-btn" data-action="login" style="padding:0">Masuk</button></p>
  </div>`);
  const paint = () => {
    document.getElementById('tagline').innerHTML = esc(slides[idx]).replace('\n', '<br>');
    $view.querySelectorAll('.dots button').forEach((b, i) => {
      if (i === idx) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  };
  paint();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = setInterval(() => { idx = (idx + 1) % slides.length; paint(); }, 4500);
    onLeave(() => clearInterval(t));
  }
  bindActions({
    dot: (el) => { idx = Number(el.dataset.i); paint(); },
    start: () => go('#/register'),
    login: () => go('#/login'),
  });
}

function passwordField(id, name, placeholder, autocomplete) {
  return `<div class="field"><label class="sr-only" for="${id}">${placeholder}</label>
    <div class="input-wrap">${icons.lock}
      <input id="${id}" name="${name}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}">
      <button type="button" class="toggle-eye" data-action="eye" aria-label="Tampilkan password" aria-pressed="false">${icons.eye}</button>
    </div></div>`;
}

function eyeAction(el) {
  const input = el.closest('.input-wrap').querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  el.innerHTML = show ? icons.eyeOff : icons.eye;
  el.setAttribute('aria-pressed', String(show));
  el.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
}

async function afterAuth(token, user) {
  auth.set(token);
  state.user = user;
  try {
    const st = await api.getSettings();
    state.settings = st.settings;
  } catch { /* pakai bawaan */ }
  startPolling();
  go('#/home');
}

function viewLogin() {
  setView(`<div class="screen">
    <button class="back" data-action="back" aria-label="Kembali">${icons.chevronLeft}</button>
    <div class="auth-head">${logoSvg(76, 'login')}<h1>Selamat Datang</h1><p class="sub">Masuk untuk melanjutkan ke IngatKu</p></div>
    <form data-form="login" novalidate>
      <div class="field"><label class="sr-only" for="l-phone">Nomor HP</label>
        <div class="input-wrap">${icons.phone}<input id="l-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Nomor HP"></div></div>
      ${passwordField('l-pass', 'password', 'Password', 'current-password')}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Masuk</button>
    </form>
    <div class="or">atau</div>
    <button class="btn btn-outline" data-action="register">${icons.user}Daftar dengan Nomor HP</button>
    <p class="center" style="margin-top:14px"><button class="link-btn" data-action="forgot">Lupa password?</button></p>
  </div>`);
  bindActions({
    back: () => go('#/splash'),
    register: () => go('#/register'),
    eye: eyeAction,
    forgot: () => openSheet({
      title: 'Lupa password?',
      html: `<p class="msg">Demi keamanan, password hanya bisa diatur ulang oleh pengelola aplikasi. Silakan hubungi pengelola atau pendamping Anda.</p>
        <p class="msg">Jika Anda masih bisa masuk di perangkat lain, ubah password lewat Pengaturan, lalu Keamanan &amp; Privasi.</p>
        <button class="btn btn-primary" data-sheet-close>Mengerti</button>`,
    }),
  });
  bindForms({
    login: async (form) => {
      const btn = form.querySelector('button[type=submit]');
      clearFormError(form);
      setBusy(btn, true);
      try {
        const { token, user } = await api.login(form.elements.phone.value, form.elements.password.value);
        await afterAuth(token, user);
      } catch (e) {
        setBusy(btn, false);
        showFormError(form, e);
      }
    },
  });
}

function viewRegister() {
  let salutation = 'Pak';
  setView(`<div class="screen">
    <button class="back" data-action="back" aria-label="Kembali">${icons.chevronLeft}</button>
    <div class="auth-head">${logoSvg(64, 'reg')}<h1>Buat Akun</h1><p class="sub">Daftar dengan nomor HP Anda</p></div>
    <form data-form="register" novalidate>
      <div class="field"><label class="sr-only" for="r-name">Nama lengkap</label>
        <div class="input-wrap">${icons.user}<input id="r-name" name="name" autocomplete="name" placeholder="Nama lengkap" maxlength="60"></div></div>
      <div class="field"><span id="sal-label" class="sr-only">Sapaan</span>
        <div class="chips-row" role="group" aria-labelledby="sal-label">
          <button type="button" class="pick" data-action="sal" data-v="Pak" aria-pressed="true">Bapak (Pak)</button>
          <button type="button" class="pick" data-action="sal" data-v="Bu" aria-pressed="false">Ibu (Bu)</button>
        </div></div>
      <div class="field"><label class="sr-only" for="r-age">Usia</label>
        <div class="input-wrap">${icons.calendar}<input id="r-age" name="age" type="number" inputmode="numeric" min="1" max="120" placeholder="Usia (boleh kosong)"></div></div>
      <div class="field"><label class="sr-only" for="r-phone">Nomor HP</label>
        <div class="input-wrap">${icons.phone}<input id="r-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Nomor HP, contoh 081234567890"></div></div>
      ${passwordField('r-pass', 'password', 'Password (minimal 6 karakter)', 'new-password')}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Daftar</button>
    </form>
    <p class="center" style="margin-top:14px">Sudah punya akun? <button class="link-btn" data-action="login" style="padding:0">Masuk</button></p>
  </div>`);
  bindActions({
    back: () => go('#/splash'),
    login: () => go('#/login'),
    eye: eyeAction,
    sal: (el) => {
      salutation = el.dataset.v;
      $view.querySelectorAll('[data-action=sal]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    },
  });
  bindForms({
    register: async (form) => {
      const btn = form.querySelector('button[type=submit]');
      clearFormError(form);
      setBusy(btn, true);
      try {
        const body = {
          name: form.elements.name.value,
          salutation,
          phone: form.elements.phone.value,
          password: form.elements.password.value,
        };
        if (form.elements.age.value) body.age = form.elements.age.value;
        const { token, user } = await api.register(body);
        await afterAuth(token, user);
      } catch (e) {
        setBusy(btn, false);
        showFormError(form, e);
      }
    },
  });
}

/* ====================================================================== layar: beranda */

function renderToday() {
  const el = document.getElementById('today-list');
  if (!el) return;
  if (!state.today.length) {
    el.innerHTML = `<div class="empty">Belum ada jadwal hari ini.<br>Tekan mikrofon di atas lalu ucapkan, misalnya: "Ingatkan saya minum obat jam 8 pagi".
      <button class="btn btn-primary" data-action="add">${icons.plus}Tambah Jadwal</button></div>`;
    return;
  }
  el.innerHTML = state.today.map((it) => schedRow(it)).join('');
}

async function loadToday(tok) {
  try {
    const r = await api.schedules(ymd(new Date()), 'day');
    if (tok !== routeToken) return;
    state.today = r.items;
  } catch (e) {
    if (tok !== routeToken) return;
    toast(e.message);
  }
  renderToday();
}

function viewHome(tok) {
  const u = state.user;
  setView(`<div class="screen">
    <header class="greet">
      <div><h1>Halo, ${esc(u.greeting_name)}</h1><p>Semoga hari ini menyenangkan!</p></div>
      ${avatarSvg(u.salutation, 56)}
    </header>
    <button class="voice-card" data-action="voice" aria-label="Tekan untuk beri perintah suara">
      <span class="mic-btn">${icons.mic}</span>
      <span class="lead">Tekan untuk<br>beri perintah suara</span>
      <span class="wave" aria-hidden="true">${'<i></i>'.repeat(17)}</span>
    </button>
    <div class="section-head"><h2>Jadwal Hari Ini</h2>
      <button data-action="go" data-to="#/jadwal">Lihat Semua${icons.chevronRight}</button></div>
    <div class="list" id="today-list" aria-live="polite"><p class="empty">Memuat jadwal...</p></div>
    <div class="section-head"><h2>Informasi Kesehatan</h2>
      <button data-action="go" data-to="#/info">Lihat Semua${icons.chevronRight}</button></div>
    <button class="link-card" data-action="go" data-to="#/info">
      <span class="tile orange">${icons.brain}</span>
      <span><strong>Tips Kesehatan Harian</strong><small>Otak, olahraga, makanan, dan tidur</small></span>
    </button>
  </div>${navHtml('home')}`);
  state.today = [];
  state.rerender = renderToday;
  state.reload = () => loadToday(tok);
  bindActions({
    voice: () => go('#/suara'),
    go: (el) => go(el.dataset.to),
    add: () => openScheduleForm(null),
    open: (el) => openDetail(Number(el.dataset.id)),
    toggle: (el) => toggleDone(Number(el.dataset.id)),
  });
  loadToday(tok);
}

/* ====================================================================== layar: jadwal */

let jadwalSeq = 0;

function renderJadwal() {
  const J = state.jadwal;
  const label = document.getElementById('date-label');
  if (label) label.textContent = rangeLabel(J.date, J.range);
  $view.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === J.range)));
  const el = document.getElementById('jadwal-list');
  if (!el) return;
  if (J.loading) { el.innerHTML = '<p class="empty">Memuat jadwal...</p>'; return; }
  if (!J.items.length) {
    const what = { day: 'tanggal ini', week: 'minggu ini', month: 'bulan ini' }[J.range];
    el.innerHTML = `<div class="empty">Belum ada jadwal untuk ${what}.<button class="btn btn-primary" data-action="add">${icons.plus}Tambah Jadwal</button></div>`;
    return;
  }
  if (J.range === 'day') {
    el.innerHTML = `<div class="list">${J.items.map((it) => schedRow(it, { withTime: true })).join('')}</div>`;
    return;
  }
  const groups = new Map();
  for (const it of J.items) {
    if (!groups.has(it.date)) groups.set(it.date, []);
    groups.get(it.date).push(it);
  }
  const today = new Date();
  el.innerHTML = [...groups.entries()].map(([date, items]) => {
    const d = parseYmd(date);
    return `<section class="day-group"><h3>${esc(shortDay(d))}${sameDay(d, today) ? '<em>Hari ini</em>' : ''}</h3>
      <div class="list">${items.map((it) => schedRow(it, { withTime: true })).join('')}</div></section>`;
  }).join('');
}

async function loadJadwal({ quiet = false } = {}) {
  const J = state.jadwal;
  const seq = ++jadwalSeq;
  if (!quiet) { J.loading = true; renderJadwal(); }
  try {
    const r = await api.schedules(ymd(J.date), J.range);
    if (seq !== jadwalSeq) return;
    J.items = r.items;
  } catch (e) {
    if (seq !== jadwalSeq) return;
    J.items = [];
    toast(e.message);
  }
  J.loading = false;
  renderJadwal();
}

function shiftJadwal(dir) {
  const J = state.jadwal;
  J.date = J.range === 'day' ? addDays(J.date, dir) : J.range === 'week' ? addDays(J.date, 7 * dir) : addMonths(J.date, dir);
  loadJadwal();
}

function viewJadwal() {
  const J = state.jadwal;
  J.range = 'day';
  J.date = new Date();
  J.items = [];
  setView(`<div class="screen has-fab">
    <h1 class="page-title">Jadwal</h1>
    <div class="date-nav">
      <button data-action="prev" aria-label="Sebelumnya">${icons.chevronLeft}</button>
      <strong id="date-label" aria-live="polite"></strong>
      <button data-action="next" aria-label="Berikutnya">${icons.chevronRight}</button>
    </div>
    <div class="seg" role="group" aria-label="Rentang jadwal">
      <button data-action="range" data-range="day" aria-pressed="true">Hari Ini</button>
      <button data-action="range" data-range="week" aria-pressed="false">Minggu Ini</button>
      <button data-action="range" data-range="month" aria-pressed="false">Bulan Ini</button>
    </div>
    <div id="jadwal-list" aria-live="polite"></div>
  </div>
  <button class="fab" data-action="add" aria-label="Tambah jadwal">${icons.plus}</button>
  ${navHtml('jadwal')}`);
  state.rerender = renderJadwal;
  state.reload = () => loadJadwal({ quiet: true });
  bindActions({
    prev: () => shiftJadwal(-1),
    next: () => shiftJadwal(1),
    range: (el) => { J.range = el.dataset.range; J.date = new Date(); loadJadwal(); },
    add: () => openScheduleForm(null, { date: ymd(J.date) }),
    open: (el) => openDetail(Number(el.dataset.id)),
    toggle: (el) => toggleDone(Number(el.dataset.id)),
  });
  loadJadwal();
}

/* ====================================================================== layar: riwayat */

const HIST_PAGE = 50;
let histItems = [];
let histMore = false;
let histStats = null;

const HIST_LABEL = {
  selesai: ['Selesai', icons.check],
  dibatalkan: ['Status selesai dibatalkan', icons.x],
  ditunda: ['Ditunda', icons.history],
  dibuat: ['Jadwal ditambahkan', icons.plus],
  dihapus: ['Jadwal dihapus', icons.trash],
  suara: ['Perintah suara', icons.mic],
};

function renderHistory() {
  const stat = document.getElementById('stat');
  const list = document.getElementById('hist-list');
  const more = document.getElementById('more');
  if (!list) return;
  if (stat) {
    stat.innerHTML = histStats
      ? `<div class="stat-card"><b>${histStats.selesai_7_hari}</b><span>kegiatan selesai<br>dalam 7 hari terakhir</span></div>` : '';
  }
  if (!histItems.length) {
    list.innerHTML = '<div class="empty">Belum ada riwayat. Kegiatan yang Anda selesaikan akan tercatat di sini.</div>';
    if (more) more.innerHTML = '';
    return;
  }
  const groups = new Map();
  for (const it of histItems) {
    const d = new Date(it.created_at);
    const key = ymd(d);
    if (!groups.has(key)) groups.set(key, { d, items: [] });
    groups.get(key).items.push({ ...it, _d: d });
  }
  const today = new Date();
  const yesterday = addDays(today, -1);
  list.innerHTML = [...groups.values()].map(({ d, items }) => {
    const head = sameDay(d, today) ? 'Hari ini' : sameDay(d, yesterday) ? 'Kemarin' : longDate(d);
    return `<section class="day-group"><h3>${esc(head)}</h3><div class="list">${items.map((it) => {
      const [label, icon] = HIST_LABEL[it.action] || [it.action, icons.info];
      const detail = it.detail ? `, ${it.detail}` : '';
      return `<div class="hist"><span class="dot ${esc(it.action)}">${icon}</span>
        <div class="txt"><strong>${esc(it.title)}</strong><small>${esc(label + detail)}</small></div><time>${esc(hm(it._d))}</time></div>`;
    }).join('')}</div></section>`;
  }).join('');
  if (more) more.innerHTML = histMore ? '<button class="btn btn-soft" data-action="more" style="margin-top:14px">Muat lebih banyak</button>' : '';
}

async function loadHistory(tok, offset = 0) {
  try {
    const r = await api.history(HIST_PAGE, offset);
    if (tok !== routeToken) return;
    histItems = offset ? histItems.concat(r.items) : r.items;
    histMore = r.items.length === HIST_PAGE;
    histStats = r.stats;
  } catch (e) {
    if (tok !== routeToken) return;
    toast(e.message);
  }
  renderHistory();
}

function viewRiwayat(tok) {
  histItems = [];
  histMore = false;
  histStats = null;
  setView(`<div class="screen">
    <h1 class="page-title">Riwayat</h1>
    <div id="stat"></div>
    <div id="hist-list" aria-live="polite"><p class="empty">Memuat riwayat...</p></div>
    <div id="more"></div>
  </div>${navHtml('riwayat')}`);
  bindActions({ more: () => loadHistory(tok, histItems.length) });
  loadHistory(tok);
}

/* ====================================================================== layar: informasi kesehatan */

async function ensureHealth() {
  if (!state.health) state.health = await api.healthInfo();
  return state.health;
}

async function viewInfo(tok) {
  setView(`<div class="screen">
    <div class="topbar"><button class="back" data-action="back" aria-label="Kembali">${icons.chevronLeft}</button><h1>Informasi Kesehatan</h1></div>
    <div class="list" id="info-list"><p class="empty">Memuat informasi...</p></div>
  </div>${navHtml('home')}`);
  bindActions({
    back: () => go('#/home'),
    article: (el) => go(`#/info/${el.dataset.id}`),
    retry: () => viewInfo(tok),
  });
  try {
    const data = await ensureHealth();
    if (tok !== routeToken) return;
    document.getElementById('info-list').innerHTML = data.items.map((a) => `
      <button class="info-card c-${esc(a.color)}" data-action="article" data-id="${esc(a.id)}">
        <span class="badge">${icons[a.icon] || icons.info}</span>
        <span><strong>${esc(a.title)}</strong><small>${esc(a.summary)}</small></span>${icons.chevronRight}
      </button>`).join('');
  } catch (e) {
    if (tok !== routeToken) return;
    document.getElementById('info-list').innerHTML = `<div class="empty">${esc(e.message)}<button class="btn btn-primary" data-action="retry">Coba Lagi</button></div>`;
  }
}

async function viewArticle(tok, id) {
  setView(`<div class="screen">
    <div class="topbar"><button class="back" data-action="back" aria-label="Kembali">${icons.chevronLeft}</button><h1>Informasi Kesehatan</h1></div>
    <div id="article"><p class="empty">Memuat...</p></div>
  </div>${navHtml('home')}`);
  bindActions({ back: () => go('#/info') });
  try {
    const data = await ensureHealth();
    if (tok !== routeToken) return;
    const a = data.items.find((x) => x.id === id);
    if (!a) { go('#/info'); return; }
    document.getElementById('article').innerHTML = `
      <div class="article-hero c-${esc(a.color)}"><span class="badge">${icons[a.icon] || icons.info}</span>
        <h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p></div>
      <div class="prose">${a.body.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      <h3 class="h3">Yang bisa Anda lakukan</h3>
      <ul class="tips">${a.tips.map((t) => `<li>${icons.check}<span>${esc(t)}</span></li>`).join('')}</ul>
      <p class="notice">${esc(data.disclaimer)}</p>`;
  } catch (e) {
    if (tok !== routeToken) return;
    document.getElementById('article').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ====================================================================== layar: pengaturan */

function viewSettings() {
  const u = state.user;
  const row = (action, icon, title, sub = '') => `<button class="menu-row" data-action="${action}">${icon}
    <span class="txt"><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ''}</span>${icons.chevronRight}</button>`;
  setView(`<div class="screen">
    <h1 class="page-title">Pengaturan</h1>
    <div class="profile-card">${avatarSvg(u.salutation, 62)}
      <div><strong>${esc(u.salutation)} ${esc(u.name)}</strong><small>${u.age ? `Usia ${u.age} tahun` : 'Usia belum diisi'}</small></div></div>
    <div class="menu">
      ${row('profile', icons.user, 'Profil Saya')}
      ${row('voice', icons.volume, 'Suara &amp; Bahasa', 'Bahasa Indonesia')}
      ${row('notif', icons.bell, 'Notifikasi', 'Pengingat, suara, dan getar')}
      ${row('security', icons.shield, 'Keamanan &amp; Privasi')}
      ${row('help', icons.help, 'Bantuan')}
      ${row('about', icons.info, 'Tentang IngatKu')}
    </div>
    <button class="btn btn-gray logout" data-action="logout">${icons.logout}Keluar</button>
  </div>${navHtml('pengaturan')}`);
  bindActions({
    profile: openProfileSheet,
    voice: openVoiceSheet,
    notif: openNotifSheet,
    security: openSecuritySheet,
    help: openHelpSheet,
    about: openAboutSheet,
    logout: async () => {
      const ok = await confirmDialog({ title: 'Keluar dari IngatKu?', message: 'Anda perlu masuk lagi dengan nomor HP dan password.', confirmText: 'Keluar' });
      if (ok) logout();
    },
  });
}

function logout() {
  auth.clear();
  state.user = null;
  stopPolling();
  V.stopSpeaking();
  go('#/login');
}

function openProfileSheet() {
  const u = state.user;
  let sal = u.salutation;
  openSheet({
    title: 'Profil Saya',
    html: `<form data-sform="profile" novalidate>
      <div class="field"><label for="p-name">Nama lengkap</label><div class="input-wrap"><input id="p-name" name="name" value="${esc(u.name)}" maxlength="60" autocomplete="name" autofocus></div></div>
      <div class="field"><span id="p-sal" style="display:block;font-weight:700;margin-bottom:6px;font-size:.95rem">Sapaan</span>
        <div class="chips-row" role="group" aria-labelledby="p-sal">
          <button type="button" class="pick" data-sheet="sal" data-v="Pak" aria-pressed="${sal === 'Pak'}">Bapak (Pak)</button>
          <button type="button" class="pick" data-sheet="sal" data-v="Bu" aria-pressed="${sal === 'Bu'}">Ibu (Bu)</button>
        </div></div>
      <div class="field"><label for="p-age">Usia</label><div class="input-wrap"><input id="p-age" name="age" type="number" inputmode="numeric" min="1" max="120" value="${u.age ?? ''}"></div></div>
      <p class="field-hint" style="margin-bottom:10px">Nomor HP: ${esc(u.phone)}</p>
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Simpan</button>
    </form>`,
    on: {
      click: {
        sal: (el) => {
          sal = el.dataset.v;
          el.closest('.chips-row').querySelectorAll('.pick').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
        },
      },
      submit: {
        profile: async (form) => {
          const btn = form.querySelector('button[type=submit]');
          setBusy(btn, true);
          try {
            const body = { name: form.elements.name.value, salutation: sal, age: form.elements.age.value || null };
            const { user } = await api.updateMe(body);
            state.user = user;
            closeSheet();
            toast('Profil disimpan');
            viewSettings();
          } catch (e) {
            setBusy(btn, false);
            showFormError(form, e);
          }
        },
      },
    },
  });
}

async function saveSetting(patch, el) {
  const prev = { ...state.settings };
  state.settings = { ...state.settings, ...patch };
  try {
    const { settings } = await api.putSettings(patch);
    state.settings = settings;
  } catch (e) {
    state.settings = prev;
    if (el && el.type === 'checkbox') el.checked = !!prev[Object.keys(patch)[0]];
    toast(e.message);
  }
}

function switchRow(name, title, hint, checked) {
  return `<div class="switch-row"><div><strong id="sw-${name}">${title}</strong><small>${hint}</small></div>
    <label class="switch"><input type="checkbox" data-change="${name}" aria-labelledby="sw-${name}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

function openVoiceSheet() {
  const s = state.settings;
  openSheet({
    title: 'Suara & Bahasa',
    html: `<div class="switch-row"><div><strong>Bahasa</strong><small>Bahasa Indonesia</small></div></div>
      ${switchRow('voice_reply', 'Jawaban dengan suara', 'Asisten membacakan jawaban perintah suara', s.voice_reply)}
      <div class="field" style="margin-top:14px"><label for="rate">Kecepatan suara: <span id="rate-val">${Number(s.speech_rate).toFixed(2)}x</span></label>
        <input id="rate" type="range" min="0.6" max="1.3" step="0.05" value="${s.speech_rate}" data-input="rate" data-change="speech_rate">
        <p class="field-hint">Geser ke kiri agar suara lebih pelan. Disarankan 0.80 sampai 0.90 untuk lansia.</p></div>
      <div class="field"><label for="voice-pick">Pilihan suara</label>
        <select id="voice-pick" data-change="voice_pick"><option value="auto">Otomatis (disarankan)</option></select>
        <p class="field-hint" id="voice-hint">Memeriksa suara Indonesia di perangkat ini...</p></div>
      <p class="field-hint" id="engine" style="margin-bottom:12px"></p>
      <button class="btn btn-soft" data-sheet="test">${icons.volume}Coba Suara</button>`,
    on: {
      change: {
        voice_reply: (el) => saveSetting({ voice_reply: el.checked }, el),
        speech_rate: (el) => saveSetting({ speech_rate: Number(el.value) }, el),
        voice_pick: (el) => V.setVoicePref(el.value),
      },
      input: { rate: (el) => { document.getElementById('rate-val').textContent = `${Number(el.value).toFixed(2)}x`; } },
      click: {
        test: () => V.speak(
          `Halo ${state.user.greeting_name}. Saya IngatKu, siap membantu Anda. Waktunya minum obat pukul 08.00 pagi.`,
          Number(document.getElementById('rate').value),
        ),
      },
      mount: async () => {
        const [c, opts] = await Promise.all([V.capabilities(), V.voiceOptions()]);
        const el = document.getElementById('engine');
        const pick = document.getElementById('voice-pick');
        const hint = document.getElementById('voice-hint');
        if (!el || !pick) return;
        const stt = c.serverStt ? 'Whisper (server)' : c.browserStt ? 'bawaan peramban' : 'tidak tersedia';
        const tts = c.serverTts ? (c.ttsProvider === 'google' ? 'Google Cloud (server)' : 'VITS (server)') : c.browserTts ? 'bawaan peramban' : 'tidak tersedia';
        el.textContent = `Pengenalan ucapan: ${stt}. Suara: ${tts}.`;
        if (opts.server) pick.insertAdjacentHTML('beforeend', '<option value="server">Suara server (Indonesia)</option>');
        opts.browser.forEach((v) => {
          const o = document.createElement('option');
          o.value = v.id;
          o.textContent = `${v.name}${v.good ? ' (jernih)' : ''}`;
          pick.appendChild(o);
        });
        const saved = V.getVoicePref();
        pick.value = [...pick.options].some((o) => o.value === saved) ? saved : 'auto';
        hint.textContent = opts.browser.length || opts.server
          ? 'Hanya suara Bahasa Indonesia yang dipakai, agar pengucapan jelas tanpa aksen asing.'
          : 'Perangkat ini belum punya suara Bahasa Indonesia. Lihat petunjuk pemasangan di bawah.';
        if (!opts.browser.length && !opts.server) {
          hint.insertAdjacentHTML('afterend', '<p class="field-hint">Android: Pengaturan > Sistem > Bahasa > Output teks-ke-ucapan > Google > Pasang data suara Indonesia. iPhone: Pengaturan > Aksesibilitas > Konten Terucap > Suara > Indonesia. Windows: pakai Microsoft Edge (suara Gadis atau Ardi).</p>');
        }
      },
    },
    onClose: () => V.stopSpeaking(),
  });
}

function openNotifSheet() {
  const s = state.settings;
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  openSheet({
    title: 'Notifikasi',
    html: `${switchRow('reminder_sound', 'Suara pengingat', 'Ucapkan pengingat dengan suara', s.reminder_sound)}
      ${switchRow('reminder_vibrate', 'Getar', 'Getarkan ponsel saat waktunya tiba', s.reminder_vibrate)}
      <p class="field-hint" style="margin:12px 0">Pengingat muncul saat IngatKu sedang terbuka di layar atau di latar belakang peramban.</p>
      <div class="stack">
        <button class="btn btn-soft" data-sheet="test">${icons.bell}Coba Pengingat</button>
        ${canAsk ? '<button class="btn btn-outline" data-sheet="allow">Izinkan notifikasi peramban</button>' : ''}
      </div>`,
    on: {
      change: {
        reminder_sound: (el) => saveSetting({ reminder_sound: el.checked }, el),
        reminder_vibrate: (el) => saveSetting({ reminder_vibrate: el.checked }, el),
      },
      click: {
        test: () => {
          closeSheet();
          showReminder({ id: 0, title: 'Minum Obat Pagi', note: 'Obat tekanan darah', kind: 'obat', date: ymd(new Date()), time: '08:00', done: false, snooze_until: null }, { preview: true });
        },
        allow: async (el) => {
          try {
            const r = await Notification.requestPermission();
            toast(r === 'granted' ? 'Notifikasi peramban diizinkan' : 'Notifikasi tidak diizinkan');
            if (r !== 'default') el.remove();
          } catch { toast('Peramban ini tidak mendukung notifikasi'); }
        },
      },
    },
  });
}

function openSecuritySheet() {
  openSheet({
    title: 'Keamanan & Privasi',
    html: `<form data-sform="password" novalidate>
      <h3 class="h3" style="margin-top:0">Ganti password</h3>
      <div class="field"><label class="sr-only" for="s-old">Password lama</label>
        <div class="input-wrap">${icons.lock}<input id="s-old" name="old_password" type="password" placeholder="Password lama" autocomplete="current-password"></div></div>
      <div class="field"><label class="sr-only" for="s-new">Password baru</label>
        <div class="input-wrap">${icons.lock}<input id="s-new" name="new_password" type="password" placeholder="Password baru (minimal 6 karakter)" autocomplete="new-password"></div></div>
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Simpan Password</button>
    </form>
    <h3 class="h3">Data saya</h3>
    <p class="field-hint" style="margin-bottom:10px">Data Anda tersimpan di server IngatKu dan hanya bisa dilihat setelah Anda masuk.</p>
    <div class="stack">
      <button class="btn btn-danger-soft" data-sheet="clear">${icons.trash}Hapus semua jadwal &amp; riwayat</button>
      <button class="btn btn-danger-soft" data-sheet="delete">${icons.trash}Hapus akun</button>
    </div>`,
    on: {
      submit: {
        password: async (form) => {
          const btn = form.querySelector('button[type=submit]');
          setBusy(btn, true);
          try {
            await api.changePassword(form.elements.old_password.value, form.elements.new_password.value);
            closeSheet();
            toast('Password berhasil diganti');
          } catch (e) {
            setBusy(btn, false);
            showFormError(form, e);
          }
        },
        deleteAccount: async (form) => {
          const btn = form.querySelector('button[type=submit]');
          setBusy(btn, true);
          try {
            await api.deleteAccount(form.elements.password.value);
            closeSheet();
            toast('Akun dihapus');
            logout();
          } catch (e) {
            setBusy(btn, false);
            showFormError(form, e);
          }
        },
      },
      click: {
        clear: async () => {
          const ok = await confirmDialog({ title: 'Hapus semua data?', message: 'Semua jadwal dan riwayat akan dihapus dan tidak bisa dikembalikan.', confirmText: 'Hapus Semua', danger: true });
          if (!ok) return;
          try {
            await api.clearData();
            state.today = [];
            state.jadwal.items = [];
            toast('Semua jadwal dan riwayat dihapus');
          } catch (e) { toast(e.message); }
        },
        delete: () => {
          openSheet({
            title: 'Hapus akun',
            html: `<form data-sform="deleteAccount" novalidate>
              <p class="msg">Akun beserta seluruh jadwal dan riwayat akan dihapus permanen. Masukkan password Anda untuk melanjutkan.</p>
              <div class="field"><label class="sr-only" for="d-pass">Password</label>
                <div class="input-wrap">${icons.lock}<input id="d-pass" name="password" type="password" placeholder="Password" autocomplete="current-password" autofocus></div></div>
              <p class="form-error" role="alert"></p>
              <button class="btn btn-danger-soft" type="submit">Hapus Akun Saya</button></form>`,
            on: {
              submit: {
                deleteAccount: async (form) => {
                  const btn = form.querySelector('button[type=submit]');
                  setBusy(btn, true);
                  try {
                    await api.deleteAccount(form.elements.password.value);
                    closeSheet();
                    toast('Akun dihapus');
                    logout();
                  } catch (e) {
                    setBusy(btn, false);
                    showFormError(form, e);
                  }
                },
              },
            },
          });
        },
      },
    },
  });
}

function openHelpSheet() {
  openSheet({
    title: 'Bantuan',
    html: `<div class="faq">
      <h3>Cara memberi perintah suara</h3>
      <p>Di Beranda, tekan kartu biru bertulisan "Tekan untuk beri perintah suara", lalu ucapkan perintah. Contoh: "Ingatkan saya minum obat jam 8 pagi", "Cek jadwal besok", atau "Sudah minum obat".</p>
      <h3>Jika mikrofon tidak berfungsi</h3>
      <p>Izinkan akses mikrofon saat peramban meminta. Mikrofon hanya bisa dipakai lewat alamat https atau localhost. Anda juga bisa mengetuk contoh perintah di layar suara.</p>
      <h3>Cara menambah jadwal tanpa suara</h3>
      <p>Buka menu Jadwal, lalu tekan tombol biru bertanda plus.</p>
      <h3>Pengingat tidak muncul</h3>
      <p>Pengingat muncul saat IngatKu terbuka di peramban. Biarkan halaman tetap terbuka dan nyalakan suara ponsel.</p>
      <h3>Informasi penting</h3>
      <p>IngatKu membantu mengingatkan, tetapi tidak menggantikan dokter. Minum obat sesuai petunjuk dokter.</p></div>`,
  });
}

function openAboutSheet() {
  openSheet({
    title: 'Tentang IngatKu',
    html: `<div class="center" style="margin-bottom:12px">${logoSvg(64, 'about')}<h3 class="h3" style="margin-top:6px">IngatKu</h3><p class="field-hint">Versi 1.0</p></div>
      <p class="msg">IngatKu adalah asisten memori suara untuk lansia. Aplikasi ini membantu mengingat jadwal obat, kontrol kesehatan, dan janji dengan dokter lewat perintah suara Bahasa Indonesia.</p>
      <p class="notice">Informasi kesehatan di aplikasi ini bersifat umum dan bukan pengganti nasihat dokter.</p>`,
  });
}

/* ====================================================================== pengingat */

const DISMISS_KEY = 'ingatku.dismissed';
const dismissKey = (it) => `${it.id}|${it.date}|${it.snooze_until || ''}`;

function getDismissed() {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
}

function markDismissed(it) {
  const s = getDismissed();
  s.add(dismissKey(it));
  try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-100))); } catch { /* abaikan */ }
}

let pollTimer = null;

function startPolling() {
  stopPolling();
  checkDue();
  pollTimer = setInterval(checkDue, 30000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function checkDue() {
  if (!auth.token() || !state.user) return;
  const { name } = parseHash();
  if (name === 'pengingat' || name === 'suara') return;
  const now = new Date();
  try {
    const { items } = await api.due(ymd(now), hm(now));
    const dismissed = getDismissed();
    const next = items.find((it) => !dismissed.has(dismissKey(it)));
    if (next) showReminder(next);
  } catch { /* abaikan; coba lagi 30 detik lagi */ }
}

function showReminder(item, { preview = false } = {}) {
  state.reminder = { item, preview };
  const cur = location.hash;
  if (!cur.startsWith('#/pengingat')) state.returnTo = cur || '#/home';
  if (!preview && document.hidden && 'Notification' in window && Notification.permission === 'granted' && state.settings.reminder_sound) {
    try { new Notification('IngatKu', { body: `${state.user.greeting_name}, waktunya ${item.title.toLowerCase()}.` }); } catch { /* abaikan */ }
  }
  go('#/pengingat');
}

function leaveReminder() {
  state.reminder = null;
  const back = state.returnTo && !state.returnTo.startsWith('#/pengingat') ? state.returnTo : '#/home';
  go(back);
}

const reminderTitle = (it) => ({
  obat: 'Waktunya Minum Obat',
  kontrol: 'Waktunya Kontrol Kesehatan',
  janji: 'Waktunya Janji dengan Dokter',
}[it.kind] || `Waktunya ${it.title}`);

const doneLabel = (it) => (it.kind === 'obat' ? 'Sudah Minum' : 'Sudah Selesai');

function viewReminder(tok) {
  const r = state.reminder;
  if (!r) { go('#/home'); return; }
  const { item, preview } = r;
  const g = state.user.greeting_name;
  let finished = false;
  setView(`<div class="screen">
    <div class="topbar"><button class="back" data-action="dismiss" aria-label="Kembali">${icons.chevronLeft}</button><h1>Pengingat</h1></div>
    <section class="reminder-card" aria-labelledby="rm-title">
      <div class="reminder-head"><span class="tile ${tileClass(item)}">${kindIcon(item.kind)}</span>
        <div><h2 id="rm-title">${esc(reminderTitle(item))}</h2><p>${esc(item.note || item.title)}</p></div></div>
      <div class="big-time" aria-label="Pukul ${esc(item.time)}">${esc(item.time)}</div>
      <div class="stack">
        <button class="btn btn-primary" data-action="done">${esc(doneLabel(item))}</button>
        <button class="btn btn-soft" data-action="snooze">Tunda 10 Menit</button>
      </div>
    </section>
    <div class="bubble-row">${robotSvg(46)}
      <div class="bubble" id="bubble" aria-live="polite"><strong>Halo, ${esc(g)}!</strong>
        <span>${item.kind === 'obat' ? 'Minum obatnya dengan air putih ya.' : 'Jangan sampai terlewat ya.'}</span></div></div>
  </div>`);
  onLeave(() => V.stopSpeaking());
  if (state.settings.reminder_vibrate && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  if (state.settings.reminder_sound) {
    V.speak(`${g}, waktunya ${item.title.toLowerCase()}.${item.note ? ` ${item.note}.` : ''}`, state.settings.speech_rate);
  }
  bindActions({
    dismiss: () => {
      if (!preview) markDismissed(item);
      leaveReminder();
    },
    done: async (el) => {
      if (finished) return;
      finished = true;
      el.disabled = true;
      try {
        if (!preview) await api.updateSchedule(item.id, { done: true });
      } catch (e) {
        finished = false;
        el.disabled = false;
        toast(e.message);
        return;
      }
      if (tok !== routeToken) return;
      V.stopSpeaking();
      const praise = item.kind === 'obat'
        ? 'Jangan lupa minum air putih setelah obat ya.'
        : 'Terima kasih sudah menjaga kesehatan Anda.';
      document.getElementById('bubble').innerHTML = `<strong>Bagus, ${esc(g)}!</strong><span>${esc(praise)}</span>`;
      if (state.settings.reminder_sound) V.speak(`Bagus, ${g}. ${praise}`, state.settings.speech_rate);
      setTimeout(() => { if (tok === routeToken) leaveReminder(); }, 2800);
    },
    snooze: async () => {
      if (finished) return;
      try {
        if (!preview) await api.snooze(item.id, 10, stamp(new Date()));
      } catch (e) { toast(e.message); return; }
      finished = true;
      toast('Baik, saya ingatkan lagi 10 menit lagi');
      leaveReminder();
    },
  });
}

/* ====================================================================== layar: perintah suara */

const EXAMPLES = ['Ingatkan saya minum obat jam 8 pagi', 'Cek jadwal besok', 'Putar berita hari ini'];

function viewVoice(tok) {
  let handle = null;
  const alive = () => tok === routeToken;
  setView(`<div class="screen voice-screen">
    <div class="topbar"><button class="back" data-action="close" aria-label="Kembali">${icons.chevronLeft}</button></div>
    <h1 class="title" id="v-title" aria-live="polite"></h1>
    <p class="sub" id="v-sub"></p>
    <div class="mic-stage" id="v-stage"><span class="ring"></span><span class="ring r2"></span>
      <button class="mic-big" data-action="mic" id="v-mic" aria-label="Mulai bicara">${icons.mic}</button></div>
    <div id="v-answer"></div>
    <div id="v-examples"></div>
    <div class="stack" id="v-actions"></div>
  </div>`);

  const $ = (id) => document.getElementById(id);
  const examplesHtml = `<p class="examples-title">Contoh perintah:</p><div class="chips">${EXAMPLES.map((t) =>
    `<button class="chip" data-action="example" data-text="${esc(t)}">${icons.mic}<span>"${esc(t)}"</span></button>`).join('')}</div>`;

  function stopAll() {
    if (handle) { handle.cancel(); handle = null; }
    V.stopSpeaking();
  }
  onLeave(stopAll);

  function paint(phase, data) {
    const stage = $('v-stage');
    stage.className = 'mic-stage' + (phase === 'listening' ? ' listening' : phase === 'processing' ? ' busy' : '');
    $('v-answer').innerHTML = '';
    $('v-examples').innerHTML = phase === 'listening' || phase === 'error' ? examplesHtml : '';
    if (phase === 'listening') {
      $('v-title').textContent = 'Mendengarkan...';
      $('v-sub').textContent = 'Silakan ucapkan perintah Anda';
      $('v-actions').innerHTML = '<button class="btn btn-gray" data-action="close">Batal</button>';
    } else if (phase === 'processing') {
      $('v-title').textContent = 'Memproses...';
      $('v-sub').textContent = `"${data}"`;
      $('v-actions').innerHTML = '<button class="btn btn-gray" data-action="close">Batal</button>';
    } else if (phase === 'error') {
      $('v-title').textContent = 'Belum berhasil';
      $('v-sub').textContent = data;
      $('v-actions').innerHTML = '<button class="btn btn-primary" data-action="again">Coba Lagi</button><button class="btn btn-gray" data-action="close">Batal</button>';
    } else if (phase === 'result') {
      const ok = !['unknown', 'need_time'].includes(data.intent);
      $('v-title').textContent = ok ? 'Selesai' : 'Belum jelas';
      $('v-sub').textContent = '';
      const rows = (data.schedules && data.schedules.length ? data.schedules : data.schedule ? [data.schedule] : []).slice(0, 8);
      $('v-answer').innerHTML = `<div class="answer" aria-live="polite"><p class="heard">Anda berkata: "${esc(data.transcript)}"</p>
        <p class="reply">${esc(data.reply)}</p>
        ${rows.length ? `<div class="mini">${rows.map((s) => `<div class="mini-row"><span>${esc(s.time)}</span><span>${esc(s.title)}${s.done ? ' (selesai)' : ''}</span></div>`).join('')}</div>` : ''}</div>`;
      $('v-actions').innerHTML = '<button class="btn btn-primary" data-action="close">Tutup</button><button class="btn btn-soft" data-action="again">Bicara Lagi</button>';
    }
  }

  async function runCommand(text) {
    paint('processing', text);
    const now = new Date();
    try {
      const r = await api.command(text, ymd(now), hm(now));
      if (!alive()) return;
      paint('result', r);
      if (state.settings.voice_reply) V.speak(r.reply, state.settings.speech_rate);
    } catch (e) {
      if (!alive()) return;
      paint('error', e.message);
    }
  }

  async function startListening() {
    stopAll();
    paint('listening');
    const h = V.listen();
    handle = h;
    try {
      const text = await h.promise;
      if (!alive() || handle !== h) return;
      handle = null;
      await runCommand(text);
    } catch (e) {
      if (!alive() || handle !== h || e.code === 'cancelled') return;
      handle = null;
      paint('error', e.message || 'Terjadi kesalahan. Coba lagi.');
    }
  }

  bindActions({
    close: () => leaveVoice(),
    again: () => startListening(),
    mic: () => startListening(),
    example: (el) => { stopAll(); runCommand(el.dataset.text); },
  });
  startListening();
}

function leaveVoice() {
  go('#/home');
}

/* ====================================================================== router */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name = '', ...rest] = h.split('/');
  return { name, param: rest.join('/') };
}

async function bootstrap(tok) {
  try {
    const [me, st] = await Promise.all([api.me(), api.getSettings()]);
    state.user = me.user;
    state.settings = st.settings;
    startPolling();
    return true;
  } catch (e) {
    if (tok !== routeToken) return false;
    if (e.status === 401) return false; // api.js sudah memicu logout
    setView(`<div class="screen"><div class="auth-head">${logoSvg(64, 'err')}<h1>Tidak bisa terhubung</h1>
      <p class="sub">${esc(e.message)}</p></div>
      <button class="btn btn-primary" data-action="retry">Coba Lagi</button></div>`);
    bindActions({ retry: () => route() });
    return false;
  }
}

async function route() {
  const tok = ++routeToken;
  cleanups.forEach((fn) => { try { fn(); } catch { /* abaikan */ } });
  cleanups = [];
  state.rerender = null;
  state.reload = null;
  closeSheet();
  const { name, param } = parseHash();
  const logged = !!auth.token();
  if (!logged) {
    state.user = null;
    if (!PUBLIC_ROUTES.has(name)) { go('#/splash'); return; }
  } else if (PUBLIC_ROUTES.has(name) || !name) {
    go('#/home');
    return;
  }
  if (logged && !state.user) {
    const ok = await bootstrap(tok);
    if (tok !== routeToken || !ok) return;
  }
  $view.scrollTop = 0;
  switch (name) {
    case 'splash': viewSplash(); break;
    case 'login': viewLogin(); break;
    case 'register': viewRegister(); break;
    case 'home': viewHome(tok); break;
    case 'jadwal': viewJadwal(); break;
    case 'riwayat': viewRiwayat(tok); break;
    case 'pengaturan': viewSettings(); break;
    case 'info': if (param) viewArticle(tok, param); else viewInfo(tok); break;
    case 'pengingat': viewReminder(tok); break;
    case 'suara': viewVoice(tok); break;
    default: go(logged ? '#/home' : '#/splash');
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('ingatku:novoice', () => {
  toast('Suara Bahasa Indonesia belum ada di perangkat ini. Buka Pengaturan, Suara & Bahasa, untuk petunjuk pemasangan.');
});
window.addEventListener('ingatku:logout', () => {
  state.user = null;
  stopPolling();
  go('#/login');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDue(); });
window.addEventListener('focus', checkDue);

route();
