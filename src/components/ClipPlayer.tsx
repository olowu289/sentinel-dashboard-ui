import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ENTER, EXIT } from "@/lib/motion";
import { formatClock } from "@/lib/time";
import { deviceName } from "@/lib/deviceName";
import type { Alert, AlertAttachment } from "@/lib/types";
import { useExportPhase } from "@/lib/useExportPhase";
import { MaskIcon } from "./Icon";
import { IconRail } from "./IconRail";

/**
 * Recorded clips start before the moment that triggered them. A camera holds a
 * rolling buffer, so the export carries the run-up — which is usually the part
 * an investigator actually needs, because the detection is the consequence and
 * the approach is the evidence. Five seconds is enough to see something enter
 * frame without padding a 15s clip into a third of nothing.
 */
const PRE_ROLL_SEC = 5;

/** Surveillance review is mostly fast-forward, so the range runs past 2×. */
const RATES = [0.5, 1, 2, 4] as const;

const SKIP_SEC = 10;

/**
 * How much of the track one timeline step colours in.
 *
 * The frame draws the marks as bands rather than ticks, and that is the more
 * honest shape: a detection is a stretch of footage where something is in
 * view, not an instant. Two seconds is the run of frames an operator would
 * actually scrub to; narrower and a 6px rail cannot show it at all.
 */
const MARK_SEC = 2;

/** How far a follower may drift from the leader before it is nudged, seconds. */
const SYNC_TOLERANCE_SEC = 0.35;

/* A stable identity, so the default does not re-trigger effects every render. */
const EMPTY_COMPANIONS: readonly AlertAttachment[] = [];

/**
 * Why a clip would not play, in one sentence an operator can act on.
 *
 * The element's own four codes, which are the only thing it will tell you.
 * Rule 6: what happened, and what to do. The code goes to the console, where
 * it is of some use to us and of none to anybody else.
 */
function describeMediaFailure(v: HTMLVideoElement, name?: string): string {
  const code = v.error?.code;
  console.error("[clip] playback failed:", name, code, v.error?.message, v.currentSrc);
  if (code === 2 || name === "NotSupportedError") {
    /* MEDIA_ERR_NETWORK, or a source selection that found nothing. On an
       alert clip this is almost always an expired ticket. */
    return "That clip's link has expired. Close this and open the alert again.";
  }
  if (code === 3) return "That clip is damaged and cannot be played.";
  if (code === 4) return "This browser cannot play that clip.";
  return "That clip didn't play. Close this and open the alert again.";
}

