import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { listExams } from '../../lib/taxonomy/registry';
import type { ExamTaxonomy, LanguageCode } from '../../lib/types/exam';
import type { UserProfile } from '../../lib/types/user';
import { addDaysISO, daysInclusive, todayISO } from '../../lib/plan/dateUtils';

export interface OnboardingSubmit {
  examId: string;
  examDate: string;
  language: LanguageCode;
}

interface OnboardingScreenProps {
  existingProfile: UserProfile | null;
  onSubmit: (params: OnboardingSubmit) => Promise<void>;
}

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

function verificationBadge(exam: ExamTaxonomy): { label: string; cls: string } {
  switch (exam.meta.verification) {
    case 'verified':
      return { label: 'Verified', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' };
    case 'partial':
      return { label: 'Pattern verified', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25' };
    default:
      return { label: 'Unverified', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' };
  }
}

export function OnboardingScreen({ existingProfile, onSubmit }: OnboardingScreenProps) {
  const exams = useMemo(() => listExams(), []);
  const [step, setStep] = useState<1 | 2>(1);
  const [examId, setExamId] = useState<string>(existingProfile?.targetExamId ?? exams[0]?.id ?? '');
  const [examDate, setExamDate] = useState<string>(existingProfile?.examDate ?? addDaysISO(todayISO(), 60));
  const [language, setLanguage] = useState<LanguageCode>(existingProfile?.languagePref ?? 'en');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedExam = exams.find((e) => e.id === examId) ?? null;
  const minDate = addDaysISO(todayISO(), 1);
  const horizonDays = daysInclusive(todayISO(), examDate);
  const dateValid = examDate >= minDate;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedExam) {
      setError('Please choose an exam.');
      return;
    }
    if (!dateValid) {
      setError('Your exam date must be in the future.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ examId, examDate, language });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate your plan. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto my-8 px-4 sm:px-6">
      <div className="glass-panel !rounded-3xl p-6 sm:p-10 bg-gradient-to-br from-cyan-950/20 via-darkCard/40 to-indigo-950/20">
        <div className="text-center mb-8">
          <span className="eyebrow">
            {existingProfile?.targetExamId ? 'Re-plan' : 'Get started'}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-white font-display mt-2">
            Build your adaptive plan
          </h2>
          <p className="text-sm text-slate-400 mt-2 max-w-lg mx-auto">
            Pick your target exam and date — GovPrep generates a day-by-day plan from that exam's real
            syllabus and pattern, and re-adapts as your weak areas emerge.
          </p>
        </div>

        {/* Stepper */}
        <div className="glass-inset !rounded-full flex justify-between items-center mb-8 p-1.5 max-w-md mx-auto">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`flex-1 py-2 text-xs font-semibold rounded-full border transition-all ${
              step === 1
                ? 'bg-cyan-500/15 text-cyan-200 border-cyan-400/30 shadow-[0_0_16px_rgba(6,182,212,0.2)]'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            1. Choose exam
          </button>
          <button
            type="button"
            onClick={() => selectedExam && setStep(2)}
            disabled={!selectedExam}
            className={`flex-1 py-2 text-xs font-semibold rounded-full border transition-all ${
              step === 2
                ? 'bg-cyan-500/15 text-cyan-200 border-cyan-400/30 shadow-[0_0_16px_rgba(6,182,212,0.2)]'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            2. Date &amp; language
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {exams.map((exam) => {
                const badge = verificationBadge(exam);
                const selected = exam.id === examId;
                const neg = exam.pattern.negativeMarking;
                return (
                  <button
                    type="button"
                    key={exam.id}
                    onClick={() => {
                      setExamId(exam.id);
                      setStep(2);
                    }}
                    className={`text-left glass-panel-interactive p-5 ${
                      selected
                        ? '!border-cyan-400/40 !shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_24px_rgba(6,182,212,0.2),inset_0_1px_0_rgba(255,255,255,0.1)]'
                        : ''
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {exam.category}
                      </span>
                      <span className={`chip uppercase ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white font-display mt-2 leading-tight">
                      {exam.shortName}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">{exam.body}</p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <span className="chip font-mono text-slate-300 bg-slate-800/60 border-white/10">
                        {exam.pattern.totalQuestions} Q
                      </span>
                      <span className="chip font-mono text-slate-300 bg-slate-800/60 border-white/10">
                        {fmtMinutes(exam.pattern.totalDurationMinutes)}
                      </span>
                      <span
                        className={`chip font-mono ${
                          neg === 0
                            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                            : 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                        }`}
                      >
                        {neg === 0 ? 'No negative' : `−${neg}/wrong`}
                      </span>
                      <span className="chip text-slate-300 bg-slate-800/60 border-white/10">
                        {exam.languages.map((l) => l.toUpperCase()).join(' / ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-3">
                      {exam.subjects.length} subjects · {exam.topics.length} topics
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && selectedExam && (
            <div className="max-w-md mx-auto space-y-6">
              <div className="glass-inset p-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Selected exam</p>
                <h3 className="text-xl font-bold text-white font-display mt-1">{selectedExam.shortName}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  {selectedExam.pattern.papers.length} paper(s) · {selectedExam.pattern.totalQuestions} questions ·{' '}
                  {fmtMinutes(selectedExam.pattern.totalDurationMinutes)} ·{' '}
                  {selectedExam.pattern.negativeMarking === 0
                    ? 'no negative marking'
                    : `−${selectedExam.pattern.negativeMarking} per wrong`}
                </p>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-ghost mt-3"
                >
                  ← Change exam
                </button>
              </div>

              <div className="glass-inset p-5 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="exam-date" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Exam date
                  </label>
                  <input
                    id="exam-date"
                    type="date"
                    min={minDate}
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="input-glass [color-scheme:dark]"
                  />
                  <p className="text-[11px] text-slate-500">
                    {dateValid ? `Plan horizon: ${horizonDays} day${horizonDays === 1 ? '' : 's'}` : 'Choose a future date.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">Language</span>
                  <div className="flex gap-2">
                    {(selectedExam.languages as LanguageCode[]).map((lang) => (
                      <button
                        type="button"
                        key={lang}
                        onClick={() => setLanguage(lang)}
                        className={`flex-1 py-2.5 text-sm font-semibold rounded-xl border transition-all ${
                          language === lang
                            ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200 shadow-[0_0_16px_rgba(6,182,212,0.2)]'
                            : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
                        }`}
                        aria-pressed={language === lang}
                      >
                        {lang === 'hi' ? 'हिन्दी (Hindi)' : 'English'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl border border-rose-500/25 bg-rose-500/10 backdrop-blur text-rose-300 text-xs">
                  {error}
                </div>
              )}

              <button type="submit" disabled={submitting || !dateValid} className="btn-primary w-full">
                {submitting ? 'Generating your plan…' : 'Generate my plan'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
