import { coordinationBaseUrl } from "./config";
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
}

let resolved: Promise<SiteConfig> | null = null;

async function fetchSiteConfig(): Promise<SiteConfig> {
  const base = coordinationBaseUrl();
  if (!base) return { tz: siteTz(), fromHub: false };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // No credentials: /healthz is unauthenticated, and sending any would be a
    // credential on a route that has no use for one.
    const res = await fetch(new URL("/healthz", base).toString(), {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return { tz: siteTz(), fromHub: false };
    const body: unknown = await res.json();
    const tz = (body as { site?: { tz?: unknown } } | null)?.site?.tz;
    const took = setSiteTz(typeof tz === "string" ? tz : null);
    return { tz: siteTz(), fromHub: took };
  } catch {
    // Unreachable, aborted, or not JSON. The fallback stands.
    return { tz: siteTz(), fromHub: false };
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
