/**
 * HOW MANY ALERTS ARE WAITING, AND THE ONE BUTTON THAT CLEARS THEM.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THESE TESTS ARE ABOUT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three numbers that used to be either wrong or absent:
 *
 *   1. the number on a tower card, which was `alerts.length + "+"` -- every
 *      alert the browser happened to be holding, acknowledged or not, with a
 *      plus glued on. A quiet site read `0+`;
 *   2. the badge on the rail's Alerts icon, which did not exist;
 *   3. the Footage screen's tower dropdown, which drew EMPTY over a 403
 *      because the hook swallowed every failure into one silent state.
 *
 * The first two are now one read of `GET /v1/viewer/site-alerts/counts`,
 * shared by both surfaces so they cannot round the same count differently,
 * and re-read off the live channel rather than polled beside it.
 *
 * ⚠ THE BROWSER TESTS GO THROUGH THE REAL SDK OVER A ROUTED `fetch`. The list
 * is JSON on the wire, the stream is SSE frames in a `ReadableStream`, and
 * the counts are a second route answering a second question. A test that
 * handed the components a shaped number would prove the rendering and
 * nothing about the thing that was actually missing.
 *
 *   node --test test/alertCounts.test.mjs
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
const SCRATCH = join(ROOT, "node_modules/.cache");

const ENV = JSON.stringify({
  MODE: "test",
  DEV: false,
  PROD: true,
  VITE_COORDINATION_URL: "https://coordination.test",
  VITE_SITE_TZ: "Africa/Lagos",
});

const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/* ⚠ TERRA INDUSTRIES, NEVER kaduna-mine. Three of this account's own masts. */
const WEST = "kln_lab_000002";
const EAST = "kln_lab_000003";
const NORTH = "kln_lab_000004";

const COLOURS = { TOWER_OFFLINE: "red", TOWER_ONLINE: "green" };
const EPOCH = 1793189400;

/** One server alert, in the shape `GET /v1/viewer/site-alerts` returns. */
const alertRow = (id, device, offset, acknowledged = false) => ({
  id,
  type: "TOWER_OFFLINE",
  colour: "red",
  device_id: device,
  cameras: [],
  started_at: "2026-10-28T12:10:00Z",
  started_epoch: EPOCH + offset,
  acknowledged,
  ...(acknowledged ? { acknowledged_by: "Terra Industries" } : {}),
  rev: 1,
});

/* Four rows: three waiting, one already picked up. The newest is EAST's. */
const ROWS = [
  alertRow("aaaa0001", EAST, 300),
  alertRow("bbbb0002", NORTH, 200),
  alertRow("cccc0003", WEST, 100, true),
  alertRow("dddd0004", NORTH, 0),
];

/* ⚠ WEST IS ABSENT FROM `by_device` RATHER THAN PRESENT WITH A ZERO, which
   is the route's own contract and the case a careless reader gets wrong. */
const COUNTS = { total: 147, by_device: { [EAST]: 7, [NORTH]: 140 } };

/* ======================================================================
 *  1. THE PURE RULES -- no browser, no server
 * ====================================================================== */

