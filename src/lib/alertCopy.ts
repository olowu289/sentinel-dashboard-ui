import type { SiteAlert } from "@kallon/sentry-sdk";
import { deviceName } from "./deviceName";
import { formatClock } from "./time";

/**
 * EVERY WORD AN ALERT IS READ IN. One module, because the server sends none.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THERE IS NO `message` FIELD, AND THAT IS THE POINT
 * ══════════════════════════════════════════════════════════════════════
 *
 * sentry-core raises an alert with a `type` and a `colour` and nothing a
 * customer can read (docs/alerts.md §1, §9). Both are CODES. The website owns
 * every sentence, from one place, in one voice — and the easiest way to keep
 * the first writing rule is to have nothing on the wire that could break it.
 *
 * So this file is the whole vocabulary, and the hub's own note about it is
 * honoured here: `TOWER_OFFLINE` reads **"offline"**, never "down". A hub
 * cannot tell a dead tower from a dead radio link, and "down" asserts the
 * first. One word, and it is the difference between a reading and a guess.
 *
 * ── A TYPE WE HAVE NEVER HEARD OF STILL APPEARS ───────────────────────
 *
 * ⚠ NO `switch` HERE MAY THROW, RETURN EMPTY, OR DROP A ROW. A newer hub
 * forwards a type this bundle was built before, which is why the list endpoint
 * sends a `colours` map at all. An unknown type gets a generic line and the
 * colour the server picked for it, and it is the generic line that matters:
 * an operator seeing "Something happened at WEST TOWER" goes and looks, and an
 * operator seeing nothing does not.
 *
 * ── AND THE COLOUR IS THE SERVER'S ────────────────────────────────────
 *
 * The map below is colour KEY to design token, not type to token. Keying it by
 * type would make this bundle the authority on which alert is red, and a hub
 * that disagreed would be overruled by whatever the website last shipped.
 */

/** A name for one device id, or `undefined` when the fleet has no such tower. */
export type NameOf = (deviceId: string) => string | undefined;

/**
 * What a colour key is drawn in.
 *
 * ⚠ KEYED BY THE SERVER'S WORD, NOT BY ALERT TYPE. Three of the five land on
 * colours this product already spends, and they land on them for the house
 * reason rather than by coincidence: a tower that is BACK is green because
 * green means live, a camera that stopped is amber because amber means
 * degraded, a tower that is gone is red because red means fault. The two the
 * recovery pair needs are their own tokens — see the note in `index.css`.
 */
export const ALERT_COLOUR: Readonly<
  Record<string, { readonly text: string; readonly strip: string }>
> = {
  red: { text: "text-critical", strip: "bg-critical" },
  orange: { text: "text-detect", strip: "bg-detect" },
  green: { text: "text-terra", strip: "bg-terra" },
  purple: { text: "text-recovering", strip: "bg-recovering" },
  teal: { text: "text-recovered", strip: "bg-recovered" },
  /* The server's own answer for a type IT could not name either. Neutral, and
     deliberately not a sixth hue: an alert nobody can classify must not be
     given a severity by the thing that cannot classify it. */
  grey: { text: "text-muted", strip: "bg-muted" },
};

const NEUTRAL = ALERT_COLOUR.grey;

/** The tokens for one alert's colour, falling back to neutral for a new hue. */
export function alertColour(colour: string | undefined): {
  text: string;
  strip: string;
} {
  return ALERT_COLOUR[colour ?? ""] ?? NEUTRAL;
}

/**
 * The 28px badge an alert draws, as one of the app's existing kinds.
 *
 * ⚠ THE DETECTION KINDS STAY, AND NOTHING RAISES ONE TODAY. `person`,
 * `vehicle` and `speaker` are the vocabulary a detection feed will arrive in
 * and the rows, the timeline steps and the clip cards are all built on them.
 * Coordination raises five kinds and none of them is a detection, so every
 * live alert lands on `fault` or `alert` — and the day detections exist, this
 * function gains lines rather than the app gaining a second icon set.
 */
export function alertKind(type: string): "alert" | "fault" {
  switch (type) {
    case "TOWER_OFFLINE":
    case "CAMERA_STOPPED":
      return "fault";
    default:
      /* A tower coming back, footage catching up, and anything a newer hub
         sends. None is a fault, and the general badge is the honest one. */
      return "alert";
  }
}

/** The tower's name in capitals, or the id when the fleet does not hold it. */
function towerName(alert: SiteAlert, nameOf?: NameOf): string {
  /* ⚠ THROUGH `deviceName`, LIKE EVERY OTHER PLACE A DEVICE IS NAMED. A title
     is a string built in JavaScript, so a `uppercase` class would never reach
     it — which is the exact failure that rule was written for, and an alert
     title is read out on a radio. */
  return deviceName(nameOf?.(alert.device_id) || alert.device_id);
}

