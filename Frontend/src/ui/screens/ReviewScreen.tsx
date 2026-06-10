import { useEffect, useMemo, useRef, useState } from 'react';
import { fsrs, generatorParameters, Rating } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';
import type { Flashcard } from '../../lib/store/db';
import { getDueCards, getStats, rateCard } from '../../lib/srs/srsService';
import type { SrsStats } from '../../lib/srs/srsService';
import { recordActivity } from '../../lib/progress/progressService';
import type { AchievementDef } from '../../lib/types/progress';
import { useHotkeys } from '../../lib/hooks/useHotkeys';

/**
 * Flashcard review session (FSRS spaced repetition, feature #6).
 * Flow: load due cards → flip (click/Space/Enter) → rate 1-4 → next card.
 * XP is batched: every 10 ratings → one recordActivity('cardReviewed', {count: 10}),
 * with the remainder flushed at session end.
 */

type RatingValue = 1 | 2 | 3 | 4;
type Phase = 'loading' | 'empty' | 'review' | 'done' | 'error';

/** Local preview scheduler — same defaults as srsService, used only for next-due hints. */
const previewScheduler = fsrs(generatorParameters());

const GRADE_MAP: Record<RatingValue, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

const RATING_META: ReadonlyArray<{ rating: RatingValue; label: string; cls: string; fallback: string }> = [
  {
    rating: 1,
    label: 'Again',
    cls: 'text-rose-300 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20',
    fallback: '<10m',
  },
  {
    rating: 2,
    label: 'Hard',
    cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20',
    fallback: '1h',
  },
  {
    rating: 3,
    label: 'Good',
    cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/20',
    fallback: '1d',
  },
  {
    rating: 4,
    label: 'Easy',
    cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20',
    fallback: '4d',
  },
];

/** Projects a Dexie flashcard row onto the ts-fsrs Card shape (fields match by design). */
function toFsrsCard(card: Flashcard): Card {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as Card['state'],
    last_review: card.last_review,
  };
}

/** "<10m" / "25m" / "3h" / "12d" / "2mo" style gap formatting for next-due hints. */
function formatGap(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 10) return '<10m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.max(1, Math.round(days))}d`;
  return `${Math.max(1, Math.round(days / 30))}mo`;
}

