import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SiteAlert } from "@kallon/sentry-sdk";
import {
  ackSiteAlert,
  describeAlertFailure,
  getSiteAlert,
  listSiteAlerts,
  subscribeSiteAlerts,
} from "./api/alerts";
import {
  alertKind,
  alertTitle,
  cameraLabel,
  type CameraNameOf,
  type NameOf,
} from "./alertCopy";
import type { Alert } from "./types";

/**
 * THE ALERT FEED, FROM COORDINATION. One list, read once and then streamed.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS REPLACED
 * ══════════════════════════════════════════════════════════════════════
 *
 * Six fixtures in `lib/data.ts`, loaded on every fleet, naming TWR-1042 and
 * TWR-2071 — towers no real account has. On a live fleet the Alerts screen
 * filled with them, the new-alert banner spoke for them, and a real tower's
 * card counted zero. The note that shipped with that said the way out was "a
 * real feed, or a mark on screen". This is the real feed.
 *
 * ── LIST ONCE, THEN STREAM. NO POLLING ────────────────────────────────
 *
 * `listSiteAlerts` on open, then `subscribeSiteAlerts` over
 * `GET /v1/viewer/events` for everything after. The SDK handles the awkward
 * parts — frames split across reads, the 15-second keepalive, unknown event
 * kinds, and a recovery read with `since=` on every drop.
 *
 * ⚠ DROPS ARE EXPECTED HERE, NOT EXCEPTIONAL, and nothing in this file should
 * be written as if they were. A slow reader is CLOSED rather than waited for,
 * because the publisher is the loop watching the fleet and may never block on
 * a socket; a node holds at most 64 streams. So the connection ending is an
 * ordinary event the SDK recovers from, and `onError` here only moves a
 * boolean the screen can show as "reconnecting". Tearing the subscription down
 * on one would turn a routine reconnect into a dead feed.
 *
 * ── THE REVISION GATE, AGAIN, AT THE STORE ────────────────────────────
 *
 * The SDK gates what comes off the STREAM. This gates what reaches the STORE,
 * and the two are not the same guard: an acknowledgement's response and a
 * recovery read also write here, and neither goes through the subscription.
 * Without it, an ack returning `rev: 8` can be overwritten by an in-flight
 * recovery read holding `rev: 7`, and the alert un-acknowledges itself on
 * screen a second after somebody acknowledged it.
 *
 * ── AND IT IS THE SAME CODE ON A HUB ──────────────────────────────────
 *
 * The hub serves the same three routes and the same event stream, scoped to
 * its own fleet. Nothing here asks about accounts, sites or sharing, so hub
 * mode needs no branch — which is the test for whether a feature really works
 * on both tiers rather than being made to.
 */

export type AlertsPhase =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export interface SiteAlertFeed {
  /** Newest first, in the app's own `Alert` shape. */
  alerts: Alert[];
  phase: AlertsPhase;
  /**
   * `true` between a drop and the next successful connection.
   *
   * A reading, not an error: the list on screen is still the last thing the
   * server said, and the SDK is already reconnecting. The only wrong thing to
   * do with it is clear the feed.
   */
  reconnecting: boolean;
  /**
   * The live channel has been down long enough to tell somebody.
   *
   * ⭐ THE WHOLE POINT: A FEED THAT HAS STOPPED LOOKS EXACTLY LIKE A QUIET
   * NIGHT. Both are a list that is not changing, and on a monitoring product
   * one of those is the best news on the screen and the other is the worst.
   * Nothing else on the alert surface can tell them apart.
   *
   * Distinct from `reconnecting`, which is true for every ordinary drop. This
   * only goes true after {@link PAUSED_AFTER_MS}.
   */
  paused: boolean;
  /** Acknowledge, and take the server's returned alert as the new truth. */
  acknowledge: (id: string) => Promise<void>;
  /**
   * Re-read ONE alert, for fresh clip URLs.
   *
   * ⚠ THIS ONE BYPASSES THE REVISION GATE, AND IT HAS TO. A re-mint is the
   * same row with new tickets on it: `rev` has not moved, because nothing
   * about the alert changed. The gate drops an equal revision — correctly,
   * for a stale forward racing a fresh one — and would therefore throw away
   * the only thing this call exists to fetch. A refresh is not an update
   * arriving from somewhere; it is an answer to a question this browser just
   * asked, so it is the newest thing there is by construction.
   */
  refresh: (id: string) => Promise<void>;
  reload: () => void;
}

