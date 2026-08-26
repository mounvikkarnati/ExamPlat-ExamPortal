import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { cn, formatDateTime } from '../utils/format';
import logo from '../logo.png';
import LiveISTClock from '../components/LiveISTClock';

export default function DashboardPage() {
  const { logout, candidate, exam: loginExam } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/exam/start');
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load exam details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-sm font-medium text-slate-500">Loading exam details…</div>
      </div>
    );
  }

  const exam = data?.exam || loginExam;
  const details = data?.details || null;
  const block = !data?.allowed;
  const autoSubmitted = data?.autoSubmitted;
  const autoMessage = autoSubmitted ? data?.message || 'Your exam was auto-submitted.' : '';

  const statCards = [
    { label: 'Questions', value: details?.questionCount ?? '—' },
    { label: 'Total marks', value: details?.totalMarks ?? '—' },
    {
      label: 'Attempts left',
      value: details?.attemptsLeft ?? '—',
      sub: `${details?.attemptsLeft ?? 0} of ${details?.effectiveAttempts ?? '—'} allowed`,
    },
  ];

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <img src={logo} alt="ExamPlat" className="brand-mark h-10 w-10" />
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">ExamPlat</p>
              <p className="text-xs text-slate-500">Final exam portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-xs font-semibold text-slate-700">{candidate?.hallTicketNo || 'Candidate'}</p><LiveISTClock className="text-[10px] font-medium tabular-nums text-slate-400" /></div>
            <button className="btn-secondary" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {error && (
          <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {autoMessage && <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{autoMessage}</div>}

        <div className="mb-5"><p className="eyebrow">Assessment overview</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Your final examination</h1><p className="mt-1 text-sm text-slate-500">Review the details below before entering the assessment.</p></div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-5 border-b border-slate-100 px-6 py-6 sm:px-8">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="chip bg-indigo-100 text-indigo-700">{exam?.examCategory || 'EXAM'}</span>
                <span className="font-mono text-xs text-slate-400">{exam?.finalExamId}</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">{exam?.title}</h2>
              {exam?.subject && <p className="mt-0.5 text-sm text-slate-500">Subject: {exam.subject}</p>}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-500 sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Exam window · IST</p>
              <p className="mt-1 font-medium text-slate-700">{formatDateTime(details?.effectiveStartAt)}</p>
              <p className="font-medium text-slate-700">→ {formatDateTime(details?.effectiveEndAt)}</p>
              {details?.usesOverrides && (
                <p className="mt-0.5 text-xs font-semibold text-indigo-600">Personal schedule applied</p>
              )}
              {!!details?.durationMinutes && (
                <p className="mt-1 text-xs font-semibold text-indigo-600">
                  ⏱ {details.durationMinutes} min
                  {details?.candidateStatus === 'not started' ? ' · timer starts when you begin' : ''}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 bg-slate-50/60 px-6 py-5 sm:grid-cols-3 sm:px-8">
            {statCards.map((s) => (
              <div key={s.label} className="metric-card">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{s.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{s.value}</p>
                {s.sub && <p className="mt-1 text-xs text-slate-500">{s.sub}</p>}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 bg-white px-6 py-5 sm:px-8">
            {block ? (
              <div className={cn("rounded-xl border px-4 py-3.5 text-sm", data?.blockReason === "ATTEMPTS_EXHAUSTED" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-800")}>
                <p className="font-semibold">{data?.message || 'You cannot start this exam right now.'}</p>
                {data?.blockReason === 'NOT_STARTED' && (
                  <p className="mt-1">
                    The exam opens at <span className="font-medium">{formatDateTime(details?.effectiveStartAt)}</span>.
                  </p>
                )}
                {details?.candidateStatus === 'submitted' && (data?.blockReason === 'ENDED' || data?.blockReason === 'ATTEMPTS_EXHAUSTED') ? (
                  <button className="mt-2 font-semibold text-indigo-600 underline" onClick={() => navigate('/result')}>
                    View your result
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm leading-6 text-slate-500">
                  Your exam window is open. You have <span className="font-semibold text-slate-800">{details?.attemptsLeft}</span> attempt
                  {details?.attemptsLeft === 1 ? '' : 's'} remaining.
                </p>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setStarting(true);
                    navigate('/exam');
                  }}
                  disabled={!data?.allowed}
                >
                  {starting ? 'Starting…' : details?.candidateStatus === 'in progress' || details?.candidateStatus === 'auto-submitted' ? 'Resume Exam' : 'Start Exam'}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-7 text-center text-xs text-slate-400">
          Once started, the assessment opens in secure full-screen mode. Leaving the exam environment is recorded.
        </p>
      </main>
    </div>
  );
}
