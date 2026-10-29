/**
 * THE ALERT FEED IS REAL. Every row in it was raised by a hub watching a mast.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS REPLACED, AND WHY THE TESTS ARE SHAPED LIKE THIS
 * ══════════════════════════════════════════════════════════════════════
 *
 * Six fixtures in `lib/data.ts`, loaded on every fleet, naming TWR-1042 and
 * TWR-2071 — towers no account has. They were counted on real tower cards and
 * spoken for by the new-alert banner, and `App.tsx` said so in a block headed
 * "FIXTURE ALERTS, ON EVERY FLEET — NOT REAL DETECTIONS".
 *
 * So the first thing every browser test here does is go through the real
 * `SentryClient` over a routed `fetch`. Nothing is handed a parsed object:
 * the list is JSON on the wire, the stream is SSE frames in a `ReadableStream`,
 * and the acknowledgement is a POST whose RESPONSE is what the screen must
 * believe. A test that injected shaped alerts would prove the components and
 * nothing about the thing that was actually missing.
 *
 * ── TWO HARNESS TRICKS, BOTH DELIBERATE ──────────────────────────────
 *
 * 1. `HTMLMediaElement.prototype.play` and `currentTime` are replaced with
 *    recording stand-ins. A `<video>` with no decodable media ignores a
 *    `currentTime` write and rejects `play()`, so the synchronised transport —
 *    one play, one scrub, two cameras — would be untestable against the real
 *    element and is exactly the thing worth testing.
 * 2. Clip URLs point at a host that does not resolve, so the element's own
 *    `error` fires for real. What happened is then asked through the ROUTED
 *    fetch, which is precisely how the component does it: a `MediaError` has
 *    no status in it, and an expired ticket and a swept file need opposite
 *    responses.
 *
 *   node --test test/siteAlerts.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/* ⚠ TERRA INDUSTRIES, NEVER kaduna-mine. Two of this account's own masts. */
const WEST = "kln_lab_000002";
const EAST = "kln_lab_000003";
const NAMES = { [WEST]: "West Tower", [EAST]: "East Tower" };

/** The map the list endpoint sends, from `sitealerts.COLOURS`. */
const COLOURS = {
  TOWER_OFFLINE: "red",
  CAMERA_STOPPED: "orange",
  TOWER_ONLINE: "green",
  FOOTAGE_RECOVERING: "purple",
  FOOTAGE_RECOVERED: "teal",
};

const EPOCH = 1793189400;
const clip = (camera, quality, key) => ({
  camera,
  quality,
  key,
  start: "2026-10-28T12:09:00Z",
  start_epoch: EPOCH - 60,
  duration: 60,
  size: 7_812_345,
  filename: `westtower_cam${camera}_${quality}.mp4`,
  /* A host that does not resolve, so the element's own `error` fires. */
  url: `https://clips.invalid/${key}`,
  download_url: `https://clips.invalid/${key}?dl=1`,
});

const OFFLINE_ALERT = {
  id: "aaaa0000",
  type: "TOWER_OFFLINE",
  colour: "red",
  device_id: WEST,
  cameras: [1, 2],
  started_at: "2026-10-28T12:10:00Z",
  started_epoch: EPOCH,
  acknowledged: false,
  best_quality: "standard",
  clips: [clip(1, "standard", "c1"), clip(2, "standard", "c2")],
  rev: 1,
};

const STOPPED_ALERT = {
  id: "bbbb1111",
  type: "CAMERA_STOPPED",
  colour: "orange",
  device_id: EAST,
  cameras: [1],
  started_at: "2026-10-28T11:59:03Z",
  started_epoch: EPOCH - 600,
  recovered_at: "2026-10-28T12:04:10Z",
  acknowledged: true,
  acknowledged_by: "Terra Industries",
  acknowledged_at: "2026-10-28T12:05:00Z",
  best_quality: "standard",
  clips: [clip(1, "standard", "c3")],
  rev: 3,
};

/** Back online, and its clips land about 60 s later — so none yet. */
const ONLINE_ALERT = {
  id: "cccc2222",
  type: "TOWER_ONLINE",
  colour: "green",
  device_id: WEST,
  cameras: [1, 2],
  started_at: "2026-10-28T12:20:00Z",
  started_epoch: EPOCH + 600,
  acknowledged: false,
  rev: 1,
};

const RECOVERING_ALERT = {
  id: "dddd3333",
  type: "FOOTAGE_RECOVERING",
  colour: "purple",
  device_id: WEST,
  started_at: "2026-10-28T12:25:00Z",
  started_epoch: EPOCH + 900,
  acknowledged: false,
  progress: { files_left: 6, bytes_left: 4_294_967_296, progress: 0.25, eta_sec: 1718 },
  rev: 2,
};

/** A type this bundle was built before. The server names its colour anyway. */
const UNKNOWN_ALERT = {
  id: "eeee4444",
  type: "GENERATOR_LOW",
  colour: "grey",
  device_id: EAST,
  started_at: "2026-10-28T12:30:00Z",
  started_epoch: EPOCH + 1200,
  acknowledged: false,
  rev: 1,
};

const LIST = {
  alerts: [UNKNOWN_ALERT, RECOVERING_ALERT, ONLINE_ALERT, OFFLINE_ALERT, STOPPED_ALERT],
  colours: COLOURS,
};

/* ======================================================================
 *  1. THE WORDS, AND THE COLOURS, AS PURE FUNCTIONS
 * ====================================================================== */

