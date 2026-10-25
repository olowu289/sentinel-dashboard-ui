/**
 * Patrol: a movable camera sweeping its round on a timer.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THESE ARE ACTUALLY GUARDING
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three things, and only the first is about patrol:
 *
 *   1. THE CONTRACT, EXACTLY. Seven intervals, three directions, three
 *      fields on the write and five on the read. A client that sends a
 *      fourth field or accepts an eighth interval is a client the server will
 *      refuse in a way nobody can read from the screen.
 *   2. ABSENT IS NOT "OFF". A fixed camera carries no patrol block, and
 *      defaulting one would give a dome that cannot turn a switch offering to
 *      send it round. The whole fixed-camera case rests on `undefined`
 *      surviving the mapper.
 *   3. ONE COMPONENT, TWO SCREENS. The tower panel and Settings → Cameras
 *      are two routes to one setting; two renderings is the arrangement where
 *      one of them eventually offers an interval the other does not.
 *
 *   node --test test/patrol.test.mjs
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

let p, map, fleet, time, auditing, auth;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "patrol-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as p from "@/lib/patrol";\n`
      + `export * as map from "@/lib/api/map";\n`
      + `export * as fleet from "@/lib/api/fleet";\n`
      + `export * as time from "@/lib/time";\n`
      + `export * as auditing from "@/lib/auditSentence";\n`
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
  const mod = await import(pathToFileURL(out).href);
  ({ p, map, fleet, time, auditing, auth } = mod);
  time.setSiteTz("Africa/Lagos");
});

/** A patrol block as the contract spells it. */
const block = (over = {}) => ({
  enabled: true,
  every: "4h",
  direction: "clockwise",
  next_at: "2026-10-25T14:40:00Z",
  running: false,
  ...over,
});

/* ======================================================================
 *  1. THE ROW VALUE
 * ====================================================================== */

describe("what the collapsed Patrol row says", () => {
  const of = (over) => p.parsePatrol(block(over));

  test("⭐ off", () => {
    assert.equal(p.patrolWord(of({ enabled: false })), "Off");
  });

  test("⭐ every interval, in words", () => {
    assert.deepEqual(
      ["1h", "2h", "4h", "6h", "12h", "24h"].map((every) => p.patrolWord(of({ every }))),
      ["Every hour", "Every 2 hours", "Every 4 hours", "Every 6 hours",
       "Every 12 hours", "Every 24 hours"],
    );
  });

  test("⭐ \"Every 1 hour\" is not English, so it is not said", () => {
    assert.equal(p.patrolWord(of({ every: "1h" })), "Every hour");
  });

  test("⭐ random", () => {
    assert.equal(p.patrolWord(of({ every: "random" })), "Random");
  });

  test("a camera with no patrol at all says Off, if ever asked", () => {
    assert.equal(p.patrolWord(undefined), "Off");
  });

  test("two cameras that agree speak as one, two that disagree count", () => {
    const on = of({});
    const off = of({ enabled: false });
    assert.equal(p.patrolSummary([on, on]), "Every 4 hours");
    assert.equal(p.patrolSummary([off, off]), "Off");
    assert.equal(p.patrolSummary([on, off]), "1 camera on");
    assert.equal(p.patrolSummary([on, of({ every: "2h" })]), "2 cameras on");
    assert.equal(p.patrolSummary([]), "");
  });
});

/* ======================================================================
 *  2. THE CONTRACT, READ
 * ====================================================================== */

describe("reading the device record", () => {
  test("⭐ exactly the seven intervals and the three directions", () => {
    assert.deepEqual([...p.PATROL_INTERVALS],
      ["1h", "2h", "4h", "6h", "12h", "24h", "random"]);
    assert.deepEqual([...p.PATROL_DIRECTIONS],
      ["clockwise", "anticlockwise", "random"]);
  });

  test("⭐ every field crosses", () => {
    const got = p.parsePatrol(block({ running: true }));
    assert.deepEqual(got, {
      enabled: true,
      every: "4h",
      direction: "clockwise",
      nextAt: "2026-10-25T14:40:00Z",
      running: true,
    });
  });

  test("⭐ a FIXED camera's absent block stays absent", () => {
    /* The whole fixed-camera case rests on this. A default would give a dome
       that cannot turn a switch offering to send it round. */
    assert.equal(p.parsePatrol(undefined), undefined);
    assert.equal(p.parsePatrol(null), undefined);
    assert.equal(p.parsePatrol("patrol"), undefined);
  });

  test("and it survives the mapper, on the camera that has one", () => {
    const { feeds } = map.toTower({
      device_id: "kln_lab_000001",
      label: "LAB TOWER 1",
      link: "up",
      as_of: "2026-10-25T09:00:00Z",
      sensors: [],
      cameras: [
        { index: 1, name: "GATE", state: "live", ptz_capable: true, patrol: block() },
        { index: 2, name: "YARD", state: "live", ptz_capable: false },
      ],
    });
    assert.equal(feeds[0].patrol.every, "4h");
    assert.equal(feeds[1].patrol, undefined, "a fixed camera gained a patrol");
  });

  test("an interval nobody here knows keeps the block rather than dropping it", () => {
    /* A camera that IS patrolling should keep its row even against a server
       that has grown an eighth interval. */
    const got = p.parsePatrol(block({ every: "36h", direction: "widdershins" }));
    assert.equal(got.enabled, true);
    assert.equal(got.every, "4h");
    assert.equal(got.direction, "clockwise");
  });

  test("a null next_at is null, not the string", () => {
    assert.equal(p.parsePatrol(block({ next_at: null })).nextAt, null);
    assert.equal(p.parsePatrol(block({ next_at: "" })).nextAt, null);
  });
});

