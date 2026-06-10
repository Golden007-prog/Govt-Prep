import { useCallback, useEffect, useRef, useState } from 'react';

/** Current phase of the pomodoro cycle. */
export type PomodoroPhase = 'idle' | 'work' | 'break';

/** Configuration for usePomodoro. */
export interface PomodoroOptions {
  /** Length of a work block in minutes. Defaults to 25. */
  workMinutes?: number;
  /** Length of a break block in minutes. Defaults to 5. */
  breakMinutes?: number;
  /** Fired exactly once when a work block finishes, with its length in minutes. */
  onWorkComplete?: (minutes: number) => void;
}

/** State and controls returned by usePomodoro. */
export interface PomodoroControls {
  phase: PomodoroPhase;
  secondsLeft: number;
  isRunning: boolean;
  /** Begins a fresh work block and starts the timer. */
  start: () => void;
  /** Pauses the countdown (phase is preserved). */
  pause: () => void;
  /** Resumes a paused work/break block; no-op while idle. */
  resume: () => void;
  /** Stops the timer and returns to idle with a full work block queued. */
  reset: () => void;
  workMinutes: number;
  breakMinutes: number;
  /** Updates the work-block length; refreshes secondsLeft when idle. */
  setWorkMinutes: (n: number) => void;
}

/**
 * Pomodoro timer hook: idle → work → break → idle. Ticks once per second
 * while running; the work→break transition fires `onWorkComplete(workMinutes)`
 * exactly once (the callback lives in a ref so re-renders never re-fire it).
 * Nothing is persisted.
 *
 * @param opts Optional durations and completion callback (defaults 25/5).
 */
export function usePomodoro(opts?: PomodoroOptions): PomodoroControls {
  const breakMinutes = opts?.breakMinutes ?? 5;
  const [workMinutes, setWorkMinutesState] = useState(opts?.workMinutes ?? 25);
  const [phase, setPhase] = useState<PomodoroPhase>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState((opts?.workMinutes ?? 25) * 60);

  const onWorkCompleteRef = useRef(opts?.onWorkComplete);
  useEffect(() => {
    onWorkCompleteRef.current = opts?.onWorkComplete;
  });

  // Mirror the values the interval callback needs, so the effect body never
  // calls setState directly (react-hooks/set-state-in-effect) and the listener
  // re-subscribes only when isRunning flips.
  const secondsRef = useRef(secondsLeft);
  const phaseRef = useRef(phase);
  const workMinutesRef = useRef(workMinutes);
  useEffect(() => {
    secondsRef.current = secondsLeft;
    phaseRef.current = phase;
    workMinutesRef.current = workMinutes;
  });

  // One-second tick while running; phase transitions happen here, inside the
  // interval callback (an external-system event), each exactly once.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => {
      const next = secondsRef.current - 1;
      if (next > 0) {
        secondsRef.current = next;
        setSecondsLeft(next);
        return;
      }
      if (phaseRef.current === 'work') {
        onWorkCompleteRef.current?.(workMinutesRef.current);
        phaseRef.current = 'break';
        secondsRef.current = breakMinutes * 60;
        setPhase('break');
        setSecondsLeft(breakMinutes * 60);
      } else {
        phaseRef.current = 'idle';
        secondsRef.current = workMinutesRef.current * 60;
        setPhase('idle');
        setIsRunning(false);
        setSecondsLeft(workMinutesRef.current * 60);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, breakMinutes]);

  const start = useCallback(() => {
    setPhase('work');
    setSecondsLeft(workMinutes * 60);
    setIsRunning(true);
  }, [workMinutes]);

  const pause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const resume = useCallback(() => {
    if (phase !== 'idle') setIsRunning(true);
  }, [phase]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setPhase('idle');
    setSecondsLeft(workMinutes * 60);
  }, [workMinutes]);

  const setWorkMinutes = useCallback(
    (n: number) => {
      const minutes = Math.max(1, Math.floor(n));
      setWorkMinutesState(minutes);
      if (phase === 'idle') setSecondsLeft(minutes * 60);
    },
    [phase],
  );

  return {
    phase,
    secondsLeft,
    isRunning,
    start,
    pause,
    resume,
    reset,
    workMinutes,
    breakMinutes,
    setWorkMinutes,
  };
}
