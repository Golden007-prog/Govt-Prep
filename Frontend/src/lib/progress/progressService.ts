// Progress/engagement engine: XP + streak (localStorage settings), activity log + study
// sessions + topic mastery + achievements (Dexie). Pure local computation — no AI calls.

import { db } from '../store/db';
import type { TopicProgress } from '../store/db';
import { getSettings, saveSettings } from '../store/settings';
import { ACHIEVEMENTS, XP_AWARDS } from '../types/progress';
import type { AchievementDef, ActivityDay, XpAction } from '../types/progress';
import type { ExamTaxonomy, ExamTopic } from '../types/exam';
import type { StudyPlan } from '../types/plan';
import { addDaysISO, todayISO } from '../plan/dateUtils';

const DAILY_GOAL_KEY = 'dailyGoalXp';
const DEFAULT_DAILY_GOAL_XP = 100;
const DAY_MS = 86_400_000;
/** Mastery at/above this marks a topic 'completed' (mirrors the 80% subject-expert bar). */
const MASTERY_COMPLETED_AT = 80;
/** Decay: -2 mastery per full week beyond this grace period since last study. */
const DECAY_GRACE_DAYS = 14;
const DECAY_PER_WEEK = 2;

/** Optional context for {@link recordActivity}. */
export interface RecordActivityOptions {
  /** Topic the activity relates to (attached to the study session row). */
  topicId?: string;
  /** Focused minutes spent; when set, a `db.studySessions` row is added. */
  minutes?: number;
  /** Multiplier for the XP award (e.g. 12 correct quiz questions). Defaults to 1. */
  count?: number;
  /** Session kind for the minutes row. Defaults to 'study'. */
  sessionKind?: 'pomodoro' | 'study' | 'mock' | 'review';
}

/** Mastery + decayed mastery, taking the 14-day grace period into account. */
function effectiveMastery(row: TopicProgress, now: number): number {
  if (row.lastStudiedAt == null) return row.mastery;
  const daysSince = (now - row.lastStudiedAt) / DAY_MS;
  const weeksBeyondGrace = Math.floor(Math.max(0, daysSince - DECAY_GRACE_DAYS) / 7);
  return Math.max(0, row.mastery - DECAY_PER_WEEK * weeksBeyondGrace);
}

/** Longest run of consecutive calendar dates (YYYY-MM-DD) in the given list. */
function longestConsecutiveRun(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const date of sorted) {
    run = prev !== '' && addDaysISO(prev, 1) === date ? run + 1 : 1;
    if (run > best) best = run;
    prev = date;
  }
  return best;
}

/** Unlock a catalog achievement if it isn't unlocked yet; returns its def when freshly unlocked. */
async function unlockIfMissing(id: string): Promise<AchievementDef | null> {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return null;
  const existing = await db.achievements.get(id);
  if (existing) return null;
  await db.achievements.put({ id, unlockedAt: Date.now() });
  return def;
}

/**
 * Record a user activity: awards XP (XP_AWARDS[action] × count), advances the daily streak,
 * merges into today's activity-log row, optionally logs a study session, then runs the
 * achievement check. Returns the XP earned and any achievements unlocked by this activity.
 */
