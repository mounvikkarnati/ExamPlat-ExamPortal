require('dotenv').config();
require('../config/db');
const FinalAllowedCandidate = require('../models/FinalAllowedCandidate');
const FinalMalpractice = require('../models/FinalMalpractice');

(async () => {
  await FinalMalpractice.deleteMany({});
  await FinalAllowedCandidate.updateOne(
    { hallTicketNo: 'EX202600001' },
    {
      $set: {
        status: 'not started',
        sessionStartedAt: null,
        submissionReason: '',
        resultPublishedAt: null,
        attemptsUsed: 0,
        score: 0,
        violations: [],
        responses: [],
      },
      $unset: { endAtOverride: '', startAtOverride: '', attemptsOverride: '' },
    }
  );
  const c = await FinalAllowedCandidate.findOne({ hallTicketNo: 'EX202600001' }).lean();
  console.log('reset: status=%s attemptsUsed=%s violations=%s sessionStartedAt=%s', c.status, c.attemptsUsed, (c.violations||[]).length, c.sessionStartedAt);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
