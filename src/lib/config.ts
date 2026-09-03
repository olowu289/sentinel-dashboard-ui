/**
 * Runtime configuration, read once and validated at the door.
 *
 * This is the first thing in the app to know about an environment, and it is
 * deliberately the only thing: everything downstream asks *this* rather than
 * reading `import.meta.env` for itself. One reader means one answer to "is
 * coordination configured", and no screen can quietly disagree.
 *
 * ── WHY IT DOES NOT THROW AT IMPORT ────────────────────────────────────
 *
 * A module-level throw would take the whole app down before a single pixel
 * rendered, and the operator would get a blank page. The honest failure is a
 * screen that *says* coordination is not configured — which is what the
 * dashboard's `SentryNotConfiguredError` does, and its reasoning is worth
 * keeping: an unconfigured dashboard that renders as though it were connected
 * is the one failure mode that must not happen, but a white void is not the fix.
 *
 * So: validation is eager and reporting is lazy. `describeConfig()` is computed
 * at import so a misconfiguration cannot hide behind a code path nobody takes,
 * and `requireCoordinationUrl()` is what actually throws, at the moment
 * something genuinely needs the value.
 */

/** Raised when something asks for config that is absent or unusable. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/** What is wrong with the environment, or `null` when nothing is. */
export type ConfigProblem = string | null;

const RAW = import.meta.env.VITE_COORDINATION_URL;

/**
 * Validate the origin.
 *
 * Three things are checked and each has bitten somebody: an absent value, a
 * value that is not a URL at all, and a value carrying `/v1`. The last is the
 * one worth a specific message — the SDK's own paths include the version, so
 * `https://host/v1` produces `https://host/v1/v1/viewer/towers` and a 404 that
 * looks like a missing route rather than a config typo.
 */
function validate(raw: unknown): ConfigProblem {
  if (typeof raw !== "string" || raw.trim() === "") {
    return "VITE_COORDINATION_URL is unset. Copy .env.example to .env.local and point it at a coordination service.";
  }
  const value = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `VITE_COORDINATION_URL is not a URL: ${JSON.stringify(value)}`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `VITE_COORDINATION_URL must be http or https, not ${JSON.stringify(parsed.protocol)}`;
  }
  /* Not a style rule. The SDK's documented paths carry `/v1` themselves, so a
     base that also carries it doubles the segment. */
  if (/\/v\d+\/?$/.test(parsed.pathname)) {
    return `VITE_COORDINATION_URL must not include the API version — drop the "${parsed.pathname}" and leave just the origin.`;
  }
  return null;
}

const PROBLEM = validate(RAW);

/* Trailing slashes are trimmed here rather than at every call site: the SDK
   treats `https://host` and `https://host/` identically, but string-concatenated
   paths elsewhere would produce a double slash. */
const URL_VALUE = PROBLEM === null ? String(RAW).trim().replace(/\/+$/, "") : undefined;

/** What is wrong with the environment, computed at import. `null` when nothing is. */
export function describeConfig(): ConfigProblem {
  return PROBLEM;
}

/** True when coordination can actually be talked to. Callers use it to stay honest. */
export function isConfigured(): boolean {
  return PROBLEM === null;
}

/** The validated origin, or `undefined`. Never throws — for callers that can degrade. */
export function coordinationBaseUrl(): string | undefined {
  return URL_VALUE;
}

/**
 * The validated origin, or a loud failure.
 *
 * For the paths that genuinely cannot proceed — building the SDK client, most
 * obviously. Throwing beats returning a half-built thing that fails later
 * somewhere less legible.
 */
export function requireCoordinationUrl(): string {
  if (URL_VALUE === undefined) {
    throw new NotConfiguredError(PROBLEM ?? "coordination is not configured");
  }
  return URL_VALUE;
}
