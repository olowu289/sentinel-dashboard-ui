/**
 * The feature gate and the theme switch.
 *
 * WHAT THESE GUARD. This app ships screens nothing is behind — its own source
 * says the alert feed is six fixture alerts on every account and that "nothing
 * here is a detection anything saw". The gate is what keeps those off a paying
 * customer's screen, so the tests that matter are:
 *
 *   · the FALLBACK is restrictive — a missing list must never be the thing that
 *     shows a customer the demo;
 *   · an EMPTY list is honoured, so a deliberately stripped account is not
 *     confused with an old server;
 *   · the rail and the router agree, because either alone is a bug.
 *
 * And for the theme, the one that is easy to get backwards: dark sets NO
 * attribute, so `data-theme` present means light and absent means default.
 *
 * Built with esbuild, like `account.test.mjs`, so these run THE SHIPPED SOURCE
 * rather than a transcription of it.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let mod;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "features-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as f from "@/lib/features";
     export * as theme from "@/lib/theme";`,
    "utf8",
  );
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
  mod = await import(pathToFileURL(out).href);
});

/* ================================================================== *
 * THE FALLBACK — the one that decides whether a customer sees the demo
 * ================================================================== */

describe("featureSet", () => {
  const acct = (features) => ({
    account_id: "acct_A",
    login: "kaduna-mine",
    role: "owner",
    status: "active",
    ...(features === undefined ? {} : { features }),
  });

  test("NO list falls back to the five real features, never everything", () => {
    /* ⚠ THE HEADLINE. An older coordination, a failed fetch, or a session
       stored before this shipped sends no list. If that fell back to "all",
       the first customer on a stale session would see six invented alerts. */
    const set = mod.f.featureSet(acct(undefined));
    assert.deepEqual([...set].sort(), [...mod.f.DEFAULT_FEATURES].sort());
    for (const demo of ["alerts", "watchlist", "siren", "simulator", "clip_export"]) {
      assert.equal(set.has(demo), false, demo);
    }
  });

  test("a null account is restrictive too", () => {
    assert.deepEqual(
      [...mod.f.featureSet(null)].sort(),
      [...mod.f.DEFAULT_FEATURES].sort(),
    );
  });

  test("a malformed list is treated as no list", () => {
    for (const junk of ["alerts", 42, {}, true]) {
      const set = mod.f.featureSet(acct(junk));
      assert.equal(set.has("alerts"), false, String(junk));
      assert.equal(set.has("live"), true, String(junk));
    }
  });

  test("an EMPTY list is a real answer and is honoured", () => {
    /* Distinct from "told nothing". A deliberately stripped account must not be
       handed the defaults back, or there would be no way to express it. */
    const set = mod.f.featureSet(acct([]));
    assert.equal(set.size, 0);
  });

  test("unknown names are dropped rather than carried", () => {
    /* A server newer than this bundle. Carrying the name through would ask the
       UI to render something it has no code for. */
    const set = mod.f.featureSet(acct(["live", "telepathy", "alerts"]));
    assert.deepEqual([...set].sort(), ["alerts", "live"]);
  });

  test("the defaults are exactly the five that are backed", () => {
    assert.deepEqual([...mod.f.DEFAULT_FEATURES].sort(), [
      "live",
      "playback",
      "ptz",
      "settings",
      "towers",
    ]);
  });

  test("every default is a known feature", () => {
    for (const f of mod.f.DEFAULT_FEATURES) {
      assert.ok(mod.f.FEATURES.includes(f), f);
    }
  });

  test("the catalogue covers every gated nav destination", () => {
    /* A NAV_FEATURE naming something `FEATURES` does not have would gate a
       destination on a feature the server can never send, hiding it forever. */
    for (const [id, feature] of Object.entries(mod.f.NAV_FEATURE)) {
      assert.ok(mod.f.FEATURES.includes(feature), `${id} -> ${feature}`);
    }
  });
});

/* ================================================================== *
 * THE RAIL AND THE ROUTER READ THE SAME FUNCTION
 * ================================================================== */

