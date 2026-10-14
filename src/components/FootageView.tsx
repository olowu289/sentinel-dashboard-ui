import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
import { clipFilename } from "@/lib/snapshot";
import {
  formatClock24,
  formatDayLabel,
  formatDuration,
  siteDayOf,
  siteToday,
  siteTzLabel,
} from "@/lib/time";

/**
 * FOOTAGE — a tower's cameras, side by side, across one continuous day.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE ARCHIVE IS FILES. AN OPERATOR IS LOOKING FOR A MOMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This replaces a list of ~15-minute clips played one at a time. Nobody
 * investigating an incident thinks in quarter-hour files: they think "about ten
 * past nine, on the gate camera", and they expect to scrub across it and to see
 * what the other cameras saw at the same moment. So:
 *
 *   EVERY CAMERA AT ONCE, on one clock. Two cameras are two panes, four are a
 *   2x2. The hub's own cameras are a tower like any other here.
 *
 *   ONE CONTINUOUS TIMELINE per camera (`lib/footageTimeline.ts`), so the end
 *   of a file rolls into the next with no stop, and seeking backwards over a
 *   boundary loads the earlier one.
 *
 *   GAPS ARE DRAWN, NOT HIDDEN. A hole in the day is on the bar, and running
 *   into one jumps to the next footage and says how much was missing. A camera
 *   with nothing at this moment says so while the others keep playing —
 *   absence is a reading, and a black pane would be a broken-looking lie.
 *
 * ── WHAT THE ARCHIVE CANNOT DO, AND IS NOT PRETENDED ──────────────────
 *
 * ⚠ THE HUB DOES NOT TRIM. It stores whole segments and does no server-side
 * transcode, so a marked range cannot become one clipped file. The download
 * offers the segments that COVER the range, in full, and says so. A single file
 * of exactly the marked length would be a claim this system cannot honour.
 */

/** How far a pane may drift from the clock before it is seeked back. */
const SYNC_TOLERANCE_SEC = 0.5;

/** How long a gap notice stays up. Long enough to read, short enough to pass. */
const GAP_NOTICE_MS = 3200;

const SPEEDS = [1, 2, 4, 8] as const;
type Speed = (typeof SPEEDS)[number];

interface Clock {
  /** Epoch seconds, in site time like everything on this screen. */
  at: number;
  playing: boolean;
  speed: Speed;
}

const cameraLabel = (c: CameraKey): string =>
  typeof c === "number" ? `CAMERA ${c}` : String(c).toUpperCase();

/** A `09:30` / `9:30` / `0930` box, as an epoch inside the day. */
function parseGoTo(raw: string, dayFrom: number): number | null {
  const text = raw.trim();
  const m = /^(\d{1,2})[:.\s]?(\d{2})(?:[:.\s]?(\d{2}))?$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || s > 59) return null;
  return dayFrom + h * 3600 + min * 60 + s;
}