/**
 * The camera's name, for `CAMERA_STOPPED`.
 *
 * `cameras` is absent when there are none and plural because `TOWER_OFFLINE`
 * is about every camera on the mast. A stopped camera has exactly one, and a
 * list that somehow has more is named by the first rather than by a join: the
 * title is one line and the detail below it carries the rest.
 */
function cameraName(alert: SiteAlert, nameOf?: NameOf): string {
  const n = alert.cameras?.[0];
  if (n === undefined) return towerName(alert, nameOf);
  return deviceName(`Camera ${n}`);
}

/**
 * The line that names what happened. The only sentence an alert row shows.
 *
 * One clause, no punctuation at the end, and no code in it anywhere.
 */
export function alertTitle(alert: SiteAlert, nameOf?: NameOf): string {
  const tower = towerName(alert, nameOf);
  switch (alert.type) {
    case "TOWER_OFFLINE":
      /* ⚠ "offline", NEVER "down". docs/alerts.md §1: a hub cannot tell a dead
         tower from a dead radio link, and "down" asserts the first. */
      return `${tower} offline`;
    case "CAMERA_STOPPED": {
      const camera = cameraName(alert, nameOf);
      const base = `${camera} camera stopped working`;
      /* Recovery is written onto the SAME row rather than raising a second
         alert, so the title has to carry both halves: a flapping camera does
         not produce a thousand rows, and the one row has to say it came back.
         Wall clock, in site time, like every other stamp in this app. */
      return alert.recovered_at
        ? `${base}. Back at ${formatClock(Date.parse(alert.recovered_at))}`
        : base;
    }
    case "TOWER_ONLINE":
      return `${tower} back online`;
    case "FOOTAGE_RECOVERING":
      return `Recovering footage from ${tower}`;
    case "FOOTAGE_RECOVERED":
      return `Footage recovered from ${tower}`;
    default:
      /* ⚠ A SENTENCE, NOT THE CODE. `FOOTAGE_SYNC_BEHIND` on a customer's
         screen is rule 3 broken in the loudest possible place. This says the
         true part — something happened, here, and the server thought it worth
         telling you — and the colour beside it is the server's own. */
      return `Something happened at ${tower}`;
  }
}

/**
 * The second line on a recovery alert: how much is left, and how long.
 *
 * `undefined` for every other type, and for a recovery whose `progress` block
 * has not arrived or has emptied. Absence here is a line that is not drawn,
 * not a line reading "unknown" — the title already says footage is being
 * recovered, and a progress line with no progress in it adds nothing.
 */
export function recoveryDetail(alert: SiteAlert): string | undefined {
  const p = alert.progress;
  if (!p) return undefined;
  const parts: string[] = [];
  if (typeof p.files_left === "number" && p.files_left > 0) {
    parts.push(`${p.files_left} ${p.files_left === 1 ? "file" : "files"}`);
  }
  if (typeof p.eta_sec === "number" && p.eta_sec > 0) {
    /* ⚠ "about", ALWAYS. An ETA over a radio link whose rate changes with the
       weather is an estimate, and a bare "14 min left" is read as a promise.
       The hub computes it from the current drain rate, which is the best
       anybody can do and is still not a measurement. */
    const mins = Math.max(1, Math.round(p.eta_sec / 60));
    parts.push(`about ${mins} min left`);
  }
  /* A comma between the halves of one line, never an em-dash. */
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * 0 to 1 for the bar on a recovery alert, or `undefined` when there is none.
 *
 * ⚠ NOT DERIVED FROM `files_left`. The hub sends `progress` because it knows
 * the denominator — how big the backlog was when the recovery armed — and this
 * side does not: a bar computed from a falling file count against a total
 * nobody told us would run backwards the moment the tower wrote a new segment
 * while the old ones drained.
 */
export function recoveryProgress(alert: SiteAlert): number | undefined {
  const p = alert.progress?.progress;
  if (typeof p !== "number" || !Number.isFinite(p)) return undefined;
  return Math.min(1, Math.max(0, p));
}

/** `Standard` / `2K`, for the badge on a clip. Never the machine value. */
export function qualityLabel(quality: string | undefined): string {
  if (quality === "2k") return "2K";
  if (quality === "standard") return "Standard";
  /* A quality a newer hub cut at. Shown as nothing rather than as its code:
     the badge disappears and the clip still plays, which is the right failure.
     Showing `h265_low` on a clip card is rule 3 in one word. */
  return "";
}
