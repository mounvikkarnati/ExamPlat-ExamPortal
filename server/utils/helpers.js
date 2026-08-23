/**
 * Small shared helpers used by the API controllers.
 */

/** Trim + collapse inner whitespace + uppercase a hall ticket string. */
function normalizeHallTicket(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize any date-ish value to a plain 'YYYY-MM-DD' string (or null). */
function normalizeDateOnly(value) {
  if (value == null || value === '') return null;

  // Already ISO (YYYY-MM-DD..., e.g. from HTML date input or Mongo Date)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(String(value));
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Fall back to JS Date parsing (UTC-based to avoid TZ drift on date-only values)
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const da = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Compare two date-ish values by calendar date only. */
function compareDob(a, b) {
  const na = normalizeDateOnly(a);
  const nb = normalizeDateOnly(b);
  return !!na && !!nb && na === nb;
}

/** Extract the trailing 4 digits from a human-readable exam id (e.g. FNL-2026-8460 -> 8460). */
function lastFourOfExamId(examId) {
  const m = /(\d{4})$/.exec(String(examId || ''));
  return m ? m[1] : '';
}

/** Common keys used by the legacy `students` collection for DOB. */
const DOB_ALIASES = ['dob', 'dateOfBirth', 'DOB', 'DateOfBirth', 'birthDate', 'birth_date', 'birthdate', 'dob_of_birth', 'date_of_birth'];

/** A safe, client-friendly view of a finalexams document. */
function publicExamView(exam) {
  return {
    id: String(exam._id),
    finalExamId: exam.finalExamId,
    title: exam.title,
    subject: exam.subject || '',
    examCategory: exam.examCategory || 'JEE',
    status: exam.status || 'Scheduled',
    defaultStartAt: exam.defaultStartAt || null,
    defaultEndAt: exam.defaultEndAt || null,
    defaultAttempts: exam.defaultAttempts ?? 1,
    durationMinutes: (() => {
      const raw = exam && (exam.duration ?? exam.durationMinutes ?? exam.examDuration ?? exam.examDurationMinutes);
      if (raw == null) return null;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
      if (typeof raw === 'object') {
        const total = (Number(raw.hours) || 0) * 60 + (Number(raw.minutes) || 0);
        return total > 0 ? total : null;
      }
      if (typeof raw === 'string') {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    })(),
    candidateCount: exam.candidateCount || 0,
  };
}

module.exports = {
  normalizeHallTicket,
  escapeRegExp,
  normalizeDateOnly,
  compareDob,
  lastFourOfExamId,
  DOB_ALIASES,
  publicExamView,
};
