import { useId } from 'react';

export interface GoalRingProps {
  /** Current progress (e.g. XP earned today). */
  value: number;
  /** Target for a full ring (e.g. the daily XP goal). */
  goal: number;
  /** Outer diameter in px. Default 96. */
  size?: number;
  /** Sublabel under the centered value. Defaults to "/ {goal} XP". */
  label?: string;
  /**
   * Full override of the centered content (e.g. the exam-countdown ring:
   * main "38", sub "DAYS TO EXAM", sub2 "Sat, Jul 18"). value/goal still
   * drive the ring fill.
   */
  display?: { main: string; sub?: string; sub2?: string };
}

/** SVG circular progress ring with a cyan gradient stroke and centered value text. */
export function GoalRing({ value, goal, size = 96, label, display }: GoalRingProps) {
  // useId can contain ":" which breaks url(#…) fragment refs in some engines — strip it.
  const gradientId = `goal-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const stroke = Math.max(6, Math.round(size / 12));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : 0;
  const done = goal > 0 && value >= goal;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(30,41,59,0.9)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          style={{
            transition: 'stroke-dasharray 0.6s ease',
            filter: 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.45))',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <span
          className={`font-mono font-bold leading-none ${done ? 'text-emerald-300' : 'text-cyan-300'}`}
          style={{ fontSize: Math.max(14, Math.round(size * 0.22)) }}
        >
          {display?.main ?? value}
        </span>
        <span
          className="mt-0.5 leading-tight text-slate-400 uppercase tracking-wider"
          style={{ fontSize: Math.max(8, Math.round(size * 0.085)) }}
        >
          {display?.sub ?? label ?? `/ ${goal} XP`}
        </span>
        {display?.sub2 && (
          <span className="leading-tight text-slate-500" style={{ fontSize: Math.max(8, Math.round(size * 0.075)) }}>
            {display.sub2}
          </span>
        )}
      </div>
    </div>
  );
}
