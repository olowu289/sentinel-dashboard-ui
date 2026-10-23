/**
 * The values four settings rows show, as functions rather than as markup.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THESE LEFT THE COMPONENT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Because a hub mast and a tower have to answer the same way, and while these
 * were inline IIFEs inside `CameraSettingsPanel` nothing could check that they
 * did. They are the four rows that read differently on the two pages:
 *
 *   Picture quality    blank on a hub mast, because its camera advertises no
 *                      profile list and the summary returned nothing for a
 *                      camera it could not name -- while the panel below it
 *                      printed "Standard" for that same camera
 *   Internet           "Fibre · connected", two facts in one value, one of
 *                      which the Kallon Cloud row answers on its own
 *   Connected since    read off the CLOUD reading on a hub and off the DEVICE
 *                      record on a tower, so a hub with a perfectly good
 *                      connection time printed "Not connected" in red above a
 *                      Kallon Cloud row reading "Connected"
 *   Radios             hidden on the single-radio hub, which is the one hub
 *                      whose radio count a reader might actually wonder about
 *
 * Each is now one function with one answer, called once by the panel, and the
 * tests feed them a hub fixture built from the tower's own field names. That
 * is the whole claim this round makes: the two pages read the same.
 *
 * Nothing here formats. `formatConnectedSince` lives in `time.ts` with the
 * other clocks, and these return instants and words.
 */

import type { CameraFeed, StreamProfile, Tower } from "@/lib/types";
import type { CloudReading } from "@/lib/api/fleet";

/**
 * What a picture quality is called on screen.
 *
 * ⚠ NEVER "sub" OR "main", WHICH IS WHAT THE WIRE CALLS THEM. Those are our
 * words for two MediaMTX paths and they mean nothing to the person watching.
 * The light one is **Standard**; the heavy one is named by what it actually
 * is, so a customer comparing two sites compares two resolutions.
 *
 * `tierFor` is deliberately the whole label and not a prefix. "2K · 2560×1440"
 * put the fact beside the familiar word, which was right while the row's job
 * was to prove it was no longer lying about 4K. The row's job now is to be
 * chosen from, and a menu of two with four numbers in it is harder to read
 * than a menu of two.
 */
export function tierFor(width: number, height: number): string {
  const w = Math.max(width, height);
  if (w >= 3840) return "4K";
  if (w >= 2560) return "2K";
  if (w >= 1920) return "1080p";
  return "HD";
}

/**
 * The name for one profile, given the set the camera offers.
 *
 * The SMALLEST is Standard, whatever its numbers; everything above it is named
 * by resolution. Decided from the set rather than from the profile's id, so a
 * camera that one day offers three gets three honest names and not two names
 * and a guess.
 */
export function profileLabel(p: StreamProfile, all: readonly StreamProfile[]): string {
  const sized = all.filter((x) => x.resolution);
  if (sized.length > 1 && p.resolution) {
    const pixels = (x: StreamProfile) =>
      (x.resolution?.width ?? 0) * (x.resolution?.height ?? 0);
    const smallest = sized.reduce((a, b) => (pixels(a) <= pixels(b) ? a : b));
    if (p.id === smallest.id) return "Standard";
  }
  if (!p.resolution) return "Standard";
  return tierFor(p.resolution.width, p.resolution.height);
}

/** Which profile a camera is actually being watched at. */
export function currentProfile(
  feed: CameraFeed,
  chosen?: string,
): StreamProfile | undefined {
  const list = feed.profiles ?? [];
  /* What is PLAYING, which is not always what was picked: a remembered id the
     tower no longer advertises falls through to the default. */
  return list.find((p) => p.id === chosen) ?? list.find((p) => p.default) ?? list[0];
}

/**
 * What the collapsed Picture quality row says.
 *
 * One camera speaks for itself; two agreeing speak as one; two disagreeing say
 * so rather than picking a winner to print.
 *
 * ⚠ A CAMERA THAT ADVERTISES NOTHING IS "Standard", NOT BLANK. This is the
 * hub mast's row. Its camera lists no profiles, so the old summary had nothing
 * to name and returned an empty string -- while the expanded panel below it
 * printed "Standard" for exactly that camera, because a camera with fewer than
 * two profiles has one picture quality and that is its name. The row was
 * contradicting the thing it summarises.
 */
export function pictureQualitySummary(
  feeds: readonly CameraFeed[],
  chosen?: Record<string, string>,
): string {
  const labels = feeds.map((f) => {
    const list = f.profiles ?? [];
    if (list.length === 0) return "Standard";
    const current = currentProfile(f, chosen?.[f.id]);
    return current ? profileLabel(current, list) : "Standard";
  });
  if (labels.length === 0) return "";
  return labels.every((l) => l === labels[0]) ? labels[0] : `${labels.length} cameras`;
}

/** A row's value and the status colour it carries, if any. */
export interface RowValue {
  value: string;
  tone?: string;
}

