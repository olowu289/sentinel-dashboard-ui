/**
 * The settings hash — the only URL state in this app.
 *
 * THE ASSERTION THAT MATTERS MOST is the difference between `null` and
 * `"account"`. `null` means "this URL says nothing about Settings" and must
 * leave the open screen alone; `"account"` means "Settings, no section named".
 * Collapsing them would make every cold load of the dashboard open Settings,
 * which is the kind of bug that looks like a routing library problem and is
 * really one `??` in the wrong place.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, beforeEach, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let r;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "route-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/settingsRoute";`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": join(ROOT, "src") },
    define: {
      "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }),
    },
    logLevel: "silent",
  });
  r = await import(pathToFileURL(out).href);
});

/** A window stub with a hash, a history, and a hashchange listener. */
function fakeWindow(hash = "", { brokenHistory = false } = {}) {
  const listeners = [];
  const win = {
    location: { hash, pathname: "/", search: "" },
    history: {
      replaceState(_state, _title, url) {
        if (brokenHistory) throw new Error("refused");
        const i = String(url).indexOf("#");
        win.location.hash = i === -1 ? "" : String(url).slice(i);
      },
    },
    addEventListener: (type, fn) => type === "hashchange" && listeners.push(fn),
    removeEventListener: (type, fn) => {
      if (type !== "hashchange") return;
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
  };
  globalThis.window = win;
  return { win, fire: () => listeners.forEach((fn) => fn()), listeners };
}

describe("sectionFromHash", () => {
  beforeEach(() => fakeWindow());

  test("NOTHING about settings is null, NOT the default section", () => {
    /* ⚠ THE HEADLINE. If this returned "account", every cold load of the
       dashboard would open Settings over the wall. */
    assert.equal(r.sectionFromHash(""), null);
    assert.equal(r.sectionFromHash("#"), null);
    assert.equal(r.sectionFromHash("#towers"), null);
    assert.equal(r.sectionFromHash("#settingsomething"), null);
  });

  test("the bare prefix means Settings with no section named", () => {
    assert.equal(r.sectionFromHash("#settings"), "account");
    assert.equal(r.sectionFromHash("#settings/"), "account");
  });

  test("each section is recognised", () => {
    for (const id of r.SETTINGS_SECTIONS) {
      assert.equal(r.sectionFromHash(`#settings/${id}`), id, id);
    }
  });

  test("case is forgiving, because a URL gets typed", () => {
    assert.equal(r.sectionFromHash("#settings/CAMERAS"), "cameras");
  });

  test("an UNKNOWN section falls back rather than rendering nothing", () => {
    /* A hash is the one piece of app state a person can type. An unknown value
       must not produce an empty right-hand pane. */
    assert.equal(r.sectionFromHash("#settings/nope"), "account");
    assert.equal(r.sectionFromHash("#settings/../etc"), "account");
  });

  test("it reads the live location when given no argument", () => {
    fakeWindow("#settings/appearance");
    assert.equal(r.sectionFromHash(), "appearance");
  });

  test("the sections are the four the screen renders, in order", () => {
    assert.deepEqual([...r.SETTINGS_SECTIONS], [
      "account",
      "security",
      "appearance",
      "cameras",
    ]);
    assert.equal(r.DEFAULT_SECTION, "account");
  });
});

describe("hashForSection", () => {
  test("round-trips every section", () => {
    for (const id of r.SETTINGS_SECTIONS) {
      assert.equal(r.sectionFromHash(r.hashForSection(id)), id, id);
    }
  });

  test("is a real fragment, so it can be an href", () => {
    assert.equal(r.hashForSection("cameras"), "#settings/cameras");
  });
});

describe("writeSection", () => {
  test("replaces rather than pushes, so Back leaves Settings in one press", () => {
    /* Clicking through four sections must not cost four presses of Back to get
       out. The stub only implements replaceState — a pushState would have had
       to be added to make this pass, which is the point. */
    const { win } = fakeWindow("#settings/account");
    r.writeSection("cameras");
    assert.equal(win.location.hash, "#settings/cameras");
  });

  test("writing the section that is already there does nothing", () => {
    const { win } = fakeWindow("#settings/cameras");
    let calls = 0;
    const real = win.history.replaceState;
    win.history.replaceState = (...a) => {
      calls += 1;
      return real.apply(win.history, a);
    };
    r.writeSection("cameras");
    assert.equal(calls, 0);
  });

  test("a refused history write falls back to assigning the hash", () => {
    /* A sandboxed iframe throws on replaceState. Worse, not broken. */
    const { win } = fakeWindow("", { brokenHistory: true });
    assert.doesNotThrow(() => r.writeSection("security"));
    assert.equal(win.location.hash, "#settings/security");
  });
});

describe("clearSection", () => {
  test("a settings hash is removed when the screen closes", () => {
    /* Otherwise the URL still says #settings/cameras while the wall is on
       screen, and a reload bounces the person back into Settings. */
    const { win } = fakeWindow("#settings/cameras");
    r.clearSection();
    assert.equal(win.location.hash, "");
  });

  test("somebody else's hash is left alone", () => {
    const { win } = fakeWindow("#some-anchor");
    r.clearSection();
    assert.equal(win.location.hash, "#some-anchor");
  });

  test("it does not leave a bare '#' in the address bar", () => {
    const { win } = fakeWindow("#settings");
    win.location.pathname = "/";
    win.location.search = "?a=1";
    r.clearSection();
    assert.equal(win.location.hash, "");
  });
});

describe("subscribeToSettingsHash", () => {
  test("fires with the new section on hashchange", () => {
    const { win, fire } = fakeWindow("#settings/account");
    const seen = [];
    const off = r.subscribeToSettingsHash((s) => seen.push(s));
    win.location.hash = "#settings/cameras";
    fire();
    assert.deepEqual(seen, ["cameras"]);
    off();
  });

  test("fires with NULL when the hash stops naming settings", () => {
    /* Back out of Settings. The caller closes the screen on null — leaving it
       open would make the back button look broken. */
    const { win, fire } = fakeWindow("#settings/cameras");
    const seen = [];
    const off = r.subscribeToSettingsHash((s) => seen.push(s));
    win.location.hash = "";
    fire();
    assert.deepEqual(seen, [null]);
    off();
  });

  test("unsubscribing really detaches the listener", () => {
    const { win, fire, listeners } = fakeWindow("#settings/account");
    const seen = [];
    const off = r.subscribeToSettingsHash((s) => seen.push(s));
    assert.equal(listeners.length, 1);
    off();
    assert.equal(listeners.length, 0);
    win.location.hash = "#settings/cameras";
    fire();
    assert.deepEqual(seen, []);
  });
});

describe("no window at all", () => {
  test("every entry point is a no-op rather than a crash", () => {
    /* The shape a server render would hit, and the shape a test importing this
       module before stubbing `window` hits. */
    delete globalThis.window;
    assert.equal(r.sectionFromHash(), null);
    assert.doesNotThrow(() => r.writeSection("cameras"));
    assert.doesNotThrow(() => r.clearSection());
    const off = r.subscribeToSettingsHash(() => {});
    assert.doesNotThrow(off);
  });
});
