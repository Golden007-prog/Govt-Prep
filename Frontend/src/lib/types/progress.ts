/** Achievement catalog + activity types for the progress/engagement engine. */

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string; // emoji
}

/** Static catalog — unlock state lives in db.achievements. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-notes', title: 'First Steps', description: 'Generate your first study notes', icon: '📖' },
  { id: 'first-quiz', title: 'Quiz Rookie', description: 'Complete your first topic quiz', icon: '📝' },
  { id: 'perfect-quiz', title: 'Perfectionist', description: 'Score 10/10 on a topic quiz', icon: '💯' },
  { id: 'first-mock', title: 'Simulator Initiate', description: 'Finish your first full mock', icon: '🎯' },
  { id: 'mock-50', title: 'Halfway There', description: 'Score 50%+ in a mock', icon: '📈' },
  { id: 'mock-75', title: 'Topper Material', description: 'Score 75%+ in a mock', icon: '🏆' },
  { id: 'streak-3', title: 'Warming Up', description: '3-day study streak', icon: '🔥' },
  { id: 'streak-7', title: 'On Fire', description: '7-day study streak', icon: '🚀' },
  { id: 'streak-30', title: 'Unstoppable', description: '30-day study streak', icon: '⚡' },
  { id: 'cards-50', title: 'Card Shark', description: 'Review 50 flashcards', icon: '🃏' },
  { id: 'cards-500', title: 'Memory Palace', description: 'Review 500 flashcards', icon: '🏛️' },
  { id: 'xp-1000', title: 'Grinder', description: 'Earn 1,000 XP', icon: '✨' },
  { id: 'xp-10000', title: 'Legend', description: 'Earn 10,000 XP', icon: '🌟' },
  { id: 'topics-10', title: 'Explorer', description: 'Study 10 different topics', icon: '🗺️' },
  { id: 'mastery-80', title: 'Subject Matter Expert', description: 'Reach 80% mastery in a subject', icon: '🎓' },
  { id: 'pomodoro-10', title: 'Deep Worker', description: 'Complete 10 pomodoro sessions', icon: '🍅' },
  { id: 'ca-7', title: 'News Hound', description: 'Read current affairs 7 days in a row', icon: '📰' },
] as const;

/** XP awards by action — single source of truth. */
export const XP_AWARDS = {
  notesGenerated: 10,
  quizQuestionCorrect: 5,
  quizCompleted: 20,
  homeworkGenerated: 5,
  cardReviewed: 2,
  mockCompleted: 100,
  caRead: 10,
  caQuizCorrect: 5,
  pomodoroCompleted: 15,
} as const;

export type XpAction = keyof typeof XP_AWARDS;

/** Level curve: level n needs n*n*100 cumulative XP (lvl 1→100, 2→400, 3→900 …). */
export function levelForXp(xp: number): { level: number; currentLevelXp: number; nextLevelXp: number } {
  let level = 0;
  while ((level + 1) * (level + 1) * 100 <= xp) level++;
  const floor = level * level * 100;
  const ceil = (level + 1) * (level + 1) * 100;
  return { level, currentLevelXp: xp - floor, nextLevelXp: ceil - floor };
}

/** One day in the activity heatmap. */
export interface ActivityDay {
  date: string; // YYYY-MM-DD
  xp: number;
  minutes: number;
  actions: number;
}
