import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import logo from '../logo.png';
import LiveISTClock from '../components/LiveISTClock';

const FIELD_KEYS = { hallTicket: '', testId: '', dob: '' };

export default function LoginPage() {
  const { token, login } = useAuth();
  const navigate = useNavigate();

  const [hallTicketNo, setHallTicketNo] = useState('');
  const [testIdLast4, setTestIdLast4] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState(FIELD_KEYS);
  const [general, setGeneral] = useState('');

  if (token) return <Navigate to="/" replace />;

  const inputClass = (hasError) =>
    `input ${hasError ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200' : ''}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldErrors(FIELD_KEYS);
    setGeneral('');
    if (!hallTicketNo.trim() || !testIdLast4.trim() || !dob) {
      setGeneral('Please fill in all three fields to verify your identity.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/exam/login', { hallTicketNo, testIdLast4, dob });
      login(res.data);
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to log in. Please check your details and try again.';
      const field = err.response?.data?.error;
      if (field && field in FIELD_KEYS) setFieldErrors((prev) => ({ ...prev, [field]: msg }));
      else setGeneral(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="portal-shell flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-35px_rgba(15,23,42,0.4)] lg:grid-cols-[0.92fr_1.08fr]">
        <section className="relative overflow-hidden bg-slate-950 px-7 py-9 text-white sm:px-10 lg:min-h-[650px] lg:py-12">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/30 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-sky-400/15 blur-3xl" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center gap-3">
              <img src={logo} alt="ExamPlat" className="h-11 w-11 rounded-xl object-contain ring-1 ring-white/20" />
              <div><p className="font-bold tracking-tight">ExamPlat</p><p className="text-xs text-slate-400">Secure assessment platform</p></div>
            </div>
            <div className="my-auto py-12">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Candidate workspace</p>
              <h1 className="mt-4 max-w-sm text-3xl font-bold leading-tight tracking-tight sm:text-4xl">A focused, secure way to take your final exam.</h1>
              <p className="mt-5 max-w-sm text-sm leading-6 text-slate-300">Your identity, exam window and responses are verified and protected throughout the assessment.</p>
              <div className="mt-8 space-y-3 text-sm text-slate-200"><p>✓ Server-synchronised exam timing</p><p>✓ Automatic answer saving</p><p>✓ Secure full-screen assessment</p></div>
            </div>
            <LiveISTClock className="text-xs font-semibold tabular-nums text-indigo-200" />
          </div>
        </section>
        <section className="px-6 py-9 sm:px-10 sm:py-12">
          <div className="mx-auto max-w-md">
            <p className="eyebrow">Candidate sign in</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Verify your identity</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Enter the details exactly as provided in your exam registration.</p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="hallTicketNo" className="mb-1.5 block text-sm font-medium text-slate-700">
                Hall Ticket No. <span className="text-indigo-600">1</span>
              </label>
              <input
                id="hallTicketNo"
                type="text"
                autoComplete="off"
                placeholder="e.g. HT20260001"
                value={hallTicketNo}
                className={inputClass(fieldErrors.hallTicket)}
                onChange={(e) => setHallTicketNo(e.target.value)}
                disabled={loading}
              />
              {fieldErrors.hallTicket && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{fieldErrors.hallTicket}</p>
              )}
            </div>

            <div>
              <label htmlFor="testIdLast4" className="mb-1.5 block text-sm font-medium text-slate-700">
                Exam / Test ID — last 4 digits <span className="text-indigo-600">2</span>
              </label>
              <input
                id="testIdLast4"
                type="text"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                placeholder="e.g. 8460"
                value={testIdLast4}
                className={inputClass(fieldErrors.testId)}
                onChange={(e) => setTestIdLast4(e.target.value.replace(/\D/g, ''))}
                disabled={loading}
              />
              {fieldErrors.testId && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{fieldErrors.testId}</p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                Example: for <span className="font-mono">FNL-2026-8460</span> enter{' '}
                <span className="font-mono">8460</span>.
              </p>
            </div>

            <div>
              <label htmlFor="dob" className="mb-1.5 block text-sm font-medium text-slate-700">
                Date of Birth <span className="text-indigo-600">3</span>
              </label>
              <input
                id="dob"
                type="date"
                value={dob}
                max={new Date().toISOString().slice(0, 10)}
                className={inputClass(fieldErrors.dob)}
                onChange={(e) => setDob(e.target.value)}
                disabled={loading}
              />
              {fieldErrors.dob && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{fieldErrors.dob}</p>
              )}
            </div>

            {general && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                {general}
              </div>
            )}

            <button type="submit" className="btn-primary mt-2 w-full" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify & Enter'}
            </button>
          </form>
            <p className="mt-7 border-t border-slate-100 pt-5 text-center text-xs leading-5 text-slate-400">All three details are verified together before any exam content is shown.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