/* ======================================================================
 *  3. THE CONTRACT, WRITTEN
 * ====================================================================== */

describe("saving a change", () => {
  let sent;
  const answer = (status, body) => {
    globalThis.fetch = async (url, init) => {
      sent = { url: String(url), method: init?.method, body: JSON.parse(init?.body ?? "{}") };
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    };
  };

  beforeEach(() => {
    sent = null;
    /* `setPatrol` sends a bearer and refuses without one, exactly as it
       should. The store is module state, so one save is enough. */
    auth.saveSession({
      ref: "ses_test",
      expiresAt: "2026-10-26T09:00:00Z",
      account: { account_id: "acct_1", login: "terra-industries", role: "owner" },
    });
  });

  const save = (edit) =>
    fleet.setPatrol("kln_lab_000001", 1, edit).then((v) => ({ ok: v }), (e) => ({ err: e }));

  test("⭐ PUT to the contract's path, with the three fields and no others", async () => {
    answer(200, block({ every: "6h" }));
    const out = await save({ enabled: true, every: "6h", direction: "anticlockwise" });
    assert.ok(out.ok, `threw: ${out.err}`);
    assert.equal(sent.method, "PUT");
    assert.match(sent.url, /\/v1\/viewer\/towers\/kln_lab_000001\/cameras\/1\/patrol$/);
    /* ⚠ NOT `next_at` AND NOT `running`: those are the device's to report,
       and sending them invites a server to believe one. */
    assert.deepEqual(sent.body, {
      enabled: true,
      every: "6h",
      direction: "anticlockwise",
    });
  });

  test("⭐ and the DEVICE's answer is what comes back, not the request", async () => {
    /* The 200 carries a `next_at` only the device can compute. */
    answer(200, block({ every: "6h", next_at: "2026-10-25T20:00:00Z" }));
    const out = await save({ enabled: true, every: "6h", direction: "clockwise" });
    assert.equal(out.ok.every, "6h");
    assert.equal(out.ok.nextAt, "2026-10-25T20:00:00Z");
  });

  test("the answer is read whether it is bare or under `patrol`", async () => {
    answer(200, { patrol: block({ every: "12h" }) });
    const out = await save({ enabled: true, every: "12h", direction: "clockwise" });
    assert.equal(out.ok.every, "12h");
  });

  test("⭐ each refusal is one plain sentence", async () => {
    for (const [status, code, text] of [
      [403, "patrol_forbidden", "You cannot change patrol on this camera."],
      [409, "camera_not_movable", "This camera cannot move, so it cannot patrol."],
      [422, "patrol_invalid", "That patrol setting was not accepted. Choose another."],
      [503, "tower_offline", "This tower is offline. Try again when it is back."],
    ]) {
      answer(status, { error: { code } });
      const out = await save({ enabled: true, every: "4h", direction: "clockwise" });
      assert.ok(out.err, `${code} resolved`);
      assert.equal(out.err.message, text, code);
      assert.equal(out.err.code, code);
      /* One sentence, and nothing a customer cannot act on. */
      assert.ok(!out.err.message.includes("—"), `${code} has an em-dash`);
      assert.ok(out.err.message.length < 70, `${code} is long`);
    }
  });

  test("⭐ and the SERVER's own sentence wins where it sends one", async () => {
    answer(403, { error: { code: "patrol_forbidden", message: "North Gate is not yours." } });
    const out = await save({ enabled: true, every: "4h", direction: "clockwise" });
    assert.equal(out.err.message, "North Gate is not yours.");
  });

  test("a refusal with no code at all still says something plain", () => {
    assert.equal(p.patrolRefusal(null, null), "That change was not saved. Try again.");
    assert.equal(p.patrolRefusal("teapot", null), "That change was not saved. Try again.");
  });
});

/* ======================================================================
 *  4. THE PANEL AND THE SCREEN
 * ====================================================================== */

