/**
 * ACTIVE CAMERAS is in the order TOWERS is in.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON SCREEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * The list on the left read Terra Factory Tower 2, West tower, Lab hub mast.
 * The wall on the right, showing the same sites, read Lab hub mast, then West
 * tower. One fleet, two panels, two answers — and with thirty towers rather
 * than three, finding on the wall the site you just read about in the list
 * stops being possible at a glance, which is the whole job of banding the wall
 * by site.
 *
 * The orders could differ because they came from different places: the list
 * rendered the fleet as served, while the wall rendered a SEPARATE arrangement
 * of feed ids that was seeded from the fixtures and extended by appending
 * whatever was new to the end. So the wall carried the history of every fleet
 * the browser had read, and a tower that arrived late sat last on it for ever.
 *
 * ⚠ SO THESE TESTS ARE NOT "THE TWO ORDERS MATCH". Keeping two orders in step
 * is a thing to maintain and therefore a thing to get wrong. They are "there
 * is one order": `lib/fleetOrder.ts`, called by both panels, with nothing else
 * holding an arrangement anywhere.
 *
 * The last section renders the real `DashboardView` in a real browser, because
 * two of the four claims cannot be made anywhere else. That the two panels
 * AGREE ON SCREEN is a fact about rendered output, not about a function. And
 * that a reorder does not RESTART THE VIDEO is a fact about React's
 * reconciliation: the proof is that the very same DOM nodes are still there
 * afterwards, which only a browser can be asked.
 *
 *   node --test test/activeCamerasOrder.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const SDK = join(ROOT, "vendor/sentry-sdk/dist/esm/index.js");
/* Scratch entries live INSIDE the project, not in the system temp directory:
   esbuild resolves a bare `react` by walking up from the importing file, and
   from `/tmp` there is no `node_modules` to walk up to. */
const SCRATCH = join(ROOT, "node_modules/.cache");

/* ======================================================================
 *  THE FLEET, SHAPED LIKE THE ONE IN THE REPORT
 * ====================================================================== */

/**
 * Three real sites plus three more, because the bug was invisible at two.
 *
 * `kln_lab_000004` is Terra Factory Tower 2: offline, and carrying no cameras
 * at all because it has never sent an inventory. It is in the list and not on
 * the wall, which is what already happened and what must keep happening.
 */
const TOWERS = [
  { id: "kln_lab_000004", site: "Terra Factory Tower 2", status: "offline", online: false },
  { id: "kln_lab_000002", site: "West tower", status: "online", online: true },
  { id: "kln_hub_000001", site: "Lab hub mast", status: "online", online: true },
  { id: "kln_lab_000007", site: "North gate", status: "degraded", online: true },
  { id: "kln_lab_000009", site: "Weighbridge", status: "online", online: true },
];

/** Two cameras a tower, as the hardware has — except the one with none. */
const FEEDS = [
  feed("kln_hub_000001", 2, "Yard"),
  feed("kln_hub_000001", 1, "Gate test"),
  feed("kln_lab_000009", 1),
  feed("kln_lab_000009", 2),
  feed("kln_lab_000002", 1),
  feed("kln_lab_000002", 2),
  feed("kln_lab_000007", 2),
  feed("kln_lab_000007", 1),
];

function feed(towerId, index, label) {
  return {
    id: `${towerId}:${index}`,
    towerId,
    index,
    name: label ?? `CAMERA ${index}`,
    ...(label ? { label } : {}),
    state: "live",
    lens: "fixed",
    ptz: false,
    poster: "",
    lastSeenAt: null,
  };
}

/** The sites, in the order the TOWERS list puts them. */
const listOrder = (towers = TOWERS) => towers.map((t) => t.id);

/* ======================================================================
 *  THE FUNCTION BOTH PANELS CALL
 * ====================================================================== */

let F;

