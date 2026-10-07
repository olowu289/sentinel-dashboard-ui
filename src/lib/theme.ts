/**
 * Dark or light, remembered per browser.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY PER BROWSER AND NOT ON THE SERVER
 * ══════════════════════════════════════════════════════════════════════
 *
 * One login is shared by everyone in an organization — `accounts._validate_login`
 * says so in as many words: "an org cannot have two users, and two people sharing
 * an org share one password". So a theme stored on the DC would not be "remembered
 * per user", it would be remembered per ORGANIZATION: the night operator switching
 * to dark would switch the day operator's screen too, and the control-room monitor
 * would follow whoever logged in last.
 *
 * `localStorage`, therefore, which really is per person — each at their own machine.
 * It is also exactly what this app's own storage doctrine reserves browser storage
 * for: `api/auth.ts` says localStorage is for "per-viewer conveniences", and a
 * theme is the definition of one.
 *
 * ⚠ localStorage, NOT sessionStorage, and that is the one place this diverges from
 * the session's choice. A session deliberately dies with the tab (shorter is safer
 * for a credential). A theme must survive a reload and a reboot, or the kiosk
 * monitor reverts to dark every morning and somebody has to click it again.
 * Nothing here is a credential, so there is nothing to protect by forgetting it.
 *
 * ── DARK IS THE DEFAULT, AND THE SYSTEM PREFERENCE IS IGNORED ──────────
 *
 * No `prefers-color-scheme` sniffing. Deliberate: this is a video wall, dark is
 * the product's visual language and what every existing screen is already set to,
 * and a Windows machine defaulting to light would flip an entire control room on
 * first load. A theme is an explicit choice here, and until somebody makes one
 * they get what they have always had.
 *
 * ── THE ONE-FRAME FLASH, NAMED RATHER THAN HIDDEN ──────────────────────
 *
 * The usual fix is a tiny inline <script> in index.html that sets the attribute
 * before first paint. This app's CSP is `script-src 'self'` with no
 * 'unsafe-inline', and widening it for a cosmetic flash would be trading a real
 * protection for a nicety. So `applyStoredTheme()` runs as the first statement in
 * main.tsx instead: a light-mode viewer may see one dark frame on a cold load.
 * Dark-mode viewers — everyone, by default — see nothing.
 */

export type Theme = "dark" | "light";

/** Namespaced like the session key, so it cannot collide on this origin. */
const STORAGE_KEY = "sentinel.theme.v1";

export const DEFAULT_THEME: Theme = "dark";

function canUseStorage(): boolean {
  /* A locked-down browser can throw on the property access itself, so this is a
     try/catch rather than a truthiness check — the same shape `api/auth.ts`
     uses, and for the same reason. */
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** The stored choice, or the default. Never throws. */
export function getTheme(): Theme {
  if (!canUseStorage()) return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    /* Validated, not trusted. Anything else in that key — a value from an older
       build, or something a person typed into devtools — falls back rather than
       reaching the DOM as an unknown attribute that matches no CSS and renders
       a half-themed page. */
    return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Put the theme on the document.
 *
 * `data-theme` on <html>, which is what `index.css` keys its light overrides
 * off. DARK SETS NO ATTRIBUTE AT ALL — it is the `@theme` block's own values, so
 * removing the attribute is the honest way back to the default rather than a
 * second palette that has to be kept in step with the first.
 *
 * `color-scheme` is set alongside it so the browser themes what CSS cannot: form
 * controls, the scrollbar, and the flash of background before paint.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
    root.style.colorScheme = "light";
  } else {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "dark";
  }
}

const listeners = new Set<(theme: Theme) => void>();

/** React to a theme change from anywhere. Returns an unsubscribe. */
export function subscribeToTheme(fn: (theme: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Choose a theme: store it, apply it, tell everyone.
 *
 * Applied even when the write fails. A browser with storage blocked still gets
 * the theme for this page view; only the remembering is lost, and failing the
 * whole action over that would be worse.
 */
export function setTheme(theme: Theme): void {
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Full, blocked, or private mode. Nothing useful to do. */
    }
  }
  applyTheme(theme);
  for (const fn of listeners) fn(theme);
}

/**
 * Apply whatever was stored. Call this ONCE, as early as possible.
 *
 * Returns the theme it applied, so a caller can seed its own state without
 * reading storage a second time.
 */
export function applyStoredTheme(): Theme {
  const theme = getTheme();
  applyTheme(theme);
  return theme;
}
