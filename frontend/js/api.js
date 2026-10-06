// Klien API IngatKu. Token disimpan di localStorage.
const TOKEN_KEY = 'ingatku.token';

export class ApiError extends Error {
  constructor(message, status = 0, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export const auth = {
  token: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* abaikan */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* abaikan */ } },
};

async function request(method, path, body, opts = {}) {
  const headers = {};
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (opts.rawBody !== undefined) {
    headers['Content-Type'] = opts.contentType;
    payload = opts.rawBody;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internet Anda.');
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* bukan JSON */ }
    if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
      auth.clear();
      window.dispatchEvent(new CustomEvent('ingatku:logout'));
    }
    throw new ApiError(data.error || 'Terjadi kesalahan. Coba lagi.', res.status, data.field || null);
  }
  if (opts.blob) return res.blob();
  return res.json();
}

const qs = (o) => new URLSearchParams(o).toString();

export const api = {
  register: (b) => request('POST', '/api/auth/register', b),
  login: (phone, password) => request('POST', '/api/auth/login', { phone, password }),
  me: () => request('GET', '/api/me'),
  updateMe: (b) => request('PUT', '/api/me', b),
  changePassword: (old_password, new_password) => request('POST', '/api/me/password', { old_password, new_password }),
  clearData: () => request('DELETE', '/api/me/data'),
  deleteAccount: (password) => request('POST', '/api/me/delete', { password }),
  getSettings: () => request('GET', '/api/settings'),
  putSettings: (b) => request('PUT', '/api/settings', b),
  schedules: (date, range = 'day') => request('GET', `/api/schedules?${qs({ date, range })}`),
  createSchedule: (b) => request('POST', '/api/schedules', b),
  updateSchedule: (id, b) => request('PATCH', `/api/schedules/${id}`, b),
  deleteSchedule: (id) => request('DELETE', `/api/schedules/${id}`),
  snooze: (id, minutes, now) => request('POST', `/api/schedules/${id}/snooze`, { minutes, now }),
  due: (date, time) => request('GET', `/api/reminders/due?${qs({ date, time })}`),
  history: (limit = 50, offset = 0) => request('GET', `/api/history?${qs({ limit, offset })}`),
  healthInfo: () => request('GET', '/api/health-info'),
  voiceStatus: () => request('GET', '/api/voice/status'),
  stt: async (blob) => {
    const type = (blob.type || 'audio/webm').split(';')[0];
    const data = await request('POST', '/api/voice/stt', undefined, { rawBody: blob, contentType: type });
    return (data.text || '').trim();
  },
  tts: (text, rate) => request('POST', '/api/voice/tts', { text, rate }, { blob: true }),
  command: (text, date, time) => request('POST', '/api/voice/command', { text, date, time }),
};
