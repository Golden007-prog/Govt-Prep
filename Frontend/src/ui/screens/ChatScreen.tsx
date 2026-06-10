import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExamTaxonomy, LanguageCode } from '../../lib/types/exam';
import { claudeStream, AnthropicError } from '../../lib/api/anthropicClient';
import type { ClaudeMessage } from '../../lib/api/anthropicClient';
import { MODELS } from '../../lib/config/models';
import { getTopic, topicsForSubject } from '../../lib/taxonomy/registry';
import { Markdown } from '../components/Markdown';

/**
 * AI doubt-solver chat (feature #7): streaming, topic-aware Q&A on MODELS.grading.
 * History is session-scoped (component state only); the request payload is capped
 * at the last 12 visible messages. An AbortController cancels the in-flight stream
 * on unmount, on Stop, and defensively on a new send.
 */

export interface ChatScreenProps {
  exam: ExamTaxonomy;
  language: LanguageCode;
}

/** Friendly error text per the app-wide AI error rules. */
function describeError(err: unknown): string {
  if (err instanceof AnthropicError) {
    if (err.status === 0 && err.message.includes('No Anthropic API key')) {
      return `${err.message} Open the Setup screen (Configure AI keys) to add one.`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong — please try again.';
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin"
      aria-hidden="true"
    />
  );
}

export function ChatScreen({ exam, language }: ChatScreenProps) {
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [input, setInput] = useState('');
  const [topicId, setTopicId] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cancel any in-flight stream when the screen unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Pin the message list to the bottom as content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const langName = language === 'hi' ? 'Hindi' : 'English';

  const subjectGroups = useMemo(
    () =>
      exam.subjects
        .map((subject) => ({ subject, topics: topicsForSubject(exam, subject.id) }))
        .filter((g) => g.topics.length > 0),
    [exam],
  );

  const system = useMemo(() => {
    const topic = topicId ? getTopic(exam, topicId) : null;
    const parts = [
      `You are an expert exam coach for the ${exam.name} (${exam.shortName}), conducted by ${exam.body}.`,
      'You are solving a student\'s doubts: explain concepts step by step, correct misconceptions, and stay focused on what this exam actually tests.',
      topic ? `The student is currently studying the topic "${topic.name}". Syllabus scope: ${topic.syllabusText}` : '',
      `Answer at exam depth, in ${langName}. Use markdown (short headings, bullet points, code blocks where useful) and keep answers complete but tight.`,
    ];
    return parts.filter(Boolean).join('\n');
  }, [exam, topicId, langName]);

  const send = async () => {
    const text = input.trim();
    if (text === '' || streaming) return;

    // Defensive: never leave a previous stream running.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    const history: ClaudeMessage[] = [...messages, { role: 'user', content: text }];
    // Payload = non-empty visible history, capped at the last 12, starting on a user turn.
    let payload = history.filter((m) => m.content.trim() !== '').slice(-12);
    while (payload.length > 0 && payload[0].role !== 'user') payload = payload.slice(1);

    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    try {
      const { stopReason } = await claudeStream(
        {
          model: MODELS.grading,
          system,
          messages: payload,
          maxTokens: 3000,
          signal: controller.signal,
        },
        (delta) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
          });
        },
      );
      if (stopReason === 'max_tokens') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + '\n\n> *Answer was cut off by the length limit — ask me to continue.*' },
          ];
        });
      }
    } catch (err) {
      // Drop the placeholder bubble if nothing streamed into it (partial answers are kept).
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === 'assistant' && last.content === '' ? prev.slice(0, -1) : prev;
      });
      if (!controller.signal.aborted) setError(describeError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header + topic context */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <span className="text-xs font-semibold tracking-widest text-cyan-400 uppercase">AI doubt solver</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-display mt-1">
            Ask Claude
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Topic-aware answers at {exam.shortName} exam depth, in {langName}.
          </p>
        </div>
        <label className="block sm:w-72 shrink-0">
          <span className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            Topic context (optional)
          </span>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
          >
            <option value="">General — no specific topic</option>
            {subjectGroups.map(({ subject, topics }) => (
              <optgroup key={subject.id} label={subject.name}>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {/* Chat panel */}
      <div className="glass-panel flex flex-col h-[65vh] min-h-[420px]">
        <div ref={scrollRef} className="flex-grow overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-sm text-slate-300 font-semibold">Stuck on something?</p>
              <p className="text-xs text-slate-500 mt-1.5 max-w-sm">
                Ask any doubt about {exam.shortName} — a concept, a tricky question, a shortcut. Pick a topic above to
                ground the answer in its syllabus.
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            if (m.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-cyan-500/10 border border-cyan-500/20 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-slate-100 whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[90%] bg-slate-900/60 border border-white/5 rounded-2xl rounded-bl-sm px-4 py-3">
                  {m.content === '' && streaming && isLast ? (
                    <div className="flex items-center gap-2.5 text-sm text-slate-400">
                      <Spinner />
                      Claude is thinking — long answers can take up to a minute…
                    </div>
                  ) : (
                    <Markdown text={m.content} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mx-4 sm:mx-6 mb-3 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
            ⚠️ {error}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-white/5 p-3 sm:p-4">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={`Ask a ${exam.shortName} doubt…`}
              className="flex-grow resize-none bg-slate-900 border border-slate-700/50 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="shrink-0 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors text-sm font-semibold px-4 py-2.5"
              >
                ⏹ Stop
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={input.trim() === ''}
                className="btn-primary shrink-0 text-sm px-4 py-2.5"
              >
                Send
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            Enter to send · Shift+Enter for a new line{streaming && ' · streaming…'}
          </p>
        </div>
      </div>
    </div>
  );
}
