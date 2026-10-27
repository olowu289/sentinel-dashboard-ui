/**
 * A camera's name, from the raw HTTP body to the caption on the tile.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THE EXISTING TESTS DID NOT CATCH THIS
 * ══════════════════════════════════════════════════════════════════════
 *
 * For the same reason they missed `patrol`: they called `toTower` with a
 * hand-built camera, which is the one shape the real path never produces.
 * Between the wire and `toTower` sits the SDK's `parseCameraInfo`, and it is
 * a WHITELIST -- it builds a new camera from the fields it names.
 *
 * ⚠ AND THE APP READ `label` THROUGH A CAST, which made the gap invisible.
 * The cast narrowed the parsed camera to reach a property the validator had
 * already dropped, with a comment explaining that the SDK's type was "a
 * version behind" -- reasoning about the TYPE, while the VALIDATOR was the
 * thing removing the field. So: coordination sent "Gate test", the hub stored
 * it, every GET carried it, the PATCH answered with it, and every screen said
 * CAMERA 1.
 *
 * Every assertion here starts from a JSON STRING and ends at the name a
 * person reads. Nothing in the middle is stubbed, because that middle is
 * where the bug was.
 *
 *   node --test test/cameraNameWire.test.mjs
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

let fleet, auth, held;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "camera-name-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as fleet from "@/lib/api/fleet";\n`
      + `export * as auth from "@/lib/api/auth";\n`
      + `export * as held from "@/lib/heldWrites";\n`,
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
  ({ fleet, auth, held } = await import(pathToFileURL(out).href));
});

beforeEach(() => {
  auth.saveSession({
    ref: "ses_test",
    expiresAt: "2026-10-28T09:00:00Z",
    account: { account_id: "acct_1", login: "terra-industries", role: "owner" },
  });
});

const serve = (json, status = 200) => {
  globalThis.fetch = async () =>
    new Response(json, { status, headers: { "content-type": "application/json" } });
};

/**
 * Camera 1 of the lab's west tower, exactly as the projection builds it:
 * eight fields, two of them revisions this build has no use for.
 */
const CAMERA_1 = {
  index: 1,
  lens: "ptz",
  ptz_capable: true,
  status: "live",
  name_rev: 3,
  resolution: { width: 2560, height: 1440 },
  profiles: [
    { id: "sub", default: true, resolution: { width: 704, height: 576 } },
    { id: "main", default: false, resolution: { width: 2560, height: 1440 } },
  ],
  patrol: {
    enabled: false,
    every: "4h",
    direction: "clockwise",
    next_at: null,
    running: false,
  },
  patrol_rev: 86,
  label: "Gate test",
};

const CAMERA_2 = {
  index: 2,
  lens: "fixed",
  ptz_capable: false,
  status: "live",
  name_rev: 0,
};

const WEST_TOWER = {
  device_id: "kln_lab_000002",
  label: "WEST TOWER",
  link: "up",
  as_of: "2026-10-27T09:00:00Z",
  connected_at: "2026-10-27T08:42:00Z",
  name_rev: 2,
  sensors: [],
  cameras: [CAMERA_1, CAMERA_2],
};

/* ======================================================================
 *  THE FLEET READ
 * ====================================================================== */