describe("every word an alert is read in", () => {
  let copy;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "alert-copy-"));
    scratch.push(dir);
    const out = join(dir, "alertCopy.mjs");
    await build({
      entryPoints: [join(SRC, "lib/alertCopy.ts")],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "neutral",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "import.meta.env": ENV },
    });
    copy = await import(`file://${out.replace(/\\/g, "/")}`);
  });

  const nameOf = (id) => NAMES[id];

  test('⭐ a tower is OFFLINE, and never "down"', () => {
    /* docs/alerts.md §1, in the hub's own words: a hub cannot tell a dead
       tower from a dead radio link, and "down" asserts the first. This is the
       one piece of wording that repository owes this one. */
    const title = copy.alertTitle(OFFLINE_ALERT, nameOf);
    assert.equal(title, "WEST TOWER offline");
    assert.ok(!/down/i.test(title));
  });

  test("⭐ and the name is in capitals, because it is a device's", () => {
    /* A title is a string built in JavaScript, so a `uppercase` class could
       never reach it — which is the exact failure `deviceName` exists for, and
       this line is the one read out over a radio. */
    assert.match(copy.alertTitle(OFFLINE_ALERT, nameOf), /^WEST TOWER/);
    /* And with no fleet to ask, the id rather than a blank. */
    assert.equal(copy.alertTitle(OFFLINE_ALERT), "KLN_LAB_000002 offline");
  });

  test("⭐ a stopped camera says so, and says when it came back", () => {
    /* Recovery is written onto the SAME row rather than raising a second
       alert, so the one title has to carry both halves. */
    const title = copy.alertTitle(STOPPED_ALERT, nameOf);
    assert.match(title, /^CAMERA 1 camera stopped working\. Back at /);
    /* Wall clock, in site time. Lagos is UTC+1, so 12:04:10Z is 13:04. */
    assert.match(title, /01:04/);
  });

  test("and while it is still down there is no Back at", () => {
    const live = { ...STOPPED_ALERT, recovered_at: undefined };
    assert.equal(copy.alertTitle(live, nameOf), "CAMERA 1 camera stopped working");
  });

  test("the other three read as the hub meant them", () => {
    assert.equal(copy.alertTitle(ONLINE_ALERT, nameOf), "WEST TOWER back online");
    assert.equal(
      copy.alertTitle(RECOVERING_ALERT, nameOf),
      "Recovering footage from WEST TOWER",
    );
    assert.equal(
      copy.alertTitle({ ...RECOVERING_ALERT, type: "FOOTAGE_RECOVERED" }, nameOf),
      "Footage recovered from WEST TOWER",
    );
  });

  test("⭐ a type this build has never heard of gets a SENTENCE, not its code", () => {
    /* `GENERATOR_LOW` on a customer's screen is the third writing rule broken
       in the loudest possible place. And it must not be dropped either: an
       operator who reads "something happened at EAST TOWER" goes and looks. */
    const title = copy.alertTitle(UNKNOWN_ALERT, nameOf);
    assert.equal(title, "Something happened at EAST TOWER");
    assert.ok(!/GENERATOR/.test(title));
    assert.ok(!/_/.test(title));
  });

  test("no title anywhere carries an em-dash or an internal word", () => {
    const all = [OFFLINE_ALERT, STOPPED_ALERT, ONLINE_ALERT, RECOVERING_ALERT, UNKNOWN_ALERT];
    for (const a of all) {
      const title = copy.alertTitle(a, nameOf);
      assert.ok(!title.includes("—"), title);
      assert.ok(!/\b(sub|main|stream|node|tunnel|OID|SNMP)\b/i.test(title), title);
    }
  });

  test('⭐ a recovery says how much is left, and says "about"', () => {
    /* An ETA over a radio link whose rate changes with the weather is an
       estimate. A bare "29 min left" is read as a promise. */
    const line = copy.recoveryDetail(RECOVERING_ALERT);
    assert.equal(line, "6 files, about 29 min left");
    assert.match(line, /about/);
  });

  test("and nothing at all once there is nothing left to say", () => {
    assert.equal(copy.recoveryDetail({ ...RECOVERING_ALERT, progress: undefined }), undefined);
    assert.equal(copy.recoveryDetail({ ...RECOVERING_ALERT, progress: {} }), undefined);
  });

  test("⭐ the bar comes from the server's own fraction, never from the file count", () => {
    /* The hub knows the denominator — how big the backlog was when the
       recovery armed — and this side does not. A bar derived from a falling
       count against a total nobody told us runs BACKWARDS the moment the
       tower writes a new segment while the old ones drain. */
    assert.equal(copy.recoveryProgress(RECOVERING_ALERT), 0.25);
    assert.equal(copy.recoveryProgress(ONLINE_ALERT), undefined);
  });

  test("⭐ the colour is the SERVER's key, mapped to a token", () => {
    assert.equal(copy.alertColour("red").text, "text-critical");
    assert.equal(copy.alertColour("orange").text, "text-detect");
    assert.equal(copy.alertColour("green").text, "text-terra");
    assert.equal(copy.alertColour("purple").text, "text-recovering");
    assert.equal(copy.alertColour("teal").text, "text-recovered");
  });

  test("⭐ a hue nobody has heard of lands on neutral, not on a severity", () => {
    /* An alert nobody can classify must not be given a severity by the thing
       that cannot classify it. */
    assert.equal(copy.alertColour("chartreuse").text, "text-muted");
    assert.equal(copy.alertColour(undefined).text, "text-muted");
    assert.equal(copy.alertColour("grey").text, "text-muted");
  });

  test("⭐ and BLUE is not in the map at all", () => {
    /* It is the sharing toast's and nothing else's: the one thing on screen
       about people rather than about the site. An alert wearing it would be
       the product's only reserved colour spent twice. */
    for (const [key, tokens] of Object.entries(copy.ALERT_COLOUR)) {
      assert.ok(key !== "blue", "blue reached the alert palette");
      assert.ok(!/notify-share/.test(tokens.text + tokens.strip), key);
    }
  });

  test("a clip's quality is named, never shown as its machine value", () => {
    assert.equal(copy.qualityLabel("standard"), "Standard");
    assert.equal(copy.qualityLabel("2k"), "2K");
    /* A quality a newer hub cut at: the badge disappears and the clip plays.
       `h265_low` on a clip card is rule 3 in one word. */
    assert.equal(copy.qualityLabel("h265_low"), "");
    assert.equal(copy.qualityLabel(undefined), "");
  });

  test("the detection badges are kept, and nothing live uses one", () => {
    /* `person`, `vehicle` and `speaker` are the vocabulary a detection feed
       will arrive in, and the rows, timeline steps and clip cards are all
       built on them. Coordination raises none of them today. */
    assert.equal(copy.alertKind("TOWER_OFFLINE"), "fault");
    assert.equal(copy.alertKind("CAMERA_STOPPED"), "fault");
    assert.equal(copy.alertKind("TOWER_ONLINE"), "alert");
    assert.equal(copy.alertKind("GENERATOR_LOW"), "alert");
  });
});

