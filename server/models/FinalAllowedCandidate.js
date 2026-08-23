const mongoose = require('mongoose');

const responseSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOption: { type: Number, min: 0, max: 3 },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * finalallowedcandidates - who may take a FINAL exam (written by Admin Portal, read/written here).
 * Index (`testId`, `hallTicketNo`) is already unique in the shared DB.
 */
const finalAllowedCandidateSchema = new mongoose.Schema(
  {
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinalExam', required: true },
    hallTicketNo: { type: String, required: true, trim: true },
    dob: { type: Date, default: null },
    startAtOverride: { type: Date, default: null },
    endAtOverride: { type: Date, default: null },
    attemptsOverride: { type: Number, default: null, min: 0 },
    status: { type: String, enum: ['not started', 'in progress', 'submitted', 'auto-submitted'], default: 'not started' },
    submissionReason: { type: String, default: '' },
    violations: { type: [mongoose.Schema.Types.Mixed], default: [] },
    score: { type: Number, default: 0 },
    attemptsUsed: { type: Number, default: 0, min: 0 },
    responses: { type: [responseSchema], default: [] },
    resultPublishedAt: { type: Date, default: null },
    resultEmail: { type: String, default: '' },
    resultDeliveryError: { type: String, default: '' },
    // Extra field used ONLY by this portal to measure attempt time (safe under strict:false)
    sessionStartedAt: { type: Date, default: null },
    // Last question viewed; used to return an automatic-submission retry to
    // the same point in the paper.
    currentQuestionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Exact server-side time remaining when an attempt was automatically ended.
    resumeRemainingMs: { type: Number, default: null },
  },
  { collection: 'finalallowedcandidates', strict: false, timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('FinalAllowedCandidate', finalAllowedCandidateSchema, 'finalallowedcandidates');
