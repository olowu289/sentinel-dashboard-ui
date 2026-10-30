import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { TowerSpan, UndatedSegment } from "@kallon/sentry-sdk";
import { ENTER, FADE } from "@/lib/motion";
import { MaskIcon } from "./Icon";
import { useReviewableTowers } from "@/lib/useReviewableTowers";
import { useFootageDay, type CameraKey } from "@/lib/useFootageDay";
import {
  coverage,
  rangeCrossesGap,
  resolve,
  segmentsCovering,
  type FootageTimeline,
} from "@/lib/footageTimeline";
import { clipFilename, undatedFilename } from "@/lib/snapshot";
import { deviceName } from "@/lib/deviceName";
import {
  formatBytes,
  formatClock24,
  formatDayLabel,
  formatDuration,
  formatSiteStamp,
  siteDayOf,
  siteToday,
  siteTzLabel,
} from "@/lib/time";

/**
 * FOOTAGE — a tower's cameras across one continuous day.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE PICTURE IS THE PRODUCT. EVERYTHING ELSE DOCKS AROUND IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Four fixed bands in a column that never scrolls: a slim top bar, the video, a
 * transport, and the timeline. The video band takes every pixel the other three
 * do not.
 *
 * ⚠ NOTHING OVERLAPS THE VIDEO, and that is a rule rather than a preference.
 * The first version let the page scroll and sized panes by aspect ratio, so on
 * a short window the day bar rode up over the bottom of the picture — on a
 * screen whose entire purpose is looking at footage, the chrome was covering
 * the evidence. A column of `shrink-0` bands around a `min-h-0 flex-1` stage
 * cannot do that at any size, which is why the layout is expressed that way
 * rather than with heights that happen to add up. The one thing allowed over
 * the video is the clips drawer, because a drawer is something the operator
 * opened and can close.
 *
 * ── WHAT IS UNCHANGED FROM THE SCREEN THIS REPLACES ───────────────────
 *
 * All of the behaviour: one continuous timeline per camera, seamless roll-over
 * in both directions, gaps resolved against the union of every camera, panes
 * corrected to one clock within half a second, and a download of the whole
 * segments covering a marked range. That logic lives in `lib/footageTimeline.ts`
 * and is tested there; this file is the instrument around it.
 */

/** How far a pane may drift from the clock before it is seeked back. */
const SYNC_TOLERANCE_SEC = 0.5;

/** How long a gap notice stays up. Long enough to read, short enough to pass. */
const GAP_NOTICE_MS = 3200;

/** The closest the timeline zooms in. Wider than this and a short incident is a pixel. */
const MIN_SPAN_SEC = 15 * 60;

/** Controls fade after this long with no pointer — in fullscreen only. */
const IDLE_HIDE_MS = 2600;

/** The timeline's lane-label gutter, in px. Shared by the lanes and the playhead. */
const LANE_GUTTER = 68;

const SPEEDS = [1, 2, 4, 8] as const;
type Speed = (typeof SPEEDS)[number];

interface Clock {
  /** Epoch seconds, in SITE time like everything on this screen. */
  at: number;
  playing: boolean;
  speed: Speed;
}

/* A CAMERA KEY IS NOT A LABEL. A number becomes "Camera 2"; anything else is
   the key the hub reports (`cam1`), and shouting it back was the closest this
   screen came to printing an identifier at somebody.

   ⚠ NOT CAPITALISED HERE, and that is the one exception on this screen. The
   DOWNLOAD uses this to build an evidence filename, and evidence filenames are
   left exactly as they were — see `safeSegment` in `lib/snapshot.ts`, which
   preserves rather than prettifies. Every place this screen DRAWS a camera
   name puts it through `deviceName` at the point of drawing. */
const cameraLabel = (c: CameraKey): string => {
  if (typeof c === "number") return `Camera ${c}`;
  const key = String(c).trim();
  const n = /^cam(?:era)?[-_ ]?(\d+)$/i.exec(key);
  return n ? `Camera ${Number(n[1])}` : key;
};