describe("GET /v1/viewer/towers, all the way to the caption", () => {
  test("⭐ the camera's own name reaches the feed", async () => {
    /* THE REGRESSION. Before the SDK named `label`, this came back
       undefined and every screen fell back to CAMERA 1. */
    serve(JSON.stringify({ towers: [WEST_TOWER] }));
    const { feeds } = await fleet.listFleet();
    const one = feeds.find((f) => f.id === "kln_lab_000002:1");
    assert.ok(one, "the camera is missing entirely");
    assert.equal(one.name, "Gate test", "the wall, the tile and the picker all read this");
    assert.equal(one.label, "Gate test", "the settings box reads this");
  });

  test("⭐ an UNNAMED camera still falls back to CAMERA <index>", () => {
    /* `name` is what every screen prints and must never be blank; `label` is
       the raw fact, and its absence is how the settings box knows to show a
       placeholder rather than a value. */
    return serve(JSON.stringify({ towers: [WEST_TOWER] })), fleet.listFleet().then(({ feeds }) => {
      const two = feeds.find((f) => f.id === "kln_lab_000002:2");
      assert.equal(two.name, "CAMERA 2");
      assert.equal(two.label, undefined);
    });
  });

  test("⭐ a CLEARED name goes back to CAMERA 1", async () => {
    /* Clearing is a real act: the field is absent afterwards, and absence is
       what the fallback is for. */
    for (const label of [undefined, "", "   "]) {
      serve(JSON.stringify({ towers: [{ ...WEST_TOWER, cameras: [{ ...CAMERA_1, label }]}] }));
      const { feeds } = await fleet.listFleet();
      assert.equal(feeds[0].name, "CAMERA 1", JSON.stringify(label));
      assert.equal(feeds[0].label, undefined, JSON.stringify(label));
    }
  });

  test("⭐ and the revisions cost nothing", async () => {
    /* They arrived in a release this build did not know about. A strict
       reading would have taken the whole fleet off the screen. */
    serve(JSON.stringify({ towers: [WEST_TOWER] }));
    const { towers, feeds } = await fleet.listFleet();
    assert.equal(towers.length, 1, "the fleet was lost over a revision number");
    assert.equal(feeds.length, 2);
    assert.equal(towers[0].site, "WEST TOWER");
  });

  test("the tower's own name still works the same way", async () => {
    serve(JSON.stringify({ towers: [WEST_TOWER] }));
    const { towers } = await fleet.listFleet();
    assert.equal(towers[0].site, "WEST TOWER");
  });

  test("everything beside the name still crosses", async () => {
    /* One new field must not cost the others, which is what a whitelist is
       for and exactly what makes it dangerous. */
    serve(JSON.stringify({ towers: [WEST_TOWER] }));
    const { feeds } = await fleet.listFleet();
    const one = feeds[0];
    assert.equal(one.ptz, true);
    assert.equal(one.profiles.length, 2);
    assert.equal(one.patrol.every, "4h");
  });
});

/* ======================================================================
 *  THE RENAME ANSWER
 * ====================================================================== */

describe("the PATCH answer, through whatever parses it", () => {
  /** The real body: the whole re-projected tower, plus a `camera` echo. */
  const PATCH_ANSWER = JSON.stringify({
    tower: WEST_TOWER,
    camera: { label: "Gate test" },
  });

  test("⭐ the renamed camera comes back named", async () => {
    serve(PATCH_ANSWER);
    const { feeds } = await fleet.renameCamera("kln_lab_000002", 1, "Gate test");
    const one = feeds.find((f) => f.index === 1);
    assert.equal(one.name, "Gate test");
    assert.equal(one.label, "Gate test");
  });

  test("⭐ and the whole tower comes back with it", async () => {
    /* The point of answering with the tower is that both lists are replaced
       rather than patched: patching one field is how the wall ends up showing
       the old name while the settings screen shows the new one. */
    serve(PATCH_ANSWER);
    const { towers, feeds } = await fleet.renameCamera("kln_lab_000002", 1, "Gate test");
    assert.equal(towers.length, 1);
    assert.equal(feeds.length, 2);
    assert.equal(feeds.find((f) => f.index === 2).name, "CAMERA 2");
  });

  test("⭐ clearing the name answers with it gone", async () => {
    serve(JSON.stringify({
      tower: { ...WEST_TOWER, cameras: [{ ...CAMERA_1, label: undefined, name_rev: 4 }, CAMERA_2] },
      camera: { label: "" },
    }));
    const { feeds } = await fleet.renameCamera("kln_lab_000002", 1, "");
    assert.equal(feeds.find((f) => f.index === 1).name, "CAMERA 1");
  });
});

/* ======================================================================
 *  AND THE HOLD DOES NOT PUT THE OLD NAME BACK
 * ====================================================================== */

