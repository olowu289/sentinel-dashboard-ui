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

/**
 * A name for one device id, or `undefined` when nothing here holds that device.
 *
 * ⚠ THE TYPE IS PASSED BECAUSE THE ID ALONE DOES NOT SAY WHAT IT NAMES.
 * `HUB_OFFLINE` and `HUB_ONLINE` are raised by the data centre about a HUB,
 * and `device_id` carries the hub's id on those rows (docs/alerts.md §1a: "a
 * hub is not a device, and that is the one thing the alert table had to
 * absorb"). A hub is not in the fleet — the fleet holds its MAST, under a
 * different id — so looking one up there answers `undefined` for a box that
 * has a perfectly good name somebody chose, and the screen falls back to
 * `HUB-KLN-LAB`. The resolver needs to know which list to ask, and the type is
 * the only thing that says.
 *
 * Second argument, not a second function, so every existing caller is still
 * correct: a resolver that ignores it answers for towers exactly as before.
 */
export type NameOf = (
  deviceId: string,
  type?: string,
) => string | undefined;

/**
 * Is this alert's `device_id` a HUB rather than a tower?
 *
 * The one place that decides it. Both tiers raise about towers; only the data
 * centre raises about a hub, from the uplink monitoring it already does.
 */
export function isHubAlert(type: string | undefined): boolean {
  return type === "HUB_OFFLINE" || type === "HUB_ONLINE";
}

/**
 * THE CUSTOMER'S OWN NAME for one camera, or `undefined` when it has none.
 *
 * ⚠ THE CUSTOMER'S, NOT THE FALLBACK. `CameraFeed.name` is always populated
 * — it is the label or `CAMERA 2` — and that is the right field for a tile
 * caption and the wrong one here, because this has to tell a camera somebody
 * NAMED from one nobody did. A named camera is spoken about by its name
 * ("NORTH GATE camera stopped working") and an unnamed one by its number
 * ("CAMERA 1 stopped working"), and those are two different sentences rather
 * than one sentence with a variable in it. `CameraFeed.label` is the field
 * that answers, and it exists for exactly this distinction.
 */
export type CameraNameOf = (
  deviceId: string,
  camera: number,
) => string | undefined;

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
    /* A hub that stopped answering is the same reading one tier up, and it
       is the worse one: a tower going quiet loses a mast, a hub going quiet
       loses the site's whole link to anybody watching it. */
    case "HUB_OFFLINE":
      return "fault";
    default:
      /* A tower coming back, footage catching up, and anything a newer hub
         sends. None is a fault, and the general badge is the honest one. */
      return "alert";
  }
}

/**
 * What this alert is ABOUT, named, in capitals.
 *
 * A tower for seven of the types and a HUB for two of them, which is why the
 * type goes to the resolver — see {@link NameOf}. The id is the fallback in
 * both cases: `KLN_LAB_000002` or `HUB-KLN-LAB` is a poor name and is still
 * better than a sentence with a hole in it.
 *
 * ⚠ THROUGH `deviceName`, LIKE EVERY OTHER PLACE A DEVICE IS NAMED. A title
 * is a string built in JavaScript, so a `uppercase` class would never reach
 * it — which is the exact failure that rule was written for, and an alert
 * title is read out on a radio. A hub is a box at a site with a label on it,
 * so it is a device name and it shouts like one; the organization that owns
 * it is not, and is left alone.
 */
export function alertDeviceName(alert: SiteAlert, nameOf?: NameOf): string {
  return deviceName(nameOf?.(alert.device_id, alert.type) || alert.device_id);
}

/**
 * One camera's name, as a screen says it.
 *
 * Returns the customer's own name when there is one and `CAMERA 1` when there
 * is not, both in capitals, because both are a device's name.
 */
export function cameraLabel(
  deviceId: string,
  camera: number,
  cameraNameOf?: CameraNameOf,
): string {
  return deviceName(cameraNameOf?.(deviceId, camera) || `Camera ${camera}`);
}

/**
 * Does this name already say "camera"?
 *
 * Whole word and case-blind. `CAMERA 1`, `North gate camera` and `Gate
 * camera-2` all do; `CAMERAS` and `Cameraman Hill` do not, which is why this
 * is a word boundary and not `includes`.
 */
const SAYS_CAMERA = /\bcameras?\b/i;

/**
 * A camera, named as the subject of a sentence about it.
 *
 * ⚠ THE WORD "camera" IS PART OF THE NAME OR PART OF THE SENTENCE, NEVER
 * BOTH — and this function is the only thing that decides which. "CAMERA 1
 * camera stopped working" shipped, because a template with a variable in it
 * doubles the noun the moment the value already contains it.
 *
 * There are three cases and they are all the same rule:
 *
 *   NORTH GATE          a place. The sentence supplies the noun:
 *                       "NORTH GATE camera stopped working".
 *   CAMERA 1            the unnamed fallback. Already carries it:
 *                       "CAMERA 1 stopped working".
 *   TEST GATE CAMERA    somebody put the word in the name themselves, which
 *                       is ordinary and common. Also already carries it:
 *                       "TEST GATE CAMERA stopped working".
 *
 * The third is why this is a test on the NAME rather than a branch on whether
 * one was set: the fallback is not the only value that can contain the noun,
 * and treating it as the only one is how the bug comes back wearing a
 * customer's own label.
 */
