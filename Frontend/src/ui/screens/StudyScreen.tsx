import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExamSubject, ExamTaxonomy, ExamTopic, LanguageCode, TopicImportance } from '../../lib/types/exam';
import type { UserProfile } from '../../lib/types/user';
import type { QuizQuestion } from '../../lib/types/content';
import type { StudyBundle } from '../../lib/brain/types';
import {
  buildRevisionMix,
  getHomework,
  getMnemonics,
  getStudyBundle,
  hasCachedBundle,
} from '../../lib/content/contentService';
import { lectureLinks } from '../../lib/content/lectureLinks';
import { addCards } from '../../lib/srs/srsService';
import { recordActivity } from '../../lib/progress/progressService';
import { getSubject, getTopic, topicsForSubject } from '../../lib/taxonomy/registry';
import { db } from '../../lib/store/db';
import { AnthropicError } from '../../lib/api/anthropicClient';
import { Markdown } from '../components/Markdown';
import { QuizRunner } from '../components/QuizRunner';

/**
 * StudyScreen — the topic-centric study workspace (M2 core loop):
 * pick a topic → lectures / AI notes / quiz / homework / mnemonics, plus a
 * "Smart revision" mix built from the weakest already-studied topics.
 */

export interface StudyScreenProps {
  exam: ExamTaxonomy;
  profile: UserProfile;
  initialTopicId: string | null;
}

type TabId = 'lectures' | 'notes' | 'quiz' | 'homework' | 'mnemonics';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'lectures', label: 'Lectures', icon: '📺' },
  { id: 'notes', label: 'Notes', icon: '📖' },
  { id: 'quiz', label: 'Quiz', icon: '📝' },
  { id: 'homework', label: 'Homework', icon: '📚' },
  { id: 'mnemonics', label: 'Mnemonics', icon: '🧠' },
];