describe("the held write holds the NEW name, not the old one", () => {
  let appSource;
  before(async () => {
    appSource = await readFile(join(SRC, "App.tsx"), "utf8");
  });

  test("⭐ a stale refresh does not undo a rename", async () => {
    /* `heldWrites` confirms whatever the rename answer carried. When the SDK
       was dropping `label` that was `undefined` -- so the hold would have
       pinned the camera BACK to unnamed for two minutes, on top of the
       original bug. */
    serve(JSON.stringify({ tower: WEST_TOWER, camera: { label: "Gate test" } }));
    const { feeds } = await fleet.renameCamera("kln_lab_000002", 1, "Gate test");

    const store = new held.HeldWrites();
    for (const f of feeds) {
      store.confirm(held.holdKey("camera", f.id, "label"), f.label);
    }
    assert.equal(
      store.peek(held.holdKey("camera", "kln_lab_000002:1", "label")),
      "Gate test",
      "the hold confirmed an empty name",
    );

    /* A refresh still carrying the old name. */
    const stale = [{ id: "kln_lab_000002:1", label: undefined, name: "CAMERA 1" }];
    const shown = store.apply(
      stale,
      "camera",
      "label",
      (f) => f.id,
      (f) => f.label,
      (f, v) => ({ ...f, label: v }),
    );
    assert.equal(shown[0].label, "Gate test");
  });

  test("⭐ and the caption moves with it, because `name` is derived", () => {
    /* ⚠ THE SECOND HALF, AND IT IS THE HALF A PERSON SEES. `name` is what
       every tile caption, the wall, the playback picker and the evidence file
       name print; `label` is only what the settings box edits. Restoring one
       without the other leaves a camera reading "Gate test" in settings and
       CAMERA 1 everywhere else. */
    const app = appSource;
    assert.match(app, /name: label \?\? `CAMERA \$\{f\.index \?\? ""\}`/);
  });

  test("and a CLEARED name is held as cleared, then agreed immediately", () => {
    /* `undefined` is a legitimate confirmed value here: it is what an erased
       name looks like, and the next refresh agrees with it at once. */
    const store = new held.HeldWrites();
    const key = held.holdKey("camera", "kln_lab_000002:1", "label");
    store.confirm(key, undefined);
    store.apply(
      [{ id: "kln_lab_000002:1", label: undefined }],
      "camera",
      "label",
      (f) => f.id,
      (f) => f.label,
      (f, v) => ({ ...f, label: v }),
    );
    assert.equal(store.size, 0, "a cleared name held on for two minutes");
  });
});

/* ======================================================================
 *  AND WHERE IT IS DRAWN
 * ====================================================================== */

describe("one name, every screen", () => {
  let map, settings;
  before(async () => {
    map = await readFile(join(SRC, "lib/api/map.ts"), "utf8");
    settings = await readFile(join(SRC, "components/SettingsView.tsx"), "utf8");
  });

  test("⭐ the name is decided ONCE, in the mapper", () => {
    /* Named here and therefore named everywhere: the wall, the tile caption,
       the playback picker, the sharing rows, the evidence file name. A screen
       computing its own fallback is how two of them disagree. */
    assert.match(map, /name: named \|\| `CAMERA \$\{cam\.index\}`/);
  });

  test("⭐ and the cast that read a dropped field is gone", () => {
    assert.ok(!/cam as \{ label\?: unknown \}/.test(map), "the cast is back");
    assert.match(map, /typeof cam\.label === "string"/);
  });

  test("⭐ the settings box shows the name as its VALUE", () => {
    /* Not a placeholder: a person renaming a camera has to see what it is
       called now, and edit that. The placeholder is for the unnamed case. */
    assert.match(settings, /value=\{draft\}/);
    assert.match(settings, /camDraft\[openFeed\.id\] \?\? openFeed\.label \?\? ""/);
    assert.match(settings, /placeholder=\{deviceName\(feed\.name\)\}/);
  });
});