/** A `09:30` / `9:30` / `0930` box, as an epoch inside the day. */
function parseGoTo(raw: string, dayFrom: number): number | null {
  const m = /^(\d{1,2})[:.\s]?(\d{2})(?:[:.\s]?(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || s > 59) return null;
  return dayFrom + h * 3600 + min * 60 + s;
}

export function FootageView({
  clipsOpen,
  onClipsOpen,
  onBack,
}: {
  /** Remembered per operator in `ViewPrefs`; App owns it, as it owns the rest. */
  clipsOpen: boolean;
  onClipsOpen: (open: boolean) => void;
  onBack?: () => void;
}) {
  const { phase: review, retry: retryTowers } = useReviewableTowers();
  const towers = review.kind === "ready" ? review.towers : [];
  /* ⚠ AN EMPTY DROPDOWN IS NOT AN ANSWER. The tower list used to swallow
     every failure, so a refusal and a genuinely empty archive drew the same
     thing: a select with no options, no sentence, and no day behind it. The
     reason is on screen now, and the one failure retrying can fix carries a
     button. See `useReviewableTowers`. */
  const towersProblem =
    review.kind === "refused" || review.kind === "failed" ? review : null;
  const [towerId, setTowerId] = useState<string | null>(null);
  const chosen = towerId ?? towers[0]?.deviceId ?? null;

  const [isoDay, setIsoDay] = useState(() => siteToday());
  const day = useFootageDay(chosen, isoDay);

  const [synced, setSynced] = useState(true);
  const [shared, setShared] = useState<Clock>({ at: 0, playing: false, speed: 1 });
  const [own, setOwn] = useState<Record<string, Clock>>({});
  const [lastTouched, setLastTouched] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  /* The undated file open in its own small player, or null. Held HERE and not
     in the list, because the list is under the timeline and the player is over
     the picture -- and because a file with no time cannot be a position on the
     shared clock, which is the only state the panes know how to hold. */
  const [undated, setUndated] = useState<UndatedSegment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((message: string) => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), GAP_NOTICE_MS);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
  }, []);

  /* Land on the day's first footage when the day or tower changes. Opening at
     midnight on a day whose footage starts at 06:00 shows six hours of nothing
     and reads as a broken screen. */
  useEffect(() => {
    setShared((c) => ({ ...c, at: day.union.from ?? day.dayFrom, playing: false }));
    setOwn({});
    setEnlarged(null);
  }, [day.union.from, day.dayFrom, chosen, isoDay]);

  const clockFor = useCallback(
    (camera: CameraKey): Clock => (synced ? shared : own[String(camera)] ?? shared),
    [synced, shared, own],
  );

  const setClockFor = useCallback(
    (camera: CameraKey | null, next: (c: Clock) => Clock) => {
      if (synced || camera === null) { setShared(next); return; }
      const k = String(camera);
      setOwn((prev) => ({ ...prev, [k]: next(prev[k] ?? shared) }));
    },
    [synced, shared],
  );

  /** The camera the docked bar drives when unsynced: the one last touched. */
  const focus: CameraKey | null = useMemo(() => {
    if (lastTouched) {
      const found = day.cameras.find((c) => String(c) === lastTouched);
      if (found !== undefined) return found;
    }
    return day.cameras[0] ?? null;
  }, [lastTouched, day.cameras]);

  const driven: CameraKey | null = synced ? null : focus;
  const clock = synced ? shared : clockFor(focus ?? day.cameras[0] ?? 1);

  /* ── THE DRIVER ───────────────────────────────────────────────────────
     Wall time advances the clock and the panes correct themselves to it.
     Letting one video element BE the clock makes every other pane a follower
     of a follower, and a pane that stalls drags the whole day with it.

     Gaps resolve against the UNION of every camera: a hole on cam2 while cam1
     is recording is not a hole in the day. */
  const frame = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    const anyPlaying = synced ? shared.playing : Object.values(own).some((c) => c.playing);
    if (!anyPlaying) { last.current = 0; return; }
    const tick = (ts: number) => {
      const prev = last.current || ts;
      const dt = Math.min(1, (ts - prev) / 1000);
      last.current = ts;
      if (synced) {
        setShared((c) => {
          if (!c.playing) return c;
          const d = resolve(day.union, c.at + dt * c.speed);
          if (d.kind === "end") return { ...c, playing: false };
          if (d.kind === "jump") {
            say(`No footage for ${formatDuration(d.gap.seconds)}. Skipped to ${formatClock24(d.to * 1000)}`);
            return { ...c, at: d.to };
          }
          return { ...c, at: d.at };
        });
      } else {
        setOwn((prev2) => {
          let changed = false;
          const next: Record<string, Clock> = { ...prev2 };
          for (const camera of day.cameras) {
            const k = String(camera);
            const c = next[k];
            if (!c?.playing) continue;
            const d = resolve(day.timelineFor(camera), c.at + dt * c.speed);
            next[k] = d.kind === "end"
              ? { ...c, playing: false }
              : { ...c, at: d.kind === "jump" ? d.to : d.at };
            changed = true;
          }
          return changed ? next : prev2;
        });
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [synced, shared.playing, own, day, say]);

  const seekTo = useCallback(
    (camera: CameraKey | null, at: number) => {
      const timeline = camera === null || synced ? day.union : day.timelineFor(camera);
      const d = resolve(timeline, at);
      const landed = d.kind === "end" ? at : d.kind === "jump" ? d.to : d.at;
      if (d.kind === "jump") say(`Nothing recorded then. Moved to ${formatClock24(landed * 1000)}`);
      setClockFor(camera, (c) => ({ ...c, at: landed }));
      if (camera !== null) setLastTouched(String(camera));
    },
    [day, synced, setClockFor, say],
  );

  /** Step relatively, resolved INSIDE the setter so rapid presses accumulate. */
  const nudge = useCallback(
    (camera: CameraKey | null, seconds: number) => {
      const timeline = camera === null || synced ? day.union : day.timelineFor(camera);
      setClockFor(camera, (c) => {
        const d = resolve(timeline, c.at + seconds);
        if (d.kind === "end") return c;
        if (d.kind === "jump") {
          say(`Nothing recorded then. Moved to ${formatClock24(d.to * 1000)}`);
          return { ...c, at: d.to };
        }
        return { ...c, at: d.at };
      });
      if (camera !== null) setLastTouched(String(camera));
    },
    [day, synced, setClockFor, say],
  );

  const toggleSync = useCallback(() => {
    if (synced) {
      const seeded: Record<string, Clock> = {};
      for (const camera of day.cameras) seeded[String(camera)] = { ...shared };
      setOwn(seeded);
      setSynced(false);
      return;
    }
    const anchor = (lastTouched && own[lastTouched]) || Object.values(own)[0] || shared;
    setShared({ ...anchor });
    setSynced(true);
  }, [synced, day.cameras, shared, own, lastTouched]);

  /* ── DOWNLOAD RANGE ───────────────────────────────────────────────────── */
  const [markA, setMarkA] = useState<number | null>(null);
  const [markB, setMarkB] = useState<number | null>(null);
  const range = useMemo(
    () => (markA === null || markB === null
      ? null
      : { from: Math.min(markA, markB), to: Math.max(markA, markB) }),
    [markA, markB],
  );
  const towerLabel = towers.find((t) => t.deviceId === chosen)?.label ?? chosen ?? "TOWER";

  const download = useCallback(() => {
    if (!range || focus === null) return;
    const timeline = day.timelineFor(focus);
    const covering = segmentsCovering(timeline, range.from, range.to);
    if (covering.length === 0) { say("No footage in that range"); return; }
    const crossed = rangeCrossesGap(timeline, range.from, range.to);
    if (crossed) say(`That range crosses ${formatDuration(crossed.seconds)} with no footage`);
    /* ⚠ WHOLE SEGMENTS. The archive does no server-side transcode, so each
       covering file is saved in full under the evidence name built from ITS OWN
       start and length — never the marked length, which would name a file after
       footage it does not contain. */
    for (const segment of covering) {
      const a = document.createElement("a");
      a.href = segment.downloadUrl;
      a.download = clipFilename({
        towerName: towerLabel,
        cameraName: cameraLabel(focus),
        startAt: segment.startEpoch * 1000,
        durationSec: segment.duration,
      });
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, [range, focus, day, towerLabel, say]);

  /* ── FULLSCREEN, AND CHROME THAT GETS OUT OF THE WAY ─────────────────── */
  const stage = useRef<HTMLDivElement | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stage.current?.requestFullscreen().catch(() => {});
  }, []);

  /* ⚠ ONLY IN FULLSCREEN. A wall-mounted screen with a bar across the bottom is
     a wall-mounted screen with less picture on it. In a window the chrome is
     the way back out, so it stays put. */
  useEffect(() => {
    if (!isFull) { setIdle(false); return; }
    const wake = () => {
      setIdle(false);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), IDLE_HIDE_MS);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    };
  }, [isFull]);

  /* ── KEYBOARD ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      /* Never steal a key from a field. "Go to" is a text box on this very bar,
         and Space in it must type a space. */
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const step = e.shiftKey ? 900 : 10;
      switch (e.key) {
        case " ":
          e.preventDefault();
          setClockFor(driven, (c) => ({ ...c, playing: !c.playing }));
          break;
        case "ArrowLeft": e.preventDefault(); nudge(driven, -step); break;
        case "ArrowRight": e.preventDefault(); nudge(driven, step); break;
        case "[":
          setClockFor(driven, (c) => ({ ...c, speed: SPEEDS[Math.max(0, SPEEDS.indexOf(c.speed) - 1)] }));
          break;
        case "]":
          setClockFor(driven, (c) => ({ ...c, speed: SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(c.speed) + 1)] }));
          break;
        case "f": case "F": toggleFullscreen(); break;
        case "c": case "C": onClipsOpen(!clipsOpen); break;
        case "Escape": if (clipsOpen) onClipsOpen(false); break;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [driven, nudge, setClockFor, toggleFullscreen, clipsOpen, onClipsOpen]);

  const loading =
    !towersProblem && (day.phase.kind === "loading" || review.kind === "loading");
  const empty = day.phase.kind === "ready" && day.cameras.length === 0;
  const chromeHidden = isFull && idle;

  return (
    <div ref={stage} className="relative flex h-full w-full flex-col overflow-hidden bg-ink">
      {/* ── 1. TOP BAR ──────────────────────────────────────────────────── */}
      <motion.header
        animate={{ opacity: chromeHidden ? 0 : 1 }}
        transition={FADE}
        className="flex h-[46px] shrink-0 items-center gap-[8px] border-b border-line px-[12px]"
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] bg-card transition-colors hover:bg-card-hover"
          >
            <MaskIcon src="/icons/chevron-right.svg" size={14} className="rotate-180" />
          </button>
        )}
        <h1 className="shrink-0 font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink uppercase">
          Footage
        </h1>

        {/* ⚠ NO EMPTY SELECT OVER A FAILED READ. A dropdown with nothing in
            it is a control that looks broken and says nothing; the stage
            below carries the reason instead. */}
        {!towersProblem && (
          <select
            aria-label="Tower"
            value={chosen ?? ""}
            onChange={(e) => { setTowerId(e.target.value); setLastTouched(null); }}
            className="h-[28px] shrink-0 rounded-[6px] bg-card px-[8px] text-[0.75rem] text-body-ink outline-none focus-visible:outline-1 focus-visible:outline-terra"
          >
            {towers.map((t) => <option key={t.deviceId} value={t.deviceId}>{deviceName(t.label)}</option>)}
          </select>
        )}

        <DatePicker isoDay={isoDay} onDay={setIsoDay} daysWithFootage={day.daysWithFootage} />
        <DayButton label="Today" active={isoDay === siteToday()} onClick={() => setIsoDay(siteToday())} />
        <DayButton
          label="Yesterday"
          active={isoDay === siteDayOf(Math.floor(Date.now() / 1000) - 86400)}
          onClick={() => setIsoDay(siteDayOf(Math.floor(Date.now() / 1000) - 86400))}
        />

        <span className="ml-auto shrink-0 font-display text-[0.625rem] tracking-[0.1px] text-muted uppercase">
          {siteTzLabel()}
        </span>
        <button
          type="button"
          onClick={() => onClipsOpen(!clipsOpen)}
          aria-pressed={clipsOpen}
          title="Clips (C)"
          className={`h-[28px] shrink-0 rounded-[6px] px-[10px] text-[0.75rem] transition-colors ${
            clipsOpen ? "bg-overlay text-action-ink" : "bg-panel text-body-ink hover:bg-overlay/12"
          }`}
        >
          Clips
        </button>
      </motion.header>

      {/* ── 2. THE STAGE. Everything else docks around this. ─────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 p-[6px]">
          {towersProblem ? (
            <TowerListProblem
              message={towersProblem.message}
              onRetry={towersProblem.kind === "failed" ? retryTowers : undefined}
            />
          ) : loading ? (
            <SkeletonGrid />
          ) : day.phase.kind === "error" ? (
            <div className="flex size-full items-center justify-center rounded-[8px] bg-tile-dead">
              <p className="max-w-[360px] text-center text-[0.8125rem] leading-[20px] text-critical">
                {day.phase.message}
              </p>
            </div>
          ) : empty ? (
            <EmptyDay archiveEnabled={day.archiveEnabled} />
          ) : (
            <PaneGrid
              cameras={day.cameras}
              enlarged={enlarged}
              onEnlarge={(k) => setEnlarged((e) => (e === k ? null : k))}
              render={(camera) => (
                <Pane
                  camera={camera}
                  timeline={day.timelineFor(camera)}
                  clock={clockFor(camera)}
                  synced={synced}
                  focused={String(camera) === lastTouched}
                  dayFrom={day.dayFrom}
                  dayTo={day.dayTo}
                  onTouch={() => setLastTouched(String(camera))}
                  onClock={(next) => setClockFor(camera, next)}
                  onSeek={(at) => seekTo(camera, at)}
                />
              )}
            />
          )}
        </div>

        <ClipsDrawer
          open={clipsOpen}
          cameras={day.cameras}
          timelineFor={day.timelineFor}
          onClose={() => onClipsOpen(false)}
          onOpenAt={(at) => seekTo(driven, at)}
        />
      </div>

      {/* ── 3. TRANSPORT + 4. TIMELINE, docked below the picture ────────── */}
      <motion.div animate={{ opacity: chromeHidden ? 0 : 1 }} transition={FADE} className="shrink-0">
        <Transport
          clock={clock}
          dayFrom={day.dayFrom}
          synced={synced}
          disabled={day.cameras.length === 0}
          onPlay={() => setClockFor(driven, (c) => ({ ...c, playing: !c.playing }))}
          onSpeed={(speed) => setClockFor(driven, (c) => ({ ...c, speed }))}
          onNudge={(s) => nudge(driven, s)}
          onGoTo={(at) => seekTo(driven, at)}
          onToggleSync={toggleSync}
          markA={markA}
          markB={markB}
          onMark={() => {
            if (markA === null || markB !== null) { setMarkA(clock.at); setMarkB(null); }
            else setMarkB(clock.at);
          }}
          onClearMarks={() => { setMarkA(null); setMarkB(null); }}
          onDownload={download}
          canDownload={range !== null}
          onFullscreen={toggleFullscreen}
          isFull={isFull}
        />
        {day.cameras.length > 0 && (
          <TimelineLanes
            cameras={day.cameras}
            timelineFor={day.timelineFor}
            towerSpans={day.towerSpans}
            dayFrom={day.dayFrom}
            dayTo={day.dayTo}
            at={clock.at}
            range={range}
            onSeek={(at) => seekTo(driven, at)}
          />
        )}
        {/* UNDER the timeline, never on it. See `TimeUnknownList`. */}
        <TimeUnknownList
          items={day.timeUnknown}
          towerName={towerLabel}
          onPlay={setUndated}
        />
      </motion.div>

      <AnimatePresence>
        {undated && (
          <UndatedPlayer
            key={undated.key}
            item={undated}
            towerName={towerLabel}
            onClose={() => setUndated(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={FADE}
            role="status"
            className="chip-blur pointer-events-none absolute left-1/2 top-[60px] -translate-x-1/2 rounded-[8px] bg-black/75 px-[14px] py-[8px]"
          >
            <p className="text-[0.8125rem] leading-[20px] text-body-ink/85">{notice}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ====================================================================== */

function DayButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-[28px] shrink-0 rounded-[6px] px-[10px] text-[0.75rem] transition-colors ${
        active ? "bg-overlay text-action-ink" : "bg-panel text-body-ink hover:bg-overlay/12"
      }`}
    >
      {label}
    </button>
  );
}

/* ====================================================================== */

/**
 * The wall. One camera fills, two sit side by side, three or four make a 2x2.
 *
 * A double-click enlarges one pane to the whole stage and a second restores the
 * wall — the gesture an operator already expects from every other video tool,
 * and it costs no room on the bar.
 */
function PaneGrid({
  cameras, enlarged, onEnlarge, render,
}: {
  cameras: CameraKey[];
  enlarged: string | null;
  onEnlarge: (key: string) => void;
  render: (camera: CameraKey) => ReactNode;
}) {
  const shown = enlarged ? cameras.filter((c) => String(c) === enlarged) : cameras;
  const cols = shown.length <= 1 ? 1 : 2;
  return (
    <div
      className="grid size-full gap-[6px]"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: shown.length > 2 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
      }}
    >
      {shown.map((camera) => (
        <div
          key={String(camera)}
          onDoubleClick={() => onEnlarge(String(camera))}
          className="relative min-h-0 min-w-0 overflow-hidden rounded-[8px] bg-tile"
        >
          {render(camera)}
        </div>
      ))}
    </div>
  );
}

/* ====================================================================== */

function Pane({
  camera, timeline, clock, synced, focused, dayFrom, dayTo, onTouch, onClock, onSeek,
}: {
  camera: CameraKey;
  timeline: FootageTimeline;
  clock: Clock;
  synced: boolean;
  focused: boolean;
  dayFrom: number;
  dayTo: number;
  onTouch: () => void;
  onClock: (next: (c: Clock) => Clock) => void;
  onSeek: (at: number) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const here = useMemo(() => {
    const d = resolve(timeline, clock.at);
    return d.kind === "play" ? d.position : null;
  }, [timeline, clock.at]);

  /* The file AFTER this one, kept warm so a segment boundary is a swap rather
     than a fetch. */
  const nextUrl = useMemo(() => {
    if (!here) return null;
    const i = timeline.segments.findIndex((s) => s.key === here.segment.key);
    return i >= 0 && i + 1 < timeline.segments.length ? timeline.segments[i + 1].url : null;
  }, [timeline, here]);

  useEffect(() => {
    const el = video.current;
    if (!el || !here) return;
    if (el.dataset.key !== here.segment.key) {
      el.dataset.key = here.segment.key;
      el.src = here.segment.url;
      el.currentTime = here.offset;
    } else if (Math.abs(el.currentTime - here.offset) > SYNC_TOLERANCE_SEC) {
      el.currentTime = here.offset;
    }
    el.playbackRate = clock.speed;
    if (clock.playing) void el.play().catch(() => {});
    else el.pause();
  }, [here, clock.playing, clock.speed]);

  return (
    <section
      aria-label={`${deviceName(cameraLabel(camera))} footage`}
      onPointerDown={onTouch}
      className={`group/pane relative size-full ${focused && !synced ? "ring-1 ring-terra" : ""}`}
    >
      {here ? (
        /* `object-contain`: a security camera's frame is evidence, and cropping
           it to fill a pane removes the edges somebody may be looking for. */
        <video ref={video} muted playsInline preload="auto" className="size-full object-contain" />
      ) : (
        /* ABSENCE IS A READING. The other panes keep playing; this one says what
           is true of THIS camera at THIS moment rather than going black. */
        <div className="flex size-full items-center justify-center">
          <p className="text-[0.8125rem] font-medium text-body-ink/40">No footage at this time</p>
        </div>
      )}
      {nextUrl && <video src={nextUrl} preload="auto" muted className="hidden" aria-hidden />}

      <span className="chip-blur pointer-events-none absolute left-[8px] top-[8px] rounded-[4px] bg-black/50 px-[8px] py-[3px]">
        <span className="font-display text-[0.6875rem] tracking-[0.11px] text-body-ink">
          {deviceName(cameraLabel(camera))}
        </span>
      </span>

      {!synced && (
        /* ⚠ ONLY WHEN UNSYNCED, and only under the pointer. In synced mode a
           second set of controls would invite an operator to move one pane and
           wonder why the others followed. */
        <div className="pointer-events-none absolute inset-x-[8px] bottom-[8px] flex items-center gap-[6px] opacity-0 transition-opacity group-hover/pane:pointer-events-auto group-hover/pane:opacity-100 group-focus-within/pane:pointer-events-auto group-focus-within/pane:opacity-100">
          <button
            type="button"
            onClick={() => { onTouch(); onClock((c) => ({ ...c, playing: !c.playing })); }}
            aria-label={clock.playing ? "Pause" : "Play"}
            className="chip-blur flex size-[26px] shrink-0 items-center justify-center rounded-[6px] bg-black/55 text-body-ink transition-colors hover:bg-black/70"
          >
            <MaskIcon src={clock.playing ? "/icons/clip-pause.svg" : "/icons/clip-play.svg"} size={12} />
          </button>
          <span className="chip-blur shrink-0 rounded-[4px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] tracking-[0.1px] text-body-ink tabular-nums">
            {formatClock24(clock.at * 1000)}
          </span>
          <div
            role="slider"
            tabIndex={0}
            aria-label={`${deviceName(cameraLabel(camera))} position`}
            aria-valuemin={dayFrom}
            aria-valuemax={dayTo}
            aria-valuenow={clock.at}
            aria-valuetext={formatClock24(clock.at * 1000)}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              onTouch();
              onSeek(Math.round(dayFrom + ((e.clientX - box.left) / box.width) * (dayTo - dayFrom)));
            }}
            className="chip-blur relative h-[6px] min-w-0 flex-1 cursor-pointer rounded-[3px] bg-black/55"
          >
            <span
              className="absolute inset-y-0 w-[2px] rounded-[1px] bg-body-ink"
              style={{ left: `${((clock.at - dayFrom) / (dayTo - dayFrom)) * 100}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/* ====================================================================== */

function SkeletonGrid() {
  /* Shapes where the panes will be, so the stage does not flash empty and then
     reflow under the operator. `sweep` is the house loading motion and is
     already switched off under prefers-reduced-motion. */
  return (
    <div className="grid size-full grid-cols-2 gap-[6px]">
      {[0, 1].map((i) => (
        <div key={i} className="relative min-h-0 overflow-hidden rounded-[8px] bg-tile-dead">
          <span className="sweep absolute inset-y-0 w-1/3 bg-overlay/5" />
        </div>
      ))}
    </div>
  );
}

/**
 * The tower list could not be read, and this says which kind of could not.
 *
 * ⚠ THE BUTTON IS THE WHOLE DIFFERENCE BETWEEN THE TWO STATES. A refusal is
 * settled: this account may not see recorded footage, and a Try again that
 * can only produce the same 403 teaches an operator to distrust every other
 * retry in the app. Everything else is worth one more ask, so it gets one.
 */
function TowerListProblem({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      data-towers-problem
      className="flex size-full flex-col items-center justify-center gap-[10px] rounded-[8px] bg-tile-dead"
    >
      <p className="max-w-[360px] text-center text-[0.875rem] leading-[20px] text-critical">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-[30px] shrink-0 rounded-[6px] bg-card px-[14px] text-[0.8125rem] text-body-ink transition-colors hover:bg-card-hover"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function EmptyDay({ archiveEnabled }: { archiveEnabled: boolean }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-[6px] rounded-[8px] bg-tile-dead">
      <p className="text-[0.875rem] font-medium text-body-ink/70">
        {archiveEnabled ? "No footage on this day" : "This site does not record to an archive"}
      </p>
      <p className="max-w-[320px] text-center text-[0.75rem] leading-[16px] text-body-ink/35">
        {archiveEnabled
          ? "Pick another date. Days with footage are highlighted."
          : "Nothing is being archived here, so there is nothing to review."}
      </p>
    </div>
  );
}

/* ====================================================================== */

function DatePicker({
  isoDay, onDay, daysWithFootage,
}: {
  isoDay: string;
  onDay: (d: string) => void;
  daysWithFootage: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const [y, m] = isoDay.split("-").map(Number);
  const [cursor, setCursor] = useState({ y, m });
  useEffect(() => setCursor({ y, m }), [y, m]);

  const grid = useMemo(() => {
    const lead = new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) {
      cells.push(`${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return cells;
  }, [cursor]);

  const step = (by: number) => {
    const d = new Date(Date.UTC(cursor.y, cursor.m - 1 + by, 1));
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="h-[28px] rounded-[6px] bg-card px-[10px] text-[0.75rem] text-body-ink transition-colors hover:bg-card-hover"
      >
        {formatDayLabel(isoDay)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ENTER}
            className="absolute left-0 top-[34px] z-50 w-[268px] rounded-[12px] border border-overlay/10 bg-panel p-[10px] shadow-[0_16px_40px_rgba(0,0,0,0.7)]"
          >
            <div className="mb-[6px] flex items-center justify-between">
              <button type="button" aria-label="Previous month" onClick={() => step(-1)}
                className="flex size-[22px] items-center justify-center rounded-[6px] text-muted transition-colors hover:text-body-ink">
                <MaskIcon src="/icons/chevron-right.svg" size={12} className="rotate-180" />
              </button>
              <span className="font-display text-[0.6875rem] tracking-[0.11px] text-body-ink uppercase">
                {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
                  .format(Date.UTC(cursor.y, cursor.m - 1, 1))}
              </span>
              <button type="button" aria-label="Next month" onClick={() => step(1)}
                className="flex size-[22px] items-center justify-center rounded-[6px] text-muted transition-colors hover:text-body-ink">
                <MaskIcon src="/icons/chevron-right.svg" size={12} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-[2px]">
              {grid.map((d, i) => {
                if (d === null) return <span key={`pad${i}`} />;
                const has = daysWithFootage.has(d);
                const isSel = d === isoDay;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { onDay(d); setOpen(false); }}
                    /* HIGHLIGHTED MEANS FOOTAGE EXISTS. A day with none stays
                       pressable — an operator may look and be told nothing is
                       there — but it does not pretend to offer any. */
                    className={`flex h-[28px] items-center justify-center rounded-[6px] text-[0.75rem] tabular-nums transition-colors ${
                      isSel ? "bg-overlay text-action-ink"
                        : has ? "bg-terra/15 text-terra hover:bg-terra/25"
                          : "text-body-ink/35 hover:bg-overlay/8"
                    }`}
                  >
                    {Number(d.slice(8))}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ====================================================================== */

function Transport({
  clock, dayFrom, synced, disabled, onPlay, onSpeed, onNudge, onGoTo, onToggleSync,
  markA, markB, onMark, onClearMarks, onDownload, canDownload, onFullscreen, isFull,
}: {
  clock: Clock;
  dayFrom: number;
  synced: boolean;
  disabled: boolean;
  onPlay: () => void;
  onSpeed: (s: Speed) => void;
  onNudge: (seconds: number) => void;
  onGoTo: (at: number) => void;
  onToggleSync: () => void;
  markA: number | null;
  markB: number | null;
  onMark: () => void;
  onClearMarks: () => void;
  onDownload: () => void;
  canDownload: boolean;
  onFullscreen: () => void;
  isFull: boolean;
}) {
  const [goTo, setGoTo] = useState("");
  const submit = () => {
    const at = parseGoTo(goTo, dayFrom);
    if (at !== null) { onGoTo(at); setGoTo(""); }
  };
  const chip = "h-[30px] shrink-0 rounded-[6px] bg-panel px-[9px] font-display text-[0.6875rem] tracking-[0.11px] text-body-ink transition-colors hover:bg-overlay/12 disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-[6px] border-t border-line bg-card px-[12px] py-[8px]">
      <button type="button" className={chip} onClick={() => onNudge(-900)} disabled={disabled} title="Back 15 minutes (Shift+Left)">−15m</button>
      <button type="button" className={chip} onClick={() => onNudge(-10)} disabled={disabled} title="Back 10 seconds (Left)">−10s</button>
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        aria-label={clock.playing ? "Pause" : "Play"}
        title="Play / pause (Space)"
        className="flex size-[34px] shrink-0 items-center justify-center rounded-[8px] bg-action text-action-ink transition-colors hover:bg-action/90 disabled:opacity-40"
      >
        <MaskIcon src={clock.playing ? "/icons/clip-pause.svg" : "/icons/clip-play.svg"} size={16} />
      </button>
      <button type="button" className={chip} onClick={() => onNudge(10)} disabled={disabled} title="Forward 10 seconds (Right)">+10s</button>
      <button type="button" className={chip} onClick={() => onNudge(900)} disabled={disabled} title="Forward 15 minutes (Shift+Right)">+15m</button>

      {/* The clock, large and plainly the most important thing on the bar. */}
      <span
        aria-label="Current time"
        className="ml-[6px] shrink-0 font-display text-[1.125rem] leading-[24px] tracking-[0.18px] text-body-ink tabular-nums"
      >
        {formatClock24(clock.at * 1000)}
      </span>
      {/* Labelled, always. A time without its zone is a time somebody will read
          wrong from another country, which is the whole reason this app never
          renders one bare. */}
      <span className="shrink-0 font-display text-[0.625rem] tracking-[0.1px] text-muted uppercase">
        {siteTzLabel()}
      </span>

      <span className="ml-[6px] flex shrink-0 items-center gap-[2px]">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            disabled={disabled}
            aria-pressed={clock.speed === s}
            title={`${s}x ( [ and ] )`}
            className={`h-[30px] rounded-[6px] px-[8px] font-display text-[0.6875rem] tracking-[0.11px] tabular-nums transition-colors disabled:opacity-40 ${
              clock.speed === s ? "bg-overlay text-action-ink" : "bg-panel text-body-ink hover:bg-overlay/12"
            }`}
          >
            {s}x
          </button>
        ))}
      </span>

      <label className="flex shrink-0 items-center gap-[4px]">
        <span className="sr-only">Go to time</span>
        <input
          value={goTo}
          onChange={(e) => setGoTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="09:30"
          inputMode="numeric"
          className="h-[30px] w-[70px] rounded-[6px] bg-black/25 px-[8px] text-[0.75rem] text-body-ink tabular-nums outline-none placeholder:text-body-ink/30 focus-visible:outline-1 focus-visible:outline-terra"
        />
        <button type="button" className={chip} onClick={submit}>Go to</button>
      </label>

      <span className="ml-auto flex items-center gap-[6px]">
        <button
          type="button"
          onClick={onToggleSync}
          aria-pressed={synced}
          title={synced ? "Every pane plays the same moment" : "Each pane moves on its own"}
          className={`h-[30px] shrink-0 rounded-[6px] px-[10px] text-[0.75rem] transition-colors ${
            synced ? "bg-overlay text-action-ink" : "bg-panel text-body-ink hover:bg-overlay/12"
          }`}
        >
          {synced ? "Unsync" : "Sync"}
        </button>

        <button type="button" className={chip} onClick={onMark} disabled={disabled}>
          {markA === null
            ? "Mark start"
            : markB === null
              ? `From ${formatClock24(markA * 1000)} · mark end`
              : `${formatClock24(markA * 1000)}–${formatClock24(markB * 1000)}`}
        </button>
        {(markA !== null || markB !== null) && (
          <button type="button" className={chip} onClick={onClearMarks} aria-label="Clear range">Clear</button>
        )}
        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload}
          title="Saves whole segments covering the range"
          className="h-[30px] shrink-0 rounded-[6px] bg-action px-[10px] font-display text-[0.6875rem] tracking-[0.11px] text-action-ink transition-colors hover:bg-action/90 disabled:opacity-40"
        >
          Download
        </button>
        <button
          type="button"
          onClick={onFullscreen}
          aria-label={isFull ? "Exit fullscreen" : "Fullscreen"}
          title="Fullscreen (F)"
          className="flex size-[30px] shrink-0 items-center justify-center rounded-[6px] bg-panel text-body-ink transition-colors hover:bg-overlay/12"
        >
          <MaskIcon src="/icons/ctl-fullscreen.svg" size={14} />
        </button>
      </span>
    </div>
  );
}

/* ====================================================================== */

/**
 * One thin lane per camera, with time ticks and a playhead.
 *
 * Scroll to zoom, from the whole day down to about fifteen minutes, and drag to
 * scrub. A bar that only ever showed 24 hours made a two-minute incident about
 * a pixel wide, which is not something anybody can click on.
 */
function TimelineLanes({
  cameras, timelineFor, towerSpans, dayFrom, dayTo, at, range, onSeek,
}: {
  cameras: CameraKey[];
  timelineFor: (c: CameraKey) => FootageTimeline;
  /**
   * What the tower holds and the hub has not got, per camera.
   *
   * ⚠ THE TAIL IS NOT A GAP, AND DRAWING IT AS ONE IS THE BUG THIS FIXES.
   * A tower records to its own SSD and ships finished fifteen-minute files up,
   * so the newest quarter of an hour of every camera is always still on the
   * mast. On a bar whose only two states were "footage" and "the dead surface
   * showing through", that permanent tail read as an outage at the right-hand
   * edge of every lane, all day, on a healthy site.
   */
  towerSpans: TowerSpan[];
  dayFrom: number;
  dayTo: number;
  at: number;
  range: { from: number; to: number } | null;
  onSeek: (at: number) => void;
}) {
  const [view, setView] = useState({ from: dayFrom, to: dayTo });
  useEffect(() => setView({ from: dayFrom, to: dayTo }), [dayFrom, dayTo]);

  const lanes = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const span = view.to - view.from;
  const pct = (t: number) => ((t - view.from) / span) * 100;

  /* Grouped once per render rather than filtered inside the lane loop: two
     cameras and a handful of spans is nothing, but the loop is also the hot
     path for a wheel-zoom. */
  const spansByCamera = useMemo(() => {
    const out = new Map<string, TowerSpan[]>();
    for (const s of towerSpans) {
      const k = String(s.camera);
      const list = out.get(k);
      if (list) list.push(s);
      else out.set(k, [s]);
    }
    return out;
  }, [towerSpans]);
  const spansFor = (camera: string): TowerSpan[] => spansByCamera.get(camera) ?? [];

  const timeAt = (clientX: number): number => {
    const r = lanes.current?.getBoundingClientRect();
    if (!r || r.width === 0) return at;
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(view.from + frac * span);
  };

  /* ⚠ ZOOM ABOUT THE POINTER, not the centre. An operator pointing at 14:05 and
     scrolling means "closer to this", and a centre-anchored zoom walks the very
     thing they are looking at off the edge of the bar. */
  const onWheel = useCallback((e: React.WheelEvent) => {
    const r = lanes.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const anchorFrac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setView((v) => {
      const cur = v.to - v.from;
      const next = Math.min(dayTo - dayFrom, Math.max(MIN_SPAN_SEC, cur * (e.deltaY > 0 ? 1.25 : 0.8)));
      const anchor = v.from + anchorFrac * cur;
      let from = anchor - anchorFrac * next;
      let to = from + next;
      if (from < dayFrom) { from = dayFrom; to = from + next; }
      if (to > dayTo) { to = dayTo; from = to - next; }
      return { from, to };
    });
  }, [dayFrom, dayTo]);

  /* Coarse ticks while the view is wide, finer as it closes in: a label every
     few pixels is noise, and none at all is a bar nobody can read. */
  const ticks = useMemo(() => {
    const stepSec = span > 12 * 3600 ? 3 * 3600 : span > 4 * 3600 ? 3600 : span > 3600 ? 900 : 300;
    const out: number[] = [];
    for (let t = Math.ceil(view.from / stepSec) * stepSec; t <= view.to; t += stepSec) out.push(t);
    return out;
  }, [view, span]);

  return (
    <div
      data-footage-timeline
      className="border-t border-line bg-ink px-[12px] pb-[8px] pt-[5px]"
      onWheel={onWheel}
    >
      <div className="flex items-center gap-[6px]">
        <span className="shrink-0" style={{ width: LANE_GUTTER }} />
        <div className="relative h-[11px] min-w-0 flex-1">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute top-0 font-display text-[0.5625rem] tracking-[0.1px] text-muted tabular-nums"
              style={{ left: `${pct(t)}%`, transform: "translateX(-50%)" }}
            >
              {formatClock24(t * 1000)}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={lanes}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={view.from}
        aria-valuemax={view.to}
        aria-valuenow={at}
        aria-valuetext={formatClock24(at * 1000)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(at - 60); }
          if (e.key === "ArrowRight") { e.preventDefault(); onSeek(at + 60); }
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onSeek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => { if (dragging.current) onSeek(timeAt(e.clientX)); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        className="relative cursor-ew-resize select-none outline-none focus-visible:outline-1 focus-visible:outline-terra"
        style={{ marginLeft: LANE_GUTTER + 6 }}
      >
        {cameras.map((camera) => {
          const bands = coverage(timelineFor(camera), view.from, view.to);
          return (
            <div key={String(camera)} className="relative mb-[3px] h-[13px]">
              <span
                className="pointer-events-none absolute font-display text-[0.5625rem] leading-[13px] tracking-[0.1px] text-muted uppercase"
                style={{ left: -(LANE_GUTTER + 6), width: LANE_GUTTER }}
              >
                {deviceName(cameraLabel(camera))}
              </span>
              <div className="absolute inset-0 overflow-hidden rounded-[3px] bg-tile-dead">
                {bands.map((b, i) => (
                  <span
                    key={i}
                    /* GREEN IS FOOTAGE — the house meaning of green: this stretch
                       is good. A gap is the dead surface showing through, which
                       is what "nothing here" should look like. */
                    className={b.kind === "footage" ? "absolute inset-y-0 bg-terra/40" : ""}
                    style={{ left: `${b.start * 100}%`, width: `${(b.end - b.start) * 100}%` }}
                  />
                ))}
                {/* ON TOWER: drawn last so it paints over the dead surface, and
                    in NEITHER of the lane's two existing treatments.

                    ⚠ NOT GREEN. Green on this bar means "there is footage here
                    and you can scrub to it", and this stretch fails the second
                    half: the hub has nothing to serve and the player cannot go
                    there. Painting it green would be a click that does nothing,
                    which is worse than the gap it replaced. And not a hue of its
                    own either — the colour rule spends green, amber and red on
                    readings about the SITE, and "the file has not finished
                    uploading" is not news about a yard. So it is the neutral
                    overlay, hatched, which reads as structure rather than as a
                    signal. */}
                {spansFor(String(camera)).map((span, i) => (
                  <span
                    key={`tower-${i}`}
                    title="On tower, not at the hub yet"
                    className="absolute inset-y-0 bg-overlay/12"
                    style={{
                      left: `${pct(span.startEpoch)}%`,
                      width: `${Math.max(0, pct(span.startEpoch + span.duration) - pct(span.startEpoch))}%`,
                      backgroundImage:
                        "repeating-linear-gradient(135deg, transparent 0 3px, rgba(255,255,255,0.10) 3px 6px)",
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {range && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 bg-overlay/15"
            style={{ left: `${pct(range.from)}%`, width: `${pct(range.to) - pct(range.from)}%` }}
          />
        )}
        <span
          aria-hidden
          data-playhead
          className="pointer-events-none absolute inset-y-0 w-[2px] bg-body-ink"
          style={{ left: `${pct(at)}%` }}
        />
      </div>

      {/* The key, and ONLY when there is something on the bar it explains. A
          permanent legend for a state most sites never show is chrome; a
          legend that appears with the band it names is the label for it. */}
      {towerSpans.length > 0 && (
        <div
          data-tower-legend
          className="flex items-center gap-[6px] pt-[4px]"
          style={{ marginLeft: LANE_GUTTER + 6 }}
        >
          <span
            aria-hidden
            className="size-[8px] shrink-0 rounded-[2px] bg-overlay/12"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, transparent 0 2px, rgba(255,255,255,0.10) 2px 4px)",
            }}
          />
          <span className="text-[0.6875rem] leading-[14px] text-muted">
            On tower. Not at the hub yet, so it cannot be played here.
          </span>
        </div>
      )}
    </div>
  );
}

/* ====================================================================== */

/**
 * TIME UNKNOWN — the footage that arrived whole and could not be placed.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  A LIST, UNDER THE TIMELINE, BECAUSE THERE IS NOWHERE ON IT TO PUT THEM
 * ══════════════════════════════════════════════════════════════════════
 *
 * A tower whose clock had not synced when the recorder started writes a
 * segment whose beginning nothing can work out afterwards (sentry-core
 * docs/footage-sync.md §4.4.2). The file is complete and the pictures in it
 * are real; what is missing is the one property the whole screen above is
 * organised by.
 *
 * There were three ways to handle that and two of them are wrong:
 *
 *   · DROP THEM. Real footage, deleted from the only screen that can reach
 *     it, because of a clock. The commonest cause is a power cut, which is
 *     also when somebody most wants the tape.
 *   · DRAW THEM AT THE TIME THEY ARRIVED. Puts footage on the timeline at a
 *     moment it was not recorded — and worse, the segment genuinely before it
 *     gets cut short against the intruder, so a real recording is shortened to
 *     accommodate a guess.
 *   · A LIST WITH NO CLOCK ON IT. What this is.
 *
 * So: camera, when the HUB received it, how big it is, play, download. The
 * stamp is labelled "Arrived" and never sits where a start time sits, and the
 * download carries no time at all — see `undatedFilename`.
 *
 * Renders nothing at all when the list is empty, which is every healthy site.
 */
/**
 * When the HUB received an undated file, in site time, with the zone in it.
 *
 * Full date AND clock, unlike every other stamp on this screen: the rest of
 * them sit inside a day the operator chose, and this list is deliberately not
 * filtered by day — a file with no time belongs to no day — so a bare clock
 * here would be the one stamp on the page whose date nobody could infer.
 *
 * ⚠ THE HUB CAN ALSO HAVE NOT SAID. `arrived` is carried by the SDK only
 * when the server sent it, so there is a third case, and it reads as the
 * absence it is rather than as a zero or as today.
 */
function arrivedLabel(item: UndatedSegment): string {
  if (item.arrivedEpoch === undefined) return "at a time nobody recorded";
  const stamp = formatSiteStamp(item.arrivedEpoch * 1000);
  return `${stamp.date} ${stamp.time}`;
}

function TimeUnknownList({
  items,
  towerName,
  onPlay,
}: {
  items: UndatedSegment[];
  towerName: string;
  onPlay: (item: UndatedSegment) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      data-time-unknown
      aria-label="Time unknown"
      className="border-t border-line bg-ink px-[12px] py-[8px]"
    >
      <header className="flex items-baseline gap-[8px] pb-[6px]">
        <h3 className="font-display text-[0.6875rem] tracking-[0.11px] text-muted uppercase">
          Time unknown
        </h3>
        {/* ONE short line of help, and this is the row that would be got wrong
            without it: a list of recordings under a timeline reads as more of
            the timeline unless it says why it is not. */}
        <p className="text-[0.6875rem] leading-[14px] text-body-ink/35">
          Recorded, but the start time could not be established.
        </p>
      </header>
      <ul className="flex flex-col">
        {items.map((item) => {
          const camera = deviceName(cameraLabel(item.camera));
          const size = formatBytes(item.size);
          return (
            <li
              key={item.key}
              className="flex items-center gap-[10px] border-t border-row-line py-[5px] text-[0.75rem] leading-[18px] first:border-t-0"
            >
              <span className="w-[68px] shrink-0 truncate font-display text-[0.6875rem] tracking-[0.1px] text-muted uppercase">
                {camera}
              </span>
              {/* ⚠ LABELLED "Arrived", NEVER LEFT BARE. An unlabelled stamp in
                  a row of recordings is read as the recording's own time,
                  which is the single claim this list exists to not make. */}
              <span className="min-w-0 flex-1 truncate text-body-ink/70 tabular-nums">
                Arrived {arrivedLabel(item)}
              </span>
              <span className="w-[72px] shrink-0 text-right text-muted tabular-nums">
                {size || ""}
              </span>
              <button
                type="button"
                onClick={() => onPlay(item)}
                aria-label={`Play undated footage from ${camera}`}
                className="shrink-0 rounded-[4px] px-[8px] py-[2px] text-body-ink/70 transition-colors hover:bg-overlay/8 hover:text-body-ink"
              >
                Play
              </button>
              <a
                href={item.downloadUrl}
                download={undatedFilename({ towerName, cameraName: cameraLabel(item.camera) })}
                rel="noopener"
                aria-label={`Download undated footage from ${camera}`}
                className="shrink-0 rounded-[4px] px-[8px] py-[2px] text-body-ink/70 transition-colors hover:bg-overlay/8 hover:text-body-ink"
              >
                Download
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * One undated file, played on its own.
 *
 * It gets its own player rather than a pane on the wall for the reason the
 * list exists: every pane is addressed by the shared clock, and this file has
 * no position on it. The browser's own controls are enough — there is no
 * timeline to seam to, no next segment to preload and no gap to skip.
 */
function UndatedPlayer({
  item,
  towerName,
  onClose,
}: {
  item: UndatedSegment;
  towerName: string;
  onClose: () => void;
}) {
  const camera = deviceName(cameraLabel(item.camera));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={FADE}
      role="dialog"
      aria-label={`Undated footage from ${camera}`}
      data-undated-player
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[10px] bg-black/85 px-[16px]"
    >
      <div className="flex w-full max-w-[720px] items-center gap-[8px]">
        <span className="font-display text-[0.6875rem] tracking-[0.11px] text-muted uppercase">
          {towerName ? `${deviceName(towerName)} · ` : ""}{camera}
        </span>
        <span className="text-[0.6875rem] text-body-ink/35">Time unknown</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto rounded-[4px] px-[8px] py-[2px] text-[0.75rem] text-body-ink/70 transition-colors hover:bg-overlay/8 hover:text-body-ink"
        >
          Close
        </button>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={item.url}
        controls
        autoPlay
        className="max-h-[70%] w-full max-w-[720px] rounded-[8px] bg-tile"
      />
    </motion.div>
  );
}

/**
 * The clip list, as a drawer rather than a page.
 *
 * It is the only thing allowed over the video, because it is the one piece of
 * chrome the operator opened on purpose — and it closes on its own button, on
 * Esc, and nowhere else surprising.
 */
function ClipsDrawer({
  open, cameras, timelineFor, onClose, onOpenAt,
}: {
  open: boolean;
  cameras: CameraKey[];
  timelineFor: (c: CameraKey) => FootageTimeline;
  onClose: () => void;
  onOpenAt: (at: number) => void;
}) {
  /* Grouped by HOUR, because that is how somebody says where to look: "around
     nine". A flat list of ninety-six files is a directory, not an answer. */
  const hours = useMemo(() => {
    const byHour = new Map<number, { camera: CameraKey; start: number; duration: number; key: string }[]>();
    for (const camera of cameras) {
      for (const s of timelineFor(camera).segments) {
        const h = Math.floor(s.startEpoch / 3600) * 3600;
        const row = { camera, start: s.startEpoch, duration: s.duration, key: s.key };
        const list = byHour.get(h);
        if (list) list.push(row);
        else byHour.set(h, [row]);
      }
    }
    return [...byHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, rows]) => ({ hour, rows: rows.sort((a, b) => a.start - b.start) }));
  }, [cameras, timelineFor]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={ENTER}
          aria-label="Clips"
          data-clips-drawer
          className="absolute inset-y-0 right-0 z-40 flex w-[300px] max-w-[85vw] flex-col border-l border-line bg-panel"
        >
          <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-line px-[10px]">
            <span className="font-display text-[0.6875rem] tracking-[0.11px] text-body-ink uppercase">
              Clips
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close clips"
              className="flex size-[22px] items-center justify-center rounded-[6px] text-muted transition-colors hover:text-body-ink"
            >
              <MaskIcon src="/icons/chevron-right.svg" size={12} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[10px] py-[8px]">
            {hours.length === 0 ? (
              <p className="text-[0.75rem] leading-[16px] text-body-ink/35">
                No recordings on this day.
              </p>
            ) : (
              hours.map(({ hour, rows }) => (
                <div key={hour} className="mb-[10px]">
                  <span className="font-display text-[0.625rem] tracking-[0.1px] text-muted tabular-nums">
                    {formatClock24(hour * 1000)}
                  </span>
                  <ul className="mt-[3px] flex flex-col">
                    {rows.map((r) => (
                      <li key={r.key}>
                        <button
                          type="button"
                          onClick={() => onOpenAt(r.start)}
                          className="flex w-full items-center gap-[8px] rounded-[4px] px-[6px] py-[5px] text-left transition-colors hover:bg-overlay/8"
                        >
                          <span className="font-display text-[0.75rem] tracking-[0.12px] text-body-ink tabular-nums">
                            {formatClock24(r.start * 1000)}
                          </span>
                          <span className="text-[0.6875rem] text-muted tabular-nums">
                            {formatDuration(r.duration)}
                          </span>
                          <span className="ml-auto truncate text-[0.625rem] text-body-ink/35">
                            {deviceName(cameraLabel(r.camera))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
