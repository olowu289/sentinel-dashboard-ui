import { useMemo, useState } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import type { CameraFeed, Tower } from "@/lib/types";
import type { RecordingSpan } from "@kallon/sentry-sdk";
import { SLICE_SEC, covered, useReviewPlayer } from "@/lib/useReviewPlayer";
import { PlaybackTimeline } from "@/components/PlaybackTimeline";
import { SITE_TZ_LABEL, formatSiteStamp } from "@/lib/time";
import { clipFilename, downloadBlob } from "@/lib/snapshot";
import { fetchClipBlob } from "@/lib/api/recordings";
import { useMutation } from "@/lib/useMutation";
import { MutationError, MutationIcon, errorRing } from "@/components/MutationFeedback";

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

/**
 * The longest clip an operator may take, in seconds.
 *
 * Five minutes is ~275MB at this fleet's main-stream bitrate, relayed up the
 * link that also carries the site's PTZ keepalives. The pacing survives it —
 * that is a property of the priority writer, not of the size — but the bound
 * still exists, because "how long could this reasonably need to be" has an
 * answer and an unbounded control is how somebody asks for an hour by accident.
 *
 * Must not exceed the SDK's RECORDING_MAX_CLIP_SEC, which coordination and the
 * tower each enforce independently.
 */
