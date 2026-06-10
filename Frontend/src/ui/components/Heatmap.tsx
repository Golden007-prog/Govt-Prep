import { useMemo } from 'react';
import type { ActivityDay } from '../../lib/types/progress';
import { parseISODate } from '../../lib/plan/dateUtils';

export interface HeatmapProps {
  /** Ascending list of calendar days, typically `getHeatmap(90)`. */
  days: ActivityDay[];
}

/** XP → heat bucket: 0 / 1-24 / 25-74 / 75-149 / 150+. */
function cellClass(xp: number): string {
  if (xp >= 150) return 'bg-cyan-300';
  if (xp >= 75) return 'bg-cyan-500';
  if (xp >= 25) return 'bg-cyan-700';
  if (xp >= 1) return 'bg-cyan-900';
  return 'bg-slate-800';
}

function fmtDay(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Monday-first weekday index (Mon=0 … Sun=6) for an ISO date. */
function mondayIndex(iso: string): number {
  return (parseISODate(iso).getUTCDay() + 6) % 7;
}

const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''] as const;
const LEGEND = ['bg-slate-800', 'bg-cyan-900', 'bg-cyan-700', 'bg-cyan-500', 'bg-cyan-300'] as const;

/**
 * GitHub-style activity heatmap: weeks as columns, Mon→Sun as rows. Pure divs,
 * native `title` tooltips ("Mar 3 — 120 XP, 45 min").
 */
export function Heatmap({ days }: HeatmapProps) {
  const weeks = useMemo(() => {
    const cols: Array<Array<ActivityDay | null>> = [];
    let col: Array<ActivityDay | null> = [];
    for (const day of days) {
      const dow = mondayIndex(day.date);
      // Pad the first (partial) week down to the correct weekday row.
      if (col.length === 0) for (let i = 0; i < dow; i++) col.push(null);
      col.push(day);
      if (dow === 6) {
        cols.push(col);
        col = [];
      }
    }
    if (col.length > 0) {
      while (col.length < 7) col.push(null);
      cols.push(col);
    }
    return cols;
  }, [days]);

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="flex w-max gap-1">
          <div className="mr-1 flex flex-col gap-1 text-[9px] leading-3 text-slate-500">
            {ROW_LABELS.map((label, i) => (
              <div key={i} className="h-3">
                {label}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) =>
                day ? (
                  <div
                    key={day.date}
                    title={`${fmtDay(day.date)} — ${day.xp} XP, ${day.minutes} min`}
                    className={`h-3 w-3 rounded-[3px] ${cellClass(day.xp)}`}
                  />
                ) : (
                  <div key={`pad-${wi}-${di}`} className="h-3 w-3" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
        <span className="mr-0.5">Less</span>
        {LEGEND.map((cls) => (
          <div key={cls} className={`h-3 w-3 rounded-[3px] ${cls}`} />
        ))}
        <span className="ml-0.5">More</span>
      </div>
    </div>
  );
}
