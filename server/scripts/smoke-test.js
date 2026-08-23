/**
 * READ-ONLY end-to-end smoke test against a RUNNING ExamPlat API.
 *
 *   1. start the API:            cd server && npm start
 *   2. in another terminal:      npm run smoke
 *
 * It picks the first finalexams + allow-listed candidate in the DB and exercises:
 *   - login with CORRECT 3 factors  -> expect success + JWT
 *   - login with WRONG DOB          -> expect dob error
 *   - login with WRONG 4-digit code -> expect testId error
 *   - login with UNKNOWN hall ticket-> expect hallTicket error
 *   - GET /start with the token     -> window/attempts info
 *   - GET /questions with the token -> verifies `correctOption` is NOT exposed
 *
 * No writes are performed (no begin flag, no answers, no submit).
 */
require('dotenv').config();

const mongoose = require('mongoose');
const FinalExam = require('../models/FinalExam');
const FinalAllowedCandidate = require('../models/FinalAllowedCandidate');
const { getStudentDobByHallTicket } = require('../services/exam.service');

const mask = (s) => (s && s.length > 4 ? `${s.slice(0, 3)}***${s.slice(-2)}` : '***');
const dobIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

(async () => {
  const base = process.env.SMOKE_API_BASE || `http://localhost:${process.env.PORT || 5020}/api`;

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const exam = await FinalExam.findOne({}).lean();
  if (!exam) {
    console.log('No finalexams documents found. Create one in the Admin Portal first.');
    process.exit(0);
  }
  const candidate = await FinalAllowedCandidate.findOne({ testId: exam._id }).lean();
  if (!candidate) {
    console.log(`Exam ${exam.finalExamId} has no allow-listed candidates.`);
    process.exit(0);
  }

  const hall = candidate.hallTicketNo;
  const last4 = String(exam.finalExamId).slice(-4);
  let dob = dobIso(candidate.dob);
  let dobSource = candidate.dob ? 'finalallowedcandidates' : null;
  if (!dob) {
    const studentDob = await getStudentDobByHallTicket(hall);
    if (studentDob) {
      dob = dobIso(studentDob);
      dobSource = 'students fallback';
    }
  }
  console.log(`Target exam: ${exam.finalExamId} (${exam.title}) | candidate ${mask(hall)} | code ${last4} | dob ${dob ? `present via ${dobSource}` : 'MISSING'}`);

  const post = async (body) => {
    const res = await fetch(`${base}/exam/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };

  // 1) correct login
  const ok = await post({ hallTicketNo: hall, testIdLast4: last4, dob });
  console.log(`\n[correct creds]   -> HTTP ${ok.status} success=${ok.data.success} ${ok.data.success ? `token received, exam="${ok.data.exam.title}"` : `error=${ok.data.error}: ${ok.data.message}`}`);

  if (ok.data.success) {
    const token = ok.data.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 2) GET /start
    const startRes = await fetch(`${base}/exam/start`, { headers: authHeaders });
    const startData = await startRes.json();
    console.log(`[GET /start]      -> HTTP ${startRes.status} allowed=${startData.allowed} block=${startData.blockReason || '-'} questions=${startData.details?.questionCount} attemptsLeft=${startData.details?.attemptsLeft} status=${startData.details?.candidateStatus}`);

    // 3) GET /questions - must NOT contain correctOption
    const qRes = await fetch(`${base}/exam/questions`, { headers: authHeaders });
    const qData = await qRes.json();
    const leaks = (qData.questions || []).some((q) => 'correctOption' in q || 'correct' in q);
    console.log(`[GET /questions]  -> HTTP ${qRes.status} count=${qData.count ?? '-'} correctOptionLeaked=${leaks}`);
  }

  // 4) wrong DOB
  if (dob) {
    const shifted = new Date(new Date(dob).getTime() + 86400e3).toISOString().slice(0, 10);
    const badDob = await post({ hallTicketNo: hall, testIdLast4: last4, dob: shifted });
    console.log(`[wrong dob]       -> HTTP ${badDob.status} error=${badDob.data.error} (${badDob.data.message})`);
  }

  // 5) wrong 4-digit code
  const badCode = await post({ hallTicketNo: hall, testIdLast4: last4 === '0000' ? '1111' : '0000', dob });
  console.log(`[wrong code]      -> HTTP ${badCode.status} error=${badCode.data.error} (${badCode.data.message})`);

  // 6) unknown hall ticket
  const badHall = await post({ hallTicketNo: 'NO-SUCH-TICKET-XYZ', testIdLast4: last4, dob });
  console.log(`[unknown ticket]  -> HTTP ${badHall.status} error=${badHall.data.error} (${badHall.data.message})`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error('SMOKE ERROR:', err.message);
  process.exit(1);
});