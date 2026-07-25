/**
 * Every timestamp in the portal is rendered in one fixed zone and labelled with
 * it. Operators hand incidents off by radio across shifts and regions; a time
 * that silently follows the viewer's machine is worse than no time at all.
 */
export const SITE_TZ = "Africa/Lagos";
export const SITE_TZ_LABEL = "WAT";

const clock = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: SITE_TZ,
});

const clockShort = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: SITE_TZ,
});

const dayMonth = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: SITE_TZ,
});

/** Calendar day in site time, e.g. "2026-07-25" — used for same-day tests. */
function siteDay(at: number) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: SITE_TZ,
  }).format(at);
}

export function isSameSiteDay(a: number, b: number) {
  return siteDay(a) === siteDay(b);
}

/** `11:10:11 PM WAT` */
export function formatClock(at: number) {
  return `${clock.format(at)} ${SITE_TZ_LABEL}`;
}

const clock24 = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SITE_TZ,
});

/** `23:10` — the timeline gutter, where 24h reads faster than AM/PM. */
export function formatClock24(at: number) {
  return clock24.format(at);
}

/** Captured once at load. Nothing in the feed re-renders off the clock. */
export const SESSION_NOW = Date.now();

/**
 * What a feed row shows: a fixed wall-clock time, always. Relative ages were
 * tried and removed — a counter that ticks is motion, and motion in the alert
 * rail competes with the video wall for the operator's eye. A timestamp is
 * also what gets read out on a handoff; "18 seconds ago" is unquotable and
 * wrong the moment it is spoken.
 *
 * Events off today's date carry the date too, so a row can never be misread as
 * having happened this shift.
 */
export function formatEventTime(at: number) {
  if (isSameSiteDay(at, SESSION_NOW)) {
    return formatClock(at);
  }
  return `${dayMonth.format(at)}, ${clockShort.format(at)} ${SITE_TZ_LABEL}`;
}
