import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExamTaxonomy, LanguageCode } from '../../lib/types/exam';
import type { MockAttemptRecord, MockPaper, MockQuestionState } from '../../lib/types/mock';
import {
  abandonAttempt,
  getActiveAttempt,
  getOrBuildMockPaper,
  getPaperForAttempt,
  saveAttempt,
  startAttempt,
  submitAttempt,
} from '../../lib/mock/mockService';
import { recordActivity } from '../../lib/progress/progressService';
import { AnthropicError } from '../../lib/api/anthropicClient';
import { useHotkeys } from '../../lib/hooks/useHotkeys';
import { Markdown } from '../components/Markdown';

/**
 * CBT mock simulator (FEATURES.md #13-16): exact exam pattern, real CBT palette
 * semantics, crash-safe autosave and auto-submit at time expiry.
 *
 * React 19 interval discipline: the live attempt is a mutable ref; a lightweight
 * snapshot is mirrored into state for rendering. No setState in effect bodies.
 */

export interface MockScreenProps {
  exam: ExamTaxonomy;
  language: LanguageCode;
  onFinished: () => void;
}

type Phase = 'setup' | 'running';

type SetupBusy = 'generate' | 'resume' | 'abandon' | null;

/** Render mirror of the mutable attempt ref. */
interface AttemptSnap {
  currentIndex: number;
  answers: Record<string, string>;
  states: Record<string, MockQuestionState>;
}

const PALETTE_CLS: Record<MockQuestionState, string> = {
  'not-visited': 'bg-slate-800/70 border-slate-700 text-slate-400',
  unanswered: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
  answered: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  marked: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300',
  'answered-marked': 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300',
};

const STATE_LABEL: Record<MockQuestionState, string> = {
  'not-visited': 'Not visited',
  unanswered: 'Not answered',
  answered: 'Answered',
  marked: 'Marked',
  'answered-marked': 'Answered & marked',
};