/** mm:ss for the transport. Tabular everywhere so the digits never shift. */
function timecode(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* The pill's own controls: 40px chip, 21.333px glyph, per the frame. */
const CHIP =
  "flex size-[40px] shrink-0 items-center justify-center rounded-[10px] text-body-ink transition-colors hover:bg-overlay/10 disabled:pointer-events-none disabled:opacity-30";

/**
 * Reviewing one recorded clip.
 *
 * A takeover rather than an inline player: the clip is evidence, and evidence
 * gets looked at properly. The frame gives it the rail and a breadcrumb, which
 * makes it a screen rather than a dialog wearing one — so the rail navigates
 * for real, closing the player on the way out. `Esc` still leaves.
 *
 * Two things here that a consumer player never has, and that this one exists
 * for. The breadcrumb carries the **wall-clock time of the playhead**, not just
 * the clip-relative one: `00:06` is where you are in the file, `02:41:18 AM WAT`
 * is when it happened, and only the second is quotable on a handoff. And the
 * scrubber is **marked with the alert's own timeline**, so the detections are
 * visible as positions before you play anything — jumping to the next one is a
 * button rather than a hunt.
 *
 * The transport is real; the media is not. There is no backend, so the clip is
 * the still the rest of the app uses and the playhead is driven by a clock
 * here. Swapping in a real `<video>` means replacing that clock with
 * `timeupdate` and leaving everything else alone — the mute toggle included,
 * which is why it is wired to state rather than left as a picture.
 */
export function ClipPlayer({
  attachment,
  companions = EMPTY_COMPANIONS,
  /** Epoch ms of the timeline step this clip was captured at. */
  at,
  alert,
  towerName,
  onNavigate,
  onClose,
}: {
  attachment: AlertAttachment;
  /**
   * The OTHER cameras that saw the same moment, shown beside this one.
   *
   * ⚠ ONE TRANSPORT, NEVER ONE PLAYER EACH. A tower going offline takes the
   * whole mast, so its clips are the same sixty seconds from two places, every
   * `start` identical. A vehicle leaves one frame and enters the other, and
   * finding that by scrubbing two players separately is the work this screen
   * exists to not make somebody do. The first pane is the clock; the rest
   * follow it and are nudged back when they drift.
   *
   * Empty for every single-camera alert, which is most of them, and the stage
   * is unchanged for those.
   */
  companions?: readonly AlertAttachment[];
  at: number;
  alert: Alert;
  /** The site, for the breadcrumb's middle crumb. */
  towerName: string;
  /** Rail destinations. The frame draws the rail, so it has to work — a nav
   *  bar that does not navigate is the bug the shell's router was written to
   *  end. Leaving by it closes the player first. */
  onNavigate?: (id: string) => void;
  onClose: () => void;
}) {
  /* ── THE MEDIA, WHEN THERE IS ANY ────────────────────────────────────────
     `attachment.src` is the real thing: a clip the tower actually wrote. When
     it is absent — which is every alert in the app today — this falls back to
     the still and the simulated clock exactly as before, because an alert
     attachment carries a thumbnail and a duration and no video URL at all.

     Both paths are kept deliberately rather than the still being dropped: the
     alert feed is the shipped, working use of this player, and "upgrade the
     transport" must not mean "break the only thing currently using it". The
     transport below does not know which path it is driving. */
  const src = attachment.src;
  const videoRef = useRef<HTMLVideoElement>(null);
  /* The followers, in render order. Index 0 is the leader above. */
  const followers = useRef<(HTMLVideoElement | null)[]>([]);
  const panes = useMemo(
    () => [attachment, ...companions],
    [attachment, companions],
  );
  /** Every element on the stage, leader first. */
  const each = useCallback(
    (fn: (v: HTMLVideoElement) => void) => {
      const lead = videoRef.current;
      if (lead) fn(lead);
      for (const v of followers.current) if (v) fn(v);
    },
    [],
  );

  /**
   * ⚠ WHAT A FAILED `play()` SAID BEFORE THIS: NOTHING AT ALL.
   *
   * A clip that arrived while the alert was open came up with a transport and
   * a duration and would not start, and the only thing anybody could report
   * was "never plays" — because the rejection was swallowed by a bare
   * `.catch(() => {})`. A media element has four error codes and a promise
   * rejection with a name on it, and discarding all of them turns a
   * diagnosable fault into a mystery. This holds the reason so the screen can
   * say it.
   *
   * `null` is the healthy state. Autoplay being blocked is NOT put in here:
   * that is normal, it is handled by falling back to paused, and a notice
   * about it would appear on every clip somebody opens before touching the
   * page.
   */
  const [mediaProblem, setMediaProblem] = useState<string | null>(null);

  /* Duration comes from the MEDIA when there is media. `durationSec` is what
     the buffer said the clip would be; the file is what it actually is, and a
     scrubber scaled to the first while playing the second puts every marker in
     the wrong place. The attachment value stays as the pre-load estimate so
     the track has a length before `loadedmetadata` arrives. */
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const duration = mediaDuration ?? attachment.durationSec ?? 15;
  const startsAt = at - PRE_ROLL_SEC * 1000;

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState<number>(1);
  const [muted, setMuted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { phase, start: exportClip } = useExportPhase();

  /* The alert's own steps, placed on the track. Only the ones that actually
     fall inside this clip's window — a marker for something the footage does
     not contain would send the operator looking for a frame that was never
     recorded.

     `key` is the step whose time is the alert's own — the moment this became
     an incident somebody was told about. The frame draws one band in a
     different colour and this is the distinction worth spending it on: the
     rest of the track's marks are the run-up that led there and the handling
     that followed, and only one of them is the event itself. */
  const markers = useMemo(() => {
    const steps = alert.timeline ?? [
      { at: alert.at, icon: alert.kind, title: alert.title },
    ];
    return steps
      .map((e) => ({
        ...e,
        offset: (e.at - startsAt) / 1000,
        key: Math.abs(e.at - alert.at) < 500,
      }))
      .filter((e) => e.offset >= 0 && e.offset <= duration)
      .sort((a, b) => a.offset - b.offset);
  }, [alert, startsAt, duration]);

  const seek = useCallback(
    (to: number) => {
      const next = Math.min(duration, Math.max(0, to));
      /* The element is the source of truth when it exists: setting
         currentTime makes it emit `timeupdate`, which sets `t`. Setting `t`
         here as well would fight that and show a playhead the picture has not
         reached — the scrubber would lead the frame. */
      const v = videoRef.current;
      if (v) {
        each((el) => {
          el.currentTime = next;
        });
        return;
      }
      setT(next);
    },
    [duration, each],
  );

  /* The first marker sits at `PRE_ROLL_SEC`, so a clip opened and played to
     its own trigger has nothing *before* the playhead — and a strict reading of
     "previous detection" left the button dead at 00:05 with fourteen seconds of
     track to its left, which reads as broken rather than as finished. It wears
     the standard transport glyph, so it takes the standard transport
     behaviour: back to the previous detection, or to the top of the clip when
     that is all there is left to go back to. Dead only at 00:00. */
  const prevMarker = [...markers].reverse().find((m) => m.offset < t - 0.15);
  const nextMarker = markers.find((m) => m.offset > t + 0.15);

  const jumpMarker = useCallback(
    (dir: 1 | -1) => {
      // A hair of slack, so "next" from exactly on a marker does not re-find it.
      if (dir === 1) {
        if (nextMarker) seek(nextMarker.offset);
        return;
      }
      seek(prevMarker ? prevMarker.offset : 0);
    },
    [nextMarker, prevMarker, seek],
  );

  /* Playback, driven by whichever clock is real.
     ────────────────────────────────────────────────────────────────────────
     WITH MEDIA: `timeupdate` is the clock. The element decides where the
     playhead is, because it is the only thing that knows — a frame that has
     not decoded yet has not been watched, and a clock that ran ahead of it
     would let an operator swear they saw something at 00:12 that the file puts
     at 00:14. Rate and mute are pushed onto the element rather than modelled
     beside it, for the same reason.

     WITHOUT MEDIA: the original rAF clock, unchanged, driving a still. */
  useEffect(() => {
    const lead = videoRef.current;
    if (!lead) return;
    each((v) => {
      v.playbackRate = rate;
      /* ⚠ ONLY THE LEADER CARRIES SOUND. Two cameras on one transport is two
         audio tracks of the same sixty seconds, a fraction of a second apart,
         which is an echo rather than a recording. */
      v.muted = muted || v !== lead;
    });
    if (!playing) {
      each((v) => v.pause());
      return;
    }
    each((v) => {
      void v.play().then(
        () => {
          if (v === lead) setMediaProblem(null);
        },
        (err: unknown) => {
          const name = (err as { name?: string } | null)?.name;
          /* Autoplay policy, which is NORMAL and not a fault: an unmuted
             start is blocked until the operator has touched the page. Fall
             back to showing paused rather than lying about it, and say
             nothing — a notice here would appear on every clip anybody opens
             before clicking. */
          if (name === "NotAllowedError") {
            if (v === lead) setPlaying(false);
            return;
          }
          /* Everything else is the thing the lab could not diagnose. */
          if (v === lead) {
            setPlaying(false);
            setMediaProblem(describeMediaFailure(v, name));
          }
        },
      );
    });
  }, [playing, rate, muted, src, each]);

  /**
   * ⭐ A NEW SOURCE IS LOADED, EXPLICITLY, AND THE PLACE IS KEPT.
   *
   * This is the fix for a clip that arrives AFTER its alert was opened: the
   * pane came up with a transport reading `0s / 1m` and would not start.
   *
   * Changing a `<video>`'s `src` is supposed to restart the resource
   * selection algorithm on its own, and usually does. What is NOT safe is
   * what stood here instead: a `setTimeout(0)` that wrote `currentTime` while
   * the element was still at `HAVE_NOTHING`, which sets the *default playback
   * start position* rather than seeking, and then called `play()` on an
   * element whose source selection had not finished. An element left in
   * `NETWORK_NO_SOURCE` by that race never recovers without an explicit
   * `load()`, and the rejection that said so was being discarded.
   *
   * So: remember the position, call `load()`, and restore on
   * `loadedmetadata` — which is the first moment a seek means anything. The
   * place is kept because the 2K upgrade is the SAME sixty seconds at a
   * better resolution, so somebody looking at 00:42 must still be looking at
   * 00:42; a reset to zero means finding the moment again on a minute of
   * evidence.
   */
  const sources = panes.map((a) => a.src ?? "").join("|");
  const lastSources = useRef(sources);
  const resumeFrom = useRef(0);
  /* Set during render, consumed by the effect below. The two are separate
     because only render can see the old source and only an effect may touch
     the element after React has written the new one. */
  const pendingReload = useRef(false);
  if (lastSources.current !== sources) {
    /* ⚠ READ DURING RENDER, AND IT HAS TO BE. By the time an effect runs,
       React has already written the new `src` onto the element and the
       browser has reset `currentTime` to 0 — so a position captured there is
       always zero, and the restore below silently does nothing. Render is
       the last moment the OLD source is still loaded. Writing a ref during
       render is safe: it is derived from props, it is idempotent, and a
       double invocation computes the same answer. */
    /* ⚠ `t`, THE TRANSPORT'S OWN CLOCK, NOT THE ELEMENT'S `currentTime`.
       The element is the wrong place to read from at this instant and in
       both directions: by the time an EFFECT runs React has written the new
       `src` and the browser has zeroed it, and during render the element may
       already have been handed a source by an earlier commit in the same
       batch. `t` is state, it is what the scrubber is showing, and it is
       therefore exactly where the operator believes they are. */
    /* ⚠ WHICHEVER OF THE TWO IS FURTHER ON, and both are needed.
       `t` is the transport's own clock and is what the scrubber is showing,
       but it only moves on `timeupdate` — so a seek that has been requested
       and has not completed is not in it yet. The element knows about that
       one. Conversely the element is useless to read from an EFFECT, where
       React has already written the new `src` and the browser has zeroed it.
       Render, and the larger of the two, is the only reading that survives
       both. */
    resumeFrom.current = Math.max(t, videoRef.current?.currentTime ?? 0);
    lastSources.current = sources;
    pendingReload.current = true;
  }
  /**
   * Put the playhead back where the operator left it, once the element can
   * actually take it.
   *
   * ⚠ A SEEK BEFORE THE ELEMENT CAN SEEK IS DROPPED SILENTLY. No error, no
   * event: `currentTime` is written and reads back unchanged on the next
   * line, which is exactly what was measured here (1.61 written, 0 read).
   * `loadedmetadata` is NOT late enough — it fires as soon as the duration
   * is known, which can be well before `seekable` has anything in it. So
   * this is called from every readiness step the element reports and does
   * nothing once the position has taken.
   */
  const restorePosition = useCallback((v: HTMLVideoElement) => {
    const target = resumeFrom.current;
    if (target <= 0) return;
    if (!Number.isFinite(v.duration) || v.duration <= 0) return;
    const want = Math.min(target, v.duration);
    if (Math.abs(v.currentTime - want) < 0.25) {
      resumeFrom.current = 0;              // taken; stop trying
      return;
    }
    /* ⚠ AND ONLY WHEN THE ELEMENT SAYS IT CAN GO THERE. `seekable` is empty
       until enough of the resource is available to seek within, and writing
       `currentTime` before then does worse than nothing: the seek is aborted,
       and the element can be left parked at HAVE_METADATA, never loading
       further and never becoming playable. Measured here — a restore on
       `loadedmetadata` alone stalled the pane at readyState 1 with a
       perfectly good file behind it. */
    const ranges = v.seekable;
    if (ranges.length === 0) return;
    if (want < ranges.start(0) || want > ranges.end(ranges.length - 1)) return;
    v.currentTime = want;
  }, []);

  useEffect(() => {
    if (!pendingReload.current) return;
    pendingReload.current = false;
    setMediaProblem(null);
    /* ⚠ NO `load()` HERE. Changing `src` already restarts the resource
       selection algorithm, and calling `load()` on top of it aborts the
       fetch React just started and restarts it — which on a paused element
       left it parked at HAVE_METADATA, never reaching a state it could seek
       or play in. The reload that matters is the one React does; what this
       effect owes is the position and a clean slate for the error line. */
    each((v) => restorePosition(v));
  }, [sources, each, restorePosition]);


  useEffect(() => {
    if (src) return;                       // the element owns the clock
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * rate;
      last = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, rate, duration, src]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /* Capture phase, and it stops propagation for the keys it owns. The alerts
     panel binds Escape and the arrows on the window to step through the feed;
     without this, closing the player would also drop the alert selection
     behind it, and seeking would arrow to the next alert. Capture runs before
     the panel's bubble listener no matter which registered first. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

      const owned = [
        "Escape",
        " ",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ];
      if (!owned.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") onClose();
      else if (e.key === " ") setPlaying((p) => !p);
      else if (e.key === "ArrowLeft") setT((v) => Math.max(0, v - SKIP_SEC));
      else if (e.key === "ArrowRight")
        setT((v) => Math.min(duration, v + SKIP_SEC));
      // Up and Down are swallowed rather than used: they step the alert feed,
      // and swapping the alert underneath an open player would leave it
      // showing one incident's footage under another's title.
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, duration]);

  const pct = duration > 0 ? (t / duration) * 100 : 0;
  const wallClock = formatClock(startsAt + t * 1000);

  return (
    <motion.div
      role="dialog"
      aria-modal
      aria-label={`Reviewing ${attachment.title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: ENTER }}
      exit={{ opacity: 0, transition: EXIT }}
      className="fixed inset-0 z-100 flex bg-black"
    >
      <IconRail
        active="towers"
        onSelect={(id) => {
          onClose();
          onNavigate?.(id);
        }}
        className="hidden lg:block"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center border-b border-line px-[16px]">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-[4px]"
          >
            {/* A real hierarchy, not a decoration: the fleet, then the site,
                then the clip. The frame's first crumb reads TOWER, singular —
                every other breadcrumb in the app says TOWERS and lands on the
                fleet, and a crumb that names one thing while going to a list
                of them is the kind of small lie that stops a breadcrumb being
                trusted at all. Leaving by either one closes the player. */}
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate?.("dashboard");
              }}
              className="shrink-0 font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-body-ink"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <button
              type="button"
              onClick={onClose}
              className="min-w-0 truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-body-ink"
            >
              {deviceName(towerName)}
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span className="flex min-w-0 items-center gap-[6px]">
              <span
                aria-current="page"
                className="truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink uppercase"
              >
                {attachment.title}
              </span>
              {/* The wall clock of the playhead, which is the only timestamp
                  here that means anything off this screen. It ticks with the
                  transport — a still frame in a report is quoted by this, not
                  by an offset into a file nobody else has. */}
              <span className="flex shrink-0 items-center justify-center rounded-[2px] bg-terra/15 px-[6px] py-px font-display text-[0.75rem] uppercase tracking-[0.12px] text-terra tabular-nums">
                {wallClock}
              </span>
            </span>
          </nav>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close clip"
            title="Close (Esc)"
            className="ml-auto flex size-[20px] shrink-0 items-center justify-center text-body-ink transition-colors hover:text-muted"
          >
            <MaskIcon src="/icons/clip-close.svg" size={20} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-stage">
          {/* `contain`, unlike the walls, which fill. A tile is a monitor and a
              crop costs nothing there; this is the frame an incident gets
              decided on, and cropping evidence to fit a box is how the thing
              that mattered ends up outside the picture. */}
          {src ? (
            <div
              /* One pane fills the stage, as it always has. Two share it, each
                 keeping the 16:9 the picture is in — and `contain` below means
                 neither is cropped to make them match. */
              data-clip-stage
              className={`absolute inset-0 grid ${companions.length > 0 ? "grid-cols-1 gap-[2px] lg:grid-cols-2" : "grid-cols-1"}`}
            >
            <div className="relative min-h-0">
            <video
              ref={videoRef}
              src={src}
              {...(attachment.thumbnail ? { poster: attachment.thumbnail } : {})}
              playsInline
              /* ⚠ `auto`, NOT THE DEFAULT. A paused element on `metadata`
                 stops after the duration and never reaches `canplay` -- and
                 it cannot SEEK in that state either: a write to
                 `currentTime` is dropped silently, which is what left a 2K
                 upgrade sitting at zero. This is the evidence player; the
                 whole point of opening it is to have the clip. */
              preload="auto"
              /* No `controls`: the bar below IS the transport, and a second
                 set of browser controls over it would be two scrubbers
                 disagreeing about the same file. */
              className="absolute inset-0 size-full object-contain"
              onCanPlay={(e) => restorePosition(e.currentTarget)}
              onSeeked={(e) => restorePosition(e.currentTarget)}
              onLoadedMetadata={(e) => {
                restorePosition(e.currentTarget);
                const d = e.currentTarget.duration;
                /* A live/unbounded source reports Infinity. Rejected rather
                   than rendered: a track scaled to Infinity has no positions
                   on it, and the estimate is a better answer than none. */
                if (Number.isFinite(d) && d > 0) setMediaDuration(d);
              }}
              onTimeUpdate={(e) => {
                const lead = e.currentTarget;
                setT(lead.currentTime);
                /* The followers are corrected FROM the leader rather than
                   each driving itself: two elements taking turns to correct
                   each other is a visible stutter on both. */
                for (const v of followers.current) {
                  if (!v) continue;
                  if (Math.abs(v.currentTime - lead.currentTime) > SYNC_TOLERANCE_SEC) {
                    v.currentTime = lead.currentTime;
                  }
                }
              }}
              onEnded={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {/* The camera's name, burnt onto its own pane. With two of them
                side by side this stops being decoration: a frame nobody can
                attribute to a camera is a frame nobody can cite. */}
            <span className="chip-blur pointer-events-none absolute left-[10px] top-[10px] max-w-[calc(100%-20px)] truncate rounded-[3px] bg-black/55 px-[7px] py-[3px] font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.11px] text-body-ink/85">
              {deviceName(attachment.title)}
            </span>
            </div>
            {companions.map((other, i) => (
              <div key={other.src ?? i} className="relative min-h-0">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={(el) => {
                    followers.current[i] = el;
                  }}
                  src={other.src}
                  {...(other.thumbnail ? { poster: other.thumbnail } : {})}
                  playsInline
                  preload="auto"
                  muted
                  onCanPlay={(e) => restorePosition(e.currentTarget)}
                  className="absolute inset-0 size-full object-contain"
                />
                <span className="chip-blur pointer-events-none absolute left-[10px] top-[10px] max-w-[calc(100%-20px)] truncate rounded-[3px] bg-black/55 px-[7px] py-[3px] font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.11px] text-body-ink/85">
                  {deviceName(other.title)}
                </span>
              </div>
            ))}
            </div>
          ) : (
            <img
              src={attachment.thumbnail}
              alt=""
              className="absolute inset-0 size-full object-contain"
            />
          )}

          {/* ⚠ SAID, RATHER THAN SWALLOWED. One sentence: what happened and
              what to do. The code is in the console for us. */}
          {mediaProblem && (
            <p
              role="status"
              data-clip-problem
              className="chip-blur absolute left-1/2 top-[16px] -translate-x-1/2 rounded-[8px] bg-black/80 px-[12px] py-[6px] text-[0.8125rem] text-critical"
            >
              {mediaProblem}
            </p>
          )}

          {/* One bar, floating clear of the bottom edge. It sits over the
              letterbox rather than the picture at this aspect, which is the
              point of the stage being wider than the media. */}
          <div className="absolute inset-x-[16px] bottom-[8px] flex h-[59px] items-center gap-[12px] rounded-[57px] border border-row-line bg-black px-[17px] lg:inset-x-[34px] lg:gap-[20px]">
            <div className="flex shrink-0 items-center gap-[5.333px]">
              <button
                type="button"
                onClick={() => {
                  // Replay rather than sit dead on the last frame.
                  if (t >= duration) seek(0);
                  setPlaying((p) => !p);
                }}
                aria-label={playing ? "Pause" : "Play"}
                title={playing ? "Pause (Space)" : "Play (Space)"}
                className={CHIP}
              >
                <MaskIcon
                  src={playing ? "/icons/clip-pause.svg" : "/icons/clip-play.svg"}
                  size={21.333}
                />
              </button>

              {/* The pair the player exists for. Ten-second skips stay on the
                  arrow keys; these step detection to detection, which is the
                  thing an operator is actually hunting for. */}
              <button
                type="button"
                onClick={() => jumpMarker(-1)}
                disabled={!prevMarker && t <= 0.15}
                aria-label={prevMarker ? "Previous detection" : "Back to start"}
                title={prevMarker ? "Previous detection" : "Back to start"}
                className={CHIP}
              >
                <MaskIcon src="/icons/clip-prev.svg" size={21.333} />
              </button>
              <button
                type="button"
                onClick={() => jumpMarker(1)}
                disabled={!nextMarker}
                aria-label="Next detection"
                title="Next detection"
                className={CHIP}
              >
                {/* The frame composes next out of the same export, turned. */}
                <MaskIcon
                  src="/icons/clip-prev.svg"
                  size={21.333}
                  className="rotate-180 -scale-y-100"
                />
              </button>

              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-pressed={muted}
                aria-label={muted ? "Unmute" : "Mute"}
                title={muted ? "Unmute" : "Mute"}
                className={`${CHIP} ${muted ? "text-muted" : ""}`}
              >
                <MaskIcon src="/icons/clip-volume.svg" size={21.333} />
              </button>
            </div>

            {/* Elapsed and total sit at the two ends of the track rather than
                as a "00:06 / 00:15" fraction. The number under the playhead is
                the one being read; parking it against the runtime makes both
                harder. */}
            <span className="shrink-0 font-display text-[1rem] leading-[20px] font-bold tracking-[0.16px] text-body-ink tabular-nums">
              {timecode(t)}
            </span>

            <div className="relative min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={t}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Seek"
                aria-valuetext={`${timecode(t)}, ${wallClock}`}
                className="peer relative z-10 h-[20px] w-full cursor-pointer appearance-none bg-transparent"
                style={{ WebkitAppearance: "none" }}
              />
              {/* Painted under the native input, which is left transparent and
                  keeps the keyboard and pointer behaviour a range already has —
                  a hand-rolled div would need arrow keys, Home/End, page steps
                  and a role reimplemented to match. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 rounded-[6px] bg-track"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-1/2 h-[6px] -translate-y-1/2 rounded-l-[6px] bg-action"
                style={{ width: `${pct}%` }}
              />

              {/* Detections as stretches of footage rather than instants. Each
                  is its own target: seeing where they are is half of it, and
                  landing on one without hunting is the other. */}
              {markers.map((m) => (
                <button
                  key={`${m.at}-${m.title}`}
                  type="button"
                  onClick={() => seek(m.offset)}
                  aria-label={`Jump to ${m.title}, ${formatClock(m.at)}`}
                  title={`${m.title} · ${formatClock(m.at)}`}
                  className={`absolute top-1/2 z-20 h-[6px] -translate-y-1/2 rounded-[6px] border ${
                    m.key
                      ? "border-mark-key-line bg-mark-key"
                      : "border-mark-line bg-terra"
                  }`}
                  style={{
                    left: `${(m.offset / duration) * 100}%`,
                    width: `${(Math.min(MARK_SEC, duration - m.offset) / duration) * 100}%`,
                  }}
                />
              ))}

              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 z-30 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-action ring-2 ring-black"
                style={{ left: `${pct}%` }}
              />
            </div>

            <span className="shrink-0 font-display text-[1rem] leading-[20px] tracking-[0.16px] text-muted tabular-nums">
              {timecode(duration)}
            </span>

            <div className="hidden shrink-0 items-center gap-[10px] lg:flex">
              <span aria-hidden className="h-[16px] w-px bg-stroke" />
              {/* A reading, not a control — there is one recording and this is
                  what it is. Absent rather than guessed when the clip does not
                  carry it. */}
              {attachment.quality && (
                <>
                  <span className="font-display text-[1rem] leading-[20px] tracking-[0.16px] text-body-ink">
                    {attachment.quality}
                  </span>
                  <span aria-hidden className="h-[16px] w-px bg-stroke" />
                </>
              )}
              {/* One slot, cycling, rather than four laid out. Review is mostly
                  a hunt at speed and the rate is changed constantly, so it is
                  the press that has to be cheap — not the reading. */}
              <button
                type="button"
                onClick={() =>
                  setRate((r) => RATES[(RATES.indexOf(r as 1) + 1) % RATES.length])
                }
                aria-label={`Playback speed ${rate}×, change`}
                title="Playback speed"
                className="font-display text-[1rem] leading-[20px] tracking-[0.16px] text-body-ink tabular-nums transition-colors hover:text-muted"
              >
                {rate}X
              </button>
            </div>

            {/* ⚠ AN ANCHOR WHEN THERE ARE BYTES, THE SIMULATION WHEN THERE
                ARE NOT, and the two must not look alike. `useExportPhase` is
                three states and no file, which was honest while nothing on
                this surface had a URL behind it; an alert clip does, and a
                button that pretends to save evidence is the worst button in
                this product. */}
            {attachment.downloadUrl ? (
              <a
                href={attachment.downloadUrl}
                {...(attachment.filename ? { download: attachment.filename } : {})}
                rel="noopener"
                aria-label={`Download ${attachment.title}`}
                title="Download clip"
                className="flex size-[32px] shrink-0 items-center justify-center text-body-ink transition-colors hover:text-muted"
              >
                <MaskIcon src="/icons/clip-download.svg" size={32} />
              </a>
            ) : (
              <button
                type="button"
                onClick={exportClip}
                aria-busy={phase === "working"}
                aria-label={`Download ${attachment.title}`}
                title="Download clip"
                className={`flex size-[32px] shrink-0 items-center justify-center transition-colors ${
                  phase === "done" ? "text-terra" : "text-body-ink hover:text-muted"
                }`}
              >
                <MaskIcon src="/icons/clip-download.svg" size={32} />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
