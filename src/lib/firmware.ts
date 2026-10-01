/**
 * Classify a tower's reported firmware into a display label + a status colour.
 *
 * ONE place decides this, from BOTH the version string and the reported OTA
 * channel, so the About-device Firmware row (and anywhere else) reads it the same
 * way:
 *
 *   clean release tag + stable   -> green,  "v1.0.0 (stable)"
 *   clean release tag + beta     -> amber,  "v1.2.0 (beta)"
 *   ahead of a release (-N-gSHA) -> grey,   "v1.0.0-3-gSHA (dev)"   (channel ignored)
 *   version absent / unknown     -> grey,   "Unknown"
 *   clean tag, channel unknown   -> grey,   "v1.0.0 (unknown)"
 *
 * `tone` is one of the project's existing status text-colour classes — green is
 * `text-terra` (the same green a healthy uplink uses), amber `text-warn`, grey
 * `text-muted`. No new colours.
 */

export interface FirmwareClass {
  label: string;
  tone: string; // an existing Tailwind status colour class
}

const TONE_GREEN = "text-terra";
const TONE_AMBER = "text-warn";
const TONE_GREY = "text-muted";

/** `git describe` suffix when HEAD is AHEAD of a release: `-<n>-g<sha>`. Its
 *  presence means the box is NOT on a clean release (dev/unreleased). */
const DEV_SUFFIX = /-\d+-g[0-9a-f]+$/i;

/** A clean release tag: v1.2.0, optionally a prerelease like v1.3.0-rc1 (a single
 *  dash-suffix with no further dashes — which excludes the `-N-gSHA` dev form). */
const CLEAN_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

export function classifyFirmware(version?: string | null, channel?: string | null): FirmwareClass {
  const v = (version ?? "").trim();
  if (!v || v.toLowerCase() === "unknown") {
    return { label: "Unknown", tone: TONE_GREY };
  }
  // Ahead of a release, or not a release tag at all (e.g. a bare commit): dev.
  if (DEV_SUFFIX.test(v) || !CLEAN_TAG.test(v)) {
    return { label: `${v} (dev)`, tone: TONE_GREY };
  }
  const ch = (channel ?? "").trim().toLowerCase();
  if (ch === "stable") return { label: `${v} (stable)`, tone: TONE_GREEN };
  if (ch === "beta") return { label: `${v} (beta)`, tone: TONE_AMBER };
  // A real release, but we don't know the channel — honest, not green.
  return { label: `${v} (unknown)`, tone: TONE_GREY };
}