const LEGEND: Array<{ state: MockQuestionState; label: string; dot?: boolean }> = [
  { state: 'not-visited', label: 'Not visited' },
  { state: 'unanswered', label: 'Visited, not answered' },
  { state: 'answered', label: 'Answered' },
  { state: 'marked', label: 'Marked for review' },
  { state: 'answered-marked', label: 'Answered & marked', dot: true },
];

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtStartedAt(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeError(err: unknown): string {
  if (err instanceof AnthropicError) {
    if (err.status === 0 && err.message.includes('No Anthropic API key')) {
      return `${err.message} Open the Setup screen (Settings → Configure AI keys) to add your key.`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong — please retry.';
}

export function MockScreen({ exam, language, onFinished }: MockScreenProps) {
  const [phase, setPhase] = useState<Phase>('setup');

  // ---- setup state ------------------------------------------------------
  const [active, setActive] = useState<MockAttemptRecord | null>(null);
  const [loadingActive, setLoadingActive] = useState(true);
  const [busy, setBusy] = useState<SetupBusy>(null);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- running state ----------------------------------------------------
  const [paper, setPaper] = useState<MockPaper | null>(null);
  const [snap, setSnap] = useState<AttemptSnap | null>(null);
  const [clock, setClock] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);

  // Mutable CBT room data (mirrored into `snap`/`clock` for rendering).
  const paperRef = useRef<MockPaper | null>(null);
  const attemptRef = useRef<MockAttemptRecord | null>(null);
  const submittedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const tickCountRef = useRef(0);

  // Look for an unfinished attempt to resume.
  useEffect(() => {
    let cancelled = false;
    getActiveAttempt(exam.id)
      .then((a) => {
        if (!cancelled) {
          setActive(a);
          setLoadingActive(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exam.id]);

  // ---- attempt mutation helpers (event handlers only — never in effects) --

  const sync = () => {
    const a = attemptRef.current;
    if (!a) return;
    setSnap({ currentIndex: a.currentIndex, answers: { ...a.answers }, states: { ...a.states } });
  };

  /** Debounced autosave ~2s after any change (the 15s tick also persists). */
  const scheduleSave = () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const a = attemptRef.current;
      if (a && !submittedRef.current) void saveAttempt(a);
    }, 2000);
  };

  const mutate = (fn: (a: MockAttemptRecord, p: MockPaper) => void) => {
    const a = attemptRef.current;
    const p = paperRef.current;
    if (!a || !p || submittedRef.current) return;
    fn(a, p);
    sync();
    scheduleSave();
  };

  /** Moves to `index` (clamped) and marks an unseen question 'unanswered'. */
  const visit = (a: MockAttemptRecord, p: MockPaper, index: number) => {
    const clamped = Math.max(0, Math.min(p.questions.length - 1, index));
    a.currentIndex = clamped;
    const q = p.questions[clamped];
    if (q && a.states[q.id] === 'not-visited') a.states[q.id] = 'unanswered';
  };

  const goTo = (index: number) => mutate((a, p) => visit(a, p, index));
  const goNext = () => mutate((a, p) => visit(a, p, a.currentIndex + 1));
  const goPrev = () => mutate((a, p) => visit(a, p, a.currentIndex - 1));

  const selectOption = (i: number) =>
    mutate((a, p) => {
      const q = p.questions[a.currentIndex];
      if (!q?.options || i < 0 || i >= q.options.length) return;
      a.answers[q.id] = String(i);
      a.states[q.id] = 'answered';
    });

  const markCurrent = () =>
    mutate((a, p) => {
      const q = p.questions[a.currentIndex];
      if (!q) return;
      a.states[q.id] = a.answers[q.id] !== undefined ? 'answered-marked' : 'marked';
    });

  const markAndNext = () =>
    mutate((a, p) => {
      const q = p.questions[a.currentIndex];
      if (!q) return;
      a.states[q.id] = a.answers[q.id] !== undefined ? 'answered-marked' : 'marked';
      visit(a, p, a.currentIndex + 1);
    });

  const clearCurrent = () =>
    mutate((a, p) => {
      const q = p.questions[a.currentIndex];
      if (!q) return;
      delete a.answers[q.id];
      a.states[q.id] = 'unanswered';
    });

  const saveAndNext = () =>
    mutate((a, p) => {
      const q = p.questions[a.currentIndex];
      if (q) a.states[q.id] = a.answers[q.id] !== undefined ? 'answered' : 'unanswered';
      visit(a, p, a.currentIndex + 1);
    });

  // ---- enter / leave the CBT room ----------------------------------------

  const beginRunning = (p: MockPaper, a: MockAttemptRecord) => {
    paperRef.current = p;
    attemptRef.current = a;
    submittedRef.current = false;
    tickCountRef.current = 0;
    a.currentIndex = Math.max(0, Math.min(p.questions.length - 1, a.currentIndex));
    const q = p.questions[a.currentIndex];
    if (q && a.states[q.id] === 'not-visited') a.states[q.id] = 'unanswered';
    setPaper(p);
    setClock(a.remainingSeconds);
    sync();
    setPhase('running');
    void saveAttempt(a);
  };

  const doSubmit = useCallback(async () => {
    const a = attemptRef.current;
    const p = paperRef.current;
    if (!a || !p || submittedRef.current) return;
    submittedRef.current = true;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    setConfirmOpen(false);
    setSubmitBusy(true);
    try {
      await submitAttempt(a, p);
    } catch (err) {
      submittedRef.current = false;
      setSubmitBusy(false);
      setError(describeError(err));
      return;
    }
    try {
      const elapsed = Math.max(0, p.totalDurationMinutes * 60 - a.remainingSeconds);
      await recordActivity('mockCompleted', {
        sessionKind: 'mock',
        minutes: Math.round(elapsed / 60),
      });
    } catch {
      // Non-fatal: the attempt is already scored and saved.
    }
    onFinished();
  }, [onFinished]);

  // 1s clock: countdown, per-question time accumulation, 15s persistence,
  // auto-submit at zero. All setState happens inside the interval callback.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => {
      const a = attemptRef.current;
      const p = paperRef.current;
      if (!a || !p || submittedRef.current) return;
      const q = p.questions[a.currentIndex];
      if (q) a.perQuestionSeconds[q.id] = (a.perQuestionSeconds[q.id] ?? 0) + 1;
      a.remainingSeconds = Math.max(0, a.remainingSeconds - 1);
      setClock(a.remainingSeconds);
      tickCountRef.current += 1;
      if (tickCountRef.current % 15 === 0) void saveAttempt(a);
      if (a.remainingSeconds <= 0) void doSubmit();
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, doSubmit]);

  // Crash-safe: persist the in-flight attempt when the screen unmounts.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      const a = attemptRef.current;
      if (a && !submittedRef.current) void saveAttempt(a);
    };
  }, []);

  useHotkeys(
    {
      '1': () => selectOption(0),
      '2': () => selectOption(1),
      '3': () => selectOption(2),
      '4': () => selectOption(3),
      ArrowRight: () => goNext(),
      ArrowLeft: () => goPrev(),
      m: () => markCurrent(),
      c: () => clearCurrent(),
    },
    phase === 'running' && !confirmOpen && !submitBusy,
  );

  // ---- setup actions ------------------------------------------------------

  const handleStart = async () => {
    setBusy('generate');
    setError(null);
    setGenProgress(null);
    try {
      const p = await getOrBuildMockPaper(exam, language, (done, total) =>
        setGenProgress({ done, total }),
      );
      const a = await startAttempt(p);
      beginRunning(p, a);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
      setGenProgress(null);
    }
  };

  const handleResume = async () => {
    if (!active) return;
    setBusy('resume');
    setError(null);
    try {
      const p = await getPaperForAttempt(active);
      if (!p) {
        setError(
          'The cached paper for this attempt is missing. Abandon it and start a new mock.',
        );
        return;
      }
      beginRunning(p, active);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAbandon = async () => {
    if (!active || active.id == null) return;
    setBusy('abandon');
    setError(null);
    try {
      await abandonAttempt(active.id);
      setActive(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  // ---- derived render data ------------------------------------------------

  // Palette groups: question indexes per section (flattened paper order).
  const sectionGroups = useMemo(() => {
    if (!paper) return [];
    return paper.sections.map((section, si) => ({
      section,
      indexes: paper.questions.reduce<number[]>((acc, q, i) => {
        if (q.sectionIndex === si) acc.push(i);
        return acc;
      }, []),
    }));
  }, [paper]);

  const counts = useMemo(() => {
    if (!paper || !snap) return { attempted: 0, marked: 0, blank: 0 };
    let attempted = 0;
    let marked = 0;
    for (const q of paper.questions) {
      const ans = snap.answers[q.id];
      if (ans !== undefined && ans !== '') attempted++;
      const st = snap.states[q.id];
      if (st === 'marked' || st === 'answered-marked') marked++;
    }
    return { attempted, marked, blank: paper.questions.length - attempted };
  }, [paper, snap]);

  // ---- render: SETUP ------------------------------------------------------

  const renderSetup = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase">
          CBT mock simulator
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight text-white font-display mt-1">
          {exam.shortName} Mock Test
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Full-pattern computer-based test — exact sections, marks, negative marking and timing.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start gap-2">
          <span>❌</span>
          <p className="leading-relaxed">{error}</p>
        </div>
      )}

      {/* Resume / abandon an unfinished attempt */}
      {loadingActive ? (
        <div className="glass-panel p-5 flex items-center gap-3 text-sm text-slate-400">
          <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full" />
          Checking for an unfinished attempt…
        </div>
      ) : active ? (
        <div className="glass-panel p-5 sm:p-6 border-amber-500/20 bg-amber-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                ⏸ Mock in progress
              </p>
              <p className="text-sm text-slate-200 mt-1.5">
                Started {fmtStartedAt(active.startedAt)} ·{' '}
                {Object.keys(active.answers).length}/{exam.pattern.totalQuestions} answered
              </p>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">
                ⏱ {fmtClock(Math.max(0, active.remainingSeconds))} left on the clock
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => void handleResume()}
                disabled={busy !== null}
                className="btn-primary text-sm"
              >
                {busy === 'resume' ? 'Loading…' : 'Resume'}
              </button>
              <button
                onClick={() => void handleAbandon()}
                disabled={busy !== null}
                className="btn-secondary text-sm !text-rose-300"
              >
                {busy === 'abandon' ? 'Removing…' : 'Abandon'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Exam pattern — verbatim from the taxonomy */}
      <div className="glass-panel p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white font-display">Exam pattern</h3>
          <span className="text-[11px] text-slate-500">verbatim from the official pattern</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                <th className="py-2 pr-4 font-semibold">Paper</th>
                <th className="py-2 pr-4 font-semibold">Questions</th>
                <th className="py-2 pr-4 font-semibold">Marks/Q</th>
                <th className="py-2 pr-4 font-semibold">Negative</th>
                <th className="py-2 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              {exam.pattern.papers.map((p) => (
                <tr key={p.id} className="border-b border-white/5 last:border-0">
                  <td className="py-2.5 pr-4 text-slate-200">{p.name}</td>
                  <td className="py-2.5 pr-4 font-mono text-slate-300">{p.qcount}</td>
                  <td className="py-2.5 pr-4 font-mono text-emerald-300">+{p.marksPerQuestion}</td>
                  <td className="py-2.5 pr-4 font-mono">
                    {p.negativeMarking > 0 ? (
                      <span className="text-rose-300">−{p.negativeMarking}</span>
                    ) : (
                      <span className="text-slate-500">none</span>
                    )}
                  </td>
                  <td className="py-2.5 font-mono text-slate-300">
                    {p.durationMinutes != null ? `${p.durationMinutes} min` : 'shared'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-cyan-300 bg-cyan-500/10 border-cyan-500/20">
            {exam.pattern.totalQuestions} questions
          </span>
          {exam.pattern.totalMarks != null && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-indigo-300 bg-indigo-500/10 border-indigo-500/20">
              {exam.pattern.totalMarks} marks
            </span>
          )}
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-amber-300 bg-amber-500/10 border-amber-500/20">
            ⏱ {exam.pattern.totalDurationMinutes} min total
          </span>
          {exam.pattern.negativeMarking > 0 ? (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-rose-300 bg-rose-500/10 border-rose-500/20">
              −{exam.pattern.negativeMarking} per wrong
            </span>
          ) : (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-emerald-300 bg-emerald-500/10 border-emerald-500/20">
              No negative marking
            </span>
          )}
          {exam.pattern.hasSectionalTiming && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-slate-300 bg-slate-500/10 border-slate-500/20">
              Sectional timing
            </span>
          )}
        </div>
        {exam.pattern.sectionalCutoffs && (
          <p className="mt-3 text-[11px] text-slate-500">
            Cutoffs: {exam.pattern.sectionalCutoffs}
          </p>
        )}
        {exam.meta.verification !== 'verified' && (
          <p className="mt-3 text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
            ⚠️ This pattern is <strong>{exam.meta.verification}</strong> — verify against the
            official notification before relying on mock scores.
          </p>
        )}
      </div>

      {/* Start a new mock */}
      <div className="glass-panel p-5 sm:p-6">
        <h3 className="text-lg font-bold text-white font-display">Start a new mock</h3>
        <p className="text-sm text-slate-400 mt-1.5">
          {exam.pattern.totalQuestions} exam-style questions across every section, on the real
          clock with the real marking scheme.
        </p>
        <p className="text-[11px] text-slate-500 mt-1.5">
          First run generates the paper with AI and can take a few minutes — one-time, cached.
          Re-attempts are instant and free.
        </p>

        {busy === 'generate' && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-cyan-300">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full shrink-0" />
              {genProgress
                ? `Generating section questions… ${genProgress.done}/${genProgress.total}`
                : 'Preparing paper — checking cache…'}
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-500"
                style={{
                  width: `${
                    genProgress && genProgress.total > 0
                      ? Math.max(4, Math.round((genProgress.done / genProgress.total) * 100))
                      : 4
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-5">
          <button
            onClick={() => void handleStart()}
            disabled={busy !== null}
            className="btn-primary text-sm"
          >
            {busy === 'generate' ? 'Generating…' : '🚀 Start new mock'}
          </button>
        </div>
      </div>
    </div>
  );

  // ---- render: RUNNING (the CBT room) -------------------------------------

  const renderRunning = () => {
    if (!paper || !snap) return null;
    const q = paper.questions[snap.currentIndex];
    if (!q) return null;
    const section = paper.sections[q.sectionIndex];
    const chosen = snap.answers[q.id];
    const qState = snap.states[q.id] ?? 'not-visited';
    const clockCls =
      clock <= 60 ? 'text-rose-400' : clock <= 300 ? 'text-amber-400' : 'text-cyan-400';

    return (
      <div className="space-y-4">
        {/* Sticky CBT bar (below the 4rem app header) */}
        <div className="sticky top-16 z-30 glass-panel !bg-darkBg/90 px-4 py-3 flex items-center gap-3">
          <div className={`font-mono text-lg sm:text-xl font-bold tabular-nums shrink-0 ${clockCls}`}>
            ⏱ {fmtClock(clock)}
          </div>
          <div className="min-w-0 flex-grow">
            <p className="text-xs sm:text-sm font-semibold text-slate-200 truncate">
              {section?.name ?? '—'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono">
              Q {snap.currentIndex + 1}/{paper.questions.length}
            </p>
          </div>
          <button
            onClick={() => setPaletteOpen((o) => !o)}
            title="Toggle question palette"
            aria-label="Toggle question palette"
            className={`p-2 rounded-xl border transition-colors shrink-0 ${
              paletteOpen
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                : 'bg-slate-800/40 border-white/5 text-slate-400 hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h4v4H4V6zm6 0h4v4h-4V6zm6 0h4v4h-4V6zM4 14h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
            </svg>
          </button>
          <button onClick={() => setConfirmOpen(true)} className="btn-primary text-sm shrink-0">
            Submit
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start gap-2">
            <span>❌</span>
            <p className="flex-grow leading-relaxed">{error}</p>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 shrink-0" aria-label="Dismiss error">
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Question card */}
          <div className={`glass-panel p-5 sm:p-6 ${paletteOpen ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-[10px] font-bold px-2 py-1 rounded-full border text-cyan-300 bg-cyan-500/10 border-cyan-500/20">
                Question {snap.currentIndex + 1}
              </span>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full border text-slate-300 bg-slate-500/10 border-slate-500/20 font-mono">
                +{section?.marksPerQuestion ?? 0}
                {section && section.negativeMarking > 0 ? ` / −${section.negativeMarking}` : ''}
              </span>
              <span className={`ml-auto text-[10px] font-bold px-2 py-1 rounded-full border ${PALETTE_CLS[qState]}`}>
                {STATE_LABEL[qState]}
              </span>
            </div>

            <Markdown text={q.stem} className="space-y-3 text-base leading-relaxed text-slate-200" />

            <div className="space-y-2.5 mt-5">
              {(q.options ?? []).map((opt, i) => {
                const selected = chosen === String(i);
                return (
                  <button
                    key={i}
                    // eslint-disable-next-line react-hooks/refs -- onClick is an event handler; the rule false-positives on closures created inside .map()
                    onClick={() => selectOption(i)}
                    className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left text-sm transition-colors ${
                      selected
                        ? 'bg-cyan-500/10 border-cyan-500/50 text-white'
                        : 'bg-slate-900/40 border-white/5 text-slate-300 hover:border-slate-600 hover:bg-slate-900/70'
                    }`}
                  >
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-mono ${
                        selected
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                          : 'border-slate-600 text-slate-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="whitespace-pre-wrap">{opt}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-6 pt-4 border-t border-white/5">
              <button
                onClick={goPrev}
                disabled={snap.currentIndex === 0}
                className="btn-secondary text-sm"
              >
                ← Previous
              </button>
              <button onClick={clearCurrent} className="btn-secondary text-sm">
                Clear Response
              </button>
              <button
                onClick={markAndNext}
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl border bg-indigo-500/10 border-indigo-500/30 text-indigo-300 text-sm font-medium tracking-wide hover:bg-indigo-500/20 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                Mark for Review &amp; Next
              </button>
              <button onClick={saveAndNext} className="btn-success text-sm">
                Save &amp; Next
              </button>
              <button
                onClick={goNext}
                disabled={snap.currentIndex >= paper.questions.length - 1}
                className="btn-secondary text-sm"
              >
                Next →
              </button>
            </div>
            <p className="hidden sm:block mt-3 text-[11px] text-slate-600 font-mono">
              1–4 select option · ←/→ navigate · m mark · c clear
            </p>
          </div>

          {/* Question palette */}
          {paletteOpen && (
            <aside className="glass-panel p-4 lg:sticky lg:top-36 lg:max-h-[calc(100vh-10.5rem)] lg:overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white font-display">Question palette</h3>
                <span className="text-[10px] text-slate-500 font-mono">
                  {counts.attempted}/{paper.questions.length}
                </span>
              </div>
              <div className="space-y-4">
                {sectionGroups.map(({ section: s, indexes }) => {
                  if (indexes.length === 0) return null;
                  return (
                    <div key={s.paperId}>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5 truncate border-b border-white/5 pb-1">
                        {s.name}
                      </p>
                      <div className="grid grid-cols-5 sm:grid-cols-10 lg:grid-cols-5 gap-1.5">
                        {indexes.map((i) => {
                          const qq = paper.questions[i];
                          const st = snap.states[qq.id] ?? 'not-visited';
                          const isCurrent = i === snap.currentIndex;
                          return (
                            <button
                              key={qq.id}
                              // eslint-disable-next-line react-hooks/refs -- onClick is an event handler; the rule false-positives on closures created inside .map()
                              onClick={() => goTo(i)}
                              title={`Q${i + 1} — ${STATE_LABEL[st]}`}
                              className={`relative h-9 rounded-lg border text-[11px] font-mono transition-colors ${PALETTE_CLS[st]} ${
                                isCurrent ? 'ring-2 ring-cyan-400' : ''
                              }`}
                            >
                              {i + 1}
                              {st === 'answered-marked' && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 pt-4 border-t border-white/5 space-y-1.5">
                {LEGEND.map((l) => (
                  <div key={l.state} className="flex items-center gap-2">
                    <span className={`relative inline-block w-4 h-4 rounded border ${PALETTE_CLS[l.state]}`}>
                      {l.dot && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      )}
                    </span>
                    <span className="text-[11px] text-slate-400">{l.label}</span>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>

        {/* Submit confirmation */}
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="glass-panel !bg-darkCard/95 p-6 w-full max-w-md">
              <h3 className="text-xl font-bold text-white font-display">Submit mock?</h3>
              <p className="text-sm text-slate-400 mt-1.5">
                ⏱ {fmtClock(clock)} still on the clock. Answers can&apos;t be changed after
                submission.
              </p>
              <div className="grid grid-cols-3 gap-3 mt-5">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <div className="text-2xl font-bold font-mono text-emerald-300">{counts.attempted}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">Attempted</div>
                </div>
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                  <div className="text-2xl font-bold font-mono text-indigo-300">{counts.marked}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">Marked</div>
                </div>
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
                  <div className="text-2xl font-bold font-mono text-rose-300">{counts.blank}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">Blank</div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setConfirmOpen(false)} className="btn-secondary text-sm">
                  Keep going
                </button>
                <button onClick={() => void doSubmit()} className="btn-primary text-sm">
                  Submit now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Submission progress overlay (also shown on time-up auto-submit) */}
        {submitBusy && (
          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm">
            <span className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-500" />
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              {clock <= 0 ? "Time's up — submitting…" : 'Scoring your attempt…'}
            </p>
          </div>
        )}
      </div>
    );
  };

  return phase === 'running' ? renderRunning() : renderSetup();
}
