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

/**
 * The state an owner answers a REQUEST with.
 *
 * ⚠ ONLY A REQUEST HAS ONE. An offer is accepted or declined, with nothing
 * to decide: see `OfferTerms` in ShareControls for the three contradictory
 * sentences that appeared on one card while an offer had a form.
 *
 * ⚠ AND IT OPENS ON WHAT WAS ASKED FOR, not on a default. The requester
 * says how long they want, the owner may answer with less or more, and
 * starting from `SHARE_DEFAULT_SEC` meant the owner's first choice silently
 * overwrote the question with fifteen minutes nobody had asked for.
 */
export function initialDecision(share: Share): DecisionState {
  const now = Date.now();
  return {
    /* A REQUEST names no towers, so this starts empty and the person
       answering chooses. (`share.scope` is [] for one, which is the same
       thing said twice -- and it is read from the share rather than hardcoded
       so an offer passed here by mistake does not lose its scope silently.) */
    scope: share.scope,
    ptz: share.ptz,
    playback: share.playback,
    from: localStamp(now - 60 * 60 * 1000),
    to: localStamp(now),
    durationSec: share.asked_duration_sec ?? SHARE_DEFAULT_SEC,
  };
}

/**
 * A blank compose.
 *
 * ⚠ `durationSec` STARTS AT ZERO, WHICH MEANS NOTHING CHOSEN. It used to
 * start at fifteen minutes, so every share anybody sent without touching the
 * picker lasted fifteen minutes by accident rather than by decision -- and the
 * server's own fallback was two hours, so the length depended on which side
 * had forgotten to send it. The server now requires one; so does the form.
 */
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
    durationSec: 0,
  };
}

/**
 * The accept body for a REQUEST: everything the answering site chose.
 *
 * ⚠ AN OFFER IS ACCEPTED WITH `{}` AND NOT WITH THIS. The server refuses a
 * body that would change an offer's terms -- refuses rather than ignores, so a
 * client cannot show terms it believes it narrowed and the server never agreed
 * to. `acceptOffer` below is the whole of the other direction.
 */
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

/**
 * Accepting an OFFER, which is the empty object and a sentence saying why.
 *
 * A function rather than a literal at each call site, so that "an offer is
 * accepted as sent" is written down once and the next card to be built cannot
 * quietly send terms with it.
 */
export function acceptOffer(): Record<string, never> {
  return {};
}

/** Does this share leave anything for the person answering to decide? */
export function answeringMeansChoosing(share: Share): boolean {
  return share.direction === "request";
}

/** The create body, for either direction. */
/**
 * The create body, for either direction.
 *
 * ⚠ THE TWO ARE DIFFERENT SHAPES, AND THE SDK TYPE SAYS SO. A request
 * carries a message and a length and nothing else; an offer carries a scope
 * and permissions as well. This returns one or the other, so a request cannot
 * accidentally assert a permission it has no business asserting.
 */
export function composeToRequest(
  state: ComposeState,
  mySiteId: string,
  direction: "request" | "offer",
) {
  if (direction === "offer") {
    return {
      direction: "offer" as const,
      mySiteId,
      otherSiteId: state.otherSiteId,
      scope: state.scope,
      ...(state.message.trim() ? { message: state.message.trim() } : {}),
      live: true,
      ptz: state.ptz,
      playback: state.playback,
      ...(state.playback
        ? { playbackFrom: toIso(state.from), playbackTo: toIso(state.to) }
        : {}),
      durationSec: state.durationSec,
    };
  }
  /* A REQUEST SENDS NO SCOPE AND NO PERMISSIONS. The site asking cannot know
     what the other has, and what it is granted is the answering site's
     decision, so it asserts neither on the way out. */
  return {
    direction: "request" as const,
    mySiteId,
    otherSiteId: state.otherSiteId,
    message: state.message.trim(),
    durationSec: state.durationSec,
  };
}

/**
 * Is this compose complete enough to send?
 *
 * ⚠ THE LENGTH COUNTS. It used to be pre-filled, so "ready" never had to
 * mention it and every untouched share went out at fifteen minutes. One place
 * answers it now, for the request form and the offer form both, because the
 * first time these disagreed one of them let a share through with no length.
 */
export function composeIsReady(
  state: ComposeState,
  mySiteId: string,
  direction: "request" | "offer",
): boolean {
  if (!mySiteId || !state.otherSiteId) return false;
  if (state.durationSec <= 0) return false;
  if (direction === "request") return state.message.trim().length > 0;
  return state.scope.length > 0;
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

/**
 * What the other site IS to me, in four words.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE TWO OFFER LINES WERE SWAPPED
 * ══════════════════════════════════════════════════════════════════════
 *
 * A site receiving an offer read "North Gate -- you offered yours", and the
 * site that had sent it read "is offering theirs". Both backwards, and for the
 * reason this file warns about everywhere else: the row keyed on `incoming`,
 * which means ONE OF MY SITES OWNS THE CAMERAS, and that is a different
 * question from who started the share.
 *
 * The party who owns the cameras RECEIVES a request and SENDS an offer. So the
 * phrasing has to ask both: which direction, and which side am I on.
 *
 *   request, mine  -> they asked me        "is asking for yours"
 *   request, yours -> I asked them         "you asked them"
 *   offer,   mine  -> I offered them       "you offered yours"
 *   offer,   yours -> they offered me      "is offering theirs"
 *
 * Once it is live the direction stops mattering: what matters is which way the
 * cameras are flowing, and `incoming` answers exactly that.
 */
export function otherSiteRole(share: Share): string {
  const mine = share.incoming === true;
  /* ⚠ AN ADMIN SHARE WAS NOT SENT BY EITHER SITE, so neither "you offered
     yours" nor "is offering theirs" is true of it. The owning site did not
     offer anything and the viewing site was not offered anything BY THEM. */
  if (share.by_admin) {
    if (share.status !== "pending") return mine ? "shared with them" : "shared with you";
    return mine ? "being shared with them" : "being shared with you";
  }
  if (share.status !== "pending") return mine ? "has yours" : "lending to you";
  if (share.direction === "request") return mine ? "is asking for yours" : "you asked them";
  return mine ? "you offered yours" : "is offering theirs";
}

/**
 * Is this share one the OWNING site is only being TOLD about?
 *
 * An administrator sharing one site's cameras with another gives the owning
 * site an information card: what was shared, with whom, for how long, and by
 * whom. It cannot accept, decline, end or extend it, and the server says so
 * through `can_*` -- this is the question the UI asks to know not to draw an
 * empty row of buttons and a heading that implies a decision.
 */
export function isAdminNotice(share: Share): boolean {
  return Boolean(share.by_admin) && share.incoming === true;
}

/** The other site's name, whichever side of the share I am on. */
export function otherSiteName(share: Share): string {
  return share.incoming ? share.viewer_site_name : share.owner_site_name;
}