before(async () => {
  await mkdir(SCRATCH, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH, "wall-order-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/fleetOrder";\n`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
  });
  F = await import(pathToFileURL(out).href);
  scratch.push(dir);
});

/* Built entries, swept up at the end. They have to live inside the project —
   see `SCRATCH` — so they are not somebody else's temp directory to leave
   lying around. */
const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

describe("the wall is banded in the list's order", () => {
  test("⭐ THE BUG: the bands come out in the list's order, not the feeds'", () => {
    /* The feeds arrive hub-first above, which is exactly what the wall used to
       render. The list says West tower comes first. */
    const bands = F.wallBands(TOWERS, FEEDS).map((b) => b.towerId);
    assert.deepEqual(bands, [
      "kln_lab_000002",
      "kln_hub_000001",
      "kln_lab_000007",
      "kln_lab_000009",
    ]);
  });

  test("⭐ and it is the LIST's order, whatever that order is", () => {
    /* Not alphabetical, not by status, not by id: whatever the list shows.
       Reverse the fleet and the wall reverses with it. */
    const reversed = [...TOWERS].reverse();
    const bands = F.wallBands(reversed, FEEDS).map((b) => b.towerId);
    const expected = listOrder(reversed).filter((id) =>
      FEEDS.some((f) => f.towerId === id),
    );
    assert.deepEqual(bands, expected);
  });

  test("⭐ a tower with no cameras is still skipped", () => {
    /* It is in the list, with its status on its card. A band header over an
       empty row would promise a picture and deliver a gap. */
    const bands = F.wallBands(TOWERS, FEEDS).map((b) => b.towerId);
    assert.ok(listOrder().includes("kln_lab_000004"), "the fixture lost the point");
    assert.ok(!bands.includes("kln_lab_000004"), "an empty tower took a band");
  });

  test("⭐ skipping it does not disturb the order of the rest", () => {
    /* The offline tower is FIRST in the list, so an implementation that
       filtered by position rather than by id would shift every band by one. */
    const bands = F.wallBands(TOWERS, FEEDS).map((b) => b.towerId);
    const ranks = bands.map((id) => listOrder().indexOf(id));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "the bands are out of order");
  });

  test("cameras inside a band are in camera-number order", () => {
    /* The hub's two feeds arrive 2 then 1 above. The tower numbers its own
       cameras and that number is what somebody says out loud. */
    const bands = F.wallBands(TOWERS, FEEDS);
    for (const band of bands) {
      const indexes = band.feeds.map((f) => f.index);
      assert.deepEqual(indexes, [1, 2], band.towerId);
    }
  });

  test("the flat order is the bands, read left to right", () => {
    /* What the session cap is applied to — so the tiles that stream are the
       ones at the top of the wall, and not the top of some other order. */
    const ids = F.wallOrder(TOWERS, FEEDS);
    assert.deepEqual(ids.slice(0, 4), [
      "kln_lab_000002:1",
      "kln_lab_000002:2",
      "kln_hub_000001:1",
      "kln_hub_000001:2",
    ]);
    assert.equal(ids.length, FEEDS.length);
  });

  test("⭐ a camera whose tower is not in the list is not thrown away", () => {
    /* Nothing on the wire produces one. But a camera silently vanishing off a
       monitoring wall is the wrong way to handle a case that cannot happen. */
    const orphan = feed("kln_lab_999999", 1);
    const bands = F.wallBands(TOWERS, [...FEEDS, orphan]);
    const last = bands[bands.length - 1];
    assert.equal(last.towerId, "kln_lab_999999");
    assert.equal(bands.length, 5);
  });

  test("an empty fleet is an empty wall, not a crash", () => {
    assert.deepEqual(F.wallBands([], []), []);
    assert.deepEqual(F.wallBands(TOWERS, []), []);
  });

  test("the list's own order is the one it was given", () => {
    assert.deepEqual(F.fleetOrder(TOWERS), TOWERS);
  });
});

/* ======================================================================
 *  HUB MODE
 * ====================================================================== */

describe("a hub orders its own dashboard the same way", () => {
  /* There is one dashboard. A hub serves the same bundle and the same
     `GET /v1/viewer/towers`, and what makes it hub mode is the server's
     answer to `/v1/capabilities` — nothing on this path branches on it. So
     the test worth having is that a hub-shaped fleet, where the hub's own
     mast is one of the towers, comes out in the list's order like any
     other. */
  const HUB_FLEET = [
    { id: "kln_hub_000001", site: "Lab hub mast", status: "online", online: true, kind: "hub" },
    { id: "kln_lab_000002", site: "West tower", status: "online", online: true },
  ];
  const HUB_FEEDS = FEEDS.filter((f) =>
    HUB_FLEET.some((t) => t.id === f.towerId),
  );

  test("⭐ the hub's mast sits where the list puts it", () => {
    const bands = F.wallBands(HUB_FLEET, HUB_FEEDS).map((b) => b.towerId);
    assert.deepEqual(bands, ["kln_hub_000001", "kln_lab_000002"]);
  });

  test("⭐ and moves when the list moves it", () => {
    const bands = F.wallBands([...HUB_FLEET].reverse(), HUB_FEEDS).map((b) => b.towerId);
    assert.deepEqual(bands, ["kln_lab_000002", "kln_hub_000001"]);
  });
});

/* ======================================================================
 *  ONE ORDER, NOT TWO KEPT IN STEP
 * ====================================================================== */

describe("there is nowhere for a second order to live", () => {
  let app, dashboard, panel, prefs, stripComments;

  before(async () => {
    ({ stripComments } = await import("./lib/copyScan.mjs"));
    const read = async (p) => stripComments(await readFile(join(SRC, p), "utf8"));
    app = await read("App.tsx");
    dashboard = await read("components/DashboardView.tsx");
    panel = await read("components/TowersPanel.tsx");
    prefs = await read("lib/prefs.ts");
  });

  test("⭐ both panels call the shared function", () => {
    /* Over the code, not the prose: the comments at both sites explain the
       bug by name, and a raw search would be satisfied by the explanation. */
    assert.match(panel, /fleetOrder\(towers\)\.map\(/);
    assert.match(dashboard, /wallBands\(towers, feeds\)/);
  });

  test("⭐ the dashboard is not handed an arrangement any more", () => {
    assert.ok(!/order=\{/.test(app), "the shell still passes a wall order");
    assert.ok(!/onReorder/.test(app), "the shell still passes a reorder");
    assert.ok(!/onReorder/.test(dashboard), "the wall still accepts a reorder");
  });

  test("⭐ and no arrangement is stored, in state or on disk", () => {
    /* The stored one is what let the wall carry the order of a fleet the
       operator was no longer looking at. */
    assert.ok(!/useState<string\[\]>/.test(app), "something still holds an id order");
    assert.ok(!/wallOrder:/.test(prefs), "the arrangement is still persisted");
  });

  test("the session cap is applied in wall order", () => {
    /* What streams is what is at the top of the wall, which is now the top of
       the list. The cap reading a different order would drop tiles nobody
       could account for. */
    assert.match(app, /wallIds\s*=\s*useMemo\(\(\) => wallOrder\(towers, feeds\)/);
    assert.match(app, /fleetTargets: PlaybackTarget\[\] = wallIds/);
  });
});

/* ======================================================================
 *  ON SCREEN, IN A BROWSER
 * ====================================================================== */

describe("the rendered wall, and what survives a reorder", () => {
  let browser;
  let page;

  before(async () => {
    /* The real component, bundled as the app bundles it. `IconRail` reads the
       session, so the tree is wrapped in the real provider — with no stored
       session it resolves to anonymous without touching the network. */
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "wall-render-"));
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement } from "react";
       import { createRoot } from "react-dom/client";
       import { AuthProvider } from "@/components/AuthProvider";
       import { DashboardView } from "@/components/DashboardView";

       const root = createRoot(document.getElementById("root"));
       const noop = () => {};
       window.show = (towers, feeds) =>
         root.render(
           createElement(AuthProvider, null,
             createElement(DashboardView, {
               towers, feeds, alerts: [], pendingClaim: null,
               onNavigate: noop, onResumeSetup: noop, onOpenTower: noop,
               onRetryFeed: noop, onToggleRecord: noop,
             })));
      `,
      "utf8",
    );
    const out = join(dir, "bundle.js");
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: {
        "process.env.NODE_ENV": '"production"',
        /* ⚠ THE WHOLE OBJECT, and `VITE_COORDINATION_URL` inside it. Defining
           one key leaves `import.meta.env` itself undefined; leaving the URL
           out makes `IconRail` throw during render, because a dashboard that
           does not know where its server is refuses to pretend otherwise.
           Nothing is fetched — `fetch` is stubbed to reject below. */
        "import.meta.env": JSON.stringify({
          MODE: "test",
          DEV: false,
          PROD: true,
          VITE_COORDINATION_URL: "https://coordination.test",
          VITE_SITE_TZ: "Africa/Lagos",
        }),
      },
    });
    const bundle = await readFile(out, "utf8");
    scratch.push(dir);

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    /* No server and no fleet: every screen in this app is given its data, and
       this one is given it directly. */
    await page.addInitScript(() => {
      window.fetch = () => Promise.reject(new Error("no network in this test"));
    });
    await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
    await page.addScriptTag({ content: bundle });
  });

  after(async () => {
    await browser?.close();
  });

  /** The site names down the TOWERS list, top to bottom. */
  const listed = () =>
    page.$$eval("aside button[aria-label]", (els) =>
      els
        .map((e) => e.getAttribute("aria-label"))
        .filter((l) => /^kln_\w+, /.test(l))
        .map((l) => l.split(",")[0]),
    );

  /** The band headings down the wall, top to bottom.
   *
   *  ⚠ A DIRECT CHILD OF `<main>`. Every TILE is a `<section>` with an
   *  `aria-label` too ("CAMERA 1 camera, kln_lab_000002"), so an unanchored
   *  selector returns the bands and their contents interleaved. */
  const banded = () =>
    page.$$eval("main > section[aria-label]", (els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );

  const show = async (towers, feeds = FEEDS) => {
    await page.evaluate(
      ([t, f]) => window.show(t, f),
      [towers, feeds],
    );
    await page.waitForTimeout(250);
  };

  test("⭐ the wall and the list agree, on screen", async () => {
    await show(TOWERS);
    const ids = await listed();
    assert.deepEqual(ids, listOrder(), "the list is not rendering the fleet in order");

    const names = await banded();
    const expected = listOrder()
      .filter((id) => FEEDS.some((f) => f.towerId === id))
      /* In capitals: a tower's name is capitals everywhere it is drawn, and
         the band heading is one of those places. See `lib/deviceName.ts`. */
      .map((id) => TOWERS.find((t) => t.id === id).site.toUpperCase());
    assert.deepEqual(names, expected);
  });

  test("⭐ the offline tower is in the list and not on the wall", async () => {
    await show(TOWERS);
    assert.ok((await listed()).includes("kln_lab_000004"));
    assert.ok(!(await banded()).includes("TERRA FACTORY TOWER 2"));
  });

  test("⭐ A REORDER MOVES THE TILES AND DOES NOT REBUILD THEM", async () => {
    /* THE CLAIM THAT MATTERS, and the only one a browser can settle. Each
       tile is stamped on the DOM node itself — a property, not an attribute,
       so React has no way to carry it across a remount. The fleet then comes
       back in a different order. Every stamp still being there means React
       MOVED those nodes, which is what keeps a `<video>` playing; a missing
       stamp is a tile that was torn down and rebuilt, which on this wall is a
       stream that visibly restarts. */
    await show(TOWERS);
    const before = await page.$$eval("main section[aria-label*='camera,']", (els) =>
      els.map((e, i) => {
        e.__stamp = `tile-${i}`;
        return e.getAttribute("aria-label");
      }),
    );
    assert.ok(before.length >= 8, `only ${before.length} tiles on the wall`);

    /* West tower goes to the back of the list; the hub comes forward. */
    const moved = [TOWERS[0], TOWERS[2], TOWERS[3], TOWERS[4], TOWERS[1]];
    await show(moved);

    const after = await page.$$eval("main section[aria-label*='camera,']", (els) =>
      els.map((e) => ({ label: e.getAttribute("aria-label"), stamp: e.__stamp ?? null })),
    );

    assert.deepEqual(
      await banded(),
      ["LAB HUB MAST", "NORTH GATE", "WEIGHBRIDGE", "WEST TOWER"],
      "the wall did not follow the list",
    );
    const lost = after.filter((t) => t.stamp === null).map((t) => t.label);
    assert.deepEqual(lost, [], "these tiles were rebuilt rather than moved");
  });

  test("⭐ a tower going dark takes its band and leaves the others alone", async () => {
    /* The other half of the same claim: the wall follows a fleet that has
       changed, not only one that has been shuffled. */
    await show(TOWERS);
    await page.$$eval("main section[aria-label*='camera,']", (els) =>
      els.forEach((e, i) => {
        e.__stamp = `again-${i}`;
      }),
    );

    const withoutHub = TOWERS.filter((t) => t.id !== "kln_hub_000001");
    const feeds = FEEDS.filter((f) => f.towerId !== "kln_hub_000001");
    await show(withoutHub, feeds);

    assert.ok(!(await banded()).includes("LAB HUB MAST"), "the band outlived the tower");
    const after = await page.$$eval("main section[aria-label*='camera,']", (els) =>
      els.map((e) => ({ label: e.getAttribute("aria-label"), stamp: e.__stamp ?? null })),
    );
    const lost = after.filter((t) => t.stamp === null).map((t) => t.label);
    assert.deepEqual(lost, [], "a surviving tile was rebuilt");
  });

  test("a renamed tower keeps its tiles", async () => {
    /* A rename is a new `towers` array with a new string in it. Nothing about
       the cameras changed, so nothing about the tiles should. */
    await show(TOWERS);
    await page.$$eval("main section[aria-label*='camera,']", (els) =>
      els.forEach((e, i) => {
        e.__stamp = `named-${i}`;
      }),
    );
    const renamed = TOWERS.map((t) =>
      t.id === "kln_lab_000002" ? { ...t, site: "West gate" } : t,
    );
    await show(renamed);

    assert.ok((await banded()).includes("WEST GATE"), "the band kept the old name");
    const after = await page.$$eval("main section[aria-label*='camera,']", (els) =>
      els.map((e) => e.__stamp ?? null),
    );
    assert.ok(!after.includes(null), "a rename rebuilt the tiles");
  });
});