function StatCards({ stats }: { stats: SrsStats }) {
  const items = [
    { label: 'Total cards', value: stats.total, icon: '🃏' },
    { label: 'Due now', value: stats.dueNow, icon: '⏰' },
    { label: 'Reviewed today', value: stats.reviewedToday, icon: '✅' },
    { label: 'New cards', value: stats.newCards, icon: '✨' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((s) => (
        <div key={s.label} className="glass-panel p-5">
          <div className="text-2xl">{s.icon}</div>
          <div className="text-2xl font-bold text-white font-display mt-2">{s.value}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin"
      aria-hidden="true"
    />
  );
}

export function ReviewScreen() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [stats, setStats] = useState<SrsStats | null>(null);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [xpEarned, setXpEarned] = useState(0);
  const [sessionAchievements, setSessionAchievements] = useState<AchievementDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** Ratings since the last XP flush (recordActivity is called per 10). */
  const pendingRef = useRef(0);
  /** Guards against double-rating while rateCard/recordActivity are in flight. */
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getStats(), getDueCards(50)])
      .then(([s, cards]) => {
        if (cancelled) return;
        setStats(s);
        setQueue(cards);
        setPhase(cards.length === 0 ? 'empty' : 'review');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load your flashcard deck.');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const currentCard: Flashcard | undefined = queue[index];

  /** Accurate per-rating next-due hints for the current card (preview, no persistence). */
  const hints = useMemo(() => {
    if (!currentCard) return null;
    try {
      const now = new Date();
      const log = previewScheduler.repeat(toFsrsCard(currentCard), now);
      const result = {} as Record<RatingValue, string>;
      for (const r of [1, 2, 3, 4] as const) {
        result[r] = formatGap(log[GRADE_MAP[r]].card.due.getTime() - now.getTime());
      }
      return result;
    } catch {
      return null;
    }
  }, [currentCard]);

  const addAchievements = (defs: AchievementDef[]) => {
    if (defs.length === 0) return;
    setSessionAchievements((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      const fresh = defs.filter((a) => !seen.has(a.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  };

  /** Flush the <10 remainder, refresh stats, and show the end screen. */
  const finishSession = async () => {
    const remainder = pendingRef.current;
    pendingRef.current = 0;
    if (remainder > 0) {
      try {
        const res = await recordActivity('cardReviewed', { count: remainder, sessionKind: 'review' });
        setXpEarned((xp) => xp + res.xpEarned);
        addAchievements(res.newAchievements);
      } catch {
        // XP bookkeeping failure shouldn't block the end screen.
      }
    }
    try {
      setStats(await getStats());
    } catch {
      // Stale stats are acceptable on the end screen.
    }
    setPhase('done');
  };

  const handleRate = async (rating: RatingValue) => {
    const card = queue[index];
    if (!card || !flipped || busyRef.current || phase !== 'review') return;
    busyRef.current = true;
    try {
      await rateCard(card, rating);
      setReviewedCount((c) => c + 1);
      pendingRef.current += 1;
      if (pendingRef.current >= 10) {
        pendingRef.current -= 10;
        try {
          const res = await recordActivity('cardReviewed', { count: 10, sessionKind: 'review' });
          setXpEarned((xp) => xp + res.xpEarned);
          addAchievements(res.newAchievements);
        } catch {
          // Keep reviewing even if the XP write fails.
        }
      }
      setError(null);
      if (index + 1 >= queue.length) {
        await finishSession();
      } else {
        setIndex(index + 1);
        setFlipped(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this rating — try again.');
    } finally {
      busyRef.current = false;
    }
  };

  const flip = () => {
    if (!flipped) setFlipped(true);
  };

  useHotkeys(
    {
      ' ': flip,
      Enter: flip,
      '1': () => void handleRate(1),
      '2': () => void handleRate(2),
      '3': () => void handleRate(3),
      '4': () => void handleRate(4),
    },
    phase === 'review',
  );

  const restart = () => {
    pendingRef.current = 0;
    setQueue([]);
    setIndex(0);
    setFlipped(false);
    setReviewedCount(0);
    setXpEarned(0);
    setSessionAchievements([]);
    setError(null);
    setPhase('loading');
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <span className="text-xs font-semibold tracking-widest text-cyan-400 uppercase">Spaced repetition</span>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-display mt-1">
          Flashcard Review
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Rate honestly — the FSRS scheduler decides when you see each card again.
        </p>
      </div>

      {error && (
        <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
          ⚠️ {error}
        </div>
      )}

      {phase === 'loading' && (
        <div className="glass-panel p-8 flex items-center justify-center gap-3 text-sm text-slate-400">
          <Spinner /> Loading your due cards…
        </div>
      )}

      {phase === 'error' && (
        <div className="glass-panel p-8 text-center">
          <div className="text-3xl">😵</div>
          <p className="text-sm text-slate-300 mt-3">Could not load the review queue.</p>
          <button onClick={restart} className="btn-secondary text-sm mt-4">
            Retry
          </button>
        </div>
      )}

      {phase === 'empty' && (
        <>
          <div className="glass-panel p-8 text-center">
            <div className="text-4xl">🎉</div>
            <h3 className="text-2xl font-extrabold tracking-tight text-white font-display mt-3">All caught up</h3>
            <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
              No cards are due right now. Study a topic or take a quiz — wrong answers automatically become review
              cards.
            </p>
          </div>
          {stats && <StatCards stats={stats} />}
        </>
      )}

      {phase === 'review' && currentCard && (
        <div className="space-y-4">
          {/* Session header: counter + early exit */}
          <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
            <span className="font-mono">
              Card {index + 1} / {queue.length}
            </span>
            <div className="flex items-center gap-3">
              <span>{reviewedCount} rated</span>
              <button onClick={() => void finishSession()} className="btn-secondary text-xs px-3 py-1.5">
                End session
              </button>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-cyan-500/60 transition-all duration-300"
              style={{ width: `${(index / queue.length) * 100}%` }}
            />
          </div>

          {/* Flip card */}
          <div style={{ perspective: '1400px' }}>
            <div
              onClick={flip}
              className={`relative h-72 sm:h-80 transition-transform duration-500 ${flipped ? '' : 'cursor-pointer'}`}
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              }}
            >
              {/* Front */}
              <div
                className="absolute inset-0 glass-panel p-6 flex flex-col overflow-y-auto"
                style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
              >
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Question</span>
                <p className="text-base sm:text-lg text-slate-100 whitespace-pre-wrap leading-relaxed">
                  {currentCard.front}
                </p>
                <p className="mt-auto pt-4 text-[11px] text-slate-500">Click — or press Space / Enter — to reveal</p>
              </div>
              {/* Back */}
              <div
                className="absolute inset-0 glass-panel p-6 flex flex-col overflow-y-auto border-cyan-500/20"
                style={{
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }}
              >
                <span className="text-[10px] uppercase tracking-widest text-cyan-400 mb-3">Answer</span>
                <p className="text-sm sm:text-base text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {currentCard.back}
                </p>
              </div>
            </div>
          </div>

          {/* Rating bar / reveal button */}
          {flipped ? (
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {RATING_META.map((meta) => (
                <button
                  key={meta.rating}
                  onClick={() => void handleRate(meta.rating)}
                  className={`rounded-xl border px-2 py-3 text-center transition-colors ${meta.cls}`}
                >
                  <span className="block text-sm font-bold">{meta.label}</span>
                  <span className="block text-[10px] font-mono mt-1 opacity-80">
                    {hints?.[meta.rating] ?? meta.fallback}
                  </span>
                  <span className="block text-[10px] text-slate-500 mt-1">key {meta.rating}</span>
                </button>
              ))}
            </div>
          ) : (
            <button onClick={flip} className="btn-primary w-full text-sm">
              Show answer <span className="font-mono text-xs opacity-80">(Space)</span>
            </button>
          )}
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="glass-panel p-8 text-center">
            <div className="text-4xl">🏁</div>
            <h3 className="text-2xl font-extrabold tracking-tight text-white font-display mt-3">Session complete</h3>
            <p className="text-sm text-slate-400 mt-2">
              You reviewed <strong className="text-cyan-300">{reviewedCount}</strong>{' '}
              {reviewedCount === 1 ? 'card' : 'cards'}
              {xpEarned > 0 && (
                <>
                  {' '}
                  and earned <strong className="text-emerald-300">+{xpEarned} XP</strong>
                </>
              )}
              .
            </p>
            {sessionAchievements.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {sessionAchievements.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1.5"
                    title={a.description}
                  >
                    <span>{a.icon}</span> {a.title} unlocked!
                  </span>
                ))}
              </div>
            )}
            {stats && stats.dueNow > 0 && (
              <button onClick={restart} className="btn-primary text-sm mt-6">
                Review {stats.dueNow} more due {stats.dueNow === 1 ? 'card' : 'cards'}
              </button>
            )}
          </div>
          {stats && <StatCards stats={stats} />}
        </>
      )}
    </div>
  );
}
