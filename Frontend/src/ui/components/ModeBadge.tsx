import React, { useState } from 'react';
import { type AppMode, detectAppMode } from '../../lib/api/modeDetect';

interface ModeBadgeProps {
  mode: AppMode;
  onModeChange: (newMode: AppMode) => void;
}

export const ModeBadge: React.FC<ModeBadgeProps> = ({ mode, onModeChange }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const detectedMode = await detectAppMode();
      onModeChange(detectedMode);
    } catch (err) {
      console.error('Failed to detect mode:', err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 600); // UI visual throttle
    }
  };

  const isLocal = mode === 'local';

  return (
    <div className="flex items-center gap-3 bg-darkCard/40 border border-white/5 px-4 py-2 rounded-full backdrop-blur-sm shadow-glass">
      <div className="flex items-center gap-2">
        <span className={`relative flex h-2.5 w-2.5`}>
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
            isLocal ? 'bg-emerald-400' : 'bg-cyan-400'
          }`}></span>
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            isLocal ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)]' : 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.7)]'
          }`}></span>
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-sans">
          Mode: <span className={isLocal ? 'text-emerald-400' : 'text-cyan-400'}>
            {isLocal ? 'Local / Desktop' : 'Hosted (BYOK)'}
          </span>
        </span>
      </div>

      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        title="Re-detect backend server status"
        className={`text-slate-400 hover:text-white transition-colors focus:outline-none disabled:opacity-30 ${
          isRefreshing ? 'animate-spin' : ''
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.2" />
        </svg>
      </button>
    </div>
  );
};
