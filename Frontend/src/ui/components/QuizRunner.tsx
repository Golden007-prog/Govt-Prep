import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { QuizQuestion } from '../../lib/types/content';
import type { LanguageCode } from '../../lib/types/exam';
import type { AchievementDef, XpAction } from '../../lib/types/progress';
import { getBrain } from '../../lib/brain/anthropicBrain';
import { AnthropicError } from '../../lib/api/anthropicClient';
import { wrongAnswerToCard } from '../../lib/srs/srsService';
import { recordActivity, updateMastery } from '../../lib/progress/progressService';
import { useHotkeys } from '../../lib/hooks/useHotkeys';

/**
 * QuizRunner — the reusable one-question-at-a-time quiz engine (topic quizzes,
 * smart revision mix, CA quizzes). MCQs grade locally and instantly; short
 * answers grade via the Claude Brain (with a self-assessment fallback when the
 * AI call fails). Wrong answers become FSRS flashcards when `topicId` is set.
 */

export interface QuizRunnerResult {
  correct: number;
  total: number;
  scoreRatio: number;
}

export interface QuizRunnerProps {
  title?: string;
  questions: QuizQuestion[];
  language: LanguageCode;
  /** When set: wrong answers -> wrongAnswerToCard(question, topicId). */
  topicId?: string;
  /** When set with topicId: updateMastery(...) runs at the end. */
  subjectId?: string;
  topicName?: string;
  /** Default true: 'short' questions are graded via getBrain().grade. */
  gradeShortAnswers?: boolean;
  /** XP action recorded per correct answer at quiz end. Defaults to 'quizQuestionCorrect'. */
  correctXpAction?: XpAction;
  /** XP action recorded once at quiz end; null = none. Defaults to 'quizCompleted'. */
  xpOnComplete?: XpAction | null;
  onComplete?: (result: QuizRunnerResult) => void;
}

