const express = require('express');

const { authProtected } = require('../middleware/auth');
const examController = require('../controllers/exam.controller');

const router = express.Router();

/**
 * ExamPlat Final Exam Portal - student-facing API.
 * Mounted by server.js at /api/exam, so every route below is reachable at
 * http://localhost:5030/api/exam/...
 */

// PUBLIC - 3-factor entry verification. Returns JWT + exam metadata on success.
router.post('/login', examController.login);

// PROTECTED (JWT) - all routes below re-read the candidate + exam docs per request.

// Exam window, question count, attempts left (NO questions, NO answers).
router.get('/start', authProtected, examController.start);

// Full question list WITHOUT correctOption.
router.get('/questions', authProtected, examController.getQuestions);

// Save a single answer { questionId, selectedOption }.
router.post('/answer', authProtected, examController.saveAnswer);

// Persist the last question being viewed so an automatic-submission retry resumes there.
router.post('/progress', authProtected, examController.saveProgress);

// Final submit - computes + stores result, increments attemptsUsed.
router.post('/submit', authProtected, examController.submitExam);

// Post-submission score/percentage summary.
router.get('/result', authProtected, examController.getResult);

// Record a tab-change / blur violation.
router.post('/violation', authProtected, examController.recordViolation);

module.exports = router;