const IMPORTANCE_META: Record<TopicImportance, { label: string; cls: string }> = {
  high: { label: 'High yield', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  medium: { label: 'Medium', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20' },
  low: { label: 'Low', cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20' },
};

/** Mastery below this marks a topic "weak" for the smart revision mix. */
const WEAK_MASTERY_BELOW = 60;

function errorMessage(err: unknown): string {
  if (err instanceof AnthropicError) {
    return err.status === 0 && err.message.includes('No Anthropic API key')
      ? `${err.message} Open Settings / Setup to add your Anthropic key.`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong — please retry.';
}

function Spinner() {
  return (
    <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full shrink-0" />
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
      ⚠️ {message}
    </div>
  );
}

export function StudyScreen({ exam, profile, initialTopicId }: StudyScreenProps) {
  const language = profile.languagePref;
  const navigate = useNavigate();

  // The URL is the source of truth for the selected topic: deriving from the
  // validated route param (instead of capturing it once in state) keeps
  // back/forward and pasted /study/<id> links in sync while the screen stays
  // mounted; invalid or absent params fall back to the first topic.
  const topicId =
    initialTopicId && exam.topics.some((t) => t.id === initialTopicId)
      ? initialTopicId
      : (exam.topics[0]?.id ?? null);
  const topic = topicId ? getTopic(exam, topicId) : null;
  const subject = topic ? getSubject(exam, topic.subjectId) : null;

  // Smart revision mix (feature #9): weakest topics with locally cached bundles.
  const [revisionMix, setRevisionMix] = useState<QuizQuestion[] | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await db.topics.toArray();
      const examTopicIds = new Set(exam.topics.map((t) => t.id));
      const weakIds = rows
        .filter((r) => examTopicIds.has(r.id) && r.mastery < WEAK_MASTERY_BELOW)
        .map((r) => r.id);
      const mix = weakIds.length > 0 ? await buildRevisionMix(exam, weakIds, language) : [];
      if (!cancelled) setRevisionMix(mix);
    })().catch(() => {
      if (!cancelled) setRevisionMix([]);
    });
    return () => {
      cancelled = true;
    };
  }, [exam, language]);

  if (!topic) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-sm text-slate-400">This exam has no topics configured yet.</p>
      </div>
    );
  }
  const importance = IMPORTANCE_META[topic.importance];

  return (
    <div className="space-y-6">
      {/* Topic picker */}
      <div className="glass-panel p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-5">
          <div className="lg:w-80 shrink-0 space-y-2">
            <label
              htmlFor="study-topic-picker"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
            >
              Study topic
            </label>
            <select
              id="study-topic-picker"
              value={topicId ?? ''}
              onChange={(e) => navigate(`/study/${e.target.value}`, { replace: true })}
              className="w-full bg-slate-900 border border-slate-700/50 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
            >
              {exam.subjects.map((s) => (
                <optgroup key={s.id} label={s.name}>
                  {topicsForSubject(exam, s.id).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {subject && <p className="text-[11px] text-slate-500">{subject.name}</p>}
          </div>
          <div className="flex-grow min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-white font-display">{topic.name}</h2>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${importance.cls}`}>
                {importance.label}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{topic.syllabusText}</p>
          </div>
        </div>
      </div>

      {/* Smart revision banner */}
      {revisionMix && revisionMix.length > 0 && !revisionOpen && (
        <div className="glass-panel p-5 bg-gradient-to-r from-indigo-950/40 via-darkCard/50 to-cyan-950/30 border-indigo-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔁</span>
              <div>
                <h3 className="text-sm font-bold text-white font-display">Smart revision</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {revisionMix.length} questions mixed from your weakest topics (mastery &lt;{' '}
                  {WEAK_MASTERY_BELOW}%).
                </p>
              </div>
            </div>
            <button onClick={() => setRevisionOpen(true)} className="btn-secondary text-sm shrink-0">
              Start mixed revision quiz
            </button>
          </div>
        </div>
      )}
      {revisionMix && revisionMix.length > 0 && revisionOpen && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-300 font-display">🔁 Smart Revision Mix</h3>
            <button
              onClick={() => setRevisionOpen(false)}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              ✕ Close
            </button>
          </div>
          {/* No topicId: revision-mix wrong answers don't create duplicate cards. */}
          <QuizRunner title="Smart Revision Mix" questions={revisionMix} language={language} />
        </div>
      )}

      {/* Topic workspace — keyed so all per-topic state resets on topic change. */}
      <TopicWorkspace key={topic.id} exam={exam} topic={topic} subject={subject} language={language} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface TopicWorkspaceProps {
  exam: ExamTaxonomy;
  topic: ExamTopic;
  subject: ExamSubject | null;
  language: LanguageCode;
}

function TopicWorkspace({ exam, topic, subject, language }: TopicWorkspaceProps) {
  const [tab, setTab] = useState<TabId>('notes');

  // Study bundle (notes + quiz + cards) — cache-first, generated at most once.
  const [bundle, setBundle] = useState<StudyBundle | null>(null);
  const [cacheState, setCacheState] = useState<'checking' | 'none' | 'ready'>('checking');
  const [generating, setGenerating] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [cardsAdded, setCardsAdded] = useState<number | null>(null);

  const [homework, setHomework] = useState<string | null>(null);
  const [homeworkLoading, setHomeworkLoading] = useState(false);
  const [homeworkError, setHomeworkError] = useState<string | null>(null);

  const [mnemonics, setMnemonics] = useState<string[] | null>(null);
  const [mnemonicsLoading, setMnemonicsLoading] = useState(false);
  const [mnemonicsError, setMnemonicsError] = useState<string | null>(null);

  const links = useMemo(() => lectureLinks(topic.name, subject?.name), [topic, subject]);

  // On mount: load the bundle if (and only if) it's already cached locally — no AI call.
  useEffect(() => {
    let cancelled = false;
    hasCachedBundle(exam, topic.id, language)
      .then(async (cached) => {
        if (cancelled) return;
        if (!cached) {
          setCacheState('none');
          return;
        }
        const b = await getStudyBundle(exam, topic, language); // cache hit
        if (cancelled) return;
        setBundle(b);
        setCacheState('ready');
      })
      .catch(() => {
        if (!cancelled) setCacheState('none');
      });
    return () => {
      cancelled = true;
    };
  }, [exam, topic, language]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setBundleError(null);
    try {
      const b = await getStudyBundle(exam, topic, language);
      const added = await addCards(b.cards);
      setBundle(b);
      setCardsAdded(added);
      setCacheState('ready');
      void recordActivity('notesGenerated', { topicId: topic.id }).catch(() => {});
    } catch (err) {
      setBundleError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleHomework = async () => {
    if (!bundle || homeworkLoading) return;
    setHomeworkLoading(true);
    setHomeworkError(null);
    try {
      const md = await getHomework(exam, topic, bundle.notes, language);
      setHomework(md);
      void recordActivity('homeworkGenerated', { topicId: topic.id }).catch(() => {});
    } catch (err) {
      setHomeworkError(errorMessage(err));
    } finally {
      setHomeworkLoading(false);
    }
  };

  const handleMnemonics = async () => {
    if (mnemonicsLoading) return;
    setMnemonicsLoading(true);
    setMnemonicsError(null);
    try {
      setMnemonics(await getMnemonics(exam, topic, language));
    } catch (err) {
      setMnemonicsError(errorMessage(err));
    } finally {
      setMnemonicsLoading(false);
    }
  };

  /** Generate-prompt panel shared by the notes/quiz/homework tabs. */
  const generatePrompt = (lead: string) => (
    <div className="text-center py-10 px-4 space-y-4">
      <div className="text-4xl">✨</div>
      <p className="text-sm text-slate-300 max-w-md mx-auto">{lead}</p>
      <p className="text-[11px] text-slate-500">~30s, one-time — cached forever for this topic.</p>
      {bundleError && (
        <div className="max-w-md mx-auto">
          <ErrorNote message={bundleError} />
        </div>
      )}
      <button
        onClick={() => void handleGenerate()}
        disabled={generating}
        className="btn-primary text-sm inline-flex items-center gap-2"
      >
        {generating && <Spinner />}
        {generating ? 'Claude is writing your study unit…' : 'Generate notes + quiz + flashcards'}
      </button>
    </div>
  );

  return (
    <div className="glass-panel">
      {/* Tabs */}
      <div className="flex gap-1 p-2 border-b border-white/5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        {/* 📺 Lectures */}
        {tab === 'lectures' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Curated YouTube searches across whitelisted educator channels — opens in a new tab.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {links.map((l) => (
                <a
                  key={l.channel}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass-panel-interactive p-4 flex items-center gap-3"
                >
                  <span className="text-xl">📺</span>
                  <div className="min-w-0 flex-grow">
                    <p className="text-sm font-semibold text-slate-200 truncate">{l.channel}</p>
                    <p className="text-[11px] text-slate-500 truncate">{topic.name} lectures</p>
                  </div>
                  <span className="text-slate-500 text-xs shrink-0">↗</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 📖 Notes */}
        {tab === 'notes' && (
          <div>
            {cacheState === 'checking' && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
                <Spinner /> Checking local cache…
              </div>
            )}
            {cacheState === 'none' &&
              generatePrompt(
                `No notes for “${topic.name}” yet. Claude will write exam-depth notes, a 10-question quiz and 5 flashcards in one go.`,
              )}
            {cacheState === 'ready' && bundle && (
              <div className="space-y-6">
                {cardsAdded !== null && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                    🃏 Added {cardsAdded} flashcard{cardsAdded === 1 ? '' : 's'} to your spaced-repetition deck.
                  </div>
                )}
                <Markdown text={bundle.notes.summaryMarkdown} />
                {bundle.notes.keyPoints.length > 0 && (
                  <div className="p-5 rounded-xl bg-slate-900/40 border border-white/5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-3">
                      ✅ Key points checklist
                    </h4>
                    <ul className="space-y-2">
                      {bundle.notes.keyPoints.map((kp, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                          <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                          <span>{kp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 📝 Quiz */}
        {tab === 'quiz' && (
          <div>
            {cacheState === 'checking' && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
                <Spinner /> Checking local cache…
              </div>
            )}
            {cacheState === 'none' &&
              generatePrompt('The quiz ships with the study bundle — generate it first.')}
            {cacheState === 'ready' && bundle && (
              <QuizRunner
                title={`Quiz — ${topic.name}`}
                questions={bundle.quiz.questions}
                language={language}
                topicId={topic.id}
                subjectId={topic.subjectId}
                topicName={topic.name}
              />
            )}
          </div>
        )}

        {/* 📚 Homework */}
        {tab === 'homework' && (
          <div>
            {cacheState === 'checking' && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
                <Spinner /> Checking local cache…
              </div>
            )}
            {cacheState === 'none' &&
              generatePrompt('Homework is built from the topic notes — generate the study bundle first.')}
            {cacheState === 'ready' && bundle && homework === null && (
              <div className="text-center py-10 px-4 space-y-4">
                <div className="text-4xl">📚</div>
                <p className="text-sm text-slate-300 max-w-md mx-auto">
                  5 exam-difficulty practice problems with an answer key, tailored to this topic.
                </p>
                {homeworkError && (
                  <div className="max-w-md mx-auto">
                    <ErrorNote message={homeworkError} />
                  </div>
                )}
                <button
                  onClick={() => void handleHomework()}
                  disabled={homeworkLoading}
                  className="btn-primary text-sm inline-flex items-center gap-2"
                >
                  {homeworkLoading && <Spinner />}
                  {homeworkLoading ? 'Claude is setting your homework…' : 'Generate homework set'}
                </button>
              </div>
            )}
            {homework !== null && <Markdown text={homework} />}
          </div>
        )}

        {/* 🧠 Mnemonics */}
        {tab === 'mnemonics' && (
          <div>
            {mnemonics === null ? (
              <div className="text-center py-10 px-4 space-y-4">
                <div className="text-4xl">🧠</div>
                <p className="text-sm text-slate-300 max-w-md mx-auto">
                  Vivid memory hooks — acronyms, mini-stories and imagery — for the hardest facts of{' '}
                  “{topic.name}”.
                </p>
                {mnemonicsError && (
                  <div className="max-w-md mx-auto">
                    <ErrorNote message={mnemonicsError} />
                  </div>
                )}
                <button
                  onClick={() => void handleMnemonics()}
                  disabled={mnemonicsLoading}
                  className="btn-primary text-sm inline-flex items-center gap-2"
                >
                  {mnemonicsLoading && <Spinner />}
                  {mnemonicsLoading ? 'Claude is inventing mnemonics…' : 'Generate mnemonics'}
                </button>
              </div>
            ) : mnemonics.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">
                No mnemonics came back for this topic — try again later.
              </p>
            ) : (
              <ol className="space-y-3">
                {mnemonics.map((m, i) => (
                  <li
                    key={i}
                    className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/30 to-slate-900/40 border border-indigo-500/15 flex items-start gap-3"
                  >
                    <span className="w-7 h-7 shrink-0 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-xs font-mono text-indigo-300">
                      {i + 1}
                    </span>
                    <p className="text-sm text-slate-200 leading-relaxed">{m}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
