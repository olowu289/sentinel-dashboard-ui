/**
 * What the Uplink reading looks like, for every screen that draws one.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS, AND WHAT IT FIXES
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠ TWO SCREENS WERE READING TWO DIFFERENT BLOCKS ABOUT ONE RADIO. Tower
 * settings read `health.radio` -- the mast's own radio, read off the Ubiquiti
 * over read-only SNMP, which is the number an installer aiming a dish wants.
 * The Towers board read `health.uplink`, a different block, through
 * `uplinkReading`. On the lab fleet Tower 1's radio reported -44 dBm, so
 * settings said "Good" and the board, two clicks away, said "No link" in
 * amber over three grey bars, on a tower it also described as up for 18
 * minutes. Both were reporting faithfully. They were reporting different
 * fields.
 *
 * So one function, reading `health.radio` -- the field settings already read
 * and the one the hub actually fills -- and both screens draw what it returns.
 * The word, the bars and the colour come out together or not at all, which is
 * the only arrangement in which a drawing cannot contradict a figure.
 *
 * ── "NO LINK" IS RESERVED FOR A TOWER THAT IS OFF ─────────────────────
 *
 * It is the loudest thing this column can say and it was being said about
 * working towers. It now requires `tower.online === false`, which for a tower
 * IS its link being down: `online` is the state of the link to coordination,
 * watched by coordination itself. An online tower whose radio has nothing to
 * say gets a dash and three dark bars -- the instrument is present, unlit, and
 * says so.
 *
 * ── A HUB MAST HAS NO BARS ────────────────────────────────────────────
 *
 * A hub is not on a radio link; it IS the thing masts link to, and it reaches
 * the world by its own way out. Its Uplink cell shows that word -- Satellite,
 * Fibre, Mobile -- and draws no meter, because there is no signal strength to
 * meter. Three dark bars beside "Satellite" would read as a satellite link
 * with no signal.
 */

import { radioGrade } from "@/lib/radio";
import { internetWord } from "@/lib/settingsRows";
import type { CloudReading } from "@/lib/api/fleet";
import type { Tower } from "@/lib/types";

/** The dash an empty reading draws. Not an em-dash -- see `EMPTY` in TowersView. */
const DASH = "–";

/** How many bars the meter has. Three, and the thresholds are the grades. */
export const UPLINK_BARS = 3;

export interface UplinkDisplay {
  /**
   * Which kind of answer this is, for a caller that needs to branch.
   *
   *   signal     a real dBm, graded
   *   none       online, nothing measured
   *   down       the tower is not connected
   *   internet   a hub's own way out, named
   */
  kind: "signal" | "none" | "down" | "internet";
  /** What the cell prints. */
  word: string;
  /** Lit bars, 0 to 3. Always 0 when `meter` is false. */
  bars: number;
  /**
   * Does this reading have a meter at all?
   *
   * False for a hub mast, whose way out has no signal strength. The caller
   * draws the word alone rather than the word beside an empty instrument.
   */
  meter: boolean;
  /**
   * The status colour, from the app's reserved set, or undefined for a
   * reading with no status. Undefined is NOT a colour to default: it means
   * the value is drawn in the ordinary foreground and the bars stay dim.
   */
  tone?: string;
  /** The measurement itself, where there was one. For the hover. */
  dbm?: number;
}

/**
 * The reading for one device, from its record.
 *
 * Takes the whole tower rather than the radio block so that `online` and
 * `kind` are decided here too: whether a tower is reachable is half of what
 * this answers, and a caller that had to combine two of these could get the
 * combination wrong.
 */
export function uplinkDisplay(tower: Tower, cloud?: CloudReading): UplinkDisplay {
  if (tower.kind === "hub") return hubUplink(tower, cloud);

  /* ⚠ OFFLINE FIRST, AND IT IS THE ONLY PATH TO "No link". A tower that is
     not connected has no current radio reading either -- coordination keeps
     the last health block a tower sent, so grading it would print a link that
     held days ago as though it held now. */
  if (!tower.online) {
    return { kind: "down", word: "No link", bars: 0, meter: true, tone: "text-critical" };
  }

  const radio = tower.health?.radio;
  const dbm = radio?.signalDbm;
  if (typeof dbm === "number" && Number.isFinite(dbm)) {
    const grade = radioGrade(dbm);
    /* The bars ARE the grade, counted. Three thresholds, three words, three
       heights: anything else would be a second opinion about one number. */
    const bars = grade.word === "Good" ? 3 : grade.word === "Fair" ? 2 : 1;
    return { kind: "signal", word: grade.word, bars, meter: true, tone: grade.tone, dbm };
  }

  /* ⚠ A RADIO THAT SAYS IT IS NOT JOINED IS NOT THE SAME AS SILENCE, and it
     keeps the words settings already uses for it. "No link" is not available
     here: this tower is online, and the board must not contradict its own
     Connected column. */
  if (radio && radio.associated === false) {
    return { kind: "none", word: "Not connected", bars: 0, meter: true, tone: "text-critical" };
  }

  /* Online, nothing measured: no SNMP community on the site, a radio that
     would not answer, or a reading outside plausible RF. The instrument is
     drawn dark and the dash beside it says there is nothing to read. */
  return { kind: "none", word: DASH, bars: 0, meter: true };
}

/**
 * A hub's way out, as the Uplink column shows it.
 *
 * The same field and the same table the settings panel's Internet row uses,
 * so the two cannot drift: `health.uplink.type` first, the cloud reading's
 * observed interface second. A hub that has told us nothing shows a dash.
 */
function hubUplink(tower: Tower, cloud?: CloudReading): UplinkDisplay {
  /* The hub's own link to the world, not a mast's to a hub. `isCloud` is
     excluded for the reason `internetRow` gives: the data centre answering at
     all is proof it is reachable, and it sends no `connected: false`. */
  const down = !tower.online || (cloud !== undefined && !cloud.isCloud && cloud.connected !== true);
  if (down) {
    return { kind: "down", word: "No link", bars: 0, meter: false, tone: "text-critical" };
  }
  const declared = tower.health?.uplink?.type ?? cloud?.iface;
  if (declared) {
    return { kind: "internet", word: internetWord(declared), bars: 0, meter: false };
  }
  return { kind: "none", word: DASH, bars: 0, meter: false };
}

/**
 * The full sentence behind the cell, for the pointer that asks.
 *
 * Kept beside the display rather than in the component, because every word of
 * it is about what the reading means and none of it is about layout.
 */
export function uplinkHint(d: UplinkDisplay, tower: Tower): string {
  switch (d.kind) {
    case "signal":
      return `${d.word} signal, ${d.dbm} dBm, as measured at the site.`;
    case "down":
      return tower.kind === "hub"
        ? "This cell is not reaching Kallon Cloud."
        : "The tower is not connected.";
    case "internet":
      return `This cell reaches Kallon Cloud over ${d.word}.`;
    default:
      return tower.kind === "hub"
        ? "This cell has not reported how it reaches Kallon Cloud."
        : d.word === "Not connected"
          ? "The radio is up but not joined to any network."
          : "No signal reading. The radio was not measured.";
  }
}
