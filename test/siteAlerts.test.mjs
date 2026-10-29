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
import fsSync from "node:fs";

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
/* ⚠ ONE NAMED CAMERA AND ONE NOT, ON PURPOSE. The two produce two different
   sentences, and covering only the named case is how the doubled "CAMERA 1
   camera stopped working" got past a green suite and onto a lab hub. */
const CAMERA_NAMES = {
  [`${WEST}:1`]: "North gate",
  [`${WEST}:2`]: "Yard",
  /* EAST's camera 1 is deliberately left unnamed. */
};

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
  /* ⚠ ROUTED TO A REAL FOUR-SECOND MP4, so "it plays" means the frames
     moved. These used to point at a host that does not resolve, with the
     media element's `play()` and `currentTime` replaced by recording stubs —
     which passed, and could not have caught a clip arriving after its alert
     was opened and never starting, because that is a fact about the real
     element. */
  url: `https://clips.test/${key}.mp4`,
  download_url: `https://clips.test/${key}.mp4?dl=1`,
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
  /* WEST's camera 1 is named NORTH GATE, so this alert exercises the named
     sentence. The toast test below raises one on EAST, which is not. */
  device_id: WEST,
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
  let story;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "alert-copy-"));
    scratch.push(dir);
    /* Both modules, because the title and the timeline's first step write
       the same clause and the bug was that only one of them knew the rule. */
    for (const [name, entry] of [
      ["alertCopy", "lib/alertCopy.ts"],
      ["alertStory", "lib/alertStory.ts"],
    ]) {
      const out = join(dir, `${name}.mjs`);
      await build({
        entryPoints: [join(SRC, entry)],
        outfile: out,
        bundle: true,
        format: "esm",
        platform: "neutral",
        alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
        define: { "import.meta.env": ENV },
      });
      const mod = await import(`file://${out.replace(/\\/g, "/")}`);
      if (name === "alertCopy") copy = mod;
      else story = mod;
    }
  });

  const nameOf = (id) => NAMES[id];
  const cameraNameOf = (id, n) => CAMERA_NAMES[`${id}:${n}`];

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

  test("⭐ a NAMED camera is called what the customer called it", () => {
    /* The lab read "CAMERA 1 camera stopped working" off a mast whose
       cameras are NORTH GATE and YARD. Two faults in one line: the wrong
       name, and the noun twice. */
    const title = copy.alertTitle(STOPPED_ALERT, nameOf, cameraNameOf);
    assert.match(title, /^NORTH GATE camera stopped working\. Back at /);
    /* Wall clock, in site time. Lagos is UTC+1, so 12:04:10Z is 13:04. */
    assert.match(title, /01:04/);
  });

  test('⭐ and an UNNAMED one is "Camera 1 stopped working", with the noun once', () => {
    /* ⚠ THE WORD "camera" IS PART OF THE NAME OR PART OF THE SENTENCE,
       NEVER BOTH. A template with a variable in it doubles the noun the
       moment the variable already contains it, which is exactly what
       shipped. */
    const title = copy.alertTitle(STOPPED_ALERT, nameOf);
    assert.equal(
      title.split(". ")[0],
      "CAMERA 1 stopped working",
      "the noun is doubled again",
    );
    assert.ok(!/camera camera/i.test(title));
    assert.ok(!/CAMERA 1 camera/.test(title));
  });

  test("and while it is still down there is no Back at", () => {
    const live = { ...STOPPED_ALERT, recovered_at: undefined };
    assert.equal(
      copy.alertTitle(live, nameOf, cameraNameOf),
      "NORTH GATE camera stopped working",
    );
  });

  test('⭐ a name that ALREADY says "camera" does not get it twice', () => {
    /* The third case, and the one the fallback hid. "CAMERA 1" is not the
       only value that can contain the noun: somebody naming a camera TEST
       GATE CAMERA is ordinary, and a branch on "was it named?" rather than
       on the name itself brings the doubled noun straight back wearing a
       customer's own label. */
    const named = (label) => (id, n) =>
      id === STOPPED_ALERT.device_id && n === 1 ? label : undefined;
    const subject = (label) =>
      copy.alertTitle(STOPPED_ALERT, nameOf, named(label)).split(". ")[0];

    assert.equal(subject("Test gate camera"), "TEST GATE CAMERA stopped working");
    assert.equal(subject("TEST GATE CAMERA"), "TEST GATE CAMERA stopped working");
    /* Anywhere in the name, not only at the end. */
    assert.equal(subject("Camera by the gate"), "CAMERA BY THE GATE stopped working");
    /* And the ordinary case is untouched. */
    assert.equal(subject("North gate"), "NORTH GATE camera stopped working");
  });

  test("⭐ and it is a WHOLE word, so a name that merely contains the letters is not", () => {
    /* `includes` would read CAMERAMAN HILL as already saying it and leave
       "CAMERAMAN HILL stopped working", which is a sentence about a hill. */
    const named = (label) => (id, n) =>
      id === STOPPED_ALERT.device_id && n === 1 ? label : undefined;
    const subject = (label) =>
      copy.alertTitle(STOPPED_ALERT, nameOf, named(label)).split(". ")[0];

    assert.equal(subject("Cameraman hill"), "CAMERAMAN HILL camera stopped working");
    assert.equal(subject("Camerons yard"), "CAMERONS YARD camera stopped working");
    /* A plural counts: "SOUTH CAMERAS" is already about cameras. */
    assert.equal(subject("South cameras"), "SOUTH CAMERAS stopped working");
    /* A hyphen is a word boundary, so this one already says it too. */
    assert.equal(subject("Gate camera-2"), "GATE CAMERA-2 stopped working");
  });

  test("⭐ the timeline's first step follows the same rule", () => {
    /* ⚠ TWO PLACES WRITE THIS CLAUSE and only one of them was fixed last
       round, so the timeline still read "Frames stopped arriving from
       CAMERA 1 camera" for an unnamed camera. One function decides it now;
       this is what keeps the second caller honest. */
    const named = (label) => (id, n) =>
      id === STOPPED_ALERT.device_id && n === 1 ? label : undefined;
    const first = (label) =>
      story.alertStory(STOPPED_ALERT, nameOf, named(label))[0].title;

    assert.equal(
      first("Test gate camera"),
      "Frames stopped arriving from TEST GATE CAMERA",
    );
    assert.equal(
      first("North gate"),
      "Frames stopped arriving from NORTH GATE camera",
    );
    /* Including the unnamed fallback, which is where it was still wrong. */
    assert.equal(
      story.alertStory(STOPPED_ALERT, nameOf)[0].title,
      "Frames stopped arriving from CAMERA 1",
    );
  });

  test("⭐ the short id is readable, and is not the raw one", () => {
    /* `95ae76a8085641718fc1a64cbda85280` shipped in the detail header, where
       the design puts the reference somebody reads out on a handoff. Thirty
       two hex characters cannot be read aloud or compared by eye. */
    assert.equal(copy.shortAlertId("95ae76a8085641718fc1a64cbda85280"), "ALT-95AE76");
    assert.equal(copy.shortAlertId("aaaa0000"), "ALT-AAAA00");
    /* Short enough to say, and never the whole thing. */
    assert.ok(copy.shortAlertId("95ae76a8085641718fc1a64cbda85280").length <= 10);
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
  /** Flipped by the eviction test; read by the route above. */
  let clipMissing = false;

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
         /* ⚠ THE CUSTOMER'S LABEL, AND UNDEFINED WHEN THERE IS NONE --
            the exact shape CameraFeed.label has, which is the field the
            shell reads. Returning a CAMERA 1 fallback here would make every
            camera look named and hide the bug this round fixes.
            (No backticks in this block: it lives inside a template
            literal, and one would end the harness mid-sentence.) */
         const cameraNameOf = useCallback(
           /* String concatenation, not a template literal: this whole
              harness is a template literal in the test file, and a raw
              backtick inside one terminates it. */
           (id: string, n: number) => (window as any).__cameraNames[id + ":" + n],
           [],
         );
         const onArrived = useCallback((a: any) => setArrivals((p) => [a, ...p]), []);
         const feed = useSiteAlerts({ enabled: true, nameOf, cameraNameOf, onArrived });
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
             cameraNameOf,
             onRefreshAlert: feed.refresh,
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

    const MP4 = await readFile(join(ROOT, "test/fixtures/clip.mp4"));

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    /* ⚠ `page.route`, NOT THE `window.fetch` STUB. A media element fetches
       its own bytes and never goes near `window.fetch`, so a clip can only be
       made playable at the network layer. `clipMissing` lets one test take
       the file away without touching the alert that points at it. */
    await page.route("https://clips.test/**", async (route) => {
      if (clipMissing) {
        await route.fulfill({ status: 404, body: "" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "video/mp4", body: MP4 });
    });
    await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
    await page.evaluate((names) => { window.__CAMERA_NAMES = names; }, CAMERA_NAMES);

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

        /* ⚠ NO STAND-IN FOR THE MEDIA ELEMENT, AND THAT IS THIS ROUND'S
           LESSON. The previous suite replaced `play()` and `currentTime`
           with recorders, because the clips pointed at a host that does not
           resolve. It was green, and the lab then found that a clip arriving
           AFTER its alert is opened never plays -- which is a fact about the
           real element and was therefore unobservable here by construction.
           The clips are a real four-second mp4 now, served by `page.route`. */
        w.__cameraNames = window.__CAMERA_NAMES;

        const json = (body, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });

        w.fetch = async (url, init = {}) => {
          const path = String(url);
          const method = (init.method ?? "GET").toUpperCase();

          /* The ranged probe a failed pane triggers. The MEDIA itself does
             not come through here: a <video> fetches its own bytes and never
             goes near `window.fetch`, so `page.route` answers that. */
          if (path.startsWith("https://clips.test/")) {
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
    assert.match(text, /NORTH GATE camera stopped working/);
    assert.ok(!/CAMERA 1 camera/.test(text), "the noun is doubled again");
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
        /CAMERA 2 stopped working/.test(g.textContent ?? ""),
      );
      return el
        ? { text: el.textContent, strip: el.querySelector("div")?.className ?? "" }
        : null;
    });
    assert.ok(card, "no toast appeared");
    /* The one coloured pixel on the card, and it is the server's. */
    assert.match(card.strip, /bg-detect/);
    /* Unnamed, so the number carries the noun once. The toast is the same
         copy layer as the row, which is the point of there being one. */
    assert.ok(!/CAMERA 2 camera/.test(card.text), "the noun is doubled in the toast");
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

  /* ================================================================
   *  THE PLAYER. One design, both kinds of alert.
   * ================================================================ */

  /** Open one alert by the words in its row. */
  const openRow = async (match) => {
    await page.evaluate((m) => {
      const row = [...document.querySelectorAll("button")].find((b) =>
        new RegExp(m).test(b.textContent ?? ""),
      );
      row?.click();
    }, match);
    await page.waitForTimeout(120);
  };

  /** Press the hero and wait for the full player. */
  const openPlayer = async (nth = 0) => {
    await page.evaluate((i) => {
      const heroes = document.querySelectorAll("[data-alert-clip-hero]");
      heroes[i]?.click();
    }, nth);
    await page.waitForSelector("[data-clip-stage] video", { timeout: 8000 });
    /* Metadata, so a duration and a seek mean something. */
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-clip-stage] video")].every(
          (v) => v.readyState >= 1,
        ),
      { timeout: 8000 },
    );
  };

  const closePlayer = async () => {
    await page.evaluate(() => {
      const x = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === "Close clip",
      );
      x?.click();
    });
    await page.waitForSelector("[data-clip-stage]", { state: "detached", timeout: 5000 });
  };

  const stage = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-clip-stage] video")].map((v) => ({
        src: v.getAttribute("src"),
        t: v.currentTime,
        paused: v.paused,
        ready: v.readyState,
        err: v.error ? v.error.code : null,
      })),
    );

  test("⭐ the hero is the design's, not a plain bar", async () => {
    /* The detection alerts already had a player with a scrub bar, a
       wall-clock readout, speed, mute and a download; a REAL alert got an
       inline transport built for that surface alone. Two players in one
       product, the worse one on the live path. */
    await openRow("WEST TOWER offline");
    await page.waitForSelector("[data-alert-clips]", { timeout: 5000 });
    const hero = await page.evaluate(() => {
      const heroes = [...document.querySelectorAll("[data-alert-clip-hero]")];
      return {
        count: heroes.length,
        /* The camera's name in the corner, the centre play button, the
           duration badge — and no inline transport. */
        text: heroes.map((h) => h.textContent).join("|"),
        play: heroes[0]?.querySelector("svg") !== null,
        scrubs: document.querySelectorAll("[data-alert-clips] input[type=range]").length,
      };
    });
    assert.equal(hero.count, 2, "a tower alert should show both cameras");
    assert.match(hero.text, /NORTH GATE/);
    assert.match(hero.text, /YARD/);
    assert.ok(hero.play, "no play button on the hero");
    assert.equal(hero.scrubs, 0, "the plain inline bar is back");
  });

  test("⭐ pressing it opens BOTH cameras on ONE transport", async () => {
    /* The control link is the event and it took the whole mast, so the clips
       are the same sixty seconds from two places. A vehicle leaves one frame
       and enters the other, and finding that by scrubbing two players
       separately is the work this screen exists to not make somebody do. */
    await openPlayer(0);
    const shape = await page.evaluate(() => ({
      videos: document.querySelectorAll("[data-clip-stage] video").length,
      scrubs: document.querySelectorAll('input[aria-label="Seek"]').length,
      plays: [...document.querySelectorAll("button")].filter((b) =>
        ["Play", "Pause"].includes(b.getAttribute("aria-label") ?? ""),
      ).length,
    }));
    assert.equal(shape.videos, 2);
    assert.equal(shape.scrubs, 1, "two cameras grew two scrubbers");
    assert.equal(shape.plays, 1, "two cameras grew two play buttons");
    /* Each pane says which camera it is. Two frames nobody can attribute is
       two frames nobody can cite. */
    const labels = await page.textContent("[data-clip-stage]");
    assert.match(labels, /NORTH GATE/);
    assert.match(labels, /YARD/);
  });

  test("⭐ one play starts both, and one scrub moves both", async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        ["Play", "Pause"].includes(x.getAttribute("aria-label") ?? ""),
      );
      /* It opens playing; make sure we are paused, then start. */
      if (b?.getAttribute("aria-label") === "Pause") b.click();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === "Play",
      );
      b?.click();
    });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-clip-stage] video")].every(
          (v) => !v.paused && v.currentTime > 0,
        ),
      { timeout: 8000 },
    );
    const playing = await stage();
    assert.equal(playing.length, 2);
    for (const v of playing) assert.ok(!v.paused, "a camera stayed paused");

    await page.evaluate(() => {
      const scrub = document.querySelector('input[aria-label="Seek"]');
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      set.call(scrub, "2.5");
      scrub.dispatchEvent(new Event("change", { bubbles: true }));
    });
    /* Waited for rather than slept on: a seek is asynchronous, and a
       follower that has to fetch the byte range first reports its old
       position until it completes. A fixed pause here measures the network. */
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-clip-stage] video")].every(
          (v) => Math.abs(v.currentTime - 2.5) < 0.7,
        ),
      { timeout: 8000 },
    );
  });

  test("⭐ and the follower is corrected when it drifts", async () => {
    await page.evaluate(() => {
      const [lead, follow] = document.querySelectorAll("[data-clip-stage] video");
      lead.pause();
      follow.pause();
      lead.currentTime = 3;
      follow.currentTime = 1;
      lead.dispatchEvent(new Event("timeupdate"));
    });
    await page.waitForFunction(
      () => {
        const [lead, follow] = document.querySelectorAll("[data-clip-stage] video");
        return Math.abs(lead.currentTime - follow.currentTime) < 0.4;
      },
      { timeout: 5000 },
    );
  });

  test("⭐ the download is a real file, not the simulated one", async () => {
    /* `useExportPhase` is three states and no bytes, which was honest while
       nothing on this surface had a URL behind it. An alert clip does, and a
       button that pretends to save evidence is the worst button here. */
    const link = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find((x) =>
        /^Download /.test(x.getAttribute("aria-label") ?? ""),
      );
      return a ? { href: a.getAttribute("href"), name: a.getAttribute("download") } : null;
    });
    assert.ok(link, "the download is still a simulation");
    assert.match(link.href, /\?dl=1$/);
    assert.match(link.name, /\.mp4$/);
  });

  test("⭐ a 2K clip arriving switches the source WITHOUT losing the place", async () => {
    /* The same sixty seconds at a better resolution, so somebody looking at
       00:02 must still be looking at 00:02. And it must still PLAY: an
       element whose source is swapped without an explicit load can be left
       in NETWORK_NO_SOURCE and never recover. */
    /* A FRESH PLAYER for this one. The tests above leave the transport
       paused, part-played and mid-seek between them, and the thing under
       test here is a source swap against a known position — inheriting
       three other tests' playhead measures them instead. */
    await closePlayer();
    await openPlayer(0);

    /* ⚠ PUT THE PLAYHEAD THERE THROUGH THE SCRUBBER, not by writing
       `currentTime` from the test. Poking the element races its own seek --
       it reports the old position until the seek completes -- and the thing
       being tested is what happens to the place the OPERATOR is at, which is
       the place the transport is showing. */
    await page.evaluate(() => {
      const scrub = document.querySelector('input[aria-label="Seek"]');
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      set.call(scrub, "2");
      scrub.dispatchEvent(new Event("change", { bubbles: true }));
    });
    try {
      await page.waitForFunction(
        () => {
          const v = document.querySelector("[data-clip-stage] video");
          return v && Math.abs(v.currentTime - 2) < 0.4;
        },
        { timeout: 8000 },
      );
    } catch (err) {
      throw new Error(
        err.message +
          " | " +
          JSON.stringify(
            await page.evaluate(() => {
              const v = document.querySelector("[data-clip-stage] video");
              const r = document.querySelector('input[aria-label="Seek"]');
              return v
                ? { t: v.currentTime, d: v.duration, ready: v.readyState, seekable: v.seekable.length, paused: v.paused, max: r?.max, val: r?.value }
                : null;
            }),
          ),
      );
    }

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
    try {
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("[data-clip-stage] video")].every((v) =>
            /c\d-2k/.test(v.getAttribute("src") ?? ""),
          ),
        { timeout: 8000 },
      );
    } catch (err) {
      const dbg = await page.evaluate(() => ({
        srcs: [...document.querySelectorAll("[data-clip-stage] video")].map((v) => v.getAttribute("src")),
        feed: (window.__feed.alerts ?? []).map((a) => [a.id, a.site?.rev, a.site?.best_quality, (a.site?.clips ?? []).length]),
      }));
      throw new Error(err.message + " | " + JSON.stringify(dbg));
    }
    try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-clip-stage] video")].every(
          (v) => v.readyState >= 1 && Math.abs(v.currentTime - 2) < 0.6,
        ),
      { timeout: 8000 },
    );
    } catch (err) {
      const dbg = await page.evaluate(() =>
        [...document.querySelectorAll("[data-clip-stage] video")].map((v) => ({
          src: v.getAttribute("src"), t: v.currentTime, r: v.readyState, d: v.duration,
        })),
      );
      throw new Error(err.message + " | " + JSON.stringify(dbg));
    }
    /* And it is still playable after the swap. */
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === "Play",
      );
      b?.click();
    });
    await page.waitForFunction(
      () => {
        const v = document.querySelector("[data-clip-stage] video");
        return v && !v.paused && v.currentTime > 2;
      },
      { timeout: 8000 },
    );
    const panes = await stage();
    for (const v of panes) assert.equal(v.err, null, "the upgrade broke a pane");
    await closePlayer();
  });

  /* ================================================================
   *  THE LAB'S BUG: a clip that arrives after the alert is opened
   * ================================================================ */

  /**
   * ⭐ THE EXACT PATH THE LAB REPORTED, TWICE OVER.
   *
   * A `TOWER_ONLINE` clip is cut from the first 60 s AFTER the tower
   * returned, so it lands about a minute later: the alert is opened on "Clip
   * coming" and the clip appears under it. On the hub that came up with a
   * transport reading `0s / 1m` that would not start, while an alert whose
   * clip already existed played perfectly.
   *
   * What made it invisible here was the harness, not the test list: the
   * clips pointed at a host that does not resolve and `play()` was a stub
   * that resolved, so "it plays" could not be asked. It is asked now, by
   * watching `currentTime` move on a real element.
   *
   * Run through BOTH doors, because they arrive at the player differently:
   * the list selects a row, and the toast sets `openAlertId` from outside
   * the screen.
   */
  const arriveThenPlay = async (door) => {
    const id = `late-${door}`;
    await page.evaluate(
      ([alertId, dev]) =>
        window.__push("alert.new", {
          id: alertId,
          type: "TOWER_ONLINE",
          colour: "green",
          device_id: dev,
          cameras: [1],
          started_at: "2026-10-28T13:00:00Z",
          started_epoch: 1793192400,
          acknowledged: false,
          rev: 1,
        }),
      [id, EAST],
    );
    await page.waitForFunction(
      (alertId) => (window.__feed.alerts ?? []).some((a) => a.id === alertId),
      id,
      { timeout: 5000 },
    );

    if (door === "toast") {
      await page.evaluate(() => {
        const card = [...document.querySelectorAll("[role='group']")].at(-1);
        const open = [...(card?.querySelectorAll("button") ?? [])].find(
          (b) => b.textContent?.trim() === "Open",
        );
        open?.click();
      });
    } else {
      /* ⚠ EAST, NOT WEST. `cccc2222` is already "WEST TOWER back online",
         and two rows reading the same words means `openRow` picks whichever
         sorts first -- which is the late one, with its clip already there,
         testing nothing. The ack and stale-read tests below select
         `cccc2222` by those same words. */
      await openRow("EAST TOWER back online");
    }
    await page.waitForTimeout(200);
    /* Opened on "Clip coming", which is the state the lab opened it in. */
    assert.match(await page.textContent("body"), /Clip coming/);

    /* ...and now the hub finishes the cut. */
    await page.evaluate(
      ([alertId, dev, c]) =>
        window.__push("alert.updated", {
          id: alertId,
          type: "TOWER_ONLINE",
          colour: "green",
          device_id: dev,
          cameras: [1],
          started_at: "2026-10-28T13:00:00Z",
          started_epoch: 1793192400,
          acknowledged: false,
          best_quality: "standard",
          clips: [c],
          rev: 2,
        }),
      [id, EAST, clip(1, "standard", `late-${door}-c1`)],
    );
    await page.waitForSelector("[data-alert-clip-hero]", { timeout: 5000 });

    await openPlayer(0);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === "Play",
      );
      b?.click();
    });
    /* THE ASSERTION. Not "a play button exists" — the frames moved. */
    await page.waitForFunction(
      () => {
        const v = document.querySelector("[data-clip-stage] video");
        return v && !v.paused && v.currentTime > 0.2;
      },
      { timeout: 10_000 },
    );
    const panes = await stage();
    assert.equal(panes[0].err, null, `the late clip errored: ${panes[0].err}`);
    assert.ok(panes[0].t > 0.2, "the late clip never started");
    /* And nothing is complaining over the picture. */
    assert.equal(
      await page.evaluate(() => document.querySelectorAll("[data-clip-problem]").length),
      0,
    );
    await closePlayer();
  };

  test("⭐ a clip that arrives AFTER the alert is opened plays, from the list", async () => {
    await arriveThenPlay("list");
  });

  test("⭐ ...and from the toast", async () => {
    await arriveThenPlay("toast");
  });

  test("⭐ an expired ticket is re-minted and retried ONCE", async () => {
    /* `url` is minted per request and a presigned bucket URL lives fifteen
       minutes. A player that read a 403 as "broken" would tell somebody the
       evidence is gone when it is one request away. */
    /* On a known alert, not on whichever one the test before left open. */
    await openRow("WEST TOWER offline");
    await page.waitForSelector("[data-alert-clip-hero]", { timeout: 5000 });
    await page.evaluate(() => {
      window.__clipStatus = 403;
      window.__gets = [];
    });
    /* ⚠ THE HERO'S POSTER IS THE CANARY. It loads the clip's first frame,
       so it meets an expired ticket before anybody presses play -- which is
       the point: an operator who opens an alert from this morning should not
       have to press a dead button to find out. */
    await page.evaluate(() => {
      document
        .querySelector("[data-alert-clip-hero] video")
        ?.dispatchEvent(new Event("error"));
    });
    await page.waitForFunction(() => window.__gets.length > 0, { timeout: 5000 });
    const gets = await page.evaluate(() => window.__gets);
    assert.equal(gets.length, 1, "the alert was re-read more than once");
    assert.match(gets[0], /\/v1\/viewer\/site-alerts\/aaaa0000$/);

    /* And a SECOND 403 on the same clip is not an expiry; it is a server
       refusing, and retrying it in a loop would be this app causing the
       outage it is reporting. */
    await page.evaluate(() => {
      document
        .querySelector("[data-alert-clip-hero] video")
        ?.dispatchEvent(new Event("error"));
    });
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => window.__gets.length),
      1,
      "a second expiry started a retry loop",
    );
    await page.evaluate(() => { window.__clipStatus = 200; });
  });

  test("⭐ an evicted clip says the alert is kept", async () => {
    /* Clips go before footage, never the other way round, and the alert
       survives its clip deliberately: an alert is the record that the camera
       stopped at 03:14, and deleting it to save an attachment would be
       deleting the incident. */
    await page.evaluate(() => {
      window.__clipStatus = 404;
      const row = [...document.querySelectorAll("button")].find((b) =>
        /NORTH GATE camera stopped working/.test(b.textContent ?? ""),
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
    assert.match(text, /NORTH GATE camera stopped working/);
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
        /NORTH GATE camera stopped working/.test(b.textContent ?? ""),
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

  test("⭐ the Timeline is back, built from the alert's own stamps", async () => {
    /* It was dropped for server alerts on the argument that coordination's
       five kinds are single events. Wrong on a real hub: an alert carries up
       to four moments, and the DELTAS between them are the reading.
       "Frames stopped at 03:14, raised at 03:15, back at 03:19" is the
       handoff; three separate cells are not. */
    await openRow("NORTH GATE camera stopped working");
    await page.waitForSelector("[data-alert-story]", { timeout: 5000 });
    const story = await page.textContent("[data-alert-story]");
    assert.match(story, /Frames stopped arriving from NORTH GATE camera/);
    assert.match(story, /Alert raised/);
    assert.match(story, /Frames arriving again/);
    assert.match(story, /Acknowledged by Terra Industries/);
  });

  test("⭐ the raise is one minute after the event, and the deltas say so", async () => {
    /* `started_at` is the EVENT, not the raise: the hub waits 60 s before
       raising anything, and stamps the alert at the event so the clip window
       lands on the minute BEFORE it rather than on the minute of dead feed
       after. That gap is the only derived stamp on the timeline. */
    const story = await page.textContent("[data-alert-story]");
    /* The event at 01:00:00 PM in site time, the raise at 01:01:00 PM.
       ⚠ FROM `started_epoch`, NOT `started_at`: the epoch is the field the
       whole app compares on, and the two are allowed to be written
       independently in a fixture. */
    assert.match(story, /01:00:00 PM/);
    assert.match(story, /01:01:00 PM/);
    /* And the elapsed column, which is the thing a column of clock times
       cannot show when several steps land inside one minute. */
    assert.match(story, /\+1m 00s/);
    assert.match(story, /\+5m 00s/);
  });

  test("⭐ a 2K upgrade is a step with NO clock, not an invented one", async () => {
    /* The hub attaches the better cut during a sweep and the row carries no
       stamp for when. A wall-clock time made up for it would be the one line
       on a handoff that nothing can corroborate. */
    await page.evaluate(
      ([alert, big]) =>
        window.__push("alert.updated", {
          ...alert,
          rev: 20,
          best_quality: "2k",
          clips: [...alert.clips, big],
        }),
      [STOPPED_ALERT, clip(1, "2k", "c3-2k")],
    );
    await page.waitForFunction(
      () => /2K clip added/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const lastStep = await page.evaluate(() => {
      const li = [...document.querySelectorAll("[data-alert-story] li")].at(-1);
      return { text: li?.textContent ?? "", stamps: li?.querySelectorAll("p").length ?? 0 };
    });
    assert.match(lastStep.text, /2K clip added/);
    assert.equal(lastStep.stamps, 1, "the undated step was given a clock");
  });

  test("⭐ the header shows a readable id, and keeps the full one on copy", async () => {
    /* `95ae76a8085641718fc1a64cbda85280` shipped here. Thirty-two hex
       characters cannot be read aloud on a handoff, compared by eye against
       another screen, or fitted on the line. */
    const header = await page.evaluate(() => {
      const b = document.querySelector("[data-alert-id]");
      return b ? { text: b.textContent.trim(), title: b.getAttribute("title") } : null;
    });
    assert.ok(header, "the id is not a copyable control");
    assert.equal(header.text, "ALT-BBBB11");
    /* The full one is still reachable — by us, in a log. */
    assert.match(header.title, /^bbbb1111/);
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
  let detail;
  let clipsSrc;
  before(async () => {
    app = await readFile(join(SRC, "App.tsx"), "utf8");
    copy = await readFile(join(SRC, "lib/alertCopy.ts"), "utf8");
    detail = await readFile(join(SRC, "components/AlertDetail.tsx"), "utf8");
    clipsSrc = await readFile(join(SRC, "components/AlertClips.tsx"), "utf8");
  });

  test("⭐ the shell does not import the fixture list at all", () => {
    /* Not merely "does not use it": an import is one line from being used, and
       this one was used for a year. */
    assert.ok(!/^\s*ALERTS,$/m.test(app), "App imports ALERTS again");
    assert.ok(!/can\(features, "alerts"\) \? ALERTS/.test(app));
  });

  test("the feed comes from the hook", () => {
    assert.match(app, /useSiteAlerts\(\{[\s\S]{0,40}enabled: alertsEnabled/);
  });

  test("⭐ the detail footer clears the notifications chip", () => {
    /* `NotificationStack` is a fixed overlay pinned 16px from the bottom
       right of the VIEWPORT, and at lg the alert detail ends in that same
       corner — so its "Recent" chip painted straight over the Escalate
       button. The chip is persistent once anything has passed through the
       stack, and alerts are exactly what puts things through it.

       Fixed on the panel rather than by moving the overlay: the overlay is
       global and correct where it is, and the thing that must give way is
       the panel that chose to end in an occupied corner. */
    assert.match(detail, /lg:pb-\[46px\]/);
    const stack = fsSync.readFileSync(
      join(SRC, "components/NotificationStack.tsx"),
      "utf8",
    );
    assert.match(stack, /sm:bottom-\[16px\]/, "the chip moved; re-measure the clearance");
  });

  test("⭐ there is ONE player, and the alert detail does not grow a second", () => {
    /* What shipped was an inline transport on this surface alone: two video
       elements, a play button, a range input and two save links. The
       detection alerts already had a player with a scrub bar, a wall-clock
       readout, speed, mute and a download, and a REAL alert — the only kind
       there now is — got the plain bar. */
    assert.ok(!/input\s+type="range"/.test(clipsSrc), "the inline bar is back");
    assert.ok(!/<video[^>]*controls/.test(clipsSrc), "the hero grew browser controls");
    /* The hero hands the panes up, and the panel owns the player. */
    assert.match(clipsSrc, /onPlay\(/);
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