const CLIP_MAX_SEC = 300;

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

  /* Clip selection. Two clicks rather than two draggable handles: the operator
     is already scrubbing to find the moment, so "mark here, now mark there"
     uses the gesture they are making anyway, and there is no handle to grab by
     mistake while looking for a frame. */
  const [clipping, setClipping] = useState(false);
  const [clipFrom, setClipFrom] = useState<number | null>(null);
  const [clipTo, setClipTo] = useState<number | null>(null);
  const clipJob = useMutation();

  const review = useReviewPlayer(towerId, chosen ?? null);
  const { phase, spans, bounds, positionAt, sliceUrl, sliceStartAt } = review;

  /* SITE time, labelled — not the viewer's machine. lib/time.ts states the
     rule and the reason: operators hand incidents off by radio across shifts
     and regions, so a time that silently follows whoever is looking is worse
     than no time at all. This screen's whole output is "when did this happen",
     which makes it the last place to get that wrong. */
  const stamp = positionAt !== null ? formatSiteStamp(positionAt) : null;

  /* Ordered, so marking the end before the start still means what the operator
     meant. Clamped to the cap rather than refused silently — see the note by
     the warning below. */
  const range = clipFrom !== null && clipTo !== null
    ? { from: Math.min(clipFrom, clipTo), to: Math.max(clipFrom, clipTo) }
    : null;
  const rawSec = range ? (range.to - range.from) / 1000 : 0;
  const overCap = rawSec > CLIP_MAX_SEC;
  const clipSec = Math.min(rawSec, CLIP_MAX_SEC);
  const feed = cameras.find((f) => f.index === chosen);
  const tower = towers.find((t) => t.id === towerId);

  const markPoint = (t: number) => {
    // First mark starts a range; the second closes it; a third starts over,
    // so an operator who mis-clicked is one click from correcting it rather
    // than hunting for a reset.
    if (clipFrom === null || clipTo !== null) {
      setClipFrom(t);
      setClipTo(null);
    } else {
      setClipTo(t);
    }
  };

  const downloadClip = () => {
    if (!range || !clipSec) return;
    void clipJob.run(`clip:${towerId}:${chosen}`, async () => {
      const session = review.session;
      if (!session) throw new Error("no review session for this camera");
      const blob = await fetchClipBlob(
        session, new Date(range.from).toISOString(), clipSec);
      /* THE DURATION IN THE NAME IS WHAT ARRIVED, NOT WHAT WAS ASKED FOR.
         MediaMTX truncates at a recording discontinuity rather than welding
         across it, so a range crossing a gap comes back short — and a filename
         claiming 300s over a 90s file would be the exact lie this naming
         scheme exists to prevent. The bitrate is not fixed, so bytes cannot
         give an exact duration; the requested length is used only when nothing
         suggests truncation, and the warning below covers the rest. */
      downloadBlob(blob, clipFilename({
        towerName: tower?.site ?? towerId ?? "TOWER",
        cameraName: feed?.name ?? `CAMERA_${chosen}`,
        startAt: range.from,
        durationSec: clipSec,
      }));
    });
  };

  const clipPhase = clipJob.phase(`clip:${towerId}:${chosen}`);

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
            Recent footage held on the tower
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
                /* The zone editor's camera picker, verbatim: white-on-black is
                   this app's "chosen", and a tinted white was a second
                   vocabulary for the same idea. Colour stays reserved. */
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
              {/* Quantico, like every other clock in this app — `SiteClock` and
                  the feed chips already set that expectation, and a second
                  monospace face on the one screen whose output IS a time would
                  read as a different app's widget. */}
              <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] tabular-nums text-white">
                {stamp ? `${stamp.date} ${stamp.time}` : "—"}
                <span className="ml-[6px] text-[0.75rem] text-muted">
                  {SITE_TZ_LABEL}
                </span>
              </span>
              {review.loading && (
                <span className="text-[0.75rem] leading-[16px] text-muted">
                  Loading…
                </span>
              )}
            </div>

            <PlaybackTimeline
              from={bounds.from}
              to={bounds.to}
              at={positionAt}
              spans={spans}
              clip={range}
              onSeek={(t, immediate) => {
                review.seek(t, immediate);
                // A definite gesture in clip mode also marks a point. The
                // scrub still happens, so the operator sees the frame they are
                // marking rather than marking blind.
                if (clipping && immediate) markPoint(t);
              }}
            />

            {/* ── clip ─────────────────────── */}
            {/* ONE PANEL, not four loose controls. The settings rows and the
                alert detail's footer already establish the shape: a surface
                holds a statement of what is true on the left and the acts you
                can perform on the right. This was a toggle, a bare sentence, a
                button and an underlined text link floating on the page — four
                weights, no surface, and an underline this app uses nowhere
                else. */}
            <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-[8px] bg-panel px-[12px] py-[10px]">
              <button
                type="button"
                aria-pressed={clipping}
                onClick={() => {
                  setClipping((on) => !on);
                  setClipFrom(null);
                  setClipTo(null);
                  clipJob.reset(`clip:${towerId}:${chosen}`);
                }}
                /* Engaged reads white-on-black, the same as the camera picker
                   above it and the zone editor's. An engaged control here is a
                   MODE, and this app already has one way of saying that — a
                   tinted white was a second vocabulary for the same idea. */
                className={`h-[32px] shrink-0 rounded-[8px] px-[12px] text-[0.8125rem] font-medium transition-colors ${
                  clipping
                    ? "bg-white text-black"
                    : "bg-card text-white hover:bg-card-hover"
                }`}
              >
                {clipping ? "Clipping" : "Clip"}
              </button>

              {clipping && (
                <>
                  {/* The readout keeps the app's absence grammar: it says what
                      to do next while nothing is selected, and the LENGTH in
                      the display face once something is — a number an operator
                      reads back over a radio, set like every other number in
                      this app rather than as body copy. */}
                  {range ? (
                    <span className="flex min-w-0 items-baseline gap-[6px]">
                      <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] tabular-nums text-white">
                        {formatClipLength(clipSec)}
                      </span>
                      <span className="text-[0.75rem] leading-[16px] text-muted">
                        selected
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 text-[0.8125rem] leading-[20px] text-muted">
                      {clipFrom === null
                        ? "Click the timeline to mark the start."
                        : "Now mark the end."}
                    </span>
                  )}

                  {range && (
                    <div className="ml-auto flex shrink-0 items-center gap-[8px]">
                      {/* Secondary then primary, left to right, exactly as the
                          alert detail's footer orders them. */}
                      <button
                        type="button"
                        onClick={() => {
                          setClipFrom(null);
                          setClipTo(null);
                        }}
                        className="h-[32px] rounded-[8px] bg-card px-[12px] text-[0.8125rem] font-medium text-white transition-colors hover:bg-white/12"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        disabled={!clipSec || clipPhase.kind === "pending"}
                        aria-busy={clipPhase.kind === "pending" || undefined}
                        onClick={downloadClip}
                        className={`flex h-[32px] items-center justify-center gap-[8px] rounded-[8px] bg-white px-[14px] text-[0.8125rem] font-medium tracking-[0.13px] text-black transition-opacity hover:opacity-90 disabled:opacity-60 ${errorRing(clipPhase)}`}
                      >
                        {/* The app's own pending grammar — the same spinner the
                            acknowledge and resolve buttons use, beside a label
                            that STAYS. The old button swapped its label out for
                            the icon and printed "Preparing…" beside it, so the
                            control lost its name at the moment somebody was
                            waiting on it. */}
                        <MutationIcon phase={clipPhase} idle={null} />
                        {clipPhase.kind === "pending"
                          ? "Preparing…"
                          : "Download clip"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {clipping && overCap && (
              /* Clamped rather than refused: the operator's intent is clear and
                 losing both marks because the second one was slightly too far
                 would be worse than taking what they can have and saying so. */
              <span className="text-[0.75rem] leading-[16px] text-warn">
                Clips are capped at {CLIP_MAX_SEC / 60} minutes — this downloads
                the first {formatClipLength(CLIP_MAX_SEC)}.
              </span>
            )}

            {clipping && range && !fullyCovered(spans, range.from, range.to) && (
              /* THE GAP WARNING. MediaMTX truncates at a discontinuity instead
                 of welding across it, so this clip will END at the gap rather
                 than skipping it. Said before the download, because finding out
                 afterwards means re-doing it. */
              <span className="text-[0.75rem] leading-[16px] text-warn">
                This range crosses a period the tower was not recording — the
                clip stops at the gap rather than skipping over it.
              </span>
            )}

            {/* The app's error idiom, unchanged. What changed is the MESSAGE
                reaching it: a sentence instead of an endpoint. See
                `describeClipFailure` in lib/api/recordings.ts. */}
            <MutationError
              phase={clipPhase}
              onRetry={downloadClip}
              onDismiss={() => clipJob.reset(`clip:${towerId}:${chosen}`)}
            />

            <div className="flex flex-wrap justify-between gap-x-[12px] text-[0.75rem] leading-[16px] text-muted">
              {/* THE ARCHIVED BOUNDARY. The left edge is where this tower's
                  memory ends — said plainly, because an operator who scrubs
                  into nothing deserves to know it was never there rather than
                  to wonder whether the screen is broken. */}
              <span>older is archived</span>
              {!covered(spans, positionAt) && (
                <span className="text-warn">
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

/** `1m 30s`, `45s` — the length an operator is about to download. */
function formatClipLength(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/** Whether every moment between two instants has footage behind it. */
function fullyCovered(spans: RecordingSpan[], from: number, to: number): boolean {
  // One span must contain the whole range. Two adjacent spans are, by the
  // tower's own reckoning, NOT continuous — /list reports separate stretches
  // precisely where MediaMTX cannot concatenate.
  return spans.some((sp) => {
    const start = Date.parse(sp.start);
    return from >= start && to <= start + sp.duration * 1000;
  });
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
      <p className="text-[0.8125rem] leading-[20px] text-muted">Asking the tower what it holds…</p>
    );
  }
  if (phase.kind === "error") {
    return (
      /* The same shape `MutationError` uses — critical ink, and a retry
         outlined in critical rather than sitting on a neutral card. Two error
         presentations on one screen is two things for an operator to learn. */
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
        No footage covers this moment. Scrub to a time the tower was recording.
      </p>
    );
  }
  if (!hasSpans) {
    /* An empty window is a real answer, not an empty state to dress up: this
       camera has nothing on disk. Recording may be off, or the disk may be
       new. Either way there is nothing to scrub. */
    return (
      <p className="text-[0.8125rem] leading-[20px] text-muted">No recordings on this camera yet.</p>
    );
  }
  return <p className="text-[0.8125rem] leading-[20px] text-muted">Loading footage…</p>;
}