/** What `useSiteAlerts` reports about an alert that has just arrived. */
export interface ArrivedAlert {
  alert: Alert;
  /** The colour key the SERVER chose for this type. */
  colour: string;
}

/**
 * One server alert in the app's own shape.
 *
 * ⚠ THE WHOLE `SiteAlert` TRAVELS ON `site`. The fields below are the ones the
 * feed row and the fleet card read; everything the detail view needs — clips,
 * progress, `best_quality`, `recovered_at`, `rev` — is read off `site` rather
 * than copied, because a copy of `clips[].url` is a fifteen-minute URL stored
 * somewhere a renderer can hold it past its life.
 */
export function toAlert(
  raw: SiteAlert,
  nameOf?: NameOf,
  cameraNameOf?: CameraNameOf,
): Alert {
  return {
    id: raw.id,
    towerId: raw.device_id,
    kind: alertKind(raw.type),
    title: alertTitle(raw, nameOf, cameraNameOf),
    /* Epoch MS in this layer, epoch seconds on the wire. The date filter and
       the timeline deltas both compare these, so a pre-formatted string here
       would break both — see the standing rule. */
    at: raw.started_epoch * 1000,
    /* Two states, because the server has two. There is no resolve route and
       no `resolved` column: acknowledging is one-way and the first one wins,
       and a camera coming back writes `recovered_at` onto the same row rather
       than closing it. `AlertDetail` reads `site` to tell a recovery from an
       acknowledgement, which are different facts about different people. */
    status: raw.acknowledged ? "acknowledged" : "triggered",
    /* ⚠ THE CUSTOMER'S NAMES, NOT `Camera 1`. The Cameras cell in the
       detail draws these, and the lab read "CAMERA 1, CAMERA 2" on a mast
       whose cameras are called NORTH GATE and YARD. `cameraLabel` falls back
       to the number only when nobody has named one. */
    ...(raw.cameras && raw.cameras.length > 0
      ? {
          cameras: raw.cameras.map((n) =>
            cameraLabel(raw.device_id, n, cameraNameOf),
          ),
        }
      : {}),
    /* ⚠ FROM THE SERVER'S ANSWER, NEVER FROM THE SESSION. This was a visibly
       fake placeholder for as long as there was no route, precisely so that an
       unverified client-side claim about who performed an auditable action
       could not be mistaken for a verified one. It is verified now. */
    ...(raw.acknowledged_by ? { acknowledgedBy: raw.acknowledged_by } : {}),
    site: raw,
  };
}

/** Newest first, the order the list endpoint already uses. */
const byNewest = (a: Alert, b: Alert): number => b.at - a.at;

/**
 * How long to wait before re-reading an alert whose clips need URLs.
 *
 * A raise, a clip landing and a recovery arrive within seconds of each other
 * on a real incident — the lab's run was `alert.new`, then `alert.updated`
 * with the clips, then `alert.updated` with `recovered_at`, as three frames.
 * Re-reading on each would be three requests for one answer, and the first
 * two would be thrown away by the third. One fetch per burst.
 */
const REFETCH_DEBOUNCE_MS = 300;

/**
 * How long the stream may be down before the screen says so.
 *
 * ⚠ NOT ZERO, AND NOT LONG. The SDK reconnects every 3 s and a drop is
 * ORDINARY here — a slow reader is closed rather than waited for, because
 * the publisher is the loop watching the fleet. Saying "paused" on every one
 * of those would be a notice that blinks all day and that an operator
 * therefore stops reading, which is worse than not having it.
 *
 * Eight seconds is two failed attempts: long enough that a routine reconnect
 * never shows it, short enough that a feed which has genuinely stopped says
 * so while somebody is still looking at the screen that went quiet.
 */
const PAUSED_AFTER_MS = 8000;

