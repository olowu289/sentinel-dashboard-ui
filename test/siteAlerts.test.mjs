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
import { fileURLToPath, pathToFileURL } from "node:url";
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
  /* The same colours as the tower pair, deliberately: one incident type, one
     colour, whichever tier noticed. */
  HUB_OFFLINE: "red",
  HUB_ONLINE: "green",
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

/**
 * A clip EXACTLY as the event stream sends one, from the lab's own capture:
 *
 *   id 5  alert.updated  {rev 2, clips:[{camera, duration, key, quality,
 *                         size, start, start_epoch}]}
 *
 * ⚠ NO `url` AND NO `download_url`, AND THAT IS THE SERVER BEING CORRECT.
 * Both are minted per request and must not be cached — a presigned bucket
 * URL lives fifteen minutes, and a pushed frame can sit in a queue. So the
 * hub mints them on `GET` and leaves them off the push, and the browser's
 * half of that bargain is to go and ask.
 */
const pushedClip = (camera, quality, key) => ({
  camera,
  quality,
  key,
  start: "2026-10-28T12:09:00Z",
  start_epoch: EPOCH - 60,
  duration: 52.7,
  size: 6_800_000,
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

/* ──────────────────────────────────────────────────────────────────────
 *  THE HUB ITSELF (docs/alerts.md 1a)
 *
 *  Raised by the DATA CENTRE, not by a hub, and `device_id` carries the
 *  HUB's id. A hub is not in the fleet under any id -- the fleet holds its
 *  MAST, which is a different box with a different name -- so the tower
 *  lookup cannot answer and the name comes from the cells list.
 * ────────────────────────────────────────────────────────────────────── */
const HUB = "hub-kln-lab";
/* A second one, so the alert that was ANSWERED has a title of its own and
   the browser tests below cannot open the wrong row. An organization with
   two sites has two hubs, which is ordinary. */
const HUB2 = "hub-kln-river";
const HUB_NAMES = { [HUB]: "North camp", [HUB2]: "River camp" };

/** `cameras` is usually empty here: the DC knows the hub, not its mast. */
const HUB_OFFLINE_ALERT = {
  id: "hhhh5555",
  type: "HUB_OFFLINE",
  colour: "red",
  device_id: HUB,
  cameras: [],
  started_at: "2026-10-28T12:35:00Z",
  started_epoch: EPOCH + 1500,
  acknowledged: false,
  rev: 1,
};

const HUB_ONLINE_ALERT = {
  id: "iiii6666",
  type: "HUB_ONLINE",
  colour: "green",
  device_id: HUB,
  cameras: [],
  started_at: "2026-10-28T13:05:00Z",
  started_epoch: EPOCH + 3300,
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

  /* ⚠ TYPE-AWARE, LIKE THE SHELL'S. Two lists, and the alert's type is the
     only thing that says which one to ask -- a resolver that only knows
     towers answers `undefined` for a hub, which is the fallback-to-the-id
     case the tests below also cover deliberately. */
  const nameOf = (id, type) => (copy.isHubAlert(type) ? HUB_NAMES[id] : NAMES[id]);
  const towersOnly = (id) => NAMES[id];
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

  /* ================================================================
   *  THE HUB PAIR, AND THE FOUR WAYS A CLIP CAN BE
   * ================================================================ */

  test('⭐ a HUB is offline too, and "down" is wronger here than for a tower', () => {
    /* docs/alerts.md 1a: the data centre cannot tell a dead hub from a dead
       internet link. The box on the other end may be serving its own site
       perfectly over the LAN -- recording, watching, raising its own alerts
       -- with nothing but the uplink gone. "Down" would be a claim about the
       hub; "offline" is a claim about the link, which is all there is
       evidence for. */
    const title = copy.alertTitle(HUB_OFFLINE_ALERT, nameOf);
    assert.equal(title, "NORTH CAMP offline");
    assert.ok(!/down/i.test(title));
    assert.equal(copy.alertTitle(HUB_ONLINE_ALERT, nameOf), "NORTH CAMP back online");
  });

  test("⭐ and the hub's name does NOT come from the tower lookup", () => {
    /* THE BUG THIS GUARDS. A hub is not in the fleet under any id: the fleet
       holds its MAST, which is a different box with a different name. A
       resolver that only knows towers answers `undefined` and the row reads
       the id, which is the third writing rule broken on the one line an
       operator reads out loud. */
    assert.equal(
      copy.alertTitle(HUB_OFFLINE_ALERT, towersOnly),
      "HUB-KLN-LAB offline",
      "a hub resolved through the tower list should fall back to its id",
    );
    /* Which is the fallback and not the answer. With the right list: */
    assert.equal(copy.alertTitle(HUB_OFFLINE_ALERT, nameOf), "NORTH CAMP offline");
    /* And the type is what the resolver is told. */
    const asked = [];
    copy.alertTitle(HUB_OFFLINE_ALERT, (id, type) => {
      asked.push([id, type]);
      return undefined;
    });
    assert.deepEqual(asked, [[HUB, "HUB_OFFLINE"]]);
  });

  test("⭐ the hub's name is in CAPITALS, like every other device's", () => {
    /* A hub is a box at a site with a label on it, read across a control
       room and said out loud on a radio. The organization that owns it is
       not, and is left exactly as somebody wrote it. */
    assert.match(copy.alertTitle(HUB_OFFLINE_ALERT, nameOf), /^NORTH CAMP/);
    assert.ok(copy.isHubAlert("HUB_OFFLINE"));
    assert.ok(copy.isHubAlert("HUB_ONLINE"));
    assert.ok(!copy.isHubAlert("TOWER_OFFLINE"));
    assert.ok(!copy.isHubAlert(undefined));
  });

  test("⭐ a hub that stopped answering is a FAULT, like a tower", () => {
    /* And it is the worse one: a tower going quiet loses a mast, a hub going
       quiet loses the site's whole link to anybody watching it. */
    assert.equal(copy.alertKind("HUB_OFFLINE"), "fault");
    /* Coming back is not a fault, exactly as for the tower pair. */
    assert.equal(copy.alertKind("HUB_ONLINE"), "alert");
  });

  test("⭐ the four clip states are four different situations", () => {
    /* ⚠ AND "NO CLIP" FOR ALL OF THEM WOULD BE ONE SCREEN FOR FOUR, three
       of which somebody should act on. */
    const withClips = (clips, extra = {}) => ({ ...HUB_OFFLINE_ALERT, clips, ...extra });

    assert.equal(
      copy.clipState(withClips([clip(1, "standard", "h1")])),
      "playable",
    );
    assert.equal(
      copy.clipState(withClips([pushedClip(1, "standard", "h1")])),
      "hubOnly",
      "a clip with no url is a clip that exists and cannot be fetched from here",
    );
    /* No clips on a HUB alert is not "coming in a minute": the footage is on
       the box that went away, nothing polls for it, and a hub can be away
       for WEEKS. */
    assert.equal(copy.clipState(HUB_OFFLINE_ALERT), "pending");
    assert.equal(
      copy.clipState({ ...HUB_OFFLINE_ALERT, progress: { footage: "none" } }),
      "none",
    );
    /* A tower's cut lands about a minute later, which is the ordinary wait. */
    assert.equal(copy.clipState(ONLINE_ALERT), "coming");
    /* And the recovery pair has no moment to cut around at all. */
    assert.equal(copy.clipState(RECOVERING_ALERT), "never");
  });

  test("⭐ one clip with a url makes the alert playable, not half of one", () => {
    /* A mast with two cameras where only one cut reached the bucket shows
       that one. Refusing both because of the other is a blank screen over a
       file that is sitting right there. */
    const mixed = {
      ...HUB_OFFLINE_ALERT,
      clips: [pushedClip(1, "standard", "h1"), clip(2, "standard", "h2")],
    };
    assert.equal(copy.clipState(mixed), "playable");
    assert.equal(story.alertPanes(mixed).length, 1, "the urlless clip reached a player");
    assert.equal(story.alertClipCards(mixed).length, 2, "the urlless clip is not described");
  });

  test("⭐ each absence SAYS WHY, in one line and one of help", () => {
    const words = ["hubOnly", "pending", "none", "coming"].map(copy.clipWords);
    for (const w of words) {
      assert.ok(w.headline.length > 0 && w.help.length > 0);
      assert.ok(!w.headline.includes("\u2014"), w.headline);
      assert.ok(!w.help.includes("\u2014"), w.help);
      /* No code, no field name, no api path. */
      assert.ok(!/progress|footage_|url|download_url|clips\[/i.test(w.headline));
    }
    assert.equal(copy.clipWords("hubOnly").headline, "Clip on the hub only");
    assert.equal(copy.clipWords("pending").headline, "Footage pending, the hub is away");
    assert.equal(copy.clipWords("none").headline, "No footage of that moment");
    assert.equal(copy.clipWords("coming").headline, "Clip coming");
    /* The two that HAVE a picture say nothing at all. */
    assert.equal(copy.clipWords("playable"), null);
    assert.equal(copy.clipWords("never"), null);
  });

  test("⭐ the hub's timeline is the hub's own sequence", () => {
    const steps = story.alertStory(
      {
        ...HUB_OFFLINE_ALERT,
        recovered_at: "2026-10-28T12:55:00Z",
        clips: [pushedClip(1, "standard", "h1")],
      },
      nameOf,
    );
    assert.deepEqual(
      steps.map((x) => x.title),
      ["Hub stopped connecting", "Alert raised", "Back online", "Footage attached"],
    );
    /* The raise is one minute after the event, as it is for every type: the
       debounce is the feature, and it is a documented constant. */
    assert.equal(steps[1].at - steps[0].at, 60_000);
    /* ⚠ AND "Footage attached" HAS NO CLOCK. The row carries no time for
       when the clips landed, and an invented one would be the single line on
       a handoff that nothing can corroborate. */
    assert.equal(steps[3].at, null);
  });

  test("⭐ and a hub that answered with nothing says so, on the timeline too", () => {
    const steps = story.alertStory(
      { ...HUB_OFFLINE_ALERT, progress: { footage: "none" } },
      nameOf,
    );
    assert.deepEqual(
      steps.map((x) => x.title),
      ["Hub stopped connecting", "Alert raised", "No footage of that moment"],
    );
    /* One definition of that sentence, shared with the clip area. */
    assert.equal(steps[2].title, copy.clipWords("none").headline);
  });

  test("⭐ HUB_ONLINE's first step is the good news, because the event IS the return", () => {
    const steps = story.alertStory(HUB_ONLINE_ALERT, nameOf);
    assert.equal(steps[0].title, "Back online");
    assert.equal(steps[1].title, "Alert raised");
  });

  test("a tower alert gets NO footage step, because its clip is cut at the raise", () => {
    /* "Footage attached" under every tower alert would be a step saying what
       the picture above it already shows. It is a real event only for a hub,
       whose clip arrives separately and may take weeks. */
    const titles = story.alertStory(OFFLINE_ALERT, nameOf).map((x) => x.title);
    assert.ok(!titles.includes("Footage attached"), titles.join(" | "));
  });

  test("⭐ a hub's cameras appear on its clips, side by side like a tower's", () => {
    /* The DC names neither the mast nor its cameras in the pending row and
       cannot -- an empty list means "every mast camera you have", resolved
       by the hub when it is asked. So the cameras arrive WITH the clips. */
    const both = {
      ...HUB_OFFLINE_ALERT,
      cameras: [1, 2],
      best_quality: "standard",
      clips: [clip(2, "standard", "h2"), clip(1, "standard", "h1")],
    };
    const panes = story.alertPanes(both);
    assert.equal(panes.length, 2);
    /* In camera order, whatever order the server listed them in. */
    assert.deepEqual(panes.map((x) => x.clip.camera), [1, 2]);
  });

  test("⭐ a clip that cannot be fetched is still DESCRIBED", () => {
    /* docs/alerts.md 4: every other clip field is still there, so the clip
       can be described. That is the whole point of the state -- the alert
       says what exists and where, rather than looking like an alert with no
       evidence at all. */
    const held = {
      ...HUB_OFFLINE_ALERT,
      cameras: [1, 2],
      best_quality: "standard",
      clips: [pushedClip(1, "standard", "h1"), pushedClip(2, "standard", "h2")],
    };
    const cards = story.alertClipCards(held, cameraNameOf);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].attachment.durationSec, 52.7);
    assert.equal(cards[0].attachment.quality, "Standard");
    /* ⚠ AND NO SOURCE, so nothing can hand one of these to a player. */
    assert.equal(cards[0].attachment.src, "");
    assert.equal(story.alertPanes(held).length, 0);
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

/* ======================================================================
 *  2. THROUGH THE REAL SDK PARSER, WITH THE PAYLOADS THE WIRE CARRIES
 *
 *  The suite above feeds the copy layer objects written by hand, which is
 *  the right test for a sentence and the wrong one for a CONTRACT. A field
 *  this side reads is only there if `@kallon/sentry-sdk` carried it, and the
 *  SDK's parsers are strict by design: everything optional is copied key by
 *  key, so a key nobody added is a key that silently never arrives. That is
 *  not hypothetical -- see the last test in this block.
 * ====================================================================== */

describe("what survives the SDK parser", () => {
  let sdk;
  let copy;
  let story;

  before(async () => {
    sdk = await import(pathToFileURL(SDK).href);
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "alert-parse-"));
    scratch.push(dir);
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

  /** One alert, as a real SSE frame, read back through the real framing. */
  const overTheWire = (kind, alert) => {
    const buffer = new sdk.SseBuffer();
    const NL = String.fromCharCode(10);
    const frames = buffer.push(
      "event: " + kind + NL + "data: " + JSON.stringify(alert) + NL + NL,
    );
    assert.equal(frames.length, 1, "the frame did not complete");
    const event = sdk.alertEventOf(frames[0]);
    assert.ok(event, "the parser refused the frame");
    return event;
  };

  const nameOf = (id, type) => (copy.isHubAlert(type) ? HUB_NAMES[id] : NAMES[id]);

  test("⭐ a type this SDK predates still arrives, and reads", () => {
    /* `AlertType` lists five and ends in `(string & {})`, and `colour` is
       parsed as a plain string -- so a hub pair the SDK was built before
       passes through it untouched. That openness is the whole reason the
       list endpoint sends a `colours` map, and this is the proof that it
       works rather than the assumption that it does. */
    const event = overTheWire("alert.new", HUB_OFFLINE_ALERT);
    assert.equal(event.kind, "alert.new");
    assert.equal(event.alert.type, "HUB_OFFLINE");
    assert.equal(event.alert.colour, "red");
    assert.equal(event.alert.device_id, HUB);
    assert.equal(copy.alertTitle(event.alert, nameOf), "NORTH CAMP offline");
    assert.equal(copy.alertColour(event.alert.colour).strip, "bg-critical");
  });

  test("⭐ an empty camera list survives as an empty list", () => {
    /* `cameras` is usually [] on a HUB_OFFLINE: the data centre knows the
       hub and not its mast, and an empty list means "every mast camera you
       have", resolved by the hub when it is asked. It must not become
       `undefined` and must not become `[0]`. */
    const { alert } = overTheWire("alert.new", HUB_OFFLINE_ALERT);
    assert.deepEqual(alert.cameras, []);
    assert.equal(copy.clipState(alert), "pending");
  });

  test("⭐ a clip with NO url survives, which is the hub-only state", () => {
    /* The field rule is "absent, never null", and the parser honours it by
       omitting rather than emitting. A clip is still a clip without its
       tickets -- camera, quality, key, start, duration and size are all
       there, which is exactly what lets the screen describe it. */
    const { alert } = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 2,
      cameras: [1, 2],
      best_quality: "standard",
      clips: [pushedClip(1, "standard", "h1"), pushedClip(2, "standard", "h2")],
    });
    assert.equal(alert.clips.length, 2);
    assert.ok(!("url" in alert.clips[0]), "a url appeared from nowhere");
    assert.equal(copy.clipState(alert), "hubOnly");
    const cards = story.alertClipCards(alert);
    assert.deepEqual(cards.map((c) => c.clip.camera), [1, 2]);
    assert.equal(cards[0].attachment.durationSec, 52.7);
  });

  test("⭐ and the same clips WITH urls are playable, side by side", () => {
    const { alert } = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 3,
      cameras: [1, 2],
      best_quality: "standard",
      clips: [clip(1, "standard", "h1"), clip(2, "standard", "h2")],
    });
    assert.equal(copy.clipState(alert), "playable");
    assert.equal(story.alertPanes(alert).length, 2);
    assert.deepEqual(
      story.alertStory(alert, nameOf).map((x) => x.title),
      ["Hub stopped connecting", "Alert raised", "Footage attached"],
    );
  });

  test("⭐ a hub coming back reads, and recovers the open alert", () => {
    const { alert } = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 4,
      recovered_at: "2026-10-28T12:55:00Z",
    });
    assert.equal(copy.alertTitle(alert, nameOf), "NORTH CAMP offline");
    assert.ok(
      story.alertStory(alert, nameOf).some((x) => x.title === "Back online"),
    );
    const back = overTheWire("alert.new", HUB_ONLINE_ALERT);
    assert.equal(copy.alertTitle(back.alert, nameOf), "NORTH CAMP back online");
    assert.equal(copy.alertColour(back.alert.colour).strip, "bg-terra");
  });

  test('⭐ "No footage of that moment" ARRIVES, and it is a verdict not a number', () => {
    /* ⭐ THIS IS THE TEST THAT USED TO BE TWO.

       One of them asserted that the parser DROPPED `progress.footage` and
       said in its own message to delete itself the day it stopped: the SDK
       took `progress` as four numbers and copied them by name, so the block
       reached this side as `{}` and the hub's answer never crossed the wire.
       The other stood behind it, feeding the field in by hand so the reading
       was written and tested before it could arrive. SDK 0.13.1 carries it,
       the first failed exactly as designed, and this is the pair collapsed
       into the real path: the payload the data centre publishes, through the
       real framing and the real parser, into the words on the screen.

       docs/alerts.md 3b: a hub with no recording covering the instant answers
       with an EMPTY clip list, the alert gets `progress.footage = "none"`,
       and the pending row is deleted so nothing waits for ever. That is an
       answer, not a failure, and the difference between it and `pending` is
       the difference between "stop waiting" and "this may still arrive in a
       fortnight". */
    const { alert } = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 5,
      progress: { footage: "none" },
    });
    /* ⚠ EXACTLY THAT, AND NOTHING BESIDE IT. The SDK's own note: a block
       holding only this is the whole shape of an answered HUB_OFFLINE, so
       nothing downstream may assume a number was seen first. */
    assert.deepEqual(alert.progress, { footage: "none" });
    assert.equal(copy.footageAnswer(alert), "none");
    assert.equal(copy.clipState(alert), "none");
    assert.equal(copy.clipWords("none").headline, "No footage of that moment");
    assert.deepEqual(
      story.alertStory(alert, nameOf).map((x) => x.title),
      ["Hub stopped connecting", "Alert raised", "No footage of that moment"],
    );
  });

  test("\⭐ and a progress block with no numbers in it draws NO BAR", () => {
    /* ⚠ THE FAILURE THIS GUARDS IS A BAR AT 0%, which would say "a
       transfer is under way and has moved nothing" over an alert whose whole
       content is that there is nothing to transfer. A block that exists
       decides nothing; every field is read on its own. */
    const { alert } = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 5,
      progress: { footage: "none" },
    });
    assert.equal(copy.recoveryProgress(alert), undefined, "a 0% bar was drawn");
    assert.equal(copy.recoveryDetail(alert), undefined, "an empty count line was drawn");
    /* And the one that genuinely is a transfer still reports itself. */
    const moving = overTheWire("alert.updated", RECOVERING_ALERT);
    assert.equal(copy.recoveryProgress(moving.alert), 0.25);
    assert.equal(copy.recoveryDetail(moving.alert), "6 files, about 29 min left");
  });

  test("\⭐ and NO progress block at all is still pending, because absence is not a verdict", () => {
    /* ⚠ THE OTHER WAY TO READ THIS FIELD WRONGLY, and the SDK's release
       note says it first: its absence is not "there is footage". Nothing
       answered yet is also absent, and that is where every HUB_OFFLINE
       starts and may sit for weeks while its hub is away. Only "none" is a
       statement. */
    const { alert } = overTheWire("alert.new", HUB_OFFLINE_ALERT);
    assert.equal(alert.progress, undefined);
    assert.equal(copy.footageAnswer(alert), undefined);
    assert.equal(copy.clipState(alert), "pending");
    assert.equal(
      copy.clipWords("pending").headline,
      "Footage pending, the hub is away",
    );
    /* An EMPTY block answers nothing either, which is the shape an older
       data centre's `progress` arrives in. */
    const empty = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 2,
      progress: {},
    });
    assert.equal(copy.clipState(empty.alert), "pending");
  });

  test("\⭐ a verdict this build has never heard of is not read as \"none\"", () => {
    /* `footage` is a code left as a plain string so a later verdict needs no
       SDK release to pass through. It must not be guessed at here: anything
       that is not "none" has not told this bundle that the waiting is over. */
    const { alert } = overTheWire("alert.updated", {
      ...HUB_OFFLINE_ALERT,
      rev: 6,
      progress: { footage: "partial" },
    });
    assert.equal(copy.footageAnswer(alert), "partial");
    assert.equal(copy.clipState(alert), "pending");
  });
});

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
       import { isHubAlert } from "@/lib/alertCopy";
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
         /* ⚠ TYPE-AWARE, EXACTLY AS THE SHELL'S IS, and the test is only
            honest because it is. A hub is not in the fleet under any id --
            the fleet holds its MAST -- so a resolver that only knows towers
            answers undefined for a HUB_OFFLINE and the row reads the raw
            id. Two lists, and the alert type says which one to ask. */
         const nameOf = useCallback(
           (id: string, type?: string) =>
             isHubAlert(type)
               ? (window as any).__hubNames[id]
               : TOWERS.find((t: any) => t.id === id)?.site,
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
             nameOf,
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
      ([list, towers, hubNames]) => {
        const w = window;
        /* The frame separator, BUILT rather than written. This function is
           serialized to the page as source, and a newline escape inside it is
           one round of escaping away from becoming a line continuation --
           which silently produces a frame with no newlines in it at all, and
           the SDK's buffer then holds it for ever waiting for a blank line
           that never comes. Nothing errors; the stream simply never delivers. */
        const NL = String.fromCharCode(10);
        w.__towers = towers;
        /* The cells list, as the shell reads it: a hub id and the name
           somebody chose. The fleet below holds neither. */
        w.__hubNames = hubNames;
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
        /* ⚠ THE SERVER MINTS CLIP URLS ON `GET` AND NOT ON THE PUSH, and the
           harness has to do the same or it cannot show the bug. `url` and
           `download_url` are per-request credentials that live fifteen
           minutes; a frame sitting in a queue carrying one would hand out a
           dead link, so the hub leaves them off a push and puts them on an
           answer. The browser's half of that is to go and ask, which is what
           is under test. */
        w.mint = (alert) => {
          if (!alert?.clips) return alert;
          return {
            ...alert,
            clips: alert.clips.map((c) =>
              c.url
                ? c
                : {
                    ...c,
                    url: `https://clips.test/${c.key}.mp4`,
                    download_url: `https://clips.test/${c.key}.mp4?dl=1`,
                    filename: `${c.key}.mp4`,
                  },
            ),
          };
        };

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
            return json(w.__refreshed ?? w.mint(w.__alerts.get(one[1])));
          }

          if (path.includes("/v1/viewer/site-alerts")) {
            w.__listUrls = w.__listUrls ?? [];
            w.__listUrls.push(path);
            for (const [k, v] of w.__alerts) w.__alerts.set(k, v);
            w.__listAuth = w.__listAuth ?? [];
            w.__listAuth.push((init.headers ?? {}).Authorization ?? null);
            return json({
              alerts: [...w.__alerts.values()].map(w.mint),
              colours: list.colours,
            });
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
        HUB_NAMES,
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
      /* ⚠ THE CARD FOR THIS ALERT, not whichever is last in the DOM. Cards
         live 45 seconds now (they carry a button, and the nine-second
         default retired them before anybody could look up), so several are
         on screen at once and the stack orders them newest-nearest-the-
         corner. Picking by position was picking the OLDEST one. */
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("[role='group']")].some((g) =>
            /EAST TOWER back online/.test(g.textContent ?? ""),
          ),
        { timeout: 5000 },
      );
      await page.evaluate(() => {
        const card = [...document.querySelectorAll("[role='group']")].find((g) =>
          /EAST TOWER back online/.test(g.textContent ?? ""),
        );
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

  /* ================================================================
   *  THE LAB'S EVENT PAYLOADS, EXACTLY AS CAPTURED
   * ================================================================ */

  test("⭐ clips pushed WITHOUT urls are fetched, and become playable", async () => {
    /* The lab's three frames for one incident, verbatim:
         id 4  alert.new      {type CAMERA_STOPPED, rev 1, no clips}
         id 5  alert.updated  {rev 2, clips:[{...}]}   <- NO url
         id 6  alert.updated  {rev 3, recovered_at}
       The clip sat on "Clip coming" until a hard refresh, because the push
       carries no URL and nothing on this side went and asked for one. The
       reload worked only because the LIST mints them. */
    const id = "pushed-0001";
    const base = {
      id,
      type: "CAMERA_STOPPED",
      colour: "orange",
      device_id: WEST,
      cameras: [1],
      started_at: "2026-10-28T12:09:30Z",
      started_epoch: EPOCH + 3000,
      acknowledged: false,
      rev: 1,
    };

    await page.evaluate((a) => {
      window.__gets = [];
      window.__push("alert.new", a);
    }, base);
    await page.waitForFunction(
      (alertId) => (window.__feed.alerts ?? []).some((a) => a.id === alertId),
      id,
      { timeout: 5000 },
    );
    await openRow("NORTH GATE camera stopped working");
    assert.match(await page.textContent("body"), /Clip coming/);

    /* id 5 and id 6, back to back, as they arrived. */
    await page.evaluate(
      ([a, c]) => {
        window.__push("alert.updated", { ...a, rev: 2, best_quality: "standard", clips: [c] });
        window.__push("alert.updated", {
          ...a,
          rev: 3,
          best_quality: "standard",
          clips: [c],
          recovered_at: "2026-10-28T12:12:00Z",
        });
      },
      [base, pushedClip(1, "standard", "pushed-c1")],
    );

    /* ⚠ WITHOUT A REFRESH. The hero appears because the feed went and got
       the URLs, not because anybody reloaded the tab. */
    await page.waitForSelector("[data-alert-clip-hero]", { timeout: 8000 });
    const src = await page.getAttribute("[data-alert-clip-hero] video", "src");
    assert.match(src, /pushed-c1\.mp4/);

    /* And it genuinely plays, which is the only assertion that means
       anything here. */
    await openPlayer(0);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === "Play",
      );
      b?.click();
    });
    await page.waitForFunction(
      () => {
        const v = document.querySelector("[data-clip-stage] video");
        return v && !v.paused && v.currentTime > 0.2;
      },
      { timeout: 10_000 },
    );
    await closePlayer();
  });

  test("⭐ and a burst of those frames causes ONE fetch, not three", async () => {
    /* A raise, a clip and a recovery arrive within seconds of each other on
       a real incident. Re-reading on each is three requests for one answer,
       and the first two are thrown away by the third. */
    const gets = await page.evaluate(() => window.__gets);
    const mine = gets.filter((u) => u.includes("pushed-0001"));
    assert.equal(mine.length, 1, `one fetch per burst, got ${mine.length}`);
  });

  test("⭐ THE LAB'S OWN PAYLOAD, through the real parser, fetches once", async () => {
    /* ⚠ THE PREVIOUS VERSION OF THIS TEST PASSED AND THE BUG WAS STILL
       THERE, so this one is shaped by what hid it.

       The fetch list was built inside a `setRaws` updater and read on the
       next line. React does not run an updater when you call `setState` --
       it has an eager-state bailout that runs the reducer immediately ONLY
       when the hook's update queue is empty. One frame at a time takes that
       path and the list is populated in time; two frames back to back leave
       an update pending, the bailout is skipped, the updater is deferred to
       the render phase, and the side effect reads an empty array. Which is
       every real incident, and is why DevTools showed zero `site-alerts`
       requests after an `alert.updated`.

       So this pushes the raise and the clip WITHOUT awaiting between them,
       which is how they arrive, and uses the hub's own payload verbatim --
       including a fractional `start_epoch` and a clip with no `url`. */
    const LAB = {
      acknowledged: false,
      best_quality: "standard",
      cameras: [1],
      clips: [
        {
          camera: 1,
          duration: 60.0,
          key: "clips/kln_lab_000002/cam1/2026-10-29/labclip.mp4",
          quality: "standard",
          size: 7918500,
          start: "2026-10-29T03:43:04Z",
          start_epoch: 1793245384.595009,
        },
      ],
      colour: "orange",
      device_id: WEST,
      id: "a51acfc7000000000000000000000000",
      rev: 2,
      started_at: "2026-10-29T03:44:04Z",
      started_epoch: 1793245444.595009,
      type: "CAMERA_STOPPED",
    };
    const raise = { ...LAB, rev: 1, best_quality: undefined, clips: undefined };

    await page.evaluate(
      ([first, second]) => {
        window.__gets = [];
        /* ⚠ BACK TO BACK, NO AWAIT. The gap between these two is the whole
           difference between a test that catches this and one that does
           not. */
        window.__push("alert.new", first);
        window.__push("alert.updated", second);
      },
      [raise, LAB],
    );

    /* ONE single-alert GET, which is the request the lab never saw. */
    await page.waitForFunction(
      () => (window.__gets ?? []).some((u) => u.includes("a51acfc7")),
      { timeout: 8000 },
    );
    await page.waitForTimeout(600);
    const mine = (await page.evaluate(() => window.__gets)).filter((u) =>
      u.includes("a51acfc7"),
    );
    assert.equal(mine.length, 1, `one fetch for the burst, got ${mine.length}`);

    /* And the clip is playable, without a refresh. */
    await openRow("NORTH GATE camera stopped working");
    await page.waitForSelector("[data-alert-clip-hero]", { timeout: 8000 });
    assert.match(
      await page.getAttribute("[data-alert-clip-hero] video", "src"),
      /labclip\.mp4/,
    );
    await openPlayer(0);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === "Play",
      );
      b?.click();
    });
    await page.waitForFunction(
      () => {
        const v = document.querySelector("[data-clip-stage] video");
        return v && !v.paused && v.currentTime > 0.2;
      },
      { timeout: 10_000 },
    );
    await closePlayer();
  });

  test("⭐ and a third frame with no clips at all does not undo it", async () => {
    /* The lab's id 6: `recovered_at`, same alert, higher revision. It
       carries the clip list again on a real hub and sometimes does not; in
       either case the clip must stay playable and nothing must be asked
       for a second time. */
    await page.evaluate(() => { window.__gets = []; });
    await page.evaluate(
      (dev) =>
        window.__push("alert.updated", {
          acknowledged: false,
          best_quality: "standard",
          cameras: [1],
          clips: [
            {
              camera: 1,
              duration: 60.0,
              key: "clips/kln_lab_000002/cam1/2026-10-29/labclip.mp4",
              quality: "standard",
              size: 7918500,
              start: "2026-10-29T03:43:04Z",
              start_epoch: 1793245384.595009,
            },
          ],
          colour: "orange",
          device_id: dev,
          id: "a51acfc7000000000000000000000000",
          recovered_at: "2026-10-29T03:46:00Z",
          rev: 3,
          started_at: "2026-10-29T03:44:04Z",
          started_epoch: 1793245444.595009,
          type: "CAMERA_STOPPED",
        }),
      WEST,
    );
    await page.waitForFunction(
      () => /Back at/.test(document.body.innerText),
      { timeout: 5000 },
    );
    await page.waitForTimeout(600);
    assert.equal(
      (await page.evaluate(() => window.__gets)).filter((u) =>
        u.includes("a51acfc7"),
      ).length,
      0,
      "asked again for URLs it already had",
    );
    assert.ok(
      await page.evaluate(
        () => document.querySelectorAll("[data-alert-clip-hero]").length > 0,
      ),
      "the recovery frame took the clip back off the screen",
    );
  });

  test("⭐ the same urlless clips arriving again do NOT cause a second fetch", async () => {
    /* ⚠ THE DEBOUNCE IS NOT THE GUARD, AND CANNOT BE. The lab's own capture
       is three frames, and the third (`recovered_at`) carries the SAME clip
       list as the second. On a real incident those can be seconds apart --
       well outside any debounce window -- so without a record of what has
       already been asked for, every later frame about the same alert buys
       another round trip for URLs this browser already has.

       And it is the only thing standing between here and a loop in the case
       that matters: a clip whose URLs never arrive. */
    const id = "pushed-0001";
    await page.evaluate(() => { window.__gets = []; });
    await page.evaluate(
      ([alertId, dev, c]) =>
        window.__push("alert.updated", {
          id: alertId,
          type: "CAMERA_STOPPED",
          colour: "orange",
          device_id: dev,
          cameras: [1],
          started_at: "2026-10-28T12:09:30Z",
          started_epoch: 1793192400,
          acknowledged: false,
          best_quality: "standard",
          /* The same clip, with no url, on a HIGHER revision -- which is
             what the recovery frame looks like. */
          clips: [c],
          recovered_at: "2026-10-28T12:30:00Z",
          rev: 9,
        }),
      [id, WEST, pushedClip(1, "standard", "pushed-c1")],
    );
    /* Longer than the debounce, so a second fetch would have landed. */
    await page.waitForTimeout(1200);
    const mine = (await page.evaluate(() => window.__gets)).filter((u) =>
      u.includes(id),
    );
    assert.equal(mine.length, 0, `asked again for urls it already had (${mine.length})`);
    /* And the clip is still playable, from the URLs fetched the first time. */
    assert.ok(
      await page.evaluate(
        () => document.querySelectorAll("[data-alert-clip-hero]").length > 0,
      ),
    );
  });

  test("⭐ THE TOAST SURVIVES ITS OWN ARRIVAL", async () => {
    /* ⚠ THE BUG, AND IT HAD NO SYMPTOM EXCEPT ABSENCE. The stack retired a
       card when `now - at` passed the TTL, and `at` is when the thing
       HAPPENED. The hub stamps an alert at the event and raises it 60 s
       later after the debounce, so every alert card was already older than
       the nine-second default before it was created: added, retired on the
       next tick, straight into "Recent" marked "passed". Which is exactly
       how it was reported -- the alert was under Recent and no toast ever
       appeared.

       The payload here is the lab's `alert.new`: an event stamped a minute
       and a half ago, which is ordinary and not an edge case. */
    const started = Math.floor(Date.now() / 1000) - 95;
    await page.evaluate(
      ([dev, epoch]) =>
        window.__push("alert.new", {
          id: "staletoast",
          type: "CAMERA_STOPPED",
          colour: "orange",
          device_id: dev,
          cameras: [2],
          started_at: new Date(epoch * 1000).toISOString(),
          started_epoch: epoch,
          acknowledged: false,
          rev: 1,
        }),
      [WEST, started],
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[role='group']")].some((g) =>
          /YARD camera stopped working/.test(g.textContent ?? ""),
        ),
      { timeout: 5000 },
    );
    /* It is STILL THERE after the expiry tick that used to take it. */
    await page.waitForTimeout(1600);
    const card = await page.evaluate(() => {
      const g = [...document.querySelectorAll("[role='group']")].find((x) =>
        /YARD camera stopped working/.test(x.textContent ?? ""),
      );
      return g ? { text: g.textContent, strip: g.querySelector("div")?.className } : null;
    });
    assert.ok(card, "the toast was retired before it could be seen");
    assert.match(card.strip, /bg-detect/);
    /* And the corner still reads the EVENT's own age, which is the thing
       `at` is for -- the two were one field and should never have been. */
    /* No word boundary in the pattern: the stamp abuts the title in
       `textContent`, so there is no boundary between them. */
    assert.match(card.text, /[12]m/);
  });

  test("⭐ and it raises on the Alerts screen too, with a detail open", async () => {
    /* "Suppressed on the Alerts screen" and "suppressed when a detail is
       open" were two of the candidate explanations. Neither was true, and
       this is what keeps them untrue: the harness IS the Alerts screen, and
       a detail is open from the test above. */
    assert.ok(
      await page.evaluate(() => document.querySelectorAll("[data-alert-story]").length > 0),
      "no detail is open, so this test is not checking what it says",
    );
    await page.evaluate(
      (dev) =>
        window.__push("alert.new", {
          id: "whiledetailopen",
          type: "TOWER_OFFLINE",
          colour: "red",
          device_id: dev,
          cameras: [1, 2],
          started_at: "2026-10-28T12:55:00Z",
          started_epoch: Math.floor(Date.now() / 1000) - 120,
          acknowledged: false,
          rev: 1,
        }),
      EAST,
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[role='group']")].some((g) =>
          /EAST TOWER offline/.test(g.textContent ?? ""),
        ),
      { timeout: 8000 },
    );
    const strip = await page.evaluate(() => {
      const g = [...document.querySelectorAll("[role='group']")].find((x) =>
        /EAST TOWER offline/.test(x.textContent ?? ""),
      );
      return g?.querySelector("div")?.className ?? "";
    });
    assert.match(strip, /bg-critical/);
  });

  /* ================================================================
   *  THE HUB ITSELF, ON THE SCREEN
   * ================================================================ */

  test("⭐ a hub going offline is a row, named from the CELLS and red", async () => {
    /* The row that would otherwise read HUB-KLN-LAB. The fleet cannot name
       this box: it holds the hub's MAST, under a different id. */
    await page.evaluate((a) => {
      window.__gets = [];
      window.__push("alert.new", a);
    }, HUB_OFFLINE_ALERT);
    await page.waitForFunction(
      () => /NORTH CAMP offline/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const text = await page.textContent("body");
    assert.ok(!/HUB-KLN-LAB/.test(text), "the hub id reached the screen");
    assert.ok(!/ down/i.test(text.split("NORTH CAMP")[1]?.slice(0, 20) ?? ""));
  });

  test("⭐ and it raises a toast in the colour the DC chose", async () => {
    const card = await page.evaluate(() => {
      const g = [...document.querySelectorAll("[role='group']")].find((x) =>
        /NORTH CAMP offline/.test(x.textContent ?? ""),
      );
      return g ? { strip: g.querySelector("div")?.className ?? "" } : null;
    });
    assert.ok(card, "a hub going offline raised no toast");
    /* Red, the same colour as the tower pair: one incident type, one colour,
       whichever tier noticed. */
    assert.match(card.strip, /bg-critical/);
  });

  test('⭐ its detail says the footage is PENDING, not "coming"', async () => {
    /* ⚠ THE DISTINCTION THIS STATE EXISTS FOR. "Clip coming" is a promise
       about the next minute. A HUB_OFFLINE clip is on the box that went
       away: nothing polls for it, nothing expires, and the hub cuts it when
       it dials back in, which may be a fortnight. */
    await openRow("NORTH CAMP offline");
    await page.waitForFunction(
      () => /Footage pending, the hub is away/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const text = await page.textContent("body");
    assert.match(text, /It arrives when the hub connects again/);
    assert.ok(!/Clip coming/.test(text), "a hub alert promised a clip in a minute");
    /* And the sequence is the hub's own. */
    const steps = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-story] li")].map(
        (li) => li.querySelector("p")?.textContent ?? "",
      ),
    );
    assert.deepEqual(steps, ["Hub stopped connecting", "Alert raised"]);
  });

  test("⭐ clips that cannot be fetched are DESCRIBED, side by side, not pressable", async () => {
    /* docs/alerts.md 3a: the data centre stores no video, and with no bucket
       configured there is no URL to give. The clip exists, is named, has a
       length -- and the screen in the control room is the thing that can
       play it. A play button here would be a control that cannot work. */
    await page.evaluate(
      ([dev, c1, c2]) => {
        /* ⚠ THE SINGLE-ALERT GET ANSWERS WITHOUT URLS TOO, which is the
           real shape of this state: it is not a missing mint, it is a tier
           with no bytes to mint for. */
        window.__refreshed = {
          id: "hhhh5555",
          type: "HUB_OFFLINE",
          colour: "red",
          device_id: dev,
          cameras: [1, 2],
          started_at: "2026-10-28T12:35:00Z",
          started_epoch: 1793190900,
          acknowledged: false,
          best_quality: "standard",
          clips: [c1, c2],
          rev: 2,
        };
        window.__push("alert.updated", window.__refreshed);
      },
      [HUB, pushedClip(1, "standard", "hub-c1"), pushedClip(2, "standard", "hub-c2")],
    );
    await page.waitForFunction(
      () => /Clip on the hub only/.test(document.body.innerText),
      { timeout: 8000 },
    );
    const shape = await page.evaluate(() => ({
      held: document.querySelectorAll("[data-alert-clip-held]").length,
      heroes: document.querySelectorAll("[data-alert-clip-hero]").length,
      presses: document.querySelectorAll("[data-alert-clips] button").length,
      videos: document.querySelectorAll("[data-alert-clips] video").length,
      text: document.querySelector("[data-alert-clips]")?.textContent ?? "",
      steps: [...document.querySelectorAll("[data-alert-story] li")].map(
        (li) => li.querySelector("p")?.textContent ?? "",
      ),
    }));
    assert.equal(shape.held, 2, "two cameras, side by side, like a tower's");
    assert.equal(shape.heroes, 0, "a clip with no url grew a play button");
    assert.equal(shape.presses, 0, "a clip with no url grew a press target");
    assert.equal(shape.videos, 0, "something tried to load a clip with no source");
    /* Each one still says which camera and how long. */
    assert.match(shape.text, /CAMERA 1/);
    assert.match(shape.text, /CAMERA 2/);
    /* 52.7 s, as the hub cut it, rounded for reading. */
    assert.match(shape.text, /53s/);
    /* The footage HAS arrived, and the timeline says so even though none of
       it can be played from here. */
    assert.ok(shape.steps.includes("Footage attached"), shape.steps.join(" | "));
    await page.evaluate(() => { window.__refreshed = null; });
  });

  test("⭐ and when the bucket can serve them, the same two play on one transport", async () => {
    /* A 2K upgrade, which is how better cuts land: new keys, so the feed
       asks again rather than trusting the fingerprint it already answered.
       This time the mint succeeds and the hub alert gets the same player a
       tower alert has. */
    await page.evaluate(
      ([dev, c1, c2]) =>
        window.__push("alert.updated", {
          id: "hhhh5555",
          type: "HUB_OFFLINE",
          colour: "red",
          device_id: dev,
          cameras: [1, 2],
          started_at: "2026-10-28T12:35:00Z",
          started_epoch: 1793190900,
          acknowledged: false,
          best_quality: "2k",
          clips: [c1, c2],
          rev: 3,
        }),
      [HUB, pushedClip(1, "2k", "hub-c1-2k"), pushedClip(2, "2k", "hub-c2-2k")],
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-alert-clip-hero]").length === 2,
      { timeout: 8000 },
    );
    const text = await page.textContent("body");
    assert.ok(!/Clip on the hub only/.test(text), "the held state outlived its clips");
    await openPlayer(0);
    const shape = await page.evaluate(() => ({
      videos: document.querySelectorAll("[data-clip-stage] video").length,
      scrubs: document.querySelectorAll('input[aria-label="Seek"]').length,
    }));
    assert.equal(shape.videos, 2, "a hub's two cameras should open together");
    assert.equal(shape.scrubs, 1, "two cameras grew two scrubbers");
    await closePlayer();
  });

  test('⭐ a hub that was asked and had nothing says so, and draws no bar', async () => {
    /* ⭐ THE STATE THAT COULD NOT ARRIVE UNTIL SDK 0.13.1. The hub cut
       nothing because there was nothing to cut -- the disk was full, the
       camera was not recording, the box was rebuilt -- and answering is what
       ends the waiting. `progress` is exactly `{footage: "none"}`: a verdict,
       with no transfer numbers beside it and no bar to draw. */
    const raise = {
      id: "jjjj7777",
      type: "HUB_OFFLINE",
      colour: "red",
      device_id: HUB2,
      cameras: [],
      started_at: "2026-10-28T13:20:00Z",
      started_epoch: 1793193600,
      acknowledged: false,
      rev: 1,
    };
    await page.evaluate(
      (a) => {
        window.__push("alert.new", a);
        /* Back to back, as the answer arrives on the hub's reconnect. */
        window.__push("alert.updated", { ...a, rev: 2, progress: { footage: "none" } });
      },
      raise,
    );
    await page.waitForFunction(
      () => /RIVER CAMP offline/.test(document.body.innerText),
      { timeout: 5000 },
    );
    await openRow("RIVER CAMP offline");
    await page.waitForFunction(
      () => /No footage of that moment/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const shape = await page.evaluate(() => ({
      text: document.body.innerText,
      /* ⚠ THE FAILURE THIS GUARDS: a 0% bar over an alert whose whole
         content is that there is nothing to transfer. */
      bars: document.querySelectorAll("[data-alert-detail] [data-recovery]").length,
      clips: document.querySelectorAll("[data-alert-detail] [data-alert-clips]").length,
      steps: [...document.querySelectorAll("[data-alert-story] li")].map(
        (li) => li.querySelector("p")?.textContent ?? "",
      ),
      /* The ROW draws the same pair, from the same two functions, and it is
         the one an operator sees without opening anything. */
      rowBars: (() => {
        const row = [...document.querySelectorAll("button")].find((b) =>
          /RIVER CAMP offline/.test(b.textContent ?? ""),
        );
        return row ? row.querySelectorAll("[data-recovery]").length : -1;
      })(),
    }));
    assert.equal(shape.rowBars, 0, "the row drew a bar over an empty answer");
    assert.equal(shape.bars, 0, "a progress bar was drawn over an empty answer");
    assert.equal(shape.clips, 0, "a clip grid was drawn with no clips");
    assert.match(shape.text, /The hub had no recording covering it/);
    /* And it is no longer waiting: the pending sentence is gone. */
    assert.ok(
      !/Footage pending, the hub is away/.test(shape.text),
      "an answered alert is still telling somebody to wait",
    );
    assert.deepEqual(shape.steps, [
      "Hub stopped connecting",
      "Alert raised",
      "No footage of that moment",
    ]);
  });

  test("⭐ a hub dialling back in is its own alert, in green", async () => {
    await page.evaluate((a) => window.__push("alert.new", a), HUB_ONLINE_ALERT);
    await page.waitForFunction(
      () => /NORTH CAMP back online/.test(document.body.innerText),
      { timeout: 5000 },
    );
    const strip = await page.evaluate(() => {
      const g = [...document.querySelectorAll("[role='group']")].find((x) =>
        /NORTH CAMP back online/.test(x.textContent ?? ""),
      );
      return g?.querySelector("div")?.className ?? "";
    });
    assert.match(strip, /bg-terra/);
    await openRow("NORTH CAMP back online");
    const steps = await page.evaluate(() =>
      [...document.querySelectorAll("[data-alert-story] li")].map(
        (li) => li.querySelector("p")?.textContent ?? "",
      ),
    );
    /* The event IS the return, so the first step is the good news. */
    assert.equal(steps[0], "Back online");
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
  let hook;

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
    hook = await readFile(join(SRC, "lib/useSiteAlerts.ts"), "utf8");
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

  test("⭐ a stopped stream says so, quietly, and not as a banner", async () => {
    /* A FEED THAT HAS STOPPED LOOKS EXACTLY LIKE A QUIET NIGHT. Both are a
       list that is not changing, and on a monitoring product one of those is
       the best news on the screen and the other is the worst. */
    const notice = await readFile(join(SRC, "components/PausedNotice.tsx"), "utf8");
    assert.match(notice, /Live updates paused/);
    assert.match(notice, /data-alert-paused/);
    /* The quietest ink, and NOT the alarm red: nothing is wrong with the
       SITE, which is what red means here, and spending the fault colour on a
       browser's connection teaches an operator to discount it. */
    assert.match(notice, /text-muted/);
    assert.ok(!/text-critical/.test(notice));
    /* Both alert surfaces draw the same one. A second copy of the sentence
       is a second copy that can be reworded alone. */
    assert.match(view, /<PausedNotice \/>/);
    const panel = await readFile(join(SRC, "components/AlertsPanel.tsx"), "utf8");
    assert.match(panel, /<PausedNotice \/>/);
  });

  test("⭐ and it waits, so an ordinary reconnect never blinks it", () => {
    /* The SDK retries every 3 s and a drop is ORDINARY on this channel -- a
       slow reader is closed rather than waited for. A notice that blinks all
       day is a notice nobody reads, which is the same failure arrived at
       from the other side. */
    assert.match(hook, /const PAUSED_AFTER_MS = 8000;/);
    assert.match(hook, /setTimeout\(\(\) => setPaused\(true\), PAUSED_AFTER_MS\)/);
    /* And cleared the instant the stream opens, not on the next tick. */
    assert.match(hook, /setPaused\(false\)/);
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

  test("⭐ the shell asks the CELLS for a hub's name, never the fleet", () => {
    /* A hub is not in `towers` under any id: the fleet holds its MAST, which
       is a different box with a different name. The browser tests above run
       against a harness that mirrors this resolver, so this is the line that
       keeps the harness honest about the real one. */
    assert.match(app, /isHubAlert\(type\)/, "the shell resolver is not type-aware");
    assert.match(app, /hubNames\.get\(deviceId\)/, "hub names do not come from the cells");
    assert.match(app, /useCells\(sitesEnabled && alertsEnabled\)/);
    /* And the fleet lookup is still the answer for everything else. */
    assert.match(app, /towers\.find\(\(t\) => t\.id === deviceId\)\?\.site/);
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
