const jwt = require('jsonwebtoken');

const FinalAllowedCandidate = require('../models/FinalAllowedCandidate');
const FinalExam = require('../models/FinalExam');

const getSecret = () => process.env.JWT_SECRET || 'insecure-dev-secret-change-me';

/** Sign a JWT with the candidate + exam identity. */
function signExamToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

/** Verify the Bearer token on every protected route. */
function requireToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'auth', message: 'Authentication required. Please log in first.' });
  }
  try {
    const payload = jwt.verify(token, getSecret());
    if (!payload.candidateId || !payload.examId) throw new Error('malformed token payload');
    req.auth = { candidateId: payload.candidateId, examId: payload.examId };
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'auth', message: 'Session expired or invalid. Please log in again.' });
  }
}

/**
 * RE-READS the candidate and exam documents from the DB on every request so that
 * saving answers / submitting always works against the freshest state
 * (attempt counts, window overrides, statuses, etc. stay consistent).
 */
async function loadExam(req, res, next) {
  try {
    const [candidate, exam] = await Promise.all([
      FinalAllowedCandidate.findById(req.auth.candidateId),
      FinalExam.findById(req.auth.examId),
    ]);
    if (!candidate || !exam) {
      return res.status(401).json({ success: false, error: 'auth', message: 'Session no longer valid. Please log in again.' });
    }
    req.candidate = candidate;
    req.exam = exam;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  signExamToken,
  requireToken,
  loadExam,
  authProtected: [requireToken, loadExam],
};