export function cameraSubject(name: string): string {
  return SAYS_CAMERA.test(name) ? name : `${name} camera`;
}

/**
 * The subject clause of a `CAMERA_STOPPED` title.
 *
 * `cameras` is absent when there are none and plural because `TOWER_OFFLINE`
 * is about every camera on the mast. A stopped camera has exactly one, and a
 * list that somehow has more is named by the first: the title is one line and
 * the cells below it carry the rest.
 */
function stoppedSubject(
  alert: SiteAlert,
  nameOf?: NameOf,
  cameraNameOf?: CameraNameOf,
): string {
  const n = alert.cameras?.[0];
  /* No camera named at all, so the mast is the subject — and a mast called
     SOUTH CAMERA MAST gets the same treatment as a camera called one. */
  if (n === undefined) return cameraSubject(alertDeviceName(alert, nameOf));
  return cameraSubject(cameraLabel(alert.device_id, n, cameraNameOf));
}

/**
 * The line that names what happened. The only sentence an alert row shows.
 *
 * One clause, no punctuation at the end, and no code in it anywhere.
 */
export function alertTitle(
  alert: SiteAlert,
  nameOf?: NameOf,
  cameraNameOf?: CameraNameOf,
): string {
  const tower = alertDeviceName(alert, nameOf);
  switch (alert.type) {
    case "TOWER_OFFLINE":
      /* ⚠ "offline", NEVER "down". docs/alerts.md §1: a hub cannot tell a dead
         tower from a dead radio link, and "down" asserts the first. */
      return `${tower} offline`;
    case "CAMERA_STOPPED": {
      const base = `${stoppedSubject(alert, nameOf, cameraNameOf)} stopped working`;
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
    /* ⚠ THE SAME TWO SENTENCES ONE TIER UP, AND "offline" MATTERS MORE HERE
       THAN IT DOES FOR A TOWER. The data centre cannot tell a dead hub from
       a dead internet link; all it saw was a socket stop answering, and the
       box on the other end may be serving its own site perfectly over the
       LAN — recording, watching, raising its own alerts. "Down" would be a
       claim about the hub. "Offline" is a claim about the link, which is all
       there is evidence for. */
    case "HUB_OFFLINE":
      return `${tower} offline`;
    case "HUB_ONLINE":
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

/**
 * How many characters of an alert id a person reads.
 *
 * Six, from a 32-character hex id. The job is to be sayable on a radio and
 * unambiguous in one control room's feed, not to be globally unique — the
 * full id is still what every request carries, and is one copy away.
 */
export const SHORT_ID_CHARS = 6;

/**
 * The id a person reads, in the shape the rest of this app uses: `ALT-8842`.
 *
 * ⚠ THE RAW ID IS NOT A LABEL. `95ae76a8085641718fc1a64cbda85280` shipped in
 * the detail header, where the design puts the short reference somebody reads
 * out during a handoff. Thirty-two hex characters cannot be read aloud, cannot
 * be compared by eye against another screen, and overflow the line they sit
 * on. That is rule 3: a value that only makes sense once you know how the
 * system is built is not a value a customer can use.
 *
 * Shortened for READING ONLY. Nothing is addressed by this — every request
 * still carries `alert.id` — and the header keeps the full id on the clipboard
 * so the one person who needs it (us, in a log) can still get it.
 */
export function shortAlertId(id: string): string {
  const head = id.replace(/[^0-9a-zA-Z]/g, "").slice(0, SHORT_ID_CHARS);
  return `ALT-${head.toUpperCase()}`;
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

/* ====================================================================== *
 *  THE FOUR WAYS A CLIP CAN BE, AND THE THREE WAYS IT CAN BE ABSENT
 * ====================================================================== */

/** Does this alert ever get a clip? §9: the recovery pair never does. */
export function expectsClip(type: string): boolean {
  return type !== "FOOTAGE_RECOVERING" && type !== "FOOTAGE_RECOVERED";
}

/**
 * The hub's own answer about the footage for this moment, when it gave one.
 *
 * ⚠ THIS FIELD DOES NOT REACH US YET, AND THE GAP IS IN THE SDK. `progress`
 * is parsed by `@kallon/sentry-sdk` as four NUMBERS (`files_left`,
 * `bytes_left`, `progress`, `eta_sec`) and anything else in the block is
 * dropped on the floor — so `progress.footage: "none"`, which docs/alerts.md
 * §3b says is how a hub reports that it has no recording covering the
 * instant, never arrives. The SDK is vendored from a repository that is the
 * source of truth and is not edited here (`scripts/check-vendored-sdk.mjs`
 * fails the build if it is), so the change belongs there: one optional
 * `footage?: string` on `AlertProgress` and one line in `progress()` to carry
 * it through.
 *
 * The cast is what lets this side be finished and correct in the meantime:
 * the field is read if it is there, "No footage of that moment" is written,
 * and the day the SDK passes it along nothing here has to change. Until then
 * {@link clipState} answers `pending` for a hub alert with no clips, which is
 * the true reading — the hub has not answered yet, as far as anything on this
 * side can tell.
 */
export function footageAnswer(alert: SiteAlert): string | undefined {
  const value = (alert.progress as { footage?: unknown } | undefined)?.footage;
  return typeof value === "string" ? value : undefined;
}

/**
 * What there is to watch, as one word.
 *
 * ⚠ FOUR OF THESE ARE "THERE IS NO PICTURE" AND THEY ARE NOT THE SAME THING,
 * which is the whole reason this is a state rather than a boolean. Each sends
 * an operator somewhere different: one is waiting (the cut lands in a
 * minute), one is waiting for something that may take WEEKS (the hub is off
 * the internet and the footage is on it), one is a file nobody can reach from
 * this tier, and one is a hub that has answered and has nothing. "No clip"
 * for all four would be the same screen for four different situations, three
 * of which somebody should act on.
 */
export type ClipState =
  /** At least one clip with a URL. The player, as always. */
  | "playable"
  /** Clips exist and are described, and none can be fetched from here. */
  | "hubOnly"
  /** A hub alert whose footage is still on the hub that went away. */
  | "pending"
  /** The hub answered, and had no recording covering that moment. */
  | "none"
  /** An ordinary alert whose cut has not landed yet. A minute, at most. */
  | "coming"
  /** The recovery pair, which has no moment to cut around. */
  | "never";

/**
 * Which of the six this alert is in.
 *
 * Read off the alert alone, so the row, the detail and the timeline cannot
 * disagree about whether there is anything to watch.
 */
export function clipState(alert: SiteAlert): ClipState {
  if (!expectsClip(alert.type)) return "never";
  const clips = alert.clips ?? [];
  /* One playable clip is a playable alert. A mast with two cameras where only
     one cut reached the bucket shows that one rather than refusing both. */
  if (clips.some((c) => c.url)) return "playable";
  if (clips.length > 0) return "hubOnly";
  /* An ANSWER, not a failure (§3b). The hub was asked, looked, and had
     nothing: the disk was full, the camera was not recording, the box was
     rebuilt. The pending row is deleted, so nothing is still coming. */
  if (footageAnswer(alert) === "none") return "none";
  /* ⚠ AND A HUB ALERT'S "NOT YET" IS NOT A MINUTE. `HUB_OFFLINE` is the one
     alert whose clip cannot be cut when it is raised: the footage is on the
     hub, which is the thing that just went away, and the data centre keeps no
     video at all. Nothing polls for it and nothing expires — the hub cuts it
     when it dials back in, which may be after a fortnight on a mast with a
     flat battery or a SIM to replace. "Clip coming" would be a promise about
     the next minute. */
  if (isHubAlert(alert.type)) return "pending";
  return "coming";
}

/** What a state with no picture in it says. One headline, one line of help. */
export interface ClipWords {
  headline: string;
  help: string;
}

/**
 * The sentence for each absence.
 *
 * ⚠ ABSENCE IS DIAGNOSTIC — it says WHY, and the why is the thing that
 * decides what somebody does next. "Clip on the hub only" sends them to the
 * screen in the control room, which can play it; "Footage pending" tells them
 * to stop waiting for it today; "No footage of that moment" tells them to
 * stop waiting for it at all.
 */
/* Overloaded so the two states that HAVE a picture are the only ones a
   caller has to null-check. `clipWords("none")` is a sentence by
   construction, and writing `!` at the call site to say so is how a real
   null slips past later. */
export function clipWords(state: "playable" | "never"): null;
export function clipWords(
  state: Exclude<ClipState, "playable" | "never">,
): ClipWords;
export function clipWords(state: ClipState): ClipWords | null;
export function clipWords(state: ClipState): ClipWords | null {
  switch (state) {
    case "hubOnly":
      /* The bytes are at the site and only the site can serve them. Not an
         error and not a fault: the data centre stores no video by design
         (§3a), and with no bucket configured there is simply no URL to give.
         The dashboard in the control room plays it from its own disk. */
      return {
        headline: "Clip on the hub only",
        help: "Watch it on the screen at the site.",
      };
    case "pending":
      return {
        headline: "Footage pending, the hub is away",
        help: "It arrives when the hub connects again.",
      };
    case "none":
      return {
        headline: "No footage of that moment",
        help: "The hub had no recording covering it.",
      };
    case "coming":
      return { headline: "Clip coming", help: "The site is cutting it now." };
    default:
      /* `playable` has a picture and `never` has no clip area at all. */
      return null;
  }
}