export async function recordActivity(
  action: XpAction,
  opts: RecordActivityOptions = {},
): Promise<{ xpEarned: number; newAchievements: AchievementDef[] }> {
  const count = opts.count ?? 1;
  const xpEarned = XP_AWARDS[action] * count;
  const today = todayISO();

  // XP + streak live in localStorage settings.
  const settings = getSettings();
  let streak = settings.streak;
  if (settings.lastActiveDate !== today) {
    streak = settings.lastActiveDate === addDaysISO(today, -1) ? settings.streak + 1 : 1;
  }
  saveSettings({ xp: settings.xp + xpEarned, streak, lastActiveDate: today });

  // Merge into today's activity-log row (one row per day).
  const todayLog = await db.activityLogs.where('date').equals(today).first();
  if (todayLog?.id != null) {
    await db.activityLogs.update(todayLog.id, {
      xpEarned: todayLog.xpEarned + xpEarned,
      actions: [...todayLog.actions, action],
    });
  } else {
    await db.activityLogs.add({ date: today, xpEarned, actions: [action] });
  }

  // Focused time → study session row (feeds the heatmap minutes + pomodoro achievement).
  if (opts.minutes != null && opts.minutes > 0) {
    await db.studySessions.add({
      date: today,
      kind: opts.sessionKind ?? 'study',
      minutes: opts.minutes,
      topicId: opts.topicId,
      startedAt: Date.now(),
    });
  }

  const newAchievements: AchievementDef[] = [];
  // 'perfect-quiz' is a live signal (a single 10/10 quiz), not derivable from stored state.
  if (action === 'quizQuestionCorrect' && count >= 10) {
    const def = await unlockIfMissing('perfect-quiz');
    if (def) newAchievements.push(def);
  }
  for (const def of await checkAchievements()) {
    if (!newAchievements.some((a) => a.id === def.id)) newAchievements.push(def);
  }
  return { xpEarned, newAchievements };
}

/**
 * Evaluate the full ACHIEVEMENTS catalog against current state (settings XP/streak plus Dexie
 * counts), unlock any newly earned ones into `db.achievements`, and return their defs.
 * Note: 'perfect-quiz' is only unlockable live via {@link recordActivity}.
 */
export async function checkAchievements(): Promise<AchievementDef[]> {
  const settings = getSettings();
  const [logs, attempts, cards, topicRows, pomodoroCount, unlockedRows] = await Promise.all([
    db.activityLogs.toArray(),
    db.mockAttempts.toArray(),
    db.flashcards.toArray(),
    db.topics.toArray(),
    db.studySessions.where('kind').equals('pomodoro').count(),
    db.achievements.toArray(),
  ]);

  const actionCounts: Record<string, number> = {};
  const caDates: string[] = [];
  for (const log of logs) {
    for (const a of log.actions) actionCounts[a] = (actionCounts[a] ?? 0) + 1;
    if (log.actions.includes('caRead')) caDates.push(log.date);
  }

  const submittedMocks = attempts.filter((m) => m.submittedAt != null);
  const bestMockRatio = submittedMocks.reduce((best, m) => {
    const a = m.analytics;
    return a && a.maxScore > 0 ? Math.max(best, a.totalScore / a.maxScore) : best;
  }, 0);

  const cardsReviewed = cards.reduce((sum, c) => sum + c.reps, 0);
  const studiedTopics = topicRows.filter((t) => t.lastStudiedAt != null);

  // Best per-subject average mastery across studied topics.
  const subjectAgg = new Map<string, { total: number; n: number }>();
  for (const row of studiedTopics) {
    const agg = subjectAgg.get(row.subject) ?? { total: 0, n: 0 };
    agg.total += row.mastery;
    agg.n += 1;
    subjectAgg.set(row.subject, agg);
  }
  let bestSubjectMastery = 0;
  for (const agg of subjectAgg.values()) {
    bestSubjectMastery = Math.max(bestSubjectMastery, agg.total / agg.n);
  }

  const met: Record<string, boolean> = {
    'first-notes': (actionCounts.notesGenerated ?? 0) >= 1,
    'first-quiz': (actionCounts.quizCompleted ?? 0) >= 1,
    'perfect-quiz': false, // unlocked live by recordActivity (quizQuestionCorrect × 10+)
    'first-mock': submittedMocks.length >= 1,
    'mock-50': bestMockRatio >= 0.5,
    'mock-75': bestMockRatio >= 0.75,
    'streak-3': settings.streak >= 3,
    'streak-7': settings.streak >= 7,
    'streak-30': settings.streak >= 30,
    'cards-50': cardsReviewed >= 50,
    'cards-500': cardsReviewed >= 500,
    'xp-1000': settings.xp >= 1000,
    'xp-10000': settings.xp >= 10000,
    'topics-10': studiedTopics.length >= 10,
    'mastery-80': bestSubjectMastery >= MASTERY_COMPLETED_AT,
    'pomodoro-10': pomodoroCount >= 10,
    'ca-7': longestConsecutiveRun(caDates) >= 7,
  };

  const unlockedIds = new Set(unlockedRows.map((r) => r.id));
  const now = Date.now();
  const fresh: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (unlockedIds.has(def.id) || !met[def.id]) continue;
    await db.achievements.put({ id: def.id, unlockedAt: now });
    fresh.push(def);
  }
  return fresh;
}

