import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ModeBadge } from './ModeBadge';
import { type AppMode } from '../../lib/api/modeDetect';
import { getSettings } from '../../lib/store/settings';
import { countDue } from '../../lib/srs/srsService';
import type { AuthUser } from '../../lib/auth/supabaseAuth';

interface HeaderProps {
  mode: AppMode;
  onModeChange: (newMode: AppMode) => void;
  authUser: AuthUser | null;
  authAvailable: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/study', label: 'Study', end: false },
  { to: '/review', label: 'Review', end: false },
  { to: '/mock', label: 'Mock', end: false },
  { to: '/chat', label: 'Doubts', end: false },
  { to: '/ca', label: 'Current Affairs', end: false },
] as const;

export const Header: React.FC<HeaderProps> = ({
  mode,
  onModeChange,
  authUser,
  authAvailable,
  onSignIn,
  onSignOut,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [stats, setStats] = useState(() => {
    const s = getSettings();
    return { xp: s.xp, streak: s.streak, due: 0 };
  });

  // Refresh XP/streak/due-count whenever the route changes (cheap local reads).
  useEffect(() => {
    let cancelled = false;
    const s = getSettings();
    countDue()
      .then((due) => {
        if (!cancelled) setStats({ xp: s.xp, streak: s.streak, due });
      })
      .catch(() => {
        if (!cancelled) setStats((prev) => ({ ...prev, xp: s.xp, streak: s.streak }));
      });
    return () => {
      cancelled = true;
    };
  }, [location]);

  const navLinkCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
      isActive ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20' : 'text-slate-400 hover:text-white'
    }`;

  return (
    <header className="border-b border-white/5 bg-darkBg/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Branding */}
        <div className="flex items-center gap-3 cursor-pointer shrink-0" onClick={() => navigate('/')}>
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-500 p-2 rounded-xl shadow-neon-cyan/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-bold font-display tracking-tight leading-none bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              GovPrep
            </h1>
            <span className="text-[10px] font-medium text-slate-400 tracking-wider uppercase font-sans">
              AI exam prep
            </span>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navLinkCls}>
              {n.label}
              {n.to === '/review' && stats.due > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500/20 text-rose-300 text-[9px] font-bold align-middle">
                  {stats.due > 99 ? '99+' : stats.due}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Stats + controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden md:flex items-center gap-2 text-sm font-medium">
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-xl text-amber-400">
              <span className="text-sm">🔥</span>
              <span className="font-mono text-xs">{stats.streak}d</span>
            </div>
            <div className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1.5 rounded-xl text-indigo-400">
              <span className="text-sm">✨</span>
              <span className="font-mono text-xs">{stats.xp}</span>
            </div>
          </div>

          <ModeBadge mode={mode} onModeChange={onModeChange} />

          {authAvailable &&
            (authUser ? (
              <button
                onClick={onSignOut}
                title={`Signed in as ${authUser.displayName ?? authUser.email ?? 'user'} — click to sign out`}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-emerald-500/10 border-emerald-500/20 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
              >
                <span>☁️</span>
                <span className="max-w-[80px] truncate">{authUser.displayName ?? 'Synced'}</span>
              </button>
            ) : (
              <button
                onClick={onSignIn}
                title="Sign in with GitHub to sync your plan to the cloud"
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-slate-800/40 border-white/5 text-slate-300 text-xs font-semibold hover:bg-slate-800 hover:text-white transition-colors"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
                Sign in
              </button>
            ))}

          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `p-2 rounded-xl border transition-all duration-200 ${
                isActive
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                  : 'bg-slate-800/40 border-white/5 text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </NavLink>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="lg:hidden p-2 rounded-xl border bg-slate-800/40 border-white/5 text-slate-400 hover:text-white"
            aria-label="Menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={menuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {menuOpen && (
        <nav className="lg:hidden border-t border-white/5 px-4 py-3 flex flex-wrap gap-2 bg-darkBg/95">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navLinkCls} onClick={() => setMenuOpen(false)}>
              {n.label}
              {n.to === '/review' && stats.due > 0 && (
                <span className="ml-1.5 text-[9px] text-rose-300 font-bold">{stats.due}</span>
              )}
            </NavLink>
          ))}
          {authAvailable && (
            <button
              onClick={authUser ? onSignOut : onSignIn}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 bg-slate-800/60"
            >
              {authUser ? 'Sign out' : 'Sign in with GitHub'}
            </button>
          )}
        </nav>
      )}
    </header>
  );
};
