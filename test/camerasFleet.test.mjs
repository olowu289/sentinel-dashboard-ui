/**
 * Settings → Cameras at fleet size, the Save-based Patrol control, and the
 * rule that no machine name reaches a person.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE THREE THINGS THAT WENT WRONG
 * ══════════════════════════════════════════════════════════════════════
 *
 *   1. THE SCREEN WAS BUILT FOR THREE TOWERS. Every tower, every camera and
 *      every camera's full detail block, expanded, in one column. On a
 *      hundred towers that is two hundred cards and several thousand words,
 *      with the camera somebody came for in the middle of it.
 *   2. PATROL WROTE ON EVERY PRESS. Choosing "every 12 hours, anticlockwise"
 *      is three presses, so it put two schedules on the camera nobody asked
 *      for -- each one a write to a tower over a radio link.
 *   3. AN ERROR PRINTED A DEVICE ID. "kln_lab_000002 is unavailable" reached
 *      a customer, because it has spaces and no code punctuation and every
 *      test for "does this read like a sentence" passed it.
 *
 *   node --test test/camerasFleet.test.mjs
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
const BASE = "https://coord.example.test";

let said, fleet, auth;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "cameras-fleet-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as said from "@/lib/said";\n`
      + `export * as fleet from "@/lib/api/fleet";\n`
      + `export * as auth from "@/lib/api/auth";\n`,
    "utf8",
  );
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    define: {
      "import.meta.env": JSON.stringify({
        VITE_COORDINATION_URL: BASE,
        VITE_INVENTORY_SOURCE: "sdk",
        VITE_SITE_TZ: "",
      }),
    },
    alias: { "@": SRC, "@kallon/sentry-sdk": join(ROOT, "vendor/sentry-sdk/dist/esm/index.js") },
  });
  ({ said, fleet, auth } = await import(pathToFileURL(out).href));
});

/* ======================================================================
 *  1. NO MACHINE NAME REACHES A PERSON
 * ====================================================================== */

describe("errors name situations, never machines", () => {
  test("⭐ the one that reached a customer", () => {
    /* `TowerUnavailableError` built its message from the id. */
    const err = new fleet.TowerUnavailableError("kln_lab_000002");
    assert.equal(err.message, "That tower is not available.");
    assert.equal(err.deviceId, "kln_lab_000002", "the id is still available to code");
    assert.ok(!said.namesAMachine(err.message));
  });

  test("⭐ a request with no answer says so, and says what to do", () => {
    /* A refused connection, a blocked preflight, a dropped uplink. That is
       the path, not the tower -- and the person's next move is different. */
    assert.equal(
      new fleet.NoAnswerError().message,
      "That change was not saved. Check your connection and try again.",
    );
  });

  test("⭐ every id shape is recognised", () => {
    for (const id of [
      "kln_lab_000002", "kln-lab-000002", "hub_kaduna", "hub-kaduna",
      "acct_admin", "ses_01K3F9", "vwr_dev", "shr_active",
    ]) {
      assert.equal(said.namesAMachine(`${id} is unavailable`), true, id);
    }
  });

  test("⭐ and a sentence carrying one is NOT passed through", () => {
    /* The backstop. It has spaces, it has no code punctuation, and it still
       must not be shown: nobody outside this office can act on a device id,
       and the person who can is not looking at that screen. */
    assert.equal(said.readsLikeASentence("kln_lab_000002 is unavailable"), false);
    const shown = said.said({ message: "kln_lab_000002 is unavailable" }, "That did not save.");
    assert.ok(!shown.includes("kln_lab_000002"), shown);
    assert.match(shown, /^That did not save\./);
  });

  test("ordinary sentences are untouched", () => {
    assert.equal(said.namesAMachine("That tower is not available."), false);
    assert.equal(said.namesAMachine("Check your connection and try again."), false);
    assert.equal(said.readsLikeASentence("The tower did not answer."), true);
    /* A word that merely starts with one of the prefixes is not an id. */
    assert.equal(said.namesAMachine("The hub is offline."), false);
    assert.equal(said.namesAMachine("Session ended."), false);
  });

  test("⭐ no user-visible error string in the source names a machine", async () => {
    /* The whole rule, over every string the app can show, rather than over
       the one that was found. */
    const { userFacingStrings } = await import("./lib/copyScan.mjs");
    const strings = await userFacingStrings(join(ROOT, "src"), { skip: ["screens.tsx"] });
    const hits = strings.filter((s) => said.namesAMachine(s.text));
    assert.deepEqual(
      hits.map((h) => `${h.file}:${h.line} ${h.text}`),
      [],
      "a machine name is in user-facing text",
    );
  });
});

