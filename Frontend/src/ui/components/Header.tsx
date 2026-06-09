import React from 'react';
import { ModeBadge } from './ModeBadge';
import { type AppMode } from '../../lib/api/modeDetect';

interface HeaderProps {
  mode: AppMode;
  onModeChange: (newMode: AppMode) => void;
  xp: number;
  streak: number;
  onNavigate: (screen: 'dashboard' | 'setup' | 'onboarding') => void;
  currentScreen: string;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onModeChange,
  xp,
  streak,
  onNavigate,
  currentScreen,
}) => {
  return (
    <header className="border-b border-white/5 bg-darkBg/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Branding / Title */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => onNavigate('dashboard')}>
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-500 p-2 rounded-xl shadow-neon-cyan/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold font-display tracking-tight leading-none bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              GovPrep
            </h1>
            <span className="text-[10px] font-medium text-slate-400 tracking-wider uppercase font-sans">
              AI exam prep
            </span>
          </div>
        </div>

        {/* Navigation & Progress Stats */}
        <div className="flex items-center gap-4 sm:gap-6">
          
          {/* XP and Streak Stats */}
          <div className="hidden sm:flex items-center gap-4 text-sm font-medium">
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl text-amber-400">
              <span className="text-base">🔥</span>
              <span className="font-mono">{streak} Days</span>
            </div>
            
            <div className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-xl text-indigo-400">
              <span className="text-base">✨</span>
              <span className="font-mono">{xp} XP</span>
            </div>
          </div>

          {/* Mode Badge */}
          <ModeBadge mode={mode} onModeChange={onModeChange} />

          {/* Settings / Onboarding link */}
          <button
            onClick={() => onNavigate('setup')}
            className={`p-2 rounded-xl border transition-all duration-200 ${
              currentScreen === 'setup'
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                : 'bg-slate-800/40 border-white/5 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Configure settings & keys"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

        </div>
      </div>
    </header>
  );
};