describe("the number, as it is drawn", () => {
  let counts;
  let api;
  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "counts-lib-"));
    scratch.push(dir);
    const out = join(dir, "lib.mjs");
    await build({
      entryPoints: [join(SRC, "lib/useAlertCounts.tsx")],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "neutral",
      jsx: "automatic",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      external: ["react", "react/jsx-runtime"],
      define: { "import.meta.env": ENV },
    });
    counts = await import(pathToFileURL(out).href);

    const apiOut = join(dir, "api.mjs");
    await build({
      entryPoints: [join(SRC, "lib/api/alertCounts.ts")],
      outfile: apiOut,
      bundle: true,
      format: "esm",
      platform: "neutral",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      external: ["react", "react/jsx-runtime"],
      define: { "import.meta.env": ENV },
    });
    api = await import(pathToFileURL(apiOut).href);
  });

  test("⭐ nothing is drawn for nothing, which is what `0+` got wrong", () => {
    /* ⚠ THE BUG THIS REPLACES. The card rendered `${alerts.length}+` with no
       guard, so a site with nothing outstanding carried a pill reading `0+`
       -- a number that is both zero and claims there is more of it. */
    assert.equal(counts.countLabel(0), null);
    assert.equal(counts.countLabel(-3), null);
    assert.equal(counts.countLabel(Number.NaN), null);
    assert.equal(counts.countAria(0), null);
  });

  test("⭐ exact up to 99, and exactly one place in this product says +", () => {
    assert.equal(counts.countLabel(1), "1");
    assert.equal(counts.countLabel(7), "7");
    assert.equal(counts.countLabel(99), "99");
    /* ⚠ NINETY NINE IS NOT ABBREVIATED. The old code reached for a `+` at
       every number; this one reaches for it at exactly one boundary. */
    assert.ok(!counts.countLabel(99).includes("+"), "99 was abbreviated");
    assert.equal(counts.countLabel(100), "99+");
    assert.equal(counts.countLabel(5000), "99+");
  });

  test("and it is said in words for anybody who cannot see it", () => {
    assert.equal(counts.countAria(1), "1 unacknowledged alert");
    assert.equal(counts.countAria(3), "3 unacknowledged alerts");
    assert.equal(counts.countAria(400), "More than 99 unacknowledged alerts");
  });

  test("⭐ a device with nothing outstanding is ABSENT, not zero", () => {
    const parsed = api.parseCounts(COUNTS);
    assert.equal(parsed.total, 147);
    assert.equal(parsed.byDevice.get(EAST), 7);
    assert.equal(parsed.byDevice.get(NORTH), 140);
    assert.equal(parsed.byDevice.has(WEST), false);
    /* And a server that sends the zero anyway lands in the same place, so
       the two ways of saying it cannot draw two different cards. */
    const withZero = api.parseCounts({ total: 7, by_device: { [EAST]: 7, [WEST]: 0 } });
    assert.equal(withZero.byDevice.has(WEST), false);
  });

  test("a body that is not a count reads as none of it", () => {
    assert.equal(api.parseCounts({}).total, 0);
    assert.equal(api.parseCounts({ total: "lots" }).total, 0);
    assert.equal(api.parseCounts({ total: 4, by_device: null }).byDevice.size, 0);
    assert.equal(
      api.parseCounts({ by_device: { [EAST]: "three" } }).byDevice.size,
      0,
    );
  });

  test("⭐ the ack-all body carries up_to, and a scope only when there is one", () => {
    /* ⚠ ABSENT RATHER THAN null. The Alerts page is the fleet and has no
       site or tower selector, so it narrows nothing; a key carrying
       undefined would reach the server as `null`, which is a different
       claim from not mentioning it. */
    assert.deepEqual(api.ackAllBody("aaaa0001"), { up_to: "aaaa0001" });
    assert.deepEqual(api.ackAllBody("aaaa0001", { deviceId: EAST }), {
      up_to: "aaaa0001",
      device_id: EAST,
    });
    assert.deepEqual(api.ackAllBody("aaaa0001", { siteId: "site-7" }), {
      up_to: "aaaa0001",
      site_id: "site-7",
    });
    assert.deepEqual(api.ackAllBody("aaaa0001", { siteId: "", deviceId: "" }), {
      up_to: "aaaa0001",
    });
  });

  test("⭐ three event kinds move this number, and nothing else does", () => {
    for (const kind of ["alert.new", "alert.updated", "alerts.acknowledged"]) {
      assert.equal(counts.countsOnKind(kind), true, kind);
    }
    assert.equal(counts.countsOnKind("share.updated"), false);
    assert.equal(counts.countsOnKind("keepalive"), false);
  });
});

/* ======================================================================
 *  2. WHAT THE SDK WILL AND WILL NOT HAND ON
 * ====================================================================== */

