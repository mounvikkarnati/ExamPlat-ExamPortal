const mongoose = require('mongoose');

/**
 * finalattempts - attempt/result rows written by THIS portal on every submission.
 * Note: `testMongoId` is stored as a STRING of the exam _id (per spec).
 */
const finalAttemptSchema = new mongoose.Schema(
  {
    studentId: { type: String, default: '' },
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinalAllowedCandidate' },
    testId: { type: String, default: '' }, // human-readable exam id, e.g. FNL-2026-8460
    testMongoId: { type: String, default: '' }, // STRING of the exam's _id
    examType: { type: String, default: 'Final' },
    attemptNumber: { type: Number, default: 1 },
    status: { type: String, default: 'submitted' },
    score: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    wrongAnswers: { type: Number, default: 0 },
    unanswered: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    timeTaken: { type: Number, default: 0 }, // minutes
    startedAt: { type: Date, default: null },
    testTitle: { type: String, default: '' },
    examCategory: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
  },
  { collection: 'finalattempts', strict: false, timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('FinalAttempt', finalAttemptSchema, 'finalattempts');