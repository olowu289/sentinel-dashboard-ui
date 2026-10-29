import type { SiteAlert } from "@kallon/sentry-sdk";
import type { CameraNameOf } from "@/lib/alertCopy";
import { alertPanes, expectsClip, type AlertPane } from "@/lib/alertStory";
import { deviceName } from "@/lib/deviceName";
import { formatDuration } from "@/lib/time";
import type { AlertAttachment } from "@/lib/types";

/**
 * THE MINUTE BEFORE IT HAPPENED, as a picture you press.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THIS IS THE DESIGN'S HERO, NOT A SECOND PLAYER
 * ══════════════════════════════════════════════════════════════════════
 *
 * What stood here was an inline transport built for this surface alone: two
 * `<video>` elements, a play button, a range input and a pair of save links.
 * It worked, and it was wrong for one reason that only showed up on a real
 * hub. The detection alerts already have a player — scrub bar, wall-clock
 * readout, the alert's own timeline marked on the track, speed, mute and a
 * download — and a REAL alert, the only kind there now is, got a plain bar
 * instead. Two players in one product, the worse one on the live path.
 *
 * So this is the frame's hero and nothing more: the picture, the camera's
 * name in the corner, the centre play button, the duration badge. Pressing it
 * hands the panes up to `ClipPlayer`, exactly as a detection's clip card
 * does.
 *
 * ── THE POSTER IS THE CLIP'S OWN FIRST FRAME ──────────────────────────
 *
 * The hub cuts video, not a still, so there is no thumbnail to show. `#t=0.1`
 * is a media fragment: the element seeks there on load and paints that frame,
 * which is the only honest poster available — a frame of the actual footage
 * rather than a placeholder standing in for one. A fragment is never sent to
 * a server, so a presigned URL survives having one appended.
 *
 * ── AND THE THREE WAYS TO HAVE NO CLIP ────────────────────────────────
 *
 * Each is a different sentence, because each sends an operator somewhere
 * different: "Clip coming" (a `TOWER_ONLINE` cut is the first 60 s AFTER the
 * tower returned, so it lands about a minute later), "Clip no longer kept"
 * (the budget swept the file; the alert survives on purpose, because an alert
 * is the record that the camera stopped at 03:14), and nothing at all for the
 * recovery pair, which has no moment to cut around.
 */
export function AlertClips({
  alert,
  cameraNameOf,
  evicted = false,
  onClipError,
  onPlay,
}: {
  alert: SiteAlert;
  cameraNameOf?: CameraNameOf;
  /**
   * This pane's own source would not load.
   *
   * ⚠ THE POSTER IS THE CANARY, AND THAT IS DELIBERATE. The hero loads the
   * clip's first frame, so it is the first thing to meet an expired ticket or
   * a swept file — before anybody presses play, and therefore before an
   * operator is waiting on it. What happened is asked upstream, where the one
   * retry is counted.
   */
  onClipError?: (clip: AlertPane["clip"]) => void;
  /**
   * The budget swept the file.
   *
   * Held ABOVE this component rather than inside it, and keyed by alert id up
   * there: `AlertDetail` is never remounted, so a flag parked in here would
   * survive the feed swapping its content and report the next alert's clip
   * missing. The trap CLAUDE.md documents, in the one place this round meets
   * it.
   */
  evicted?: boolean;
  /** Open the full player on one pane, with the others beside it. */
  onPlay: (pane: AlertPane, companions: AlertAttachment[]) => void;
}) {
  if (!expectsClip(alert.type)) return null;

  const panes = alertPanes(alert, cameraNameOf);

  if (panes.length === 0 || evicted) {
    return (
      <div className="flex aspect-[388/198] w-full flex-col items-center justify-center gap-[3px] rounded-[12px] bg-panel px-[16px] text-center">
        <p className="text-[0.75rem] text-body-ink/40">
          {evicted ? "Clip no longer kept" : "Clip coming"}
        </p>
        <p className="text-[0.6875rem] text-body-ink/25">
          {evicted
            ? "The site needed the space. The alert is kept."
            : "The site is cutting it now."}
        </p>
      </div>
    );
  }

  return (
    <section
      data-alert-clips
      /* Side by side when the mast is the event, one wide pane when a single
         camera is. Two 194px panes beat one 388px pane whose other half is a
         camera nobody was asking about. */
      className={`grid gap-[4px] ${panes.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
    >
      {panes.map((pane) => {
        const name = deviceName(pane.attachment.title);
        return (
          <button
            key={pane.clip.key}
            type="button"
            data-alert-clip-hero
            onClick={() =>
              onPlay(
                pane,
                /* Everything else that saw the same moment, in camera order,
                   with the pressed one taken out: it is the leader. */
                panes.filter((p) => p !== pane).map((p) => p.attachment),
              )
            }
            aria-label={`Play the clip from ${name}`}
            className="relative aspect-[388/198] w-full overflow-hidden rounded-[12px] bg-tile text-left"
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={`${pane.attachment.src}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              aria-hidden
              onError={() => onClipError?.(pane.clip)}
              className="pointer-events-none absolute inset-0 size-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/10">
              <span className="chip-blur flex size-[44px] items-center justify-center rounded-full bg-black/55">
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                  <path d="M5 3.5 14 9l-9 5.5v-11Z" fill="white" />
                </svg>
              </span>
            </span>
            {/* Which camera and how long, burnt onto the frame. A still with
                no label is evidence you cannot cite. */}
            <span className="chip-blur pointer-events-none absolute left-[8px] top-[8px] max-w-[calc(100%-16px)] truncate rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] uppercase leading-[14px] tracking-[0.1px] text-body-ink/85">
              {name}
            </span>
            {pane.attachment.quality && (
              <span className="chip-blur pointer-events-none absolute bottom-[8px] left-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-body-ink/85">
                {pane.attachment.quality}
              </span>
            )}
            {pane.attachment.durationSec !== undefined && (
              <span className="chip-blur pointer-events-none absolute bottom-[8px] right-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-body-ink/85 tabular-nums">
                {formatDuration(pane.attachment.durationSec)}
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}
