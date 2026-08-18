import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALERT_BADGE } from "@/lib/data";
import { ENTER, EXIT } from "@/lib/motion";
import { formatClock, formatDuration } from "@/lib/time";
import type { Alert, AlertAttachment } from "@/lib/types";
import { useExportPhase } from "@/lib/useExportPhase";
import { MaskIcon } from "./Icon";

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

/** mm:ss for the transport. Tabular everywhere so the digits never shift. */
function timecode(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PREV_MARK = "M18 5v14M8 12l8-6.5v13L8 12ZM6 5v14";
const NEXT_MARK = "M6 5v14M16 12 8 5.5v13L16 12ZM18 5v14";
const BACK_10 = "M11 8 7 12l4 4M7 12h6a4 4 0 1 1 0 8";
const FWD_10 = "m13 8 4 4-4 4M17 12h-6a4 4 0 1 0 0 8";

/**
 * Reviewing one recorded clip.
 *
 * A takeover rather than an inline player: the clip is evidence, and evidence
 * gets looked at properly. It borrows the camera takeover's shape — `fixed`,
 * `role="dialog"`, `Esc` out — so the two full-screen surfaces in this app
 * behave the same way.
 *
 * Two things here that a consumer player never has, and that this one exists
 * for. The frame carries the **wall-clock time of the playhead**, not just the
 * clip-relative one: `00:06` is where you are in the file, `02:41:18 AM WAT` is
 * when it happened, and only the second is quotable on a handoff. And the
 * scrubber is **marked with the alert's own timeline**, so the detections are
 * visible as positions before you play anything — jumping to the next one is a
 * button rather than a hunt.
 *
 * The transport is real; the media is not. There is no backend, so the clip is
 * the still the rest of the app uses and the playhead is driven by a clock
 * here. Swapping in a real `<video>` means replacing that clock with
 * `timeupdate` and leaving everything else alone.
 */
export function ClipPlayer({
  attachment,
  /** Epoch ms of the timeline step this clip was captured at. */
  at,
  alert,
  onClose,
}: {
  attachment: AlertAttachment;
  at: number;
  alert: Alert;
  onClose: () => void;
}) {
  const duration = attachment.durationSec ?? 15;
  const startsAt = at - PRE_ROLL_SEC * 1000;

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState<number>(1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { phase, start: exportClip } = useExportPhase();

  /* The alert's own steps, placed on the track. Only the ones that actually
     fall inside this clip's window — a marker for something the footage does
     not contain would send the operator looking for a frame that was never
     recorded. */
  const markers = useMemo(() => {
    const steps = alert.timeline ?? [
      { at: alert.at, icon: alert.kind, title: alert.title },
    ];
    return steps
      .map((e) => ({ ...e, offset: (e.at - startsAt) / 1000 }))
      .filter((e) => e.offset >= 0 && e.offset <= duration)
      .sort((a, b) => a.offset - b.offset);
  }, [alert, startsAt, duration]);

  const seek = useCallback(
    (to: number) => setT(Math.min(duration, Math.max(0, to))),
    [duration],
  );

  const jumpMarker = useCallback(
    (dir: 1 | -1) => {
      // A hair of slack, so "next" from exactly on a marker does not re-find it.
      const next =
        dir === 1
          ? markers.find((m) => m.offset > t + 0.15)
          : [...markers].reverse().find((m) => m.offset < t - 0.15);
      if (next) seek(next.offset);
    },
    [markers, t, seek],
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
  const camera = alert.cameras?.[0] ?? alert.source;
  const wallClock = formatClock(startsAt + t * 1000);

  return (
    <motion.div
      role="dialog"
      aria-modal
      aria-label={`Reviewing ${attachment.title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: ENTER }}
      exit={{ opacity: 0, transition: EXIT }}
      className="fixed inset-0 z-100 flex flex-col bg-black"
    >
      <header className="flex h-[56px] shrink-0 items-center gap-[12px] border-b border-line px-[16px] lg:px-[20px]">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[0.9375rem] leading-[20px] tracking-[0.15px] text-white">
            {attachment.title}
          </p>
          {/* Everything needed to say what this footage is, in the order an
              operator would read it out: which camera, which incident. */}
          <p className="truncate text-[0.75rem] leading-[16px] text-white/45 tabular-nums">
            {camera} · {alert.zone} · {alert.id}
          </p>
        </div>

        <button
          type="button"
          onClick={exportClip}
          aria-busy={phase === "working"}
          aria-label={`Download ${attachment.title}`}
          title="Download clip"
          className={`flex size-[40px] shrink-0 items-center justify-center rounded-[8px] transition-colors ${
            phase === "done"
              ? "text-terra"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <MaskIcon src="/icons/clip-download.svg" size={22} />
        </button>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close clip"
          title="Close (Esc)"
          className="flex size-[40px] shrink-0 items-center justify-center rounded-[8px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="m3 3 8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-tile-dead">
        {/* `contain`, unlike the walls, which fill. A tile is a monitor and a
            crop costs nothing there; this is the frame an incident gets
            decided on, and cropping evidence to fit a box is how the thing
            that mattered ends up outside the picture. */}
        <img
          src={attachment.thumbnail}
          alt=""
          className="absolute inset-0 size-full object-contain"
        />

        {/* The burn-in — the one value that survives a screenshot being pasted
            into a report, where a clip-relative 00:06 means nothing. A DVR
            stamps this into the frame itself; here it sits in the letterbox
            beside it, because the media is `object-contain` and evidence is
            the one thing chrome must never cover. */}
        <span className="chip-blur absolute bottom-[12px] left-[12px] rounded-[4px] bg-black/55 px-[8px] py-[4px] font-display text-[0.8125rem] tracking-[0.13px] text-white tabular-nums">
          {wallClock}
        </span>
      </div>

      <div className="shrink-0 border-t border-line px-[16px] pb-[calc(14px+env(safe-area-inset-bottom))] pt-[12px] lg:px-[20px]">
        {/* Elapsed and total sit at the two ends of the track rather than as a
            "00:06 / 00:15" fraction. The number under the playhead is the one
            being read; parking it against the runtime makes both harder. */}
        <div className="flex items-center gap-[12px]">
          <span className="w-[42px] shrink-0 font-display text-[0.75rem] tracking-[0.12px] text-white tabular-nums">
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
              className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/15"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white"
              style={{ width: `${pct}%` }}
            />

            {/* Detections as positions. Amber is already this app's word for a
                detection, so the marks need no legend; a fault keeps red. */}
            {markers.map((m) => (
              <button
                key={`${m.at}-${m.title}`}
                type="button"
                onClick={() => seek(m.offset)}
                aria-label={`Jump to ${m.title}, ${formatClock(m.at)}`}
                title={`${m.title} · ${formatClock(m.at)}`}
                className="absolute top-1/2 z-20 h-[16px] w-[10px] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(m.offset / duration) * 100}%` }}
              >
                <span
                  className={`mx-auto block h-[16px] w-[2px] rounded-full transition-[height,width] ${
                    m.icon === "fault" ? "bg-critical" : "bg-detect"
                  }`}
                />
              </button>
            ))}

            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 z-30 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-black"
              style={{ left: `${pct}%` }}
            />
          </div>

          <span className="w-[42px] shrink-0 text-right font-display text-[0.75rem] tracking-[0.12px] text-white/45 tabular-nums">
            {timecode(duration)}
          </span>
        </div>

        <div className="mt-[10px] flex items-center gap-[10px]">
          {/* Segmented, not a menu. Review is mostly a hunt at speed, and the
              whole range being visible means changing rate is one press rather
              than open-read-choose. */}
          <div
            role="group"
            aria-label="Playback speed"
            className="flex shrink-0 items-center gap-[2px] rounded-[6px] bg-white/6 p-[2px]"
          >
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                title={`${r}× speed`}
                className={`rounded-[4px] px-[7px] py-[3px] font-display text-[0.6875rem] tracking-[0.11px] tabular-nums transition-colors ${
                  rate === r
                    ? "bg-white text-black"
                    : "text-white/55 hover:text-white"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>

          <div className="flex flex-1 items-center justify-center gap-[2px]">
            <button
              type="button"
              onClick={() => jumpMarker(-1)}
              disabled={!markers.some((m) => m.offset < t - 0.15)}
              aria-label="Previous detection"
              title="Previous detection"
              className="flex size-[36px] items-center justify-center rounded-[8px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <Icon d={PREV_MARK} />
            </button>
            <button
              type="button"
              onClick={() => setT((v) => Math.max(0, v - SKIP_SEC))}
              aria-label={`Back ${SKIP_SEC} seconds`}
              title={`Back ${SKIP_SEC}s (←)`}
              className="flex size-[36px] items-center justify-center rounded-[8px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon d={BACK_10} />
            </button>

            {/* The one control that is always reachable and always the same
                size, because it is the one an operator hits without looking. */}
            <button
              type="button"
              onClick={() => {
                // Replay rather than sit dead on the last frame.
                if (t >= duration) seek(0);
                setPlaying((p) => !p);
              }}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className="mx-[4px] flex size-[44px] items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/90"
            >
              {playing ? (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                  <rect x="3.5" y="2.5" width="4" height="13" rx="1" fill="currentColor" />
                  <rect x="10.5" y="2.5" width="4" height="13" rx="1" fill="currentColor" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                  <path d="M5 2.8 15 9 5 15.2V2.8Z" fill="currentColor" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => setT((v) => Math.min(duration, v + SKIP_SEC))}
              aria-label={`Forward ${SKIP_SEC} seconds`}
              title={`Forward ${SKIP_SEC}s (→)`}
              className="flex size-[36px] items-center justify-center rounded-[8px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon d={FWD_10} />
            </button>
            <button
              type="button"
              onClick={() => jumpMarker(1)}
              disabled={!markers.some((m) => m.offset > t + 0.15)}
              aria-label="Next detection"
              title="Next detection"
              className="flex size-[36px] items-center justify-center rounded-[8px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <Icon d={NEXT_MARK} />
            </button>
          </div>

          {/* What the marks mean, without a legend: the badge set the alert
              rows and the timeline already use, at the count found here. */}
          <div className="hidden shrink-0 items-center gap-[6px] sm:flex">
            {markers.slice(0, 4).map((m) => (
              <img
                key={`${m.at}-badge`}
                src={ALERT_BADGE[m.icon]}
                alt=""
                width={18}
                height={18}
              />
            ))}
            <span className="font-display text-[0.6875rem] tracking-[0.11px] text-white/45 tabular-nums">
              {markers.length} in {formatDuration(duration)}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
