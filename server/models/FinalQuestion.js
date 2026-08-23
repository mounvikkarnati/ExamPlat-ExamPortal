const mongoose = require('mongoose');

/**
 * finalquestions - question bank of a FINAL exam (written by Admin Portal, read here).
 * options = exactly 4 strings; correctOption = 0-3 index into options.
 */
const finalQuestionSchema = new mongoose.Schema(
  {
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinalExam', required: true },
    questionText: { type: String, required: true },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 4 && v.every((o) => typeof o === 'string'),
        message: 'A final question must have exactly 4 options.',
      },
    },
    correctOption: { type: Number, required: true, min: 0, max: 3 },
    subject: { type: String, default: '' },
    topic: { type: String, default: '' },
  },
  { collection: 'finalquestions', strict: false, timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('FinalQuestion', finalQuestionSchema, 'finalquestions');