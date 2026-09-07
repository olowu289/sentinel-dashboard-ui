import { useMemo, useState } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import type { CameraFeed, Tower } from "@/lib/types";
import { SLICE_SEC, covered, useReviewPlayer } from "@/lib/useReviewPlayer";
import { PlaybackTimeline } from "@/components/PlaybackTimeline";
import { SITE_TZ_LABEL, formatSiteStamp } from "@/lib/time";

/**
 * Recent recorded footage from a tower's own disk.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  A SEPARATE SCREEN, AND THAT IS THE DESIGN, NOT THE LAYOUT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Review was going to be a mode on the live tile. It is not, because a tile is
 * a monitor: an operator watching four sites does not want one of them to stop
 * being live because somebody wanted to check what happened a minute ago. The
 * wall is for what is happening; this screen is for what happened. Opening it
 * changes nothing about the wall — the shell keeps the live sessions, and this
 * screen opens its own.
 *
 * ── IT IS CALLED PLAYBACK, NOT EVENTS ──────────────────────────────────
 *
 * "Events" would promise detected occurrences — a list of things the system
 * decided were worth looking at — and nothing in this product detects them
 * yet. Naming a scrubber after a feature that does not exist is how a demo
 * becomes a lie. Events can sit on top of this later, when something is
 * actually finding them.
 *
 * ── WHAT IS HONEST HERE ────────────────────────────────────────────────
 *
 *   the window     comes from the tower's disk (/list), not from the retention
 *                  setting. A power cut takes footage the policy still claims.
 *   a gap          says so. The tower answering "nothing covers that moment"
 *                  is an ANSWER, and it renders as a boundary, not a fault.
 *   the edge       of the earliest span is where this tower's memory ends.
 *                  Older is archived — a bucket that does not exist yet, said
 *                  plainly rather than shown as an empty timeline.
 *   the clock      is the footage's own recorded time. An offset into a slice
 *                  is not something anybody can put in a handover.
 */
/** How far before a slice ends to start fetching the next one. Long enough to
 *  cover a relay of a few megabytes, short enough that a viewer who scrubs away
 *  has usually already done so. */
const PREFETCH_LEAD_SEC = 6;

