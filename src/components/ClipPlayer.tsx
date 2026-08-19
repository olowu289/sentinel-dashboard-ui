import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ENTER, EXIT } from "@/lib/motion";
import { formatClock } from "@/lib/time";
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

/** mm:ss for the transport. Tabular everywhere so the digits never shift. */
function timecode(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* The pill's own controls: 40px chip, 21.333px glyph, per the frame. */
const CHIP =
  "flex size-[40px] shrink-0 items-center justify-center rounded-[10px] text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30";

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
  /** Epoch ms of the timeline step this clip was captured at. */
  at,
  alert,
  towerName,
  onNavigate,
  onClose,
}: {
  attachment: AlertAttachment;
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
  const duration = attachment.durationSec ?? 15;
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
    (to: number) => setT(Math.min(duration, Math.max(0, to))),
    [duration],
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

  /* Playback. A clock rather than a media element, because the media is a
     still — see the note above. Time is scaled by the rate so 4× actually
     covers four seconds of footage per second, rather than just relabelling
     the button. */
  useEffect(() => {
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
  }, [playing, rate, duration]);

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
              className="shrink-0 font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <button
              type="button"
              onClick={onClose}
              className="min-w-0 truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
            >
              {towerName}
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span className="flex min-w-0 items-center gap-[6px]">
              <span
                aria-current="page"
                className="truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white uppercase"
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
            className="ml-auto flex size-[20px] shrink-0 items-center justify-center text-white transition-colors hover:text-muted"
          >
            <MaskIcon src="/icons/clip-close.svg" size={20} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-stage">
          {/* `contain`, unlike the walls, which fill. A tile is a monitor and a
              crop costs nothing there; this is the frame an incident gets
              decided on, and cropping evidence to fit a box is how the thing
              that mattered ends up outside the picture. */}
          <img
            src={attachment.thumbnail}
            alt=""
            className="absolute inset-0 size-full object-contain"
          />

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
            <span className="shrink-0 font-display text-[1rem] leading-[20px] font-bold tracking-[0.16px] text-white tabular-nums">
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
                className="pointer-events-none absolute left-0 top-1/2 h-[6px] -translate-y-1/2 rounded-l-[6px] bg-white"
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
                className="pointer-events-none absolute top-1/2 z-30 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-black"
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
                  <span className="font-display text-[1rem] leading-[20px] tracking-[0.16px] text-white">
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
                className="font-display text-[1rem] leading-[20px] tracking-[0.16px] text-white tabular-nums transition-colors hover:text-muted"
              >
                {rate}X
              </button>
            </div>

            <button
              type="button"
              onClick={exportClip}
              aria-busy={phase === "working"}
              aria-label={`Download ${attachment.title}`}
              title="Download clip"
              className={`flex size-[32px] shrink-0 items-center justify-center transition-colors ${
                phase === "done" ? "text-terra" : "text-white hover:text-muted"
              }`}
            >
              <MaskIcon src="/icons/clip-download.svg" size={32} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
