/**
 * What a share MEANS, with no component around it.
 *
 * The rules in here decide what goes on the wire and what a tile says about
 * itself, and every one of them is a sentence somebody could get backwards:
 *
 *   · a REQUEST sends no cameras and an OFFER must;
 *   · playback without a window is refused by the server, so the window only
 *     travels when playback is on;
 *   · a scope entry with no `cameras` covers the WHOLE mast, including the
 *     camera somebody adds to it next week;
 *   · a camera my own site owns is never "borrowed", however many other sites
 *     are watching it.
 *
 * They live here rather than inside the form that collects them so they can be
 * tested as what they are -- rules -- and so the form, the card and the page
 * cannot each grow their own version.
 */

import { SHARE_DEFAULT_SEC } from "@kallon/sentry-sdk";
import type { Share, ShareScopeEntry } from "@kallon/sentry-sdk";

export interface DecisionState {
  scope: readonly ShareScopeEntry[];
  ptz: boolean;
  playback: boolean;
  /** `datetime-local` strings, which is what the inputs speak. */
  from: string;
  to: string;
  durationSec: number;
}

export interface ComposeState {
  otherSiteId: string;
  message: string;
  scope: readonly ShareScopeEntry[];
  ptz: boolean;
  playback: boolean;
  from: string;
  to: string;
  durationSec: number;
}

/** `2026-10-20T14:30` — what a `datetime-local` input wants, in local time. */
export function localStamp(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/** And back to the UTC instant the server stores. */
export function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const ms = Date.parse(local);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export function initialDecision(share: Share): DecisionState {
  const now = Date.now();
  return {
    /* An OFFER arrives with its cameras already named and the site accepting
       may narrow them. A REQUEST names none, so this starts empty and the
       person answering chooses. */
    scope: share.scope,
    ptz: share.ptz,
    playback: share.playback,
    from: localStamp(now - 60 * 60 * 1000),
    to: localStamp(now),
    durationSec: SHARE_DEFAULT_SEC,
  };
}

export function initialCompose(): ComposeState {
  const now = Date.now();
  return {
    otherSiteId: "",
    message: "",
    scope: [],
    ptz: false,
    playback: false,
    from: localStamp(now - 60 * 60 * 1000),
    to: localStamp(now),
    durationSec: SHARE_DEFAULT_SEC,
  };
}

/** The accept body: everything the answering site chose. */
export function decisionToChoices(d: DecisionState) {
  return {
    scope: d.scope,
    live: true,
    ptz: d.ptz,
    playback: d.playback,
    /* THE WINDOW ONLY TRAVELS WITH PLAYBACK. The server refuses playback
       without one, and sending one without playback is a claim about footage
       nobody granted. */
    ...(d.playback ? { playbackFrom: toIso(d.from), playbackTo: toIso(d.to) } : {}),
    durationSec: d.durationSec,
  };
}

/** The create body, for either direction. */
export function composeToRequest(
  state: ComposeState,
  mySiteId: string,
  direction: "request" | "offer",
) {
  return {
    direction,
    mySiteId,
    otherSiteId: state.otherSiteId,
    /* A REQUEST SENDS NO SCOPE. The site asking cannot know what the other
       has; the site answering chooses. An offer must name what it offers, and
       the server refuses one naming cameras the offering site does not own. */
    ...(direction === "offer" ? { scope: state.scope } : {}),
    ...(state.message.trim() ? { message: state.message.trim() } : {}),
    live: true,
    /* A request ASKS; what it is granted is the answering site's decision, so
       it does not get to assert permissions on the way out. */
    ptz: direction === "offer" ? state.ptz : false,
    playback: direction === "offer" ? state.playback : false,
    ...(direction === "offer" && state.playback
      ? { playbackFrom: toIso(state.from), playbackTo: toIso(state.to) }
      : {}),
    durationSec: state.durationSec,
  };
}

/** How many cameras a scope covers, for a one-line summary. */
export function scopeSummary(scope: readonly ShareScopeEntry[]): string {
  if (scope.length === 0) return "no cameras yet";
  const cams = scope.reduce(
    (n, e) => n + (e.cameras && e.cameras.length > 0 ? e.cameras.length : 1),
    0,
  );
  const towers = scope.length;
  return `${cams} ${cams === 1 ? "camera" : "cameras"} on ${towers} ${
    towers === 1 ? "tower" : "towers"
  }`;
}

/** Does this scope entry cover this camera? */
export function scopeCovers(
  entry: ShareScopeEntry,
  deviceId: string,
  camera: number | undefined,
): boolean {
  if (entry.device_id !== deviceId) return false;
  /* NO CAMERA LIST MEANS THE WHOLE MAST, which is what makes "lend this
     tower" keep meaning that when a camera is added to it. */
  if (!entry.cameras || entry.cameras.length === 0) return true;
  return camera !== undefined && entry.cameras.includes(camera);
}

/**
 * The live share lending me this camera, or null.
 *
 * ⚠ ONLY SHARES COMING TO ME (`incoming === false`). A camera my own site
 * owns is not borrowed however many other sites are watching it, and badging
 * it as somebody else's because I lent it out would be exactly backwards.
 */
export function borrowedFrom(
  shares: readonly Share[],
  deviceId: string | undefined,
  camera: number | undefined,
): Share | null {
  if (!deviceId) return null;
  return (
    shares.find(
      (s) => !s.incoming && s.scope.some((e) => scopeCovers(e, deviceId, camera)),
    ) ?? null
  );
}

/** The other site's name, whichever side of the share I am on. */
export function otherSiteName(share: Share): string {
  return share.incoming ? share.viewer_site_name : share.owner_site_name;
}
