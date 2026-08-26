require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const examRoutes = require('./routes/exam.routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5030;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5175';

// ---- CORS: allow the Vite dev server on 5175 (and any origin listed in CLIENT_ORIGIN) ----
const allowedOrigins = String(CLIENT_ORIGIN)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin "${origin}" not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '1mb' }));

// Health check (no DB access)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ExamPlat Final Exam Portal API',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

// Exam endpoints (login, start, questions, answer, submit, result, violation)
app.use('/api/exam', examRoutes);

app.use(notFound);
app.use(errorHandler);

async function start() {
  // The exam API is DB-strict by design: candidates must not be able to sit an
  // exam unless MongoDB is reachable. connectDB() returns false (nothing throws)
  // if the DB is unavailable, so a failed DB connection does not crash the boot.
  await connectDB();
  // Bind to 0.0.0.0 so Render's external proxy can route traffic to this process.
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ExamPlat] Final Exam Portal API listening on port ${PORT}`);
    console.log(`[ExamPlat] CORS allowed origin(s): ${allowedOrigins.join(', ') || '(all non-browser)'}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[ExamPlat] Port ${PORT} is already in use. Free the port (or change PORT in server/.env) and retry.`);
    } else {
      console.error('[ExamPlat] Failed to start HTTP server:', err);
    }
    process.exit(1);
  });
}

start();

module.exports = app;