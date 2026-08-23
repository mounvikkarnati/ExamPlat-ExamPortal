# ExamPlat — Final Exam Portal (Student-facing)

A full-stack **MERN** application that lets allow-listed candidates take **FINAL examinations**.
It reads from and writes to the **same MongoDB Atlas cluster/database** already used by the
ExamPlat Admin Portal and Student Portal — but it only ever touches the `FINAL*` collections:

| Collection                 | Access     | Purpose                                        |
| -------------------------- | ---------- | ---------------------------------------------- |
| `finalexams`               | read       | FINAL exam master records                      |
| `finalallowedcandidates`   | read/write | allow-list + candidate state (responses, score)|
| `finalquestions`           | read       | question bank per exam (`correctOption` never sent to client) |
| `finalattempts`            | write      | attempt/result rows created by THIS portal     |
| `students`                 | read-only  | legacy DOB fallback during login verification  |

> The legacy collections used by other portals (`tests`, `questions`, `allowedcandidates`, …)
> are **never** touched.

---

## Tech stack & ports

| Layer    | Tech                          | Port |
| -------- | ----------------------------- | ---- |
| Backend  | Node.js + Express + Mongoose  | from `PORT` in `server/.env` (spec default **5020**) |
| Frontend | React 18 (Vite) + Tailwind CSS| **5175** (`vite.config.js`, strictPort) |