/* ======================================================================
 *  2. THE FEED, IN A BROWSER, OVER THE REAL CLIENT
 * ====================================================================== */

describe("the alert feed, end to end", () => {
  let browser;
  let page;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "alert-feed-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement, useCallback, useState } from "react";
       import { createRoot } from "react-dom/client";
       import { AlertsView } from "@/components/AlertsView";
       import { AuthProvider } from "@/components/AuthProvider";
       import { AlertNotifications } from "@/components/AlertNotifications";
       import { NotificationStack } from "@/components/NotificationStack";
       import { NotificationProvider } from "@/lib/notifications";
       import { useSiteAlerts } from "@/lib/useSiteAlerts";

       const TOWERS = (window as any).__towers;
       const noop = () => {};

       function Harness() {
         const [arrivals, setArrivals] = useState<any[]>([]);
         const [openId, setOpenId] = useState<string | null>(null);
         const nameOf = useCallback(
           (id: string) => TOWERS.find((t: any) => t.id === id)?.site,
           [],
         );
         const onArrived = useCallback((a: any) => setArrivals((p) => [a, ...p]), []);
         const feed = useSiteAlerts({ enabled: true, nameOf, onArrived });
         (window as any).__feed = feed;
         /* The real provider, with no session: a signed-out shell is what
            hub mode and the screenshot harness both are, and a screen that
            needs one to render alerts would be a screen that cannot run on a
            local dashboard. */
         return createElement(AuthProvider, null,
           createElement(NotificationProvider, null,
           createElement(AlertsView, {
             alerts: feed.alerts,
             towers: TOWERS,
             onNavigate: noop,
             onBack: noop,
             onSetStatus: (id: string) => { void feed.acknowledge(id).catch(() => {}); },
             openAlertId: openId,
           }),
           createElement(AlertNotifications, { arrivals, onOpen: setOpenId }),
           createElement(NotificationStack),
         ));
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
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");

    await page.evaluate(
      ([list, towers]) => {
        const w = window;
        /* The frame separator, BUILT rather than written. This function is
           serialized to the page as source, and a newline escape inside it is
           one round of escaping away from becoming a line continuation --
           which silently produces a frame with no newlines in it at all, and
           the SDK's buffer then holds it for ever waiting for a blank line
           that never comes. Nothing errors; the stream simply never delivers. */
        const NL = String.fromCharCode(10);
        w.__towers = towers;
        w.__posts = [];
        w.__gets = [];
        w.__plays = [];
        /** What a ranged probe of a clip URL should answer. */
        w.__clipStatus = 200;
        /** The alert the single-alert GET returns, when a test sets one. */
        w.__refreshed = null;
        /** Latest copy of each alert, which the ack route answers from. */
        w.__alerts = new Map(list.alerts.map((a) => [a.id, a]));

        /* ⚠ A RECORDING STAND-IN FOR THE MEDIA ELEMENT. A <video> with no
           decodable media ignores a `currentTime` write and rejects `play()`,
           so the one-transport-two-cameras behaviour would be untestable
           against the real thing and is exactly what is worth testing. */
        const times = new WeakMap();
        Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
          configurable: true,
          get() { return times.get(this) ?? 0; },
          set(v) { times.set(this, v); },
        });
        HTMLMediaElement.prototype.play = function () {
          w.__plays.push(this.getAttribute("aria-label") ?? "");
          return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function () {
          w.__plays.push(`pause:${this.getAttribute("aria-label") ?? ""}`);
        };

        const json = (body, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });

        w.fetch = async (url, init = {}) => {
          const path = String(url);
          const method = (init.method ?? "GET").toUpperCase();

          /* The ranged probe a broken clip triggers. */
          if (path.startsWith("https://clips.invalid/")) {
            return new Response("", { status: w.__clipStatus });
          }

          if (path.includes("/v1/viewer/events")) {
            /* SSE, as a real stream, so the SDK's framing runs. */
            const stream = new ReadableStream({
              start(controller) {
                w.__sse = controller;
                controller.enqueue(new TextEncoder().encode("retry: 3000" + NL + ": open" + NL + NL));
              },
            });
            return new Response(stream, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            });
          }

          const ack = path.match(/\/v1\/viewer\/site-alerts\/([^/?]+)\/ack$/);
          if (ack && method === "POST") {
            w.__posts.push({ path, body: init.body ?? null });
            const prev = w.__alerts.get(ack[1]);
            const next = {
              ...prev,
              acknowledged: true,
              acknowledged_by: "Terra Industries",
              acknowledged_at: "2026-10-28T12:40:00Z",
              rev: prev.rev + 1,
            };
            w.__alerts.set(ack[1], next);
            return json(next);
          }

          const one = path.match(/\/v1\/viewer\/site-alerts\/([^/?]+)$/);
          if (one && method === "GET") {
            w.__gets.push(path);
            return json(w.__refreshed ?? w.__alerts.get(one[1]));
          }

          if (path.includes("/v1/viewer/site-alerts")) {
            w.__listUrls = w.__listUrls ?? [];
            w.__listUrls.push(path);
            w.__listAuth = w.__listAuth ?? [];
            w.__listAuth.push((init.headers ?? {}).Authorization ?? null);
            return json({ alerts: [...w.__alerts.values()], colours: list.colours });
          }
          throw new Error(`unrouted: ${method} ${path}`);
        };

        /** Push one SSE frame into the open stream. */
        w.__push = (kind, alert) => {
          w.__alerts.set(alert.id, alert);
          const frame = `event: ${kind}` + NL + `data: ${JSON.stringify(alert)}` + NL + NL;
          w.__sse.enqueue(new TextEncoder().encode(frame));
        };
      },
      [
        LIST,
        [
          { id: WEST, site: "West Tower", status: "online", online: true },
          { id: EAST, site: "East Tower", status: "online", online: true },
        ],
      ],
    );

    /* Page errors are collected so a failure to render reports WHAT broke
       rather than "selector not found after 10 s", which is the least useful
       sentence a browser test can end on. */
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.addScriptTag({ content: bundle });
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("WEST TOWER offline"),
        { timeout: 10_000 },
      );
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 500));
      throw new Error([err.message, "ERRORS", ...errors, "BODY", body].join(" | "));
    }
  });

  after(async () => {
    await browser?.close();
  });

  const feedText = () => page.textContent("body");

  test("⭐ the feed is the server's, and the fixtures are gone", async () => {
    const text = await feedText();
    assert.match(text, /WEST TOWER offline/);
    assert.match(text, /CAMERA 1 camera stopped working/);
    assert.match(text, /WEST TOWER back online/);
    assert.match(text, /Recovering footage from WEST TOWER/);
    /* The six that used to load on every fleet. */
    assert.ok(!/TWR-1042/.test(text), "a fixture alert is back in the feed");
    assert.ok(!/TWR-2071/.test(text), "a fixture alert is back in the feed");
  });

  test('⭐ "N of M not yet acknowledged" counts the real rows', async () => {
    /* Five alerts, one of them already acknowledged by somebody. */
    assert.match(await feedText(), /4 of 5 not yet acknowledged/);
  });

  test("⭐ each row wears the colour the SERVER chose for its type", async () => {
    const dots = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-dot]")].map((el) => el.className),
    );
    assert.ok(dots.some((c) => /bg-critical/.test(c)), "no red row");
    assert.ok(dots.some((c) => /bg-detect/.test(c)), "no orange row");
    assert.ok(dots.some((c) => /bg-terra/.test(c)), "no green row");
    assert.ok(dots.some((c) => /bg-recovering/.test(c)), "no purple row");
    /* And the unknown type is still drawn, in the neutral the server named. */
    assert.ok(dots.some((c) => /bg-muted/.test(c)), "the unknown type lost its row");
  });

  test("the list is followed by the stream, and nothing polls", async () => {
    /* One read, then the channel. A poll beside an open event stream would be
       a second and lossier answer to a question already being answered -- and
       a node holds at most 64 streams, so a client that opened one per render
       is a client the server starts closing. */
    await page.waitForFunction(() => Boolean(window.__sse), { timeout: 10_000 });
    const reads = await page.evaluate(() => (window.__listUrls ?? []).length);
    await page.waitForTimeout(1200);
    assert.equal(
      await page.evaluate(() => (window.__listUrls ?? []).length),
      reads,
      "the feed is polling behind the stream",
    );
  });

  test("⭐ and it works with NO SESSION, which is what hub mode is", async () => {
    /* The harness mounts `AuthProvider` and never signs in. A hub's local
       dashboard has no accounts and no sharing, and the three routes behind
       this feed are the same three on both tiers -- so the test for whether a
       feature really works on a hub is that nothing in its path asked about
       an account. Nothing here did, and the feed above is full. */
    const auth = await page.evaluate(() => window.__listAuth ?? []);
    assert.ok(auth.length > 0, "the list was never read");
    assert.deepEqual(
      [...new Set(auth)],
      [null],
      "the feed sent a credential it was never given",
    );
    assert.match(await page.textContent("body"), /WEST TOWER offline/);
  });

  test("⭐ a recovery shows how much is left, with a bar", async () => {
    const recovery = await page.textContent("[data-recovery]");
    assert.match(recovery, /6 files, about 29 min left/);
    const width = await page.evaluate(
      () => document.querySelector("[data-recovery] span span")?.getAttribute("style") ?? "",
    );
    assert.match(width, /width:\s*25%/);
  });

  test("⭐ and the bar moves on an alert.updated, without a reload", async () => {
    await page.evaluate(
      (next) => window.__push("alert.updated", next),
      {
        ...RECOVERING_ALERT,
        rev: 3,
        progress: { files_left: 2, bytes_left: 1_000_000, progress: 0.8, eta_sec: 300 },
      },
    );
    await page.waitForFunction(
      () => /2 files, about 5 min left/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const width = await page.evaluate(
      () => document.querySelector("[data-recovery] span span")?.getAttribute("style") ?? "",
    );
    assert.match(width, /width:\s*80%/);
  });

  test("⭐ an out-of-order update is dropped by rev", async () => {
    /* The stream and a recovery read are two sources for one row with nothing
       ordering them. Without the gate, a stale forward flips a recovered
       alert back to live on screen. */
    await page.evaluate(
      (stale) => window.__push("alert.updated", stale),
      {
        ...RECOVERING_ALERT,
        rev: 1,
        progress: { files_left: 99, bytes_left: 1, progress: 0.01, eta_sec: 60 },
      },
    );
    await page.waitForTimeout(150);
    const text = await feedText();
    assert.match(text, /2 files, about 5 min left/);
    assert.ok(!/99 files/.test(text), "a stale revision overwrote a fresh one");
  });

  test("⭐ a new alert raises a toast in that alert's colour", async () => {
    await page.evaluate(
      (fresh) => window.__push("alert.new", fresh),
      {
        id: "ffff5555",
        type: "CAMERA_STOPPED",
        colour: "orange",
        device_id: EAST,
        cameras: [2],
        started_at: "2026-10-28T12:45:00Z",
        started_epoch: EPOCH + 2100,
        acknowledged: false,
        rev: 1,
      },
    );
    await page.waitForSelector("[role='group']", { timeout: 5000 });
    const card = await page.evaluate(() => {
      const el = [...document.querySelectorAll("[role='group']")].find((g) =>
        /CAMERA 2 camera stopped working/.test(g.textContent ?? ""),
      );
      return el
        ? { text: el.textContent, strip: el.querySelector("div")?.className ?? "" }
        : null;
    });
    assert.ok(card, "no toast appeared");
    /* The one coloured pixel on the card, and it is the server's. */
    assert.match(card.strip, /bg-detect/);
    assert.match(card.text, /Open/);
    assert.match(card.text, /Dismiss/);
  });

  test("⭐ and an updated alert does NOT raise a second one", async () => {
    /* `alert.new` on a raise, `alert.updated` on everything after. A card per
       progress tick would bury the screen on a recovering site. */
    const before = await page.evaluate(
      () => document.querySelectorAll("[role='group']").length,
    );
    await page.evaluate(
      (next) => window.__push("alert.updated", { ...next, rev: 9 }),
      RECOVERING_ALERT,
    );
    await page.waitForTimeout(200);
    const after = await page.evaluate(
      () => document.querySelectorAll("[role='group']").length,
    );
    assert.equal(after, before);
  });

  test("⭐ a tower alert shows BOTH cameras, on ONE transport", async () => {
    /* The control link is the event and it took the whole mast, so the two
       clips are the same moment seen from two places. Scrubbing them
       separately to find a vehicle leaving one frame and entering the other
       is the work this screen exists to not make somebody do. */
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("button")].find((b) =>
        /WEST TOWER offline/.test(b.textContent ?? ""),
      );
      row?.click();
    });
    await page.waitForSelector("[data-alert-clips]", { timeout: 5000 });
    const shape = await page.evaluate(() => ({
      videos: document.querySelectorAll("[data-alert-clips] video").length,
      plays: document.querySelectorAll("[data-alert-clips] button").length,
      scrubs: document.querySelectorAll("[data-alert-clips] input[type=range]").length,
    }));
    assert.equal(shape.videos, 2);
    assert.equal(shape.plays, 1, "two cameras grew two play buttons");
    assert.equal(shape.scrubs, 1, "two cameras grew two scrubbers");
  });

  test("⭐ one play starts both, and one scrub moves both", async () => {
    await page.evaluate(() => {
      window.__plays = [];
      document.querySelector("[data-alert-clips] button")?.click();
    });
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() => window.__plays.length),
      2,
      "the transport started only one camera",
    );
    await page.evaluate(() => {
      const scrub = document.querySelector("[data-alert-clips] input[type=range]");
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      set.call(scrub, "22");
      scrub.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    const positions = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-clips] video")].map((v) => v.currentTime),
    );
    assert.deepEqual(positions, [22, 22], "the two cameras are not on one clock");
  });

  test("⭐ and the follower is corrected when it drifts", async () => {
    await page.evaluate(() => {
      const [lead, follow] = document.querySelectorAll("[data-alert-clips] video");
      lead.currentTime = 30;
      follow.currentTime = 24;
      lead.dispatchEvent(new Event("timeupdate"));
    });
    await page.waitForTimeout(80);
    const positions = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-clips] video")].map((v) => v.currentTime),
    );
    assert.deepEqual(positions, [30, 30]);
  });

  test("⭐ a 2K clip arriving switches the picture WITHOUT losing the place", async () => {
    /* A tower that survives and later syncs the covering segment gets the
       SAME minute cut again at full size. It is the same footage at a better
       resolution, so an operator looking at 00:30 must still be looking at
       00:30 — a naive `src` swap resets to zero, which on a minute of
       evidence means finding the moment again. */
    await page.evaluate(() => {
      for (const v of document.querySelectorAll("[data-alert-clips] video")) {
        v.currentTime = 30;
      }
    });
    await page.evaluate(
      ([alert, big1, big2]) =>
        window.__push("alert.updated", {
          ...alert,
          rev: 7,
          best_quality: "2k",
          clips: [...alert.clips, big1, big2],
        }),
      [OFFLINE_ALERT, clip(1, "2k", "c1-2k"), clip(2, "2k", "c2-2k")],
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-alert-clips] video")].every((v) =>
          /c\d-2k/.test(v.getAttribute("src") ?? ""),
        ),
      { timeout: 5000 },
    );
    await page.waitForTimeout(80);
    const positions = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-clips] video")].map((v) => v.currentTime),
    );
    assert.deepEqual(positions, [30, 30], "the upgrade lost the operator's place");
    /* And the badge says which one is on screen, from the server's ranking. */
    assert.match(await page.textContent("[data-alert-clips]"), /2K/);
  });

  test("the download uses the download URL and the hub's own filename", async () => {
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-clips] a")].map((a) => ({
        href: a.getAttribute("href"),
        name: a.getAttribute("download"),
      })),
    );
    assert.equal(links.length, 2);
    for (const l of links) {
      assert.match(l.href, /\?dl=1$/);
      assert.match(l.name, /\.mp4$/);
    }
  });

  test("⭐ an expired ticket is re-minted and retried ONCE", async () => {
    /* `url` is minted per request and a presigned bucket URL lives fifteen
       minutes. A player that read a 403 as "broken" would tell somebody the
       evidence is gone when it is one request away. */
    await page.evaluate(() => {
      window.__clipStatus = 403;
      window.__gets = [];
      window.__refreshed = null;
    });
    await page.evaluate(() => {
      document.querySelector("[data-alert-clips] video")?.dispatchEvent(new Event("error"));
    });
    await page.waitForFunction(() => window.__gets.length > 0, { timeout: 5000 });
    const gets = await page.evaluate(() => window.__gets);
    assert.equal(gets.length, 1, "the alert was re-read more than once");
    assert.match(gets[0], /\/v1\/viewer\/site-alerts\/aaaa0000$/);

    /* And a SECOND 403 on the same clip is not an expiry; it is a server
       refusing, and retrying it in a loop would be this app causing the
       outage it is reporting. */
    await page.evaluate(() => {
      document.querySelector("[data-alert-clips] video")?.dispatchEvent(new Event("error"));
    });
    await page.waitForTimeout(400);
    assert.equal(
      (await page.evaluate(() => window.__gets.length)),
      1,
      "a second expiry started a retry loop",
    );
    assert.match(await page.textContent("[data-alert-clips]"), /didn't play/);
  });

  test("⭐ an evicted clip says the alert is kept", async () => {
    /* Clips go before footage, never the other way round, and the alert
       survives its clip deliberately: an alert is the record that the camera
       stopped at 03:14, and deleting it to save an attachment would be
       deleting the incident. */
    await page.evaluate(() => {
      window.__clipStatus = 404;
      const row = [...document.querySelectorAll("button")].find((b) =>
        /CAMERA 1 camera stopped working/.test(b.textContent ?? ""),
      );
      row?.click();
    });
    await page.waitForSelector("[data-alert-clips] video", { timeout: 5000 });
    await page.evaluate(() => {
      document.querySelector("[data-alert-clips] video")?.dispatchEvent(new Event("error"));
    });
    await page.waitForFunction(
      () => /Clip no longer kept/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const text = await page.textContent("body");
    assert.match(text, /Clip no longer kept/);
    assert.match(text, /The alert is kept/);
    /* The alert itself is still in the feed. */
    assert.match(text, /CAMERA 1 camera stopped working/);
  });

  test('⭐ an alert whose clip has not been cut yet says "Clip coming"', async () => {
    /* `TOWER_ONLINE` clips are the first 60 s AFTER the tower returned, so
       they land about a minute later. The alert is right and the evidence is
       on its way, which is a different sentence from either of the others. */
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("button")].find((b) =>
        /WEST TOWER back online/.test(b.textContent ?? ""),
      );
      row?.click();
    });
    await page.waitForFunction(() => /Clip coming/.test(document.body.innerText), {
      timeout: 5000,
    });
    assert.match(await page.textContent("body"), /The site is cutting it now/);
  });

  test("a recovery alert gets no clip area at all", async () => {
    /* §9: there is no moment to cut around. A box saying nothing arrived
       would be narrating an absence that was never going to be a presence. */
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("button")].find((b) =>
        /Recovering footage from WEST TOWER/.test(b.textContent ?? ""),
      );
      row?.click();
    });
    await page.waitForTimeout(200);
    const has = await page.evaluate(
      () => document.querySelectorAll("[data-alert-clips]").length,
    );
    assert.equal(has, 0);
    assert.ok(!/Clip coming/.test(await page.textContent("body")));
  });

  test("⭐ Acknowledge posts with NO body and believes the answer", async () => {
    /* Who acknowledged is the authenticated caller; a name in the request
       would be an unverified claim about a person written into an audit fact.
       The placeholder "A. Okafor" that stood in for it is gone. */
    await page.evaluate(() => {
      window.__posts = [];
      const row = [...document.querySelectorAll("button")].find((b) =>
        /WEST TOWER back online/.test(b.textContent ?? ""),
      );
      row?.click();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const ack = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Acknowledge",
      );
      ack?.click();
    });
    await page.waitForFunction(() => window.__posts.length > 0, { timeout: 5000 });
    const posts = await page.evaluate(() => window.__posts);
    assert.equal(posts.length, 1);
    assert.match(posts[0].path, /\/site-alerts\/cccc2222\/ack$/);
    assert.ok(!posts[0].body, `the ack sent a body: ${posts[0].body}`);

    /* And the screen takes the returned alert, name and all. */
    await page.waitForFunction(
      () => /Noticed by:/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const text = await page.textContent("body");
    assert.match(text, /Terra Industries/);
    assert.ok(!/A\. Okafor/.test(text), "the fake placeholder is back");
  });

  test("⭐ and there is no Resolve, because there is no resolve", async () => {
    /* Acknowledging is one-way and the first one wins; a camera coming back
       writes `recovered_at` onto the same alert rather than closing it. A
       button collapsing those two would let a screen imply somebody dealt
       with an outage that simply ended. */
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()),
    );
    assert.ok(!buttons.includes("Resolve"), "a server alert offered Resolve");
    /* Escalate stays, and stays disabled: a button removed is a feature
       forgotten, and this one has to be wired the day there is a rota. */
    const escalate = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent?.trim() === "Escalate",
      );
      return b ? { there: true, disabled: b.disabled } : null;
    });
    assert.deepEqual(escalate, { there: true, disabled: true });
  });

  test("⭐ a recovered camera's Back at is a SEPARATE fact from who noticed", async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("button")].find((b) =>
        /CAMERA 1 camera stopped working/.test(b.textContent ?? ""),
      );
      row?.click();
    });
    await page.waitForTimeout(200);
    const text = await page.textContent("body");
    assert.match(text, /Started:/);
    assert.match(text, /Back at:/);
    assert.match(text, /Noticed by:/);
    /* And the detection cells are not drawn over a hardware fault. "Not
       scored" under AI Confidence on a camera that stopped is a row narrating
       the absence of something that was never going to be there. */
    assert.ok(!/AI Confidence/.test(text), "a hardware fault was given a model score");
    assert.ok(!/Not scored/.test(text));
  });

  test("⭐ a stale row from a RECOVERY READ cannot un-acknowledge an alert", async () => {
    /* ⚠ THIS IS A SECOND GATE, AT THE STORE, AND IT IS NOT THE SDK'S. The SDK
       drops out-of-order frames off the STREAM; this drops out-of-order rows
       reaching the store, and the acknowledgement is the case only the second
       one covers. An ack is a POST whose response never touches the
       subscription, so the stream's own gate has never seen that revision --
       and a recovery read racing it (a hub that has not yet applied the ack,
       or a data centre with a forward in flight) hands back the row as it was.
       Without the store gate, the alert un-acknowledges itself on screen a
       second after somebody acknowledged it. */
    const acked = await page.evaluate(() => {
      const a = window.__alerts.get("cccc2222");
      /* Put the PRE-ack row back on the server, as a tier that has not caught
         up would serve it. */
      window.__alerts.set("cccc2222", {
        ...a,
        acknowledged: false,
        acknowledged_by: undefined,
        rev: 1,
      });
      return a.rev;
    });
    assert.ok(acked > 1, "the ack test did not run first");

    await page.evaluate(() => {
      window.__listUrls = [];
      window.__sse.close();
    });
    await page.waitForFunction(
      () => (window.__listUrls ?? []).length > 0,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(300);
    const state = await page.evaluate(
      () => window.__feed.alerts.find((a) => a.id === "cccc2222")?.status,
    );
    assert.equal(state, "acknowledged", "a stale read un-acknowledged an alert");
  });

  test("⭐ a dropped stream re-reads with `since`, and keeps the feed", async () => {
    /* A slow reader is CLOSED rather than waited for, because the publisher is
       the loop watching the fleet, and a node holds at most 64 streams. Drops
       are ordinary. The one thing that must not happen is the list emptying. */
    await page.evaluate(() => {
      window.__listUrls = [];
      window.__sse.close();
    });
    await page.waitForFunction(
      () => (window.__listUrls ?? []).some((u) => u.includes("since=")),
      { timeout: 15_000 },
    );
    const urls = await page.evaluate(() => window.__listUrls);
    assert.ok(urls.some((u) => /since=\d+/.test(u)), urls.join(" "));
    /* Still there, throughout. */
    assert.match(await page.textContent("body"), /WEST TOWER offline/);
  });
});

