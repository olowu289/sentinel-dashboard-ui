/**
 * How good a radio link is, in a word a customer can act on.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THE WORD IS DECIDED HERE AND NOT UPSTREAM
 * ══════════════════════════════════════════════════════════════════════
 *
 * The same division of labour as `uplinkReading`: the radio reports a dBm,
 * which is the fact, and this app turns it into Good · Fair · Weak, which is
 * an opinion about what is acceptable. A grade computed on the hub would
 * freeze one such opinion into every tower in the fleet and could not be
 * changed without a firmware release; a grade computed here changes when we
 * learn better.
 *
 * ── THE THRESHOLDS ────────────────────────────────────────────────────
 *
 *   better than -65 dBm   Good   a link with headroom for weather
 *   -65 to -75 dBm        Fair   working, and worth looking at on a bad day
 *   worse than -75 dBm    Weak   re-aim the dish
 *
 * They are the installer's own rule of thumb for a 5 GHz point-to-point link,
 * and they are stated once here so the tower row, the hub's sector list and
 * anything added later cannot disagree about where Fair ends.
 *
 * ⚠ THERE IS NO GRADE WITHOUT A NUMBER. `radioGrade` takes a number and
 * returns a word; a caller with no reading must print "Not measured" rather
 * than asking this for a default. Every path that produces no measurement --
 * no SNMP community configured on the site, a radio that would not answer, a
 * reading outside plausible RF -- arrives as an absent `signalDbm`, and a
 * substituted 0 would grade as the best link in the fleet.
 */

/** The three words, and the tone each one is allowed to paint. */
export type RadioGrade = {
  word: "Good" | "Fair" | "Weak";
  /** The app's reserved colour set. Spent here because this IS a reading. */
  tone: string;
};

/** Better than this is Good. */
export const GOOD_ABOVE_DBM = -65;
/** Worse than this is Weak; between the two is Fair. */
export const WEAK_BELOW_DBM = -75;

/**
 * A dBm to a word. Only ever called with a real measurement.
 *
 * The comparison is on the signed value, which reads backwards until you hold
 * it in mind: -60 is STRONGER than -70, so "better than -65" is `> -65`.
 */
export function radioGrade(dbm: number): RadioGrade {
  if (dbm > GOOD_ABOVE_DBM) return { word: "Good", tone: "text-terra" };
  if (dbm >= WEAK_BELOW_DBM) return { word: "Fair", tone: "text-warn" };
  return { word: "Weak", tone: "text-critical" };
}

/**
 * The link state the fabric reports, in plain words — or nothing.
 *
 * `up` adds nothing a reader cannot see from the signal beside it, so it says
 * nothing: a row reading "Good · -58 dBm · up" spends a third of its width on
 * a word that is implied. `degraded` and `down` are the two that change what
 * somebody does, so those are the two that speak.
 */
export function radioStateNote(state: string | undefined): string | null {
  if (state === "degraded") return "link unsteady";
  if (state === "down") return "link down";
  return null;
}