interface AnswerRecord {
  userAnswer: string;
  correct: boolean;
  /** 0..1 (partial credit for AI-graded short answers). */
  score: number;
  feedback: string | null;
  selfAssessed: boolean;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function errorMessage(err: unknown): string {
  if (err instanceof AnthropicError) {
    return err.status === 0 && err.message.includes('No Anthropic API key')
      ? `${err.message} Open Settings / Setup to add your Anthropic key.`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong — please retry.';
}

/** Correct option index for an MCQ (answer is the index as a string; falls back to option-text match). */
function mcqCorrectIndex(q: QuizQuestion): number {
  // Cached bundles may carry a non-string (or missing) answer — never crash the render.
  const answer = typeof q.answer === 'string' ? q.answer : String(q.answer ?? '');
  const idx = Number.parseInt(answer, 10);
  // Trust the parsed value only when it's a valid index; otherwise fall through to the
  // text match so numeric option text (years, '4' as 1-based) still resolves correctly.
  if (!Number.isNaN(idx) && q.options && idx >= 0 && idx < q.options.length) return idx;
  const byText = q.options?.findIndex((o) => o.trim() === answer.trim());
  return byText ?? -1;
}

function Spinner() {
  return (
    <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full shrink-0" />
  );
}

export function QuizRunner(props: QuizRunnerProps): ReactElement | null {
  const {
    title,
    questions,
    language,
    topicId,
    subjectId,
    topicName,
    gradeShortAnswers = true,
    correctXpAction = 'quizQuestionCorrect',
    xpOnComplete = 'quizCompleted',
    onComplete,
  } = props;

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  // Short-answer state for the current question.
  const [draft, setDraft] = useState('');
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [selfAssess, setSelfAssess] = useState(false);
  // End-of-quiz state.
  const [result, setResult] = useState<QuizRunnerResult | null>(null);
  const [unlocked, setUnlocked] = useState<AchievementDef[]>([]);
  const finishedRef = useRef(false);

  const total = questions.length;
  const current: QuizQuestion | undefined = questions[index];
  const answeredCurrent = answers.length > index;
  const currentRecord = answeredCurrent ? answers[index] : null;
  const correctSoFar = answers.filter((a) => a.correct).length;

  const commitAnswer = (question: QuizQuestion, record: AnswerRecord) => {
    setAnswers((prev) => (prev.length > index ? prev : [...prev, record]));
    setSelfAssess(false);
    setGradeError(null);
    if (record.score < 0.7 && topicId) {
      // Fire-and-forget: a failed card write must never block the quiz.
      void wrongAnswerToCard(question, topicId).catch(() => {});
    }
  };

  const selectOption = (i: number) => {
    if (!current || current.type !== 'mcq' || answeredCurrent || result || grading) return;
    if (!current.options || i >= current.options.length) return;
    const correct = i === mcqCorrectIndex(current);
    commitAnswer(current, {
      userAnswer: String(i),
      correct,
      score: correct ? 1 : 0,
      feedback: null,
      selfAssessed: false,
    });
  };

  const submitShort = async () => {
    if (!current || answeredCurrent || grading || result) return;
    const answerText = draft.trim();
    if (!answerText) return;
    if (!gradeShortAnswers) {
      setSelfAssess(true);
      return;
    }
    setGrading(true);
    setGradeError(null);
    try {
      const g = await getBrain().grade(current, answerText, {
        language,
        topicId: topicId ?? '',
        topicName: topicName ?? '',
        syllabusText: '',
      });
      commitAnswer(current, {
        userAnswer: answerText,
        correct: g.correct,
        score: g.score,
        feedback: g.feedback,
        selfAssessed: false,
      });
    } catch (err) {
      // AI grading failed — fall back to honest self-assessment.
      setGradeError(errorMessage(err));
      setSelfAssess(true);
    } finally {
      setGrading(false);
    }
  };

  const selfAssessAnswer = (wasRight: boolean) => {
    if (!current || answeredCurrent || result) return;
    commitAnswer(current, {
      userAnswer: draft.trim(),
      correct: wasRight,
      score: wasRight ? 1 : 0,
      feedback: null,
      selfAssessed: true,
    });
  };

  const finishQuiz = async (finalAnswers: AnswerRecord[]) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const correct = finalAnswers.filter((a) => a.correct).length;
    const res: QuizRunnerResult = {
      correct,
      total,
      scoreRatio: total > 0 ? correct / total : 0,
    };
    setResult(res);
    try {
      const fresh: AchievementDef[] = [];
      const push = (defs: AchievementDef[]) => {
        for (const d of defs) if (!fresh.some((f) => f.id === d.id)) fresh.push(d);
      };
      if (correct > 0) {
        push((await recordActivity(correctXpAction, { count: correct })).newAchievements);
      }
      if (xpOnComplete) {
        push((await recordActivity(xpOnComplete, { topicId })).newAchievements);
      }
      if (topicId && subjectId) {
        await updateMastery(topicId, subjectId, topicName ?? topicId, res.scoreRatio);
      }
      if (fresh.length > 0) setUnlocked(fresh);
    } catch {
      // Progress bookkeeping is best-effort; the score itself is already shown.
    }
    onComplete?.(res);
  };

  const goNext = () => {
    if (!answeredCurrent || result) return;
    if (index + 1 >= total) {
      void finishQuiz(answers);
    } else {
      setIndex(index + 1);
      setDraft('');
      setSelfAssess(false);
      setGradeError(null);
    }
  };

  useHotkeys({
    '1': () => selectOption(0),
    '2': () => selectOption(1),
    '3': () => selectOption(2),
    '4': () => selectOption(3),
    Enter: () => goNext(),
  });

  if (total === 0) return null;

  /* ------------------------------- End screen ------------------------------ */
  if (result) {
    const pct = Math.round(result.scoreRatio * 100);
    const C = 2 * Math.PI * 45;
    const ringColor =
      pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-rose-400';
    return (
      <div className="glass-panel p-6 sm:p-8 space-y-6 !rounded-3xl bg-gradient-to-br from-cyan-950/30 via-darkCard/40 to-indigo-950/30">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-32 h-32 shrink-0">
            <svg viewBox="0 0 100 100" className="w-32 h-32 -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" strokeWidth="8" className="stroke-slate-800" />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                stroke="currentColor"
                className={`${ringColor} drop-shadow-[0_0_6px_currentColor]`}
                strokeDasharray={`${(result.scoreRatio * C).toFixed(2)} ${C.toFixed(2)}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-extrabold text-white font-display font-mono">{pct}%</span>
            </div>
          </div>
          <div className="text-center sm:text-left">
            <span className="eyebrow">🎉 Quiz Complete</span>
            <h3 className="text-xl font-bold text-white font-display mt-1">{title ?? 'Quiz'}</h3>
            <p className="text-sm text-slate-300 mt-1">
              You got <span className="font-semibold text-cyan-300">{result.correct}</span> of{' '}
              <span className="font-semibold text-white">{result.total}</span> questions right.
            </p>
            {topicId && result.correct < result.total && (
              <p className="text-[11px] text-slate-500 mt-2">
                Wrong answers were added to your flashcard deck for spaced review. 🃏
              </p>
            )}
          </div>
        </div>

        {unlocked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unlocked.map((a) => (
              <span
                key={a.id}
                className="chip text-amber-300 bg-amber-500/10 border-amber-500/25 shadow-[0_0_14px_rgba(245,158,11,0.15)]"
              >
                <span>{a.icon}</span> Unlocked: {a.title}
              </span>
            ))}
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Review
          </h4>
          <ol className="space-y-2">
            {questions.map((q, i) => {
              const rec = answers[i];
              if (!rec) return null;
              const correctIdx = q.type === 'mcq' ? mcqCorrectIndex(q) : -1;
              const yourAnswer =
                q.type === 'mcq'
                  ? q.options?.[Number.parseInt(rec.userAnswer, 10)] ?? rec.userAnswer
                  : rec.userAnswer;
              return (
                <li
                  key={q.id}
                  className={`p-3 rounded-xl border ${
                    rec.correct
                      ? 'bg-emerald-500/5 border-emerald-500/15'
                      : 'bg-rose-500/5 border-rose-500/15'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-sm shrink-0">{rec.correct ? '✅' : '❌'}</span>
                    <div className="min-w-0 flex-grow">
                      <p className="text-sm text-slate-200">
                        <span className="text-slate-500 font-mono text-xs mr-1.5">Q{i + 1}</span>
                        {q.stem}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        Your answer: <span className="text-slate-300">{yourAnswer || '—'}</span>
                      </p>
                      {!rec.correct && (
                        <p className="text-[11px] text-emerald-300/90 mt-0.5">
                          Correct:{' '}
                          {q.type === 'mcq' && correctIdx >= 0
                            ? q.options?.[correctIdx]
                            : q.answer}
                        </p>
                      )}
                      {q.type === 'short' && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Score: {Math.round(rec.score * 100)}%
                          {rec.selfAssessed ? ' (self-assessed)' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    );
  }

  /* ------------------------------ Question view ---------------------------- */
  if (!current) return null;
  const correctIdx = current.type === 'mcq' ? mcqCorrectIndex(current) : -1;
  const selectedIdx =
    currentRecord && current.type === 'mcq' ? Number.parseInt(currentRecord.userAnswer, 10) : -1;

  return (
    <div className="glass-panel p-6 space-y-5">
      {/* Header: title + progress + running score */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-bold text-white font-display">{title ?? 'Topic Quiz'}</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">
            Q {index + 1}/{total}
          </span>
          <span className="chip text-emerald-300 bg-emerald-500/10 border-emerald-500/25 font-mono">
            {correctSoFar} correct
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 shadow-[0_0_8px_rgba(6,182,212,0.5)] transition-all duration-300"
          style={{ width: `${(answers.length / total) * 100}%` }}
        />
      </div>

      {/* Stem */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm sm:text-base text-slate-100 leading-relaxed">{current.stem}</p>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
              current.origin === 'pyq'
                ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
                : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
            }`}
          >
            {current.origin === 'pyq' ? 'PYQ' : 'AI'}
          </span>
        </div>
      </div>

      {/* MCQ options */}
      {current.type === 'mcq' && current.options && (
        <div className="space-y-2">
          {current.options.map((opt, i) => {
            let cls =
              'bg-slate-900/40 border-white/5 hover:border-cyan-500/40 hover:bg-slate-900/70 hover:shadow-[0_0_18px_rgba(6,182,212,0.12)]';
            if (answeredCurrent) {
              if (i === correctIdx)
                cls = 'bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_18px_rgba(16,185,129,0.25)]';
              else if (i === selectedIdx)
                cls = 'bg-rose-500/10 border-rose-500/50 shadow-[0_0_18px_rgba(244,63,94,0.25)]';
              else cls = 'bg-slate-900/30 border-white/5 opacity-60';
            }
            return (
              <button
                key={i}
                onClick={() => selectOption(i)}
                disabled={answeredCurrent}
                className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 flex items-center gap-3 disabled:cursor-default ${cls}`}
              >
                <span className="glass-tile w-6 h-6 shrink-0 !rounded-md text-[11px] font-mono text-slate-300">
                  {LETTERS[i] ?? i + 1}
                </span>
                <span className="text-sm text-slate-200">{opt}</span>
                {answeredCurrent && i === correctIdx && <span className="ml-auto text-sm">✅</span>}
                {answeredCurrent && i === selectedIdx && i !== correctIdx && (
                  <span className="ml-auto text-sm">❌</span>
                )}
              </button>
            );
          })}
          {!answeredCurrent && (
            <p className="text-[10px] text-slate-500 pt-1">
              Press <span className="font-mono text-slate-400">1-4</span> to answer
            </p>
          )}
        </div>
      )}