describe("what reaches this side off the stream", () => {
  let sdk;
  before(async () => {
    sdk = await import(pathToFileURL(SDK).href);
  });

  const frame = (kind, body) =>
    `event: ${kind}\ndata: ${JSON.stringify(body)}\n\n`;

  test("⭐ a raise and an update both arrive, carrying their kind", () => {
    const buffer = new sdk.SseBuffer();
    const kinds = [];
    for (const f of buffer.push(
      frame("alert.new", ROWS[0]) + frame("alert.updated", ROWS[1]),
    )) {
      const event = sdk.alertEventOf(f);
      if (event) kinds.push(event.kind);
    }
    assert.deepEqual(kinds, ["alert.new", "alert.updated"]);
  });

  test("⚠ THE SDK DROPS `alerts.acknowledged`, SO DELETE THIS WHEN IT STOPS", () => {
    /* ⚠ A PENDING-DEPENDENCY TEST, and it is the shape CLAUDE.md asks for.
       The data centre sends a third kind when a bulk acknowledgement lands,
       and `alertEventOf` returns null for every frame that is not
       `alert.new` or `alert.updated` -- so `subscribeSiteAlerts` never hands
       it on and a bulk acknowledgement made in ANOTHER browser reaches these
       counts only if the server also pushes an update per row.

       Everything on this side is written for it: `countsOnKind` answers true
       for the name, `useSiteAlerts` passes the kind through rather than a
       bare signal, and the day the SDK forwards unknown kinds the change
       here is none at all.

       The change belongs in the sentry-sdk repository, which is the source of
       truth for the vendored copy and is NOT edited from here
       (`npm run check:sdk` fails the build if it is). When this test fails,
       that is the SDK having landed it: DELETE THIS TEST and assert the
       refetch on the real frame instead. */
    const buffer = new sdk.SseBuffer();
    const frames = [...buffer.push(frame("alerts.acknowledged", { count: 4 }))];
    assert.equal(frames.length, 1, "the frame itself did not even arrive");
    assert.equal(
      sdk.alertEventOf(frames[0]),
      null,
      "the SDK now forwards alerts.acknowledged: delete this test and wire the real frame",
    );
  });
});

/* ======================================================================
 *  3. THE SCREENS, IN A REAL BROWSER
 * ====================================================================== */

