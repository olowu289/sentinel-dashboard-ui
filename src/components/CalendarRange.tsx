import { useState } from "react";
import { formatDayLabel } from "@/lib/time";

/* Monday-first. The filter already speaks ISO `YYYY-MM-DD`, and an ISO week
   starts on Monday — mixing an ISO date string with a Sunday-first grid is the
   kind of quiet inconsistency that makes someone off-by-one a shift boundary.
   Two letters, not one: a column headed "T" twice is unreadable, and a
   single-letter header gives a screen reader nothing to say. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const FULL_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Grid for one month, as ISO day strings with leading blanks.
 *
 * Built entirely in UTC calendar space rather than from timestamps. The cells
 * are labels for calendar days, not moments — the moment a day begins depends
 * on a timezone, and dragging that question into grid construction is how
 * pickers end up rendering a 30th that the filter then reads as the 29th.
 */
function monthCells(year: number, month: number) {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(iso(year, month, d));
  return cells;
}

export function CalendarRange({
  from,
  to,
  today,
  onChange,
}: {
  from?: string;
  to?: string;
  /** Site's today as `YYYY-MM-DD` — not the viewer's. */
  today: string;
  onChange: (next: { from?: string; to?: string }) => void;
}) {
  const anchor = (from ?? today).split("-").map(Number);
  const [view, setView] = useState({ y: anchor[0], m: anchor[1] - 1 });

  const cells = monthCells(view.y, view.m);
  const step = (delta: number) => {
    const next = new Date(Date.UTC(view.y, view.m + delta, 1));
    setView({ y: next.getUTCFullYear(), m: next.getUTCMonth() });
  };

  /* One tap sets the start and clears the end, the next closes the range, and
     a tap on a complete range starts over. Picking backwards swaps rather than
     rejecting — an operator who clicks the end first meant a range, not a
     mistake, and refusing it just makes them click twice more. */
  const pick = (day: string) => {
    if (!from || to) return onChange({ from: day, to: undefined });
    return day < from
      ? onChange({ from: day, to: from })
      : onChange({ from, to: day });
  };

  return (
    <div>
      <div className="flex items-center justify-between pb-[8px]">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous month"
          className="flex size-[28px] items-center justify-center rounded-[6px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M10 3 5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <p aria-live="polite" className="text-[0.8125rem] text-white">
          {MONTH.format(Date.UTC(view.y, view.m, 1))}
        </p>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next month"
          className="flex size-[28px] items-center justify-center rounded-[6px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="m6 3 5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="flex h-[24px] items-center justify-center font-display text-[0.625rem] uppercase tracking-[0.1px] text-white/30"
          >
            {w}
          </span>
        ))}

        {cells.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} aria-hidden />;

          const isFrom = day === from;
          const isTo = day === to;
          const inside = !!from && !!to && day > from && day < to;
          const edge = isFrom || isTo;

          /* Neutral white for selection, never terra. Green in this app means a
             feed is live; spending it on "you clicked this date" would put a
             live-signal colour on a control that has nothing to do with the
             cameras. The endpoints invert to black-on-white — the same
             primary-action language as Acknowledge and Apply. */
          return (
            <button
              key={day}
              type="button"
              onClick={() => pick(day)}
              aria-label={FULL_DAY.format(
                Date.UTC(
                  Number(day.slice(0, 4)),
                  Number(day.slice(5, 7)) - 1,
                  Number(day.slice(8, 10)),
                ),
              )}
              aria-pressed={edge || inside}
              className={`relative flex h-[32px] items-center justify-center text-[0.75rem] tabular-nums transition-colors ${
                inside ? "bg-white/10" : ""
              } ${isFrom && to ? "rounded-l-[6px]" : ""} ${
                isTo ? "rounded-r-[6px]" : ""
              } ${isFrom && !to ? "rounded-[6px]" : ""}`}
            >
              <span
                className={`flex size-[28px] items-center justify-center rounded-[6px] transition-colors ${
                  edge
                    ? "bg-white font-medium text-black"
                    : inside
                      ? "text-white"
                      : "text-white/70 hover:bg-white/8 hover:text-white"
                }`}
              >
                {Number(day.slice(8, 10))}
              </span>
              {/* Today keeps a marker even when it is inside the selection —
                  it is the operator's anchor for reading every other date. */}
              {day === today && !edge && (
                <span
                  aria-hidden
                  className="absolute bottom-[3px] size-[3px] rounded-full bg-white/50"
                />
              )}
            </button>
          );
        })}
      </div>

      <p className="pt-[10px] text-[0.75rem] text-white/40 tabular-nums">
        {from && to ? (
          <>
            <span className="text-white/75">{formatDayLabel(from)}</span> →{" "}
            <span className="text-white/75">{formatDayLabel(to)}</span>
          </>
        ) : from ? (
          <>
            <span className="text-white/75">{formatDayLabel(from)}</span> — pick
            an end date
          </>
        ) : (
          "Pick a start date"
        )}
      </p>
    </div>
  );
}