      {/* Short answer */}
      {current.type === 'short' && !answeredCurrent && (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={grading || selfAssess}
            rows={4}
            placeholder="Write your answer in 1-3 sentences…"
            className="input-glass text-sm resize-y"
          />
          {!selfAssess && (
            <button
              onClick={() => void submitShort()}
              disabled={grading || draft.trim().length === 0}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {grading && <Spinner />}
              {grading ? 'Claude is grading… (~20s)' : 'Submit answer'}
            </button>
          )}

          {gradeError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              ⚠️ AI grading failed: {gradeError}
            </div>
          )}

          {selfAssess && (
            <div className="glass-inset p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Self-assessment — compare with the reference answer
              </p>
              <p className="text-sm text-slate-200">{current.answer}</p>
              <p className="text-xs text-slate-400">{current.explanation}</p>
              <div className="flex gap-3">
                <button onClick={() => selfAssessAnswer(true)} className="btn-success text-sm">
                  I was right
                </button>
                <button onClick={() => selfAssessAnswer(false)} className="btn-secondary text-sm">
                  I was wrong
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Post-answer explanation + Next */}
      {answeredCurrent && currentRecord && (
        <div className="space-y-4">
          <div
            className={`p-4 rounded-xl border ${
              currentRecord.correct
                ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                : 'bg-rose-500/10 border-rose-500/30 shadow-[0_0_20px_rgba(244,63,94,0.15)]'
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                currentRecord.correct ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {currentRecord.correct ? '✅ Correct!' : '❌ Incorrect'}
              {current.type === 'short' && !currentRecord.selfAssessed && (
                <span className="ml-2 text-[11px] font-mono font-normal text-slate-400">
                  score {Math.round(currentRecord.score * 100)}%
                </span>
              )}
            </p>
            {currentRecord.feedback && (
              <p className="text-xs text-slate-300 mt-2">{currentRecord.feedback}</p>
            )}
            {current.type === 'short' && (
              <p className="text-xs text-slate-300 mt-2">
                <span className="font-semibold text-slate-200">Reference answer:</span>{' '}
                {current.answer}
              </p>
            )}
            <p className="text-xs text-slate-400 mt-2">{current.explanation}</p>
          </div>
          <div className="flex items-center justify-end gap-3">
            <span className="text-[10px] text-slate-500 font-mono">Enter ↵</span>
            <button onClick={goNext} className="btn-primary text-sm">
              {index + 1 >= total ? 'Finish quiz' : 'Next question'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
