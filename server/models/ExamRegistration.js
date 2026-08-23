const mongoose = require('mongoose');

/**
 * examregistrations - LEGACY, READ-ONLY.
 * Used only to resolve hall ticket -> studentId during DOB verification
 * (the legacy `students` collection stores no hall-ticket field, so the
 * registration that issued the hall ticket provides the link).
 */
const examRegistrationSchema = new mongoose.Schema(
  {},
  { collection: 'examregistrations', strict: false, autoIndex: false }
);

module.exports = mongoose.model('ExamRegistration', examRegistrationSchema, 'examregistrations');