/**
 * Does this alert have clips the browser cannot play?
 *
 * ⭐ THE EVENT STREAM SENDS CLIPS WITHOUT URLS, AND THAT IS CORRECT. `url`
 * and `download_url` are minted per request and must not be cached — a
 * presigned bucket URL lives fifteen minutes, and a stream frame can sit in a
 * queue or be replayed to a reconnecting reader. So the hub mints them on
 * `GET` and leaves them off the push, which is the only honest thing it can
 * do with a credential that expires.
 *
 * What was missing was this side's half of that bargain. A frame carrying
 * `clips: [{camera, duration, key, quality, size, start, start_epoch}]` and
 * no URL was stored as-is, `alertPanes` dropped every clip for want of a
 * `url`, and the detail sat on "Clip coming" until somebody reloaded the tab
 * — at which point the LIST minted the URLs and the clip appeared, which is
 * exactly the shape the lab reported.
 */
function needsFreshUrls(alert: SiteAlert): boolean {
  const clips = alert.clips;
  if (!clips || clips.length === 0) return false;
  return clips.some((c) => !c.url);
}

/** The clips an alert is offering, as a comparable identity. */
function clipFingerprint(alert: SiteAlert | undefined): string {
  if (!alert?.clips) return "";
  return alert.clips.map((c) => `${c.key}:${c.quality}`).sort().join("|");
}

/**
 * Carry forward URLs this browser already has, by clip key.
 *
 * ⭐ WITHOUT THIS, A LATER FRAME TAKES THE CLIP AWAY AGAIN. The lab's third
 * frame (`recovered_at`) carries the SAME clip list as the second, and the
 * push never carries URLs — so applying it verbatim overwrites the ones just
 * fetched and the detail falls back to "Clip coming" while a perfectly good
 * link sits in the response that arrived a second earlier. A recovery would
 * un-play the clip of the incident it is recovering from.
 *
 * ⚠ THIS IS NOT CACHING A URL, AND THE DISTINCTION IS THE WHOLE RULE. The
 * alert in this store already held these URLs; nothing is being kept longer
 * or stashed anywhere new, and `key` is still the identity they are matched
 * on. When one does expire the 403 path re-mints it, which is the mechanism
 * that was always going to be what handles expiry. Deliberately throwing away
 * a live URL because a frame about something else arrived is not caution, it
 * is a round trip and a blank screen.
 */
function withKnownUrls(incoming: SiteAlert, have: SiteAlert | undefined): SiteAlert {
  if (!incoming.clips || !have?.clips) return incoming;
  const known = new Map(have.clips.filter((c) => c.url).map((c) => [c.key, c]));
  if (known.size === 0) return incoming;
  let changed = false;
  const clips = incoming.clips.map((c) => {
    if (c.url) return c;
    const was = known.get(c.key);
    if (!was) return c;
    changed = true;
    return {
      ...c,
      url: was.url,
      ...(was.download_url ? { download_url: was.download_url } : {}),
      ...(was.filename ? { filename: was.filename } : {}),
    };
  });
  return changed ? { ...incoming, clips } : incoming;
}

