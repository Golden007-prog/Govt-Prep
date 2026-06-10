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
}

/** SVG circular progress ring with a cyan gradient stroke and centered value text. */
export function GoalRing({ value, goal, size = 96, label }: GoalRingProps) {
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
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span
          className={`font-mono font-bold leading-none ${done ? 'text-emerald-300' : 'text-cyan-300'}`}
          style={{ fontSize: Math.max(14, Math.round(size * 0.22)) }}
        >
          {value}
        </span>
        <span
          className="mt-0.5 leading-tight text-slate-400"
          style={{ fontSize: Math.max(8, Math.round(size * 0.1)) }}
        >
          {label ?? `/ ${goal} XP`}
        </span>
      </div>
    </div>
  );
}