describe("a write that gets no answer", () => {
  beforeEach(() => {
    auth.saveSession({
      ref: "ses_test",
      expiresAt: "2026-10-26T09:00:00Z",
      account: { account_id: "acct_1", login: "terra-industries", role: "owner" },
    });
  });

  test("⭐ a blocked request says the connection sentence, not an id", async () => {
    /* What a refused CORS preflight looks like from here: `fetch` rejects
       with a TypeError and no status at all. */
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const err = await fleet
      .setPatrol("kln_lab_000002", 1, { enabled: true, every: "4h", direction: "clockwise" })
      .then(() => null, (e) => e);
    assert.ok(err, "it resolved");
    assert.equal(err.message, "That change was not saved. Check your connection and try again.");
    assert.ok(!said.namesAMachine(err.message), err.message);
  });

  test("and a rename with no answer says the same thing", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const err = await fleet
      .renameCamera("kln_lab_000002", 1, "GATE")
      .then(() => null, (e) => e);
    assert.equal(err.name, "NoAnswerError");
    assert.ok(!said.namesAMachine(err.message));
  });

  test("a real 404 still says the tower is not available", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), { status: 404,
        headers: { "content-type": "application/json" } });
    const err = await fleet
      .setPatrol("kln_lab_000002", 1, { enabled: true, every: "4h", direction: "clockwise" })
      .then(() => null, (e) => e);
    assert.equal(err.message, "That tower is not available.");
  });
});

/* ======================================================================
 *  2. THE PATROL CONTROL
 * ====================================================================== */