export function useSiteAlerts(options: {
  /** Off entirely when the account may not see alerts. No request is made. */
  enabled: boolean;
  /** Names the fleet knows, so a title reads WEST TOWER rather than an id. */
  nameOf?: NameOf;
  /** The customer's own name for one camera. See `CameraNameOf`. */
  cameraNameOf?: CameraNameOf;
  /** Called for every `alert.new`. The shell turns this into a toast. */
  onArrived?: (arrived: ArrivedAlert) => void;
}): SiteAlertFeed {
  const { enabled, nameOf, cameraNameOf, onArrived } = options;
  const [raws, setRaws] = useState<Map<string, SiteAlert>>(() => new Map());
  /**
   * THE SAME MAP, READABLE RIGHT NOW.
   *
   * ⚠ A `useState` UPDATER DOES NOT RUN WHEN YOU CALL `setState`, AND THAT
   * COST THIS FEATURE A LAB ROUND. The decision "do these clips need URLs?"
   * was made inside the updater and the ids were pushed onto an array read
   * on the next line — so the loop ran before the updater did, found it
   * empty, and no request was ever made. Zero `site-alerts` calls after an
   * `alert.updated`, which is exactly what DevTools showed.
   *
   * It LOOKED right in isolation because React has an eager-state bailout:
   * when a hook's update queue is empty it runs the reducer immediately to
   * see whether the state actually changed. One frame at a time takes that
   * path and the array is populated in time. Two frames back to back — a
   * raise and its clip, which is every real incident — leave an update
   * pending, the bailout is skipped, the updater is deferred to the render
   * phase, and the side effect reads nothing. A test that pushes one frame
   * and waits cannot see it.
   *
   * So the store is a ref and the state is its mirror. Every decision is
   * made here, synchronously, against what is actually held; `setRaws` is
   * handed a finished value and is only how the screen hears about it. An
   * updater that has to be pure and a decision that has to happen now do
   * not belong in the same function.
   */
  const store = useRef<Map<string, SiteAlert>>(new Map());
  const [phase, setPhase] = useState<AlertsPhase>({ kind: "off" });
  const [reconnecting, setReconnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [generation, setGeneration] = useState(0);

  /* Held in refs so the subscription effect does not re-run — and therefore
     does not tear down and rebuild the event stream — when the fleet's names
     arrive or the toast callback is re-created on a parent render. A stream
     that reconnects on every render of the shell is a stream the server
     closes for being 64 of them. */
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;
  const cameraRef = useRef(cameraNameOf);
  cameraRef.current = cameraNameOf;
  const arrivedRef = useRef(onArrived);
  arrivedRef.current = onArrived;

  /**
   * Alerts waiting for a re-read, and the timer that will do them.
   *
   * Refs rather than state: nothing renders from this, and putting a pending
   * set in state would re-render the whole feed on every frame that arrives.
   */
  const pending = useRef<Set<string>>(new Set());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * What has already been asked for, per alert, as a clip fingerprint.
   *
   * ⚠ THE GUARD AGAINST A LOOP, AND IT IS NOT OPTIONAL. The re-read bypasses
   * the revision gate (a re-mint is the same row with new tickets), so an
   * answer that STILL has no URLs — a hub whose clip file has gone, a bug on
   * either side — would be upserted, seen to need URLs, and re-read again,
   * for as long as the tab is open. Asking once per set of clips means a
   * genuinely broken clip costs one request and then stops.
   */
  const asked = useRef<Map<string, string>>(new Map());
  /* `upsert` is created before `scheduleRefresh` and is a dependency of the
     subscription effect, so it must not change identity when the scheduler
     is re-created. A ref is the seam. */
  const scheduleRefreshRef = useRef<((id: string) => void) | null>(null);

  /** Upsert, dropping anything we already have at this revision or newer. */
  const upsert = useCallback((incoming: readonly SiteAlert[]) => {
    if (incoming.length === 0) return;
    /* ⚠ AGAINST THE REF, NOT INSIDE AN UPDATER. See the note on `store`:
       the decision below has to be made NOW, and a `setState` updater does
       not run when you call it. */
    const next = new Map(store.current);
    const toFetch: string[] = [];
    let changed = false;
    for (const a of incoming) {
      const have = next.get(a.id);
      /* Equal revs are rejected too: a row that has not changed has nothing
         to apply, and re-rendering it is work for no new fact. */
      if (have && a.rev <= have.rev) continue;
      /* Keep the URLs we already have for the same clips -- see
         `withKnownUrls`. A later frame carrying the same clip list without
         them would otherwise take a playable clip back off the screen. */
      const merged = withKnownUrls(a, have);
      next.set(a.id, merged);
      changed = true;
      /* ⭐ AND IF ANY CLIP STILL CANNOT BE PLAYED, GO AND GET IT. The push
         carries clips without URLs on purpose; the browser's half of that
         bargain is to ask. Once per set of clips, so an alert whose URLs
         never arrive costs one request rather than a loop. */
      if (!needsFreshUrls(merged)) continue;
      const print = clipFingerprint(merged);
      if (asked.current.get(a.id) === print) continue;
      asked.current.set(a.id, print);
      toFetch.push(a.id);
    }
    if (!changed) return;
    store.current = next;
    setRaws(next);
    for (const id of toFetch) scheduleRefreshRef.current?.(id);
  }, []);

  /* ── THE READ, AND THEN THE STREAM ─────────────────────────────────── */
  useEffect(() => {
    if (!enabled) {
      store.current = new Map();
      asked.current.clear();
      setRaws(new Map());
      setPhase({ kind: "off" });
      setReconnecting(false);
      return;
    }
    let live = true;
    let subscription: { stop: () => void } | null = null;
    setPhase({ kind: "loading" });

    void (async () => {
      let since: number | undefined;
      try {
        const list = await listSiteAlerts({});
        if (!live) return;
        upsert(list.alerts);
        /* The watermark the stream's own recovery reads restart from: the
           newest alert this browser has seen. Inclusive on purpose — the gate
           drops what we already hold, and inclusive is the safe direction,
           because an exclusive one skips an alert raised in the same second
           as the last. */
        for (const a of list.alerts) {
          if (since === undefined || a.started_epoch > since) since = a.started_epoch;
        }
        setPhase({ kind: "ready" });
      } catch (err) {
        if (!live) return;
        setPhase({ kind: "error", message: describeAlertFailure(err) });
        /* ⚠ AND THE STREAM IS STILL OPENED. The list failing is not the same
           as alerts being unavailable — a 500 on one read, or a hub restarting
           mid-request, leaves a channel that works. Refusing to subscribe
           because the first read failed turns a transient into a screen that
           stays empty until somebody reloads the tab. */
      }

      if (!live) return;
      subscription = subscribeSiteAlerts({
        since,
        onOpen: () => {
          if (!live) return;
          setReconnecting(false);
          setPaused(false);
          /* A stream that opened is a feed that works, whatever the first read
             did. The error is cleared rather than left under a live channel. */
          setPhase((p) => (p.kind === "error" ? { kind: "ready" } : p));
        },
        onError: () => {
          if (live) setReconnecting(true);
        },
        onAlert: (event) => {
          if (!live) return;
          upsert([event.alert]);
          if (event.kind === "alert.new") {
            arrivedRef.current?.({
              alert: toAlert(event.alert, nameRef.current, cameraRef.current),
              colour: event.alert.colour,
            });
          }
        },
      });
    })();

    return () => {
      live = false;
      subscription?.stop();
    };
    /* `generation` is the manual reload. `nameOf` and `onArrived` are read
       through refs and are deliberately NOT dependencies — see above. */
  }, [enabled, generation, upsert]);

  const acknowledge = useCallback(
    async (id: string) => {
      /* ⚠ THE RETURNED ALERT IS THE TRUTH, and nothing is written optimistically
         before it. An acknowledgement is an auditable record of who noticed,
         and the whole reason the client sends no name is that the caller's
         identity is the server's to state. Painting the row acknowledged
         before the server agrees would be the same claim made by the same
         untrusted side, half a second earlier. */
      const updated = await ackSiteAlert(id);
      upsert([updated]);
    },
    [upsert],
  );

  const refresh = useCallback(async (id: string) => {
    const again = await getSiteAlert(id);
    /* Through the ref, so the next frame to arrive sees these URLs and
       `withKnownUrls` can carry them forward rather than asking again. */
    const next = new Map(store.current);
    next.set(again.id, again);
    store.current = next;
    setRaws(next);
  }, []);

  /**
   * Re-read an alert because its clips arrived with no URLs, soon.
   *
   * Debounced across every alert at once: a burst touching three rows is one
   * timer and three requests fired together, rather than three timers.
   */
  const scheduleRefresh = useCallback(
    (id: string) => {
      pending.current.add(id);
      if (refetchTimer.current !== null) return;
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        const ids = [...pending.current];
        pending.current.clear();
        for (const one of ids) void refresh(one).catch(() => {});
      }, REFETCH_DEBOUNCE_MS);
    },
    [refresh],
  );

  scheduleRefreshRef.current = scheduleRefresh;

  useEffect(
    () => () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    },
    [],
  );

  /* The grace period. Cleared the instant the stream opens, so a reconnect
     inside the window never shows the notice at all. */
  useEffect(() => {
    if (!reconnecting) {
      setPaused(false);
      return;
    }
    const t = setTimeout(() => setPaused(true), PAUSED_AFTER_MS);
    return () => clearTimeout(t);
  }, [reconnecting]);

  const alerts = useMemo(() => {
    const out: Alert[] = [];
    for (const raw of raws.values()) out.push(toAlert(raw, nameOf, cameraNameOf));
    return out.sort(byNewest);
  }, [raws, nameOf, cameraNameOf]);

  return {
    alerts,
    phase,
    reconnecting,
    paused,
    acknowledge,
    refresh,
    reload: () => setGeneration((g) => g + 1),
  };
}
