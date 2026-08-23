const mongoose = require('mongoose');

/**
 * finalexams - the FINAL exam master record (written by the Admin Portal, read here).
 */
const finalExamSchema = new mongoose.Schema(
  {
    finalExamId: { type: String, required: true, trim: true }, // human-readable, e.g. FNL-2026-8460
    title: { type: String, required: true, trim: true },
    subject: { type: String, default: '', trim: true },
    defaultStartAt: { type: Date, required: true },
    defaultEndAt: { type: Date, required: true },
    defaultAttempts: { type: Number, default: 1, min: 0 },
    // minutes; admin portal may store either a number or {hours, minutes} -> keep Mixed
    duration: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['Scheduled', 'Live', 'Completed'], default: 'Scheduled' },
    examCategory: { type: String, enum: ['JEE', 'NEET'], default: 'JEE' },
    selectAllStudents: { type: Boolean, default: false },
    candidateCount: { type: Number, default: 0 },
    resultsPublishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'finalexams', strict: false, timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('FinalExam', finalExamSchema, 'finalexams');