describe("navAllowed", () => {
  test("the customer set opens exactly the five real destinations", () => {
    const set = new Set(["live", "playback", "ptz", "towers", "settings"]);
    assert.equal(mod.f.navAllowed(set, "dashboard"), true);  // needs `live`
    assert.equal(mod.f.navAllowed(set, "towers"), true);
    assert.equal(mod.f.navAllowed(set, "playback"), true);
    assert.equal(mod.f.navAllowed(set, "settings"), true);
    /* And refuses the demo ones. */
    assert.equal(mod.f.navAllowed(set, "alerts"), false);
    assert.equal(mod.f.navAllowed(set, "poi"), false);
    assert.equal(mod.f.navAllowed(set, "add"), false);
  });

  test("an account with everything opens everything", () => {
    const all = new Set(mod.f.FEATURES);
    for (const id of Object.keys(mod.f.NAV_FEATURE)) {
      assert.equal(mod.f.navAllowed(all, id), true, id);
    }
  });

  test("an UNMAPPED destination is allowed, not silently hidden", () => {
    /* The map lists what CAN be restricted, not everything that exists —
       otherwise adding a rail item would make it unreachable by default and the
       next person would hunt for the bug in the rail. */
    assert.equal(mod.f.navAllowed(new Set(), "some-future-screen"), true);
  });

  test("an empty set still refuses every mapped destination", () => {
    for (const id of Object.keys(mod.f.NAV_FEATURE)) {
      assert.equal(mod.f.navAllowed(new Set(), id), false, id);
    }
  });

  test("`can` is a plain membership test", () => {
    assert.equal(mod.f.can(new Set(["alerts"]), "alerts"), true);
    assert.equal(mod.f.can(new Set(["alerts"]), "siren"), false);
  });
});

/* ================================================================== *
 * THE THEME
 * ================================================================== */

describe("theme", () => {
  /** A document stub: just the attribute surface `applyTheme` touches. */
  function fakeDom() {
    const attrs = new Map();
    const style = {};
    globalThis.document = {
      documentElement: {
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        style,
      },
    };
    return { attrs, style };
  }

  /** A localStorage stub that can also be made to throw. */
  function fakeStorage({ broken = false } = {}) {
    const map = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => {
          if (broken) throw new Error("blocked");
          return map.has(k) ? map.get(k) : null;
        },
        setItem: (k, v) => {
          if (broken) throw new Error("blocked");
          map.set(k, v);
        },
        removeItem: (k) => map.delete(k),
      },
    };
    return map;
  }

  test("dark is the default, and sets NO attribute", () => {
    /* ⚠ EASY TO GET BACKWARDS. Dark is the `@theme` block's own values, so the
       way back to it is REMOVING the attribute — not a second palette. A test
       that asserted `data-theme="dark"` would pass against a CSS file with no
       dark rules at all. */
    const { attrs, style } = fakeDom();
    fakeStorage();
    assert.equal(mod.theme.getTheme(), "dark");
    mod.theme.applyTheme("dark");
    assert.equal(attrs.has("data-theme"), false);
    assert.equal(style.colorScheme, "dark");
  });

  test("light sets the attribute the CSS keys off", () => {
    const { attrs, style } = fakeDom();
    fakeStorage();
    mod.theme.applyTheme("light");
    assert.equal(attrs.get("data-theme"), "light");
    assert.equal(style.colorScheme, "light");
  });

  test("setTheme stores, applies and notifies", () => {
    const { attrs } = fakeDom();
    const store = fakeStorage();
    const seen = [];
    const off = mod.theme.subscribeToTheme((t) => seen.push(t));
    mod.theme.setTheme("light");
    assert.equal(attrs.get("data-theme"), "light");
    assert.equal(store.get("sentinel.theme.v1"), "light");
    assert.deepEqual(seen, ["light"]);
    off();
    mod.theme.setTheme("dark");
    assert.deepEqual(seen, ["light"], "unsubscribed listeners stop hearing");
  });

  test("the choice survives a reload", () => {
    const store = fakeStorage();
    store.set("sentinel.theme.v1", "light");
    assert.equal(mod.theme.getTheme(), "light");
    const { attrs } = fakeDom();
    assert.equal(mod.theme.applyStoredTheme(), "light");
    assert.equal(attrs.get("data-theme"), "light");
  });

  test("a junk stored value falls back to dark, not to a half-themed page", () => {
    /* Anything in that key that is not one of the two — an older build, or
       something typed into devtools — must not reach the DOM as an attribute
       that matches no CSS. */
    const store = fakeStorage();
    for (const junk of ["blue", "", "DARK", "null"]) {
      store.set("sentinel.theme.v1", junk);
      assert.equal(mod.theme.getTheme(), "dark", junk);
    }
  });

  test("blocked storage still themes the page, and never throws", () => {
    /* Private mode, or a locked-down browser. Only the REMEMBERING is lost;
       failing the whole action over that would be worse. */
    const { attrs } = fakeDom();
    fakeStorage({ broken: true });
    assert.equal(mod.theme.getTheme(), "dark");
    mod.theme.setTheme("light");
    assert.equal(attrs.get("data-theme"), "light");
  });

  test("no document at all is a no-op rather than a crash", () => {
    /* `applyStoredTheme` runs as the first statement in main.tsx, and this is
       also the shape a server render would hit. */
    delete globalThis.document;
    fakeStorage();
    assert.doesNotThrow(() => mod.theme.applyTheme("light"));
  });
});