> ⚠️ Whatever port the API uses, `VITE_API_URL` in `client/.env` must point at it.
> (This checkout's `.env` currently runs the API on **5030** — both sides are already aligned.)

Dependencies are deliberately minimal & stable: `express`, `mongoose`, `cors`, `dotenv`,
`jsonwebtoken` on the server; `react`, `react-dom`, `react-router-dom`, `axios`, Tailwind v3 on the client.

---

## Project structure

```
ExamPlat-ExamPortal/
├── server/                     # Express API
│   ├── server.js               # entry point: CORS, routes, boot
│   ├── config/db.js            # Mongoose connection (fails safely)
│   ├── models/
│   │   ├── FinalExam.js              # finalexams
│   │   ├── FinalAllowedCandidate.js  # finalallowedcandidates
│   │   ├── FinalQuestion.js          # finalquestions
│   │   ├── FinalAttempt.js           # finalattempts
│   │   ├── Student.js                # students (legacy, strict:false)
│   │   └── ExamRegistration.js       # examregistrations (legacy, READ-ONLY, DOB lookup)
│   ├── middleware/
│   │   ├── auth.js             # JWT sign/verify + re-read candidate/exam per request
│   │   └── errorHandler.js     # 404 + central error handler
│   ├── services/exam.service.js# window/attempts logic, grading, submit & auto-submit
│   ├── controllers/exam.controller.js
│   ├── routes/exam.routes.js
│   ├── scripts/
│   │   ├── inspect-db.js       # read-only: which DB holds the FINAL* collections
│   │   └── smoke-test.js       # read-only end-to-end login/start/questions test
│   └── utils/helpers.js        # hall-ticket / DOB normalization etc.
│
└── client/                     # React SPA (port 5175)
    ├── vite.config.js          # dev server pinned to 5175 (strictPort)
    ├── tailwind.config.js / postcss.config.js
    └── src/
        ├── api/client.js       # axios instance (JWT header + 401 handling)
        ├── context/AuthContext.jsx
        ├── components/ProtectedRoute.jsx
        ├── pages/
        │   ├── LoginPage.jsx     # 3-factor entry gate
        │   ├── DashboardPage.jsx # exam info + window/attempts status
        │   ├── ExamPage.jsx      # questions, timer, auto-save, violations, submit
        │   └── ResultPage.jsx    # score / percentage summary
        └── utils/format.js
```

---

## Setup

### Prerequisites
- Node.js ≥ 18
- Access to the shared MongoDB Atlas cluster (the Admin Portal's connection string works as-is)
- The `FINAL*` collections must already exist with data created by the Admin Portal
  (this portal never creates exams or allow-list entries)

### 1. Backend

```bash
cd server
npm install
```

Create `server/.env` (a ready-to-edit sample is included — just replace the Mongo URI):

```env
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/examplat?retryWrites=true&w=majority&appName=ExamPlat
PORT=5020
JWT_SECRET=<long-random-string>      # e.g. openssl rand -hex 32
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=http://localhost:5175
```

> ⚠️ The shipped `.env` uses a **placeholder** sample URI. Replace it with the real
> Atlas connection string before use. If the DB cannot be reached the API still boots,
> but every data call fails until the URI is fixed.

Run:

```bash
npm run dev     # nodemon
# or
npm start       # plain node
```

### 2. Frontend

```bash
cd client
npm install
```

`client/.env` (already provided):

```env
VITE_API_URL=http://localhost:5020/api
```

Run:

```bash
npm run dev
```

The Vite dev server is **pinned to port 5175** (`strictPort: true`) and CORS on the API
allows exactly that origin. Open 👉 **http://localhost:5175**

---

## Candidate flow (3-factor entry gate)

When a candidate lands on `http://localhost:5175` they must pass **all three** checks
together before any exam content is revealed:

1. **Hall Ticket No.** — matched (case-insensitively) against
   `finalallowedcandidates.hallTicketNo` for the exam.
2. **Exam/Test ID last 4 digits** — the candidate types only the last 4 numeric characters
   of the exam's `finalExamId` (e.g. for `FNL-2026-8460` they type `8460`). The backend finds
   the `finalexams` doc whose `finalExamId` ends with those digits (or by a supplied Mongo `_id`)
   and verifies the tail matches.
3. **Date of Birth** — compared against `finalallowedcandidates.dob`; if that is `null`,
   the DOB is resolved from the legacy collections (all READ-ONLY), in this order:
   1. `students` matched directly by hall-ticket fields
      (`hallTicketNo` / `hallTicket` / `hallticket`);
   2. `examregistrations` matched by `registrationNumber` / `hallTicketNo` →
      its `studentId` → that student's `dob`.
   Dates are compared as calendar dates (`YYYY-MM-DD`), tolerant of `DD/MM/YYYY` strings.

Any mismatch returns a **field-specific error**, shown under the offending input:
`"Hall ticket not allowed for this exam"`, `"Incorrect test ID ..."`,
`"DOB does not match the registration records."`.

On success the API issues a signed JWT `{ candidateId, examId }` (expires per
`JWT_EXPIRES_IN`, default 8h) plus exam metadata + candidate info.

### Exam screen (NTA / JEE-Mains style)

The taking screen mirrors a professional computer-based test:

- **One question at a time** — header strip shows `Q n of total`, an MCQ badge, the
  marking scheme (`+1 correct · 0 wrong`) and a "Marked for review" chip when flagged.
- **Options as full-width selectable rows** (radio-style A/B/C/D).
- **Action bar** per question: `← Previous`, `Clear Response` (deletes the saved
  response server-side), `Mark for Review & Next` (amber) and `Save & Next` (green).
- **Question palette sidebar** with live counts (Answered / Not answered / Marked /
  Not visited / Answered & marked), a colour-coded numbered grid (click any number to
  jump; current question ringed), legend, and a red **Submit Exam** button.
- **Timer chip** top-right counts down to the effective end time and turns pulsing-red
  under 5 minutes; at zero the exam is auto-submitted.
- **Instructions sheet** appears once when the exam loads (marking scheme, palette
  legend, violation warning, auto-submit rule).
- Answers **auto-save** ~0.6 s after selection; navigation and submit flush any pending
  saves first. The submit confirmation dialog summarises answered/unanswered/marked counts.

---

## Exam window & attempts (enforced server-side)

Effective values per candidate:

```
effective start    = startAtOverride || defaultStartAt
effective end      = endAtOverride   || defaultEndAt
effective attempts = attemptsOverride ?? defaultAttempts
```

| When | Behaviour |
| --- | --- |
| before effective start | blocked — "The exam has not started yet." |
| inside window & attempts left | allowed — dashboard shows *Start Exam* |
| after effective end | blocked; if the candidate had an active session it is **auto-submitted** (`status: "auto-submitted"`, `submissionReason: "time expired"`), a `finalattempts` row is written and `attemptsUsed` incremented |
| `attemptsUsed >= effectiveAttempts` | blocked — "You have used all your allowed attempts…" |

The countdown timer in the exam screen targets the **effective end time returned by the
server**; at zero it triggers submission (the server then records the auto-submit).
Auto-submit also happens defensively if an answer/submit request arrives after the window.

---

## API reference — `http://localhost:5020/api`

| Method | Endpoint             | Auth | Description |
| ------ | -------------------- | ---- | ----------- |
| POST   | `/exam/login`        | –    | 3-factor verification → `{ token, exam, candidate }`. Body: `{ hallTicketNo, testIdLast4, dob, examMongoId? }` |
| GET    | `/exam/start`        | JWT  | Exam window (`effectiveStartAt/effectiveEndAt`), question count, attempts left/used, candidate status. **Never returns questions or answers.** Pass `?begin=1` from the exam screen to flatten the session (status → `in progress`, session start recorded). |
| GET    | `/exam/questions`    | JWT  | Questions **without** `correctOption`: `{ id, number, questionText, options[4], subject, topic }` |
| POST   | `/exam/answer`       | JWT  | Upsert one answer `{ questionId, selectedOption(0–3) }` into `finalallowedcandidates.responses`. Send `selectedOption: null` to **clear** the saved response ("Clear Response" button). |
| POST   | `/exam/submit`       | JWT  | Final submit → grades, updates the allow-list doc, inserts the `finalattempts` row. Idempotent if already submitted; force auto-submits if the window has closed. |
| GET    | `/exam/result`       | JWT  | Post-submission summary: score, totalMarks, percentage, correct/wrong/unanswered, timeTaken, status, submissionReason |
| POST   | `/exam/violation`    | JWT  | Records `{ type: "blur"|"visibilitychange"|..., detail }` into `finalallowedcandidates.violations` |

Also available: `GET /api/health` (no DB access) for quick liveness checks.

### Developer utilities (read-only)

```bash
cd server
npm run inspect   # which database/collections hold the FINAL* data + doc counts
npm run smoke     # end-to-end: real login + /start + /questions leak check + error paths
```

`npm run smoke` needs the API running (`npm start`) and performs **no writes**
(no `begin` flag, no answers, no submit).

**Auth:** send `Authorization: Bearer <token>`. Every protected request re-verifies the JWT
**and re-reads the candidate + exam documents**, so answer saves and submissions always act
on fresh state (attempt counts, overrides, status changes).

---

## Grading rule

4-option MCQs only reward the correct option:

- correct option → **+1**
- wrong option → **0** (no negative marking)
- unanswered → **0**, counted in `unanswered` (**not** counted as wrong)
- `totalMarks = number of questions`
- `percentage = round(score / totalMarks * 10000) / 100`
- `timeTaken` = minutes between session start and submission (1 decimal)

On every submit this portal:

1. updates `finalallowedcandidates` — `responses` (already saved live), `score`,
   `status` (`submitted` / `auto-submitted`), `submissionReason`, `attemptsUsed + 1`,
   `resultPublishedAt`;
2. inserts one `finalattempts` row with
   `testId = finalExamId` (human-readable), **`testMongoId` = String(exam._id)**,
   `registrationId = candidate._id`, `attemptNumber`, all score fields,
   `startedAt`, `submittedAt`, `testTitle`, `examCategory`.

---

## Violation tracking

While the exam screen is open the client listens for `window.blur` and
`document.visibilitychange` (tab hidden) and posts each event to `/api/exam/violation`
(throttled to one report per type per ~1.5 s). Entries land in
`finalallowedcandidates.violations` as `{ type, detail, occurredAt }`.

---

## Testing against real data (Admin Portal created)

1. In the Admin Portal create a FINAL exam, e.g. `FNL-2026-8460`, with a window that
   includes *now*, `defaultAttempts ≥ 1`, and add yourself to the allow-list with your DOB.
2. Open http://localhost:5175, enter hall ticket + `8460` + DOB → dashboard → Start Exam.

### Quick Mongo sanity inserts (optional, for a smoke test)

```js
// mongosh — adjust DB name / ObjectIds to your cluster
const examId = ObjectId();
db.finalexams.insertOne({
  _id: examId,
  finalExamId: "FNL-2026-8460",
  title: "JEE Final Mock 2026",
  subject: "Physics",
  defaultStartAt: new Date(Date.now() - 3600e3),
  defaultEndAt: new Date(Date.now() + 3600e3),
  defaultAttempts: 1,
  status: "Live",
  examCategory: "JEE",
  selectAllStudents: false,
  candidateCount: 1,
});
db.finalallowedcandidates.insertOne({
  testId: examId,
  hallTicketNo: "HT20260001",
  dob: new Date("2003-05-12"),
  status: "not started",
  attemptsUsed: 0,
  responses: [],
  violations: [],
});
db.finalquestions.insertMany([
  { testId: examId, questionText: "SI unit of force?", options: ["Newton","Joule","Watt","Pascal"], correctOption: 0, subject: "Physics", topic: "Units" },
  { testId: examId, questionText: "g on Earth ≈ ?", options: ["9.8 m/s²","3.7 m/s²","1.6 m/s²","19.6 m/s²"], correctOption: 0, subject: "Physics", topic: "Gravity" },
]);
```

Then log in with Hall Ticket `HT20260001`, code `8460`, DOB `2003-05-12`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `[DB] MongoDB connection failed … ENOTFOUND` | You're still on the placeholder `MONGO_URI` in `server/.env`. Paste the real Atlas string (keep `<password>` URL-encoded). |
| Port 5020 already in use | Stop the other process or change `PORT` in `server/.env` (and `VITE_API_URL` in `client/.env`). |
| CORS error in browser console | Ensure the frontend runs on `http://localhost:5175` or add your origin to `CLIENT_ORIGIN` (comma-separated). |
| "Hall ticket not allowed…" though admin added you | Hall tickets are matched case-insensitively after trimming — check for stray spaces/different exam (`testId` must point at the same `finalexams._id`). |
| Timer looks off | The timer targets the server-provided effective end time; client clock skew doesn't matter — expiry is enforced server-side too. |

---

## Security notes

- No secrets are committed: `.env` files are git-ignored; `.env.example` files carry placeholders.
- Questions are only served inside the window (or post-submission) and `correctOption`
  never leaves the server.
- All grading happens server-side; the client can only save answers.
- Sessions expire per `JWT_EXPIRES_IN`; a 401 anywhere bounces the candidate back to login.