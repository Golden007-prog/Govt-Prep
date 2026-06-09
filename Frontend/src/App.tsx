import { useEffect, useMemo, useState } from 'react';
import { detectAppMode, type AppMode } from './lib/api/modeDetect';
import { getSettings, type AppSettings } from './lib/store/settings';
import { getStore } from './lib/store';
import { getExam, getExamOrThrow } from './lib/taxonomy/registry';
import { generatePlan } from './lib/plan/generatePlan';
import { LOCAL_USER_ID, type UserProfile } from './lib/types/user';
import type { StudyPlan } from './lib/types/plan';
import { Header } from './ui/components/Header';
import { SetupScreen } from './ui/screens/SetupScreen';
import { OnboardingScreen, type OnboardingSubmit } from './ui/screens/OnboardingScreen';
import { DashboardScreen } from './ui/screens/DashboardScreen';

type Screen = 'onboarding' | 'dashboard' | 'setup';

function App() {
  const store = useMemo(() => getStore({ hostedSession: null }), []);

  const [mode, setMode] = useState<AppMode>('hosted');
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setIsLoading(true);
      try {
        const [detectedMode, currentProfile] = await Promise.all([detectAppMode(), store.getProfile()]);
        if (cancelled) return;
        setMode(detectedMode);
        setSettings(getSettings());
        setProfile(currentProfile);

        const activePlan =
          currentProfile?.targetExamId && getExam(currentProfile.targetExamId)
            ? await store.getPlan(currentProfile.targetExamId)
            : null;
        if (cancelled) return;
        setPlan(activePlan);
        setScreen(currentProfile?.targetExamId && activePlan ? 'dashboard' : 'onboarding');
      } catch (err) {
        console.error('App initialization error:', err);
        if (!cancelled) setScreen('onboarding');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [store]);

  async function handleOnboardingSubmit({ examId, examDate, language }: OnboardingSubmit) {
    const exam = getExamOrThrow(examId);
    const newPlan = generatePlan(exam, { examDate, language });
    const now = new Date().toISOString();
    const nextProfile: UserProfile = {
      id: profile?.id ?? LOCAL_USER_ID,
      email: profile?.email ?? null,
      displayName: profile?.displayName ?? null,
      targetExamId: examId,
      examDate,
      languagePref: language,
      tier: profile?.tier ?? 'free',
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    };
    await store.saveProfile(nextProfile);
    await store.savePlan(newPlan);
    setProfile(nextProfile);
    setPlan(newPlan);
    setScreen('dashboard');
  }

  function handleModeChange(newMode: AppMode) {
    setMode(newMode);
  }

  function handleSetupComplete() {
    setSettings(getSettings());
    setScreen(profile?.targetExamId && plan ? 'dashboard' : 'onboarding');
  }

  function handleNavigate(next: Screen) {
    if (next === 'dashboard' && (!profile?.targetExamId || !plan)) {
      setScreen('onboarding');
      return;
    }
    setScreen(next);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-darkBg text-slate-100 font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mb-4" />
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Initializing GovPrep…</p>
      </div>
    );
  }

  const dashboardExam = profile?.targetExamId ? getExam(profile.targetExamId) : null;

  return (
    <div className="flex flex-col min-h-screen bg-darkBg text-slate-100 font-sans">
      <Header
        mode={mode}
        onModeChange={handleModeChange}
        xp={settings?.xp ?? 0}
        streak={settings?.streak ?? 0}
        onNavigate={handleNavigate}
        currentScreen={screen}
      />

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {screen === 'onboarding' && (
          <OnboardingScreen existingProfile={profile} onSubmit={handleOnboardingSubmit} />
        )}

        {screen === 'dashboard' && dashboardExam && plan && profile && (
          <DashboardScreen
            exam={dashboardExam}
            plan={plan}
            profile={profile}
            onReplan={() => setScreen('onboarding')}
            onOpenSetup={() => setScreen('setup')}
          />
        )}

        {screen === 'dashboard' && (!dashboardExam || !plan) && (
          <div className="text-center text-slate-400 mt-20">
            <p>No active plan found.</p>
            <button onClick={() => setScreen('onboarding')} className="btn-primary mt-4">
              Create a plan
            </button>
          </div>
        )}

        {screen === 'setup' && <SetupScreen mode={mode} onSetupComplete={handleSetupComplete} />}
      </main>
    </div>
  );
}

export default App;
