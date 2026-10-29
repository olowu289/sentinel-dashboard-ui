import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlertClip, SiteAlert } from "@kallon/sentry-sdk";
import { getSiteAlert } from "@/lib/api/alerts";
import { qualityLabel } from "@/lib/alertCopy";
import { deviceName } from "@/lib/deviceName";
import { formatDuration } from "@/lib/time";

/**
 * THE MINUTE BEFORE IT HAPPENED.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT AN ALERT'S CLIPS ARE, AND WHY THEY ARE NOT ONE VIDEO ELEMENT
 * ══════════════════════════════════════════════════════════════════════
 *
 * A hub keeps a three-minute ring of every camera and cuts 60 seconds out of
 * it when an alert fires (sentry-core docs/alerts.md §2). What comes back
 * depends on what happened:
 *
 *   CAMERA_STOPPED   one clip, the minute before that feed was lost.
 *   TOWER_OFFLINE    one clip PER CAMERA, every `start` identical, because the
 *   TOWER_ONLINE     control link is the event and it took the whole mast.
 *
 * Those two are the same moment seen from two places, and the only way to read
 * them is together: a vehicle leaves one frame and enters the other, and
 * scrubbing two players separately to find that is the work this screen exists
 * to not make somebody do. So they are side by side on ONE transport — one
 * play, one pause, one scrub — and a drift correction keeps them in step.
 *
 * ── THREE THINGS THAT ARE NOT A FAILURE ───────────────────────────────
 *
 * An alert can have no clip, and each reason is a different sentence:
 *
 *   NOT YET      `TOWER_ONLINE` clips are cut from the first 60 s AFTER the
 *                tower returned, so they land about a minute later. "Clip
 *                coming" — the alert is right, the evidence is on its way.
 *   NEVER        `FOOTAGE_RECOVERING` and `FOOTAGE_RECOVERED` have no moment
 *                to cut around (§9). No clip area at all, rather than a box
 *                saying nothing arrived.
 *   GONE         the clip budget is swept oldest-first under disk pressure and
 *                "clips go before footage, never the other way round" (§3).
 *                The alert survives its clip deliberately: an alert is the
 *                record that the camera stopped at 03:14, and deleting it to
 *                save an attachment would be deleting the incident. So:
 *                "Clip no longer kept".
 *
 * ── AND THE URLS MUST NOT BE CACHED ───────────────────────────────────
 *
 * ⚠ `url` AND `download_url` ARE MINTED PER REQUEST. A presigned bucket URL
 * lives fifteen minutes; `key` is the stable identity. An operator who leaves
 * the feed open through a shift and then opens an alert from this morning gets
 * a 403, and a player that treated that as "broken" would be telling them the
 * evidence is gone when it is one request away. So a 403 re-reads the alert
 * and retries ONCE — once, because a second failure is not an expiry, and a
 * loop against a server that is refusing is the shape of an outage this app
 * would be causing.
 */

/** How far apart the two players may drift before one is nudged, in seconds. */
const SYNC_TOLERANCE_SEC = 0.35;

/** What one pane is doing. Each is a different sentence on screen. */
type PaneState =
  | { kind: "playing" }
  /** The ticket expired. Re-reading the alert, then one retry. */
  | { kind: "refreshing" }
  /** The clip's file was swept. The alert stays; the attachment is gone. */
  | { kind: "evicted" }
  /** Anything else the element refused. */
  | { kind: "failed" };

/**
 * The clips to show, one per camera, each at the best quality available.
 *
 * ⚠ `best_quality` IS THE SERVER'S RANKING AND IS NOT RE-DERIVED HERE. It is
 * decided server-side precisely so a pop-up and a detail view cannot rank the
 * same list differently, and "2k beats standard" is a comparison this bundle
 * would have to keep in step with a hub that adds a third. So the preference
 * is read off the alert, and a camera that has only the other one shows that
 * one rather than nothing.
 */
export function bestClips(alert: SiteAlert): AlertClip[] {
  const clips = alert.clips ?? [];
  if (clips.length === 0) return [];
  const want = alert.best_quality;
  const byCamera = new Map<number, AlertClip>();
  for (const clip of clips) {
    const have = byCamera.get(clip.camera);
    if (!have) {
      byCamera.set(clip.camera, clip);
      continue;
    }
    /* The one the server called best wins; otherwise the first stays, which
       keeps the hub's own ordering rather than inventing one. */
    if (have.quality !== want && clip.quality === want) byCamera.set(clip.camera, clip);
  }
  return [...byCamera.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, clip]) => clip);
}

/** Does this alert ever get a clip? §9: the recovery pair never does. */
export function expectsClip(type: string): boolean {
  return type !== "FOOTAGE_RECOVERING" && type !== "FOOTAGE_RECOVERED";
}

