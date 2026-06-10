import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { UserProfile } from '../../lib/types/user';
import type { LanguageCode } from '../../lib/types/exam';
import type { AchievementDef } from '../../lib/types/progress';
import { getSettings } from '../../lib/store/settings';
import { db } from '../../lib/store/db';
import { downloadBackup, importAll } from '../../lib/platform/backup';
import {
  getAchievements,
  getDailyGoal,
  setDailyGoal as persistDailyGoal,
} from '../../lib/progress/progressService';

export interface SettingsScreenProps {
  profile: UserProfile | null;
  onProfileChange: (p: UserProfile) => Promise<void>;
  onOpenKeys: () => void;
}

const GOAL_PRESETS = [50, 100, 200, 500];

const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
];

type AchievementRow = AchievementDef & { unlockedAt: number | null };

interface Banner {
  kind: 'success' | 'error';
  text: string;
}

function SectionHeader({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="glass-tile w-10 h-10 text-xl shrink-0">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-lg font-bold text-white font-display">{title}</h3>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export function SettingsScreen({ profile, onProfileChange, onOpenKeys }: SettingsScreenProps) {
  // Sync source → lazy init (never setState in an effect body).
  const [keyMask] = useState<string | null>(() => {
    const key = getSettings().anthropicApiKey;
    return key ? `sk-ant-…${key.slice(-4)}` : null;
  });
  // Subscription OAuth (local backend) vs hosted BYOK — set by App before routes render.
  const [isLocalMode] = useState(() => getSettings().activeMode === 'local');

  const [savingLang, setSavingLang] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  const [goal, setGoal] = useState<number | null>(null);
  const [goalInput, setGoalInput] = useState('');

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBanner, setImportBanner] = useState<Banner | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [achievements, setAchievements] = useState<AchievementRow[]>([]);

  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDailyGoal()
      .then((g) => {
        if (cancelled) return;
        setGoal(g);
        setGoalInput(String(g));
      })
      .catch(() => {});
    getAchievements()
      .then((rows) => {
        if (!cancelled) setAchievements(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLanguage = (code: LanguageCode) => {
    if (!profile || profile.languagePref === code || savingLang) return;
    setSavingLang(true);
    setLangError(null);
    onProfileChange({ ...profile, languagePref: code })
      .catch((err: unknown) => {
        setLangError(err instanceof Error ? err.message : 'Could not save the language preference.');
      })
      .finally(() => setSavingLang(false));
  };

  const applyGoal = (n: number) => {
    setGoal(n);
    setGoalInput(String(n));
    void persistDailyGoal(n);
  };

  const handleGoalInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setGoalInput(raw);
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n > 0) {
      setGoal(n);
      void persistDailyGoal(n);
    }
  };

  const handleExport = () => {
    setExporting(true);
    setImportBanner(null);
    downloadBackup()
      .catch((err: unknown) => {
        setImportBanner({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Backup export failed.',
        });
      })
      .finally(() => setExporting(false));
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (
      !window.confirm(
        'Importing a backup overwrites existing rows with matching ids (settings included). Continue?',
      )
    ) {
      return;
    }
    setImporting(true);
    setImportBanner(null);
    file
      .text()
      .then((text) => importAll(text))
      .then(({ tables, rows }) => {
        setImportBanner({
          kind: 'success',
          text: `Backup restored: ${rows} rows across ${tables} tables. Reload the app to pick up the imported data.`,
        });
      })
      .catch((err: unknown) => {
        setImportBanner({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Backup import failed.',
        });
      })
      .finally(() => setImporting(false));
  };

  const handleClearAll = () => {
    if (
      !window.confirm(
        'Delete ALL local GovPrep data — profile, plans, progress, flashcards, mocks and cached AI content? This cannot be undone.',
      )
    ) {
      return;
    }
    if (!window.confirm('Last check: really erase everything and restart the app?')) return;
    setClearing(true);
    setClearError(null);
    db.delete()
      .then(() => {
        localStorage.removeItem('govprep_settings');
        location.reload();
      })
      .catch((err: unknown) => {
        setClearing(false);
        setClearError(err instanceof Error ? err.message : 'Failed to clear local data.');
      });
  };

  const unlockedCount = achievements.filter((a) => a.unlockedAt != null).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <span className="eyebrow">Preferences</span>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-display mt-2">Settings</h2>
        <p className="text-sm text-slate-400 mt-1">Keys, language, goals, backups and achievements.</p>
      </div>

      {/* AI connection */}
      <section className="glass-panel p-6">
        <SectionHeader
          icon="🔑"
          title="AI connection"
          sub={
            isLocalMode
              ? 'Subscription OAuth: AI runs through the local backend with your Claude subscription.'
              : 'Hosted fallback: your Anthropic key powers notes, quizzes, grading and digests.'
          }
        />
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {isLocalMode ? (
              <>
                <span className="glow-indicator-green" />
                <span className="text-sm text-emerald-300">
                  Claude subscription via local backend{' '}
                  <span className="text-slate-500">— no API key needed.</span>
                </span>
              </>
            ) : (
              <>
                <span className={keyMask ? 'glow-indicator-green' : 'glow-indicator-orange'} />
                {keyMask ? (
                  <span className="text-sm font-mono text-slate-200">{keyMask}</span>
                ) : (
                  <span className="text-sm text-amber-300">
                    not set <span className="text-slate-500">— AI features won&apos;t work until you add one.</span>
                  </span>
                )}
              </>
            )}
          </div>
          <button onClick={onOpenKeys} className="btn-secondary text-sm shrink-0">
            {isLocalMode ? 'Connection details' : 'Configure keys'}
          </button>
        </div>
      </section>

      {/* Content language */}
      <section className="glass-panel p-6">
        <SectionHeader
          icon="🌐"
          title="Content language"
          sub="AI notes, quizzes, flashcards and digests are generated in this language."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {LANGUAGES.map(({ code, label }) => {
            const active = profile?.languagePref === code;
            return (
              <button
                key={code}
                disabled={!profile || savingLang}
                onClick={() => handleLanguage(code)}
                className={`chip !text-sm !px-4 !py-2 transition-all disabled:opacity-50 disabled:pointer-events-none ${
                  active
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-[0_0_14px_rgba(6,182,212,0.25)]'
                    : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                {label}
              </button>
            );
          })}
          {savingLang && (
            <span className="self-center text-xs text-slate-500 flex items-center gap-2">
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full" />
              Saving…
            </span>
          )}
        </div>
        {!profile && (
          <p className="mt-3 text-[11px] text-slate-500">Complete onboarding to set a content language.</p>
        )}
        {langError && <p className="mt-3 text-xs text-rose-400">❌ {langError}</p>}
      </section>

      {/* Daily goal */}
      <section className="glass-panel p-6">
        <SectionHeader icon="🎯" title="Daily goal" sub="XP target per day — drives the goal ring on your dashboard." />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={10}
            step={10}
            value={goalInput}
            onChange={handleGoalInput}
            disabled={goal === null}
            className="input-glass !w-28 font-mono text-sm disabled:opacity-50"
          />
          <span className="text-xs text-slate-500 mr-2">XP / day</span>
          {GOAL_PRESETS.map((n) => (
            <button
              key={n}
              onClick={() => applyGoal(n)}
              disabled={goal === null}
              className={`chip font-mono transition-all disabled:opacity-50 ${
                goal === n
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-[0_0_14px_rgba(6,182,212,0.25)]'
                  : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* Backup */}
      <section className="glass-panel p-6">
        <SectionHeader
          icon="💾"
          title="Backup"
          sub="Full JSON dump of settings, progress, flashcards, plans, mocks and cached content."
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={handleExport} disabled={exporting} className="btn-secondary text-sm">
            {exporting ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full mr-2" />
                Exporting…
              </>
            ) : (
              <>⬇️ Export backup</>
            )}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary text-sm">
            {importing ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full mr-2" />
                Importing…
              </>
            ) : (
              <>⬆️ Import backup</>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
            aria-hidden
          />
        </div>
        {importBanner && (
          <div
            className={`mt-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
              importBanner.kind === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            <span>{importBanner.kind === 'success' ? '✅' : '❌'}</span>
            <p className="leading-relaxed flex-grow">{importBanner.text}</p>
            {importBanner.kind === 'success' && (
              <button
                onClick={() => location.reload()}
                className="shrink-0 underline underline-offset-2 hover:text-emerald-300"
              >
                Reload now
              </button>
            )}
          </div>
        )}
      </section>

      {/* Achievements */}
      <section className="glass-panel p-6">
        <div className="flex items-center justify-between gap-3">
          <SectionHeader icon="🏆" title="Achievements" />
          <span className="chip shrink-0 text-amber-300 bg-amber-500/10 border-amber-500/25 font-mono">
            {unlockedCount}/{achievements.length} unlocked
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {achievements.map((a) => {
            const unlocked = a.unlockedAt != null;
            return (
              <div
                key={a.id}
                className={`p-4 ${
                  unlocked
                    ? 'rounded-xl border bg-amber-500/5 border-amber-500/25 shadow-[0_0_18px_rgba(245,158,11,0.08)]'
                    : 'glass-inset opacity-50'
                }`}
              >
                <div className={`text-2xl ${unlocked ? '' : 'grayscale'}`}>{a.icon}</div>
                <p className="text-xs font-bold text-slate-200 mt-2">{a.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{a.description}</p>
                <p className={`text-[10px] mt-2 ${unlocked ? 'text-amber-300/90' : 'text-slate-600'}`}>
                  {unlocked && a.unlockedAt != null
                    ? `Unlocked ${new Date(a.unlockedAt).toLocaleDateString()}`
                    : '🔒 Locked'}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Danger zone */}
      <section className="glass-panel p-6 !border-rose-500/25">
        <SectionHeader
          icon="⚠️"
          title="Danger zone"
          sub="Wipes every locally stored item — profile, plans, progress, flashcards, mocks, cached AI content and settings."
        />
        <button
          onClick={handleClearAll}
          disabled={clearing}
          className="mt-4 inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          {clearing ? 'Clearing…' : '🗑️ Clear all local data'}
        </button>
        {clearError && <p className="mt-3 text-xs text-rose-400">❌ {clearError}</p>}
      </section>
    </div>
  );
}
