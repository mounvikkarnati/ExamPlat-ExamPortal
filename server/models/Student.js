const mongoose = require('mongoose');

/**
 * students - LEGACY, read-only source of student DOB.
 * strict:false + permissive matching (dob / dateOfBirth / ... and
 * hallTicketNo / hallTicket / hallticket). Never written by this portal.
 */
const studentSchema = new mongoose.Schema({}, { collection: 'students', strict: false, autoIndex: false });

module.exports = mongoose.model('Student', studentSchema, 'students');