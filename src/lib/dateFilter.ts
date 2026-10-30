import type { Alert } from "./types";
import {
  formatDayLabel,
  isSameSiteDay,
  siteDayStart,
  siteToday,
  siteTz,
} from "./time";

export type RangeId = "all" | "1h" | "today" | "24h" | "7d" | "custom";

export const RANGES: { id: Exclude<RangeId, "custom">; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "1h", label: "Last hour" },
  { id: "today", label: "Today" },
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
];

export interface DateFilter {
  range: RangeId;
  /** Inclusive `YYYY-MM-DD` bounds in site time, only when range is custom. */
  from?: string;
  to?: string;
}

export const NO_FILTER: DateFilter = { range: "all" };

export function isFiltered(f: DateFilter) {
  return f.range !== "all";
}

/**
 * "Today" is the site's calendar day, not a rolling 24 hours — an operator
 * asking what happened today means since midnight at the tower, and the two
 * answers differ by up to a full day.
 */
function inRange(at: number, f: DateFilter, now: number) {
  switch (f.range) {
    case "all":
      return true;
    case "1h":
      return at >= now - 60 * 60 * 1000;
    case "24h":
      return at >= now - 24 * 60 * 60 * 1000;
    case "7d":
      return at >= now - 7 * 24 * 60 * 60 * 1000;
    case "today":
      return isSameSiteDay(at, now);
    case "custom": {
      const day = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: siteTz(),
      }).format(at);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    }
  }
}

/**
 * The NEAR END of a filter, as an instant. `null` when it has none.
 *
 * ⚠ THE SAME `now` THAT BUILT THE LIST, OR THE TWO DISAGREE. Three of the
 * presets are a rolling window off the current moment, and `inRange` above
 * tests `at >= now - window` with exactly this arithmetic — so a caller that
 * filters a list and then computes its lower bound a second later has a bound
 * a second newer than the list it describes. Pass the clock you rendered
 * with, and the two are the same statement.
 *
 * "Today" is the site's calendar day, not the viewer's and not a rolling
 * twenty-four hours, for the reason `inRange` records: an operator asking
 * what happened today means since midnight at the tower.
 */
export function filterStart(f: DateFilter, now: number): number | null {
  switch (f.range) {
    case "all":
      return null;
    case "1h":
      return now - 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "today":
      return siteDayStart(siteToday(now)) * 1000;
    case "custom":
      /* A `to` with no `from` is "everything up to a date", which has no near
         end. The far end is not this function's business and does not need to
         be: whoever is asking has an anchor of their own, and the newest row
         on a screen filtered to last Tuesday IS last Tuesday. */
      return f.from ? siteDayStart(f.from) * 1000 : null;
  }
}

/**
 * The same bound as a timestamp for the wire, or `undefined` for no bound.
 *
 * ⚠ UTC, SAID OUT LOUD. `toISOString` ends in `Z`, which is an offset of zero
 * stated rather than left to whatever is reading it — and every time in this
 * system is UTC: an alert's start, a segment's filename, a sweep's window.
 * The one thing that must not go on the wire here is a local wall clock with
 * no offset at all, because the machine answering would read it as its own
 * and acknowledge a window up to an hour away from the one on screen.
 *
 * The instant is the honest unit either way. The filter is expressed in site
 * days and rolling hours, which are two different kinds of thing; converting
 * both to a moment is what makes them one bound.
 */
export function filterFromIso(
  f: DateFilter,
  now: number,
): string | undefined {
  const start = filterStart(f, now);
  return start === null ? undefined : new Date(start).toISOString();
}

export function applyDateFilter(
  alerts: Alert[],
  f: DateFilter,
  now: number,
): Alert[] {
  if (!isFiltered(f)) return alerts;
  return alerts.filter((a) => inRange(a.at, f, now));
}

/* `Jul 20 → Jul 26`, not `2026-07-20 → 2026-07-26`. ISO is the storage and
   comparison format and stays that way; the chip is read at a glance beside a
   result count, where two full ISO dates are mostly punctuation. */
export function filterLabel(f: DateFilter) {
  if (f.range === "custom") {
    if (f.from && f.to)
      return `${formatDayLabel(f.from)} → ${formatDayLabel(f.to)}`;
    if (f.from) return `From ${formatDayLabel(f.from)}`;
    if (f.to) return `Until ${formatDayLabel(f.to)}`;
    return "Custom range";
  }
  return RANGES.find((r) => r.id === f.range)?.label ?? "All time";
}
