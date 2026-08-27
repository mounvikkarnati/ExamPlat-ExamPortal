const FinalQuestion = require('../models/FinalQuestion');
const FinalAttempt = require('../models/FinalAttempt');
const FinalAllowedCandidate = require('../models/FinalAllowedCandidate');
const Student = require('../models/Student');
const ExamRegistration = require('../models/ExamRegistration');
const mongoose = require('mongoose');
const { normalizeHallTicket, escapeRegExp, DOB_ALIASES, toExamCategory } = require('../utils/helpers');

/** Accepts duration as minutes (number) or an admin-style object {hours, minutes}. */
function parseDurationMinutes(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof raw === 'object') {
    const hours = Number(raw.hours) || 0;
    const minutes = Number(raw.minutes) || 0;
    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
  }
  return null;
}

/** Admin versions have used a few names for the same duration value. */
function getExamDurationMinutes(exam) {
  if (!exam) return null;
  return (
    parseDurationMinutes(exam.duration) ||
    parseDurationMinutes(exam.durationMinutes) ||
    parseDurationMinutes(exam.examDuration) ||
    parseDurationMinutes(exam.examDurationMinutes) ||
    null
  );
}

/**
 * Effective per-candidate exam schedule:
 *   start    = startAtOverride || defaultStartAt
 *   attempts = attemptsOverride ?? defaultAttempts
 *
 * end:
 *   - endAtOverride wins outright;
 *   - else, when the exam defines `duration` AND the candidate has begun
 *     (sessionStartedAt set), the personal timer is
 *     sessionStartedAt + duration  -> this is the authoritative deadline;
 *   - otherwise fall back to defaultEndAt (also used for availability checks
 *     BEFORE the candidate begins).
 */
function getEffectiveSettings(exam, candidate) {
  const cand = candidate || {};
  const startAt = cand.startAtOverride ? cand.startAtOverride : exam.defaultStartAt;

  const durationMin = getExamDurationMinutes(exam);

  let endAt;
  if (cand.endAtOverride) {
    endAt = cand.endAtOverride;
  } else if (durationMin && cand.sessionStartedAt) {
    endAt = new Date(new Date(cand.sessionStartedAt).getTime() + durationMin * 60000);
  } else {
    endAt = exam.defaultEndAt;
  }

  const attemptsOverride = cand.attemptsOverride;
  const attempts = attemptsOverride ?? (Number.isFinite(exam.defaultAttempts) ? exam.defaultAttempts : 1);

  return { startAt, endAt, attempts, durationMinutes: durationMin };
}

/** Find the allow-list entry for (exam, hall ticket), case-insensitively. */
async function findCandidateForExam(exam, hallTicket) {
  const regex = new RegExp(`^${escapeRegExp(hallTicket)}$`, 'i');
  return FinalAllowedCandidate.findOne({ testId: exam._id, hallTicketNo: regex }).lean();
}

