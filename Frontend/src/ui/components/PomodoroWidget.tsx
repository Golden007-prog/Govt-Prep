import { usePomodoro } from '../../lib/hooks/usePomodoro';
import { recordActivity } from '../../lib/progress/progressService';

const WORK_PRESETS = [15, 25, 45, 60];

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Compact self-contained focus-timer pill (~64px tall) for the dashboard/header
 * area. Completed work blocks award XP + log a pomodoro study session.
 */
export function PomodoroWidget() {
  const { phase, secondsLeft, isRunning, start, pause, resume, reset, workMinutes, breakMinutes, setWorkMinutes } =
    usePomodoro({
      onWorkComplete: (minutes) => {
        void recordActivity('pomodoroCompleted', { minutes, sessionKind: 'pomodoro' });
      },
    });

  if (phase === 'idle') {
    return (
      <div className="glass-panel h-16 flex items-center gap-3 px-4 !rounded-2xl">
        <span className="glass-tile w-10 h-10 text-xl shrink-0" aria-hidden>
          🍅
        </span>
        <div className="min-w-0 hidden sm:block">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">Focus timer</p>
          <p className="text-[11px] text-slate-500">{breakMinutes}m break after</p>
        </div>
        <select
          value={workMinutes}
          onChange={(e) => setWorkMinutes(Number(e.target.value))}
          aria-label="Work block length"
          className="bg-slate-900/70 backdrop-blur border border-white/10 rounded-xl px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/60 transition-colors"
        >
          {WORK_PRESETS.map((m) => (
            <option key={m} value={m}>
              {m}m
            </option>
          ))}
        </select>
        <button onClick={start} className="btn-primary text-sm !px-5 !py-2 !rounded-xl">
          Start
        </button>
      </div>
    );
  }

  const isWork = phase === 'work';
  return (
    <div
      className={`glass-panel h-16 flex items-center gap-3 px-4 !rounded-2xl ${
        isWork
          ? `!border-cyan-500/25 ${isRunning ? 'animate-glow-pulse' : ''}`
          : '!border-emerald-500/25'
      }`}
    >
      <span className="glass-tile w-10 h-10 text-xl shrink-0" aria-hidden>
        🍅
      </span>
      <div className="min-w-0">
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            isWork
              ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20'
              : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
          }`}
        >
          {isWork ? 'Focus' : 'Break'}
        </span>
        <p className="text-[10px] text-slate-500 mt-1">{isRunning ? `${workMinutes}m block` : 'Paused'}</p>
      </div>
      <span className={`text-2xl font-mono font-bold tabular-nums ${isWork ? 'text-cyan-300' : 'text-emerald-300'}`}>
        {fmtClock(secondsLeft)}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={isRunning ? pause : resume}
          title={isRunning ? 'Pause' : 'Resume'}
          aria-label={isRunning ? 'Pause timer' : 'Resume timer'}
          className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center text-xs transition-colors"
        >
          {isRunning ? '⏸' : '▶'}
        </button>
        <button
          onClick={reset}
          title="Reset"
          aria-label="Reset timer"
          className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center text-sm transition-colors"
        >
          ↺
        </button>
      </div>
    </div>
  );
}