export function FootageView({
  onNavigate,
  onBack,
}: {
  onNavigate?: (id: string) => void;
  onBack?: () => void;
}) {
  const review = useReviewableTowers();
  const towers = review.kind === "ready" ? review.towers : [];
  const [towerId, setTowerId] = useState<string | null>(null);
  const chosen = towerId ?? towers[0]?.deviceId ?? null;

  const [isoDay, setIsoDay] = useState(() => siteToday());
  const day = useFootageDay(chosen, isoDay);

  /* ── THE CLOCK ────────────────────────────────────────────────────────
     Synced is the default and the common case: one moment, one transport, one
     timeline. Unsync hands each pane its own, for the rarer job of comparing
     two different moments — a vehicle leaving one gate and arriving at
     another. */
  const [synced, setSynced] = useState(true);
  const [shared, setShared] = useState<Clock>({ at: 0, playing: false, speed: 1 });
  const [own, setOwn] = useState<Record<string, Clock>>({});
  /* Which pane the operator last drove. `Sync` collapses everything onto THIS
     pane's moment, because it is the one they were looking at. */
  const [lastTouched, setLastTouched] = useState<string | null>(null);
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

  /* Land on the day's first footage whenever the day or the tower changes.
     Opening at midnight on a day whose footage starts at 06:00 would show six
     hours of nothing and read as a broken screen. */
  useEffect(() => {
    const first = day.union.from;
    setShared((c) => ({ ...c, at: first ?? day.dayFrom, playing: false }));
    setOwn({});
  }, [day.union.from, day.dayFrom, chosen, isoDay]);

  const clockFor = useCallback(
    (camera: CameraKey): Clock => (synced ? shared : own[String(camera)] ?? shared),
    [synced, shared, own],
  );

  const setClockFor = useCallback(
    (camera: CameraKey | null, next: (c: Clock) => Clock) => {
      if (synced || camera === null) {
        setShared(next);
        return;
      }
      const k = String(camera);
      setOwn((prev) => ({ ...prev, [k]: next(prev[k] ?? shared) }));
    },
    [synced, shared],
  );

  /* ── THE DRIVER ───────────────────────────────────────────────────────
     Wall time advances the clock, and the panes correct themselves to it. The
     alternative — letting one video element be the clock — makes every other
     pane a follower of a follower, and a pane that stalls drags the day with
     it. Here a stalled pane is a stalled pane, and the clock is still right.

     GAPS ARE RESOLVED AGAINST THE UNION of every camera, not one of them. A
     hole on cam2 while cam1 is recording is not a hole in the day: cam2's pane
     says so and the clock carries on. Only a moment NO camera covers is a jump. */
  const frame = useRef<number>(0);
  const last = useRef<number>(0);
  useEffect(() => {
    const anyPlaying = synced
      ? shared.playing
      : Object.values(own).some((c) => c.playing);
    if (!anyPlaying) {
      last.current = 0;
      return;
    }
    const tick = (ts: number) => {
      const prev = last.current || ts;
      const dt = Math.min(1, (ts - prev) / 1000);   // a backgrounded tab must not leap
      last.current = ts;

      if (synced) {
        setShared((c) => {
          if (!c.playing) return c;
          const d = resolve(day.union, c.at + dt * c.speed);
          if (d.kind === "end") return { ...c, playing: false };
          if (d.kind === "jump") {
            say(`No footage for ${formatDuration(d.gap.seconds)} — skipped to ${formatClock24(d.to * 1000)}`);
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

  /* ── TRANSPORT ────────────────────────────────────────────────────────── */
  const seekTo = useCallback(
    (camera: CameraKey | null, at: number) => {
      const timeline = camera === null || synced ? day.union : day.timelineFor(camera);
      const d = resolve(timeline, at);
      const landed = d.kind === "end" ? at : d.kind === "jump" ? d.to : d.at;
      if (d.kind === "jump") {
        say(`Nothing recorded then — moved to ${formatClock24(landed * 1000)}`);
      }
      setClockFor(camera, (c) => ({ ...c, at: landed }));
      if (camera !== null) setLastTouched(String(camera));
    },
    [day, synced, setClockFor, say],
  );

  /**
   * Step the clock by a relative amount.
   *
   * ⚠ IT RESOLVES FROM THE CLOCK INSIDE THE SETTER, not from one captured
   * when the handler was built. Reading `shared`/`own` from the closure looks
   * identical and is wrong the moment somebody presses twice quickly: both
   * presses see the SAME starting moment, both compute start+10, and the
   * second overwrites the first -- so ten taps on +10s move the camera ten
   * seconds. An operator stepping through an incident would have no way to
   * tell that from a sticky button.
   */
  const nudge = useCallback(
    (camera: CameraKey | null, seconds: number) => {
      const timeline = camera === null || synced ? day.union : day.timelineFor(camera);
      const step = (c: Clock): Clock => {
        const d = resolve(timeline, c.at + seconds);
        if (d.kind === "end") return c;
        if (d.kind === "jump") {
          say(`Nothing recorded then — moved to ${formatClock24(d.to * 1000)}`);
          return { ...c, at: d.to };
        }
        return { ...c, at: d.at };
      };
      setClockFor(camera, step);
      if (camera !== null) setLastTouched(String(camera));
    },
    [day, synced, setClockFor, say],
  );

  const toggleSync = useCallback(() => {
    if (synced) {
      /* Unsync: every pane starts from where the shared clock is, so nothing
         jumps at the moment of pressing it. */
      const seeded: Record<string, Clock> = {};
      for (const camera of day.cameras) seeded[String(camera)] = { ...shared };
      setOwn(seeded);
      setSynced(false);
      return;
    }
    /* Sync: collapse onto the pane the operator last drove. Averaging the panes
       or taking the first would both land on a moment nobody chose. */
    const anchor = (lastTouched && own[lastTouched]) || Object.values(own)[0] || shared;
    setShared({ ...anchor });
    setSynced(true);
  }, [synced, day.cameras, shared, own, lastTouched]);

  /* ── DOWNLOAD RANGE ───────────────────────────────────────────────────── */
  /* The old screen WAS this list. It is kept because a list answers one
     question the timeline does not -- "what files exist, and how big" -- and
     somebody pulling evidence off a disk still thinks in files. It is secondary
     and closed by default, because it is not how an incident gets found. */
  const [showList, setShowList] = useState(false);

  const [markA, setMarkA] = useState<number | null>(null);
  const [markB, setMarkB] = useState<number | null>(null);
  const range = useMemo(() => {
    if (markA === null || markB === null) return null;
    return { from: Math.min(markA, markB), to: Math.max(markA, markB) };
  }, [markA, markB]);

  const focusCamera: CameraKey | null = useMemo(() => {
    if (lastTouched) {
      const found = day.cameras.find((c) => String(c) === lastTouched);
      if (found !== undefined) return found;
    }
    return day.cameras[0] ?? null;
  }, [lastTouched, day.cameras]);

  const towerLabel =
    towers.find((t) => t.deviceId === chosen)?.label ?? chosen ?? "TOWER";

  const download = useCallback(() => {
    if (!range || focusCamera === null) return;
    const timeline = day.timelineFor(focusCamera);
    const covering = segmentsCovering(timeline, range.from, range.to);
    if (covering.length === 0) {
      say("No footage in that range");
      return;
    }
    const crossed = rangeCrossesGap(timeline, range.from, range.to);
    if (crossed) {
      say(`That range crosses ${formatDuration(crossed.seconds)} with no footage`);
    }
    /* ⚠ WHOLE SEGMENTS. The hub cannot cut one, so each covering file is saved
       in full under the evidence name built from ITS OWN start and length —
       never the marked length, which would name a file after footage it does
       not contain. */
    for (const segment of covering) {
      const a = document.createElement("a");
      a.href = segment.downloadUrl;
      a.download = clipFilename({
        towerName: towerLabel,
        cameraName: cameraLabel(focusCamera),
        startAt: segment.startEpoch * 1000,
        durationSec: segment.duration,
      });
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, [range, focusCamera, day, towerLabel, say]);

  /* ── RENDER ───────────────────────────────────────────────────────────── */
  const paneCols = day.cameras.length <= 1 ? 1 : 2;
  const loading = day.phase.kind === "loading" || review.kind === "loading";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink">
      <header className="flex h-[46px] shrink-0 items-center gap-[10px] border-b border-line px-[16px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex size-[32px] items-center justify-center rounded-[8px] bg-card transition-colors hover:bg-card-hover"
        >
          <MaskIcon src="/icons/chevron-right.svg" size={16} className="rotate-180" />
        </button>
        <h1 className="font-display text-[1.125rem] leading-[24px] tracking-[0.18px] uppercase">
          Footage
        </h1>
        <span className="text-[0.8125rem] leading-[20px] text-muted">
          Review recorded video
        </span>
        <span className="ml-auto font-display text-[0.6875rem] tracking-[0.11px] text-muted uppercase">
          {siteTzLabel()}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[16px] py-[12px]">
        <Controls
          towers={towers.map((t) => ({ id: t.deviceId, label: t.label }))}
          towerId={chosen}
          onTower={(id) => { setTowerId(id); setLastTouched(null); }}
          isoDay={isoDay}
          onDay={setIsoDay}
          daysWithFootage={day.daysWithFootage}
          synced={synced}
          onToggleSync={toggleSync}
          showList={showList}
          onToggleList={() => setShowList((v) => !v)}
        />

        {day.phase.kind === "error" && (
          <p className="rounded-[8px] bg-critical/12 px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-critical">
            {day.phase.message}
          </p>
        )}

        {day.phase.kind === "ready" && !day.archiveEnabled && (
          /* An ANSWER, not an empty: this site does not archive at all. */
          <p className="rounded-[8px] bg-card px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-muted">
            This site does not record to an archive, so there is no footage to review.
          </p>
        )}

        {day.phase.kind === "ready" && day.archiveEnabled && day.cameras.length === 0 && (
          <p className="rounded-[8px] bg-card px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-muted">
            Nothing recorded on this tower yet.
          </p>
        )}

        {loading && (
          <p className="text-[0.8125rem] leading-[20px] text-muted">Loading footage…</p>
        )}

        {day.cameras.length > 0 && (
          <>
            <div
              className="grid min-h-0 gap-[8px]"
              style={{ gridTemplateColumns: `repeat(${paneCols}, minmax(0, 1fr))` }}
            >
              {day.cameras.map((camera) => (
                <Pane
                  key={String(camera)}
                  camera={camera}
                  timeline={day.timelineFor(camera)}
                  clock={clockFor(camera)}
                  synced={synced}
                  focused={String(camera) === lastTouched}
                  onTouch={() => setLastTouched(String(camera))}
                  onClock={(next) => setClockFor(camera, next)}
                  onNudge={(s) => nudge(camera, s)}
                />
              ))}
            </div>

            <DayBar
              union={day.union}
              dayFrom={day.dayFrom}
              dayTo={day.dayTo}
              at={synced ? shared.at : clockFor(focusCamera ?? day.cameras[0]).at}
              range={range}
              onSeek={(at) => seekTo(synced ? null : focusCamera, at)}
            />

            <Transport
              clock={synced ? shared : clockFor(focusCamera ?? day.cameras[0])}
              dayFrom={day.dayFrom}
              synced={synced}
              onPlay={() =>
                setClockFor(synced ? null : focusCamera, (c) => ({ ...c, playing: !c.playing }))
              }
              onSpeed={(speed) =>
                setClockFor(synced ? null : focusCamera, (c) => ({ ...c, speed }))
              }
              onNudge={(s) => nudge(synced ? null : focusCamera, s)}
              onGoTo={(at) => seekTo(synced ? null : focusCamera, at)}
              markA={markA}
              markB={markB}
              onMarkA={() => setMarkA((synced ? shared : clockFor(focusCamera ?? day.cameras[0])).at)}
              onMarkB={() => setMarkB((synced ? shared : clockFor(focusCamera ?? day.cameras[0])).at)}
              onClearMarks={() => { setMarkA(null); setMarkB(null); }}
              onDownload={download}
              canDownload={range !== null}
            />

            {showList && (
              <ClipList
                cameras={day.cameras}
                timelineFor={day.timelineFor}
                onOpen={(at) => seekTo(synced ? null : focusCamera, at)}
              />
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            role="status"
            className="pointer-events-none absolute bottom-[24px] left-1/2 -translate-x-1/2 rounded-[8px] bg-black/75 px-[14px] py-[8px] chip-blur"
          >
            <p className="text-[0.8125rem] leading-[20px] text-white/85">{notice}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {onNavigate && null}
    </div>
  );
}

/* ====================================================================== */

function Controls({
  towers, towerId, onTower, isoDay, onDay, daysWithFootage, synced, onToggleSync,
  showList, onToggleList,
}: {
  towers: { id: string; label: string }[];
  towerId: string | null;
  onTower: (id: string) => void;
  isoDay: string;
  onDay: (d: string) => void;
  daysWithFootage: ReadonlySet<string>;
  synced: boolean;
  onToggleSync: () => void;
  showList: boolean;
  onToggleList: () => void;
}) {
  const today = siteToday();
  const yesterday = siteDayOf(Math.floor(Date.now() / 1000) - 86400);
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <select
        aria-label="Tower"
        value={towerId ?? ""}
        onChange={(e) => onTower(e.target.value)}
        className="h-[36px] rounded-[8px] bg-card px-[12px] text-[0.8125rem] text-white outline-none focus-visible:outline-1 focus-visible:outline-terra"
      >
        {towers.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>

      <DatePicker isoDay={isoDay} onDay={onDay} daysWithFootage={daysWithFootage} />

      <button
        type="button"
        onClick={() => onDay(today)}
        className={`h-[36px] rounded-[8px] px-[12px] text-[0.8125rem] transition-colors ${
          isoDay === today ? "bg-white text-black" : "bg-panel text-white hover:bg-white/12"
        }`}
      >
        Today
      </button>
      <button
        type="button"
        onClick={() => onDay(yesterday)}
        className={`h-[36px] rounded-[8px] px-[12px] text-[0.8125rem] transition-colors ${
          isoDay === yesterday ? "bg-white text-black" : "bg-panel text-white hover:bg-white/12"
        }`}
      >
        Yesterday
      </button>

      <button
        type="button"
        onClick={onToggleList}
        aria-pressed={showList}
        className={`ml-auto h-[36px] rounded-[8px] px-[12px] text-[0.8125rem] transition-colors ${
          showList ? "bg-white text-black" : "bg-panel text-white hover:bg-white/12"
        }`}
      >
        Clips
      </button>
      <button
        type="button"
        onClick={onToggleSync}
        aria-pressed={synced}
        title={synced
          ? "Every pane plays the same moment"
          : "Each pane moves on its own"}
        className={`h-[36px] rounded-[8px] px-[12px] text-[0.8125rem] transition-colors ${
          synced ? "bg-white text-black" : "bg-panel text-white hover:bg-white/12"
        }`}
      >
        {synced ? "Unsync" : "Sync"}
      </button>
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
    const first = new Date(Date.UTC(cursor.y, cursor.m - 1, 1));
    const lead = first.getUTCDay();
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
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="h-[36px] rounded-[8px] bg-card px-[12px] text-[0.8125rem] text-white transition-colors hover:bg-card-hover"
      >
        {formatDayLabel(isoDay)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={ENTER}
            className="absolute left-0 top-[42px] z-50 w-[280px] rounded-[12px] border border-white/10 bg-panel p-[12px] shadow-[0_16px_40px_rgba(0,0,0,0.7)]"
          >
            <div className="mb-[8px] flex items-center justify-between">
              <button type="button" aria-label="Previous month" onClick={() => step(-1)}
                className="flex size-[24px] items-center justify-center rounded-[6px] text-muted transition-colors hover:text-white">
                <MaskIcon src="/icons/chevron-right.svg" size={14} className="rotate-180" />
              </button>
              <span className="font-display text-[0.75rem] tracking-[0.12px] text-white uppercase">
                {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
                  .format(Date.UTC(cursor.y, cursor.m - 1, 1))}
              </span>
              <button type="button" aria-label="Next month" onClick={() => step(1)}
                className="flex size-[24px] items-center justify-center rounded-[6px] text-muted transition-colors hover:text-white">
                <MaskIcon src="/icons/chevron-right.svg" size={14} />
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
                    /* HIGHLIGHTED MEANS FOOTAGE EXISTS. A day with none is still
                       pressable — an operator is allowed to look and be told
                       nothing is there — but it does not pretend to offer any. */
                    className={`flex h-[30px] items-center justify-center rounded-[6px] text-[0.75rem] tabular-nums transition-colors ${
                      isSel
                        ? "bg-white text-black"
                        : has
                          ? "bg-terra/15 text-terra hover:bg-terra/25"
                          : "text-white/35 hover:bg-white/8"
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

function Pane({
  camera, timeline, clock, synced, focused, onTouch, onClock, onNudge,
}: {
  camera: CameraKey;
  timeline: FootageTimeline;
  clock: Clock;
  synced: boolean;
  focused: boolean;
  onTouch: () => void;
  onClock: (next: (c: Clock) => Clock) => void;
  onNudge: (seconds: number) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const here = useMemo(() => {
    const d = resolve(timeline, clock.at);
    return d.kind === "play" ? d.position : null;
  }, [timeline, clock.at]);

  /* The file AFTER this one, kept warm in a second element so the change at a
     segment boundary is a swap rather than a fetch. */
  const nextUrl = useMemo(() => {
    if (!here) return null;
    const i = timeline.segments.findIndex((s) => s.key === here.segment.key);
    return i >= 0 && i + 1 < timeline.segments.length ? timeline.segments[i + 1].url : null;
  }, [timeline, here]);

  /* Point the element at the right file, at the right moment. A seek only when
     the drift is real: correcting every frame would fight the decoder and make
     playback stutter, which is what SYNC_TOLERANCE_SEC is for. */
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
      aria-label={`${cameraLabel(camera)} footage`}
      onPointerDown={onTouch}
      className={`relative aspect-video min-h-0 overflow-hidden rounded-[8px] bg-tile ${
        focused && !synced ? "ring-1 ring-terra" : ""
      }`}
    >
      {here ? (
        <video
          ref={video}
          muted
          playsInline
          preload="auto"
          className="size-full object-cover"
        />
      ) : (
        /* ABSENCE IS A READING. The other panes keep playing; this one says what
           is true of THIS camera at THIS moment rather than going black. */
        <div className="flex size-full items-center justify-center">
          <p className="text-[0.8125rem] font-medium text-white/40">No footage at this time</p>
        </div>
      )}

      {nextUrl && (
        <video src={nextUrl} preload="auto" muted className="hidden" aria-hidden />
      )}

      <span className="chip-blur absolute left-[8px] top-[8px] rounded-[4px] bg-black/50 px-[8px] py-[4px]">
        <span className="font-display text-[0.75rem] tracking-[0.12px] text-white">
          {cameraLabel(camera)}
        </span>
      </span>

      {!synced && (
        /* Per-pane transport, and only when unsynced: in synced mode a second
           set of controls would invite an operator to move one pane and wonder
           why the others followed. */
        <div className="absolute inset-x-[8px] bottom-[8px] flex items-center gap-[6px]">
          <button
            type="button"
            onClick={() => { onTouch(); onClock((c) => ({ ...c, playing: !c.playing })); }}
            aria-label={clock.playing ? "Pause" : "Play"}
            className="chip-blur flex size-[28px] items-center justify-center rounded-[6px] bg-black/55 text-white transition-colors hover:bg-black/70"
          >
            <MaskIcon src={clock.playing ? "/icons/clip-pause.svg" : "/icons/clip-play.svg"} size={14} />
          </button>
          <button type="button" onClick={() => { onTouch(); onNudge(-10); }}
            className="chip-blur rounded-[6px] bg-black/55 px-[8px] py-[5px] font-display text-[0.6875rem] tracking-[0.11px] text-white transition-colors hover:bg-black/70">
            −10s
          </button>
          <button type="button" onClick={() => { onTouch(); onNudge(10); }}
            className="chip-blur rounded-[6px] bg-black/55 px-[8px] py-[5px] font-display text-[0.6875rem] tracking-[0.11px] text-white transition-colors hover:bg-black/70">
            +10s
          </button>
          <span className="chip-blur ml-auto rounded-[4px] bg-black/55 px-[6px] py-[2px] font-display text-[0.6875rem] tracking-[0.11px] text-white tabular-nums">
            {formatClock24(clock.at * 1000)}
          </span>
        </div>
      )}
    </section>
  );
}

/* ====================================================================== */

function ClipList({
  cameras, timelineFor, onOpen,
}: {
  cameras: CameraKey[];
  timelineFor: (c: CameraKey) => FootageTimeline;
  onOpen: (at: number) => void;
}) {
  return (
    <div className="flex flex-col gap-[8px]">
      {cameras.map((camera) => {
        const segments = timelineFor(camera).segments;
        return (
          <div key={String(camera)} className="flex flex-col gap-[4px]">
            <span className="font-display text-[0.6875rem] tracking-[0.11px] text-muted uppercase">
              {cameraLabel(camera)} · {segments.length} clip{segments.length === 1 ? "" : "s"}
            </span>
            {segments.length === 0 ? (
              <p className="text-[0.75rem] leading-[16px] text-white/35">
                Nothing recorded on this camera today.
              </p>
            ) : (
              <ul className="flex flex-col">
                {segments.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(s.startEpoch)}
                      className="flex w-full items-center gap-[10px] border-b border-row-line px-[8px] py-[6px] text-left transition-colors hover:bg-white/5"
                    >
                      <span className="font-display text-[0.75rem] tracking-[0.12px] text-white tabular-nums">
                        {formatClock24(s.startEpoch * 1000)}
                      </span>
                      <span className="text-[0.75rem] text-muted tabular-nums">
                        {formatDuration(s.duration)}
                      </span>
                      <span className="ml-auto truncate text-[0.6875rem] text-white/35">
                        {s.filename}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ====================================================================== */

function DayBar({
  union, dayFrom, dayTo, at, range, onSeek,
}: {
  union: FootageTimeline;
  dayFrom: number;
  dayTo: number;
  at: number;
  range: { from: number; to: number } | null;
  onSeek: (at: number) => void;
}) {
  const bands = useMemo(() => coverage(union, dayFrom, dayTo), [union, dayFrom, dayTo]);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - dayFrom) / (dayTo - dayFrom)) * 100))}%`;

  return (
    <div className="flex flex-col gap-[4px]">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Day timeline"
        aria-valuemin={dayFrom}
        aria-valuemax={dayTo}
        aria-valuenow={at}
        aria-valuetext={formatClock24(at * 1000)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(at - 60); }
          if (e.key === "ArrowRight") { e.preventDefault(); onSeek(at + 60); }
        }}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - box.left) / box.width;
          onSeek(Math.round(dayFrom + frac * (dayTo - dayFrom)));
        }}
        className="relative h-[26px] w-full cursor-pointer overflow-hidden rounded-[6px] bg-tile-dead outline-none focus-visible:outline-1 focus-visible:outline-terra"
      >
        {bands.map((b, i) => (
          <span
            key={i}
            /* GREEN IS FOOTAGE, and that is the house meaning of green: this
               stretch is good. A gap is simply the dead surface showing
               through, which is what "nothing here" should look like. */
            className={`absolute inset-y-0 ${b.kind === "footage" ? "bg-terra/35" : ""}`}
            style={{ left: `${b.start * 100}%`, width: `${(b.end - b.start) * 100}%` }}
          />
        ))}
        {range && (
          <span
            className="absolute inset-y-0 bg-white/20"
            style={{ left: pct(range.from), width: `calc(${pct(range.to)} - ${pct(range.from)})` }}
          />
        )}
        <span className="absolute inset-y-0 w-[2px] bg-white" style={{ left: pct(at) }} />
      </div>
      <div className="flex justify-between font-display text-[0.625rem] tracking-[0.1px] text-muted tabular-nums">
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

/* ====================================================================== */

function Transport({
  clock, dayFrom, synced, onPlay, onSpeed, onNudge, onGoTo,
  markA, markB, onMarkA, onMarkB, onClearMarks, onDownload, canDownload,
}: {
  clock: Clock;
  dayFrom: number;
  synced: boolean;
  onPlay: () => void;
  onSpeed: (s: Speed) => void;
  onNudge: (seconds: number) => void;
  onGoTo: (at: number) => void;
  markA: number | null;
  markB: number | null;
  onMarkA: () => void;
  onMarkB: () => void;
  onClearMarks: () => void;
  onDownload: () => void;
  canDownload: boolean;
}) {
  const [goTo, setGoTo] = useState("");
  const submitGoTo = () => {
    const at = parseGoTo(goTo, dayFrom);
    if (at !== null) { onGoTo(at); setGoTo(""); }
  };

  const chip = "h-[32px] rounded-[6px] bg-panel px-[10px] font-display text-[0.6875rem] tracking-[0.11px] text-white transition-colors hover:bg-white/12";

  return (
    <div className="flex flex-wrap items-center gap-[6px] rounded-[8px] border border-line bg-card px-[12px] py-[10px]">
      <button type="button" onClick={onPlay} aria-label={clock.playing ? "Pause" : "Play"}
        className="flex size-[32px] items-center justify-center rounded-[8px] bg-white text-black transition-colors hover:bg-white/90">
        <MaskIcon src={clock.playing ? "/icons/clip-pause.svg" : "/icons/clip-play.svg"} size={16} />
      </button>

      <button type="button" className={chip} onClick={() => onNudge(-900)}>−15m</button>
      <button type="button" className={chip} onClick={() => onNudge(-10)}>−10s</button>
      <button type="button" className={chip} onClick={() => onNudge(10)}>+10s</button>
      <button type="button" className={chip} onClick={() => onNudge(900)}>+15m</button>

      <span className="ml-[4px] flex items-center gap-[2px]">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            aria-pressed={clock.speed === s}
            className={`h-[32px] rounded-[6px] px-[8px] font-display text-[0.6875rem] tracking-[0.11px] tabular-nums transition-colors ${
              clock.speed === s ? "bg-white text-black" : "bg-panel text-white hover:bg-white/12"
            }`}
          >
            {s}x
          </button>
        ))}
      </span>

      {/* Named, because "00:00" also appears as a static gutter label under the
          day bar and the two are indistinguishable to anything reading the
          page -- a screen reader included. */}
      <span
        aria-label="Current time"
        className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white tabular-nums"
      >
        {formatClock24(clock.at * 1000)}
      </span>

      <label className="flex items-center gap-[6px]">
        <span className="sr-only">Go to time</span>
        <input
          value={goTo}
          onChange={(e) => setGoTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitGoTo(); } }}
          placeholder="09:30"
          inputMode="numeric"
          className="h-[32px] w-[78px] rounded-[6px] bg-black/25 px-[8px] text-[0.75rem] text-white tabular-nums outline-none placeholder:text-white/30 focus-visible:outline-1 focus-visible:outline-terra"
        />
        <button type="button" className={chip} onClick={submitGoTo}>Go to</button>
      </label>

      <span className="ml-auto flex items-center gap-[6px]">
        <button type="button" className={chip} onClick={onMarkA}>
          {markA === null ? "Mark start" : `From ${formatClock24(markA * 1000)}`}
        </button>
        <button type="button" className={chip} onClick={onMarkB}>
          {markB === null ? "Mark end" : `To ${formatClock24(markB * 1000)}`}
        </button>
        {(markA !== null || markB !== null) && (
          <button type="button" className={chip} onClick={onClearMarks}>Clear</button>
        )}
        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload}
          title="Saves the whole segments covering the range — the archive does not trim"
          className="h-[32px] rounded-[6px] bg-white px-[10px] font-display text-[0.6875rem] tracking-[0.11px] text-black transition-colors hover:bg-white/90 disabled:bg-white/25 disabled:text-black/40"
        >
          Download
        </button>
      </span>

      {!synced && (
        <span className="w-full font-display text-[0.625rem] tracking-[0.1px] text-muted uppercase">
          Unsynced — these controls drive the highlighted pane
        </span>
      )}
    </div>
  );
}
