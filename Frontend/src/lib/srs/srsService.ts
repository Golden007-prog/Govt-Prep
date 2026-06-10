import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';
import { db } from '../store/db';
import type { Flashcard } from '../store/db';
import type { QuizQuestion } from '../types/content';

/**
 * FSRS spaced-repetition service (feature: flashcards + wrong-answer review).
 *
 * The Dexie `flashcards` table stores the ts-fsrs `Card` fields flat (same names:
 * due/stability/difficulty/elapsed_days/scheduled_days/reps/lapses/state/last_review,
 * Date objects for dates), so rows project 1:1 onto the scheduler input. Pure local
 * scheduling — no AI calls, no network.
 */

/** Singleton scheduler with default FSRS parameters (deterministic: fuzz disabled). */
const scheduler = fsrs(generatorParameters());

/** Aggregate counters for the review dashboard (see {@link getStats}). */
export interface SrsStats {
  /** All cards in the deck. */
  total: number;
  /** Cards due at or before now. */
  dueNow: number;
  /** Cards whose last review happened today (local midnight onwards). */
  reviewedToday: number;
  /** Cards still in the FSRS `New` state (never reviewed). */
  newCards: number;
}

/** Projects a flat Dexie row onto the ts-fsrs `Card` shape (field names match by design). */
function toFsrsCard(card: Flashcard): Card {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    // Stored as a plain 0-3 number; State is the matching numeric enum.
    state: card.state as State,
    last_review: card.last_review,
  };
}

/** Numeric rating (1-4) → ts-fsrs Rating (Again / Hard / Good / Easy). */
const RATING_MAP: Record<1 | 2 | 3 | 4, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

/**
 * Inserts the given fronts/backs as brand-new FSRS cards (createEmptyCard semantics:
 * state New, due immediately, `videoId: ''`). Cards whose `id` already exists as a
 * `cardId` are skipped, as are duplicates within the batch.
 *
 * @returns The number of cards actually added.
 */
export async function addCards(
  cards: Array<{ id: string; topicId: string; front: string; back: string }>,
): Promise<number> {
  if (cards.length === 0) return 0;
  const existingKeys = await db.flashcards
    .where('cardId')
    .anyOf(cards.map((c) => c.id))
    .keys();
  const seen = new Set<string>(existingKeys as string[]);
  const fresh: Flashcard[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    fresh.push({
      ...createEmptyCard(new Date()),
      cardId: card.id,
      videoId: '',
      topicId: card.topicId,
      front: card.front,
      back: card.back,
    });
  }
  if (fresh.length > 0) {
    await db.flashcards.bulkAdd(fresh);
  }
  return fresh.length;
}

/**
 * Converts a wrongly-answered quiz question into a review flashcard (cardId
 * `wrong-${question.id}`; skipped if it already exists). For MCQs the options are
 * included inline on the front and the answer index is resolved to the option text
 * on the back; the back always carries the correct answer plus the explanation.
 */
export async function wrongAnswerToCard(question: QuizQuestion, topicId: string): Promise<void> {
  const cardId = `wrong-${question.id}`;
  const exists = await db.flashcards.where('cardId').equals(cardId).count();
  if (exists > 0) return;

  let front = question.stem;
  let answerText = question.answer;
  if (question.type === 'mcq' && question.options && question.options.length > 0) {
    front = [question.stem, ...question.options.map((opt, i) => `${i + 1}. ${opt}`)].join('\n');
    const idx = Number.parseInt(question.answer, 10);
    const option = Number.isNaN(idx) ? undefined : question.options[idx];
    if (option !== undefined) {
      answerText = `${idx + 1}. ${option}`;
    }
  }
  const back = `Answer: ${answerText}\n\n${question.explanation}`;

  await db.flashcards.add({
    ...createEmptyCard(new Date()),
    cardId,
    videoId: '',
    topicId,
    front,
    back,
  });
}

/**
 * Returns cards due at or before now, ordered by due date ascending (the `due`
 * index traversal order), capped at `limit`.
 */
export async function getDueCards(limit = 50): Promise<Flashcard[]> {
  return db.flashcards.where('due').belowOrEqual(new Date()).limit(limit).toArray();
}

/** Counts cards due at or before now. */
export async function countDue(): Promise<number> {
  return db.flashcards.where('due').belowOrEqual(new Date()).count();
}

/**
 * Rates a card (1=Again, 2=Hard, 3=Good, 4=Easy), runs the FSRS scheduler at the
 * current timestamp, persists the updated scheduling fields and returns the
 * updated card. The card must be a persisted `flashcards` row (have an `id`).
 */
export async function rateCard(card: Flashcard, rating: 1 | 2 | 3 | 4): Promise<Flashcard> {
  const now = new Date();
  const recordLog = scheduler.repeat(toFsrsCard(card), now);
  const next = recordLog[RATING_MAP[rating]].card;
  const updated: Flashcard = {
    ...card,
    due: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    elapsed_days: next.elapsed_days,
    scheduled_days: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    last_review: next.last_review,
  };
  await db.flashcards.put(updated);
  return updated;
}

/**
 * Deck statistics: total cards, cards due now, cards reviewed since local midnight
 * (by `last_review`), and cards still in the New state.
 */
export async function getStats(): Promise<SrsStats> {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [total, dueNow, newCards, reviewedToday] = await Promise.all([
    db.flashcards.count(),
    db.flashcards.where('due').belowOrEqual(now).count(),
    db.flashcards.where('state').equals(State.New).count(),
    // last_review is not indexed — a filter scan is the honest option here.
    db.flashcards
      .filter((c) => c.last_review !== undefined && c.last_review.getTime() >= midnight)
      .count(),
  ]);
  return { total, dueNow, reviewedToday, newCards };
}
