import { useEffect, useMemo, useState } from 'react';
import type { ExamTaxonomy } from '../../lib/types/exam';
import type { MockAnalytics, MockAttemptRecord, MockSectionAnalytics } from '../../lib/types/mock';
import { listAttempts } from '../../lib/mock/mockService';

/**
 * Mock analytics + history (FEATURES.md #17-18): latest-attempt hero, sectional
 * breakdown with score bars, a dependency-free SVG score trend, and a clickable
 * attempt history that re-targets the analytics views. Pure local reads — no AI.
 */

export interface MockResultsScreenProps {
  exam: ExamTaxonomy;
  onStartMock: () => void;
}

/** listAttempts only returns submitted rows; this narrows the nullable fields. */
type CompletedAttempt = MockAttemptRecord & {
  id: number;
  submittedAt: number;
  analytics: MockAnalytics;
};

function isCompleted(r: MockAttemptRecord): r is CompletedAttempt {
  return r.id != null && r.submittedAt != null && r.analytics != null;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function sectionAccuracy(s: MockSectionAnalytics): string {
  return s.attempted > 0 ? pct(s.correct / s.attempted) : '—';
}

/** Section score as a 0-100 bar width (negative scores clamp to 0). */
function sectionBarPct(s: MockSectionAnalytics): number {
  if (s.maxScore <= 0) return 0;
  return Math.max(0, Math.min(100, (s.score / s.maxScore) * 100));
}

export function MockResultsScreen({ exam, onStartMock }: MockResultsScreenProps) {
  const [attempts, setAttempts] = useState<CompletedAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAttempts(exam.id)
      .then((rows) => {
        if (cancelled) return;
        const completed = rows.filter(isCompleted); // newest first (service order)
        setAttempts(completed);
        setSelectedId(completed[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load mock history.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exam.id]);

  const selected = useMemo(
    () => attempts.find((a) => a.id === selectedId) ?? attempts[0] ?? null,
    [attempts, selectedId],
  );

  // Score trend geometry (oldest → newest, pure SVG — no chart lib).
  const chart = useMemo(() => {
    if (attempts.length === 0) return null;
    const chrono = [...attempts].reverse();
    const scores = chrono.map((a) => a.analytics.totalScore);
    const lo = Math.min(0, ...scores);
    let hi = Math.max(...scores);
    if (hi <= lo) hi = lo + 1;
    const W = 600;
    const H = 190;
    const padX = 40;
    const padTop = 30;
    const padBottom = 36;
    const x = (i: number) =>
      chrono.length === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (chrono.length - 1);
    const y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (H - padTop - padBottom);
    const points = chrono.map((a, i) => ({
      id: a.id,
      x: x(i),
      y: y(a.analytics.totalScore),
      score: a.analytics.totalScore,
      date: new Date(a.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
    return {
      W,
      H,
      points,
      zeroY: lo <= 0 && hi >= 0 ? y(0) : null,
      polyline: points.map((p) => `${p.x},${p.y}`).join(' '),
    };
  }, [attempts]);

  // ---- analytics views for the selected attempt ---------------------------

  const renderSelected = (sel: CompletedAttempt) => {
    const an = sel.analytics;
    const isLatest = attempts[0]?.id === sel.id;

    return (
      <>
        {/* Hero */}
        <div className="glass-panel p-6 sm:p-8 bg-gradient-to-r from-cyan-950/40 via-darkCard/50 to-indigo-950/40 border-cyan-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <span className="eyebrow !text-emerald-400">
                {isLatest ? 'Latest Attempt' : 'Selected Attempt'}
              </span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-5xl font-extrabold font-display text-white font-mono drop-shadow-[0_0_20px_rgba(34,211,238,0.45)]">
                  {an.totalScore}
                </span>
                <span className="text-xl font-mono text-slate-400">/ {an.maxScore}</span>
              </div>
              <p className="text-sm text-slate-400 mt-2">
                {fmtDate(sel.submittedAt)} · {fmtTime(sel.submittedAt)} · ⏱{' '}
                {fmtDuration(an.totalSeconds)} on questions
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <div className="glass-inset text-center px-5 py-4">
                <div className="text-3xl font-extrabold font-display font-mono text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.4)]">
                  {pct(an.accuracy)}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">accuracy</div>
              </div>
              <div className="glass-inset text-center px-5 py-4">
                <div className="text-3xl font-extrabold font-display font-mono text-indigo-400 drop-shadow-[0_0_12px_rgba(99,102,241,0.4)]">
                  {an.avgSecondsPerQuestion}s
                </div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">
                  avg / question
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Attempted',
              value: an.attempted,
              cls: 'text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]',
            },
            {
              label: 'Correct',
              value: an.correct,
              cls: 'text-emerald-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.35)]',
            },
            {
              label: 'Wrong',
              value: an.wrong,
              cls: 'text-rose-300 drop-shadow-[0_0_10px_rgba(244,63,94,0.35)]',
            },
            { label: 'Skipped', value: an.skipped, cls: 'text-slate-300' },
          ].map((s) => (
            <div key={s.label} className="glass-panel p-5">
              <div className={`text-2xl font-bold font-display font-mono ${s.cls}`}>{s.value}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Section breakdown */}
        <div className="glass-panel p-6">
          <h3 className="text-lg font-bold text-white font-display mb-4">Section breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="py-2 pr-4 font-semibold">Section</th>
                  <th className="py-2 pr-4 font-semibold">Score</th>
                  <th className="py-2 pr-4 font-semibold">Attempted</th>
                  <th className="py-2 pr-4 font-semibold">Correct</th>
                  <th className="py-2 pr-4 font-semibold">Wrong</th>
                  <th className="py-2 font-semibold">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {an.perSection.map((s) => (
                  <tr key={s.paperId} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-4 text-slate-200">{s.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-white">
                      {s.score} <span className="text-slate-500">/ {s.maxScore}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-slate-300">{s.attempted}</td>
                    <td className="py-2.5 pr-4 font-mono text-emerald-300">{s.correct}</td>
                    <td className="py-2.5 pr-4 font-mono text-rose-300">{s.wrong}</td>
                    <td className="py-2.5 font-mono text-slate-300">{sectionAccuracy(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 space-y-3">
            {an.perSection.map((s) => (
              <div key={s.paperId}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-400 truncate pr-2">{s.name}</span>
                  <span className="font-mono text-slate-500 shrink-0">
                    {Math.round(sectionBarPct(s))}% of max
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 shadow-[0_0_8px_rgba(6,182,212,0.5)] transition-all duration-500"
                    style={{ width: `${sectionBarPct(s)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Score trend */}
        {chart && (
          <div className="glass-panel p-6">
            <h3 className="text-lg font-bold text-white font-display mb-2">Score trend</h3>
            <svg
              viewBox={`0 0 ${chart.W} ${chart.H}`}
              className="w-full h-48"
              role="img"
              aria-label="Score trend across mock attempts"
            >
              <defs>
                <filter id="mockTrendGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {chart.zeroY != null && (
                <line
                  x1={0}
                  y1={chart.zeroY}
                  x2={chart.W}
                  y2={chart.zeroY}
                  stroke="#334155"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              )}
              {chart.points.length > 1 && (
                <polyline
                  points={chart.polyline}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  filter="url(#mockTrendGlow)"
                />
              )}
              {chart.points.map((p) => (
                <g key={p.id} onClick={() => setSelectedId(p.id)} className="cursor-pointer">
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={sel.id === p.id ? 6 : 4.5}
                    fill={sel.id === p.id ? '#22d3ee' : '#0e7490'}
                    stroke="#0B0F19"
                    strokeWidth={2}
                  />
                  <text
                    x={p.x}
                    y={p.y - 10}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#94a3b8"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {p.score}
                  </text>
                  {chart.points.length <= 8 && (
                    <text x={p.x} y={chart.H - 10} textAnchor="middle" fontSize={9} fill="#64748b">
                      {p.date}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            <p className="text-[11px] text-slate-500 mt-1">Click a dot to inspect that attempt.</p>
          </div>
        )}

        {/* Attempt history */}
        <div className="glass-panel p-6">
          <h3 className="text-lg font-bold text-white font-display mb-4">Attempt history</h3>
          <ul className="space-y-2">
            {attempts.map((a, idx) => {
              const isSel = sel.id === a.id;
              return (
                <li key={a.id}>
                  <button
                    onClick={() => setSelectedId(a.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                      isSel
                        ? 'border bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_16px_rgba(6,182,212,0.15)]'
                        : 'glass-inset hover:border-cyan-500/30 hover:bg-slate-900/70'
                    }`}
                  >
                    <span className="glass-tile w-9 h-9 text-[11px] font-mono text-slate-400 shrink-0">
                      #{attempts.length - idx}
                    </span>
                    <div className="flex-grow min-w-0">
                      <p className="text-sm text-slate-200 truncate">
                        {fmtDate(a.submittedAt)} · {fmtTime(a.submittedAt)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {a.analytics.attempted} attempted · {a.analytics.correct} correct
                      </p>
                    </div>
                    <span className="chip text-emerald-300 bg-emerald-500/10 border-emerald-500/25 shrink-0">
                      {pct(a.analytics.accuracy)}
                    </span>
                    <span className="shrink-0 font-mono text-sm text-white">
                      {a.analytics.totalScore}{' '}
                      <span className="text-slate-500">/ {a.analytics.maxScore}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <span className="eyebrow">Mock Analytics</span>
          <h2 className="text-3xl font-extrabold tracking-tight text-white font-display mt-1">
            {exam.shortName} Mock Results
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Score history, sectional breakdown and accuracy across attempts.
          </p>
        </div>
        {attempts.length > 0 && (
          <button onClick={onStartMock} className="btn-primary text-sm shrink-0">
            📝 Take another mock
          </button>
        )}
      </div>

      {loading ? (
        <div className="glass-panel p-10 flex flex-col items-center gap-3">
          <span className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500" />
          <p className="text-sm text-slate-400">Loading mock history…</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
          ❌ {error}
        </div>
      ) : selected ? (
        renderSelected(selected)
      ) : (
        <div className="glass-panel p-10 text-center">
          <span className="glass-tile w-16 h-16 text-3xl">📝</span>
          <h3 className="text-xl font-bold text-white font-display mt-3">No mock attempts yet</h3>
          <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
            Take a full-pattern CBT mock to see your score, sectional accuracy and
            time-per-question analytics here.
          </p>
          <button onClick={onStartMock} className="btn-primary text-sm mt-6">
            🚀 Start your first mock
          </button>
        </div>
      )}
    </div>
  );
}
