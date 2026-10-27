// Reusable HTML and browser helpers. Escape user text before interpolating into markup.
const icons = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 14h3M14 14h3M7 18h3',
  chart: 'M4 20V10h4v10M10 20V4h4v16M16 20V7h4v13',
  alert: 'M12 3 2 21h20L12 3zM12 9v5M12 17v.1',
  book: 'M12 21V5M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1',
  speaker: 'M3 9v6h4l10 5V4L7 9H3zM7 15l2 6h3l-2-5M20 8q4 4 0 8',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  back: 'm14 6-6 6 6 6',
  chevron: 'm9 6 6 6-6 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  pin: 'm16 3 5 5-4 2-3 5-2-2-7 7M3 10l7-7 1 5 5 5',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  crown: 'M3 6l5 5 4-8 4 8 5-5-2 13H5L3 6z',
  check: 'm5 12 4 4L19 6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  file: 'M14 2H4v20h16V8l-6-6zM14 2v6h6M8 13h8M8 17h6',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1',
  help: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  poll: 'M5 12h3v8H5zM10 4h3v16h-3zM15 8h3v12h-3z',
};

const icon = (name, cls = '') =>
  /* HTML */ `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="${icons[name] || icons.file}" />
  </svg>`;

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const initials = (name) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('');

function formatDate(d) {
  return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU') : '—';
}

function field(label, name, value = '', type = 'text', extra = '') {
  return /* HTML */ `<label for="f-${name}">${label}</label
    ><input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra} />`;
}

function select(label, name, options, value) {
  return /* HTML */ `<label for="f-${name}">${label}</label
    ><select id="f-${name}" name="${name}">
      ${options.map(([v, t]) => /* HTML */ `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
    </select>`;
}

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export { icon, escapeHtml, initials, field, select, download, formatDate };
