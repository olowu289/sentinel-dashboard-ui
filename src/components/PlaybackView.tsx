import { useEffect, useMemo, useState } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import type { CameraFeed, Tower } from "@/lib/types";
import type { ArchivedSegment } from "@kallon/sentry-sdk";
import { useHubRecordings } from "@/lib/useHubRecordings";
import { segmentDownloadUrl } from "@/lib/api/recordings";
import {
  LOCAL_TZ_LABEL,
  formatBytes,
  formatLocalDayHeader,
  formatLocalTime,
  formatRecordingLength,
  localDay,
} from "@/lib/time";

/**
 * Recorded footage from the HUB archive — a browsable LIST of segments.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  LIST AND PLAY, NOT SCRUB.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The hub stores complete ~15-minute segments; this screen lists them for the
 * chosen tower·camera, grouped by day, and plays one when it is clicked. It is a
 * separate screen from the wall on purpose: a tile is a monitor for what is
 * happening, and drilling into what happened must not take a live feed down.
 *
 * ── WHAT IS HONEST HERE ────────────────────────────────────────────────
 *
 *   the list       is the segments the hub actually holds — not a retention
 *                  promise. Archiving off says so; an empty day says so.
 *   storage        is invisible. Each row plays from a URL the hub returned;
 *                  bucket-presigned or local-ticketed never reaches here.
 *   the clock      is the VIEWER's local time, labelled — so the date the
 *                  operator picks and the times they read agree with the
 *                  calendar in front of them. (See the note in lib/time.ts.)
 */

interface DayGroup {
  day: string;                 // local YYYY-MM-DD
  segments: ArchivedSegment[]; // newest-first within the day
}