describe("the cards, the badge and Acknowledge all", () => {
  let browser;
  let page;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "counts-ui-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement, useCallback, useState } from "react";
       import { createRoot } from "react-dom/client";
       import { AlertsView } from "@/components/AlertsView";
       import { TowersPanel } from "@/components/TowersPanel";
       import { AuthProvider } from "@/components/AuthProvider";
       import { NotificationProvider } from "@/lib/notifications";
       import { useSiteAlerts } from "@/lib/useSiteAlerts";
       import {
         AlertCountsProvider,
         useAlertCountsFeed,
       } from "@/lib/useAlertCounts";
       import { ackAllSiteAlerts } from "@/lib/api/alertCounts";

       const TOWERS = (window as any).__towers;
       const noop = () => {};

       function Harness() {
         /* The shell's own wiring, not a simplification of it: one counts
            read, handed to the provider, and every frame on the alert
            channel noted so the count is re-read rather than polled. */
         const counts = useAlertCountsFeed(true);
         const nameOf = useCallback(
           (id: string) => TOWERS.find((t: any) => t.id === id)?.site,
           [],
         );
         const feed = useSiteAlerts({
           enabled: true,
           nameOf,
           onEvent: counts.noted,
         });
         (window as any).__feed = feed;
         (window as any).__counts = counts;
         /* The LOCAL alert the simulator still raises: no server row behind
            it, newer than everything, and deliberately in the list so the
            bound below can be shown to skip it. */
         const [local] = useState(() => [
           {
             id: "ALT-local-1",
             towerId: TOWERS[0].id,
             kind: "alert" as const,
             title: "Alert raised by Motion Sensor on Gas Yard",
             at: Date.now() + 60_000,
             status: "triggered" as const,
           },
         ]);
         const alerts = [...local, ...feed.alerts];
         const acknowledgeAll = useCallback(
           async (upTo: string) => {
             await ackAllSiteAlerts(upTo);
             await feed.relist();
             counts.reload();
           },
           [feed, counts],
         );
         return createElement(AlertCountsProvider, { value: counts },
           createElement(AuthProvider, null,
           createElement(NotificationProvider, null,
           createElement("div", { style: { display: "flex", height: "1000px" } },
             createElement(TowersPanel, {
               towers: TOWERS,
               alerts,
               onOpenTower: noop,
             }),
             createElement(AlertsView, {
               alerts,
               towers: TOWERS,
               onNavigate: noop,
               onBack: noop,
               onSetStatus: (id: string) => {
                 void feed.acknowledge(id).then(() => counts.reload()).catch(() => {});
               },
               nameOf,
               onAcknowledgeAll: acknowledgeAll,
             }),
           ))));
       }
       createRoot(document.getElementById("root")!).render(createElement(Harness));
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
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": ENV },
    });
    const bundle = await readFile(out, "utf8");

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );

    await page.evaluate(
      ([rows, colours, counts, towers]) => {
        const w = window;
        const NL = String.fromCharCode(10);
        w.__towers = towers;
        /* Mutable, so a test can change what the server would answer and
           then make the page go and ask again. */
        w.__serverCounts = counts;
        w.__countReads = 0;
        w.__ackAll = [];
        w.__alerts = new Map(rows.map((a) => [a.id, a]));

        const json = (body, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });

        w.fetch = async (url, init = {}) => {
          const path = String(url);
          const method = (init.method ?? "GET").toUpperCase();

          if (path.includes("/v1/capabilities")) {
            return json({ features: { sites: false } });
          }

          if (path.includes("/v1/viewer/events")) {
            const stream = new ReadableStream({
              start(controller) {
                w.__sse = controller;
                controller.enqueue(
                  new TextEncoder().encode("retry: 3000" + NL + ": open" + NL + NL),
                );
              },
            });
            return new Response(stream, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            });
          }

          if (path.includes("/v1/viewer/site-alerts/counts")) {
            w.__countReads += 1;
            return json(w.__serverCounts);
          }

          if (path.includes("/v1/viewer/site-alerts/ack-all") && method === "POST") {
            const body = JSON.parse(String(init.body ?? "{}"));
            w.__ackAll.push(body);
            /* The server's own answer: everything at or below the bound,
               and the local row is not on the wire so it is untouched. */
            const bound = w.__alerts.get(body.up_to);
            let n = 0;
            for (const [id, a] of w.__alerts) {
              if (a.acknowledged) continue;
              if (bound && a.started_epoch > bound.started_epoch) continue;
              w.__alerts.set(id, {
                ...a,
                acknowledged: true,
                acknowledged_by: "Terra Industries",
                rev: a.rev + 1,
              });
              n += 1;
            }
            w.__serverCounts = { total: 0, by_device: {} };
            return json({ acknowledged: n });
          }

          const ack = path.match(/\/v1\/viewer\/site-alerts\/([^/?]+)\/ack$/);
          if (ack && method === "POST") {
            const prev = w.__alerts.get(ack[1]);
            const next = { ...prev, acknowledged: true, rev: prev.rev + 1 };
            w.__alerts.set(ack[1], next);
            return json(next);
          }

          if (path.includes("/v1/viewer/site-alerts")) {
            return json({ alerts: [...w.__alerts.values()], colours });
          }
          throw new Error(`unrouted: ${method} ${path}`);
        };

        w.__push = (kind, alert) => {
          w.__alerts.set(alert.id, alert);
          const frame =
            `event: ${kind}` + NL + `data: ${JSON.stringify(alert)}` + NL + NL;
          w.__sse.enqueue(new TextEncoder().encode(frame));
        };
      },
      [
        ROWS,
        COLOURS,
        COUNTS,
        [
          { id: WEST, site: "West Tower", status: "online" },
          { id: EAST, site: "East Tower", status: "online" },
          { id: NORTH, site: "North Tower", status: "online" },
        ],
      ],
    );

    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.addScriptTag({ content: bundle });
    try {
      await page.waitForFunction(
        () => document.querySelectorAll("[data-tower-alert-count]").length > 0,
        { timeout: 10_000 },
      );
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
      throw new Error([err.message, "ERRORS", ...errors, "BODY", body].join(" | "));
    }
  });

  after(async () => {
    await browser?.close();
  });

  /** Every tower card's pill number, in the order the panel draws them. */
  const cardNumbers = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-tower-alert-count]")].map(
        (el) => el.textContent,
      ),
    );

  const badge = () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-alerts-badge]");
      return el ? el.textContent : null;
    });

  test("⭐ a card with nothing outstanding draws NO number, not `0+`", async () => {
    /* Three towers, and WEST is the one absent from `by_device`. Two pills
       carry a number and the third carries none at all. */
    assert.deepEqual(await cardNumbers(), ["7", "99+"]);
    const text = await page.textContent("body");
    assert.ok(!/0\+/.test(text), "a card is back to drawing 0+");
    assert.ok(!/\b7\+/.test(text), "a + was glued onto an exact count");
  });

  test("⭐ exact up to 99, `99+` above it, and the server's number not ours", async () => {
    /* 140 outstanding on NORTH, and the browser is holding exactly two of
       its rows. The old card would have said `2+`. */
    const [east, north] = await cardNumbers();
    assert.equal(east, "7");
    assert.equal(north, "99+");
  });

  test("the pill says it in words too", async () => {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("button[aria-label]")]
        .map((b) => b.getAttribute("aria-label"))
        .filter((l) => /unacknowledged|Nothing unacknowledged/.test(l ?? "")),
    );
    assert.ok(
      labels.some((l) => l.includes("7 unacknowledged alerts")),
      labels.join(" | "),
    );
    assert.ok(
      labels.some((l) => l.includes("More than 99 unacknowledged alerts")),
      labels.join(" | "),
    );
    assert.ok(
      labels.some((l) => l.includes("Nothing unacknowledged")),
      labels.join(" | "),
    );
  });

  test("⭐ the rail's Alerts icon carries the TOTAL, in one badge", async () => {
    assert.equal(await badge(), "99+");
    const label = await page.evaluate(
      () =>
        document.querySelector("[data-alerts-badge]")?.closest("button")
          ?.getAttribute("aria-label") ?? "",
    );
    assert.match(label, /^Alerts\. More than 99 unacknowledged alerts$/);
    /* One badge. Nothing else in the rail carries a number, or the first
       one stops meaning "this is where the outstanding work is". */
    const n = await page.evaluate(
      () => document.querySelectorAll("[data-alerts-badge]").length,
    );
    assert.equal(n, 1);
  });

  test("⭐ a frame on the live channel re-reads the count", async () => {
    const before = await page.evaluate(() => window.__countReads);
    /* ⚠ TWO FRAMES BACK TO BACK, WITHOUT AWAITING BETWEEN THEM. One frame
       at a time is the shape that hides a whole family of bugs in this
       codebase -- see the eager-state note in `useSiteAlerts` -- and a real
       incident is never one frame. */
    await page.evaluate(
      ([a, b]) => {
        window.__serverCounts = { total: 9, by_device: { [a.device_id]: 9 } };
        window.__push("alert.new", a);
        window.__push("alert.updated", b);
      },
      [
        { ...alertRow("eeee0005", EAST, 400), rev: 1 },
        { ...alertRow("eeee0005", EAST, 400), rev: 2 },
      ],
    );
    await page.waitForFunction(
      () => document.querySelector("[data-alerts-badge]")?.textContent === "9",
      { timeout: 5000 },
    );
    assert.ok(await page.evaluate(() => window.__countReads) > before);
    assert.deepEqual(await cardNumbers(), ["9"]);
  });

  test("⭐ and a BURST about one incident is one request, not three", async () => {
    /* ⚠ SPACED OUT IN TIME, WHICH IS WHAT THE DEBOUNCE IS ACTUALLY FOR.
       Frames pushed in one synchronous block are collapsed by React's own
       batching whether or not there is a debounce here, so that shape
       cannot see this. A real incident is a raise, then its clips, then its
       recovery, arriving on three separate reads of the stream -- three
       requests for one answer, of which the first two are thrown away by
       the third. All three land inside `COUNTS_DEBOUNCE_MS`. */
    const before = await page.evaluate(() => window.__countReads);
    for (const rev of [3, 4, 5]) {
      await page.evaluate(
        (a) => window.__push("alert.updated", a),
        { ...alertRow("eeee0005", EAST, 400), rev },
      );
      await page.waitForTimeout(80);
    }
    await page.waitForFunction(
      (n) => window.__countReads > n,
      before,
      { timeout: 5000 },
    );
    await page.waitForTimeout(700);
    assert.equal(
      await page.evaluate(() => window.__countReads),
      before + 1,
      "a burst of frames about one incident asked more than once",
    );
  });

  test("and it does not poll behind the stream", async () => {
    const before = await page.evaluate(() => window.__countReads);
    await page.waitForTimeout(1500);
    assert.equal(
      await page.evaluate(() => window.__countReads),
      before,
      "the counts are being polled beside an open stream",
    );
  });

  test("⭐ Acknowledge all names the number it is actually going to clear", async () => {
    await page.click("[data-ack-all]");
    const title = await page.textContent("#ackall-title");
    /* Five server rows by now (four seeded plus the one the stream
       delivered), one of them already acknowledged: four. The LOCAL row is
       unacknowledged too and is NOT in this number, because the write
       cannot reach it -- offering to clear five and clearing four is the
       kind of small lie that teaches somebody to check afterwards. The line
       above the button still counts it: six rows, one still waiting. */
    assert.equal(title.trim(), "Acknowledge all 4 alerts?");
    assert.match(
      await page.textContent("#ackall-body"),
      /Alerts that arrive after this stay unacknowledged/,
    );
    await page.click("[data-ack-all-confirm]");
  });

  test("⭐ and the bound is the newest SERVER row, never the local one", async () => {
    const body = await page.evaluate(() => window.__ackAll);
    assert.equal(body.length, 1, "the dialog did not send exactly one request");
    /* `eeee0005` is the newest row the stream delivered, and `ALT-local-1`
       is newer still and has no server id at all. A local id as `up_to` is
       an id the server has never heard of. */
    assert.deepEqual(body[0], { up_to: "eeee0005" });
    assert.ok(
      !JSON.stringify(body[0]).includes("ALT-local"),
      "a local alert id reached the wire",
    );
    /* No scope: the Alerts page is the fleet and narrows nothing. */
    assert.equal("site_id" in body[0], false);
    assert.equal("device_id" in body[0], false);
  });

  test("⭐ afterwards the list, the cards and the badge all go quiet", async () => {
    await page.waitForFunction(
      () => document.querySelector("[data-alerts-badge]") === null,
      { timeout: 5000 },
    );
    assert.equal(await badge(), null);
    assert.deepEqual(await cardNumbers(), []);
    /* The rows themselves, re-read rather than written optimistically. The
       local one is untouched, so one is still waiting. */
    await page.waitForFunction(
      () => /1 of 6 not yet acknowledged/.test(document.body.innerText),
      { timeout: 5000 },
    );
  });

  test("⭐ and the button is disabled once there is nothing left on the wire", async () => {
    assert.equal(
      await page.evaluate(
        () => document.querySelector("[data-ack-all]")?.disabled,
      ),
      true,
      "Acknowledge all is still pressable with nothing to acknowledge",
    );
    /* Disabled rather than gone: a control that comes and goes is one an
       operator stops looking for. */
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll("[data-ack-all]").length,
      ),
      1,
    );
  });

  test("⭐ a date filter narrows the view and does NOT narrow the write", async () => {
    /* ⚠ THE ROUTE TAKES AN UPPER BOUND AND NO LOWER ONE, because there is
       no sensible lower bound for "I have read everything down to here". So
       with a filter on, pressing this clears the rows in front of the
       operator AND everything older than them -- and a dialog saying "1"
       over a write that touches two is the kind of small lie that teaches
       somebody to check afterwards every time. The dialog states the number
       the WRITE will reach, which is a number they can cancel on. */
    const now = Math.floor(Date.now() / 1000);
    await page.evaluate(
      ([fresh, old]) => {
        window.__push("alert.new", old);
        window.__push("alert.new", fresh);
      },
      [
        { ...alertRow("ffff0006", EAST, 0), started_epoch: now },
        { ...alertRow("gggg0007", EAST, 0), started_epoch: now - 5 * 86400 },
      ],
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-alert-dot]").length >= 7,
      { timeout: 5000 },
    );

    await page.click('[aria-label="Filter alerts by date"]');
    await page.click('[aria-label="Time range"] button:has-text("Today")');
    await page.click('[aria-label="Time range"] button:has-text("Apply")');
    await page.waitForFunction(
      () => /Today/.test(document.body.innerText),
      { timeout: 5000 },
    );

    /* One row on screen, and two unacknowledged rows at or below it. */
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll("[data-alert-dot]").length,
      ),
      1,
    );
    await page.click("[data-ack-all]");
    assert.equal(
      (await page.textContent("#ackall-title")).trim(),
      "Acknowledge all 2 alerts?",
    );
    await page.click("[data-ack-all-cancel]");
    /* Put the screen back, so nothing after this inherits a filter. */
    await page.click('[aria-label="Clear date filter"]');
  });

  test("Escalate is still disabled and there is still no Resolve", async () => {
    const text = await page.textContent("body");
    assert.ok(!/\bResolve\b/.test(text), "a Resolve control appeared");
  });
});

