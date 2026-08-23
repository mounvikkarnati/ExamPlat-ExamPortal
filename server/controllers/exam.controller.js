const mongoose = require('mongoose');

const FinalExam = require('../models/FinalExam');
const FinalAllowedCandidate = require('../models/FinalAllowedCandidate');
const FinalQuestion = require('../models/FinalQuestion');
const FinalMalpractice = require('../models/FinalMalpractice');
const { signExamToken } = require('../middleware/auth');
const {
  normalizeHallTicket,
  escapeRegExp,
  compareDob,
  lastFourOfExamId,
  publicExamView,
} = require('../utils/helpers');
const {
  getEffectiveSettings,
  findCandidateForExam,
  getStudentDobByHallTicket,
  submitAttempt,
  maybeAutoSubmit,
  getLatestAttempt,
  attemptToJson,
} = require('../services/exam.service');

/**
 * POST /api/exam/login
 * 3-factor entry verification (all must pass together):
 *   1. Hall ticket is allow-listed for this final exam
 *   2. Entered 4 digits equal the tail of that exam's finalExamId
 *   3. DOB matches (allow-list dob, falling back to legacy `students` dob)
 * Success => signed JWT { candidateId, examId } + exam metadata + candidate info.
 */
exports.login = async (req, res, next) => {
  try {
    const { hallTicketNo, testIdLast4, dob, examMongoId } = req.body || {};

    const hall = normalizeHallTicket(hallTicketNo);
    if (!hall) {
      return res.status(400).json({ success: false, error: 'hallTicket', message: 'Hall Ticket No. is required.' });
    }

    const last4 = typeof testIdLast4 === 'string' ? testIdLast4.trim() : '';
    if (!/^\d{4}$/.test(last4)) {
      return res.status(400).json({ success: false, error: 'testId', message: 'Enter the last 4 digits of the Exam ID (e.g. 8460).' });
    }

    if (!dob) {
      return res.status(400).json({ success: false, error: 'dob', message: 'Date of Birth is required.' });
    }

    // 1) Locate the finalexams doc: by supplied MongoId, otherwise by the last-4 tail of finalExamId.
    let exams = [];
    if (examMongoId && mongoose.isValidObjectId(examMongoId)) {
      const one = await FinalExam.findById(examMongoId).lean();
      exams = one ? [one] : [];
    } else {
      exams = await FinalExam.find({ finalExamId: { $regex: escapeRegExp(last4) + '$', $options: 'i' } }).lean();
    }
    if (exams.length === 0) {
      return res.status(403).json({ success: false, error: 'testId', message: `Incorrect test ID - no exam found with code "${last4}".` });
    }

    // 2) 3rd-factor #1 - the hall ticket must be allow-listed for THIS exam.
    let exam = null;
    let candidate = null;
    for (const e of exams) {
      const match = await findCandidateForExam(e, hall);
      if (match) { exam = e; candidate = match; break; }
    }
    if (!candidate) {
      return res.status(403).json({ success: false, error: 'hallTicket', message: 'Hall ticket not allowed for this exam.' });
    }

    // 3) 3rd-factor #2 - the 4-digit code must equal the tail of the matched exam id.
    if (lastFourOfExamId(exam.finalExamId) !== last4) {
      return res.status(403).json({ success: false, error: 'testId', message: 'Incorrect test ID - the 4-digit code does not match this exam.' });
    }

    // 4) 3rd-factor #3 - DOB must match (allow-list first, legacy students fallback).
    const dobSource = candidate.dob || (await getStudentDobByHallTicket(hall));
    if (!compareDob(dobSource, dob)) {
      return res.status(403).json({ success: false, error: 'dob', message: 'DOB does not match the registration records.' });
    }

    // Intentional submission and timer expiry permanently end access. Other
    // automatic submissions (for example malpractice) may use a remaining attempt.
    if (candidate.status === 'submitted' || (candidate.status === 'auto-submitted' && candidate.submissionReason === 'time expired')) {
      return res.status(403).json({
        success: false,
        error: 'exam-over',
        message: 'This exam is over for you. It has already been submitted.',
      });
    }

    // 5b) Attempt gate - if every allowed attempt is already consumed, the exam
    //     is over for this candidate even though the 3 factors are correct.
    const eff = getEffectiveSettings(exam, candidate);
    if ((candidate.attemptsUsed || 0) >= eff.attempts) {
      return res.status(403).json({
        success: false,
        error: 'exam-over',
        message: 'This exam is over. Your attempt has already been completed/submitted.',
      });
    }

    const token = signExamToken({ candidateId: String(candidate._id), examId: String(exam._id) });

    return res.json({
      success: true,
      token,
      exam: publicExamView(exam),
      candidate: {
        id: String(candidate._id),
        hallTicketNo: candidate.hallTicketNo,
        dob: candidate.dob || null,
        status: candidate.status,
        attemptsUsed: candidate.attemptsUsed || 0,
      },
      // The client anchors its display clock to this server timestamp.
      serverNow: new Date(),
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/exam/start (auth)
 * Returns the exam window, question count and attempt info WITHOUT questions or
 * correct answers. Enforces window + attempt limits and auto-submits expired
 * sessions. Pass `?begin=1` from the exam-taking screen to flatten the session
 * (status -> "in progress", sessionStartedAt set).
 */
exports.start = async (req, res, next) => {
  try {
    const now = new Date();
    const { exam, candidate, auth } = req;
    const questionCount = await FinalQuestion.countDocuments({ testId: exam._id });

    const auto = await maybeAutoSubmit(candidate, exam, now);
    let freshCandidate = candidate;
    if (auto.submitted) {
      freshCandidate = await FinalAllowedCandidate.findById(auth.candidateId);
    }

    // Pre-begin availability check (duration-based personal end only applies
    // once sessionStartedAt exists - getEffectiveSettings handles that).
    let eff = getEffectiveSettings(exam, freshCandidate);
    const attemptsLeft = Math.max(0, eff.attempts - (freshCandidate.attemptsUsed || 0));

    let allowed = false;
    let blockReason = '';
    let blockMessage = '';

    if (now < eff.startAt) {
      blockReason = 'NOT_STARTED';
      blockMessage = 'The exam has not started yet.';
    } else if (freshCandidate.status !== 'auto-submitted' && freshCandidate.sessionStartedAt && now > eff.endAt) {
      blockReason = 'ENDED';
      blockMessage = auto.submitted ? 'Exam time expired - your exam was auto-submitted.' : 'Your exam time is over.';
    } else if (!freshCandidate.sessionStartedAt && eff.durationMinutes == null && now > eff.endAt) {
      blockReason = 'ENDED';
      blockMessage = auto.submitted ? 'Exam time expired - your exam was auto-submitted.' : 'The exam has ended.';
    } else if (freshCandidate.status === 'submitted') {
      blockReason = 'ATTEMPTS_EXHAUSTED';
      blockMessage = 'You have already submitted this exam for this attempt.';
    } else if (eff.attempts <= 0 || attemptsLeft <= 0) {
      blockReason = 'ATTEMPTS_EXHAUSTED';
      blockMessage = 'You have used all your allowed attempts for this exam.';
    } else {
      allowed = true;
    }

    // Flatten the session FIRST (so a duration-based personal end is computed
    // from this moment), then recompute the effective schedule.
    let sessionStartedNow = false;
    if (allowed && String(req.query.begin) === '1') {
      let dirty = false;
      // An automatic submission consumes an attempt but keeps the saved paper,
      // cursor and exact server-side timer remainder for a permitted retry.
      if (!freshCandidate.sessionStartedAt || freshCandidate.status === 'auto-submitted') {
        const hasSavedRemainder = freshCandidate.resumeRemainingMs !== null && freshCandidate.resumeRemainingMs !== undefined;
        const pausedMs = Number(freshCandidate.resumeRemainingMs);
        if (freshCandidate.status === 'auto-submitted' && eff.durationMinutes && hasSavedRemainder && Number.isFinite(pausedMs)) {
          // getEffectiveSettings derives endAt from sessionStartedAt + duration.
          // Back-calculate that start so the new deadline is now + pausedMs.
          freshCandidate.sessionStartedAt = new Date(now.getTime() - (eff.durationMinutes * 60000 - pausedMs));
        } else {
          freshCandidate.sessionStartedAt = now;
        }
        dirty = true;
        sessionStartedNow = true;
      }
      if (freshCandidate.status === 'not started' || freshCandidate.status === 'auto-submitted') {
        freshCandidate.status = 'in progress';
        freshCandidate.submissionReason = '';
        freshCandidate.resumeRemainingMs = null;
        dirty = true;
      }
      if (dirty) await freshCandidate.save();
      eff = getEffectiveSettings(exam, freshCandidate);
    }

    // Violations belong to an individual attempt. The next retry begins at 0.
    const currentAttemptNumber = (freshCandidate.attemptsUsed || 0) + 1;
    const violationCount = await FinalMalpractice.countDocuments({
      registrationId: freshCandidate._id,
      testId: exam._id,
      attemptNumber: currentAttemptNumber,
    });

    return res.json({
      success: true,
      allowed,
      autoSubmitted: !!auto.submitted,
      blockReason,
      message: blockMessage,
      exam: publicExamView(exam),
      details: {
        questionCount,
        totalMarks: questionCount,
        effectiveStartAt: eff.startAt,
        effectiveEndAt: eff.endAt,
        effectiveAttempts: eff.attempts,
        durationMinutes: eff.durationMinutes,
        violationCount,
        resumeQuestionId: freshCandidate.currentQuestionId ? String(freshCandidate.currentQuestionId) : null,
        sessionStartedNow,
        sessionStartedAt: freshCandidate.sessionStartedAt || null,
        attemptsUsed: freshCandidate.attemptsUsed || 0,
        attemptsLeft: attemptsLeft,
        candidateStatus: freshCandidate.status,
        submissionReason: freshCandidate.submissionReason || '',
        usesOverrides: !!(
          candidate.startAtOverride ||
          candidate.endAtOverride ||
          candidate.attemptsOverride != null
        ),
        serverNow: now,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/exam/questions (auth)
 * Returns questions WITHOUT exposing `correctOption`. Questions are available
 * only during a live in-progress session.
 */
exports.getQuestions = async (req, res, next) => {
  try {
    const { exam, candidate } = req;
    const now = new Date();
    const eff = getEffectiveSettings(exam, candidate);
    if (candidate.status !== 'in progress') {
      return res.status(403).json({ success: false, error: 'session', message: 'Start or resume the exam before loading questions.' });
    }
    if (now < eff.startAt) {
      return res.status(403).json({ success: false, error: 'window', message: 'The exam has not started yet.' });
    }
    if (now > eff.endAt) {
      const outcome = await maybeAutoSubmit(candidate, exam, now);
      if (outcome.submitted) {
        return res.json({ success: true, autoSubmitted: true });
      }
      return res.status(403).json({ success: false, error: 'window', message: 'The exam has ended. You can no longer answer.' });
    }

    const questions = await FinalQuestion.find({ testId: exam._id }).lean();
    const savedAnswers = new Map((candidate.responses || []).map((r) => [String(r.questionId), r.selectedOption]));
    const sanitized = questions.map((q, i) => ({
      number: i + 1,
      id: String(q._id),
      questionText: q.questionText,
      options: q.options,
      subject: q.subject || '',
      topic: q.topic || '',
      // This is the candidate's own saved response; correctOption is never sent.
      selectedOption: savedAnswers.has(String(q._id)) ? savedAnswers.get(String(q._id)) : null,
    }));

    return res.json({ success: true, count: sanitized.length, questions: sanitized });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/exam/answer (auth)
 * Upserts a single answer into finalallowedcandidates.responses.
 */
exports.saveAnswer = async (req, res, next) => {
  try {
    const { exam, candidate } = req;
    const now = new Date();
    const eff = getEffectiveSettings(exam, candidate);

    if (candidate.status !== 'in progress') {
      return res.status(403).json({ success: false, error: 'session', message: 'This exam session is no longer active.' });
    }

    if (now < eff.startAt) {
      return res.status(403).json({ success: false, error: 'window', message: 'The exam has not started yet.' });
    }
    if (now > eff.endAt) {
      const outcome = await maybeAutoSubmit(candidate, exam, now);
      if (outcome.submitted) {
        return res.json({ success: true, autoSubmitted: true, attempt: attemptToJson(outcome.attempt), result: outcome.result });
      }
      return res.status(403).json({ success: false, error: 'window', message: 'The exam has ended.' });
    }

    const { questionId, selectedOption } = req.body || {};
    if (!questionId || !mongoose.isValidObjectId(questionId)) {
      return res.status(400).json({ success: false, error: 'validation', message: 'A valid questionId is required.' });
    }

    // selectedOption === null -> clear the saved response for this question
    const isClear = selectedOption === null || selectedOption === 'null';
    let opt = null;
    if (!isClear) {
      opt = parseInt(selectedOption, 10);
      if (![0, 1, 2, 3].includes(opt)) {
        return res.status(400).json({ success: false, error: 'validation', message: 'selectedOption must be an integer 0-3 (or null to clear).' });
      }
    }

    const question = await FinalQuestion.findOne({ _id: questionId, testId: exam._id });
    if (!question) {
      return res.status(404).json({ success: false, error: 'question', message: 'Question not found in this exam.' });
    }

    if (candidate.status === 'not started') candidate.status = 'in progress';
    if (!candidate.sessionStartedAt) candidate.sessionStartedAt = now;

    const idx = (candidate.responses || []).findIndex((r) => String(r.questionId) === String(questionId));

    if (isClear) {
      if (idx >= 0) candidate.responses.splice(idx, 1);
    } else {
      const response = { questionId: question._id, selectedOption: opt, answeredAt: now };
      if (idx >= 0) candidate.responses[idx] = response;
      else candidate.responses.push(response);
    }
    candidate.markModified('responses');

    await candidate.save();
    return res.json({ success: true, cleared: isClear, savedAt: now, answeredQuestions: candidate.responses.length });
  } catch (err) {
    return next(err);
  }
};

/** POST /api/exam/progress - persist the question currently being viewed. */
exports.saveProgress = async (req, res, next) => {
  try {
    const { exam, candidate } = req;
    const questionId = req.body?.questionId;
    if (candidate.status !== 'in progress') {
      return res.status(403).json({ success: false, error: 'session', message: 'This exam session is no longer active.' });
    }
    if (!questionId || !mongoose.isValidObjectId(questionId)) {
      return res.status(400).json({ success: false, error: 'validation', message: 'A valid questionId is required.' });
    }
    const question = await FinalQuestion.exists({ _id: questionId, testId: exam._id });
    if (!question) {
      return res.status(404).json({ success: false, error: 'question', message: 'Question not found in this exam.' });
    }
    candidate.currentQuestionId = questionId;
    await candidate.save();
    return res.json({ success: true, currentQuestionId: String(questionId) });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/exam/submit (auth)
 * Final submit: computes score/percentage, updates the allow-list doc
 * (responses stay, attemptsUsed +1, status "submitted"/"auto-submitted") and
 * inserts the finalattempts row. Idempotent for already-submitted candidates.
 */
exports.submitExam = async (req, res, next) => {
  try {
    const { exam, candidate } = req;
    const now = new Date();

    // Optional system reason. A normal browser submit deliberately sends none.
    const reasonInput = typeof req.body?.reason === 'string' ? req.body.reason.trim().toLowerCase() : '';

    if (candidate.status === 'submitted' || candidate.status === 'auto-submitted') {
      const attempt = await getLatestAttempt(candidate._id);
      return res.json({
        success: true,
        alreadySubmitted: true,
        attempt: attemptToJson(attempt),
        result: attempt
          ? {
              score: attempt.score,
              totalMarks: attempt.totalMarks,
              percentage: attempt.percentage,
              correctAnswers: attempt.correctAnswers,
              wrongAnswers: attempt.wrongAnswers,
              unanswered: attempt.unanswered,
            }
          : null,
      });
    }

    // Disqualification path - bypass window/attempt guards, force auto-submit.
    if (reasonInput === 'malpractice' || reasonInput === 'time expired') {
      const outcome = await submitAttempt({ candidate, exam, reason: reasonInput, now });
      return res.json({
        success: true,
        disqualified: true,
        autoSubmitted: true,
        attempt: attemptToJson(outcome.attempt),
        result: outcome.result,
      });
    }

    if (candidate.status !== 'in progress') {
      return res.status(403).json({ success: false, error: 'session', message: 'This exam session is no longer active.' });
    }

    const eff = getEffectiveSettings(exam, candidate);

    // Window already closed during the attempt -> force auto-submit.
    if (now > eff.endAt) {
      const outcome = await maybeAutoSubmit(candidate, exam, now);
      return res.json({
        success: true,
        autoSubmitted: true,
        attempt: attemptToJson(outcome.attempt),
        result: outcome.result || null,
      });
    }

    if ((candidate.attemptsUsed || 0) >= eff.attempts) {
      return res.status(403).json({ success: false, error: 'attempts', message: 'No attempts left for this exam.' });
    }

    const outcome = await submitAttempt({ candidate, exam, reason: '', now });
    return res.json({
      success: true,
      attempt: attemptToJson(outcome.attempt),
      result: outcome.result,
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/exam/result (auth)
 * Post-submission score/percentage summary.
 */
exports.getResult = async (req, res, next) => {
  try {
    const { candidate } = req;

    const hasVisibleResult = candidate.status === 'submitted' ||
      (candidate.status === 'auto-submitted' && candidate.submissionReason === 'time expired');
    if (!hasVisibleResult) {
      return res.json({ success: true, available: false, message: 'Scores are available only after you submit the exam yourself.' });
    }

    const attempt = await getLatestAttempt(candidate._id);
    if (!attempt) {
      return res.json({ success: true, available: false, message: 'No submission record found for this session.' });
    }

    return res.json({
      success: true,
      available: true,
      attempt: attemptToJson(attempt),
      result: {
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        percentage: attempt.percentage,
        correctAnswers: attempt.correctAnswers,
        wrongAnswers: attempt.wrongAnswers,
        unanswered: attempt.unanswered,
        timeTakenMinutes: attempt.timeTaken,
        status: attempt.status,
        submissionReason: candidate.submissionReason || attempt.submissionReason || '',
        submittedAt: attempt.submittedAt,
        attemptsUsed: candidate.attemptsUsed || 0,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const VIOLATION_TYPES = new Set([
  'fullscreen-exit', // left full-screen mode
  'blur', // window lost focus
  'visibilitychange', // switched tab / minimised
  'copy', // copied question/answer text
  'cut',
  'paste',
  'contextmenu', // right-click
  'devtools', // F12 / Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
  'print', // print dialog (Ctrl+P / menu)
  'screenshot', // PrintScreen key
  'shortcut', // other blocked shortcuts (e.g. Ctrl+U view-source)
  'other',
]);

const MALPRACTICE_LIMIT = 3; // 3 warnings; 4th event disqualifies

/**
 * POST /api/exam/violation (auth)
 * Records a malpractice event:
 *  - one row in the `finalmalpractise` collection (full audit trail)
 *  - mirrored into finalallowedcandidates.violations (legacy)
 * Responds with the running count and whether the candidate is disqualified
 * (count > MALPRACTICE_LIMIT, i.e. the 4th offence).
 */
exports.recordViolation = async (req, res, next) => {
  try {
    const { candidate, exam } = req;
    const { type, detail } = req.body || {};

    const t = typeof type === 'string' ? type.toLowerCase().trim() : 'other';
    if (!VIOLATION_TYPES.has(t)) {
      return res.status(400).json({ success: false, error: 'validation', message: `Unknown violation type "${t}".` });
    }

    const trimmedDetail = typeof detail === 'string' ? detail.slice(0, 300) : '';
    const occurredAt = new Date();

    const attemptNumber = (candidate.attemptsUsed || 0) + 1;
    if (candidate.status === 'submitted' || candidate.status === 'auto-submitted') {
      const prev = await FinalMalpractice.countDocuments({ registrationId: candidate._id, testId: exam._id, attemptNumber });
      return res.json({ success: true, ignored: true, count: prev, limit: MALPRACTICE_LIMIT, disqualified: true, message: 'Exam already submitted.' });
    }

    if (candidate.status !== 'in progress') {
      return res.status(403).json({ success: false, ignored: true, count: 0, limit: MALPRACTICE_LIMIT, disqualified: false });
    }

    const violationNumber = (await FinalMalpractice.countDocuments({ registrationId: candidate._id, testId: exam._id, attemptNumber })) + 1;

    await FinalMalpractice.create({
      registrationId: candidate._id,
      hallTicketNo: candidate.hallTicketNo || '',
      testId: exam._id,
      finalExamId: exam.finalExamId || '',
      type: t,
      detail: trimmedDetail,
      violationNumber,
      attemptNumber,
      occurredAt,
    });

    // Legacy mirror on the allow-list doc.
    candidate.violations = candidate.violations || [];
    candidate.violations.push({ type: t, detail: trimmedDetail, occurredAt });
    candidate.markModified('violations');
    await candidate.save();

    return res.json({
      success: true,
      count: violationNumber,
      limit: MALPRACTICE_LIMIT,
      disqualified: violationNumber > MALPRACTICE_LIMIT,
    });
  } catch (err) {
    return next(err);
  }
};
