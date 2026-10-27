/**
 * A TOWER'S OR A CAMERA'S NAME IS IN CAPITALS. One function, every screen.
 *
 * ── WHY IT IS A FUNCTION AND NOT A CSS CLASS ───────────────────────────
 *
 * `uppercase` in Tailwind is `text-transform`, which changes the glyphs and
 * nothing else. Three things go wrong with that, and all three were on the
 * live site:
 *
 *   1. It has to be remembered at every single place a name appears, and it
 *      was not — the fleet card, the band heading and the tile caption had it,
 *      the settings rows and the search results did not, so one camera read
 *      "GATE TEST" on the wall and "Gate test" in Settings.
 *   2. It never reaches the SERVER. The claim wizard's tower box drew capitals
 *      and sent what was typed, so a tower registered as "north gate mast" and
 *      then displayed as "NORTH GATE MAST" by every screen that remembered the
 *      class — a name that looks saved in capitals and is not.
 *   3. It is invisible to everything that is not a browser: a comparison, a
 *      search, an `aria-label`, a `title`, a sentence built in a string.
 *
 * So the rule lives here. A name is capitalised ON THE WAY IN, as somebody
 * types it, and ON THE WAY OUT, wherever one is drawn — which also means a
 * name saved in lower case before this existed reads in capitals today
 * without anybody having to go and fix the data.
 *
 * ── WHAT IS NOT A DEVICE NAME ──────────────────────────────────────────
 *
 * ⚠ ORGANIZATIONS, SITES AND PEOPLE ARE LEFT EXACTLY AS THEY ARE, and that
 * is a deliberate line rather than an oversight. A person's name is theirs and
 * shouting it is rude; an organization's name is a legal thing somebody chose
 * the capitalisation of. A device's name is a label on a mast, written to be
 * read across a control room and said out loud on a radio — which is why the
 * whole fleet has always been drawn that way and why nothing is lost by
 * making it true rather than drawn.
 *
 * ⚠ AND EVIDENCE FILENAMES ARE NOT PUT THROUGH THIS. `lib/snapshot.ts` keeps
 * the name as the operator's own copy holds it: a still and a clip are
 * evidence, and the point of `safeSegment` is that it preserves rather than
 * prettifies. See the note there.
 */

/**
 * One tower, hub mast or camera name, as every screen shows it.
 *
 * ⚠ `toUpperCase`, NOT `toLocaleUpperCase`. The locale-aware one maps a
 * dotless Turkish `i` to `İ` under a Turkish locale, so the same name would
 * render differently for two operators watching the same wall — and a name on
 * a monitoring screen is a thing two people have to agree about out loud.
 *
 * Nothing in, nothing out: a camera with no name of its own is handled by the
 * fallback in `lib/api/map.ts`, which decides what an unnamed camera is
 * called. Deciding it twice is how the two answers start to differ.
 */
export function deviceName(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.toUpperCase() : "";
}

/**
 * Does this name match what somebody typed into a search box?
 *
 * Case-blind on both sides, because the box is a search and not a filter: a
 * person hunting for "gate" has not told you anything about capitals, and a
 * fleet that answers nothing for a lower-case word is a fleet that looks
 * empty. Both sides go through `deviceName` rather than one of them being
 * lower-cased, so the comparison is the same transformation the screen is
 * already showing.
 */
export function nameMatches(name: string | null | undefined, query: string): boolean {
  const q = deviceName(query).trim();
  return q === "" || deviceName(name).includes(q);
}
