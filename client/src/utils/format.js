/** Join truthy class names. */
export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** Render a date/ISO value as a friendly Indian Standard Time value. */
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

/** Render seconds as H:MM:SS (or MM:SS when under an hour). */
export function formatClock(totalSeconds) {
  const t = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Render minutes (decimal) nicely, e.g. 12.5 -> "12.5 min". */
export function formatMinutes(raw) {
  const v = Number(raw || 0);
  return `${v} min`;
}

const LETTERS = ['A', 'B', 'C', 'D'];

/** 'A'-'D' label for the radio group of a question. */
export function optionLabel(index) {
  return LETTERS[index] || String(index);
}
