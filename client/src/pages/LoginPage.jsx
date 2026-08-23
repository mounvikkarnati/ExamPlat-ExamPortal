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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-indigo-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src={logo} alt="ExamPlat" className="mx-auto mb-3 h-14 w-14 rounded-2xl object-contain shadow-lg shadow-indigo-200" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ExamPlat</h1>
          <p className="mt-1 text-sm text-slate-500">Final Exam Portal · Secure Entry</p>
          <LiveISTClock className="mt-2 block text-xs font-semibold tabular-nums text-indigo-700" />
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-slate-900">Candidate Login</h2>
          <p className="mt-1 text-sm text-slate-500">
            Verify your identity using your Hall Ticket, the 4-digit Exam code and your Date of Birth.
          </p>

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

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify & Enter'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-slate-400">
          All three details are verified together before any exam content is shown.
        </p>
      </div>
    </div>
  );
}