/**
 * The five ways out, spelled the way the product spells them.
 *
 * The wire is not consistent and cannot be made to be: a tower's
 * `health.uplink.type` has always been lowercase (`uplinkReading` tests it
 * against `"ethernet"`), while the cloud reading's `iface` is declared at
 * install by whoever typed it. Both reach the same row, so the row decides.
 * An unrecognised word is capitalised and shown as it came rather than
 * dropped: a site on something we have not thought of still has a way out,
 * and the installer's word for it is better than ours.
 */
const INTERNET_WORD: Record<string, string> = {
  ethernet: "Ethernet",
  fibre: "Fibre",
  fiber: "Fibre",
  mobile: "Mobile",
  cellular: "Mobile",
  lte: "Mobile",
  satellite: "Satellite",
  wifi: "Wi-Fi",
  "wi-fi": "Wi-Fi",
  wireless: "Wi-Fi",
};

/**
 * One of the five words, however it was spelled on the way here.
 *
 * Exported because the Towers board names a hub's way out in the same column
 * the masts show a radio grade in, and two tables would be two spellings.
 */
export function internetWord(raw: string): string {
  const key = raw.trim().toLowerCase();
  return INTERNET_WORD[key] ?? raw.trim().replace(/^./, (c) => c.toUpperCase());
}

/**
 * A hub's way out: the kind of link, or just that there is one.
 *
 * ⚠ THE TYPE ALONE, NOT "Fibre · connected". The row is the way out and the
 * word for it; whether it is up is what the Kallon Cloud row below answers,
 * and two rows on one screen disagreeing about the same link is the state this
 * grammar exists to prevent. A hub that declared no interface says the plain
 * thing rather than an empty half of a value.
 *
 * ⚠ THE RECORD FIRST, BEFORE ANY QUESTION ABOUT THE CLOUD READING. The
 * device's `health.uplink.type` is the site's own word for its own way out.
 * The cloud reading is about something else: whether WE can see the site, and
 * from which end the answer came.
 *
 * ⚠ AND THIS IS WHAT THE LAB HUB CAUGHT. The `is_cloud` branch used to come
 * first, on the reasoning that an answer served BY the data centre has no
 * round trip and therefore no interface to name. True of the cloud's own
 * link, and irrelevant to the mast's: on sentri.watch coordination runs in
 * the data centre and sends `{"connected": true, "is_cloud": true}` with no
 * `iface` at all, so the row answered "Connected" and never looked at the
 * `"type": "Satellite"` sitting in the same response. The hub was reporting
 * correctly the whole time. `is_cloud` says there is no latency to print; it
 * says nothing about how the site gets out.
 *
 * So the order is: a link known to be DOWN beats everything, because the way
 * out hardly matters then; otherwise the declared word, then the cloud's
 * observed one, then the plain fact that there is a link.
 *
 * Nothing reported at all is an empty value, not "Not reported": a site that
 * has not told us about its link has not told us it is down either.
 */
export function internetRow(tower?: Tower, cloud?: CloudReading): RowValue {
  const declared = tower?.health?.uplink?.type;
  /* `isCloud` carries no `connected: false` case -- the data centre answering
     at all is the proof it is reachable -- so it is excluded here rather than
     relied on to be absent. */
  if (cloud && !cloud.isCloud && cloud.connected !== true) {
    return { value: "Not connected", tone: "text-critical" };
  }
  const word = declared ?? cloud?.iface;
  if (word) return { value: internetWord(word) };
  return { value: cloud ? "Connected" : "" };
}

/**
 * When this box's link came up.
 *
 * ⚠ ONE SOURCE FOR BOTH KINDS, AND THAT IS THE FIX. A tower read
 * `connectedAt` off its own record while a hub read the cloud reading's
 * `since`, so a hub whose record carried a perfectly good connection time
 * printed "Not connected" in red directly above a Kallon Cloud row reading
 * "Connected" -- two rows, one link, opposite answers.
 *
 * The record wins, because it is the device's own word and it is what a tower
 * has always shown. The cloud's `since` stays as a fallback for a hub whose
 * record does not carry one yet: it is the same instant measured at the other
 * end of the same link, not a second opinion about a different one.
 */
export function connectedSinceAt(tower: Tower, cloud?: CloudReading): number | undefined {
  if (tower.connectedAt !== undefined) return tower.connectedAt;
  if (!cloud?.since || cloud.connected !== true) return undefined;
  const at = Date.parse(cloud.since);
  return Number.isNaN(at) ? undefined : at;
}

/**
 * How many radios a hub has.
 *
 * ⚠ ALWAYS AT LEAST ONE, AND NEVER HIDDEN. The row used to appear only where
 * `health.sectors` had entries, so the single-radio hub -- the one that
 * declares no sectors precisely because it has none to tell apart -- showed no
 * radio count at all, or the sentence "One radio, no sectors" in the value
 * column. Every hub has a radio. A three-sector hub says 3 and a plain one
 * says 1, and the reader counts radios either way.
 */
export function radioCount(tower: Tower): number {
  return Math.max(tower.health?.sectors?.length ?? 0, 1);
}
