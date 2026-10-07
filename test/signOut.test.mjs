/**
 * Sign out asks first — and only when the person asked.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE TWO THINGS THAT MATTER, AND THEY PULL IN OPPOSITE DIRECTIONS
 * ══════════════════════════════════════════════════════════════════════
 *
 *   1. A DELIBERATE sign-out must be confirmed. The glyph is 34px at the
 *      bottom of the rail, one pixel from the simulator button, and it used to
 *      end the session on the first click.
 *   2. An AUTOMATIC sign-out must NOT be. A session that lapsed, or the forced
 *      one after a password change, has already happened — a dialog asking
 *      permission for something that is already true would be a lie, and on
 *      the expiry path there is nobody at the keyboard to answer it.
 *
 * Both are guarded STRUCTURALLY rather than by behaviour, because there is no
 * component harness in this app (no vitest, no testing-library). The guarantee
 * is: `signOut` — the only function that performs a deliberate sign-out — has
 * exactly ONE caller, and that caller is the dialog's confirm handler. The
 * automatic paths go through `markSessionEnded` / `clearSession` and therefore
 * cannot reach a dialog that only the button mounts.
 *
 * ── WHAT A SOURCE TEST CANNOT DO, SAID PLAINLY ─────────────────────────
 *
 * It cannot click the button, press Escape, or check that focus landed on
 * Cancel. It checks that the WIRING which produces those behaviours is
 * present: the handler is bound, the key is handled, the ref is focused. A
 * regression that removed the dialog, re-pointed the button straight at
 * `signOut`, or dropped the Escape listener is caught. One that broke the
 * dialog's rendering is not.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const RAIL = join(SRC, "components", "IconRail.tsx");
const DIALOG = join(SRC, "components", "SignOutConfirm.tsx");

/** Blank comments, keeping newlines, so prose cannot satisfy a code assertion. */
function stripComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

