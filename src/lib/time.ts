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

/**
 * Today's calendar day at the tower, as `YYYY-MM-DD`.
 *
 * The custom range filter compares these strings, so the calendar has to build
 * its grid around the *site's* today rather than the viewer's. An operator
 * watching Lagos from London is on a different date for five hours a day, and a
 * picker that highlights their today would quietly offer the wrong shift.
 */
export function siteToday(at: number = Date.now()) {
  return siteDay(at);
}

/** `Jul 26` from a `YYYY-MM-DD` site day. */
export function formatDayLabel(isoDay: string) {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
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

/** `Jul 25` — the timeline's date heading. */
export function formatSiteDate(at: number) {
  return dayMonth.format(at);
}

const stampDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "2-digit",
  timeZone: SITE_TZ,
});

const stampTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: SITE_TZ,
});

/**
 * The fleet wall's header stamp — `TUE 4 NOV 25` / `00:54:42`, split so the
 * date can sit muted beside a white time.
 *
 * Seconds, and therefore a ticking clock, which looks like the relative ages
 * this app threw out. It is not the same thing. What was removed was a *rail
 * full* of per-row counters, each one a separate moving target competing with
 * the video. This is one clock, in a fixed position, and it is the number an
 * operator reads out when they hand an incident over — a control room without
 * a visible site clock is the anomaly. Site time, labelled, like everything
 * else; see the note at the top of this file.
 */
export function formatSiteStamp(at: number) {
  return {
    // en-GB emits "Tue, 4 Nov 25"; the design carries no comma there.
    date: stampDate.format(at).replace(",", "").toUpperCase(),
    time: stampTime.format(at),
  };
}

/**
 * Elapsed time between two timeline steps — `+0s`, `+15s`, `+1m 04s`.
 *
 * The gutter already carries wall-clock, so this is not a second copy of the
 * time: it is the one quantity a wall-clock column cannot show at a glance.
 * When three detections land inside the same minute, the stamps are identical
 * and the sequence is unreadable; the gap between them is the whole finding.
 *
 * Measured from the first step, not the previous one, so the numbers accumulate
 * into "how long did this incident run" rather than resetting each row.
 */
export function formatDelta(from: number, at: number) {
  const total = Math.round((at - from) / 1000);
  if (total < 0) return "";
  if (total < 60) return `+${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `+${mins}m ${String(total % 60).padStart(2, "0")}s`;
  return `+${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** `15s`, `4m 30s` — an attachment's runtime, for the thumbnail pill. */
export function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${String(rem).padStart(2, "0")}s`;
}

/**
 * `06:47 WAT` — a wall-clock stamp without seconds, for lists that are scanned
 * rather than read. Seconds are the information on an incident timeline, where
 * three detections can share a minute; in a roster row they are four characters
 * of noise in the middle of a name and a place.
 */
export function formatClockShort(at: number) {
  return `${clockShort.format(at)} ${SITE_TZ_LABEL}`;
}

/**
 * Now, at the site.
 *
 * ⚠ THIS USED TO BE A CONSTANT — `SESSION_NOW = Date.now()`, captured once at
 * module load — and every alert date filter compared against it. On an
 * operator wall that stays open for a shift, "last 1 hour" therefore meant "the
 * hour before this tab was opened", and it drifted further from the truth with
 * every minute the screen stayed up. An alert that should have aged out of the
 * range stayed in it, and one that should have entered never appeared.
 *
 * It is a function so it cannot be captured by accident. A component that needs
 * the passage of time to be VISIBLE also has to re-render — see `useNow` — but
 * a stale render is a smaller wrong than a frozen clock, and any code path that
 * calls this fresh is now correct by default.
 */
export function siteNow(): number {
  return Date.now();
}

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
export function formatEventTime(at: number, now: number = siteNow()) {
  if (isSameSiteDay(at, now)) {
    return formatClock(at);
  }
  return `${dayMonth.format(at)}, ${clockShort.format(at)} ${SITE_TZ_LABEL}`;
}

/**
 * Relative age, for the new-alert banner only — deliberately the exception to
 * the rule above.
 *
 * The objection to relative times was a rail full of counters ticking against
 * the video wall. A banner is one line, it is transient, and its whole job is
 * to say *this just happened*, which is the one place recency beats a
 * quotable timestamp. It is rendered once when the alert arrives and never
 * re-ticked, so it still adds no motion.
 *
 * Do not reach for this in AlertRow or AlertDetail; those keep wall-clock.
 */
/**
 * How long a link has been up, as a DURATION — "3d 4h", "2h 14m", "6m".
 *
 * ⚠ NOT `formatRelative`, and the difference is the point. A relative age
 * ("3 days ago") replaces the instant and is the thing this file forbids
 * everywhere but two transient banners. A duration is a SECOND value shown
 * beside the wall-clock instant, not instead of it: the row says when the link
 * came up and how long it has held, and the operator can still radio the time
 * to the next shift.
 *
 * Coarsens as it grows because the precision stops meaning anything: seconds
 * matter for a link that just came up and are noise on one that has held for a
 * week. Under a minute reads "just now" rather than counting seconds, since a
 * tower that connected four seconds ago is better described than measured.
 */
/**
 * `2026-09-04_19-42-13` — a timestamp for a FILENAME, in site time.
 *
 * Sortable by design: a directory of these orders chronologically with no
 * sorting, which a `19-42-13_2026-09-04` never would. Hyphens rather than
 * colons because a colon is illegal in a Windows filename and silently
 * mangled by some tools on the others.
 *
 * 24-hour, so a still taken at 07:42 and one at 19:42 cannot land on the same
 * name — the one place in this app where am/pm would be an actual collision
 * rather than a readability preference.
 *
 * Site time, like every other stamp here: a frame captured at a Nigerian site
 * and opened in London has to say when it was taken THERE, and unlike a screen
 * this one travels with the file.
 */
export function siteFileStamp(at: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: SITE_TZ,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}-${get("minute")}-${get("second")}`;
}

export function formatUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  }
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}