describe("the patrol control sends nothing until Save", () => {
  let control;
  before(async () => {
    control = await readFile(join(SRC, "components/PatrolControl.tsx"), "utf8");
  });

  test("⭐ the switch and the dropdowns only touch the draft", () => {
    /* Three presses used to be three writes to a tower over a radio link,
       and two of the schedules were ones nobody asked for. */
    assert.match(control, /onClick=\{\(\) => setDraft\(/);
    assert.match(control, /onChange=\{\(e\) =>\s*setDraft\(/);
    const beforeSave = control.slice(0, control.indexOf("onSave(draft)"));
    assert.ok(!/onSave\(/.test(beforeSave), "something sends before Save");
  });

  test("⭐ Save is the only thing that writes", () => {
    const calls = control.match(/onSave\(/g) ?? [];
    assert.equal(calls.length, 1, `onSave is called ${calls.length} times`);
  });

  test("⭐ Save is dead when nothing changed", () => {
    assert.match(control, /const changed = !same\(draft, current\)/);
    assert.match(control, /disabled=\{!changed \|\| pending\}/);
  });

  test("⭐ the dropdowns are hidden while patrol is off", () => {
    /* An interval and a direction for a patrol that is not running are two
       settings describing nothing. */
    assert.match(control, /\{draft\.enabled && \(/);
    const gate = control.indexOf("{draft.enabled && (");
    assert.ok(gate > 0 && gate < control.indexOf("<select"), "a dropdown is outside the gate");
  });

  test("⭐ they are <select>s, with exactly the contract's choices", () => {
    assert.match(control, /PATROL_INTERVALS\.map/);
    assert.match(control, /PATROL_DIRECTIONS\.map/);
    assert.equal((control.match(/<select/g) ?? []).length, 2);
  });

  test("⭐ and the draft is reset by the device's answer", () => {
    /* Every refusal changes nothing, by contract, so a failed save puts the
       controls back rather than leaving them on a request that was refused. */
    /* ⚠ TWO EFFECTS NOW, NOT ONE. The ordinary reset is skipped while a
       save is in flight -- a refresh landing then carries the OLD patrol and
       would take the operator's choice off the screen under "Saving..." --
       so a refusal needs its own, because a refused value has not CHANGED
       and the ordinary effect would never fire for it. */
    assert.match(control, /if \(pending\) return;/);
    assert.match(control, /if \(!failed\) return;/);
    assert.match(control, /patrol\.enabled, patrol\.every, patrol\.direction/);
  });

  test("the line beside Save says Patrolling now, or the next time", () => {
    assert.match(control, /Patrolling now/);
    assert.match(control, /Next patrol: \{formatConnectedSince\(at, now\)\}/);
    /* An unsaved change makes the device's own state not what the controls
       say, so neither is claimed. */
    assert.match(control, /if \(phase\.kind === "pending" \|\| changed\) return null;/);
  });

  test("one component, every place patrol is set", async () => {
    const panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    const settings = await readFile(join(SRC, "components/SettingsView.tsx"), "utf8");
    assert.match(panel, /<PatrolControl/);
    assert.match(settings, /<PatrolControl/);
    for (const [name, src] of [["panel", panel], ["settings", settings]]) {
      assert.ok(!/<select[\s\S]{0,400}PATROL_/.test(src), `${name} rolled its own`);
    }
  });
});

/* ======================================================================
 *  3. THE SCREEN AT FLEET SIZE
 * ====================================================================== */

describe("Settings → Cameras, for a hundred towers", () => {
  let view;
  before(async () => {
    view = await readFile(join(SRC, "components/SettingsView.tsx"), "utf8");
  });

  test("⭐ there is a search box, and it filters towers AND cameras", () => {
    assert.match(view, /placeholder="Search towers and cameras"/);
    assert.match(view, /\(tower\.site \|\| tower\.id\)\.toLowerCase\(\)\.includes\(q\)/);
    assert.match(view, /\(f\.name \?\? ""\)\.toLowerCase\(\)\.includes\(q\)/);
  });

  test("⭐ a tower matched by one camera lists only that camera", () => {
    /* Searching "gate" should not make you open North Gate and read past its
       other camera to find the one called GATE. */
    assert.match(view, /if \(named\) out\.push\(\{ tower, cameras: mine \}\);/);
    assert.match(view, /else if \(hits\.length > 0\) out\.push\(\{ tower, cameras: hits \}\);/);
  });

  test("⭐ towers are collapsed by default: one open at a time, none at first", () => {
    assert.match(view, /const \[camOpenTower, setCamOpenTower\] = useState<string \| null>\(null\)/);
    assert.match(view, /setCamOpenTower\(open \? null : tower\.id\)/);
  });

  test("⭐ the summary line counts cameras and patrols", () => {
    assert.match(view, /cameras\.filter\(\(f\) => f\.patrol\?\.enabled\)\.length/);
    assert.match(view, /cameras\.length === 1 \? "1 camera" : `\$\{cameras\.length\} cameras`/);
    assert.match(view, /\{patrolling\} patrolling/);
  });

  test("⭐ an offline tower says Offline, and no camera count", () => {
    /* Its list is whatever it last sent; counting that as fact would describe
       a site nobody can currently see. */
    assert.match(view, /tower\.online === false \? \(/);
    const branch = view.slice(view.indexOf("tower.online === false ? ("));
    assert.match(branch.slice(0, 200), /Offline/);
  });

  test("⭐ a camera line carries name, status and the patrol value", () => {
    assert.match(view, /\{patrolWord\(feed\.patrol\)\}/);
    assert.match(view, /feed\.state === "live"\s*\? "Online"/);
  });

  test("⭐ clicking a camera opens a panel for THAT camera", () => {
    assert.match(view, /onClick=\{\(\) => setCamOpen\(feed\.id\)\}/);
    assert.match(view, /feeds\.find\(\(f\) => f\.id === camOpen\)/);
    assert.match(view, /<CameraPanel/);
  });

  test("⭐ and the panel carries Rename and Patrol, and nothing else", () => {
    /* The old card repeated four readings from the line you clicked to get
       here, plus a Model row nothing has ever reported. */
    const from = view.indexOf("function CameraPanel");
    const panel = view.slice(from);
    assert.match(panel, /Save name/);
    assert.match(panel, /<PatrolControl/);
    assert.ok(!/Resolution/.test(panel), "the panel repeats the resolution");
    assert.ok(!/Not reported/.test(panel), "the panel still has a Model row");
  });

  test("the list no longer renders every camera's detail block", () => {
    assert.ok(!/function Detail/.test(view), "the five-reading block is back");
  });
});
