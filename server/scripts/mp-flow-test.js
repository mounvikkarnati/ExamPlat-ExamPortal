/* TEMPORARY end-to-end malpractice flow test (run against a scratch port, then cleaned up). */
require('dotenv').config();

const mongoose = require('mongoose');

const BASE = process.env.TEST_BASE || `http://localhost:${process.env.PORT || 5030}/api`;
const HALL = 'EX202600001';
const CODE = '2286';
const DOB = '2008-01-29';

(async () => {
  const call = async (path, { method = 'GET', token, body } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  // 1. login
  let r = await call('/exam/login', { method: 'POST', body: JSON.stringify({ hallTicketNo: HALL, testIdLast4: CODE, dob: DOB }) });
  console.log(`[login]            HTTP ${r.status} success=${r.data.success}`);
  if (!r.data.success) { console.log('   blocked:', r.data.message); process.exit(0); }
  const token = r.data.token;

  // 2. begin session
  r = await call('/exam/start?begin=1', { token });
  console.log(`[begin]            HTTP ${r.status} allowed=${r.data.allowed} duration=${r.data.details?.durationMinutes} endAt=${r.data.details?.effectiveEndAt}`);

  // 3. four malpractice strikes
  const events = [
    ['fullscreen-exit', 'exited full screen (test)'],
    ['copy', 'tried to copy question (test)'],
    ['contextmenu', 'right-click (test)'],
    ['devtools', 'F12 pressed (test)'],
  ];
  for (let i = 0; i < events.length; i += 1) {
    r = await call('/exam/violation', { method: 'POST', token, body: { type: events[i][0], detail: events[i][1] } });
    console.log(`[strike ${i + 1}]         HTTP ${r.status} count=${r.data.count} disqualified=${r.data.disqualified} (${events[i][0]})`);
  }

  // 4. disqualification submit
  r = await call('/exam/submit', { method: 'POST', token, body: { reason: 'malpractice' } });
  console.log(`[dq submit]        HTTP ${r.status} disqualified=${r.data.disqualified} status=${r.data.attempt?.status}`);

  // 5. result shows malpractice reason
  r = await call('/exam/result', { token });
  console.log(`[result]           reason="${r.data.result?.submissionReason}" status=${r.data.result?.status}`);

  // 6. re-login must say exam over
  r = await call('/exam/login', { method: 'POST', body: JSON.stringify({ hallTicketNo: HALL, testIdLast4: CODE, dob: DOB }) });
  console.log(`[re-login]         HTTP ${r.status} error=${r.data.error} message="${r.data.message}"`);

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });