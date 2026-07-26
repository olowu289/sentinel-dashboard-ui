import type { Alert } from "./types";
import { SITE_TZ, formatDayLabel, isSameSiteDay } from "./time";

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
        timeZone: SITE_TZ,
      }).format(at);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    }
  }
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
