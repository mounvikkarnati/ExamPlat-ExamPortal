import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatMinutes } from '../utils/format';
import logo from '../logo.png';

export default function ResultPage() {
  const navigate = useNavigate();
  const { logout, candidate } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoLogoutSecs, setAutoLogoutSecs] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/exam/result');
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'Could not load your result.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A score page is shown only for an intentional submit and ends the session
  // after a short review period.
  useEffect(() => {
    if (!data?.available) return undefined;

    setAutoLogoutSecs(8);
    const iv = window.setInterval(() => {
      setAutoLogoutSecs((s) => {
        if (s <= 1) {
          window.clearInterval(iv);
          logout();
          navigate('/login', { replace: true });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(iv);
  }, [data, logout, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm font-medium text-slate-500">Loading result…</p>
      </div>
    );
  }

  if (error || !data?.available) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="card w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Result not yet available</h1>
          <p className="mt-2 text-sm text-slate-500">
            {error || data?.message || 'Your result is unavailable right now.'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button className="btn-secondary" onClick={() => navigate('/')}>
              Dashboard
            </button>
            <button className="btn-secondary" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const r = data.result;
  const percentage = Number(r.percentage) || 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * Math.min(100, percentage)) / 100;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="ExamPlat" className="h-9 w-9 rounded-xl object-contain" />
            <p className="text-sm font-bold text-slate-900">ExamPlat · Final Exam Result</p>
          </div>
          <button className="btn-secondary" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="card p-6 sm:p-8">
          <p className="text-center text-xs font-medium uppercase tracking-widest text-slate-400">
            {data.attempt?.testTitle || 'Final Exam'} · {data.attempt?.examCategory || 'Result'}
          </p>

          <div className="mt-6 flex flex-col items-center">
            <svg viewBox="0 0 120 120" className="h-36 w-36">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={percentage >= 90 ? '#059669' : percentage >= 40 ? '#4f46e5' : '#e11d48'}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                transform="rotate(-90 60 60)"
              />
              <text x="60" y="58" textAnchor="middle" dominantBaseline="central" className="fill-slate-900 text-xl font-bold">
                {percentage}%
              </text>
              <text x="60" y="78" textAnchor="middle" className="fill-slate-400 text-[10px]">
                score
              </text>
            </svg>
            <p className="mt-3 text-2xl font-bold text-slate-900">
              {r.score} <span className="text-base font-medium text-slate-400">/ {r.totalMarks}</span>
            </p>
            <p className="text-sm text-slate-500">marks obtained out of total questions</p>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-center">
              <p className="text-2xl font-bold text-emerald-700">{r.correctAnswers}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-600">Correct</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-center">
              <p className="text-2xl font-bold text-rose-700">{r.wrongAnswers}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-rose-600">Wrong</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
              <p className="text-2xl font-bold text-slate-700">{r.unanswered}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Unanswered</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-2.5">
              <dt className="text-slate-500">Time taken</dt>
              <dd className="font-semibold text-slate-800">{formatMinutes(r.timeTakenMinutes)}</dd>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-2.5">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-semibold text-slate-800">
                {r.status === 'auto-submitted' ? 'Auto-submitted' : 'Submitted'}
              </dd>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-2.5">
              <dt className="text-slate-500">Submitted at</dt>
              <dd className="font-semibold text-slate-800">{formatDateTime(r.submittedAt)}</dd>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-2.5">
              <dt className="text-slate-500">Attempts used</dt>
              <dd className="font-semibold text-slate-800">{r.attemptsUsed}</dd>
            </div>
          </dl>

          {r.status === 'auto-submitted' && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Note:</span> The exam ran out of time and was auto-submitted
              {r.submissionReason ? ` (${r.submissionReason})` : ''}.
            </div>
          )}

          {autoLogoutSecs !== null && (
            <div className="mt-5 rounded-lg border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-medium text-rose-800">
              Your exam session is complete. You will be signed out automatically in <b>{autoLogoutSecs}s</b>.
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className="btn-secondary" onClick={() => navigate('/')}>
              Back to Dashboard
            </button>
            <button className="btn-primary" onClick={logout}>
              Log out
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">Candidate: {candidate?.hallTicketNo || ''}</p>
      </main>
    </div>
  );
}