export function PlaybackView({
  towers,
  feeds,
  onNavigate,
  onBack,
}: {
  towers: Tower[];
  feeds: CameraFeed[];
  onNavigate: (id: string) => void;
  onBack: () => void;
}) {
  const [towerId, setTowerId] = useState<string | null>(towers[0]?.id ?? null);
  const cameras = useMemo(
    () => feeds.filter((f) => f.towerId === towerId && f.index !== undefined),
    [feeds, towerId],
  );
  const [camera, setCamera] = useState<number | null>(null);
  const chosen = camera ?? cameras[0]?.index ?? null;

  const review = useReviewPlayer(towerId, chosen ?? null);
  const { phase, spans, bounds, positionAt, sliceUrl, sliceStartAt } = review;

  /* SITE time, labelled — not the viewer's machine. lib/time.ts states the
     rule and the reason: operators hand incidents off by radio across shifts
     and regions, so a time that silently follows whoever is looking is worse
     than no time at all. This screen's whole output is "when did this happen",
     which makes it the last place to get that wrong. */
  const stamp = positionAt !== null ? formatSiteStamp(positionAt) : null;

  return (
    <div className="flex h-full min-h-0 w-full">
      <IconRail active="playback" onSelect={onNavigate} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[14px] p-[16px] lg:p-[24px]">
        <header className="flex items-center gap-[12px]">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="chip-blur flex size-[32px] items-center justify-center rounded-[8px] bg-card hover:bg-card-hover"
          >
            <MaskIcon src="/icons/chevron-right.svg" size={16} />
          </button>
          <h1 className="text-[18px] font-medium">Playback</h1>
          <span className="text-[12px] text-muted">
            Recent footage held on the tower
          </span>
        </header>

        {/* ── pick a site and a camera ───────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-[8px]">
          <select
            aria-label="Site"
            value={towerId ?? ""}
            onChange={(e) => { setTowerId(e.target.value); setCamera(null); }}
            className="rounded-[8px] bg-card px-[10px] py-[6px] text-[13px]"
          >
            {towers.map((t) => (
              <option key={t.id} value={t.id}>{t.site || t.id}</option>
            ))}
          </select>

          {cameras.length === 0 ? (
            <span className="text-[12px] text-muted">
              This site has no cameras to review.
            </span>
          ) : (
            cameras.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCamera(f.index ?? null)}
                className={`rounded-[8px] px-[10px] py-[6px] text-[13px] transition-colors ${
                  chosen === f.index ? "bg-white/20" : "bg-card hover:bg-card-hover"
                }`}
              >
                {f.name ?? f.id}
              </button>
            ))
          )}
        </div>

        {/* ── the picture ────────────────────────────────────────────── */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-stage">
          {sliceUrl ? (
            <video
              key={sliceUrl}
              src={sliceUrl}
              autoPlay
              playsInline
              controls
              className="absolute inset-0 size-full object-contain"
              onTimeUpdate={(e) => {
                /* WALL CLOCK, not clip offset. The slice knows when it starts,
                   so the playhead is that plus the element's own time — which
                   is what makes the readout quotable. */
                if (sliceStartAt === null) return;
                const v = e.currentTarget;
                review.seekQuiet(sliceStartAt + v.currentTime * 1000);
                /* Fetch the NEXT slice before this one runs out. The boundary
                   is the only place this screen can stall — the file ends and
                   the next has not been asked for — and a few seconds of lead
                   turns that stall into a hand-off. One ahead only; the hook
                   drops it if it is already cached or a fetch is running. */
                const left = (v.duration || SLICE_SEC) - v.currentTime;
                if (left <= PREFETCH_LEAD_SEC) review.prefetchNext();
              }}
              /* Playing off the end of a 20s slice fetches the next one rather
                 than stopping — the operator asked to watch, not to watch one
                 slice. */
              onEnded={review.advance}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-[24px] text-center">
              <Message phase={phase} hasCameras={cameras.length > 0}
                       hasSpans={spans.length > 0} onRetry={review.retry} />
            </div>
          )}
        </div>

        {/* ── the scrubber, over what actually exists ────────────────── */}
        {bounds && positionAt !== null && (
          <div className="flex flex-col gap-[6px]">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[13px] tabular-nums">
                {stamp ? `${stamp.date} ${stamp.time}` : "—"}
                <span className="ml-[6px] text-[11px] text-muted">{SITE_TZ_LABEL}</span>
              </span>
              {review.loading && (
                <span className="text-[11px] text-muted">loading…</span>
              )}
            </div>

            <PlaybackTimeline
              from={bounds.from}
              to={bounds.to}
              at={positionAt}
              spans={spans}
              onSeek={review.seek}
            />

            <div className="flex justify-between text-[11px] text-muted">
              {/* THE ARCHIVED BOUNDARY. The left edge is where this tower's
                  memory ends — said plainly, because an operator who scrubs
                  into nothing deserves to know it was never there rather than
                  to wonder whether the screen is broken. */}
              <span>older is archived</span>
              {!covered(spans, positionAt) && (
                <span className="text-warning">
                  No footage at this moment — the tower was not recording then.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Message({
  phase, hasCameras, hasSpans, onRetry,
}: {
  phase: ReturnType<typeof useReviewPlayer>["phase"];
  hasCameras: boolean;
  hasSpans: boolean;
  onRetry: () => void;
}) {
  if (!hasCameras) {
    return <p className="text-[13px] text-muted">Pick a site with cameras.</p>;
  }
  if (phase.kind === "opening") {
    return <p className="text-[13px] text-muted">Asking the tower what it holds…</p>;
  }
  if (phase.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-[10px]">
        <p className="text-[13px] text-critical">{phase.message}</p>
        <button type="button" onClick={onRetry}
                className="rounded-[8px] bg-card px-[12px] py-[6px] text-[13px] hover:bg-card-hover">
          Try again
        </button>
      </div>
    );
  }
  if (phase.kind === "no_footage") {
    return (
      <p className="text-[13px] text-muted">
        No footage covers this moment. Scrub to a time the tower was recording.
      </p>
    );
  }
  if (!hasSpans) {
    /* An empty window is a real answer, not an empty state to dress up: this
       camera has nothing on disk. Recording may be off, or the disk may be
       new. Either way there is nothing to scrub. */
    return (
      <p className="text-[13px] text-muted">
        No recordings on this camera yet.
      </p>
    );
  }
  return <p className="text-[13px] text-muted">Loading footage…</p>;
}