/**
 * Ask the server what actually went wrong with a clip URL.
 *
 * ⚠ A `<video>` ELEMENT CANNOT TELL YOU. Its `error` is a `MediaError` with
 * four possible codes and no status in any of them, so an expired ticket and a
 * swept file are the same event — and they need opposite responses: one is
 * retried and one is a sentence. One ranged byte is the cheapest honest way to
 * ask, and it goes through the same signed URL the element used, so it learns
 * exactly what the element learned.
 */
async function statusOf(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    return res.status;
  } catch {
    /* The network, not the server. Neither an expiry nor an eviction. */
    return null;
  }
}

export function AlertClips({
  alert,
  towerName,
}: {
  /**
   * The alert as the feed currently holds it.
   *
   * ⚠ THIS COMPONENT MUST BE KEYED ON `alert.id` BY ITS PARENT. `AlertDetail`
   * is never remounted — the feed swaps its content in place so arrowing
   * through alerts stays instant — so every `useState` below would otherwise
   * survive the swap and show one incident's playback position, and one
   * incident's "Clip no longer kept", against the next one's title. Keying the
   * subtree that owns the state is the rule CLAUDE.md states for exactly this.
   */
  alert: SiteAlert;
  towerName: string;
}) {
  const clips = useMemo(() => bestClips(alert), [alert]);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [state, setState] = useState<PaneState>({ kind: "playing" });

  /**
   * URLs this component is currently using, which START as the alert's own
   * and are replaced by a re-read when one expires.
   *
   * ⚠ KEYED BY THE CLIP KEY, NOT BY INDEX. `key` is the stable identity and
   * the URLs are not; indexing by position would hand a refreshed URL to the
   * wrong camera the moment a 2K clip lands for one of two cameras and
   * reorders nothing but renumbers everything.
   */
  const [fresh, setFresh] = useState<Record<string, string>>({});
  const retried = useRef<Set<string>>(new Set());

  const srcOf = useCallback(
    (clip: AlertClip): string | undefined => fresh[clip.key] ?? clip.url,
    [fresh],
  );

  /** The longest clip decides the transport's length. They are cut to 60 s. */
  const length = useMemo(
    () => clips.reduce((m, c) => Math.max(m, c.duration ?? 0), 0) || 60,
    [clips],
  );

  /* ── THE 2K UPGRADE, WITHOUT LOSING THE PLACE ──────────────────────────

     A tower that survives and later syncs the 2K segment covering the window
     gets the SAME minute cut again at full size, attached as a second clip,
     and `best_quality` flips. The alert arrives here as an `alert.updated`
     frame, so the chosen clip's key changes under a player that may be
     halfway through.

     ⚠ THE POSITION IS CARRIED ACROSS, and that is the whole requirement. It is
     the same sixty seconds at a better resolution, not different footage, so
     an operator who was looking at 00:42 must still be looking at 00:42. A
     naive `src` swap resets to zero, which on a minute of evidence means
     finding the moment again. */
  const keys = clips.map((c) => c.key).join("|");
  const lastKeys = useRef(keys);
  useEffect(() => {
    if (lastKeys.current === keys) return;
    lastKeys.current = keys;
    const resumeAt = at;
    const wasPlaying = playing;
    /* After the element has the new source and knows how long it is. */
    const t = setTimeout(() => {
      for (const v of videos.current) {
        if (!v) continue;
        v.currentTime = resumeAt;
        if (wasPlaying) void v.play().catch(() => {});
      }
    }, 0);
    return () => clearTimeout(t);
    /* `at` and `playing` are read, not watched: this runs when the CLIPS
       change, and depending on the position would re-seek on every tick. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  /* ── THE ONE TRANSPORT ─────────────────────────────────────────────── */

  const each = (fn: (v: HTMLVideoElement) => void) => {
    for (const v of videos.current) if (v) fn(v);
  };

  const toggle = useCallback(() => {
    setPlaying((was) => {
      const next = !was;
      each((v) => {
        if (next) void v.play().catch(() => {});
        else v.pause();
      });
      return next;
    });
  }, []);

  const seek = useCallback((seconds: number) => {
    const clamped = Math.max(0, seconds);
    setAt(clamped);
    each((v) => {
      v.currentTime = clamped;
    });
  }, []);

  /* The FIRST pane is the clock and the others follow it. Driving the time
     from whichever element happens to fire last would make the two cameras
     take turns correcting each other, which is a visible stutter on both. */
  const onLeaderTime = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const lead = e.currentTarget;
    setAt(lead.currentTime);
    for (const v of videos.current) {
      if (!v || v === lead) continue;
      if (Math.abs(v.currentTime - lead.currentTime) > SYNC_TOLERANCE_SEC) {
        v.currentTime = lead.currentTime;
      }
    }
  }, []);

  /* ── AN EXPIRED TICKET IS NOT A BROKEN CLIP ────────────────────────── */

  const onError = useCallback(
    (clip: AlertClip) => {
      const url = fresh[clip.key] ?? clip.url;
      if (!url) return;
      void (async () => {
        const status = await statusOf(url);
        if (status === 404) {
          /* Swept by the budget. The alert stays and says so. */
          setState({ kind: "evicted" });
          return;
        }
        if (status !== 403) {
          setState({ kind: "failed" });
          return;
        }
        /* ⚠ ONCE. A second 403 after a fresh mint is not an expiry — it is a
           server refusing — and retrying it in a loop would be this app
           causing the outage it is reporting. */
        if (retried.current.has(clip.key)) {
          setState({ kind: "failed" });
          return;
        }
        retried.current.add(clip.key);
        setState({ kind: "refreshing" });
        try {
          const again = await getSiteAlert(alert.id);
          const next: Record<string, string> = {};
          for (const c of again.clips ?? []) if (c.url) next[c.key] = c.url;
          setFresh((prev) => ({ ...prev, ...next }));
          setState({ kind: "playing" });
        } catch {
          setState({ kind: "failed" });
        }
      })();
    },
    [alert.id, fresh],
  );

  if (!expectsClip(alert.type)) return null;

  /* ── NOTHING TO SHOW, AND WHY ──────────────────────────────────────── */

  if (clips.length === 0 || state.kind === "evicted") {
    return (
      <div className="flex aspect-[388/198] w-full flex-col items-center justify-center gap-[3px] rounded-[12px] bg-panel px-[16px] text-center">
        <p className="text-[0.75rem] text-body-ink/40">
          {state.kind === "evicted" ? "Clip no longer kept" : "Clip coming"}
        </p>
        <p className="text-[0.6875rem] text-body-ink/25">
          {state.kind === "evicted"
            ? "The site needed the space. The alert is kept."
            : "The site is cutting it now."}
        </p>
      </div>
    );
  }

  const quality = qualityLabel(alert.best_quality ?? clips[0]?.quality);

  return (
    <section className="flex flex-col gap-[8px]" data-alert-clips>
      {/* Side by side when the mast is the event, one wide pane when a single
          camera is. Two 194px panes beat one 388px pane whose other half is a
          camera nobody was asking about. */}
      <div
        className={`grid gap-[4px] ${clips.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {clips.map((clip, i) => (
          <div
            key={clip.key}
            className="relative aspect-[388/198] overflow-hidden rounded-[12px] bg-tile"
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={(el) => {
                videos.current[i] = el;
              }}
              src={srcOf(clip)}
              playsInline
              preload="metadata"
              aria-label={`${deviceName(towerName)} camera ${clip.camera}, the minute around this alert`}
              onTimeUpdate={i === 0 ? onLeaderTime : undefined}
              onEnded={i === 0 ? () => setPlaying(false) : undefined}
              onError={() => onError(clip)}
              className="absolute inset-0 size-full object-cover"
            />
            <span className="chip-blur pointer-events-none absolute left-[8px] top-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] uppercase leading-[14px] tracking-[0.1px] text-body-ink/85">
              {deviceName(`Camera ${clip.camera}`)}
            </span>
          </div>
        ))}
      </div>

      {/* ONE TRANSPORT FOR BOTH. A pair of native control bars is a pair of
          clocks, and the whole reason these two panes are on one screen is
          that they are the same moment. */}
      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-action text-action-ink transition-opacity hover:opacity-90"
        >
          {playing ? (
            <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
              <path d="M0 0h3v12H0zM7 0h3v12H7z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
              <path d="M1 0l10 6-10 6V0z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={length}
          step={0.1}
          value={Math.min(at, length)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Scrub both cameras"
          className="min-w-0 flex-1 accent-[color:var(--color-body-ink)]"
        />
        <span className="shrink-0 text-[0.6875rem] text-muted tabular-nums">
          {formatDuration(Math.round(at))} / {formatDuration(Math.round(length))}
        </span>
        {/* The badge, from the server's own ranking. Hidden rather than
            guessed when a newer hub cuts at a quality this build cannot name. */}
        {quality ? (
          <span className="shrink-0 rounded-[3px] bg-pill px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-body-ink/70">
            {quality}
          </span>
        ) : null}
        {clips.map((clip) => (
          <a
            key={clip.key}
            href={fresh[clip.key] ?? clip.download_url ?? clip.url}
            download={clip.filename}
            rel="noopener"
            aria-label={`Download camera ${clip.camera} clip`}
            className="shrink-0 rounded-[4px] px-[6px] py-[2px] text-[0.6875rem] text-body-ink/70 transition-colors hover:bg-overlay/8 hover:text-body-ink"
          >
            {clips.length > 1 ? `Save ${clip.camera}` : "Save"}
          </a>
        ))}
      </div>

      {state.kind === "refreshing" && (
        <p className="text-[0.6875rem] text-body-ink/40">Getting a fresh link.</p>
      )}
      {state.kind === "failed" && (
        /* One sentence: what happened, and what to do. No status, no key. */
        <p className="text-[0.6875rem] text-critical">
          That clip didn't play. Try opening the alert again.
        </p>
      )}
    </section>
  );
}
