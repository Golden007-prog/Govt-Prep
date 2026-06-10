import { useEffect, useState } from 'react';
import type { ExamTaxonomy, LanguageCode } from '../../lib/types/exam';
import type { Region } from '../../lib/types/content';
import { db, type CaDigest } from '../../lib/store/db';
import { caQuizForDigest, getDigest, getRecentDigests, todayIso } from '../../lib/ca/caService';
import { recordActivity, todayLocalISO } from '../../lib/progress/progressService';
import { AnthropicError } from '../../lib/api/anthropicClient';
import { QuizRunner } from '../components/QuizRunner';

export interface CurrentAffairsScreenProps {
  exam: ExamTaxonomy;
  language: LanguageCode;
}

const REGION_META: Record<Region, string> = {
  national: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  state: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  international: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
};

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Award the daily caRead XP at most once per calendar day (checked against the activity log).
 * Uses todayLocalISO so the dedupe lookup matches the local-date rows recordActivity writes.
 */
async function recordCaReadOnce(): Promise<void> {
  const log = await db.activityLogs.where('date').equals(todayLocalISO()).first();
  if (log?.actions.includes('caRead')) return;
  await recordActivity('caRead');
}

function describeAiError(err: unknown): string {
  if (err instanceof AnthropicError) {
    if (err.status === 0 && err.message.includes('No Anthropic API key')) {
      return `${err.message} Open Settings → Configure keys (or the Setup screen) to add your Anthropic key.`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Failed to generate the digest.';
}

export function CurrentAffairsScreen({ exam, language }: CurrentAffairsScreenProps) {
  const today = todayIso();

  const [digests, setDigests] = useState<CaDigest[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQuiz, setShowQuiz] = useState(false);

  // Mount: cached digests only (Dexie — no AI/network).
  useEffect(() => {
    let cancelled = false;
    getRecentDigests(exam, language, 7)
      .then((rows) => {
        if (cancelled) return;
        setDigests(rows);
        const todays = rows.find((d) => d.date === todayIso());
        setSelectedDate(todays?.date ?? rows[0]?.date ?? null);
        setLoading(false);
        if (todays) void recordCaReadOnce();
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exam, language]);

  const todayDigest = digests.find((d) => d.date === today) ?? null;
  const selected = digests.find((d) => d.date === selectedDate) ?? null;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const digest = await getDigest(exam, language);
      setDigests((prev) => [digest, ...prev.filter((d) => d.id !== digest.id)]);
      setSelectedDate(digest.date);
      setShowQuiz(false);
      await recordCaReadOnce();
    } catch (err) {
      setError(describeAiError(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="glass-panel p-6 sm:p-8 bg-gradient-to-r from-emerald-950/40 via-darkCard/50 to-cyan-950/40 border-emerald-500/10">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-emerald-400 tracking-widest uppercase">
              🗞️ Current affairs
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-display mt-2">
              Today&apos;s digest
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {fmtDay(today)} · {exam.shortName} · {language === 'hi' ? 'हिन्दी' : 'English'}
            </p>
          </div>
          <span className="shrink-0 self-start text-[11px] font-semibold text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-full px-3 py-1.5">
            ⚠️ AI revision capsule — verify against PIB/official sources
          </span>
        </div>

        {!todayDigest && !loading && (
          <div className="mt-6">
            <button onClick={handleGenerate} disabled={generating} className="btn-primary text-sm">
              {generating ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white/40 border-t-transparent rounded-full mr-2" />
                  Building today&apos;s revision capsule… (20–60s)
                </>
              ) : (
                <>✨ Generate today&apos;s digest</>
              )}
            </button>
            {error && (
              <div className="mt-4 p-3 rounded-xl border bg-rose-500/10 border-rose-500/20 text-rose-400 text-xs flex items-start gap-2">
                <span>❌</span>
                <p className="leading-relaxed">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="glass-panel p-8 flex items-center gap-3 text-sm text-slate-400">
          <span className="animate-spin inline-block w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full" />
          Loading cached digests…
        </div>
      ) : digests.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <div className="text-3xl">🗞️</div>
          <p className="text-sm text-slate-300 mt-3 font-semibold">No digests cached yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Generate today&apos;s digest above — it&apos;s cached locally, so the past week stays available offline.
          </p>
        </div>
      ) : (
        <>
          {/* Date tabs across the cached week */}
          <div className="flex flex-wrap gap-2">
            {digests.map((d) => {
              const active = d.date === selectedDate;
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setSelectedDate(d.date);
                    setShowQuiz(false);
                  }}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}
                >
                  {d.date === today ? 'Today' : fmtDay(d.date)}
                </button>
              );
            })}
          </div>

          {/* Digest items */}
          {selected ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {selected.items.map((item) => (
                <article key={item.id} className="glass-panel-interactive p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full border text-cyan-300 bg-cyan-500/10 border-cyan-500/20">
                      {item.subject}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-1 rounded-full border capitalize ${REGION_META[item.region]}`}
                    >
                      {item.region}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mt-3 leading-relaxed">{item.summary}</p>
                  <a
                    href={item.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 mt-3 transition-colors"
                  >
                    🔗 {item.source.label} ↗
                  </a>
                </article>
              ))}
            </div>
          ) : (
            <div className="glass-panel p-6 text-sm text-slate-400">Pick a date above to read its digest.</div>
          )}

          {/* Daily quiz */}
          {selected && selected.quiz.length > 0 && (
            <div className="glass-panel p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white font-display">📝 Daily quiz</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selected.quiz.length} MCQs generated from {selected.date === today ? "today's" : 'this'} digest.
                  </p>
                </div>
                {!showQuiz && (
                  <button onClick={() => setShowQuiz(true)} className="btn-success text-sm shrink-0">
                    {selected.date === today ? "Take today's quiz" : "Take this day's quiz"}
                  </button>
                )}
              </div>
              {showQuiz && (
                <div className="mt-5">
                  <QuizRunner
                    key={selected.id}
                    title="Current Affairs Quiz"
                    questions={caQuizForDigest(selected)}
                    language={language}
                    gradeShortAnswers={false}
                    correctXpAction="caQuizCorrect"
                    xpOnComplete={null}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