async function tsxFiles(dir = SRC) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsxFiles(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Bundle a source module through esbuild and import it, as the other suites
 *  do — so the arithmetic under test is the SHIPPED arithmetic. */
async function loadModule(entrySource) {
  const dir = await mkdtemp(join(tmpdir(), "signout-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, entrySource, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC },
    define: {
      "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }),
    },
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

let rail, dialog;
before(async () => {
  rail = stripComments(await readFile(RAIL, "utf8"));
  dialog = stripComments(await readFile(DIALOG, "utf8"));
});

/* ================================================================== *
 * ONLY THE PERSON'S OWN CLICK ASKS
 * ================================================================== */

describe("who can end a session", () => {
  test("`signOut` has exactly ONE caller in the whole app", async () => {
    /* ⚠ THE LOAD-BEARING ASSERTION. It is what makes "only your own click
       asks" a property of the code rather than a convention: if a second place
       ever calls `signOut`, that place bypasses the dialog, and this fails. */
    const callers = [];
    for (const file of await tsxFiles()) {
      if (file.endsWith("AuthProvider.tsx")) continue; // it DEFINES signOut
      const code = stripComments(await readFile(file, "utf8"));
      for (const m of code.matchAll(/\bsignOut\s*\(/g)) {
        callers.push(`${file}:${code.slice(0, m.index).split("\n").length}`);
      }
    }
    assert.equal(
      callers.length,
      1,
      `signOut must have one caller (the confirm handler); found: ${callers.join(", ")}`,
    );
    assert.match(callers[0], /IconRail\.tsx/);
  });

  test("the rail's button OPENS the dialog instead of signing out", async () => {
    /* It used to be `onClick={() => void signOut()}`. */
    assert.match(rail, /onClick=\{\(\)\s*=>\s*setAsking\(true\)\}/);
    assert.ok(
      !/onClick=\{\(\)\s*=>\s*void\s+signOut\(\)\}/.test(rail),
      "the button must not call signOut directly",
    );
  });

  test("the only `signOut` call sits in the confirm handler", async () => {
    /* Not merely "somewhere in IconRail" — inside the function the dialog's
       Sign out button invokes. */
    const confirm = rail.slice(rail.indexOf("const confirm = useCallback"));
    assert.ok(confirm.length > 0, "there must be a confirm handler");
    const body = confirm.slice(0, confirm.indexOf("}, [signOut])"));
    assert.match(body, /await\s+signOut\(\)/);
  });

  test("the AUTOMATIC paths do not go anywhere near the dialog", async () => {
    /* A lapsed session and the post-password-change sign-out. Neither may
       mount a confirmation: the first has nobody to answer it, and the second
       is confirming something the server already did. */
    const automatic = [];
    for (const file of await tsxFiles()) {
      const code = stripComments(await readFile(file, "utf8"));
      if (/markSessionEnded\(|clearSession\(/.test(code)) automatic.push(file);
    }
    assert.ok(automatic.length > 0, "the automatic paths must exist to be checked");
    for (const file of automatic) {
      if (file === RAIL) continue;
      const code = stripComments(await readFile(file, "utf8"));
      assert.ok(
        !/SignOutConfirm/.test(code),
        `${file} ends sessions automatically and must not mount the confirmation`,
      );
    }
  });

  test("only the rail mounts the dialog", async () => {
    const mounts = [];
    for (const file of await tsxFiles()) {
      if (file === DIALOG) continue; // it DEFINES the component
      const code = stripComments(await readFile(file, "utf8"));
      if (/<SignOutConfirm/.test(code)) mounts.push(file);
    }
    assert.deepEqual(mounts, [RAIL]);
  });
});

/* ================================================================== *
 * THE DIALOG'S CONTRACT
 * ================================================================== */

describe("the confirmation dialog", () => {
  test("it asks the question that was specified", () => {
    assert.match(dialog, /Sign out of Sentry\?/);
  });

  test("it is a real modal dialog to a screen reader", () => {
    assert.match(dialog, /role="dialog"/);
    assert.match(dialog, /aria-modal="true"/);
    /* Labelled AND described, and both ids must exist on real elements —
       an aria-labelledby pointing at nothing is worse than none. */
    assert.match(dialog, /aria-labelledby="signout-title"/);
    assert.match(dialog, /aria-describedby="signout-body"/);
    assert.match(dialog, /id="signout-title"/);
    assert.match(dialog, /id="signout-body"/);
  });

  test("Cancel comes FIRST and takes focus", () => {
    /* "Cancel (default, focused)". First in the DOM is first in the tab order,
       and the ref is focused on mount so Enter or Space — the keys somebody
       mashing a small button hits next — cancel rather than confirm. */
    /* Compared by REF, not by the visible text. `indexOf("Cancel")` finds the
       `onCancel` prop in the signature long before the button, and
       `indexOf("Sign out")` finds the dialog TITLE — so a text comparison
       asserted the wrong thing and passed or failed for the wrong reason. The
       refs appear exactly once each, on the two buttons, in DOM order. */
    const cancelAt = dialog.indexOf("ref={cancelRef}");
    const confirmAt = dialog.indexOf("ref={confirmRef}");
    assert.ok(cancelAt > -1 && confirmAt > -1, "both buttons must carry a ref");
    assert.ok(
      cancelAt < confirmAt,
      "Cancel must precede Sign out in the DOM, so it is first in the tab order",
    );
    assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  });

  test("Escape cancels, in the capture phase", () => {
    /* Capture, because the alerts panel binds Escape on the window to drop its
       selection — a bubbling Escape would close this AND change the screen
       behind it. */
    assert.match(dialog, /e\.key === "Escape"/);
    assert.match(dialog, /addEventListener\("keydown",\s*onKey,\s*true\)/);
    assert.match(dialog, /removeEventListener\("keydown",\s*onKey,\s*true\)/);
  });

  test("clicking outside cancels, and only the catcher itself counts", () => {
    /* A full-screen TRANSPARENT catcher, not a dim: this is a popover about one
       small control, and dimming an entire video wall for it would read as a
       much bigger interruption than it is. It still covers the screen, because
       "click outside" has to mean anywhere outside.

       `e.target !== e.currentTarget` — so a click inside the card never bubbles
       out as a dismissal, and a drag ending outside does not either. */
    assert.match(dialog, /onMouseDown=\{onOutside\}/);
    assert.match(dialog, /e\.target !== e\.currentTarget/);
  });

  test("Tab cannot leave the dialog", () => {
    /* `aria-modal` promises the rest of the page is inert. Without a trap that
       promise is false for anybody using a keyboard. */
    assert.match(dialog, /e\.key !== "Tab"/);
    assert.match(dialog, /confirmRef : cancelRef/);
  });

  test("it sits above the full-screen player", () => {
    /* IconRail renders INSIDE ClipPlayer, which is `fixed inset-0 z-100`. At
       z-100 this dialog would paint under the thing that launched it. */
    assert.match(dialog, /z-200/);
  });

  test("a second click cannot sign out twice", () => {
    /* A synchronous ref, not the busy state: two clicks in one tick both read
       the same stale `false`. */
    assert.match(rail, /inFlight\.current/);
    assert.match(dialog, /disabled=\{busy\}/);
  });
});

/* ================================================================== *
 * BOTH THEMES
 * ================================================================== */

describe("the dialog in Dark and Light", () => {
  test("every colour is a theme token", async () => {
    /* There is no scrim colour any more — the catcher is transparent — so every
       colour in here must be a token or the popover is unreadable in one of the
       two themes. The `bg-black/NN` allowance below is kept for the day somebody
       decides the popover should dim after all: a scrim is a layer over the
       product rather than a surface in it, and stays dark in both. */
    const offenders = [];
    for (const m of dialog.matchAll(/className="([^"]*)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (/^(?:hover:|focus:|disabled:)?(?:bg|text|border|ring)-black\/60$/.test(cls)) {
          continue; // the scrim, allowed
        }
        if (/^(?:hover:|focus:|disabled:)?(?:bg|text|border|ring)-(?:white|black)(?:\/\d+)?$/.test(cls)) {
          offenders.push(cls);
        }
        if (/\[#[0-9a-fA-F]{3,6}\]/.test(cls)) offenders.push(cls);
      }
    }
    assert.deepEqual(offenders, [], "hardcoded colours that will not theme");
  });

  test("the critical button's ink does NOT invert with the theme", async () => {
    /* `bg-critical` keeps its colour in light mode, so white-on-red stays
       white-on-red. `--color-critical-ink` is declared with the SAME value in
       both palettes, which is what makes the non-inversion explicit instead of
       an accident waiting for somebody to "fix" it. */
    const css = await readFile(join(SRC, "index.css"), "utf8");
    const dark = css.slice(css.indexOf("@theme {"), css.indexOf('[data-theme="light"]'));
    const light = css.slice(css.indexOf('[data-theme="light"]'));
    const read = (block) =>
      block.match(/--color-critical-ink:\s*([^;]+);/)?.[1].trim();
    assert.ok(read(dark), "critical-ink must be declared in the dark palette");
    assert.equal(read(dark), read(light), "critical-ink must be the same in both");
    assert.match(dialog, /text-critical-ink/);
  });
});

/* ================================================================== *
 * WHERE THE POPOVER GOES — the bug, as arithmetic
 * ================================================================== */

describe("placePopover", () => {
  /* THE RAIL AND THE BUTTON FROM THE BUG REPORT. The rail is 71px wide and the
     sign-out glyph is a 34px square at its bottom, 24px up from the edge. The
     screenshot was a 1913×1091 window. */
  const RAIL_W = 71;
  const BTN = { top: 1009, left: 27, right: 61, bottom: 1043 };
  const VIEW = { width: 1913, height: 1091 };
  const W = 320;
  const H = 150;

  let place, GAP, MARGIN;
  before(async () => {
    const m = await loadModule(`export * from "@/lib/popover";`);
    place = m.placePopover;
    GAP = m.POPOVER_GAP;
    MARGIN = m.POPOVER_MARGIN;
  });

  test("it opens to the RIGHT of the rail, never inside it", async () => {
    /* ⚠ THE BUG. The card drew inside the 71px rail, so the title wrapped one
       word per line and both buttons were cut off. Whatever else changes, the
       card's left edge must clear the rail. */
    const { left } = place({ anchor: BTN, width: W, height: H, viewport: VIEW });
    assert.ok(
      left >= RAIL_W,
      `the card must start right of the ${RAIL_W}px rail, got left=${left}`,
    );
    assert.equal(left, BTN.right + GAP);
  });

  test("the whole card fits on screen", async () => {
    const { top, left } = place({ anchor: BTN, width: W, height: H, viewport: VIEW });
    assert.ok(left >= MARGIN, "not off the left edge");
    assert.ok(left + W <= VIEW.width - MARGIN, "not off the right edge");
    assert.ok(top >= MARGIN, "not off the top");
    assert.ok(top + H <= VIEW.height - MARGIN, "not off the bottom");
  });

  test("it FLIPS UP when there is no room below", async () => {
    /* The real case: the button is 48px from the bottom and the card is 150px
       tall, so opening downward would overflow. It flips so the card's bottom
       aligns with the button's. */
    const { top } = place({ anchor: BTN, width: W, height: H, viewport: VIEW });
    assert.equal(top, BTN.bottom - H);
    assert.ok(top < BTN.top, "flipped up, so it ends level with the button");
  });

  test("it opens DOWNWARD when there IS room below", async () => {
    /* Not hypothetical: the rail's contents are conditional — the simulator
       button comes and goes with a feature — so the anchor is not always at the
       same height. */
    const high = { top: 120, left: 27, right: 61, bottom: 154 };
    const { top } = place({ anchor: high, width: W, height: H, viewport: VIEW });
    assert.equal(top, high.top, "preferred direction is down");
  });

  test("it flips to the LEFT when the anchor is against the right edge", async () => {
    const right = { top: 400, left: 1850, right: 1884, bottom: 434 };
    const { left } = place({ anchor: right, width: W, height: H, viewport: VIEW });
    assert.equal(left, right.left - GAP - W);
    assert.ok(left + W <= VIEW.width - MARGIN);
  });

  test("a window narrower than the card still shows it", async () => {
    /* Clamped rather than pushed off. There is nothing to scroll to on a fixed
       popover, so off-screen is invisible, not merely awkward. */
    const tiny = { width: 260, height: 600 };
    const { left } = place({ anchor: BTN, width: W, height: H, viewport: tiny });
    assert.equal(left, MARGIN, "pinned to the margin rather than hidden");
  });

  test("a card taller than the window is pinned to the top, not lost above it", async () => {
    const shortWindow = { width: 1913, height: 200 };
    const { top } = place({
      anchor: BTN, width: W, height: 400, viewport: shortWindow,
    });
    assert.equal(top, MARGIN);
    assert.ok(top >= 0, "never a negative top, which would be unreachable");
  });

  test("the anchor's own position is never covered horizontally", async () => {
    /* A popover drawn over the button it belongs to hides the thing being
       talked about, and swallows the click that would close it. */
    const { left } = place({ anchor: BTN, width: W, height: H, viewport: VIEW });
    assert.ok(left > BTN.right, "clear of the anchor");
  });
});

/* ================================================================== *
 * THE PORTAL — why the bug happened at all
 * ================================================================== */

describe("the popover escapes its parent", () => {
  test("it is rendered through a portal into document.body", async () => {
    /* ⚠ THE ROOT CAUSE. `position: fixed` resolves against the viewport ONLY
       while no ancestor establishes a containing block — and a `transform`
       does, which `motion` sets on everything it animates. So `inset-0` meant
       "fill the rail", not "fill the screen". A portal moves the node out of
       that subtree entirely; no width, overflow, transform or stacking context
       of a parent can reach it. */
    assert.match(dialog, /createPortal\(/);
    assert.match(dialog, /document\.body,?\s*\)/);
    assert.match(dialog, /from "react-dom"/);
  });

  test("it is placed from the anchor's measured rect", async () => {
    assert.match(dialog, /anchorRef/);
    assert.match(dialog, /getBoundingClientRect\(\)/);
    assert.match(dialog, /placePopover\(/);
  });

  test("it measures BEFORE paint and stays hidden until placed", async () => {
    /* The flip needs the card's real height, which needs it rendered. A first
       paint at a guessed position would be a visible jump on every open. */
    assert.match(dialog, /useLayoutEffect/);
    assert.match(dialog, /visibility: at \? "visible" : "hidden"/);
  });

  test("it is re-placed when the window changes, not closed", async () => {
    /* A resize, a rotated tablet, the kiosk's screen returning from blank.
       Closing would be a confirmation dismissed by something nobody did. */
    assert.match(dialog, /addEventListener\("resize"/);
    assert.match(dialog, /addEventListener\("orientationchange"/);
  });

  test("the card is 320px and its buttons do not wrap", async () => {
    /* The squeezed version wrapped the title one word per line and clipped
       both buttons. */
    assert.match(dialog, /const WIDTH = 320/);
    assert.match(dialog, /whitespace-nowrap/);
    assert.match(dialog, /justify-end/);
  });
});
