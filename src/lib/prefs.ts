import type { CameraSettings } from "@/lib/types";

/**
 * What this browser remembers between visits, for one operator.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE LINE: VIEW PREFERENCES ONLY. NOTHING THAT HAS A REAL HOME.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A preference is a statement about how one person likes to LOOK at the fleet.
 * It has no authority, nobody else needs it, and losing it costs a rearrangement
 * rather than a fact. That is the whole set of things that belong here.
 *
 * ── WHAT IS DELIBERATELY NOT HERE, AND WHY ─────────────────────────────
 *
 * THE SESSION TOKEN stays in `sessionStorage` and must never move. Both are
 * equally reachable by XSS; the difference is lifetime — `sessionStorage` dies
 * with the tab, `localStorage` survives until cleared. On a shared control-room
 * machine, a credential that outlives the shift is the wrong default, and
 * "shorter is strictly better here and costs nothing" is the reasoning the
 * reference dashboard settled it with.
 *
 * THE PENDING TOWER CLAIM is already server-side and must not be mirrored here.
 * It survives a reload because it is OWNERSHIP recorded by coordination, not
 * because this browser remembered it. A local copy would be a second answer to
 * "is this tower mine", and the first time the two disagreed the local one would
 * win on screen.
 *
 * SEEDED DOMAIN MUTATIONS — acknowledgements, enrolments, watchlist changes,
 * rejected matches — are NOT persisted, and this is the important one.
 *
 *   They have no backend. Alerts and the watchlist do not exist in the contract,
 *   so an acknowledgement is currently a local write to a store nothing reads.
 *   Persisting it would make it LOOK durable: an operator would acknowledge an
 *   alert, reload, see it still acknowledged, and reasonably conclude the record
 *   is somewhere. It is not. It is in one browser, on one machine, invisible to
 *   the colleague taking the next shift and to any audit.
 *
 *   That is worse than losing it. Losing it is obvious and teaches the truth —
 *   this data is not saved yet. Faking its persistence teaches the opposite and
 *   is only discovered when somebody needs the record and it is not there.
 *   So seeded domain state stays honestly ephemeral until it has a real home.
 *
 * ── KEYED BY ACCOUNT ───────────────────────────────────────────────────
 *
 * One machine, several operators, and an arrangement is personal. Keying by
 * `account_id` rather than a single blob means signing in as somebody else
 * shows their wall, not the last person's — and nothing leaks between them.
 */

const VERSION = "v1";
const PREFIX = "sentinel.prefs";

export interface ViewPrefs {
  /** The fleet wall's arrangement, as feed ids. */
  wallOrder: string[];
  /** Towers whose alert notice this operator has read. */
  dismissedNotices: string[];
  /**
   * Camera settings by tower id.
   *
   * ⚠ LOCAL ONLY, AND NOT SYNCED. Coordination serves no camera-configuration
   * route, so these have never reached a tower — they are this operator's local
   * preference for what the panel should say, and nothing more.
   *
   * They are persisted anyway, and the distinction from the paragraph above is
   * worth being exact about: an acknowledgement is a claim about something that
   * HAPPENED and belongs in a record, so faking its durability is a lie about
   * an event. A settings panel is a claim about what the operator WANTS, which
   * is a preference by nature — and until there is a device to send it to, a
   * remembered preference is the honest whole of it.
   *
   * The moment settings gain a backend this must move out of here, because at
   * that point a local copy would disagree with a tower.
   */
  cameraSettings: Record<string, CameraSettings>;
}

export const EMPTY_PREFS: ViewPrefs = {
  wallOrder: [],
  dismissedNotices: [],
  cameraSettings: {},
};

function keyFor(accountId: string): string {
  return `${PREFIX}.${VERSION}:${accountId}`;
}

/**
 * `localStorage` can throw on the property access itself in a locked-down
 * browser, so every touch is guarded rather than truthiness-checked.
 */
function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

/** An array of strings, or nothing. Anything else is treated as absent. */
function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
}

/**
 * Read this account's preferences.
 *
 * Every failure — no storage, no entry, unparseable JSON, a shape from an older
 * version — resolves to defaults rather than an error. A preference that cannot
 * be read is a rearrangement, not an outage, and there is no version of this
 * worth showing somebody a broken screen over.
 */
export function loadPrefs(accountId: string | null | undefined): ViewPrefs {
  if (!accountId) return EMPTY_PREFS;
  const store = storage();
  if (!store) return EMPTY_PREFS;

  try {
    const raw = store.getItem(keyFor(accountId));
    if (!raw) return EMPTY_PREFS;
    const parsed = JSON.parse(raw) as Partial<ViewPrefs> | null;
    if (!parsed || typeof parsed !== "object") return EMPTY_PREFS;

    return {
      wallOrder: stringArray(parsed.wallOrder) ?? [],
      dismissedNotices: stringArray(parsed.dismissedNotices) ?? [],
      cameraSettings:
        parsed.cameraSettings && typeof parsed.cameraSettings === "object"
          ? (parsed.cameraSettings as Record<string, CameraSettings>)
          : {},
    };
  } catch {
    /* Corrupt, or from a shape we no longer understand. Defaults, and do not
       try to salvage half of it — a partially-restored arrangement is more
       confusing than a fresh one. */
    return EMPTY_PREFS;
  }
}

/**
 * Write this account's preferences.
 *
 * Silent on failure. Storage can be full, or blocked by policy, and a
 * preference that could not be saved is not worth interrupting anybody over —
 * the app works identically, it just forgets.
 */
export function savePrefs(
  accountId: string | null | undefined,
  prefs: ViewPrefs,
): void {
  if (!accountId) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(accountId), JSON.stringify(prefs));
  } catch {
    /* Nothing useful to do, and nothing worth saying. */
  }
}