/** Newest-first, grouped by local day (newest day first). */
function groupByDay(segments: ArchivedSegment[]): DayGroup[] {
  const byDay = new Map<string, ArchivedSegment[]>();
  for (const s of segments) {
    const day = localDay(s.startEpoch * 1000);
    const arr = byDay.get(day);
    if (arr) arr.push(s);
    else byDay.set(day, [s]);
  }
  return [...byDay.entries()]
    .map(([day, segs]) => ({
      day,
      segments: segs.sort((a, b) => b.startEpoch - a.startEpoch),
    }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

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

  const { phase, segments, archiveEnabled, reload } = useHubRecordings(towerId, chosen ?? null);

  /** The day the list is filtered to (local YYYY-MM-DD), or null for all days. */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  /** The segment key currently loaded in the player. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const groups = useMemo(() => groupByDay(segments), [segments]);
  const daysWithFootage = useMemo(() => groups.map((g) => g.day), [groups]);

  /* When a fresh list lands, default the filter to the most recent day that HAS
     footage and cue its newest segment, so the screen opens on "what just
     happened" rather than an empty player. Keyed on the list identity so it
     re-defaults on every tower/camera switch, not on every render. */
  useEffect(() => {
    if (phase.kind !== "ready" || segments.length === 0) {
      setSelectedDay(null);
      setSelectedKey(null);
      return;
    }
    const newestDay = groups[0];
    setSelectedDay(newestDay.day);
    setSelectedKey(newestDay.segments[0]?.key ?? null);
  }, [segments, phase.kind, groups]);

  const selected = useMemo(
    () => segments.find((s) => s.key === selectedKey) ?? null,
    [segments, selectedKey],
  );

  const visibleGroups = useMemo(
    () => (selectedDay ? groups.filter((g) => g.day === selectedDay) : groups),
    [groups, selectedDay],
  );

  const feed = cameras.find((f) => f.index === chosen);
  const tower = towers.find((t) => t.id === towerId);

  const dateRange = daysWithFootage.length
    ? { min: daysWithFootage[daysWithFootage.length - 1], max: daysWithFootage[0] }
    : null;

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

        {/* ── player + list, side by side on wide screens ────────────── */}
        <div className="flex min-h-0 flex-1 flex-col gap-[14px] lg:flex-row">
          {/* the picture */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[8px]">
            <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-[12px] bg-stage">
              {selected ? (
                <video
                  key={selected.url}
                  src={selected.url}
                  autoPlay
                  playsInline
                  controls
                  className="absolute inset-0 size-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center px-[24px] text-center">
                  <span className="text-[0.8125rem] leading-[20px] text-muted">
                    {cameras.length === 0
                      ? "Pick a site with cameras."
                      : "Select a recording from the list to play it."}
                  </span>
                </div>
              )}
            </div>

            {selected && (
              <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] rounded-[8px] bg-panel px-[12px] py-[10px]">
                <span className="min-w-0 flex-1 truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] tabular-nums text-white">
                  {formatLocalTime(selected.startEpoch * 1000)}
                  <span className="ml-[6px] text-[0.75rem] text-muted">{LOCAL_TZ_LABEL}</span>
                  <span className="ml-[10px] text-[0.75rem] font-sans text-muted">
                    {formatRecordingLength(selected.duration)}
                    {feed?.name ? ` · ${feed.name}` : ""}
                  </span>
                </span>
                {/* The URL sets its own Content-Disposition, so a plain navigation
                    downloads the segment — no CORS, no bytes through this app. */}
                <a
                  href={segmentDownloadUrl(selected)}
                  download
                  className="flex h-[30px] shrink-0 items-center justify-center gap-[6px] rounded-[8px] bg-white px-[12px] text-[0.8125rem] font-medium text-black transition-opacity hover:opacity-90"
                >
                  <MaskIcon src="/icons/clip-download.svg" size={14} />
                  Download
                </a>
              </div>
            )}
          </div>

          {/* the list */}
          <div className="flex min-h-0 w-full flex-col gap-[8px] rounded-[12px] bg-panel p-[12px] lg:w-[380px]">
            <div className="flex items-center justify-between gap-[8px]">
              <span className="font-display text-[0.8125rem] leading-[20px] tracking-[0.13px] uppercase text-white">
                Recordings
              </span>
              <span className="text-[0.6875rem] leading-[16px] text-muted">
                times in {LOCAL_TZ_LABEL}
              </span>
            </div>

            {/* date filter */}
            <div className="flex items-center gap-[8px]">
              <input
                type="date"
                aria-label="Filter by date"
                value={selectedDay ?? ""}
                min={dateRange?.min}
                max={dateRange?.max}
                onChange={(e) => setSelectedDay(e.target.value || null)}
                className="h-[32px] flex-1 rounded-[8px] bg-card px-[10px] text-[0.8125rem] font-medium text-white [color-scheme:dark] transition-colors hover:bg-card-hover"
              />
              {selectedDay && (
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="h-[32px] shrink-0 rounded-[8px] bg-card px-[10px] text-[0.8125rem] font-medium text-white transition-colors hover:bg-card-hover"
                >
                  All dates
                </button>
              )}
            </div>

            {/* body: loading / error / archive-off / empty / the rows */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ListBody
                phase={phase}
                archiveEnabled={archiveEnabled}
                hasCameras={cameras.length > 0}
                totalSegments={segments.length}
                groups={visibleGroups}
                selectedKey={selectedKey}
                selectedDay={selectedDay}
                site={tower?.site ?? towerId ?? "this camera"}
                onPick={(s) => setSelectedKey(s.key)}
                onRetry={reload}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListBody({
  phase, archiveEnabled, hasCameras, totalSegments, groups, selectedKey,
  selectedDay, site, onPick, onRetry,
}: {
  phase: ReturnType<typeof useHubRecordings>["phase"];
  archiveEnabled: boolean;
  hasCameras: boolean;
  totalSegments: number;
  groups: DayGroup[];
  selectedKey: string | null;
  selectedDay: string | null;
  site: string;
  onPick: (s: ArchivedSegment) => void;
  onRetry: () => void;
}) {
  const note = (text: string) => (
    <p className="px-[4px] py-[16px] text-[0.8125rem] leading-[20px] text-muted">{text}</p>
  );

  if (!hasCameras) return note("Pick a site with cameras.");
  if (phase.kind === "idle" || phase.kind === "loading") {
    return (
      <div className="flex items-center gap-[8px] px-[4px] py-[16px] text-[0.8125rem] leading-[20px] text-muted">
        <span className="size-[14px] animate-spin rounded-full border-2 border-white/30 border-t-white" />
        Listing recordings…
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-[10px] px-[4px] py-[16px]">
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
  // ready:
  if (!archiveEnabled) {
    return note(`Recording is not enabled for ${site}.`);
  }
  if (totalSegments === 0) {
    return note("No recordings for this camera yet.");
  }
  if (groups.length === 0) {
    // A day filter that landed on an empty day — an honest, specific empty.
    return note(
      selectedDay
        ? `No recordings on ${formatLocalDayHeader(selectedDay)} for this camera.`
        : "No recordings for this selection.",
    );
  }

  return (
    <ul className="flex flex-col gap-[10px]">
      {groups.map((g) => (
        <li key={g.day}>
          <div className="sticky top-0 z-[1] bg-panel/95 px-[4px] pb-[4px] pt-[2px] text-[0.6875rem] font-medium uppercase leading-[16px] tracking-[0.5px] text-muted backdrop-blur">
            {formatLocalDayHeader(g.day)}
            <span className="ml-[6px] normal-case tracking-normal text-muted/70">
              {g.segments.length} {g.segments.length === 1 ? "clip" : "clips"}
            </span>
          </div>
          <ul className="flex flex-col gap-[4px]">
            {g.segments.map((s) => {
              const on = s.key === selectedKey;
              return (
                <li
                  key={s.key}
                  /* A ROW, not a button-in-a-button: the play area and the
                     download are separate interactive children (nesting an <a>
                     inside a <button> is invalid and breaks the DOM). */
                  className={`flex items-center gap-[10px] rounded-[8px] pr-[8px] transition-colors ${
                    on ? "bg-white text-black" : "bg-card text-white hover:bg-card-hover"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onPick(s)}
                    aria-pressed={on}
                    className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[8px] px-[10px] py-[8px] text-left"
                  >
                    <MaskIcon src={on ? "/icons/clip-pause.svg" : "/icons/clip-play.svg"} size={14} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[0.8125rem] leading-[18px] tabular-nums">
                        {formatLocalTime(s.startEpoch * 1000)}
                      </span>
                      <span
                        className={`block text-[0.6875rem] leading-[14px] ${on ? "text-black/60" : "text-muted"}`}
                      >
                        {formatRecordingLength(s.duration)}
                        {formatBytes(s.size) ? ` · ${formatBytes(s.size)}` : ""}
                      </span>
                    </span>
                  </button>
                  <a
                    href={segmentDownloadUrl(s)}
                    download
                    aria-label="Download segment"
                    title="Download segment"
                    className={`flex size-[26px] shrink-0 items-center justify-center rounded-[6px] transition-colors ${
                      on ? "hover:bg-black/10" : "hover:bg-white/12"
                    }`}
                  >
                    <MaskIcon src="/icons/clip-download.svg" size={14} />
                  </a>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