/** Full catalog in display order, each with its unlock timestamp (null = still locked). */
export async function getAchievements(): Promise<Array<AchievementDef & { unlockedAt: number | null }>> {
  const rows = await db.achievements.toArray();
  const unlockedAtById = new Map(rows.map((r) => [r.id, r.unlockedAt]));
  return ACHIEVEMENTS.map((def) => ({ ...def, unlockedAt: unlockedAtById.get(def.id) ?? null }));
}

/**
 * Blend a fresh score into a topic's mastery: next = round(0.7×old + 0.3×scoreRatio×100),
 * clamped 0..100 (old = 0 for a new topic). Marks the topic 'completed' at ≥80, else 'started',
 * and stamps `lastStudiedAt`.
 */
export async function updateMastery(
  topicId: string,
  subjectId: string,
  topicName: string,
  scoreRatio: number,
): Promise<void> {
  const existing = await db.topics.get(topicId);
  const old = existing?.mastery ?? 0;
  const mastery = Math.min(100, Math.max(0, Math.round(0.7 * old + 0.3 * scoreRatio * 100)));
  await db.topics.put({
    ...existing,
    id: topicId,
    subject: subjectId,
    topicName,
    mastery,
    lastStudiedAt: Date.now(),
    status: mastery >= MASTERY_COMPLETED_AT ? 'completed' : 'started',
  });
}

/** Progress row for a topic, or null when the topic hasn't been touched yet. */
export async function getTopicProgress(topicId: string): Promise<TopicProgress | null> {
  return (await db.topics.get(topicId)) ?? null;
}

/**
 * Per-subject mastery for the dashboard: average effective topic mastery (lazy decay of
 * -2/week beyond 14 days since last study) over studied topics, plus coverage counts.
 */
export async function getSubjectMastery(
  exam: ExamTaxonomy,
): Promise<Array<{ subjectId: string; name: string; mastery: number; topicsStudied: number; totalTopics: number }>> {
  const now = Date.now();
  const rows = await db.topics.toArray();
  const rowById = new Map(rows.map((r) => [r.id, r]));

  return exam.subjects.map((subject) => {
    const subjectTopics = exam.topics.filter((t) => t.subjectId === subject.id);
    const studied: TopicProgress[] = [];
    for (const topic of subjectTopics) {
      const row = rowById.get(topic.id);
      if (row && row.lastStudiedAt != null) studied.push(row);
    }
    const mastery =
      studied.length > 0
        ? Math.round(studied.reduce((sum, r) => sum + effectiveMastery(r, now), 0) / studied.length)
        : 0;
    return {
      subjectId: subject.id,
      name: subject.name,
      mastery,
      topicsStudied: studied.length,
      totalTopics: subjectTopics.length,
    };
  });
}

/**
 * "What should I study next?" — ranked suggestions, deduped, up to `limit`:
 * 1. untouched topics on today's (and upcoming) plan days,
 * 2. topics from the subjects with the lowest effective mastery,
 * 3. the stalest previously-studied topics (longest since last revision).
 */
