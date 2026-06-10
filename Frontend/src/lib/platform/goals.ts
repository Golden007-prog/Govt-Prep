import type { UserProfile } from '../types/user';

/** Milliseconds in one day. */
const DAY_MS = 86_400_000;

/**
 * Counts whole days from today (local midnight) to the profile's exam date.
 *
 * @param profile The user profile (examDate is ISO YYYY-MM-DD).
 * @returns `{ days, examDate }` — days is negative when the exam has passed —
 *   or null when there is no profile, no exam date, or the date is malformed.
 */
export function examCountdown(
  profile: UserProfile | null,
): { days: number; examDate: string } | null {
  if (!profile || !profile.examDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(profile.examDate);
  if (!match) return null;
  const exam = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(exam.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((exam.getTime() - today.getTime()) / DAY_MS);
  return { days, examDate: profile.examDate };
}
