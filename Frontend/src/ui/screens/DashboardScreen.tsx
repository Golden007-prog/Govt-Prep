import { useEffect, useMemo, useState } from 'react';
import type { ExamTaxonomy, ExamTopic, TopicImportance } from '../../lib/types/exam';
import type { StudyPlan, PlanDay, PlanItemKind } from '../../lib/types/plan';
import type { UserProfile } from '../../lib/types/user';
import type { AchievementDef, ActivityDay } from '../../lib/types/progress';
import { levelForXp } from '../../lib/types/progress';
import type { CaDigest } from '../../lib/store/db';
import { getSettings } from '../../lib/store/settings';
import { getSubject } from '../../lib/taxonomy/registry';
import { daysUntil, parseISODate, todayISO } from '../../lib/plan/dateUtils';
import {
  getAchievements,
  getCurrentStreak,
  getHeatmap,
  getSubjectMastery,
  getTodayProgress,
  nextTopics,
} from '../../lib/progress/progressService';
import { countDue } from '../../lib/srs/srsService';
import { getRecentDigests, todayIso as caTodayIso } from '../../lib/ca/caService';
import { Heatmap } from '../components/Heatmap';
import { GoalRing } from '../components/GoalRing';
import { Markdown } from '../components/Markdown';

export type DashboardNavTarget = 'study' | 'review' | 'mock' | 'mock-results' | 'chat' | 'ca' | 'settings';

export interface DashboardScreenProps {
  exam: ExamTaxonomy;
  plan: StudyPlan;
  profile: UserProfile;
  onReplan: () => void;
  onOpenSetup: () => void;
  onOpenTopic: (topicId: string) => void;
  onNavigate: (to: DashboardNavTarget) => void;
}

