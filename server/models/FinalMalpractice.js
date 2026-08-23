const mongoose = require('mongoose');

/**
 * finalmalpractise - audit trail of EVERY malpractice event detected during a
 * FINAL exam attempt (written by THIS portal).
 *
 * Examples: fullscreen-exit, tab-switch/blur, copy/cut/paste, right-click,
 * devtools shortcut, print, screenshot key.
 *
 * Policy: 3 warnings allowed; the 4th event disqualifies the candidate
 * (exam auto-submitted, session terminated).
 */
const finalMalpracticeSchema = new mongoose.Schema(
  {
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinalAllowedCandidate', required: true },
    hallTicketNo: { type: String, default: '' },
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinalExam', required: true },
    finalExamId: { type: String, default: '' },
    type: { type: String, required: true }, // fullscreen-exit | blur | visibilitychange | copy | cut | paste | contextmenu | devtools | print | screenshot | shortcut | other
    detail: { type: String, default: '' },
    violationNumber: { type: Number, default: 1 }, // 1..3 = warning, 4+ = disqualification
    attemptNumber: { type: Number, default: 1 }, // resets for each new attempt
    occurredAt: { type: Date, default: Date.now },
  },
  { collection: 'finalmalpractise', strict: false, timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('FinalMalpractice', finalMalpracticeSchema, 'finalmalpractise');
