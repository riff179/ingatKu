// Ikon SVG (garis, 24x24) dan ilustrasi. Semua berupa string HTML.
const s = (body, sw = 2) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  home: s('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  calendar: s('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  calendarCheck: s('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M9 15.5l2 2 4-4"/>'),
  calendarDots: s('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'),
  history: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  settings: s('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  mic: s('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>'),
  pill: s('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>'),
  bell: s('<path d="M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  chevronRight: s('<path d="m9 18 6-6-6-6"/>'),
  chevronLeft: s('<path d="m15 18-6-6 6-6"/>'),
  check: s('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 3),
  plus: s('<path d="M12 5v14M5 12h14"/>', 2.6),
  x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  phone: s('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  lock: s('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  volume: s('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  shield: s('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  help: s('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  trash: s('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  edit: s('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  logout: s('<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"/>'),
  brain: s('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3.5 3.5 0 0 0 3 5 3 3 0 0 0 5 1.5V5.5A2.5 2.5 0 0 0 9 4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3.5 3.5 0 0 1-3 5 3 3 0 0 1-5 1.5V5.5A2.5 2.5 0 0 1 15 4z"/>'),
  stretch: s('<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6m0 0-3 8m3-8 3 8M5 9l7-2 7 2"/>'),
  bowl: s('<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-1.5 1.5-1.5 1.5-3M13 7c0-1.5 1.5-1.5 1.5-3"/>'),
  heart: s('<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.7A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>'),
  moon: s('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>'),
};

export function kindIcon(kind) {
  return { obat: icons.pill, kontrol: icons.calendarCheck, janji: icons.calendarDots }[kind] || icons.bell;
}

export function logoSvg(size = 72, id = 'a') {
  return `<svg class="logo-svg" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Logo IngatKu">
  <defs><linearGradient id="lg-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4fd0"/></linearGradient></defs>
  <path d="M32 4C17.6 4 8 14.600 8 27c0 7.200 3.300 12.600 8 16.600V58h26v-9h5a3 3 0 0 0 3-3v-6l5-3-5.400-4.200C50 15 43.500 4 32 4z" fill="url(#lg-${id})"/>
  <path d="M32 40.500s-11-6.400-11-15a6.500 6.500 0 0 1 11-4.600 6.500 6.500 0 0 1 11 4.600c0 8.600-11 15-11 15z" fill="#3fd0a8"/>
</svg>`;
}

export function coupleSvg() {
  return `<svg class="couple" viewBox="0 0 320 232" role="img" aria-label="Sepasang lansia tersenyum memegang ponsel">
  <ellipse cx="46" cy="150" rx="26" ry="44" fill="#d3efe8" transform="rotate(-18 46 150)"/>
  <ellipse cx="22" cy="176" rx="18" ry="34" fill="#c3e8df" transform="rotate(12 22 176)"/>
  <ellipse cx="276" cy="140" rx="26" ry="46" fill="#d3efe8" transform="rotate(20 276 140)"/>
  <ellipse cx="300" cy="172" rx="18" ry="34" fill="#c3e8df" transform="rotate(-12 300 172)"/>
  <!-- perempuan -->
  <path d="M146 232c4-46 32-64 70-64s66 18 70 64z" fill="#cf86ad"/>
  <path d="M190 170l26 34 26-34c-8-4-17-6-26-6s-18 2-26 6z" fill="#f7e1ea"/>
  <rect x="204" y="150" width="24" height="22" rx="10" fill="#f0c3a0"/>
  <circle cx="216" cy="70" r="17" fill="#c9ccd8"/>
  <ellipse cx="216" cy="120" rx="33" ry="39" fill="#f6cfae"/>
  <path d="M182 118c-4-44 68-44 64 0-8-22-56-22-64 0z" fill="#cfd2dc"/>
  <path d="M199 121q6-7 12 0M221 121q6-7 12 0" stroke="#3a2a2a" stroke-width="2.600" fill="none" stroke-linecap="round"/>
  <circle cx="199" cy="134" r="5" fill="#f4a9a0" opacity=".55"/><circle cx="233" cy="134" r="5" fill="#f4a9a0" opacity=".55"/>
  <path d="M203 138q13 14 26 0z" fill="#fff" stroke="#b4513c" stroke-width="2" stroke-linejoin="round"/>
  <!-- laki-laki -->
  <path d="M34 232c0-56 36-74 84-74s84 18 84 74z" fill="#2f4a7d"/>
  <path d="M100 160l18 24 18-24z" fill="#f4f6fb"/>
  <rect x="106" y="140" width="24" height="24" rx="10" fill="#efbf98"/>
  <ellipse cx="118" cy="108" rx="36" ry="42" fill="#f5c6a0"/>
  <ellipse cx="82" cy="110" rx="6" ry="9" fill="#f0b891"/><ellipse cx="154" cy="110" rx="6" ry="9" fill="#f0b891"/>
  <path d="M82 104c-2-40 70-40 72 0-8-20-64-20-72 0z" fill="#eef0f4" stroke="#cfd5e0" stroke-width="1.500"/>
  <circle cx="103" cy="112" r="11" fill="#fff" fill-opacity=".4" stroke="#262634" stroke-width="3"/>
  <circle cx="133" cy="112" r="11" fill="#fff" fill-opacity=".4" stroke="#262634" stroke-width="3"/>
  <path d="M114 112h8" stroke="#262634" stroke-width="3"/>
  <circle cx="103" cy="113" r="3" fill="#262634"/><circle cx="133" cy="113" r="3" fill="#262634"/>
  <path d="M100 132q18 18 36 0z" fill="#fff" stroke="#b4513c" stroke-width="2" stroke-linejoin="round"/>
  <rect x="96" y="176" width="32" height="48" rx="6" fill="#1d2433"/>
  <rect x="100" y="181" width="24" height="38" rx="3" fill="#5fb2ff"/>
  <ellipse cx="94" cy="206" rx="9" ry="11" fill="#efbf98"/><ellipse cx="130" cy="206" rx="9" ry="11" fill="#efbf98"/>
</svg>`;
}

export function avatarSvg(salutation = 'Pak', size = 56) {
  const woman = salutation === 'Bu';
  return `<svg class="avatar-svg" width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="Foto profil">
  <circle cx="28" cy="28" r="28" fill="#dbe8fb"/>
  <path d="M6 56c2-14 12-18 22-18s20 4 22 18z" fill="${woman ? '#cf86ad' : '#2f4a7d'}"/>
  <ellipse cx="28" cy="27" rx="11" ry="13" fill="#f5c6a0"/>
  ${woman
    ? '<circle cx="28" cy="10" r="6" fill="#c9ccd8"/><path d="M16 26c-2-16 22-16 24 0-3-8-21-8-24 0z" fill="#cfd2dc"/><path d="M22 28q2-2 4 0M30 28q2-2 4 0" stroke="#3a2a2a" stroke-width="1.400" fill="none" stroke-linecap="round"/>'
    : '<path d="M16 25c-1-12 23-12 24 0-3-6-21-6-24 0z" fill="#eef0f4" stroke="#cfd5e0"/><circle cx="23" cy="28" r="4" fill="#fff" fill-opacity=".4" stroke="#262634" stroke-width="1.500"/><circle cx="33" cy="28" r="4" fill="#fff" fill-opacity=".4" stroke="#262634" stroke-width="1.500"/><path d="M27 28h2" stroke="#262634" stroke-width="1.500"/>'}
  <path d="M23 35q5 5 10 0z" fill="#fff" stroke="#b4513c" stroke-width="1.200" stroke-linejoin="round"/>
</svg>`;
}

export function robotSvg(size = 44) {
  return `<svg class="robot-svg" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="Asisten IngatKu">
  <path d="M24 5v6" stroke="#2d6be4" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="5" r="3" fill="#3fd0a8"/>
  <rect x="6" y="12" width="36" height="28" rx="12" fill="#2d6be4"/>
  <rect x="11" y="17" width="26" height="17" rx="8" fill="#e8f1ff"/>
  <circle cx="19" cy="25" r="3.200" fill="#1d3a73"/><circle cx="29" cy="25" r="3.200" fill="#1d3a73"/>
  <path d="M20 30q4 3 8 0" stroke="#1d3a73" stroke-width="2" fill="none" stroke-linecap="round"/>
  <rect x="2" y="21" width="4" height="10" rx="2" fill="#1f55c2"/><rect x="42" y="21" width="4" height="10" rx="2" fill="#1f55c2"/>
</svg>`;
}