describe("one component, in both places", () => {
  let panel, settings, control, app;
  before(async () => {
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    settings = await readFile(join(SRC, "components/SettingsView.tsx"), "utf8");
    control = await readFile(join(SRC, "components/PatrolControl.tsx"), "utf8");
    app = await readFile(join(SRC, "App.tsx"), "utf8");
  });

  test("⭐ both screens render PatrolControl, and neither rolls its own", () => {
    assert.match(panel, /<PatrolControl/);
    assert.match(settings, /<PatrolControl/);
    for (const [name, src] of [["panel", panel], ["settings", settings]]) {
      assert.ok(!/role="switch"[\s\S]{0,200}Patrol/.test(src), `${name} has its own switch`);
    }
  });

  test("⭐ the row is hidden without a movable camera that can patrol", () => {
    /* `ptz` is what the lens can do; the block is what the device says it
       will run. A movable camera on a build with no patrol has no block. */
    assert.match(panel, /f\.ptz && f\.patrol !== undefined/);
    assert.match(panel, /patrolFeeds\.length > 0/);
  });

  test("⭐ and hidden for a share holder", () => {
    assert.match(panel, /useBorrowedShare\(tower\.id, undefined\)/);
    assert.match(panel, /patrolFeeds\.length > 0 && !borrowed && onSetPatrol/);
  });

  test("Settings skips a fixed camera the same way", () => {
    assert.match(settings, /feed\.ptz && feed\.patrol && onSetPatrol/);
  });

  test("⭐ the controls offer exactly the contract's choices", () => {
    assert.match(control, /PATROL_INTERVALS\.map/);
    assert.match(control, /PATROL_DIRECTIONS\.map/);
  });

  test("⭐ what is drawn is the device's state, not the request", () => {
    /* Every refusal changes nothing, by contract, so a failed save has to put
       the controls back rather than leave them on what was asked for. */
    assert.match(control, /useEffect\(\(\) => \{\s*setDraft\(/);
    assert.match(control, /\[patrol\.enabled, patrol\.every, patrol\.direction\]/);
  });

  test("the shell holds the write and replaces the camera's block", () => {
    assert.match(app, /const setCameraPatrol = useCallback/);
    assert.match(app, /f\.id === feedId \? \{ \.\.\.f, patrol \} : f/);
  });
});

/* ======================================================================
 *  5. THE ONE LINE UNDER THE CONTROLS
 * ====================================================================== */

describe("next patrol, and patrolling now", () => {
  let control;
  before(async () => {
    control = await readFile(join(SRC, "components/PatrolControl.tsx"), "utf8");
  });

  test("⭐ the time is the app's existing Connected-since format", () => {
    /* Site time, no zone label, no seconds -- and the same function, so the
       two rows cannot drift into two clocks. */
    assert.match(control, /formatConnectedSince\(at, now\)/);
    const at = Date.parse("2026-10-25T14:40:00Z");   // 3:40 PM in Lagos
    assert.equal(time.formatConnectedSince(at, at), "Today 3:40 PM");
  });

  test("⭐ \"Patrolling now\" outranks the next time", () => {
    const running = control.indexOf("Patrolling now");
    const next = control.indexOf("Next patrol:");
    assert.ok(running > 0 && next > running, "the next time is drawn first");
  });

  test("⭐ and a refusal outranks both", () => {
    const failed = control.indexOf('phase.kind === "failed"');
    assert.ok(failed > 0 && failed < control.indexOf("Patrolling now"));
  });

  test("off says nothing at all", () => {
    assert.match(control, /if \(!patrol\.enabled\) return null;/);
  });
});

/* ======================================================================
 *  6. THE AUDIT LOG
 * ====================================================================== */

describe("patrol.set, as one sentence", () => {
  const names = { kln_lab_000001: "Tower 1" };
  const say = (data) =>
    auditing.sentenceFor(
      { action: "patrol.set", device_id: "kln_lab_000001", who: "Dave", detail: data },
      names,
    );

  test("⭐ switched on, with the schedule and the direction", () => {
    assert.equal(
      say({ camera: 1, enabled: true, every: "4h", direction: "clockwise" }),
      "Dave set Camera 1 on Tower 1 to patrol every 4 hours, clockwise",
    );
  });

  test("⭐ turned off, with no schedule read out", () => {
    /* "to patrol every never, nowhere" is what one sentence with holes in it
       produces. Turning patrol off is a different act. */
    assert.equal(
      say({ camera: 1, enabled: false, every: "4h", direction: "clockwise" }),
      "Dave turned off patrol on Camera 1 on Tower 1",
    );
  });

  test("every interval reads as English mid-sentence", () => {
    for (const [every, phrase] of [
      ["1h", "every hour"], ["2h", "every 2 hours"], ["12h", "every 12 hours"],
      ["24h", "every 24 hours"], ["random", "at random times"],
    ]) {
      assert.match(
        say({ camera: 2, enabled: true, every, direction: "random" }),
        new RegExp(`to patrol ${phrase}, in a random direction$`),
        every,
      );
    }
  });

  test("anticlockwise is said as itself", () => {
    assert.match(
      say({ camera: 1, enabled: true, every: "6h", direction: "anticlockwise" }),
      /every 6 hours, anticlockwise$/,
    );
  });

  test("a row with no camera number says \"a camera\", not \"Camera undefined\"", () => {
    assert.match(say({ enabled: true, every: "4h", direction: "clockwise" }), /a camera on Tower 1/);
  });

  test("it is grouped with the towers", () => {
    assert.equal(
      auditing.groupOf({ action: "patrol.set", device_id: "kln_lab_000001" }),
      "places",
    );
  });
});