const KIND_META: Record<PlanItemKind, { label: string; cls: string; icon: string }> = {
  study: { label: 'Study', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20', icon: '📘' },
  revision: { label: 'Revision', cls: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20', icon: '🔁' },
  mock: { label: 'Mock', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/20', icon: '📝' },
  'current-affairs': { label: 'Current affairs', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: '🗞️' },
  rest: { label: 'Rest', cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20', icon: '☕' },
};

const IMPORTANCE_CLS: Record<TopicImportance, string> = {
  high: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  medium: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  low: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

interface SubjectMastery {
  subjectId: string;
  name: string;
  mastery: number;
  topicsStudied: number;
  totalTopics: number;
}

interface DashboardData {
  today: { xp: number; goal: number };
  dueCount: number;
  recommended: Array<{ topic: ExamTopic; reason: string }>;
  mastery: SubjectMastery[];
  heatmap: ActivityDay[];
  achievements: Array<AchievementDef & { unlockedAt: number | null }>;
  digest: CaDigest | null;
}

function fmtDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-800/60 ${className}`} />;
}

export function DashboardScreen({
  exam,
  plan,
  profile,
  onReplan,
  onOpenSetup,
  onOpenTopic,
  onNavigate,
}: DashboardScreenProps) {
  const today = todayISO();
  const daysLeft = daysUntil(plan.examDate, today);
  // XP lives in localStorage settings — sync source, lazy init. Streak goes through
  // getCurrentStreak() which lazily zeroes a broken streak on read.
  const [settings] = useState(() => ({ ...getSettings(), streak: getCurrentStreak() }));
  const level = levelForXp(settings.xp);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTodayProgress(),
      countDue(),
      nextTopics(exam, plan, 3),
      getSubjectMastery(exam),
      getHeatmap(90),
      getAchievements(),
      // Dexie-only read — the dashboard never generates a digest.
      getRecentDigests(exam, profile.languagePref, 1),
    ])
      .then(([todayProgress, dueCount, recommended, mastery, heatmap, achievements, digests]) => {
        if (cancelled) return;
        setData({
          today: todayProgress,
          dueCount,
          recommended,
          mastery,
          heatmap,
          achievements,
          digest: digests[0] ?? null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load progress data.');
      });
    return () => {
      cancelled = true;
    };
  }, [exam, plan, profile.languagePref]);

  const stats = useMemo(() => {
    const counts: Record<PlanItemKind, number> = {
      study: 0,
      revision: 0,
      mock: 0,
      'current-affairs': 0,
      rest: 0,
    };
    for (const day of plan.days) {
      for (const item of day.items) counts[item.kind]++;
    }
    return counts;
  }, [plan]);

  const todayDay: PlanDay | null =
    plan.days.find((d) => d.date === today) ??
    plan.days.find((d) => d.date >= today) ??
    plan.days[plan.days.length - 1] ??
    null;

  const upcoming = plan.days.filter((d) => d.date >= today).slice(0, 7);

  const firstPick = data?.recommended[0] ?? null;
  const todayDigest = data && data.digest && data.digest.date === caTodayIso() ? data.digest : null;
  const unlockedCount = data ? data.achievements.filter((a) => a.unlockedAt != null).length : 0;

  return (
    <div className="space-y-8">
      {/* Hero / exam + countdown + level + daily goal */}
      <div className="glass-panel p-6 sm:p-8 bg-gradient-to-r from-cyan-950/40 via-darkCard/50 to-indigo-950/40 border-cyan-500/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-emerald-400 tracking-widest uppercase">Command center</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-display mt-2">
              {exam.shortName}
            </h2>
            <p className="text-slate-300 mt-2 text-sm">
              {exam.body} · {plan.language === 'hi' ? 'हिन्दी' : 'English'} ·{' '}
              <span className="capitalize">{profile.tier}</span> tier
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-cyan-300 bg-cyan-500/10 border-cyan-500/20">
                ⭐ Level {level.level}
              </span>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-indigo-300 bg-indigo-500/10 border-indigo-500/20 font-mono">
                {level.currentLevelXp}/{level.nextLevelXp} XP to next
              </span>
              {settings.streak > 0 && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-amber-300 bg-amber-500/10 border-amber-500/20">
                  🔥 {settings.streak}-day streak
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <button onClick={onReplan} className="btn-secondary text-sm">Change exam / re-plan</button>
              <button onClick={onOpenSetup} className="btn-secondary text-sm">Configure AI keys</button>
            </div>
          </div>
          <div className="flex items-stretch gap-4 shrink-0">
            <div className="text-center bg-slate-900/40 border border-white/5 rounded-2xl px-6 py-4 flex flex-col items-center justify-center">
              <div className="text-5xl font-extrabold font-display text-cyan-400 font-mono">{Math.max(0, daysLeft)}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">days to exam</div>
              <div className="text-[11px] text-slate-500 mt-1">{fmtDate(plan.examDate)}</div>
            </div>
            <div className="text-center bg-slate-900/40 border border-white/5 rounded-2xl px-6 py-4 flex flex-col items-center justify-center">
              {data ? (
                <GoalRing value={data.today.xp} goal={data.today.goal} size={88} />
              ) : (
                <Skeleton className="h-[88px] w-[88px] rounded-full" />
              )}
              <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-2">{"today's goal"}</div>
            </div>
          </div>
        </div>
        {exam.meta.verification !== 'verified' && (
          <p className="mt-5 text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
            ⚠️ Exam pattern is <strong>{exam.meta.verification}</strong>. Pattern (papers/marks/negative marking/duration)
            is sourced from the official notification; Paper-II topic detail is GATE-CS-aligned. Verify before high-stakes mocks.
          </p>
        )}
      </div>

      {loadError && (
        <div className="glass-panel p-4 border-rose-500/20 bg-rose-500/5">
          <p className="text-sm text-rose-300">⚠️ Could not load progress data: {loadError}</p>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <button
          onClick={() => (firstPick ? onOpenTopic(firstPick.topic.id) : onNavigate('study'))}
          className="glass-panel-interactive p-4 text-left"
        >
          <div className="text-2xl">📘</div>
          <p className="text-sm font-bold text-white font-display mt-2">Continue studying</p>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            {firstPick ? firstPick.topic.name : data ? 'Pick a topic' : 'Loading…'}
          </p>
        </button>
        <button onClick={() => onNavigate('review')} className="glass-panel-interactive p-4 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="text-2xl">🃏</div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border font-mono ${
                data && data.dueCount > 0
                  ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                  : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
              }`}
            >
              {data ? data.dueCount : '…'} due
            </span>
          </div>
          <p className="text-sm font-bold text-white font-display mt-2">Review cards</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Spaced repetition</p>
        </button>
        <button onClick={() => onNavigate('mock')} className="glass-panel-interactive p-4 text-left">
          <div className="text-2xl">📝</div>
          <p className="text-sm font-bold text-white font-display mt-2">Mock test</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {exam.pattern.totalQuestions} Qs · {exam.pattern.totalDurationMinutes} min
          </p>
        </button>
        <button onClick={() => onNavigate('chat')} className="glass-panel-interactive p-4 text-left">
          <div className="text-2xl">💬</div>
          <p className="text-sm font-bold text-white font-display mt-2">Doubt chat</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Ask anything, anytime</p>
        </button>
        <button
          onClick={() => onNavigate('ca')}
          className="glass-panel-interactive p-4 text-left col-span-2 sm:col-span-1"
        >
          <div className="text-2xl">🗞️</div>
          <p className="text-sm font-bold text-white font-display mt-2">Current affairs</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Daily digest + quiz</p>
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Plan length', value: `${plan.totalDays} days`, icon: '🗓️' },
          { label: 'Study sessions', value: stats.study, icon: '📘' },
          { label: 'Mock tests', value: stats.mock, icon: '📝' },
          { label: 'Revision blocks', value: stats.revision, icon: '🔁' },
        ].map((s) => (
          <div key={s.label} className="glass-panel p-5">
            <div className="text-2xl">{s.icon}</div>
            <div className="text-2xl font-bold text-white font-display mt-2">{s.value}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Recommended next topics */}
      <div className="glass-panel p-6">
        <h3 className="text-lg font-bold text-white font-display mb-4">Recommended next</h3>
        {data ? (
          data.recommended.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {data.recommended.map(({ topic, reason }) => (
                <button
                  key={topic.id}
                  onClick={() => onOpenTopic(topic.id)}
                  className="p-4 rounded-xl bg-slate-900/40 border border-white/5 text-left transition-colors hover:border-cyan-500/30 hover:bg-slate-900/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${IMPORTANCE_CLS[topic.importance]}`}>
                      {topic.importance}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-cyan-300 bg-cyan-500/10 border-cyan-500/20 truncate">
                      {reason}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-100 mt-2.5">{topic.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{getSubject(exam, topic.subjectId)?.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nothing queued — open any subject below to start studying.</p>
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24 hidden sm:block" />
            <Skeleton className="h-24 hidden sm:block" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today */}
        <div className="lg:col-span-2 glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white font-display">
              {todayDay?.date === today ? "Today's focus" : 'Next up'}
            </h3>
            {todayDay && <span className="text-xs text-slate-400">{fmtDate(todayDay.date)}</span>}
          </div>
          {todayDay ? (
            <ul className="space-y-2.5">
              {todayDay.items.map((item, i) => {
                const meta = KIND_META[item.kind];
                const topicId = item.topicId;
                const row = (
                  <>
                    <span className="text-lg">{meta.icon}</span>
                    <div className="flex-grow min-w-0">
                      <p className="text-sm text-slate-200 truncate">{item.title}</p>
                      {item.subjectId && (
                        <p className="text-[11px] text-slate-500">{getSubject(exam, item.subjectId)?.name}</p>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono shrink-0">{item.estimatedMinutes}m</span>
                  </>
                );
                return (
                  <li key={`${todayDay.date}-${i}`}>
                    {topicId ? (
                      <button
                        onClick={() => onOpenTopic(topicId)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-white/5 text-left transition-colors hover:border-cyan-500/30 hover:bg-slate-900/70"
                      >
                        {row}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-white/5">
                        {row}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No items scheduled.</p>
          )}
        </div>

        {/* Upcoming */}
        <div className="glass-panel p-6">
          <h3 className="text-lg font-bold text-white font-display mb-4">Next 7 days</h3>
          <ol className="space-y-2">
            {upcoming.map((day) => {
              const focus = day.focusSubjectId ? getSubject(exam, day.focusSubjectId)?.name : null;
              const hasMock = day.items.some((i) => i.kind === 'mock');
              return (
                <li key={day.date} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-[11px] text-slate-500 font-mono">{fmtDate(day.date)}</span>
                  <span className="flex-grow text-slate-300 truncate">
                    {focus ?? (hasMock ? 'Mock + revision' : 'Revision + current affairs')}
                  </span>
                  {hasMock && <span className="text-[10px] text-rose-300">mock</span>}
                  <span className="text-[11px] text-slate-500">{day.items.length}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Subjects & mastery */}
      <div className="glass-panel p-6">
        <h3 className="text-lg font-bold text-white font-display mb-4">Subjects &amp; mastery</h3>
        {data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.mastery.map((s) => (
              <div key={s.subjectId} className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                <p className="text-xs font-semibold text-slate-200 truncate">{s.name}</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, s.mastery))}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  {s.mastery}% mastery · studied {s.topicsStudied}/{s.totalTopics} topics
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20 hidden sm:block" />
            <Skeleton className="h-20 hidden lg:block" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Consistency heatmap */}
        <div className="lg:col-span-2 glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white font-display">Consistency</h3>
            <span
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                settings.streak > 0
                  ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                  : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
              }`}
            >
              🔥 {settings.streak}-day streak
            </span>
          </div>
          {data ? <Heatmap days={data.heatmap} /> : <Skeleton className="h-28" />}
        </div>

        {/* Current affairs teaser — Dexie-only; generation happens on the CA screen */}
        <div className="glass-panel p-6 flex flex-col">
          <h3 className="text-lg font-bold text-white font-display mb-4">Current affairs</h3>
          {data ? (
            todayDigest ? (
              <div className="flex flex-col flex-grow">
                <div className="space-y-3 flex-grow">
                  {todayDigest.items.slice(0, 2).map((item) => (
                    <div key={item.id} className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-emerald-300 bg-emerald-500/10 border-emerald-500/20">
                        {item.subject}
                      </span>
                      <Markdown text={item.summary} className="mt-2 text-xs leading-relaxed text-slate-300 space-y-1" />
                    </div>
                  ))}
                </div>
                <button onClick={() => onNavigate('ca')} className="btn-secondary text-sm w-full mt-4">
                  Read all + take the quiz
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center flex-grow py-6">
                <div className="text-3xl">🗞️</div>
                <p className="text-sm text-slate-400 mt-2">{"No digest cached for today yet."}</p>
                <button onClick={() => onNavigate('ca')} className="btn-primary text-sm mt-4">
                  {"Get today's digest"}
                </button>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          )}
        </div>
      </div>

      {/* Achievements strip */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white font-display">Achievements</h3>
          {data && (
            <span className="text-xs text-slate-400 font-mono">
              {unlockedCount}/{data.achievements.length} unlocked
            </span>
          )}
        </div>
        {data ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {data.achievements.map((a) => {
              const unlocked = a.unlockedAt != null;
              return (
                <div
                  key={a.id}
                  title={unlocked ? a.description : `Locked — ${a.description}`}
                  className={`shrink-0 w-32 p-3 rounded-xl border text-center ${
                    unlocked
                      ? 'bg-cyan-500/10 border-cyan-500/20'
                      : 'bg-slate-900/40 border-white/5 opacity-50'
                  }`}
                >
                  <div className={`text-2xl ${unlocked ? '' : 'grayscale'}`}>{a.icon}</div>
                  <p className={`text-[11px] font-semibold mt-1.5 truncate ${unlocked ? 'text-cyan-200' : 'text-slate-500'}`}>
                    {unlocked ? a.title : `🔒 ${a.title}`}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-3">
            <Skeleton className="h-20 w-32 shrink-0" />
            <Skeleton className="h-20 w-32 shrink-0" />
            <Skeleton className="h-20 w-32 shrink-0" />
          </div>
        )}
      </div>
    </div>
  );
}
