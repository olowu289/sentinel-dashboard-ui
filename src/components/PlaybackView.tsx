import { useEffect, useMemo, useRef, useState } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import type { CameraFeed, Tower } from "@/lib/types";
import { covered, useReviewPlayer } from "@/lib/useReviewPlayer";
import { PlaybackTimeline } from "@/components/PlaybackTimeline";
import { SITE_TZ_LABEL, formatSiteStamp } from "@/lib/time";
import { segmentDownloadUrl } from "@/lib/api/recordings";

/**
 * Recorded footage, read from the HUB archive.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  A SEPARATE SCREEN, AND THAT IS THE DESIGN, NOT THE LAYOUT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Review is not a mode on the live tile: a tile is a monitor, and an operator
 * watching four sites does not want one to stop being live because somebody
 * wanted to check what happened a minute ago. The wall is for what is happening;
 * this screen is for what happened.
 *
 * ── WHAT IS HONEST HERE ────────────────────────────────────────────────
 *
 *   the window     is the segments the HUB actually holds in its storage backend,
 *                  not the retention setting. Archiving that was off, or a hub
 *                  that was down, means fewer — said plainly.
 *   a gap          says so. An instant no segment covers renders as a boundary,
 *                  not a fault.
 *   storage        is invisible. Each segment plays from a URL the hub returned;
 *                  whether that is a bucket or a local disk never reaches here.
 *   the clock      is the footage's own recorded time. The current segment's
 *                  start turns the video's own time into a quotable wall clock.
 */

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
  const { phase, spans, bounds, positionAt, current, currentStartAt } = review;

  const videoRef = useRef<HTMLVideoElement>(null);

  /* ── keep the picture on the playhead ────────────────────────────────
     The video seeks over HTTP Range within its segment, so a scrub is just a
     `currentTime`. This corrects the element to the playhead ONLY when they are
     far apart — a real seek — and ignores the sub-second drift of normal
     playback, which reports its own position back through `seekQuiet` and must
     not be fought frame by frame. On a new segment the element mounts at 0 and
     this seeks it to the right offset. */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || currentStartAt === null || positionAt === null) return;
    const want = (positionAt - currentStartAt) / 1000;
    if (want >= 0 && Math.abs(v.currentTime - want) > 1) {
      try {
        v.currentTime = want;
      } catch {
        /* Seeking before metadata is loaded throws; `onLoadedMetadata` retries. */
      }
    }
  }, [positionAt, currentStartAt, current]);

  /* SITE time, labelled — not the viewer's machine. Operators hand incidents off
     by radio across shifts and regions, so a time that silently follows whoever
     is looking is worse than none. This screen's whole output is "when did this
     happen", so it is the last place to get that wrong. */
  const stamp = positionAt !== null ? formatSiteStamp(positionAt) : null;

  const feed = cameras.find((f) => f.index === chosen);
  const tower = towers.find((t) => t.id === towerId);

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
          <h1 className="font-display text-[1.125rem] leading-[24px] tracking-[0.18px] uppercase">
            Playback
          </h1>
          <span className="text-[0.8125rem] leading-[20px] text-muted">
            Archived footage held on the hub
          </span>
        </header>

        {/* ── pick a site and a camera ───────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-[8px]">
          <select
            aria-label="Site"
            value={towerId ?? ""}
            onChange={(e) => { setTowerId(e.target.value); setCamera(null); }}
            className="h-[34px] rounded-[8px] bg-card px-[10px] text-[0.8125rem] font-medium text-white transition-colors hover:bg-card-hover"
          >
            {towers.map((t) => (
              <option key={t.id} value={t.id}>{t.site || t.id}</option>
            ))}
          </select>

          {cameras.length === 0 ? (
            <span className="text-[0.8125rem] leading-[20px] text-muted">
              This site has no cameras to review.
            </span>
          ) : (
            cameras.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCamera(f.index ?? null)}
                aria-pressed={chosen === f.index}
                className={`h-[34px] truncate rounded-[8px] px-[12px] text-[0.8125rem] font-medium transition-colors ${
                  chosen === f.index
                    ? "bg-white text-black"
                    : "bg-card text-white hover:bg-card-hover"
                }`}
              >
                {f.name ?? f.id}
              </button>
            ))
          )}
        </div>

        {/* ── the picture ────────────────────────────────────────────── */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-stage">
          {current ? (
            <video
              /* Keyed on the segment URL so a segment change remounts the element
                 cleanly; the seek effect above puts it on the playhead. */
              key={current.url}
              ref={videoRef}
              src={current.url}
              autoPlay
              playsInline
              controls
              className="absolute inset-0 size-full object-contain"
              onLoadedMetadata={(e) => {
                if (currentStartAt === null || positionAt === null) return;
                const want = (positionAt - currentStartAt) / 1000;
                if (want > 0) e.currentTarget.currentTime = want;
              }}
              onTimeUpdate={(e) => {
                /* WALL CLOCK, not segment offset. The segment knows when it
                   starts, so the playhead is that plus the element's own time —
                   which is what makes the readout quotable. */
                if (currentStartAt === null) return;
                review.seekQuiet(currentStartAt + e.currentTarget.currentTime * 1000);
              }}
              /* Playing off the end of a segment advances into the next one
                 rather than stopping — the operator asked to watch, not to watch
                 one segment. */
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
              <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] tabular-nums text-white">
                {stamp ? `${stamp.date} ${stamp.time}` : "—"}
                <span className="ml-[6px] text-[0.75rem] text-muted">
                  {SITE_TZ_LABEL}
                </span>
              </span>
            </div>

            <PlaybackTimeline
              from={bounds.from}
              to={bounds.to}
              at={positionAt}
              spans={spans}
              onSeek={(t) => review.seek(t)}
            />

            {/* ── download ─────────────────────────────────────────────
                A whole segment, not a trimmed clip: the archive stores complete
                ~15-minute segments and the hub does no server-side cut, so the
                honest offer is the segment under the playhead, in full, said
                plainly rather than a trimmed file that quietly wasn't. */}
            <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-[8px] bg-panel px-[12px] py-[10px]">
              {current ? (
                <>
                  <span className="min-w-0 flex-1 text-[0.8125rem] leading-[20px] text-muted">
                    Save the segment under the playhead
                    {feed?.name ? ` — ${feed.name}` : ""}
                    {" "}({formatSegmentLength(current.duration)}).
                  </span>
                  <a
                    href={segmentDownloadUrl(current)}
                    download
                    className="flex h-[32px] items-center justify-center gap-[8px] rounded-[8px] bg-white px-[14px] text-[0.8125rem] font-medium tracking-[0.13px] text-black transition-opacity hover:opacity-90"
                  >
                    Download segment
                  </a>
                </>
              ) : (
                <span className="text-[0.8125rem] leading-[20px] text-muted">
                  Scrub to a moment the hub was recording to download it.
                </span>
              )}
            </div>

            <div className="flex flex-wrap justify-between gap-x-[12px] text-[0.75rem] leading-[16px] text-muted">
              {/* THE ARCHIVED BOUNDARY. The left edge is where the hub's archive
                  begins. An operator who scrubs into nothing deserves to know it
                  was never kept rather than wonder whether the screen is broken. */}
              <span>{tower?.site ?? towerId ?? "This tower"} — hub archive</span>
              {!covered(spans, positionAt) && (
                <span className="text-warn">
                  No footage at this moment — the hub was not recording then.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** `1m 30s`, `45s`, `15m` — the length of the segment being offered. */
function formatSegmentLength(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
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
    return <p className="text-[0.8125rem] leading-[20px] text-muted">Pick a site with cameras.</p>;
  }
  if (phase.kind === "opening") {
    return (
      <p className="text-[0.8125rem] leading-[20px] text-muted">Asking the hub what it holds…</p>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-[10px]">
        <p className="font-display text-[0.8125rem] leading-[20px] tracking-[0.13px] text-critical">
          {phase.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[6px] border border-critical/40 px-[10px] py-[3px] text-[0.75rem] font-medium text-critical transition-colors hover:border-critical hover:bg-critical/10"
        >
          Try again
        </button>
      </div>
    );
  }
  if (phase.kind === "no_footage") {
    return (
      <p className="text-[0.8125rem] leading-[20px] text-muted">
        No footage covers this moment. Scrub to a time the hub was recording.
      </p>
    );
  }
  if (!hasSpans) {
    /* An empty window is a real answer, not an empty state to dress up: the hub
       holds nothing for this camera. Archiving may be off, or the hub may be
       new. Either way there is nothing to scrub. */
    return (
      <p className="text-[0.8125rem] leading-[20px] text-muted">No archived footage for this camera yet.</p>
    );
  }
  return <p className="text-[0.8125rem] leading-[20px] text-muted">Loading footage…</p>;
}
