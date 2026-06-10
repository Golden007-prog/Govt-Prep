import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { detectAppMode, type AppMode } from './lib/api/modeDetect';
import { saveSettings } from './lib/store/settings';
import { getStore } from './lib/store';
import { DexieStore } from './lib/store/dexieStore';
import { getExam, getExamOrThrow } from './lib/taxonomy/registry';
import { generatePlan } from './lib/plan/generatePlan';
import { LOCAL_USER_ID, type UserProfile } from './lib/types/user';
import type { StudyPlan } from './lib/types/plan';
import {
  authAvailable,
  getCurrentUser,
  onAuthChange,
  signInWithGitHub,
  signOut,
  type AuthUser,
} from './lib/auth/supabaseAuth';
import { Header } from './ui/components/Header';
import { PomodoroWidget } from './ui/components/PomodoroWidget';
import { SetupScreen } from './ui/screens/SetupScreen';
import { OnboardingScreen, type OnboardingSubmit } from './ui/screens/OnboardingScreen';
import { DashboardScreen } from './ui/screens/DashboardScreen';
import { StudyScreen } from './ui/screens/StudyScreen';
import { ReviewScreen } from './ui/screens/ReviewScreen';
import { MockScreen } from './ui/screens/MockScreen';
import { MockResultsScreen } from './ui/screens/MockResultsScreen';
import { ChatScreen } from './ui/screens/ChatScreen';
import { CurrentAffairsScreen } from './ui/screens/CurrentAffairsScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<AppMode>('hosted');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hosted store when signed in to a configured Supabase project; Dexie otherwise.
  // Keyed on the stable user id (not the AuthUser object identity) so hourly
  // TOKEN_REFRESHED / tab-refocus SIGNED_IN events don't rebuild the store and
  // re-run init mid-session — only real sign-in/sign-out transitions do.
  const userId = authUser?.id ?? null;
  const store = useMemo(
    () => getStore({ hostedSession: userId ? { userId } : null }),
    [userId],
  );

  // Auth session: resolve once, then subscribe. Keep the previous AuthUser
  // object when nothing meaningful changed so auth-event re-renders are no-ops.
  useEffect(() => {
    let cancelled = false;
    const keepIfSame = (prev: AuthUser | null, next: AuthUser | null) =>
      prev?.id === next?.id && prev?.email === next?.email && prev?.displayName === next?.displayName
        ? prev
        : next;
    getCurrentUser().then((u) => {
      if (!cancelled) setAuthUser((prev) => keepIfSame(prev, u));
    });
    const unsubscribe = onAuthChange((u) => setAuthUser((prev) => keepIfSame(prev, u)));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Init (and re-init when the store identity changes after sign-in/out).
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setIsLoading(true);
      try {
        const [detectedMode, currentProfile] = await Promise.all([detectAppMode(), store.getProfile()]);
        if (cancelled) return;
        // Persist the mode: the AI client routes through the subscription backend
        // (local) vs browser BYOK (hosted) based on settings.activeMode.
        saveSettings({ activeMode: detectedMode });
        setMode(detectedMode);

        let effectiveProfile = currentProfile;
        let activePlan: StudyPlan | null = null;

        // First sign-in on this device: the handle_new_user DB trigger pre-provisions a
        // public.users row with target_exam_id NULL, so migrate whenever the cloud profile
        // is missing OR unconfigured (cloud sync feature).
        if (store.kind === 'supabase' && !effectiveProfile?.targetExamId) {
          const local = new DexieStore();
          const localProfile = await local.getProfile();
          if (cancelled) return;
          if (localProfile?.targetExamId) {
            const localPlan = await local.getPlan(localProfile.targetExamId);
            if (cancelled) return;
            await store.saveProfile({
              ...localProfile,
              id: effectiveProfile?.id ?? localProfile.id,
              email: effectiveProfile?.email ?? localProfile.email,
              displayName: effectiveProfile?.displayName ?? localProfile.displayName,
            });
            if (localPlan) await store.savePlan(localPlan);
            effectiveProfile = await store.getProfile();
            activePlan = localPlan;
          }
        }

        if (effectiveProfile?.targetExamId && getExam(effectiveProfile.targetExamId) && !activePlan) {
          activePlan = await store.getPlan(effectiveProfile.targetExamId);
        }
        if (cancelled) return;
        setProfile(effectiveProfile);
        setPlan(activePlan);
      } catch (err) {
        console.error('App initialization error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const handleOnboardingSubmit = useCallback(
    async ({ examId, examDate, language }: OnboardingSubmit) => {
      const exam = getExamOrThrow(examId);
      const newPlan = generatePlan(exam, { examDate, language });
      const now = new Date().toISOString();
      const nextProfile: UserProfile = {
        id: profile?.id ?? authUser?.id ?? LOCAL_USER_ID,
        email: profile?.email ?? authUser?.email ?? null,
        displayName: profile?.displayName ?? authUser?.displayName ?? null,
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
      navigate('/');
    },
    [store, profile, authUser, navigate],
  );

  const handleProfileChange = useCallback(
    async (next: UserProfile) => {
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      await store.saveProfile(stamped);
      setProfile(stamped);
    },
    [store],
  );

  const exam = profile?.targetExamId ? getExam(profile.targetExamId) : null;
  const ready = Boolean(exam && plan && profile);
  const language = profile?.languagePref ?? 'en';

  const goTo = useCallback(
    (to: 'study' | 'review' | 'mock' | 'mock-results' | 'chat' | 'ca' | 'settings') => {
      navigate(to === 'mock-results' ? '/mock/results' : `/${to}`);
    },
    [navigate],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-darkBg text-slate-100 font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mb-4" />
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Initializing GovPrep…</p>
      </div>
    );
  }

  const requirePlan = (element: React.ReactElement) =>
    ready ? element : <Navigate to="/onboarding" replace />;

  // The focus timer floats everywhere except inside the distraction-free mock room.
  const showPomodoro = ready && !location.pathname.startsWith('/mock');

  return (
    <div className="flex flex-col min-h-screen bg-darkBg text-slate-100 font-sans">
      <Header
        mode={mode}
        onModeChange={(m) => {
          saveSettings({ activeMode: m });
          setMode(m);
        }}
        authUser={authUser}
        authAvailable={authAvailable()}
        onSignIn={() => {
          void signInWithGitHub().catch((err) => {
            console.error('Sign-in failed:', err);
            window.alert(
              'GitHub sign-in is not available yet.\n\nEnable the GitHub provider in the Supabase dashboard (Authentication → Providers) and add this site to the redirect URLs — see supabase/README.md. The app works fully without signing in (local-first).',
            );
          });
        }}
        onSignOut={() => {
          void signOut().then(() => setAuthUser(null));
        }}
      />

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route
            path="/"
            element={requirePlan(
              exam && plan && profile ? (
                <DashboardScreen
                  exam={exam}
                  plan={plan}
                  profile={profile}
                  onReplan={() => navigate('/onboarding')}
                  onOpenSetup={() => navigate('/setup')}
                  onOpenTopic={(topicId) => navigate(`/study/${topicId}`)}
                  onNavigate={goTo}
                />
              ) : (
                <Navigate to="/onboarding" replace />
              ),
            )}
          />
          <Route path="/study/:topicId?" element={requirePlan(<StudyRoute exam={exam} profile={profile} />)} />
          <Route path="/review" element={requirePlan(<ReviewScreen />)} />
          <Route
            path="/mock"
            element={requirePlan(
              exam ? <MockScreen exam={exam} language={language} onFinished={() => navigate('/mock/results')} /> : <span />,
            )}
          />
          <Route
            path="/mock/results"
            element={requirePlan(exam ? <MockResultsScreen exam={exam} onStartMock={() => navigate('/mock')} /> : <span />)}
          />
          <Route path="/chat" element={requirePlan(exam ? <ChatScreen exam={exam} language={language} /> : <span />)} />
          <Route
            path="/ca"
            element={requirePlan(exam ? <CurrentAffairsScreen exam={exam} language={language} /> : <span />)}
          />
          <Route
            path="/settings"
            element={
              <SettingsScreen
                profile={profile}
                onProfileChange={handleProfileChange}
                onOpenKeys={() => navigate('/setup')}
              />
            }
          />
          <Route
            path="/setup"
            element={<SetupScreen mode={mode} onSetupComplete={() => navigate(ready ? '/' : '/onboarding')} />}
          />
          <Route
            path="/onboarding"
            element={<OnboardingScreen existingProfile={profile} onSubmit={handleOnboardingSubmit} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {showPomodoro && (
        <div className="fixed bottom-4 right-4 z-40">
          <PomodoroWidget />
        </div>
      )}
    </div>
  );
}

/** Route adapter: pulls :topicId from the URL for the study workspace. */
function StudyRoute({ exam, profile }: { exam: ReturnType<typeof getExam>; profile: UserProfile | null }) {
  const { topicId } = useParams();
  if (!exam || !profile) return <Navigate to="/onboarding" replace />;
  return <StudyScreen exam={exam} profile={profile} initialTopicId={topicId ?? null} />;
}

function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

export default App;
