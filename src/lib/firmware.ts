/**
 * The firmware line: what a customer reads, and what the detail says.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT IT USED TO SAY
 * ══════════════════════════════════════════════════════════════════════
 *
 *     v1.5.0-23-g8e6f18b (dev)
 *
 * on the About screen of a tower at a customer site. Three things wrong with
 * one line. A commit hash, which is for us and means nothing to the person
 * reading it. The word "dev", which says "this is not a real build" about a
 * tower doing its job. And the number in the middle — the only part that
 * answers "how far along is this one" — buried between the two.
 *
 * So the ROW says
 *
 *     v1.5.0-23
 *
 * the release and the build number, and nothing else. The full string, which
 * is what an engineer needs when something is wrong, is kept and shown as the
 * row's detail: `title` on hover, and the text a support call reads out.
 *
 * ── THE COLOUR, WHICH IS A SEPARATE QUESTION ──────────────────────────
 *
 * `tone` still comes from the OTA channel — green on stable, amber on beta,
 * grey when the tower has not said. A build that is ahead of a release is grey
 * too: it is not on a channel, whatever the channel field claims. The colour
 * carries that, so the label does not have to say "(dev)" to anybody.
 *
 * `tone` is one of the project's existing status text-colour classes — green
 * is `text-terra` (the same green a healthy uplink uses), amber `text-warn`,
 * grey `text-muted`. No new colours.
 */

export interface FirmwareClass {
  /** What the row prints: `v1.5.0-23`, or "Unknown". */
  label: string;
  /** An existing Tailwind status colour class. */
  tone: string;
  /**
   * The whole string the tower reported, plus its channel, for the row's
   * detail. Empty when the tower reported nothing — there is no detail to
   * show about an absence.
   */
  detail: string;
}

const TONE_GREEN = "text-terra";
const TONE_AMBER = "text-warn";
const TONE_GREY = "text-muted";

/** `git describe` suffix when HEAD is AHEAD of a release: `-<n>-g<sha>`. Its
 *  presence means the box is NOT on a clean release, and its `<n>` is the
 *  build number the row shows. */
const DESCRIBE_TAIL = /^(.+?)-(\d+)-g[0-9a-f]{4,40}$/i;

/** A clean release tag: v1.2.0, optionally a prerelease like v1.3.0-rc1 (a single
 *  dash-suffix with no further dashes — which excludes the `-N-gSHA` dev form). */
const CLEAN_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/**
 * The version as a customer reads it: base and build number, never a hash.
 *
 *     "v1.5.0-23-g8e6f18b" -> "v1.5.0-23"
 *     "v1.5.0"             -> "v1.5.0"
 *     "8e6f18b"            -> "8e6f18b"   untagged: there is nothing to
 *                                         shorten, and inventing a version
 *                                         would be worse than showing a commit
 *
 * Kept in step with `short_release` in `core/ota/version.py`, which is what the
 * tower's own status API reports. One format, two implementations, a test on
 * each side.
 */
export function shortVersion(version?: string | null): string {
  const v = (version ?? "").trim();
  const got = DESCRIBE_TAIL.exec(v);
  return got ? `${got[1]}-${got[2]}` : v;
}

export function classifyFirmware(version?: string | null, channel?: string | null): FirmwareClass {
  const v = (version ?? "").trim();
  if (!v || v.toLowerCase() === "unknown") {
    return { label: "Unknown", tone: TONE_GREY, detail: "" };
  }
  const label = shortVersion(v);
  const ch = (channel ?? "").trim().toLowerCase();
  /* Ahead of a release, or not a release tag at all (e.g. a bare commit): grey,
     whatever channel it claims. The colour is what says so; the label does not
     have to. */
  const released = CLEAN_TAG.test(v);
  const tone = !released
    ? TONE_GREY
    : ch === "stable"
      ? TONE_GREEN
      : ch === "beta"
        ? TONE_AMBER
        : TONE_GREY;
  /* The detail is the whole truth: the string as reported, and the channel when
     there is one. This is what somebody reads out on a support call. */
  const detail = ch ? `${v} (${ch})` : v;
  return { label, tone, detail };
}
