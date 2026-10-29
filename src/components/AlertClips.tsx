import type { SiteAlert } from "@kallon/sentry-sdk";
import { clipState, clipWords, type CameraNameOf } from "@/lib/alertCopy";
import { alertClipCards, alertPanes, type AlertPane } from "@/lib/alertStory";
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
 * ── AND THE FIVE WAYS TO HAVE NO PICTURE ──────────────────────────────
 *
 * Each is a different sentence, because each sends an operator somewhere
 * different. `lib/alertCopy.ts` owns both the state and the words; this
 * component only decides which SHAPE to draw, and there are three:
 *
 *   playable   the heroes, one per camera, pressable.
 *   hubOnly    the same grid, same labels, NOT pressable. The clip exists and
 *              is described; the bytes are at the site and the screen in the
 *              control room can play them.
 *   the rest   one centred line and one of help: "Clip coming" (a
 *              `TOWER_ONLINE` cut is the first 60 s AFTER the tower returned),
 *              "Footage pending, the hub is away" (which may be weeks), "No
 *              footage of that moment" (the hub looked and had none), "Clip
 *              no longer kept" (the budget swept the file; the alert survives
 *              on purpose, because an alert is the record that the camera
 *              stopped at 03:14), and nothing at all for the recovery pair,
 *              which has no moment to cut around.
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
  const state = clipState(alert);
  if (state === "never") return null;

  /* ⚠ `evicted` WINS OVER THE SERVER'S STATE, AND ONLY HERE. Every other
     reading on this panel is the hub's; this one is what the BROWSER found
     when it went for the file and got a 404, which the server cannot know it
     is about to serve. A swept clip is still described by an alert that
     believes it has one. */
  const words = evicted
    ? {
        headline: "Clip no longer kept",
        help: "The site needed the space. The alert is kept.",
      }
    : clipWords(state);

  /* ⚠ `hubOnly` HAS A SENTENCE AND IS NOT AN EMPTY BOX, which is the one
     ordering mistake this component can make. It was made: the words came
     first and swallowed the state, so two described clips rendered as one
     centred line and the cameras disappeared. A clip that exists is drawn as
     a clip. */
  if (words && !(state === "hubOnly" && !evicted)) {
    return (
      <div
        data-alert-clip-absent
        className="flex aspect-[388/198] w-full flex-col items-center justify-center gap-[3px] rounded-[12px] bg-panel px-[16px] text-center"
      >
        <p className="text-[0.75rem] text-body-ink/40">{words.headline}</p>
        <p className="text-[0.6875rem] text-body-ink/25">{words.help}</p>
      </div>
    );
  }

  /* ⭐ THE CLIPS THAT EXIST AND CANNOT BE FETCHED FROM HERE. Described, laid
     out per camera exactly as they would be if they played, and not
     pressable: the data centre keeps no video, so with no bucket configured
     there is no URL to give and a play button would be a control that cannot
     work. What it says instead is where the footage IS, because the screen in
     the control room plays it from the hub's own disk. */
  if (state === "hubOnly" && !evicted) {
    const cards = alertClipCards(alert, cameraNameOf);
    const held = clipWords("hubOnly");
    return (
      <section data-alert-clips className="flex flex-col gap-[6px]">
        <div
          className={`grid gap-[4px] ${cards.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
        >
        {cards.map((card) => {
          const name = deviceName(card.attachment.title);
          return (
            <div
              key={card.clip.key}
              data-alert-clip-held
              className="relative flex aspect-[388/198] w-full items-center justify-center overflow-hidden rounded-[12px] bg-panel px-[16px] text-center"
            >
              <span className="chip-blur pointer-events-none absolute left-[8px] top-[8px] max-w-[calc(100%-16px)] truncate rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] uppercase leading-[14px] tracking-[0.1px] text-body-ink/85">
                {name}
              </span>
              {card.attachment.quality && (
                <span className="chip-blur pointer-events-none absolute bottom-[8px] left-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-body-ink/85">
                  {card.attachment.quality}
                </span>
              )}
              {card.attachment.durationSec !== undefined && (
                <span className="chip-blur pointer-events-none absolute bottom-[8px] right-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-body-ink/85 tabular-nums">
                  {formatDuration(card.attachment.durationSec)}
                </span>
              )}
            </div>
          );
        })}
        </div>
        {/* ⚠ ONCE, UNDER THE PAIR, AND NOT ON EACH TILE. The sentence is
            about the ALERT's footage rather than about one camera's, and
            printed inside each box it read "Clip on the hub only" twice
            side by side, which is one fact said twice and a tile whose own
            label it was competing with. */}
        <p className="text-[0.75rem] text-body-ink/40">{held.headline}</p>
        <p className="text-[0.6875rem] text-body-ink/25">{held.help}</p>
      </section>
    );
  }

  const panes = alertPanes(alert, cameraNameOf);

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