export function formatRelative(at: number, now: number = Date.now()) {
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// ===========================================================================
// LOCAL timezone — the PLAYBACK RECORDINGS LIST only.
//
// ⚠ DELIBERATELY THE VIEWER'S OWN ZONE, against this file's site-TZ rule above.
// The recordings API returns UTC starts, and archived footage was looking
// "missing" because operators reasoned about the date filter in their own zone
// while the list showed another. For a browsable archive the useful frame is
// "what time was it where I am", and the date filter and the row times must
// agree with each other and with the calendar the operator picks from. So this
// one screen renders in the local zone, LABELLED, rather than WAT. The live
// wall, incidents and rosters keep site time — this is scoped to the archive.
// ===========================================================================

/** The viewer's local timezone abbreviation, e.g. `GMT+1`, `EST`. */
export const LOCAL_TZ_LABEL: string =
  new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(Date.now())
    .find((p) => p.type === "timeZoneName")?.value ?? "local";

const localDayFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit",
});
const localTimeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
});

/** Calendar day in the VIEWER's local zone, `YYYY-MM-DD` — the list's grouping key. */
export function localDay(at: number): string {
  return localDayFmt.format(at);
}

/** The viewer's local today, `YYYY-MM-DD` — the date filter's natural default. */
export function localToday(at: number = Date.now()): string {
  return localDay(at);
}

/** `2:33:12 PM` in local time — a recording row's start. */
export function formatLocalTime(at: number): string {
  return localTimeFmt.format(at);
}

/**
 * A date header for the recordings list: `Today`, `Yesterday`, else
 * `Thursday, September 18, 2026` — from a `YYYY-MM-DD` LOCAL day string.
 */
export function formatLocalDayHeader(isoLocalDay: string): string {
  if (isoLocalDay === localToday()) return "Today";
  const y0 = new Date(); y0.setDate(y0.getDate() - 1);
  if (isoLocalDay === localDay(y0.getTime())) return "Yesterday";
  const [y, m, d] = isoLocalDay.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
}

/** `15 min`, `20 sec`, `1 hr 5 min` — a recording's length, spelled for a list. */
export function formatRecordingLength(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} sec`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

/** `45.2 MB`, `900 KB` — a recording's size for a list, or `""` when unknown. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
