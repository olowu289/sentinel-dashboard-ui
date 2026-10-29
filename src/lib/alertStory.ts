import type { AlertClip, SiteAlert } from "@kallon/sentry-sdk";
import {
  alertDeviceName,
  cameraLabel,
  cameraSubject,
  clipState,
  clipWords,
  expectsClip,
  isHubAlert,
  qualityLabel,
  type CameraNameOf,
  type NameOf,
} from "./alertCopy";
import type { AlertAttachment } from "./types";

/**
 * WHAT HAPPENED, IN ORDER, AND WHAT THERE IS TO WATCH OF IT.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  TWO THINGS A SERVER ALERT HAS THAT ITS ROW CANNOT SHOW
 * ══════════════════════════════════════════════════════════════════════
 *
 * An alert row is one clause. The detail has room for the sequence and for
 * the evidence, and both have to be built rather than read: coordination
 * sends four timestamps and a list of clips, and nothing that says what any
 * of them means. This module turns those into the two shapes the existing
 * components already take — `TimelineEvent` for the steps and
 * `AlertAttachment` for the panes — so that a real alert is reviewed with the
 * SAME player the detection alerts use rather than a second one built beside
 * it.
 *
 * ── EVERY STAMP HERE IS THE SERVER'S, WITH ONE DERIVATION ─────────────
 *
 * ⚠ `started_at` IS THE EVENT, NOT THE RAISE, and the gap between them is the
 * one number on this timeline this side computes. The hub waits
 * `DEBOUNCE_SEC` (60) before raising anything, because a radio blips and a
 * dome reboots several times a day on a healthy site and an alert per blip is
 * an alert channel nobody reads — and it stamps the alert at the EVENT so the
 * clip window lands on the minute before it rather than on the minute of dead
 * feed after it.
 *
 * So "Alert raised" is `started_at + 60 s`. That is a fixed, documented
 * constant on the server (docs/alerts.md §1) rather than a guess, and it is
 * the only step here not read straight off a field. If the hub ever makes the
 * debounce configurable, this becomes a lie and has to come from the wire.
 */

/** The hub's debounce, in seconds. `sitealerts.DEBOUNCE_SEC`. */
export const DEBOUNCE_SEC = 60;

/**
 * One step, as the detail draws it.
 *
 * ⚠ `at` IS NULLABLE HERE AND IS NOT IN `TimelineEvent`, which is the whole
 * reason this is its own type. The 2K upgrade is a real step with no moment:
 * the hub attaches the better clip during a sweep and the row carries no
 * stamp for when. A timeline that invented one would put a wall-clock time on
 * a handoff line that nothing can corroborate; a timeline that dropped the
 * step would leave an operator wondering why the quality badge changed.
 */
export interface AlertStep {
  /** Epoch ms, or `null` for a step the server gave no time for. */
  at: number | null;
  title: string;
}

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** What stopped, in the words the first step needs. */
function subjectOf(
  alert: SiteAlert,
  nameOf?: NameOf,
  cameraNameOf?: CameraNameOf,
): string {
  const tower = alertDeviceName(alert, nameOf);
  const camera = alert.cameras?.[0];
  if (alert.type === "CAMERA_STOPPED" && camera !== undefined) {
    /* ⚠ THROUGH `cameraSubject`, LIKE THE TITLE. This line appended the noun
       unconditionally, so the timeline read "Frames stopped arriving from
       CAMERA 1 camera" for an unnamed camera even after the title was fixed
       — the same bug, surviving in the second place that writes the same
       clause. One function decides it now. */
    return cameraSubject(cameraLabel(alert.device_id, camera, cameraNameOf));
  }
  return tower;
}

/**
 * The sequence, oldest first.
 *
 * Only steps that actually happened. An alert still open has no "Back", one
 * nobody has touched has no "Acknowledged by", and neither gets a greyed row
 * saying so: a timeline is a record of events, and a placeholder for an event
 * that has not occurred is the one thing on it that is not a record.
 */