/* ======================================================================
 *  3. A FEED THAT COULD NOT BE READ IS NOT A QUIET NIGHT
 * ====================================================================== */

describe("what the screen says when the read fails", () => {
  let api;
  let view;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "alert-fail-"));
    scratch.push(dir);
    const out = join(dir, "alerts.mjs");
    await build({
      entryPoints: [join(SRC, "lib/api/alerts.ts")],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "neutral",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "import.meta.env": ENV },
    });
    api = await import(`file://${out.replace(/\\/g, "/")}`);
    view = await readFile(join(SRC, "components/AlertsView.tsx"), "utf8");
  });

  test("⭐ each failure is short, and has no code in it", () => {
    /* Rule 6: what happened, and what to do. No status, no endpoint, no
       field name, no apology, and no second sentence of CONTEXT -- which is
       the part that matters, and is not the same as no second sentence. The
       house form, which `describeRecordingFailure` already follows, is a
       statement and then an instruction: "Couldn't reach the site for
       footage. Check the connection." The thing being forbidden is the third
       sentence explaining how the system works. */
    const cases = [
      { status: 403 },
      { status: 404 },
      { status: 500 },
      { code: "network_error", status: 0 },
      {},
    ];
    for (const err of cases) {
      const line = api.describeAlertFailure(err);
      assert.ok(line.length > 0, JSON.stringify(err));
      assert.ok(line.split(". ").filter(Boolean).length <= 2, line);
      assert.ok(!line.includes("—"), line);
      assert.ok(!/\d{3}/.test(line), `a status reached the sentence: ${line}`);
      assert.ok(!/\/v1\//.test(line), `a path reached the sentence: ${line}`);
      assert.ok(!/site-alerts|network_error|forbidden/.test(line), line);
    }
  });

  test("a refused read and an old hub say different things", () => {
    /* "Not set up here" describes the SITE; "not found" describes a URL, and
       only one of those is the customer's situation. */
    assert.match(api.describeAlertFailure({ status: 403 }), /shared with you/);
    assert.match(api.describeAlertFailure({ status: 404 }), /aren't set up on this site yet/);
  });

  test("⭐ and the quiet-night empty state is withheld over one", () => {
    /* `AlertsEmpty`'s own header says a quiet feed is a GOOD state and draws
       it that way, with no action, because there is nothing to fix. Over a
       request the server refused that is the same picture carrying the
       opposite meaning, and nothing on screen would tell them apart. */
    assert.match(view, /problem \? null : \(/);
    assert.match(view, /data-alert-problem/);
  });

  test("and reconnecting is a quiet line, not a banner", () => {
    /* Drops are ordinary: a slow reader is closed rather than waited for,
       because the publisher is the loop watching the fleet. The rows on
       screen are still the last thing the server said. */
    assert.match(view, /data-alert-reconnecting/);
    assert.ok(view.includes("Reconnecting to the site."));
    /* The quietest ink on the screen, not the alarm red the row above it
       uses: the rows are still true and nothing is wrong with the site. */
    const at = view.indexOf("data-alert-reconnecting");
    assert.match(view.slice(at, at + 400), /text-muted/);
  });
});

/* ======================================================================
 *  4. THE SOURCE RULES THAT ARE EASY TO UNDO
 * ====================================================================== */

describe("the fixtures do not come back", () => {
  let app;
  let copy;
  before(async () => {
    app = await readFile(join(SRC, "App.tsx"), "utf8");
    copy = await readFile(join(SRC, "lib/alertCopy.ts"), "utf8");
  });

  test("⭐ the shell does not import the fixture list at all", () => {
    /* Not merely "does not use it": an import is one line from being used, and
       this one was used for a year. */
    assert.ok(!/^\s*ALERTS,$/m.test(app), "App imports ALERTS again");
    assert.ok(!/can\(features, "alerts"\) \? ALERTS/.test(app));
  });

  test("the feed comes from the hook", () => {
    assert.match(app, /useSiteAlerts\(\{ enabled: alertsEnabled/);
  });

  test("⭐ the toast is mounted beside the stack, not inside a screen", () => {
    /* "On every screen" is the requirement, and it is a question of WHERE the
       component is rather than of what it renders: inside the view switch it
       would unmount the moment somebody opened Playback, which is exactly when
       an operator most needs telling. It sits with `NotificationStack`, below
       every branch. */
    const at = app.indexOf("<AlertNotifications");
    const stack = app.indexOf("<NotificationStack />");
    assert.ok(at > 0, "the toast is gone");
    assert.ok(stack > at, "the toast moved away from the stack it draws into");
  });

  test("⭐ and it is NOT hidden on a hub, unlike the share deck", () => {
    /* A share is between two sites over the internet and a hub has neither.
       An alert is the hub's own judgement about its own masts, and the kiosk
       in the control room is the screen most likely to be the only one
       anybody is looking at. */
    const deck = app.indexOf("{hubMode ? null : <ShareDeck />}");
    const toast = app.indexOf("<AlertNotifications");
    assert.ok(deck > 0 && toast > deck);
    const between = app.slice(deck, toast);
    assert.ok(!/hubMode \? null/.test(between.slice(32)), "the toast got a hub gate");
  });

  test("⭐ no sentence an alert is read in lives outside one module", () => {
    /* The server sends no `message` field at all, precisely so the website
       owns every word from one place in one voice. A second switch somewhere
       else is how two screens end up calling the same event two things. */
    for (const phrase of ["back online", "camera stopped working", "Recovering footage"]) {
      assert.ok(copy.includes(phrase), phrase);
    }
    assert.ok(!/—/.test(copy.replace(/\/\*[\s\S]*?\*\//g, "")), "an em-dash reached the copy");
  });
});
