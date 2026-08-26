import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { cn, formatClock, optionLabel } from '../utils/format';
import logo from '../logo.png';
import LiveISTClock from '../components/LiveISTClock';
import { serverNowMs, setServerTime } from '../utils/serverClock';

/** NTA-style palette colours per question status. */
const PALETTE_CLASSES = {
  answered: 'border-emerald-600 bg-emerald-500 text-white',
  'answered-marked': 'border-violet-600 bg-violet-500 text-white',
  marked: 'border-violet-400 bg-violet-300 text-violet-900',
  'not-answered': 'border-rose-500 bg-rose-500 text-white',
  'not-visited': 'border-slate-300 bg-white text-slate-600 hover:border-slate-400',
};

const MP_LIMIT = 3; // warnings allowed; the 4th offence disqualifies

// Cursor guard: the red line between the navbar and the question area is the
// boundary. The instant the pointer reaches/touches the red line (going up), the
// cursor is hidden ("returned to centre"); it only becomes visible again once the
// pointer comes back well into the question area. Browsers cannot physically move
// the OS cursor, so this hides it + shows the centre popup instead.
const GUARD_RELEASE_MARGIN_PX = 120; // px below the red line the pointer must return to

export default function ExamPage() {
  const navigate = useNavigate();
  const { exam, candidate, logout } = useAuth();

  // loading -> instructions -> active   (plus blocked / error terminals)
  const [phase, setPhase] = useState('loading');
  const [blockMessage, setBlockMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [fsError, setFsError] = useState('');

  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState({});
  const [visited, setVisited] = useState({});
  const [leftSeconds, setLeftSeconds] = useState(null);
  const [fontScale, setFontScale] = useState(1); // A=1 · A+=1.5 · A++=2
  const [guardHit, setGuardHit] = useState(false); // cursor bounced off the top edge

  const [mpCount, setMpCount] = useState(0);
  const [lastViolation, setLastViolation] = useState('');
  const [fsExited, setFsExited] = useState(false);
  const [dq, setDq] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pre, setPre] = useState(null); // details captured before the exam starts

  const answersRef = useRef({});
  const dirtyRef = useRef(new Set());
  const timersRef = useRef({});
  const submittedRef = useRef(false);
  const endAtRef = useRef(null);
  const activeRef = useRef(false);
  const lastStrikeRef = useRef(0);
  const lastYRef = useRef(-1); // last known pointer y, used by the cursor guard
  const guardActiveRef = useRef(false); // guard already engaged (avoids flicker)
  const redLineRef = useRef(null); // red boundary line element (guard boundary)

  const total = questions.length;
  const q = questions[current];

  const showTimeOver = useCallback(() => {
    submittedRef.current = true;
    activeRef.current = false;
    document.exitFullscreen?.().catch(() => {});
    setPhase('time-over');
  }, []);

  // ---- server sync ---------------------------------------------------------
  const postAnswer = useCallback(
    async (qid, selectedOption) => {
      try {
        const res = await api.post('/exam/answer', { questionId: qid, selectedOption });
        if (res.data?.autoSubmitted) {
          showTimeOver();
          return false;
        }
        return true;
      } catch (err) {
        if (err.response?.data?.autoSubmitted) {
          showTimeOver();
        }
        return false;
      }
    },
    [showTimeOver]
  );

  const flushOne = useCallback(
    async (qid) => {
      if (!dirtyRef.current.has(qid)) return;
      const ok = await postAnswer(qid, answersRef.current[qid] ?? null);
      if (ok) dirtyRef.current.delete(qid);
    },
    [postAnswer]
  );

  const flushAll = useCallback(async () => {
    const ids = [...dirtyRef.current];
    await Promise.all(ids.map((id) => flushOne(id)));
  }, [flushOne]);

  const selectOption = useCallback(
    (qid, idx) => {
      answersRef.current = { ...answersRef.current, [qid]: idx };
      dirtyRef.current.add(qid);
      setAnswers(answersRef.current);

      window.clearTimeout(timersRef.current[qid]);
      timersRef.current[qid] = window.setTimeout(() => flushOne(qid), 600);
    },
    [flushOne]
  );

  const clearResponse = useCallback(
    (qid) => {
      if (answersRef.current[qid] === undefined && !dirtyRef.current.has(qid)) return;
      delete answersRef.current[qid];
      dirtyRef.current.add(qid);
      setAnswers({ ...answersRef.current });
      window.clearTimeout(timersRef.current[qid]);
      flushOne(qid);
    },
    [flushOne]
  );

  // ---- navigation ------------------------------------------------------------
  const goto = useCallback(
    (index) => {
      if (total === 0) return;
      const nextIndex = Math.min(total - 1, Math.max(0, index));
      const target = questions[nextIndex];
      flushAll();
      setCurrent(nextIndex);
      if (target) {
        setVisited((v) => ({ ...v, [target.id]: true }));
        // Best effort only: answers remain independently persisted.
        api.post('/exam/progress', { questionId: target.id }).catch(() => {});
      }
    },
    [total, questions, flushAll]
  );

  const saveAndNext = useCallback(() => {
    flushAll();
    goto(current < total - 1 ? current + 1 : current);
  }, [flushAll, goto, current, total]);

  const markForReviewAndNext = useCallback(() => {
    const qid = questions[current]?.id;
    if (qid) setMarked((m) => ({ ...m, [qid]: true }));
    goto(current < total - 1 ? current + 1 : current);
  }, [questions, current, goto]);

  const clearCurrent = useCallback(() => {
    if (q) clearResponse(q.id);
  }, [q, clearResponse]);

  // ---- derived palette data ----------------------------------------------------
  const statusOf = useCallback(
    (qq) => {
      const a = answers[qq.id] !== undefined;
      const m = !!marked[qq.id];
      const v = !!visited[qq.id];
      if (a && m) return 'answered-marked';
      if (a) return 'answered';
      if (m) return 'marked';
      if (v) return 'not-answered';
      return 'not-visited';
    },
    [answers, marked, visited]
  );

  const counts = useMemo(() => {
    let answered = 0;
    let notAnswered = 0;
    let markedOnly = 0;
    let answeredMarked = 0;
    let notVisited = 0;
    questions.forEach((qq) => {
      const s = statusOf(qq);
      if (s === 'answered') answered += 1;
      else if (s === 'answered-marked') answeredMarked += 1;
      else if (s === 'marked') markedOnly += 1;
      else if (s === 'not-answered') notAnswered += 1;
      else notVisited += 1;
    });
    return { answered, notAnswered, markedOnly, answeredMarked, notVisited };
  }, [questions, statusOf]);

  // ---- submission ----------------------------------------------------------------
  const handleSubmit = useCallback(
    async (reason = '') => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      activeRef.current = false;
      setSubmitting(true);
      setSubmitError('');
      try {
        await flushAll();
        await api.post('/exam/submit', reason ? { reason } : {});
        if (reason === 'time expired') {
          showTimeOver();
        } else if (reason) {
          document.exitFullscreen?.().catch(() => {});
          logout();
          navigate('/login', { replace: true });
        } else {
          navigate('/result', { replace: true });
        }
      } catch (err) {
        const data = err.response?.data;
        if (data?.autoSubmitted) {
          showTimeOver();
          return;
        }
        if (data?.alreadySubmitted) {
          navigate('/result', { replace: true });
          return;
        }
        submittedRef.current = false;
        setSubmitting(false);
        setSubmitError(data?.message || 'Submission failed. Please try again.');
      }
    },
    [flushAll, logout, navigate, showTimeOver]
  );

  // ---- malpractice tracking ------------------------------------------------
  const strike = useCallback(
    async (type, detail) => {
      if (!activeRef.current || submittedRef.current) return;
      const now = serverNowMs();
      if (now - lastStrikeRef.current < 1200) return; // de-dupe a single action firing multiple events
      lastStrikeRef.current = now;

      try {
        const res = await api.post('/exam/violation', { type, detail });
        const count = res.data?.count ?? mpCount + 1;
        setMpCount(count);
        setLastViolation(detail || type);
        if (res.data?.disqualified) {
          setDq(true);
          window.setTimeout(() => handleSubmit('malpractice'), 900);
        }
      } catch {
        /* network hiccup - the next event will retry */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mpCount, handleSubmit]
  );

  const resumeFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().then(() => setFsExited(false)).catch(() => {});
  }, []);

  // ---- start exam (from the instructions page) --------------------------------
  const startExam = useCallback(async () => {
    if (starting || phase !== 'instructions') return;
    setStarting(true);
    setFsError('');

    // Full-screen is mandatory and must be requested inside this user gesture.
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setFsError('Full screen is required to take this exam. Click "Start Exam" again and choose "Allow".');
      setStarting(false);
      return;
    }

    try {
      const beginRes = await api.get('/exam/start', { params: { begin: 1 } });
      if (!beginRes.data.allowed) {
        activeRef.current = false;
        setPhase('blocked');
        setBlockMessage(beginRes.data.message || 'You cannot start this exam right now.');
        return;
      }
      endAtRef.current = new Date(beginRes.data.details.effectiveEndAt).getTime();
      setServerTime(beginRes.data.details.serverNow);
      setLeftSeconds(Math.max(0, Math.floor((endAtRef.current - serverNowMs()) / 1000)));
      setMpCount(beginRes.data.details.violationCount || 0);

      const qRes = await api.get('/exam/questions');
      if (qRes.data.autoSubmitted) {
        showTimeOver();
        return;
      }
      if (!qRes.data.questions || qRes.data.questions.length === 0) {
        activeRef.current = false;
        setPhase('blocked');
        setBlockMessage('No questions are available for this exam yet. Contact your exam administrator.');
        return;
      }
      const list = qRes.data.questions;
      setQuestions(list);
      const restoredAnswers = Object.fromEntries(
        list.filter((item) => item.selectedOption !== null && item.selectedOption !== undefined).map((item) => [item.id, item.selectedOption])
      );
      answersRef.current = restoredAnswers;
      setAnswers(restoredAnswers);
      const resumeIndex = list.findIndex((item) => item.id === beginRes.data.details.resumeQuestionId);
      const initialIndex = resumeIndex >= 0 ? resumeIndex : 0;
      setCurrent(initialIndex);
      setVisited({ [list[initialIndex].id]: true });
      api.post('/exam/progress', { questionId: list[initialIndex].id }).catch(() => {});

      activeRef.current = true;
      setPhase('active');
    } catch (err) {
      activeRef.current = false;
      const data = err.response?.data;
      if (data?.autoSubmitted) {
        setPhase('blocked');
        setBlockMessage(data.message || 'Your exam was auto-submitted.');
        window.setTimeout(() => {
          logout();
          navigate('/login', { replace: true });
        }, 900);
        return;
      }
      setPhase('error');
      setBlockMessage(data?.message || 'Could not load the exam. Please try again.');
    } finally {
      setStarting(false);
    }
  }, [starting, phase, logout, navigate, showTimeOver]);

  // ---- boot: availability pre-check, then show the instructions page ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const startRes = await api.get('/exam/start');
        if (cancelled) return;
        if (startRes.data.autoSubmitted) {
          showTimeOver();
          return;
        }
        if (!startRes.data.allowed) {
          setPhase('blocked');
          setBlockMessage(startRes.data.message || 'You cannot take this exam right now.');
          return;
        }
        setPre(startRes.data.details || null);
        setMpCount(startRes.data.details?.violationCount || 0);
        setPhase('instructions'); // questions are NOT fetched yet - only after Start
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setBlockMessage(err.response?.data?.message || 'Could not load the exam. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, showTimeOver]);

  // ---- countdown timer -------------------------------------------------------
  useEffect(() => {
    if (phase !== 'active') return undefined;
    const timer = window.setInterval(() => {
      if (submittedRef.current) return;
      const remain = Math.max(0, Math.floor((endAtRef.current - serverNowMs()) / 1000));
      setLeftSeconds(remain);
      if (remain <= 0) {
        window.clearInterval(timer);
        handleSubmit('time expired');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, handleSubmit]);

  // ---- text size controls (A / A+ / A++) ------------------------------------
  // Scales the root font size so every rem-based Tailwind text on this screen
  // grows proportionally. Layout caps and image sizes below are px-based, so
  // question images are deliberately NOT enlarged. Original size restored on
  // unmount.
  const prevFontSizeRef = useRef(null);
  useEffect(() => {
    if (prevFontSizeRef.current === null) {
      prevFontSizeRef.current = document.documentElement.style.fontSize;
    }
    document.documentElement.style.fontSize = `${fontScale * 100}%`;
    return () => {
      document.documentElement.style.fontSize = prevFontSizeRef.current;
      prevFontSizeRef.current = null;
    };
  }, [fontScale]);

  // ---- cursor guard: keep the pointer away from (above) the red line -----------
  // The red line is the hard boundary. The moment the pointer reaches it (even 1px
  // of touch / crossing it), engage the guard: hide the cursor so it can't be
  // aimed at the OS/browser controls, and show the "returned to centre" notice.
  // The guard stays engaged until the pointer comes back well below the red line.
  const enterGuardZone = useCallback(() => {
    if (phase !== 'active' || fsExited || dq || submittedRef.current) return;
    if (guardActiveRef.current) return; // already engaged — no flicker
    guardActiveRef.current = true;
    document.documentElement.classList.add('cursor-none');
    setGuardHit(true);
  }, [phase, fsExited, dq]);

  const releaseGuard = useCallback(() => {
    guardActiveRef.current = false;
    document.documentElement.classList.remove('cursor-none');
    setGuardHit(false);
  }, []);

  // Exact screen Y of the red line (top edge = the boundary). Read live from the
  // DOM on every event so scrolling / resizing never throws it off.
  const redLineTopY = () => {
    const el = redLineRef.current;
    if (!el) return 64; // fallback before the line renders
    return el.getBoundingClientRect().top;
  };

  // Watch the pointer continuously while the exam is active. Trigger the guard the
  // instant the cursor is at/above the red line (crossing upward), even 1px of
  // touch. mouseout with no relatedTarget means the pointer left the page/window
  // entirely (toward OS/browser chrome) — treat that as crossing too.
  useEffect(() => {
    if (phase !== 'active' || fsExited) return undefined;
    const onMove = (e) => {
      lastYRef.current = e.clientY;
      if (e.clientY <= redLineTopY()) enterGuardZone();
    };
    const onOut = (e) => {
      if (e.relatedTarget === null) enterGuardZone();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseout', onOut);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseout', onOut);
    };
  }, [phase, fsExited, enterGuardZone]);

  // While guarded, the cursor stays hidden until the pointer returns well below the
  // red line (into the question area). A safety timer prevents a stuck hidden
  // cursor on edge cases (e.g. the pointer is already back but no event fired).
  useEffect(() => {
    if (!guardHit) return undefined;
    const onMove = (e) => {
      lastYRef.current = e.clientY;
      if (e.clientY >= redLineTopY() + GUARD_RELEASE_MARGIN_PX) releaseGuard();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    const safety = window.setTimeout(() => {
      if (lastYRef.current >= redLineTopY() + GUARD_RELEASE_MARGIN_PX) releaseGuard();
    }, 6000);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.clearTimeout(safety);
    };
  }, [guardHit, releaseGuard]);

  // Always release the guard when the exam leaves the active/fullscreen state.
  useEffect(() => {
    if (phase !== 'active' || fsExited || dq) releaseGuard();
    return () => releaseGuard();
  }, [phase, fsExited, dq, releaseGuard]);

  // Dispose per-question debounce timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => Object.values(timers).forEach((t) => window.clearTimeout(t));
  }, []);

  // ---- full-screen + malpractice listeners ------------------------------------
  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        setFsExited(false); // back in full screen
        return;
      }
      if (activeRef.current && !submittedRef.current) {
        setFsExited(true); // questions hidden behind the blocking overlay
        strike('fullscreen-exit', 'exited full-screen mode');
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') strike('visibilitychange', 'switched to another tab');
    };
    const onBlur = () => strike('blur', 'window lost focus');

    const onContextMenu = (e) => {
      e.preventDefault();
      strike('contextmenu', 'right-click blocked');
    };
    const onCopy = (e) => {
      e.preventDefault();
      strike('copy', 'copy attempt blocked');
    };
    const onCut = (e) => {
      e.preventDefault();
      strike('cut', 'cut attempt blocked');
    };
    const onPaste = (e) => {
      e.preventDefault();
      strike('paste', 'paste attempt blocked');
    };

    const onKeyDown = (e) => {
      const k = e.key ? e.key.toUpperCase() : '';
      if (e.key === 'F12') {
        e.preventDefault();
        strike('devtools', 'F12 pressed');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C'].includes(k)) {
        e.preventDefault();
        strike('devtools', `DevTools shortcut Ctrl/Cmd+Shift+${k}`);
      } else if ((e.ctrlKey || e.metaKey) && ['C', 'X', 'V'].includes(k)) {
        e.preventDefault();
        strike('copy', `copy/cut/paste shortcut Ctrl/Cmd+${k}`);
      } else if ((e.ctrlKey || e.metaKey) && k === 'U') {
        e.preventDefault();
        strike('shortcut', 'view-source shortcut Ctrl/Cmd+U');
      } else if ((e.ctrlKey || e.metaKey) && ['S', 'R', 'T', 'N', 'W', 'L'].includes(k)) {
        e.preventDefault();
        strike('shortcut', `blocked browser shortcut Ctrl/Cmd+${k}`);
      } else if ((e.ctrlKey || e.metaKey) && k === 'P') {
        e.preventDefault();
        strike('print', 'print shortcut Ctrl/Cmd+P');
      } else if (e.key === 'PrintScreen') {
        strike('screenshot', 'PrintScreen key pressed');
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [strike]);

  // ---- warn + best-effort save before leaving the page -------------------------
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (submittedRef.current) return;
      if (navigator.sendBeacon) {
        Object.entries(answersRef.current).forEach(([qid, opt]) => {
          navigator.sendBeacon(
            `${api.defaults.baseURL}/exam/answer`,
            new Blob([JSON.stringify({ questionId: qid, selectedOption: opt })], { type: 'application/json' })
          );
        });
      }
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ---- render -------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm font-medium text-slate-500">Preparing your exam…</p>
      </div>
    );
  }

  if (phase === 'time-over') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="card w-full max-w-md p-8 text-center">
          <div className="text-4xl">⏰</div>
          <h1 className="mt-3 text-xl font-bold text-slate-900">Time is over</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Your exam has been submitted automatically. Click OK to view your result. This exam is now closed.
          </p>
          <button className="btn-primary mt-6 w-full" onClick={() => navigate('/result', { replace: true })}>
            OK — View Result
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'blocked' || phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="card w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Exam unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{blockMessage}</p>
          <button className="btn-primary mt-6" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ===== INSTRUCTIONS PAGE - shown BEFORE any question is loaded =====
  if (phase === 'instructions') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-indigo-100 px-4 py-10">
        <div className="w-full max-w-2xl">
          <div className="mb-5 flex items-center gap-3">
            <img src={logo} alt="ExamPlat" className="h-[44px] w-[44px] rounded-xl object-contain shadow-lg shadow-indigo-200" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{exam?.title || 'Final Exam'}</h1>
              <p className="text-xs text-slate-400">
                {exam?.finalExamId}
                {exam?.subject ? ` · ${exam.subject}` : ''}
                {exam?.examCategory ? ` · ${exam.examCategory}` : ''}
              </p>
            </div>
          </div>

          <div className="card p-6 sm:p-8">
            {/* quick facts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-slate-900">{pre?.questionCount ?? '—'}</p>
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">Questions</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-slate-900">{pre?.durationMinutes ? `${pre.durationMinutes}m` : '—'}</p>
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">Duration</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-emerald-600">+1</p>
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">Correct</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-slate-500">0</p>
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">Wrong / Blank</p>
              </div>
            </div>

            <h2 className="mt-6 text-base font-bold text-slate-900">Instructions</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
              <li>
                All questions are multiple-choice. Select one option and press <b>Save &amp; Next</b>;
                answers also auto-save as you click.
              </li>
              <li><b>Clear Response</b> removes your saved answer · <b>Mark for Review</b> flags a question in the palette.</li>
              <li>
                The exam runs in <b>full screen</b>. The countdown starts the moment you press Start
                {pre?.durationMinutes ? ` and runs for ${pre.durationMinutes} minutes` : ''} — it submits automatically at zero.
              </li>
              <li>
                <b>Anti-malpractice:</b> leaving full screen, switching tabs, copy / cut / paste,
                right-click, DevTools or print shortcuts are recorded in real time with a live counter.
                You get <b>3 warnings</b> — a <b>4th offence auto-submits your exam</b> and ends your session.
              </li>
              <li>Your attempt is stored against your hall ticket. Once submitted, this exam is over for you.</li>
            </ol>

            {fsError && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{fsError}</div>
            )}

            <button type="button" className="btn-primary mt-6 w-full" onClick={startExam} disabled={starting}>
              {starting ? 'Entering full screen…' : 'Start Exam — Enter Full Screen'}
            </button>
            <p className="mt-3 text-center text-xs text-slate-400">By starting, you accept the exam rules above.</p>
          </div>
        </div>
      </div>
    );
  }

  // ===== ACTIVE EXAM =====
  const timerLow = leftSeconds !== null && leftSeconds <= 300;
  const answeredCount = counts.answered + counts.answeredMarked;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      {/* cursor-guard feedback: the pointer touched/crossed the red line, so the cursor
          was hidden and "returned to the centre" until the mouse comes back down */}
      {guardHit && !dq && (
        <div className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center px-4">
          <div className="flex max-w-md items-start gap-3 rounded-2xl border border-rose-200 bg-white px-5 py-4 shadow-2xl">
            <span className="text-2xl leading-none">⚠️</span>
            <div>
              <p className="text-sm font-bold leading-5 text-rose-600">Cursor returned to the centre</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                You touched the red boundary line. The cursor stays hidden until you move it back
                into the question area — it cannot reach the top of the screen while the test runs.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===== top bar ===== */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <img src={logo} alt="ExamPlat" className="h-[36px] w-[36px] shrink-0 rounded-lg object-contain" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{exam?.title || 'Final Exam'}</p>
              <p className="truncate text-[0.6875rem] text-slate-400">
                {exam?.finalExamId}
                {exam?.subject ? ` · ${exam.subject}` : ''}
                {exam?.examCategory ? ` · ${exam.examCategory}` : ''}
              </p>
              <LiveISTClock className="hidden text-[0.625rem] font-semibold tabular-nums text-indigo-600 sm:block" />
            </div>
          </div>
          {lastViolation && (
            <div className="absolute left-4 top-[58px] z-30 rounded-b-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm">
              Violation {mpCount}/{MP_LIMIT}: {lastViolation}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            {/* live malpractice counter */}
            <span
              title="Malpractice warnings"
              className={cn(
                'hidden items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold sm:inline-flex',
                mpCount >= 3
                  ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-300'
                  : mpCount > 0
                    ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                    : 'bg-emerald-50 text-emerald-700'
              )}
            >
              ⚠ Violations {mpCount}/{MP_LIMIT}
            </span>
            {candidate?.hallTicketNo && (
              <span className="hidden rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 md:inline">
                {candidate.hallTicketNo}
              </span>
            )}
            <div className={cn('rounded-lg px-3.5 py-1.5 text-right', timerLow ? 'bg-rose-50 ring-1 ring-rose-300' : 'bg-slate-50')}>
              <p className={cn('font-mono text-xl font-bold leading-6 tabular-nums', timerLow ? 'animate-pulse text-rose-600' : 'text-slate-800')}>
                {formatClock(leftSeconds)}
              </p>
              <p className={cn('text-[0.625rem] font-medium uppercase tracking-wider', timerLow ? 'text-rose-500' : 'text-slate-400')}>
                time left
              </p>
            </div>
          </div>
        </div>
        {/* red boundary line between the navbar and the question area; pulses when time is low */}
        <div ref={redLineRef} className={cn('h-[3px] w-full bg-rose-500', timerLow && 'animate-pulse')} aria-hidden="true" />
      </header>

      {/* ===== workspace ===== */}
      <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 px-4 py-4 lg:flex-row">
        <main className="min-w-0 flex-1">
          {submitError && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {submitError}
            </div>
          )}

          {q ? (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white">Q{current + 1}</span>
                  <span className="text-sm font-medium text-slate-500">of {total}</span>
                  <span className="chip bg-emerald-100 text-emerald-700">MCQ</span>
                  {!!marked[q.id] && <span className="chip bg-violet-100 text-violet-700">Marked for review</span>}
                </div>
                <span className="chip bg-slate-200 text-slate-600">+1 correct · 0 wrong</span>
              </div>

              <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-6 sm:px-7">
                <p className="whitespace-pre-line text-[0.9375rem] leading-7 text-slate-800">{q.questionText}</p>

                {q.image ? (
                  <div className="mt-4">
                    <img
                      src={q.image}
                      alt="Question diagram"
                      className="w-3/4 rounded-lg border border-slate-200 object-contain"
                      loading="lazy"
                    />
                  </div>
                ) : null}
              </div>

              <div className="space-y-2.5 px-5 py-5 sm:px-7">
                {q.options.map((opt, oi) => {
                  const selected = answers[q.id] === oi;
                  return (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => selectOption(q.id, oi)}
                      disabled={submitting}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition',
                        selected
                          ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300'
                          : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                          selected ? 'border-indigo-600' : 'border-slate-300'
                        )}
                      >
                        {selected && <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />}
                      </span>
                      <span className="pt-px text-sm font-semibold text-slate-500">{optionLabel(oi)}.</span>
                      <span className="pt-px text-sm leading-6 text-slate-800">{opt}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" onClick={() => goto(current - 1)} disabled={current === 0 || submitting}>
                    ← Previous
                  </button>
                  <button
                    type="button"
                    onClick={clearCurrent}
                    disabled={submitting || answers[q.id] === undefined}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear Response
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={markForReviewAndNext}
                    disabled={submitting}
                    className="inline-flex items-center justify-center rounded-lg border border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Mark for Review &amp; Next
                  </button>
                  <button
                    type="button"
                    onClick={saveAndNext}
                    disabled={submitting}
                    className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {current === total - 1 ? 'Save Response' : 'Save & Next'} →
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <div className="card p-8 text-center text-sm text-slate-500">No questions loaded.</div>
          )}

          <p className="mt-3 text-xs text-slate-400 lg:text-left">
            Answers save automatically · use the palette to jump between questions.
          </p>
        </main>

        {/* ---- question palette ---- */}
        <aside className="w-full shrink-0 lg:w-[288px]">
          <div className="card sticky top-[76px] p-4">
            {/* text size controls: A = default · A+ = 1.5× · A++ = 2× */}
            <div
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5"
              title="Text size"
            >
              <span className="pl-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Text size</span>
              <div className="flex items-center gap-0.5">
                {[
                  { label: 'A', value: 1, tip: 'Default text size' },
                  { label: 'A+', value: 1.5, tip: 'Increase text size 1.5×' },
                  { label: 'A++', value: 2, tip: 'Increase text size 2×' },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    title={opt.tip}
                    onClick={() => setFontScale(opt.value)}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs font-bold leading-none transition',
                      fontScale === opt.value
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:bg-white hover:text-slate-800'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <h2 className="mt-3 text-sm font-bold uppercase tracking-wide text-slate-500">Question Palette</h2>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Answered
                <span className="ml-auto font-bold text-slate-800">{counts.answered}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Not answered
                <span className="ml-auto font-bold text-slate-800">{counts.notAnswered}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-violet-400" /> Marked
                <span className="ml-auto font-bold text-slate-800">{counts.markedOnly}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm border border-slate-300 bg-white" /> Not visited
                <span className="ml-auto font-bold text-slate-800">{counts.notVisited}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-6">
              {questions.map((qq, i) => (
                <button
                  key={qq.id}
                  type="button"
                  onClick={() => goto(i)}
                  disabled={submitting}
                  title={`Question ${i + 1}`}
                  className={cn(
                    'relative h-9 rounded-md border text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-indigo-400',
                    PALETTE_CLASSES[statusOf(qq)],
                    i === current && 'ring-2 ring-indigo-500 ring-offset-1'
                  )}
                >
                  {i + 1}
                  {answers[qq.id] !== undefined && !!marked[qq.id] && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-[0.5625rem] leading-none text-white">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-[0.6875rem] text-slate-500">
              <p><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Answered</p>
              <p><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-rose-500" />Not answered (visited)</p>
              <p><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-violet-300" />Marked for review</p>
              <p><span className="mr-1.5 inline-block h-2 w-2 rounded-sm border border-slate-300 bg-white" />Not visited</p>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={submitting}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Submit Exam
            </button>
          </div>
        </aside>
      </div>

      {/* ===== full-screen exit overlay (questions hidden) ===== */}
      {fsExited && !dq && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-950/95 px-6 text-center text-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-600/20 text-2xl">⚠️</div>
          <h2 className="text-xl font-bold">Full screen exited</h2>
          <p className="max-w-md text-sm leading-6 text-slate-300">
            Questions are hidden while you are outside full screen. This incident has been
            recorded as a malpractice attempt.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
            <span className={cn('rounded-full px-3 py-1', mpCount >= MP_LIMIT ? 'bg-rose-600' : 'bg-amber-500/90 text-amber-950')}>
              Warning {Math.min(mpCount, MP_LIMIT)} of {MP_LIMIT}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">
              {mpCount >= MP_LIMIT ? 'One more exit will END your exam' : `${MP_LIMIT - mpCount} warning(s) remaining`}
            </span>
          </div>
          <button
            type="button"
            onClick={resumeFullscreen}
            className="mt-2 rounded-lg bg-indigo-500 px-6 py-3 text-sm font-bold shadow-lg transition hover:bg-indigo-400"
          >
            Return to full screen &amp; resume exam
          </button>
          <p className="text-[0.6875rem] text-slate-500">The exam clock keeps running while you are away.</p>
        </div>
      )}

      {/* ===== disqualification overlay ===== */}
      {dq && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-rose-950 px-6 text-center text-white">
          <div className="text-4xl">🚫</div>
          <h2 className="text-xl font-bold">Malpractice limit exceeded</h2>
          <p className="max-w-md text-sm leading-6 text-rose-200">
            Your exam is being submitted automatically and your session will be terminated.
            All incidents have been recorded.
          </p>
          <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-rose-400" />
          </div>
        </div>
      )}

      {/* ===== submit confirmation ===== */}
      {showConfirm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900">Submit final exam?</h2>
            <p className="mt-1.5 text-sm text-slate-500">You cannot change your answers after submission.</p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5">
                <p className="text-xl font-bold text-emerald-700">{answeredCount}</p>
                <p className="text-[0.6875rem] font-medium text-emerald-600">Answered</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-2 py-2.5">
                <p className="text-xl font-bold text-rose-700">{counts.notAnswered + counts.markedOnly}</p>
                <p className="text-[0.6875rem] font-medium text-rose-600">Unanswered</p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-2 py-2.5">
                <p className="text-xl font-bold text-violet-700">{counts.answeredMarked + counts.markedOnly}</p>
                <p className="text-[0.6875rem] font-medium text-violet-600">Marked</p>
              </div>
            </div>

            {(counts.notAnswered > 0 || counts.markedOnly > 0) && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                You still have unanswered questions — they will score 0.
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowConfirm(false)} disabled={submitting}>
                Keep editing
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submitting}
                onClick={() => {
                  setShowConfirm(false);
                  handleSubmit();
                }}
              >
                {submitting ? 'Submitting…' : 'Yes, submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
