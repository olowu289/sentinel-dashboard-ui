import { useCallback, useMemo, useRef } from "react";
import { SITE_TZ, SITE_TZ_LABEL } from "@/lib/time";
import type { RecordingSpan } from "@kallon/sentry-sdk";

/**
 * The recorded window, with readable times along it.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  A CLICK AND A DRAG ARE DIFFERENT REQUESTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Both move the playhead, and only one should wait. A drag crosses hundreds of
 * positions on the way to the one the operator means, so fetching each would
 * spam a relay that shares a link with the site's PTZ keepalives — hence the
 * settle. A click has no journey: the operator has already said exactly where
 * they want to be, and making them wait out a delay designed for the other
 * gesture is lag with a reason nobody can see.
 *
 * So this reports which gesture it was, and the player decides. Pointer down
 * and every move while held are TENTATIVE — settled, so a drag cannot spam —
 * and the release is DEFINITE. That covers both cases without tracking which
 * one it was: a click is a down and an up with no moves between them, so its
 * release fetches at once; a drag's releases does the same after its moves have
 * been absorbed by the settle.
 *
 * ── WHY TICKS, AND WHY NOT MANY ────────────────────────────────────────
 *
 * "Something happened around 12" is how an operator arrives at this screen,
 * and a bar labelled only at its ends makes them hunt for noon by feel. Ticks
 * turn that into a click. The interval is chosen from the window's length so a
 * 20-minute window is not labelled every half hour and a week is not labelled
 * every five minutes — roughly six to ten labels either way, which is as many
 * as fit before they collide.
 *
 * Times are SITE time, labelled. The app's whole time discipline (see
 * lib/time.ts) is that a time following the viewer's machine is worse than no
 * time at all, because incidents are handed over by radio between regions.
 */

/** Candidate tick spacings, smallest first. Milliseconds. */
const STEPS = [
  60_000,          // 1 min
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,     // 1 hour
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
];

/** Aim for this many labels; the first spacing that stays under it wins. */
const TARGET_TICKS = 8;

export function tickStepFor(spanMs: number): number {
  for (const step of STEPS) {
    if (spanMs / step <= TARGET_TICKS) return step;
  }
  return STEPS[STEPS.length - 1];
}

const tickLabel = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SITE_TZ,
});

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: SITE_TZ,
});

export function PlaybackTimeline({
  from,
  to,
  at,
  spans,
  onSeek,
}: {
  from: number;
  to: number;
  at: number;
  spans: RecordingSpan[];
  /** `immediate` is true for a click or the end of a drag. */
  onSeek: (epochMs: number, immediate: boolean) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const span = Math.max(1, to - from);
  const pct = (t: number) => ((t - from) / span) * 100;

  const timeAtClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return from + ratio * span;
    },
    [from, span],
  );

  const ticks = useMemo(() => {
    const step = tickStepFor(span);
    const out: { at: number; label: string; major: boolean }[] = [];
    // Aligned to the step in SITE time, so a 30-minute tick lands on :00 and
    // :30 rather than on whatever moment the window happens to start at.
    const first = Math.ceil(from / step) * step;
    let prevDay = "";
    for (let t = first; t <= to; t += step) {
      /* ⚠ THE DAY BOUNDARY IS THE SITE'S, NOT UTC'S. Testing `t % 86400000`
         finds midnight in UTC, which on this fleet's timezone (UTC+1) puts the
         date label at 01:00 and leaves the actual midnight tick reading
         "00:00" with no date beside it — in a window that may span days. So
         the day is taken from the same site-timezone formatter the labels use,
         and a tick is major when that day differs from the tick before it. */
      const day = dayLabel.format(t);
      out.push({
        at: t,
        label: tickLabel.format(t),
        major: prevDay !== "" && day !== prevDay,
      });
      prevDay = day;
    }
    return out;
  }, [from, to, span]);

  /* Which parts of the bar actually have footage. A window is not necessarily
     continuous — a tower that was down leaves a hole — and drawing the bar as
     one solid stretch would promise footage that is not there. */
  const covered = useMemo(
    () =>
      spans.map((s) => {
        const start = Date.parse(s.start);
        return { left: pct(start), width: ((s.duration * 1000) / span) * 100 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spans, from, span],
  );

  return (
    <div className="flex flex-col gap-[6px]">
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Scrub recorded footage"
        aria-valuemin={from}
        aria-valuemax={to}
        aria-valuenow={at}
        aria-valuetext={`${tickLabel.format(at)} ${SITE_TZ_LABEL}`}
        className="relative h-[26px] w-full cursor-pointer touch-none select-none rounded-[6px] bg-black/45"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          const t = timeAtClientX(e.clientX);
          // Move the playhead at once so the bar feels attached to the finger,
          // but do not fetch yet — this may turn out to be the start of a drag.
          if (t !== null) onSeek(t, false);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const t = timeAtClientX(e.clientX);
          if (t !== null) onSeek(t, false);   // settled, so a drag cannot spam
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const t = timeAtClientX(e.clientX);
          // A click (never moved) and the END of a drag are both definite:
          // fetch now. Only the middle of a drag waits.
          if (t !== null) onSeek(t, true);
        }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(e) => {
          const step = tickStepFor(span) / 30;
          if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(Math.max(from, at - step), true); }
          if (e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.min(to, at + step), true); }
        }}
      >
        {/* what the tower actually holds */}
        {covered.map((c, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-[6px] rounded-[3px] bg-white/15"
            style={{ left: `${c.left}%`, width: `${Math.max(0.4, c.width)}%` }}
          />
        ))}

        {/* the ticks */}
        {ticks.map((t) => (
          <div
            key={t.at}
            aria-hidden
            className={`pointer-events-none absolute top-0 w-px ${
              t.major ? "h-full bg-white/45" : "h-[8px] bg-white/25"
            }`}
            style={{ left: `${pct(t.at)}%` }}
          />
        ))}

        {/* the playhead */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-[2px] bg-white"
          style={{ left: `${pct(at)}%` }}
        />
      </div>

      {/* the labels, under the bar so they cannot crowd it */}
      <div className="relative h-[14px] w-full">
        {ticks.map((t) => (
          <span
            key={t.at}
            aria-hidden
            className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums text-muted"
            style={{ left: `${pct(t.at)}%` }}
          >
            {t.major ? dayLabel.format(t.at) : t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
