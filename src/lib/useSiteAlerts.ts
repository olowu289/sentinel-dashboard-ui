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
  const [phase, setPhase] = useState<AlertsPhase>({ kind: "off" });
  const [reconnecting, setReconnecting] = useState(false);
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

  /** Upsert, dropping anything we already have at this revision or newer. */
  const upsert = useCallback((incoming: readonly SiteAlert[]) => {
    if (incoming.length === 0) return;
    setRaws((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const a of incoming) {
        const have = next.get(a.id);
        /* Equal revs are rejected too: a row that has not changed has nothing
           to apply, and re-rendering it is work for no new fact. */
        if (have && a.rev <= have.rev) continue;
        next.set(a.id, a);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  /* ── THE READ, AND THEN THE STREAM ─────────────────────────────────── */
  useEffect(() => {
    if (!enabled) {
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
    setRaws((prev) => {
      const next = new Map(prev);
      next.set(again.id, again);
      return next;
    });
  }, []);

  const alerts = useMemo(() => {
    const out: Alert[] = [];
    for (const raw of raws.values()) out.push(toAlert(raw, nameOf, cameraNameOf));
    return out.sort(byNewest);
  }, [raws, nameOf, cameraNameOf]);

  return {
    alerts,
    phase,
    reconnecting,
    acknowledge,
    refresh,
    reload: () => setGeneration((g) => g + 1),
  };
}