/** Extract the first DOB-ish value from a student-ish document. */
function pickDob(doc) {
  if (!doc) return null;
  for (const key of DOB_ALIASES) {
    const value = doc[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

/**
 * Resolve a candidate's DOB from the legacy collections (all READ-ONLY):
 *   1. `students` matched directly by hall-ticket fields
 *      (hallTicketNo / hallTicket / hallticket)
 *   2. `examregistrations` matched by registrationNumber / hallTicketNo ->
 *      `studentId` -> `students.dob`
 */
async function getStudentDobByHallTicket(hallTicket) {
  const regex = new RegExp(`^${escapeRegExp(hallTicket)}$`, 'i');

  // 1) direct match on the students collection
  const direct = await Student.findOne({
    $or: [{ hallTicketNo: regex }, { hallTicket: regex }, { hallticket: regex }],
  }).lean();
  const fromDirect = pickDob(direct);
  if (fromDirect != null) return fromDirect;

  // 2) via the registration that issued the hall ticket
  const registration = await ExamRegistration.findOne({
    $or: [
      { registrationNumber: regex },
      { hallTicketNo: regex },
      { hallTicket: regex },
      { registrationId: regex },
    ],
  }).lean();

  if (registration && registration.studentId && mongoose.isValidObjectId(String(registration.studentId))) {
    const student = await Student.findById(registration.studentId).lean();
    return pickDob(student);
  }

  return null;
}

/**
 * Resolve the FINAL exam category (JEE | NEET) that the candidate actually
 * registered for, from the legacy `examregistrations` collection (READ-ONLY).
 * The candidate is matched by any of the hall-ticket-ish fields; the returned
 * value is '' when no registration (or an unrecognised examType) is found so
 * that callers may be lenient rather than lock out unknown candidates.
 */
async function getRegisteredExamCategoryByHallTicket(hallTicket) {
  const regex = new RegExp(`^${escapeRegExp(hallTicket)}$`, 'i');
  const registration = await ExamRegistration.findOne({
    $or: [
      { registrationNumber: regex },
      { hallTicketNo: regex },
      { hallTicket: regex },
      { registrationId: regex },
    ],
  }).lean();
  if (!registration) return '';
  const raw = registration.examType ?? registration.exam ?? registration.examCategory;
  return toExamCategory(raw);
}

async function loadQuestionsForExam(examId) {
  return FinalQuestion.find({ testId: examId }).lean();
}

/**
 * Grading rule (4-option MCQ):
 *   - correct option  -> +1
 *   - wrong answer    -> 0 (no negative marking)
 *   - unanswered      -> 0 and NOT counted as wrong
 *   totalMarks = number of questions
 */
async function computeResult(candidate, exam) {
  const questions = await loadQuestionsForExam(exam._id);
  const answers = new Map((candidate.responses || []).map((r) => [String(r.questionId), Number(r.selectedOption)]));

  let score = 0;
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  for (const q of questions) {
    const chosen = answers.get(String(q._id));
    if (chosen === undefined || chosen === null || Number.isNaN(chosen)) {
      unanswered += 1;
      continue;
    }
    if (Number(chosen) === Number(q.correctOption)) {
      score += 1;
      correct += 1;
    } else {
      wrong += 1;
    }
  }

  const totalMarks = questions.length;
  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;

  return { score, totalMarks, correctAnswers: correct, wrongAnswers: wrong, unanswered, percentage };
}

/**
 * Finalize an attempt:
 *  - update the finalallowedcandidates doc (score, status, submissionReason, attemptsUsed + 1)
 *  - insert ONE row into finalattempts
 *  - `testMongoId` is set to the STRING form of the exam _id
 */
async function submitAttempt({ candidate, exam, reason = '', now = new Date(), browser = '' }) {
  const result = await computeResult(candidate, exam);
  const systemInitiated = reason === 'time expired' || reason === 'malpractice';
  const effective = getEffectiveSettings(exam, candidate);
  const status = systemInitiated ? 'auto-submitted' : 'submitted';
  const startedAt = candidate.sessionStartedAt || now;
  const submittedAt = now;
  const timeTaken = Math.max(0, Math.round(((submittedAt - startedAt) / 60000) * 10) / 10); // minutes, 1 decimal

  candidate.score = result.score;
  candidate.status = status;
  candidate.submissionReason = reason || '';
  candidate.resultPublishedAt = submittedAt;
  candidate.attemptsUsed = (candidate.attemptsUsed || 0) + 1;
  // Freeze the precise server-side remaining time. A later retry continues
  // from this value rather than receiving a fresh duration.
  candidate.resumeRemainingMs = systemInitiated
    ? Math.max(0, new Date(effective.endAt).getTime() - submittedAt.getTime())
    : null;

  const attempt = new FinalAttempt({
    studentId: candidate.hallTicketNo || String(candidate._id),
    registrationId: candidate._id,
    testId: exam.finalExamId,
    testMongoId: String(exam._id), // STRING of the exam _id
    examType: 'Final',
    attemptNumber: candidate.attemptsUsed,
    status,
    score: result.score,
    totalMarks: result.totalMarks,
    correctAnswers: result.correctAnswers,
    wrongAnswers: result.wrongAnswers,
    unanswered: result.unanswered,
    percentage: result.percentage,
    timeTaken,
    startedAt,
    testTitle: exam.title,
    examCategory: exam.examCategory,
    submittedAt,
    browser: String(browser || '').slice(0, 500),
  });

  await Promise.all([candidate.save(), attempt.save()]);
  return { attempt, result };
}

/**
 * Auto-submit when the effective end time has passed and the candidate had an
 * active session on this exam. No-op otherwise.
 */
async function maybeAutoSubmit(candidate, exam, now = new Date(), browser = '') {
  const eff = getEffectiveSettings(exam, candidate);
  if (now <= eff.endAt) return { submitted: false };
  if (['submitted', 'auto-submitted'].includes(candidate.status)) return { submitted: false, alreadySubmitted: true };

  const hasActiveSession = !!candidate.sessionStartedAt || (candidate.responses || []).length > 0;
  if (!hasActiveSession) return { submitted: false, notStarted: true };

  const outcome = await submitAttempt({ candidate, exam, reason: 'time expired', now, browser });
  return { submitted: true, ...outcome };
}

/** Latest finalattempt row for a candidate. */
async function getLatestAttempt(candidateId) {
  return FinalAttempt.findOne({ registrationId: candidateId }).sort({ submittedAt: -1, _id: -1 }).lean();
}

/** Client-safe view of a finalattempts row. */
function attemptToJson(attempt) {
  if (!attempt) return null;
  return {
    id: String(attempt._id),
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    score: attempt.score,
    totalMarks: attempt.totalMarks,
    correctAnswers: attempt.correctAnswers,
    wrongAnswers: attempt.wrongAnswers,
    unanswered: attempt.unanswered,
    percentage: attempt.percentage,
    timeTaken: attempt.timeTaken,
    testId: attempt.testId,
    testMongoId: attempt.testMongoId,
    testTitle: attempt.testTitle,
    examCategory: attempt.examCategory,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
  };
}

module.exports = {
  getEffectiveSettings,
  getExamDurationMinutes,
  findCandidateForExam,
  getStudentDobByHallTicket,
  getRegisteredExamCategoryByHallTicket,
  computeResult,
  submitAttempt,
  maybeAutoSubmit,
  getLatestAttempt,
  attemptToJson,
};