/* ================================================================== *
 * TOWER SETTINGS, AND WHO MAY OPEN THEM
 * ================================================================== */

describe("an operator can open tower settings", () => {
  /**
   * ══════════════════════════════════════════════════════════════════
   *  WHAT WAS WRONG
   * ══════════════════════════════════════════════════════════════════
   *
   * The gear on a tower was gated on `camera_tuning` -- a feature that is OFF
   * for everybody by default, because detection zones and sensitivity are
   * local state with nothing behind them. The effect was not "a demo control
   * is hidden": it was that nobody at a site could open tower settings at all,
   * so the tower's NAME, its stream quality and its home position -- all real,
   * all theirs -- were unreachable by the person standing at the mast.
   *
   * The panel opens on `settings`, which is in the real set. `camera_tuning`
   * now gates the one group it is about.
   *
   * Read as SOURCE: what is asserted is which gate wraps which rows, and a
   * render test can only show what is there.
   */
  let tower;
  let panel;
  before(async () => {
    const { readFile } = await import("node:fs/promises");
    tower = await readFile(join(ROOT, "src/components/TowerView.tsx"), "utf8");
    panel = await readFile(
      join(ROOT, "src/components/CameraSettingsPanel.tsx"), "utf8");
  });

  test("the five real features include settings and not tuning", () => {
    /* The operator's set, as a server that says nothing sends it. */
    const set = mod.f.featureSet(null);
    assert.equal(mod.f.can(set, "settings"), true);
    assert.equal(mod.f.can(set, "camera_tuning"), false);
  });

  test("so the gear opens on `settings`", () => {
    assert.match(tower, /const canSettings = can\(features, "settings"\)/);
    assert.match(tower, /onOpenSettings=\{canSettings \? onToggleSettings : undefined\}/);
    assert.match(tower, /settingsOpen=\{canSettings && settingsOpen\}/);
    assert.doesNotMatch(tower, /onOpenSettings=\{canTune/);
  });

  test("and the panel is told, separately, whether tuning is allowed", () => {
    assert.match(tower, /canTune=\{canTune\}/);
    assert.match(panel, /canTune = false,/, "the default must be restrictive");
  });

  test("DETECTION is the only group behind camera_tuning", () => {
    const open = panel.indexOf("{canTune ? (");
    assert.ok(open > 0, "the tuning gate is gone");
    const close = panel.indexOf(") : null}", open);
    assert.ok(close > open, "the tuning gate never closes");
    const gated = panel.slice(open, close);
    assert.match(gated, /<Group title="Detection">/);
    assert.match(gated, /Activity Zones/);
    assert.match(gated, /Sensitivity/);

    /* ⚠ AND THE REAL ROWS ARE OUTSIDE IT. This is the assertion that would
       have caught the original bug: every one of these belongs to whoever
       works at that site, and none of them is fabricated. */
    for (const real of [
      "<Group title=\"Camera\">",
      /* The labels these rows carry now. "Stream Quality" named our pipeline
         and "Home Position" was title case for no reason; both were rewritten
         by the copy pass, and this list is what keeps them OUT of the tuning
         block rather than a record of their old names. */
      "Picture quality",
      "Home position",
      "<Group title=\"Storage\">",
      "<Group title=\"About Device\">",
    ]) {
      const at = panel.indexOf(real);
      assert.ok(at > 0, `${real} is gone`);
      assert.ok(
        at < open || at > close,
        `${real} is behind camera_tuning, which is off for an operator`,
      );
    }
  });

  test("and a gear that cannot open is not drawn", async () => {
    /* ⚠ THE OTHER HALF OF THE SAME BUG. The button was rendered whatever
       `onOpenSettings` was, so an operator pressed a gear and nothing
       happened -- which is indistinguishable from a broken app. */
    const { readFile } = await import("node:fs/promises");
    const bar = await readFile(join(ROOT, "src/components/TopBar.tsx"), "utf8");
    const at = bar.indexOf("{onOpenSettings ? (");
    assert.ok(at > 0, "the gear is drawn unconditionally again");
    const gear = bar.indexOf('title="Tower settings"');
    assert.ok(gear > at, "the gear is outside the condition");
  });

  test("the tower's own name is not behind it either", () => {
    const open = panel.indexOf("{canTune ? (");
    const close = panel.indexOf(") : null}", open);
    const at = panel.indexOf("<TowerName");
    assert.ok(at > 0 && (at < open || at > close));
  });
});
