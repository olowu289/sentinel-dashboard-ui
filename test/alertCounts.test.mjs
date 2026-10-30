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
 * ⭐ AND AS OF `@kallon/sentry-sdk@0.14.0` BOTH ROUTES ARE THE SDK'S. The
 * two hand-rolled fetches that stood in for them are gone, `AlertEvent` is a
 * union because a batch acknowledgement carries no row, and `ack-all` takes a
 * `from` -- so the sweep is a WINDOW and the dialog states the number on
 * screen rather than the larger number a lower-bound-less write would reach.
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
  let filter;
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

    const filterOut = join(dir, "filter.mjs");
    await build({
      entryPoints: [join(SRC, "lib/dateFilter.ts")],
      outfile: filterOut,
      bundle: true,
      format: "esm",
      platform: "neutral",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "import.meta.env": ENV },
    });
    filter = await import(pathToFileURL(filterOut).href);
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
    /* The SDK validates the wire and un-snake-cases it; what is left on
       this side is the shape the screens read and the one distinction that
       must not reach a card. */
    const parsed = api.countsFrom({
      total: 147,
      byDevice: { [EAST]: 7, [NORTH]: 140 },
    });
    assert.equal(parsed.total, 147);
    assert.equal(parsed.byDevice.get(EAST), 7);
    assert.equal(parsed.byDevice.get(NORTH), 140);
    assert.equal(parsed.byDevice.has(WEST), false);
    /* And a server that sends the zero anyway lands in the same place, so
       the two ways of saying it cannot draw two different cards. A pill
       reading `0` is a claim about a site; absence is not. */
    const withZero = api.countsFrom({
      total: 7,
      byDevice: { [EAST]: 7, [WEST]: 0 },
    });
    assert.equal(withZero.byDevice.has(WEST), false);
    assert.equal(api.countsFrom({ total: 0, byDevice: {} }).total, 0);
  });

  test("⭐ the near bound of a date filter is an instant, stated in UTC", () => {
    /* ⚠ THE SWEEP IS A WINDOW AND THIS IS ITS NEAR END. The rolling
       presets are arithmetic off the clock the list was rendered with; the
       calendar ones are midnight AT THE SITE, which for Lagos is 23:00 the
       day before in UTC -- and a local wall clock with no offset at all is
       how a server reads it as its own and acknowledges a window an hour
       away from the one on screen. */
    const now = Date.UTC(2026, 9, 29, 9, 30, 0);
    assert.equal(filter.filterStart({ range: "all" }, now), null);
    assert.equal(filter.filterFromIso({ range: "all" }, now), undefined);
    assert.equal(
      filter.filterFromIso({ range: "1h" }, now),
      "2026-10-29T08:30:00.000Z",
    );
    assert.equal(
      filter.filterFromIso({ range: "24h" }, now),
      "2026-10-28T09:30:00.000Z",
    );
    assert.equal(
      filter.filterFromIso({ range: "7d" }, now),
      "2026-10-22T09:30:00.000Z",
    );
    /* Africa/Lagos is UTC+1 all year, so the site's 29th began at 23:00Z on
       the 28th -- not at midnight UTC, and not at the viewer's midnight. */
    assert.equal(
      filter.filterFromIso({ range: "today" }, now),
      "2026-10-28T23:00:00.000Z",
    );
    assert.equal(
      filter.filterFromIso({ range: "custom", from: "2026-10-20" }, now),
      "2026-10-19T23:00:00.000Z",
    );
    /* An upper bound alone has no near end. The anchor is the far end and
       does not need a second opinion. */
    assert.equal(
      filter.filterFromIso({ range: "custom", to: "2026-10-20" }, now),
      undefined,
    );
  });

  test("⭐ the near bound agrees with the list it describes", () => {
    /* The bound and the filter are two readings of one statement, written
       as two functions. A row on screen whose own instant falls before the
       bound sent with the sweep is a row the operator saw and the write
       would skip, which is the bug this pins rather than the arithmetic. */
    const now = Date.UTC(2026, 9, 29, 9, 30, 0);
    for (const range of ["1h", "24h", "7d", "today"]) {
      const start = filter.filterStart({ range }, now);
      const rows = [
        { at: start - 1, id: "before" },
        { at: start, id: "edge" },
        { at: now, id: "now" },
      ];
      const visible = filter
        .applyDateFilter(rows, { range }, now)
        .map((a) => a.id);
      assert.deepEqual(visible, ["edge", "now"], range);
    }
  });

  test("⭐ a refused sweep says WHICH mistake, in the server's own words", () => {
    /* ⚠ THREE MISTAKES, THREE REMEDIES, and only the server knows which:
       an anchor it could not resolve, a date it could not read, and a range
       that ends before it starts. One sentence of ours covering all three
       would have to say "try again", which is useless advice for two of
       them. */
    for (const sentence of [
      "That list is out of date. Reload the alerts and try again.",
      "Those dates could not be read. Choose the date range again.",
      "That date range ends before it starts. Choose the dates again.",
    ]) {
      assert.equal(
        api.describeAckAllFailure({
          status: 400,
          code: "invalid_request",
          message: sentence,
        }),
        sentence,
      );
    }
  });

  test("⚠ but the wire never reaches the screen dressed as a sentence", () => {
    /* The SDK synthesises `message` from the first 200 characters of a body
       that is not the error envelope -- a proxy's HTML page, or `HTTP 400`
       for a status with no body at all. Those are not sentences written for
       an operator, and putting one on screen would break the first writing
       rule in the loudest possible way. */
    const ours = "Couldn't acknowledge those alerts. Try again.";
    for (const message of [
      "<html><head><title>400 Bad Request</title></head>",
      "HTTP 400",
      "invalid_request",
      "bad",
      "That list is out of date",
      "x".repeat(400) + ".",
    ]) {
      assert.equal(
        api.describeAckAllFailure({
          status: 400,
          code: "invalid_request",
          message,
        }),
        ours,
        message.slice(0, 30),
      );
    }
    /* And the failures that are not this route's three mistakes keep their
       own one sentence each. */
    assert.match(
      api.describeAckAllFailure({
        status: 403,
        code: "not_authorized",
        message: "no",
      }),
      /permission/,
    );
    assert.match(
      api.describeAckAllFailure({
        status: 0,
        code: "network_error",
        message: "no",
      }),
      /connection/,
    );
    assert.equal(api.describeAckAllFailure(new Error("boom")), ours);
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

  test("⭐ and so does a batch acknowledgement, which carries no alert", () => {
    /* ⚠ THIS USED TO BE A PENDING-DEPENDENCY TEST asserting the OPPOSITE:
       the third kind existed on the wire and `alertEventOf` returned null
       for every frame that was not `alert.new` or `alert.updated`, so
       `subscribeSiteAlerts` dropped it and a screenful cleared in another
       browser reached these counts only if the server also pushed an update
       per row. This side was written for the kind it could not receive, with
       a test that said in its own failure message to delete itself.

       `@kallon/sentry-sdk@0.14.0` landed it, so this is that deletion, as
       the assertion rather than as an absence. */
    const buffer = new sdk.SseBuffer();
    const frames = [
      ...buffer.push(frame("alerts.acknowledged", { count: 4, from: "2026-10-28T23:00:00Z" })),
    ];
    assert.equal(frames.length, 1, "the frame itself did not even arrive");
    const event = sdk.alertEventOf(frames[0]);
    assert.equal(event.kind, "alerts.acknowledged");
    assert.equal(event.count, 4);
    /* ⚠ AND IT NAMES NO ALERTS, which is the whole reason `AlertEvent`
       had to become a union. ONE frame stands for the whole batch -- an
       `alert.updated` per row would close the channel of every browser
       watching a busy site for falling behind -- so there is no row to
       upsert and nothing to edit locally. `event.alert.id` here is a crash
       the first time a colleague clears a screenful, and the narrowing is
       what stops it being written. */
    assert.equal(sdk.isAlertRowEvent(event), false);
    assert.equal("alert" in event, false);
    assert.equal(sdk.isAlertRowEvent(sdk.alertEventOf([...new sdk.SseBuffer().push(frame("alert.new", ROWS[0]))][0])), true);
  });

  test("the defensive read of a count MOVED into the SDK, it did not vanish", () => {
    /* This side used to read the counts body field by field, because it was
       reading it off a raw response. It does not any more, and the thing
       worth checking is that the validation went with the parsing rather
       than being dropped on the way. */
    assert.deepEqual(
      sdk.parseSiteAlertCounts({ total: 147, by_device: { [EAST]: 7 } }),
      { total: 147, byDevice: { [EAST]: 7 } },
    );
    assert.throws(() => sdk.parseSiteAlertCounts({ total: "lots", by_device: {} }));
    assert.throws(() => sdk.parseSiteAlertCounts({ total: 4, by_device: null }));
    assert.throws(() =>
      sdk.parseSiteAlertCounts({ total: 4, by_device: { [EAST]: "three" } }),
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
           async (upTo: string, from?: string) => {
             await ackAllSiteAlerts(upTo, from === undefined ? {} : { from });
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
        w.__streams = 0;
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
            /* Counted. A frame must not cost a reconnection: a node holds
               at most 64 streams, and a handler that throws takes the loop
               down with it and is recovered by one. */
            w.__streams += 1;
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
            /* A refusal armed by a test, used once. A 400 from this route
               changes nothing, so nothing below runs. */
            const refusal = w.__ackAllRefusal;
            if (refusal) {
              w.__ackAllRefusal = null;
              return new Response(refusal.body, {
                status: refusal.status,
                headers: { "content-type": refusal.type },
              });
            }
            /* The server's own answer, and it honours BOTH ends of the
               window: at or after `from`, no newer than the anchor. The
               local row is not on the wire, so it is untouched either way. */
            const bound = w.__alerts.get(body.up_to);
            const from =
              body.from === undefined
                ? null
                : Math.floor(Date.parse(body.from) / 1000);
            let n = 0;
            for (const [id, a] of w.__alerts) {
              if (a.acknowledged) continue;
              if (bound && a.started_epoch > bound.started_epoch) continue;
              if (from !== null && a.started_epoch < from) continue;
              w.__alerts.set(id, {
                ...a,
                acknowledged: true,
                acknowledged_by: "Terra Industries",
                rev: a.rev + 1,
              });
              n += 1;
            }
            w.__recount();
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
          w.__pushRaw(kind, alert);
        };

        /* A frame that is NOT a row. `alerts.acknowledged` names no alerts,
           so there is nothing to put in the store beside it. */
        w.__pushRaw = (kind, data) => {
          const frame =
            `event: ${kind}` + NL + `data: ${JSON.stringify(data)}` + NL + NL;
          w.__sse.enqueue(new TextEncoder().encode(frame));
        };

        /* What the counts route would answer about the rows as they stand.
           Tests that are about the NUMBER still override `__serverCounts`
           directly, so a count this side derived for itself could never
           pass for the server's. */
        w.__recount = () => {
          const by = {};
          let total = 0;
          for (const a of w.__alerts.values()) {
            if (a.acknowledged) continue;
            by[a.device_id] = (by[a.device_id] ?? 0) + 1;
            total += 1;
          }
          w.__serverCounts = { total, by_device: by };
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
    /* ⚠ AND NO `from`, BECAUSE THE LIST WAS NOT FILTERED. The near bound
       is the date filter's start and there was no date filter: an unfiltered
       feed is "everything I can see down to this row", which is exactly what
       an anchor alone says. Sending a `from` here would invent a floor the
       operator never set. */
    assert.equal("from" in body[0], false);
    /* No scope either: the Alerts page is the fleet and narrows nothing. */
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

  test("⭐ a date filter sends the window it is showing, and nothing older", async () => {
    /* ⭐ THE CASE THIS ROUND EXISTS FOR. The route used to take an upper
       bound and no lower one, so pressing this on a filtered view cleared
       the rows in front of the operator AND everything older than them --
       a week nobody had looked at, cleared by a click on a screen showing
       Tuesday. The dialog had to state the larger number for that reason,
       which was the honest half of a bad bargain: the operator was agreeing
       to rows they could not see.

       `from` closes it. Two rows here, one from today and one from five
       days ago; the filter shows the first, the dialog says one, and the
       old row is still waiting afterwards. */
    const now = Math.floor(Date.now() / 1000);
    await page.evaluate(
      ([fresh, old]) => {
        window.__push("alert.new", old);
        window.__push("alert.new", fresh);
        window.__recount();
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
    await page.waitForFunction(() => /Today/.test(document.body.innerText), {
      timeout: 5000,
    });

    /* One row on screen, and the dialog says one. It used to say two. */
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll("[data-alert-dot]").length,
      ),
      1,
    );
    const sent = await page.evaluate(() => window.__ackAll.length);
    await page.click("[data-ack-all]");
    assert.equal(
      (await page.textContent("#ackall-title")).trim(),
      "Acknowledge all 1 alert?",
    );
    await page.click("[data-ack-all-confirm]");
    await page.waitForFunction(
      (n) => window.__ackAll.length > n,
      sent,
      { timeout: 5000 },
    );

    const body = (await page.evaluate(() => window.__ackAll)).at(-1);
    assert.equal(body.up_to, "ffff0006");
    /* ⚠ AN INSTANT IN UTC, SAID OUT LOUD, AND THE SITE'S MIDNIGHT RATHER
       THAN THE VIEWER'S. Africa/Lagos is UTC+1 all year, so the site's day
       began at 23:00Z the evening before. A bare local wall clock would be
       read by the server as its own and would acknowledge a window an hour
       away from the one on screen. */
    assert.match(body.from, /^\d{4}-\d{2}-\d{2}T23:00:00\.000Z$/);
    assert.ok(
      Date.parse(body.from) / 1000 <= now,
      "the window starts after the row it was meant to include",
    );

    /* And the five-day-old row is still outstanding: one server row plus
       the local one, which the write could never reach. */
    await page.click('[aria-label="Clear date filter"]');
    await page.waitForFunction(
      () => /2 of 8 not yet acknowledged/.test(document.body.innerText),
      { timeout: 5000 },
    );
    assert.equal(await badge(), "1");
  });

  test("⭐ a refusal shows the SERVER's sentence, and changes nothing", async () => {
    /* ⚠ THREE MISTAKES, THREE REMEDIES. A 400 here is a stale anchor, a
       date that could not be read, or a range ending before it starts --
       and only the server knows which, so it is the server's sentence that
       goes on screen. Ours would have to say "try again", which is useless
       advice for two of the three. */
    await page.evaluate(() => {
      window.__ackAllRefusal = {
        status: 400,
        type: "application/json",
        body: JSON.stringify({
          error: {
            code: "invalid_request",
            message: "That list is out of date. Reload the alerts and try again.",
          },
        }),
      };
    });
    await page.click("[data-ack-all]");
    await page.click("[data-ack-all-confirm]");
    await page.waitForSelector("[data-ack-problem]", { timeout: 5000 });
    assert.equal(
      (await page.textContent("[data-ack-problem]")).trim(),
      "That list is out of date. Reload the alerts and try again.",
    );
    /* Nothing was written optimistically, so there is nothing to roll back:
       the row is exactly as outstanding as it was. */
    assert.equal(await badge(), "1");
    assert.match(
      await page.textContent("body"),
      /2 of 8 not yet acknowledged/,
    );
  });

  test("⚠ but a gateway's own page is not a sentence, and ours is used", async () => {
    /* The SDK synthesises `message` from the first 200 characters of a body
       that is not the error envelope. A proxy's HTML 400 is not written for
       an operator. */
    await page.evaluate(() => {
      window.__ackAllRefusal = {
        status: 400,
        type: "text/html",
        body: "<html><head><title>400 Bad Request</title></head><body>nginx</body></html>",
      };
    });
    await page.click("[data-ack-all]");
    await page.click("[data-ack-all-confirm]");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-ack-problem]")?.textContent?.trim() ===
        "Couldn't acknowledge those alerts. Try again.",
      { timeout: 5000 },
    );
    assert.equal(await badge(), "1");
  });

  test("⭐ a sweep made in ANOTHER browser arrives as one frame, and is re-read", async () => {
    /* ⭐ THE THIRD KIND, END TO END. A batch acknowledgement is ONE
       `alerts.acknowledged` frame for the whole sweep -- never an
       `alert.updated` per row, which would close the channel of every
       browser watching a busy site -- and it names no alerts. So it cannot
       be applied to the rows this browser holds, and both the count and the
       list have to be asked for again. Before SDK 0.14.0 the frame did not
       reach this side at all, and a screenful cleared next door stayed
       outstanding on this screen until the next drop recovery. */
    const reads = await page.evaluate(() => window.__countReads);
    const streams = await page.evaluate(() => window.__streams);
    await page.evaluate(() => {
      /* The server's side of it: the rows are acknowledged and the count
         has moved. Nothing in the frame says so. */
      for (const [id, a] of window.__alerts) {
        if (!a.acknowledged) {
          window.__alerts.set(id, {
            ...a,
            acknowledged: true,
            acknowledged_by: "Terra Industries",
            rev: a.rev + 1,
          });
        }
      }
      window.__recount();
      window.__pushRaw("alerts.acknowledged", { count: 1 });
    });

    /* The count, re-read rather than adjusted. */
    await page.waitForFunction(
      (n) => window.__countReads > n,
      reads,
      { timeout: 5000 },
    );
    await page.waitForFunction(
      () => document.querySelector("[data-alerts-badge]") === null,
      { timeout: 5000 },
    );
    /* And the LIST, re-read too -- otherwise the row would keep reading
       "Not acknowledged" here while another screen showed it handled. Only
       the local alert is left, and it is the one the sweep cannot touch. */
    await page.waitForFunction(
      () => /1 of 8 not yet acknowledged/.test(document.body.innerText),
      { timeout: 5000 },
    );
    assert.deepEqual(await cardNumbers(), []);
    /* ⚠ AND THE CHANNEL IS STILL THE SAME CHANNEL. This is the assertion
       that tells the narrowing from the lack of it: reading `event.alert`
       off this frame throws inside the handler, the SDK's loop dies with
       it, and the recovery re-reads the list and reconnects -- which looks
       from the outside exactly like the correct behaviour, right down to
       the count moving and the rows going quiet. What it costs is a socket
       per batch acknowledgement, against a node that holds 64 of them. */
    assert.equal(
      await page.evaluate(() => window.__streams),
      streams,
      "a batch acknowledgement cost a reconnection",
    );
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
