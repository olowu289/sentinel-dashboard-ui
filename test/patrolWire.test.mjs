/**
 * Patrol, from the raw HTTP body to the render condition.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS SUITE EXISTS, AND WHY THE OTHER ONE WAS NOT ENOUGH
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠ `test/patrol.test.mjs` CALLED `toTower` WITH A HAND-BUILT OBJECT, which
 * is the one shape the real path never produces. Between the wire and
 * `toTower` sits the SDK's `parseCameraInfo`, and it is a WHITELIST: it
 * builds a new camera from the fields it names and silently drops the rest.
 * `patrol` was not named, so coordination sent it on all four cameras of the
 * lab fleet, the row's condition read `feed.patrol`, and the row never
 * appeared -- with no error anywhere, because a dropped field looks exactly
 * like a server that never sent one.
 *
 * Every assertion here therefore starts from a JSON STRING, goes through the
 * real SDK client over an injected `fetch`, through `listFleet`, through
 * `toTower`, and ends at the thing the screens actually test. Nothing in the
 * middle is stubbed: that middle is where the bug was.
 *
 * The bodies are shaped like `projection.py` -- `patrol` sits directly on a
 * camera beside `index` and `ptz_capable`, gated on `ptz_capable`, defaulted
 * for a movable camera nobody has configured.
 *
 *   node --test test/patrolWire.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, beforeEach, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const BASE = "https://coord.example.test";

let fleet, auth, patrol;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "patrol-wire-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as fleet from "@/lib/api/fleet";\n`
      + `export * as auth from "@/lib/api/auth";\n`
      + `export * as patrol from "@/lib/patrol";\n`,
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
  ({ fleet, auth, patrol } = await import(pathToFileURL(out).href));
});

beforeEach(() => {
  auth.saveSession({
    ref: "ses_test",
    expiresAt: "2026-10-26T09:00:00Z",
    account: { account_id: "acct_1", login: "terra-industries", role: "owner" },
  });
});

/** The body `GET /v1/viewer/towers` really returns, as a STRING. */
function serve(json) {
  globalThis.fetch = async () =>
    new Response(json, { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * Lab Tower 1 and the Lab hub mast, both with two movable cameras.
 *
 * Written out as text rather than built from objects so it can be compared
 * against a real response by eye -- which is what a reader checking this
 * against `projection.py` will want to do.
 */
const LAB_FLEET = JSON.stringify({
  towers: [
    {
      device_id: "kln_lab_000001",
      label: "LAB TOWER 1",
      link: "up",
      as_of: "2026-10-25T09:00:00Z",
      connected_at: "2026-10-25T08:42:00Z",
      sensors: [],
      cameras: [
        {
          index: 1,
          lens: "ptz",
          ptz_capable: true,
          status: "live",
          patrol: {
            enabled: true,
            every: "4h",
            direction: "clockwise",
            next_at: "2026-10-25T14:40:00Z",
            running: false,
          },
        },
        {
          index: 2,
          lens: "ptz",
          ptz_capable: true,
          status: "live",
          patrol: {
            enabled: false,
            every: "4h",
            direction: "clockwise",
            next_at: null,
            running: false,
          },
        },
      ],
    },
    {
      device_id: "kln_hub_lab",
      label: "LAB HUB MAST",
      kind: "hub",
      link: "up",
      as_of: "2026-10-25T09:00:00Z",
      sensors: [],
      cameras: [
        {
          index: 1,
          lens: "ptz",
          ptz_capable: true,
          status: "live",
          patrol: {
            enabled: true,
            every: "12h",
            direction: "anticlockwise",
            next_at: "2026-10-25T20:00:00Z",
            running: true,
          },
        },
        {
          index: 2,
          lens: "fixed",
          ptz_capable: false,
          status: "live",
        },
      ],
    },
  ],
});

/* ======================================================================
 *  THE WHOLE PATH
 * ====================================================================== */

describe("a raw /v1/viewer/towers body, all the way to the row", () => {
  test("⭐ patrol survives the SDK and reaches the feed", async () => {
    /* THE REGRESSION. Before the SDK named `patrol`, this came back
       undefined on every camera and every screen hid the row. */
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const gate = feeds.find((f) => f.id === "kln_lab_000001:1");
    assert.ok(gate, "the camera is missing entirely");
    assert.ok(gate.patrol, "patrol was dropped between the wire and the feed");
    assert.deepEqual(gate.patrol, {
      enabled: true,
      every: "4h",
      direction: "clockwise",
      nextAt: "2026-10-25T14:40:00Z",
      running: false,
    });
  });

  test("⭐ all four movable cameras of the lab fleet keep theirs", async () => {
    /* The four blocks the live response carries. */
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const withPatrol = feeds.filter((f) => f.patrol !== undefined);
    assert.equal(withPatrol.length, 3, `expected 3 movable, got ${withPatrol.length}`);
    assert.deepEqual(
      withPatrol.map((f) => `${f.id}=${f.patrol.every}`),
      ["kln_lab_000001:1=4h", "kln_lab_000001:2=4h", "kln_hub_lab:1=12h"],
    );
  });

  test("⭐ the HUB MAST's camera keeps its own, which is the hub screen's row", async () => {
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const mast = feeds.find((f) => f.id === "kln_hub_lab:1");
    assert.equal(mast.patrol.every, "12h");
    assert.equal(mast.patrol.direction, "anticlockwise");
    assert.equal(mast.patrol.running, true, "Patrolling now would never show");
  });

  test("⭐ the FIXED camera gets none, so no row anywhere", async () => {
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const fixed = feeds.find((f) => f.id === "kln_hub_lab:2");
    assert.equal(fixed.patrol, undefined);
    assert.equal(fixed.ptz, false);
  });

  test("⭐ and the render condition is satisfied, camera by camera", async () => {
    /* `feed.ptz && feed.patrol && onSetPatrol` -- the exact condition both
        screens use. Checked here rather than as a string match, because the
        thing that broke was the VALUE reaching it, not the text of it. */
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const shows = (f) => Boolean(f.ptz && f.patrol);
    assert.equal(shows(feeds.find((f) => f.id === "kln_lab_000001:1")), true);
    assert.equal(shows(feeds.find((f) => f.id === "kln_lab_000001:2")), true);
    assert.equal(shows(feeds.find((f) => f.id === "kln_hub_lab:1")), true);
    assert.equal(shows(feeds.find((f) => f.id === "kln_hub_lab:2")), false);
  });

  test("⭐ and the row's words come out right off the wire", async () => {
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const tower1 = feeds.filter((f) => f.towerId === "kln_lab_000001");
    assert.equal(patrol.patrolWord(tower1[0].patrol), "Every 4 hours");
    assert.equal(patrol.patrolWord(tower1[1].patrol), "Off");
    /* One on, one off, on the same tower: the row counts rather than guessing. */
    assert.equal(patrolSummaryOf(tower1), "1 camera on");
    const mast = feeds.filter((f) => f.towerId === "kln_hub_lab" && f.patrol);
    assert.equal(patrolSummaryOf(mast), "Every 12 hours");
  });

  const patrolSummaryOf = (feeds) => patrol.patrolSummary(feeds.map((f) => f.patrol));

  test("a movable camera nobody configured arrives with the defaults, not absent", async () => {
    /* `PATROL_DEFAULTS` in projection.py. "Never configured" is a real state
       with a real answer, and the row has to show it as Off rather than
       vanish. */
    serve(LAB_FLEET);
    const { feeds } = await fleet.listFleet();
    const second = feeds.find((f) => f.id === "kln_lab_000001:2");
    assert.ok(second.patrol, "a defaulted block was dropped");
    assert.equal(second.patrol.enabled, false);
    assert.equal(second.patrol.nextAt, null);
  });

  test("an interval this build has never heard of does not cost the fleet", async () => {
    /* ⚠ THE WHOLE FLEET, NOT JUST THE ROW. The SDK records a validation
       issue for an unknown enum and throws on any issue, so a strict reading
       of a SETTING would take every tower off the screen the day a device
       learns an eighth interval. Patrol falls back instead. */
    serve(
      LAB_FLEET.replace('"every": "4h", "direction": "clockwise", "next_at": "2026-10-25T14:40:00Z"',
                        '"every": "36h", "direction": "widdershins", "next_at": "2026-10-25T14:40:00Z"')
        .replace('"every":"4h","direction":"clockwise","next_at":"2026-10-25T14:40:00Z"',
                 '"every":"36h","direction":"widdershins","next_at":"2026-10-25T14:40:00Z"'),
    );
    const { towers, feeds } = await fleet.listFleet();
    assert.equal(towers.length, 2, "the fleet was lost over one camera's schedule");
    assert.ok(feeds.find((f) => f.id === "kln_lab_000001:1").patrol);
  });

  test("a body with no patrol at all still parses, and hides the row", async () => {
    /* An older coordination. The screens must show no Patrol row rather than
       an empty one. */
    serve(
      JSON.stringify({
        towers: [
          {
            device_id: "kln_old_000001",
            label: "OLD TOWER",
            link: "up",
            as_of: "2026-10-25T09:00:00Z",
            sensors: [],
            cameras: [{ index: 1, lens: "ptz", ptz_capable: true, status: "live" }],
          },
        ],
      }),
    );
    const { feeds } = await fleet.listFleet();
    assert.equal(feeds[0].patrol, undefined);
    assert.equal(feeds[0].ptz, true, "a movable camera stopped being movable");
  });
});

/* ======================================================================
 *  THE WRITE, THROUGH WHATEVER PARSES IT
 * ====================================================================== */

describe("the 200 from the write, through the same parse", () => {
  let sent;
  const answer = (json, status = 200) => {
    globalThis.fetch = async (url, init) => {
      sent = { url: String(url), method: init?.method, body: JSON.parse(init?.body ?? "{}") };
      return new Response(json, { status, headers: { "content-type": "application/json" } });
    };
  };

  test("⭐ the answer's five fields reach the control", async () => {
    answer(
      JSON.stringify({
        enabled: true,
        every: "6h",
        direction: "anticlockwise",
        next_at: "2026-10-25T18:30:00Z",
        running: false,
      }),
    );
    const got = await fleet.setPatrol("kln_lab_000001", 1, {
      enabled: true,
      every: "6h",
      direction: "anticlockwise",
    });
    assert.deepEqual(got, {
      enabled: true,
      every: "6h",
      direction: "anticlockwise",
      nextAt: "2026-10-25T18:30:00Z",
      running: false,
    });
  });

  test("⭐ and the request is the contract's three fields at the contract's path", async () => {
    answer(JSON.stringify({ enabled: false, every: "4h", direction: "clockwise",
                            next_at: null, running: false }));
    await fleet.setPatrol("kln_hub_lab", 1, {
      enabled: false, every: "4h", direction: "clockwise",
    });
    assert.equal(sent.method, "PUT");
    assert.match(sent.url, /\/v1\/viewer\/towers\/kln_hub_lab\/cameras\/1\/patrol$/);
    assert.deepEqual(sent.body, { enabled: false, every: "4h", direction: "clockwise" });
  });

  test("a `next_at` the device computed is carried, never recomputed", async () => {
    /* The cloud guessing a next time from an interval would drift away from
       the box that is actually going to turn. */
    answer(JSON.stringify({ enabled: true, every: "1h", direction: "random",
                            next_at: "2026-12-31T23:59:00Z", running: false }));
    const got = await fleet.setPatrol("kln_lab_000001", 2, {
      enabled: true, every: "1h", direction: "random",
    });
    assert.equal(got.nextAt, "2026-12-31T23:59:00Z");
  });
});
