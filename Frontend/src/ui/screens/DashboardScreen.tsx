import { useMemo } from 'react';
import type { ExamTaxonomy } from '../../lib/types/exam';
import type { StudyPlan, PlanDay, PlanItemKind } from '../../lib/types/plan';
import type { UserProfile } from '../../lib/types/user';
import { getSubject } from '../../lib/taxonomy/registry';
import { daysUntil, parseISODate, todayISO } from '../../lib/plan/dateUtils';

interface DashboardScreenProps {
  exam: ExamTaxonomy;
  plan: StudyPlan;
  profile: UserProfile;
  onReplan: () => void;
  onOpenSetup: () => void;
}

const KIND_META: Record<PlanItemKind, { label: string; cls: string; icon: string }> = {
  study: { label: 'Study', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20', icon: '📘' },
  revision: { label: 'Revision', cls: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20', icon: '🔁' },
  mock: { label: 'Mock', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/20', icon: '📝' },
  'current-affairs': { label: 'Current affairs', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: '🗞️' },
  rest: { label: 'Rest', cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20', icon: '☕' },
};

function fmtDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function DashboardScreen({ exam, plan, profile, onReplan, onOpenSetup }: DashboardScreenProps) {
  const today = todayISO();
  const daysLeft = daysUntil(plan.examDate, today);

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

  return (
    <div className="space-y-8">
      {/* Hero / exam + countdown */}
      <div className="glass-panel p-6 sm:p-8 bg-gradient-to-r from-cyan-950/40 via-darkCard/50 to-indigo-950/40 border-cyan-500/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <span className="text-xs font-semibold text-emerald-400 tracking-widest uppercase">Your plan is ready</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-display mt-2">
              {exam.shortName}
            </h2>
            <p className="text-slate-300 mt-2 text-sm">
              {exam.body} · {plan.language === 'hi' ? 'हिन्दी' : 'English'} ·{' '}
              <span className="capitalize">{profile.tier}</span> tier
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <button onClick={onReplan} className="btn-secondary text-sm">Change exam / re-plan</button>
              <button onClick={onOpenSetup} className="btn-secondary text-sm">Configure AI keys</button>
            </div>
          </div>
          <div className="text-center shrink-0 bg-slate-900/40 border border-white/5 rounded-2xl px-6 py-4">
            <div className="text-5xl font-extrabold font-display text-cyan-400 font-mono">{Math.max(0, daysLeft)}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">days to exam</div>
            <div className="text-[11px] text-slate-500 mt-1">{fmtDate(plan.examDate)}</div>
          </div>
        </div>
        {exam.meta.verification !== 'verified' && (
          <p className="mt-5 text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
            ⚠️ Exam pattern is <strong>{exam.meta.verification}</strong>. Pattern (papers/marks/negative marking/duration)
            is sourced from the official notification; Paper-II topic detail is GATE-CS-aligned. Verify before high-stakes mocks.
          </p>
        )}
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
                return (
                  <li
                    key={`${todayDay.date}-${i}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-white/5"
                  >
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
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No items scheduled.</p>
          )}
          <p className="mt-4 text-[11px] text-slate-500">
            Studying each topic (videos → AI notes/quiz/cards) lands in <strong>Milestone 2</strong>.
          </p>
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

      {/* Subjects (mastery heatmap placeholder) */}
      <div className="glass-panel p-6">
        <h3 className="text-lg font-bold text-white font-display mb-4">Subjects &amp; mastery</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {exam.subjects.map((s) => {
            const topicCount = exam.topics.filter((t) => t.subjectId === s.id).length;
            return (
              <div key={s.id} className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                <p className="text-xs font-semibold text-slate-200 truncate">{s.name}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{topicCount} topics</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-cyan-500/40" style={{ width: '0%' }} />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">0% mastery</p>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          Mastery, XP and the adaptive re-planner arrive in <strong>Milestone 6</strong>.
        </p>
      </div>
    </div>
  );
}
