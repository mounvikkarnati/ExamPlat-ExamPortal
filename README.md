# ExamPlat — Final Exam Portal

A full-stack **MERN** web app that lets allow-listed candidates sit their **final
examinations** online. Candidates log in with a hall ticket + exam code + date of
birth, take a timed MCQ paper, and see their result instantly. It works against the
same MongoDB database already used by the ExamPlat Admin and Student portals, but it
only reads/writes the **`FINAL*`** collections.

---

## Features

- 🔐 **3-factor login** — hall ticket number, exam code, and date of birth
- 📋 Candidate **dashboard** — exam info, window timing, and attempt status
- ⏱️ **Timed exam** — server-authoritative timer with live auto-save
- ✅ **Instant results** — score, percentage, and answers after submission
- 🚨 **Violation tracking** — window/tab switch detection is recorded
- 🛡️ **Server-side grading** — the correct answers never reach the browser

## Tech stack & ports

| Layer    | Tech                                             | Port |
| -------- | ------------------------------------------------ | ---- |
| Backend  | Node.js + Express + Mongoose                     | 5030 |
| Frontend | React 18 (Vite) + Tailwind CSS                   | 5175 |

> The frontend talks to the backend through `VITE_API_URL` (default
> `http://localhost:5030/api`). Keep both `.env` files in sync if you change ports.

## Project structure

```
ExamPlat-ExamPortal/
├── server/                    # Express REST API
│   ├── server.js              # Entry point: CORS, routes, boot
│   ├── config/db.js           # MongoDB (Mongoose) connection
│   ├── models/                # Mongoose schemas (final* + legacy read-only)
│   ├── middleware/            # JWT auth + error handling
│   ├── services/              # Exam window/attempts/grading logic
│   ├── controllers/           # Request handlers
│   ├── routes/                # API route definitions
│   ├── scripts/               # Inspect-db & smoke-test utilities
│   ├── utils/                 # Shared helpers
│   └── .env.example           # Template for server env vars
│
└── client/                    # React (Vite) single-page app
    ├── vite.config.js         # Dev server pinned to port 5175
    ├── index.html
    ├── tailwind.config.js
    └── src/
        ├── api/               # Axios instance (auth header, 401 handling)
        ├── components/        # Shared UI components
        ├── context/           # Auth context
        ├── pages/             # Login, Dashboard, Exam, Result pages
        ├── utils/             # Formatting & clock helpers
        ├── App.jsx            # App root + routes
        └── main.jsx           # React entry point
```

## Setup

### Prerequisites
- [Node.js](https://nodejs.org) ≥ 18
- Access to the shared MongoDB Atlas cluster (the same one used by the Admin Portal)
- The `FINAL*` collections must already exist and contain data created by the Admin
  Portal (this portal never creates exams or allow-lists candidates).

### 1. Install dependencies

```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

### 2. Configure environment variables

Each folder needs its own `.env` file. Copy the example and fill in real values:

```bash
# Backend
cd server
cp .env.example .env   # then edit MONGO_URI, JWT_SECRET, PORT, CLIENT_ORIGIN

# Frontend
cd ../client
cp .env.example .env   # then edit VITE_API_URL
```

| File           | Key              | Description                                        |
| -------------- | ---------------- | -------------------------------------------------- |
| `server/.env`  | `MONGO_URI`      | MongoDB Atlas connection string                    |
|                | `PORT`           | API port (default `5030`)                          |
|                | `JWT_SECRET`     | Secret used to sign session tokens                 |
|                | `JWT_EXPIRES_IN` | Session lifetime (e.g. `8h`)                       |
|                | `CLIENT_ORIGIN`  | Allowed frontend origin(s), comma-separated        |
| `client/.env`  | `VITE_API_URL`   | Backend API base URL (e.g. `http://localhost:5030/api`) |

> **Important:** the `MONGO_URI` must point at the **same database** the Admin Portal
> uses, and `VITE_API_URL` must point at your running API server.

### 3. Run the app

Open two terminals:

```bash
# Terminal 1 — backend API  (http://localhost:5030)
cd server
npm run dev

# Terminal 2 — frontend app (http://localhost:5175)
cd client
npm run dev
```

Verify the server is up: visit `http://localhost:5030/api/health` — it should return
`{"ok": true, ...}`. Then open **http://localhost:5175** to log in.

---

## Scripts

### Server (`cd server`)
| Command          | Description                              |
| ---------------- | ---------------------------------------- |
| `npm run dev`    | Start the API with auto-reload (nodemon) |
| `npm start`      | Start the API in production mode         |
| `npm run inspect`| Read-only: show which DB holds the data  |
| `npm run smoke`  | Read-only end-to-end login/start test    |
| `npm run check`  | Syntax-check all server source files     |

### Client (`cd client`)
| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `npm run dev`    | Start the Vite dev server            |
| `npm run build`  | Build a production bundle to `dist/` |
| `npm run preview`| Preview the built production app     |

---

## How to use / test

1. In the **Admin Portal**, create a FINAL exam with a window that includes *now* and
   at least 1 attempt, then add yourself to the allow-list with your DOB.
2. Open **http://localhost:5175**, enter your hall ticket, the exam code, and your DOB.
3. On the dashboard click **Start Exam**, answer the questions, and submit — your
   result appears instantly.

> See `server/scripts/smoke-test.js` for a scripted end-to-end test of the login,
> start, and questions flow against real data.

---

## Troubleshooting

| Symptom                              | Fix                                                        |
| ------------------------------------ | ---------------------------------------------------------- |
| `MongoDB connection failed… ENOTFOUND` | Your `MONGO_URI` still has placeholders. Paste the real Atlas string. |
| Port already in use                  | Stop the other process, or change `PORT` in both `.env` files. |
| CORS error in console                | Keep the frontend on `http://localhost:5175` or add your origin to `CLIENT_ORIGIN`. |
| "Hall ticket not allowed"            | Must be on the allow-list for that specific exam — check for stray spaces. |
| Timer looks wrong                    | The timer uses the server-provided time; expiry is also enforced server-side. |

---

## Security notes

- **No secrets are committed** — `.env` files are git-ignored; `.env.example` files
  hold placeholders only.
- Questions are only served inside the exam window, and **`correctOption` never leaves
  the server**.
- All grading happens **server-side**; the client can only save answers.
- Sessions expire per `JWT_EXPIRES_IN`; a 401 anywhere returns the candidate to login.