export function alertStory(
  alert: SiteAlert,
  nameOf?: NameOf,
  cameraNameOf?: CameraNameOf,
): AlertStep[] {
  const steps: AlertStep[] = [];
  const subject = subjectOf(alert, nameOf, cameraNameOf);
  const started = alert.started_epoch * 1000;

  switch (alert.type) {
    case "CAMERA_STOPPED":
      steps.push({ at: started, title: `Frames stopped arriving from ${subject}` });
      break;
    case "TOWER_OFFLINE":
      /* The link IS the presence signal, so the drop is observed the instant
         the socket goes. No "roughly" about this one, unlike a camera's
         liveness, which arrives on a 15-second heartbeat. */
      steps.push({ at: started, title: `${subject} stopped answering` });
      break;
    case "TOWER_ONLINE":
      steps.push({ at: started, title: `${subject} answered again` });
      break;
    /* ⚠ NO NAME IN EITHER OF THESE, UNLIKE EVERY STEP ABOVE. A tower alert's
       first line has to say WHICH mast, because a site has several and the
       timeline is read beside a title that names only one of them. A hub
       alert is about the box the whole site hangs off: there is one, the
       header already names it, and "HUB-KLN-LAB stopped connecting" under a
       heading reading "NORTH CAMP offline" is the same fact twice in two
       different words for it. */
    case "HUB_OFFLINE":
      steps.push({ at: started, title: "Hub stopped connecting" });
      break;
    case "HUB_ONLINE":
      /* The event IS the return, so the first step is the good news. */
      steps.push({ at: started, title: "Back online" });
      break;
    case "FOOTAGE_RECOVERING":
      steps.push({ at: started, title: `${subject} started sending its backlog` });
      break;
    case "FOOTAGE_RECOVERED":
      steps.push({ at: started, title: `${subject} finished sending its backlog` });
      break;
    default:
      steps.push({ at: started, title: `${subject} reported something` });
  }

  /* The debounce. See the header: a constant, not a guess, and the only
     derived stamp on this list. */
  steps.push({ at: started + DEBOUNCE_SEC * 1000, title: "Alert raised" });

  const back = ms(alert.recovered_at);
  if (back !== null) {
    steps.push({
      at: back,
      title:
        alert.type === "CAMERA_STOPPED"
          ? "Frames arriving again"
          : isHubAlert(alert.type)
            ? "Back online"
            : "Back",
    });
  }

  const acked = ms(alert.acknowledged_at);
  if (acked !== null || alert.acknowledged) {
    /* ⚠ THE NAME IS NOT PUT THROUGH `deviceName`. An organization or a
       person is not a device, and shouting somebody's name is the line
       `lib/deviceName.ts` draws and means. */
    const who = alert.acknowledged_by;
    steps.push({
      at: acked,
      title: who ? `Acknowledged by ${who}` : "Acknowledged",
    });
  }

  /* ⭐ WHETHER THE FOOTAGE EVER CAME, AND ONLY FOR A HUB. Every other alert
     is cut at the moment it is raised, so "Footage attached" under it would
     be a step on every row saying what the picture above it already shows. A
     hub's clip is the one that arrives SEPARATELY and may take weeks: the
     footage is on the box that went away, nothing polls for it, and the hub
     cuts it when it dials back in. Whether that has happened is a real event
     in this incident's sequence, and the answer "it looked and had nothing"
     is just as much one. No stamp for either: the row carries no time for
     when the clips were attached, and an invented one would be the single
     line on a handoff that nothing can corroborate. */
  if (isHubAlert(alert.type)) {
    const state = clipState(alert);
    if (state === "playable" || state === "hubOnly") {
      steps.push({ at: null, title: "Footage attached" });
    } else if (state === "none") {
      steps.push({ at: null, title: clipWords("none").headline });
    }
  }

  if (alert.best_quality === "2k") {
    /* No stamp, deliberately: the hub attaches the better cut during a sweep
       and the row carries no time for it. Last, because it is the most
       recent thing that happened to this alert whatever the clock says. */
    steps.push({ at: null, title: "2K clip added" });
  }

  /* Stable sort, undated last. A timeline's ORDER is the information, and one
     step out of sequence silently inverts cause and effect. */
  return steps
    .map((step, i) => ({ step, i }))
    .sort((a, b) => {
      if (a.step.at === null) return b.step.at === null ? a.i - b.i : 1;
      if (b.step.at === null) return -1;
      return a.step.at - b.step.at || a.i - b.i;
    })
    .map(({ step }) => step);
}

