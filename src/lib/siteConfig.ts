import { coordinationBaseUrl } from "./config";
import { isHubRole } from "./hubMode";
import { setSiteTz, siteTz } from "./time";

/**
 * Adopt the hub's own idea of what time it is.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE SOURCE OF TRUTH FOR THE SITE TIMEZONE, AND IT IS THE BOX.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `lib/time.ts` used to hold `export const SITE_TZ = "Africa/Lagos"`. That made the
 * frontend a second authority on something the hub already decides: the hub holds
 * SITE_TZ in device.env, and it is the machine that names the recording files. Two
 * copies of that answer can disagree, and when they do the disagreement is about what
 * time a piece of footage was recorded, which is the one thing a security product may
 * not be vague about.
 *
 * So the hub serves it on `/healthz` as `site.tz` and this adopts it once at boot.
 * Africa/Lagos survives in time.ts as the FALLBACK ONLY, for the moment before this
 * resolves and for a hub too old to send it.
 *
 * ── WHY /healthz AND NOT THE LOGIN RESPONSE ───────────────────────────
 *
 * It needs no session, so the app has the right zone before anyone signs in, and a
 * timezone is not a secret. It is also a status endpoint that already exists, so this
 * adds no new unauthenticated surface.
 *
 * ── IT NEVER BLOCKS AND NEVER THROWS ─────────────────────────────────
 *
 * A hub that is unreachable, slow, or old must not stop the dashboard rendering. The
 * worst outcome here is staying on the fallback zone, which is what the app did
 * before this existed.
 */

/** Milliseconds before giving up and keeping the fallback zone. */
const TIMEOUT_MS = 4000;

export interface SiteConfig {
  tz: string;
  /** Whether the hub actually supplied it, as opposed to the fallback standing. */
  fromHub: boolean;
  /**
   * The company login this hub belongs to, for the SIGN-IN screen to fill in.
   *
   * ⚠ ONLY EVER SET ON A HUB, and `null` is the normal answer everywhere
   * else. Kallon Cloud serves thousands of organizations and has no single
   * right answer to put in the box; it never sends the field, and this never
   * invents one. A hub that has not been told its customer yet does not send
   * it either, and then the screen is the ordinary one.
   *
   * It is not a secret. It is the name printed on the hub's own paperwork,
   * read off an unauthenticated status route by a person standing at the
   * machine. The password is the secret and nothing here touches it.
   */
  hubLogin: string | null;
  /** What the box that answered says it is. `"hub"`, `"datacenter"`, or "". */
  role: string;
}

let resolved: Promise<SiteConfig> | null = null;

/** What this resolves to when the hub said nothing useful. */
const UNKNOWN = (): SiteConfig => ({
  tz: siteTz(),
  fromHub: false,
  hubLogin: null,
  role: "",
});

async function fetchSiteConfig(): Promise<SiteConfig> {
  const base = coordinationBaseUrl();
  if (!base) return UNKNOWN();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // No credentials: /healthz is unauthenticated, and sending any would be a
    // credential on a route that has no use for one.
    const res = await fetch(new URL("/healthz", base).toString(), {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return UNKNOWN();
    const body = (await res.json()) as {
      site?: { tz?: unknown };
      role?: unknown;
      organization?: unknown;
    } | null;
    const tz = body?.site?.tz;
    const took = setSiteTz(typeof tz === "string" ? tz : null);
    const role = typeof body?.role === "string" ? body.role : "";
    /* ⚠ THE LOGIN ONLY COUNTS ON A HUB, and the role is tested rather than
       trusted to be absent elsewhere. If Kallon Cloud ever grew an
       `organization` field for some unrelated reason, a sign-in screen that
       read it would fill one customer's login in for every other customer. */
    const org = body?.organization;
    const hubLogin =
      isHubRole(role) && typeof org === "string" && org.trim() !== ""
        ? org.trim()
        : null;
    return { tz: siteTz(), fromHub: took, hubLogin, role };
  } catch {
    // Unreachable, aborted, or not JSON. The fallback stands.
    return UNKNOWN();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the site config once per page load.
 *
 * Memoised on the PROMISE, not on the result, so StrictMode's double-invoked effects
 * and two components asking at once share one request instead of racing two.
 */
export function loadSiteConfig(): Promise<SiteConfig> {
  if (resolved === null) resolved = fetchSiteConfig();
  return resolved;
}
