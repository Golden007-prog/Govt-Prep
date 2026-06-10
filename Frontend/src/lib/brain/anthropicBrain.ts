import type { Brain, BrainContext, StudyBundle } from './types';
import type { GradeResult, Notes, QuizQuestion } from '../types/content';
import { claudeJson } from '../api/anthropicClient';
import { MODELS } from '../config/models';

/**
 * The single Brain implementation (Claude-only architecture, v3): direct
 * browser → Anthropic API with the user's BYOK key. Works identically in
 * hosted (github.io) and local modes. One LEAN, BATCHED call per study unit.
 */

const LANGUAGE_NAME: Record<string, string> = { en: 'English', hi: 'Hindi' };

function systemPrompt(ctx: BrainContext): string {
  return [
    'You are GovPrep, an expert coach for Indian government/PSU competitive exams.',
    'You produce rigorous, exam-accurate study material. Facts must be correct;',
    'when uncertain, prefer well-established textbook content over speculation.',
    `Write all user-facing text in ${LANGUAGE_NAME[ctx.language] ?? 'English'}.`,
    'Respond with STRICT JSON only — no markdown fences, no prose outside the JSON.',
  ].join(' ');
}

interface RawBundle {
  notes: { summaryMarkdown: string; keyPoints: string[] };
  quiz: Array<{
    type: 'mcq' | 'short';
    stem: string;
    options?: string[];
    answer: string;
    explanation: string;
  }>;
  cards: Array<{ front: string; back: string }>;
}

export class AnthropicBrain implements Brain {
  readonly id = 'anthropic-browser';

  async makeStudyBundle(transcriptOrSummary: string, ctx: BrainContext): Promise<StudyBundle> {
    const sourceBlock = transcriptOrSummary.trim()
      ? `LECTURE TRANSCRIPT/NOTES (primary source — ground the material in this):\n${transcriptOrSummary.slice(0, 24000)}`
      : 'No transcript available — generate from the official syllabus scope below using standard textbook knowledge.';

    const raw = await claudeJson<RawBundle>({
      model: MODELS.routine,
      system: systemPrompt(ctx),
      maxTokens: 8000,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: `Create a complete study unit for one exam topic in a single response.

TOPIC: ${ctx.topicName}
SYLLABUS SCOPE: ${ctx.syllabusText}
${sourceBlock}

Return JSON exactly in this shape:
{
  "notes": {
    "summaryMarkdown": "600-900 word structured markdown summary with ## sections, covering the full syllabus scope at exam depth",
    "keyPoints": ["8-12 crisp, memorizable key facts/formulas"]
  },
  "quiz": [
    // exactly 10 questions: 7 "mcq" (4 options each, answer = correct option index as a string, e.g. "2")
    // and 3 "short" (answer = model reference answer in 1-3 sentences)
    { "type": "mcq", "stem": "...", "options": ["...","...","...","..."], "answer": "0", "explanation": "why correct + why others wrong" },
    { "type": "short", "stem": "...", "answer": "reference answer", "explanation": "what a full-credit answer covers" }
  ],
  "cards": [
    // exactly 5 flashcards, front = question/cue, back = concise answer
    { "front": "...", "back": "..." }
  ]
}`,
        },
      ],
    });

    const stamp = Date.now().toString(36);
    return {
      notes: {
        topicId: ctx.topicId,
        language: ctx.language,
        summaryMarkdown: raw.notes?.summaryMarkdown ?? '',
        keyPoints: raw.notes?.keyPoints ?? [],
        sources: [],
      } satisfies Notes,
      quiz: {
        topicId: ctx.topicId,
        language: ctx.language,
        questions: (raw.quiz ?? []).map(
          (q, i): QuizQuestion => ({
            id: `${ctx.topicId}-q${i}-${stamp}`,
            type: q.type === 'short' ? 'short' : 'mcq',
            stem: q.stem,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
            sources: [],
            origin: 'ai',
          }),
        ),
      },
      cards: (raw.cards ?? []).map((c, i) => ({
        id: `${ctx.topicId}-c${i}-${stamp}`,
        topicId: ctx.topicId,
        front: c.front,
        back: c.back,
        language: ctx.language,
      })),
    };
  }

  async grade(question: QuizQuestion, userAnswer: string, ctx: BrainContext): Promise<GradeResult> {
    const raw = await claudeJson<{ correct: boolean; score: number; feedback: string }>({
      model: MODELS.grading,
      system: systemPrompt(ctx),
      maxTokens: 600,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `Grade this exam answer strictly but fairly. Partial credit allowed for short answers.

QUESTION: ${question.stem}
REFERENCE ANSWER: ${question.answer}
MARKING NOTES: ${question.explanation}
STUDENT ANSWER: ${userAnswer}

Return JSON: { "correct": boolean (score >= 0.7), "score": number 0..1, "feedback": "2-3 sentence explanation of what was right/missing, addressed to the student" }`,
        },
      ],
    });
    return {
      questionId: question.id,
      correct: !!raw.correct,
      score: Math.max(0, Math.min(1, Number(raw.score) || 0)),
      feedback: raw.feedback ?? '',
    };
  }

  async makeHomework(notes: Notes, ctx: BrainContext): Promise<string> {
    const raw = await claudeJson<{ homeworkMarkdown: string }>({
      model: MODELS.routine,
      system: systemPrompt(ctx),
      maxTokens: 2000,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: `Create one homework set (5 practice problems, exam difficulty, with a brief answer key at the end) for this topic.

TOPIC: ${ctx.topicName}
KEY POINTS: ${notes.keyPoints.join('; ')}

Return JSON: { "homeworkMarkdown": "markdown with ### Problems and ### Answer Key sections" }`,
        },
      ],
    });
    return raw.homeworkMarkdown ?? '';
  }
}

let brain: AnthropicBrain | null = null;

/** Factory — the rest of the app depends only on the Brain interface. */
export function getBrain(): Brain {
  if (!brain) brain = new AnthropicBrain();
  return brain;
}
