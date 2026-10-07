/**
 * The one piece of URL state in this app: which Settings section is open.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THERE WAS NO URL STATE, AND WHY THIS IS NOT A ROUTER
 * ══════════════════════════════════════════════════════════════════════
 *
 * Navigation in this app is React state — `App.tsx` holds `onPlayback`,
 * `onAlerts`, `onSettings` and friends, and nothing in `src/` reads
 * `location`. That is a deliberate shape for a monitoring wall: the screen is
 * a workspace somebody sits in front of for a shift, not a set of documents
 * they navigate between, and a wall that could be deep-linked into a
 * half-attached state is a wall that reconnects four cameras on every back
 * button.
 *
 * A linkable Settings section is a genuinely different requirement: it is a
 * place you send somebody ("the camera names are under Settings → Cameras"),
 * and the thing on screen is a form rather than a video stream.
 *
 * So this is the NARROWEST possible addition — one hash, four known values,
 * nothing else in the app reads or writes it. It is not a router and must not
 * grow into one by accident: if a second screen needs linking, that is the
 * moment to decide whether this app wants routing, not the moment to add a
 * fifth case here.
 *
 * ── WHY THE HASH AND NOT A PATH ────────────────────────────────────────
 *
 * `#settings/cameras`, not `/settings/cameras`. A real path needs the server
 * to answer index.html for an address that is not a file, and this bundle is
 * served from TWO places with different rules:
 *
 *   Vercel  would need a rewrite in vercel.json;
 *   THE HUB serves it as static files from coordination's own handler, with no
 *           SPA fallback at all — so `/settings/cameras` would be a 404 on the
 *           box that shows the kiosk, which is the deployment least able to be
 *           debugged by whoever is standing in front of it.
 *
 * A hash never reaches either server. One mechanism, both deployments,
 * including the offline hub. It also costs no history entries we have to
 * manage: `replaceState` is not needed because the hash is the whole state.
 */

/** The sections, in the order the left list shows them. */
export const SETTINGS_SECTIONS = [
  "account",
  "security",
  "appearance",
  "cameras",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = "account";

/** The prefix that marks a settings hash. Anything else is not ours. */
const PREFIX = "#settings";

/**
 * The section named by the current URL, or `null` when the URL is not asking
 * for Settings at all.
 *
 * ⚠ `null` AND `"account"` ARE DIFFERENT ANSWERS. `null` means "this URL says
 * nothing about Settings", which must leave whatever screen is open alone —
 * returning the default instead would make every page load open Settings.
 * `"account"` means the URL asked for Settings and named no section.
 */
export function sectionFromHash(hash?: string): SettingsSection | null {
  const raw = (hash ?? (typeof window !== "undefined" ? window.location.hash : "")) || "";
  if (raw !== PREFIX && !raw.startsWith(PREFIX + "/")) return null;
  const tail = raw.slice(PREFIX.length).replace(/^\//, "").toLowerCase();
  if (!tail) return DEFAULT_SECTION;
  /* Validated against the list, not trusted. A hash is the one piece of app
     state a person can type, so an unknown value falls back to the default
     rather than rendering an empty right-hand pane. */
  return (SETTINGS_SECTIONS as readonly string[]).includes(tail)
    ? (tail as SettingsSection)
    : DEFAULT_SECTION;
}

/** The hash for a section, for an href or a copy-paste. */
export function hashForSection(section: SettingsSection): string {
  return `${PREFIX}/${section}`;
}

/**
 * Point the URL at a section without adding a history entry.
 *
 * `replaceState`, not `location.hash =`. Clicking through four sections should
 * not cost four presses of the back button to leave Settings — the sections are
 * tabs on one screen, not four places you went.
 *
 * Falls back to assigning the hash where `replaceState` is unavailable or
 * refused (a sandboxed iframe throws). The fallback is worse, not broken.
 */
export function writeSection(section: SettingsSection): void {
  if (typeof window === "undefined") return;
  const next = hashForSection(section);
  if (window.location.hash === next) return;
  try {
    window.history.replaceState(null, "", next);
  } catch {
    try {
      window.location.hash = next;
    } catch {
      /* Nothing left to try. The pane still renders; only the link is lost. */
    }
  }
}

/**
 * Clear the settings hash when leaving the screen.
 *
 * Otherwise the URL still says `#settings/cameras` while the wall is on
 * screen, and a reload would bounce the person back into Settings from a
 * screen they had left.
 */
export function clearSection(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash.startsWith(PREFIX)) return;
  try {
    /* The pathname and query are preserved; only the fragment goes. Assigning
       `""` to `location.hash` leaves a bare "#" in the bar, which is why this
       builds the URL explicitly. */
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  } catch {
    /* Leave it. A stale hash is cosmetic next to breaking navigation. */
  }
}

/**
 * React to the URL changing under us — back, forward, or a pasted link.
 *
 * Returns an unsubscribe. The callback receives `null` when the hash stopped
 * naming Settings, so a caller can close the screen rather than guess.
 */
export function subscribeToSettingsHash(
  fn: (section: SettingsSection | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => fn(sectionFromHash());
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