export async function nextTopics(
  exam: ExamTaxonomy,
  plan: StudyPlan | null,
  limit = 3,
): Promise<Array<{ topic: ExamTopic; reason: string }>> {
  const now = Date.now();
  const rows = await db.topics.toArray();
  const progress = new Map(rows.map((r) => [r.id, r]));
  const topicById = new Map(exam.topics.map((t) => [t.id, t]));
  const picked = new Map<string, { topic: ExamTopic; reason: string }>();
  const isUntouched = (id: string): boolean => {
    const row = progress.get(id);
    return !row || row.lastStudiedAt == null;
  };

  // Tier 1: untouched topics scheduled for today onwards, earliest plan day first.
  if (plan) {
    const today = todayISO();
    const upcoming = plan.days
      .filter((d) => d.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const day of upcoming) {
      if (picked.size >= limit) break;
      for (const item of day.items) {
        if (picked.size >= limit) break;
        if (!item.topicId || picked.has(item.topicId) || !isUntouched(item.topicId)) continue;
        const topic = topicById.get(item.topicId);
        if (!topic) continue;
        picked.set(topic.id, { topic, reason: "On today's plan" });
      }
    }
  }

  // Tier 2: lowest effective subject mastery; within a subject, untouched/lowest topics first.
  if (picked.size < limit) {
    const subjects = await getSubjectMastery(exam);
    subjects.sort((a, b) => a.mastery - b.mastery);
    for (const subject of subjects) {
      if (picked.size >= limit) break;
      const candidates = exam.topics
        .filter((t) => t.subjectId === subject.subjectId && !picked.has(t.id))
        .sort((a, b) => {
          const ra = progress.get(a.id);
          const rb = progress.get(b.id);
          const ea = ra && ra.lastStudiedAt != null ? effectiveMastery(ra, now) : -1;
          const eb = rb && rb.lastStudiedAt != null ? effectiveMastery(rb, now) : -1;
          if (ea !== eb) return ea - eb;
          return a.order - b.order;
        });
      for (const topic of candidates) {
        if (picked.size >= limit) break;
        picked.set(topic.id, { topic, reason: `Weakest subject: ${subject.name}` });
      }
    }
  }

  // Tier 3: stalest studied topics (longest since last revision).
  if (picked.size < limit) {
    const stale = rows
      .filter((r) => r.lastStudiedAt != null && !picked.has(r.id) && topicById.has(r.id))
      .sort((a, b) => (a.lastStudiedAt ?? 0) - (b.lastStudiedAt ?? 0));
    for (const row of stale) {
      if (picked.size >= limit) break;
      const topic = topicById.get(row.id);
      if (!topic) continue;
      const daysSince = Math.floor((now - (row.lastStudiedAt ?? now)) / DAY_MS);
      picked.set(row.id, { topic, reason: `Not revised in ${daysSince} days` });
    }
  }

  return [...picked.values()].slice(0, limit);
}

/**
 * Activity heatmap for the last `days` calendar days (ascending, gaps filled with zeros):
 * XP + action counts from activity logs, minutes from study sessions.
 */
export async function getHeatmap(days = 90): Promise<ActivityDay[]> {
  const start = addDaysISO(todayISO(), -(days - 1));
  const [logs, sessions] = await Promise.all([
    db.activityLogs.toArray(),
    db.studySessions.toArray(),
  ]);

  const byDate = new Map<string, ActivityDay>();
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(start, i);
    byDate.set(date, { date, xp: 0, minutes: 0, actions: 0 });
  }
  for (const log of logs) {
    const day = byDate.get(log.date);
    if (day) {
      day.xp += log.xpEarned;
      day.actions += log.actions.length;
    }
  }
  for (const session of sessions) {
    const day = byDate.get(session.date);
    if (day) day.minutes += session.minutes;
  }
  return [...byDate.values()];
}

/** Daily XP goal (db.settings key 'dailyGoalXp'); defaults to 100. */
export async function getDailyGoal(): Promise<number> {
  const row = await db.settings.get(DAILY_GOAL_KEY);
  const value = row?.value;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_DAILY_GOAL_XP;
}

/** Persist the daily XP goal. */
export async function setDailyGoal(n: number): Promise<void> {
  await db.settings.put({ key: DAILY_GOAL_KEY, value: n });
}

/** Today's XP earned vs the daily goal (for the dashboard ring). */
export async function getTodayProgress(): Promise<{ xp: number; goal: number }> {
  const [todayLog, goal] = await Promise.all([
    db.activityLogs.where('date').equals(todayISO()).first(),
    getDailyGoal(),
  ]);
  return { xp: todayLog?.xpEarned ?? 0, goal };
}