/* ======================================================================
 *  4. THE FOOTAGE DROPDOWN SAYS WHY
 * ====================================================================== */

describe("the Footage screen, when the tower list cannot be read", () => {
  let browser;
  let page;
  let bundle;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "footage-reason-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement } from "react";
       import { createRoot } from "react-dom/client";
       import { FootageView } from "@/components/FootageView";
       const noop = () => {};
       createRoot(document.getElementById("root")!).render(
         createElement(FootageView, {
           clipsOpen: false,
           onClipsOpen: noop,
         }),
       );
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
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": ENV },
    });
    bundle = await readFile(out, "utf8");
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
  });

  /** A fresh page whose tower list answers `status`, then the screen. */
  async function mount(status) {
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    await page.evaluate((s) => {
      const w = window;
      w.__status = s;
      w.__towerReads = 0;
      w.fetch = async (url) => {
        const path = String(url);
        if (path.includes("/v1/viewer/recordings/towers")) {
          w.__towerReads += 1;
          if (w.__status !== 200) {
            /* The server's own code, not one word for every failure: a 403
               and a 500 are two different answers and the screen has to be
               able to tell them apart. */
            const code = w.__status === 403 ? "forbidden" : "server_error";
            return new Response(
              JSON.stringify({ error: { code, message: "no" } }),
              { status: w.__status, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              towers: [
                {
                  device_id: "kln_lab_000002",
                  label: "West Tower",
                  online: true,
                  cameras: [1, 2],
                  has_recordings: true,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path.includes("/v1/viewer/recordings")) {
          return new Response(
            JSON.stringify({ device_id: "", camera: null, archive_enabled: true, segments: [] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
    }, status);
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector("[data-towers-problem], select[aria-label=Tower]", {
      timeout: 10_000,
    });
  }

  test("⭐ a 403 says so, and offers nothing that cannot work", async () => {
    await mount(403);
    const text = await page.textContent("[data-towers-problem]");
    assert.match(text, /Footage isn't available for this account\./);
    /* ⚠ NO RETRY ON A REFUSAL. An account that may not see footage will not
       be able to in ten seconds either, and a button that can only produce
       the same 403 teaches somebody to distrust every other Try again. */
    assert.ok(!/Try again/.test(text), "a refusal offered a retry");
    /* ⚠ AND NO EMPTY DROPDOWN, WHICH IS THE BUG. The select used to render
       with no options and no explanation at all. */
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll("select[aria-label=Tower]").length,
      ),
      0,
      "the empty dropdown is back",
    );
    await page.close();
  });

  test("⭐ anything else offers a retry, and the retry actually asks again", async () => {
    await mount(500);
    assert.match(
      await page.textContent("[data-towers-problem]"),
      /Couldn't load towers\. Try again\./,
    );
    assert.equal(await page.evaluate(() => window.__towerReads), 1);

    /* The second answer is a good one, so the screen recovers rather than
       needing a reload. */
    await page.evaluate(() => {
      window.__status = 200;
    });
    await page.click("[data-towers-problem] button");
    await page.waitForSelector("select[aria-label=Tower]", { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__towerReads), 2);
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll("[data-towers-problem]").length,
      ),
      0,
    );
    assert.match(await page.textContent("select[aria-label=Tower]"), /WEST TOWER/);
    await page.close();
  });

  test("⭐ and a list that simply works still draws no sentence", async () => {
    await mount(200);
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll("[data-towers-problem]").length,
      ),
      0,
    );
    await page.close();
  });
});
