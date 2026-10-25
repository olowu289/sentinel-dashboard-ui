/**
 * One source for a saved setting, and no flicker back to the old one.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON SCREEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * Saving a patrol showed "2 hours", then "1 hour" again, then "2 hours" a few
 * seconds later. Nothing was wrong with the save: the PUT answered 200 with
 * the new value and the screen drew it. What put the old one back was the
 * FLEET REFRESH -- a `listFleet` already in flight, or one that ran against a
 * read model which had not caught up -- carrying the old patrol and replacing
 * every feed wholesale.
 *
 * So the screen was right, wrong, and right again, and an operator watching a
 * patrol revert has no way to know which of the two numbers is real. The same
 * refresh is also why a change saved in one place did not appear in the other:
 * both read the same feeds, and the refresh overwrote them for both.
 *
 * ⚠ THE HOLD IS CLEARED BY AGREEMENT, NOT BY TIME. Expiry is the backstop
 * for a claim that has stopped being credible, not the mechanism -- the
 * common case holds for one poll, not for two minutes.
 *
 *   node --test test/heldWrites.test.mjs
 */
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, beforeEach, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let H;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "held-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/heldWrites";\n`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC, "@kallon/sentry-sdk": join(ROOT, "vendor/sentry-sdk/dist/esm/index.js") },
  });
  H = await import(pathToFileURL(out).href);
});

const patrol = (every, over = {}) => ({
  enabled: true,
  every,
  direction: "clockwise",
  nextAt: "2026-10-25T14:40:00Z",
  running: false,
  ...over,
});

/** A fleet's feeds, as `listFleet` hands them over. */
const feeds = (every) => [
  { id: "kln_lab_000001:1", towerId: "kln_lab_000001", name: "GATE", patrol: patrol(every) },
  { id: "kln_lab_000001:2", towerId: "kln_lab_000001", name: "YARD" },
];

/** The funnel `App.tsx` runs every server answer through, in miniature. */
const through = (held, list, now) =>
  held.apply(
    list,
    "camera",
    "patrol",
    (f) => f.id,
    (f) => f.patrol,
    (f, v) => ({ ...f, patrol: v }),
    now,
  );

let held;
beforeEach(() => {
  held = new H.HeldWrites();
});

/* ======================================================================
 *  THE FLICKER
 * ====================================================================== */

describe("a confirmed value outranks a stale refresh", () => {
  test("⭐ a stale refresh does NOT change what is shown", () => {
    /* THE BUG. The PUT answered 2h; this refresh still carries 1h. */
    held.confirm(H.holdKey("camera", "kln_lab_000001:1", "patrol"), patrol("2h"));
    const shown = through(held, feeds("1h"));
    assert.equal(shown[0].patrol.every, "2h", "the old value came back");
  });

  test("⭐ and nothing else about the fleet is held back", () => {
    /* Narrow on purpose: freezing the fleet view to steady one row would be
       the worse trade. The other camera, and every other field, pass. */
    held.confirm(H.holdKey("camera", "kln_lab_000001:1", "patrol"), patrol("2h"));
    const fresh = feeds("1h").map((f) => ({ ...f, state: "offline" }));
    const shown = through(held, fresh);
    assert.equal(shown[0].state, "offline", "an unrelated field was held");
    assert.equal(shown[1].patrol, undefined, "a camera with no hold was touched");
  });

  test("⭐ a refresh that AGREES clears the hold", () => {
    const key = H.holdKey("camera", "kln_lab_000001:1", "patrol");
    held.confirm(key, patrol("2h"));
    assert.equal(held.size, 1);
    const shown = through(held, feeds("2h"));
    assert.equal(shown[0].patrol.every, "2h");
    assert.equal(held.size, 0, "the hold outlived its job");
  });

  test("agreement is by VALUE, because a patrol block is rebuilt on every parse", () => {
    /* The object the server sends is never the object that was held: both
       are freshly parsed. Comparing by identity would hold for two minutes
       every time. */
    const key = H.holdKey("camera", "kln_lab_000001:1", "patrol");
    held.confirm(key, patrol("2h"));
    through(held, feeds("2h"));
    assert.equal(held.size, 0);
  });

  test("⭐ after two minutes without agreement, the server wins", () => {
    /* The claim has stopped being credible: another operator, the device
       itself or a rollback may have changed it since. */
    const key = H.holdKey("camera", "kln_lab_000001:1", "patrol");
    const t0 = 1_000_000;
    held.confirm(key, patrol("2h"), t0);
    assert.equal(through(held, feeds("1h"), t0 + H.HOLD_MS - 1)[0].patrol.every, "2h");
    assert.equal(through(held, feeds("1h"), t0 + H.HOLD_MS)[0].patrol.every, "1h");
    assert.equal(held.size, 0);
  });

  test("the window is two minutes", () => {
    assert.equal(H.HOLD_MS, 120_000);
  });

  test("⭐ a refusal releases the hold, so the last confirmed value stands", () => {
    const key = H.holdKey("camera", "kln_lab_000001:1", "patrol");
    held.confirm(key, patrol("2h"));
    held.release(key);
    assert.equal(through(held, feeds("1h"))[0].patrol.every, "1h");
    assert.equal(held.size, 0);
  });
});

/* ======================================================================
 *  PER OBJECT AND PER FIELD
 * ====================================================================== */

describe("holds do not reach past the thing that was saved", () => {
  test("⭐ one camera's patrol is not another's", () => {
    held.confirm(H.holdKey("camera", "kln_lab_000001:1", "patrol"), patrol("2h"));
    const list = [
      { id: "kln_lab_000001:1", patrol: patrol("1h") },
      { id: "kln_lab_000001:2", patrol: patrol("1h") },
    ];
    const shown = through(held, list);
    assert.equal(shown[0].patrol.every, "2h");
    assert.equal(shown[1].patrol.every, "1h", "a sibling camera was held");
  });

  test("⭐ a camera's patrol and its NAME are separate holds", () => {
    /* Two people changing two different things about one camera must not
       overwrite each other, and a refresh agreeing about one must not clear
       the other. */
    const id = "kln_lab_000001:1";
    held.confirm(H.holdKey("camera", id, "patrol"), patrol("2h"));
    held.confirm(H.holdKey("camera", id, "label"), "FRONT GATE");
    assert.equal(held.size, 2);
    /* The server catches up on the name only. */
    held.apply(
      [{ id, label: "FRONT GATE", patrol: patrol("1h") }],
      "camera",
      "label",
      (f) => f.id,
      (f) => f.label,
      (f, v) => ({ ...f, label: v }),
    );
    assert.equal(held.size, 1, "the patrol hold went with the name's");
    assert.equal(through(held, [{ id, patrol: patrol("1h") }])[0].patrol.every, "2h");
  });

  test("a tower's name is held the same way", () => {
    held.confirm(H.holdKey("tower", "kln_lab_000001", "site"), "LAB TOWER ONE");
    const shown = held.apply(
      [{ id: "kln_lab_000001", site: "LAB TOWER 1" }],
      "tower",
      "site",
      (t) => t.id,
      (t) => t.site,
      (t, v) => ({ ...t, site: v }),
    );
    assert.equal(shown[0].site, "LAB TOWER ONE");
  });

  test("with no holds at all, the server's list is returned untouched", () => {
    const list = feeds("1h");
    assert.equal(through(held, list), list, "a copy was made for nothing");
  });
});

/* ======================================================================
 *  ONE SOURCE, EVERY SCREEN
 * ====================================================================== */

describe("every screen reads the same patrol", () => {
  let app, settings, panel, control;
  before(async () => {
    app = await readFile(join(SRC, "App.tsx"), "utf8");
    settings = await readFile(join(SRC, "components/SettingsView.tsx"), "utf8");
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    control = await readFile(join(SRC, "components/PatrolControl.tsx"), "utf8");
  });

  test("⭐ the side panel and tower settings are given the SAME feeds", () => {
    /* Which is why a save in one appears in the other at once: there is one
       array, in the shell, and both screens are views of it. */
    assert.match(app, /<SettingsView[\s\S]{0,400}feeds=\{feeds\}/);
    assert.match(app, /<TowerView[\s\S]{0,600}feeds=\{feedsForTower\(feeds, open\.id\)\}/);
  });

  test("⭐ and the tower summary counts the same feeds", () => {
    /* "· N patrolling" is derived, not stored, so it cannot disagree with the
       camera lines under it. */
    assert.match(settings, /cameras\.filter\(\(f\) => f\.patrol\?\.enabled\)\.length/);
  });

  test("⭐ every server read goes through one funnel", async () => {
    /* FOUR places read the fleet, and every one of them used to call
       `setFeeds(snapshot.feeds)` directly -- four chances to overwrite a
       value somebody had just saved. */
    /* Over the code, not the prose: the comment at the funnel names the call
       it replaced and says why, which is the explanation a raw search would
       delete. */
    const { stripComments } = await import("./lib/copyScan.mjs");
    const code = stripComments(app);
    const direct = code.match(/setFeeds\(snapshot\.feeds\)/g) ?? [];
    assert.deepEqual(direct, [], "a server read bypasses the hold");
    const funnelled = code.match(/takeSnapshot\(snapshot\)/g) ?? [];
    assert.ok(funnelled.length >= 4, `only ${funnelled.length} reads are funnelled`);
  });

  test("⭐ the save confirms before it draws, and releases on a refusal", () => {
    assert.match(app, /held\.current\.confirm\(holdKey\("camera", feedId, "patrol"\), patrol\)/);
    assert.match(app, /held\.current\.release\(holdKey\("camera", feedId, "patrol"\)\)/);
  });

  test("the renames are held too", () => {
    assert.match(app, /holdKey\("camera", f\.id, "label"\)/);
    assert.match(app, /holdKey\("tower", towerId, "site"\)/);
  });

  test("⭐ the control does not reset its draft mid-save", () => {
    /* A refresh landing during a save carries the OLD patrol, and the reset
       would take the operator's choice off the screen under a "Saving…"
       label. */
    assert.match(control, /if \(pending\) return;\s*\n\s*setDraft\(/);
  });

  test("⭐ and DOES reset it on a refusal", () => {
    /* Nothing was changed, by contract, so the last confirmed values are what
       `patrol` already holds -- but they have not CHANGED, so the ordinary
       effect would never fire for them. */
    assert.match(control, /const failed = phase\.kind === "failed";/);
    assert.match(control, /if \(!failed\) return;\s*\n\s*setDraft\(/);
  });

  test("one component draws it in all three places", () => {
    assert.match(panel, /<PatrolControl/);
    assert.match(settings, /<PatrolControl/);
  });
});