/** One camera's clip, in the shape the existing player already takes. */
export interface AlertPane {
  clip: AlertClip;
  attachment: AlertAttachment;
}

/**
 * The clips to show, one per camera, each at the best quality available.
 *
 * ⚠ `best_quality` IS THE SERVER'S RANKING AND IS NOT RE-DERIVED HERE. It is
 * decided server-side precisely so a pop-up and a detail view cannot rank the
 * same list differently, and "2k beats standard" is a comparison this bundle
 * would have to keep in step with a hub that adds a third. So the preference
 * is read off the alert, and a camera that has only the other one shows that
 * one rather than nothing.
 */
export function alertPanes(
  alert: SiteAlert,
  cameraNameOf?: CameraNameOf,
): AlertPane[] {
  return panesOf(alert, cameraNameOf, true);
}

/**
 * The same list, including clips this browser CANNOT play.
 *
 * ⚠ FOR DESCRIBING A CLIP, NEVER FOR PLAYING ONE — a pane from here can
 * carry an empty `src`. A clip with no `url` still has a camera, a quality, a
 * length and a start (docs/alerts.md §4: "every other clip field is still
 * there, so the clip can be described"), and that is the whole point of the
 * "Clip on the hub only" state: the alert can say what exists and where,
 * rather than looking like an alert with no evidence at all. Two cameras lay
 * out side by side here exactly as they do when they play, because the thing
 * being said about them is per camera.
 */
export function alertClipCards(
  alert: SiteAlert,
  cameraNameOf?: CameraNameOf,
): AlertPane[] {
  return panesOf(alert, cameraNameOf, false);
}

function panesOf(
  alert: SiteAlert,
  cameraNameOf: CameraNameOf | undefined,
  playableOnly: boolean,
): AlertPane[] {
  const clips = alert.clips ?? [];
  if (clips.length === 0) return [];
  const want = alert.best_quality;
  const byCamera = new Map<number, AlertClip>();
  for (const clip of clips) {
    if (playableOnly && !clip.url) continue;
    const have = byCamera.get(clip.camera);
    if (!have) {
      byCamera.set(clip.camera, clip);
      continue;
    }
    if (have.quality !== want && clip.quality === want) byCamera.set(clip.camera, clip);
  }
  return [...byCamera.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([camera, clip]): AlertPane => ({
      clip,
      attachment: {
        kind: "clip",
        /* The tag burnt onto the picture and the player's last crumb. A still
           with no label is evidence you cannot cite. */
        title: cameraLabel(alert.device_id, camera, cameraNameOf),
        /* No still exists for an alert clip — the hub cuts video, not a
           poster — and the pane shows the clip's own first frame instead.
           Empty rather than a placeholder image, which `ClipPlayer` reads as
           "no poster" and skips. */
        thumbnail: "",
        /* Empty for a clip that is only on its hub. `alertPanes` never
           returns one; `alertClipCards` does, and nothing hands those to a
           player. */
        src: clip.url ?? "",
        ...(clip.download_url ? { downloadUrl: clip.download_url } : {}),
        ...(clip.filename ? { filename: clip.filename } : {}),
        ...(clip.duration !== undefined ? { durationSec: clip.duration } : {}),
        ...(qualityLabel(clip.quality) ? { quality: qualityLabel(clip.quality) } : {}),
      },
    }));
}

/* `expectsClip` moved to `alertCopy` when `clipState` was written: the six
   states are one decision and one of them is "this kind never has a clip",
   so keeping the predicate in a second module was keeping half of a switch
   away from the other half. Re-exported because this is where the clip
   helpers are imported from. */
export { expectsClip };
