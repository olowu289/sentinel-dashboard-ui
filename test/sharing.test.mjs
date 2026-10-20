/**
 * The rules behind the cards: what goes on the wire, and what a tile says.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THESE FOUR AND NOT A RENDER TEST
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every one of these is a sentence somebody could get backwards, and every one
 * of them is wrong in a way that looks fine on screen:
 *
 *   · A REQUEST THAT SENDS A SCOPE is refused by the server with a message
 *     about cameras the asking site has never seen. The form cannot name them
 *     because it cannot see them; if a refactor ever makes it send `scope: []`
 *     for an offer instead, an offer silently becomes an empty one.
 *   · A PLAYBACK WINDOW WITHOUT PLAYBACK is a claim about footage nobody
 *     granted, and playback WITHOUT a window is refused outright. The pairing
 *     is the rule.
 *   · A SCOPE ENTRY WITH NO CAMERAS covers the whole mast. Read the other way,
 *     lending a tower lends nothing, and the share looks ignored.
 *   · BADGING MY OWN CAMERA AS BORROWED is the one that is actively
 *     misleading: it would tell an operator that the mast they own belongs to
 *     somebody else, which changes what they do with what they see.
 *
 * None of that is visible in a screenshot, and all of it is one line of logic.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let r;
let n;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sharing-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as rules from "@/lib/shareRules";
     export * as notes from "@/lib/notifications";`,
    "utf8",
  );
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": join(ROOT, "src") },
    define: {
      "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }),
    },
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(out).href);
  r = mod.rules;
  n = mod.notes;
});

const SHARE = (over = {}) => ({
  share_id: "shr_1",
  direction: "request",
  status: "active",
  owner_site_id: "site_north",
  owner_site_name: "North Gate",
  viewer_site_id: "site_west",
  viewer_site_name: "West Yard",
  scope: [{ device_id: "kln_north_1", cameras: [1] }],
  live: true,
  ptz: false,
  playback: false,
  playback_from: null,
  playback_to: null,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-10-20T10:00:00Z",
  decided_at: null,
  message: null,
  incoming: false,
  outgoing: true,
  ...over,
});

describe("what goes on the wire", () => {
  const compose = (over = {}) => ({
    otherSiteId: "site_north",
    message: "  Our truck is at your gate.  ",
    scope: [{ device_id: "kln_mine_1" }],
    ptz: true,
    playback: true,
    from: "2026-10-20T09:00",
    to: "2026-10-20T10:00",
    durationSec: 900,
    ...over,
  });

  test("a REQUEST names no cameras and asserts no permissions", () => {
    const body = r.composeToRequest(compose(), "site_west", "request");
    assert.equal("scope" in body, false, "the asking site cannot name cameras");
    assert.equal(body.ptz, false, "what it is granted is the answer's decision");
    assert.equal(body.playback, false);
    assert.equal("playbackFrom" in body, false);
    assert.equal(body.message, "Our truck is at your gate.", "trimmed");
    assert.equal(body.direction, "request");
  });

  test("an OFFER names its cameras and carries what it grants", () => {
    const body = r.composeToRequest(compose(), "site_north", "offer");
    assert.deepEqual(body.scope, [{ device_id: "kln_mine_1" }]);
    assert.equal(body.ptz, true);
    assert.equal(body.playback, true);
    assert.equal(typeof body.playbackFrom, "string", "a window travels with it");
    assert.equal(typeof body.playbackTo, "string");
  });

  test("an empty message is left out rather than sent as empty", () => {
    const body = r.composeToRequest(compose({ message: "   " }), "s", "offer");
    assert.equal("message" in body, false);
  });

  test("the playback window travels ONLY when playback is on", () => {
    const on = r.decisionToChoices({
      scope: [], ptz: false, playback: true,
      from: "2026-10-20T09:00", to: "2026-10-20T10:00", durationSec: 900,
    });
    assert.equal(typeof on.playbackFrom, "string");
    assert.equal(typeof on.playbackTo, "string");

    const off = r.decisionToChoices({
      scope: [], ptz: false, playback: false,
      from: "2026-10-20T09:00", to: "2026-10-20T10:00", durationSec: 900,
    });
    assert.equal("playbackFrom" in off, false, "a window with no grant is a claim");
    assert.equal(off.live, true, "live is what a share is for");
  });

  test("an offer's answer starts from what was offered, not from nothing", () => {
    /* The site accepting may NARROW an offer. Starting the form empty would
       make narrowing look like the only option and lose the offer's own
       choices on the way through. */
    const d = r.initialDecision(SHARE({ scope: [{ device_id: "a" }], ptz: true }));
    assert.deepEqual(d.scope, [{ device_id: "a" }]);
    assert.equal(d.ptz, true);
    assert.equal(d.durationSec, 900, "fifteen minutes is the default length");
  });
});

describe("what a scope covers", () => {
  test("no camera list means the whole mast, now and later", () => {
    const whole = { device_id: "kln_1" };
    assert.equal(r.scopeCovers(whole, "kln_1", 1), true);
    assert.equal(r.scopeCovers(whole, "kln_1", 9), true, "including one added later");
    assert.equal(r.scopeCovers(whole, "kln_1", undefined), true);
    assert.equal(r.scopeCovers(whole, "kln_2", 1), false, "but not another mast");
  });

  test("a camera list is exactly those cameras", () => {
    const one = { device_id: "kln_1", cameras: [2] };
    assert.equal(r.scopeCovers(one, "kln_1", 2), true);
    assert.equal(r.scopeCovers(one, "kln_1", 1), false);
    assert.equal(r.scopeCovers(one, "kln_1", undefined), false);
  });

  test("the summary counts cameras and towers, and says when there are none", () => {
    assert.equal(r.scopeSummary([]), "no cameras yet");
    assert.equal(r.scopeSummary([{ device_id: "a" }]), "1 camera on 1 tower");
    assert.equal(
      r.scopeSummary([{ device_id: "a", cameras: [1, 2] }, { device_id: "b" }]),
      "3 cameras on 2 towers",
    );
  });
});

describe("whose camera is this", () => {
  test("a share coming TO me marks the tile", () => {
    const lent = SHARE({ incoming: false, scope: [{ device_id: "kln_1" }] });
    assert.equal(r.borrowedFrom([lent], "kln_1", 1)?.share_id, "shr_1");
  });

  test("MY OWN camera is never borrowed, however many sites watch it", () => {
    /* `incoming: true` means one of my sites owns these cameras and somebody
       else is watching. Badging that as borrowed would tell an operator the
       mast they own is somebody else's. */
    const lentOut = SHARE({ incoming: true, scope: [{ device_id: "kln_1" }] });
    assert.equal(r.borrowedFrom([lentOut], "kln_1", 1), null);
  });

  test("a camera outside the scope is not borrowed", () => {
    const lent = SHARE({ incoming: false, scope: [{ device_id: "kln_1", cameras: [1] }] });
    assert.equal(r.borrowedFrom([lent], "kln_1", 2), null);
    assert.equal(r.borrowedFrom([lent], "kln_2", 1), null);
    assert.equal(r.borrowedFrom([lent], undefined, 1), null);
  });

  test("the other site is named from whichever end I am on", () => {
    assert.equal(r.otherSiteName(SHARE({ incoming: true })), "West Yard");
    assert.equal(r.otherSiteName(SHARE({ incoming: false })), "North Gate");
  });
});

describe("the labels on a card", () => {
  test("time left counts down and goes NULL rather than to zero", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    const at = (mins) =>
      n.timeLeftLabel(new Date(now + mins * 60_000).toISOString(), now);
    assert.equal(at(14.5), "14:30");
    assert.equal(at(90), "1:30");
    /* Past a day it stops being a clock: "167:59" is a number nobody can read
       at a glance, and the glance is the whole purpose of the label. */
    assert.equal(at(60 * 24 * 7), "7d");
    assert.equal(at(60 * 30), "1d 6h");
    /* A share at zero is not a share with no time left on it. It is over, and
       the card says so in words rather than showing 0:00 beside live video. */
    assert.equal(at(0), null);
    assert.equal(at(-5), null);
    assert.equal(n.timeLeftLabel("not a date"), null);
  });

  test("the age stamp says `now` before it says a number", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    const ago = (s) => n.sinceLabel(now - s * 1000, now);
    assert.equal(ago(0), "now");
    assert.equal(ago(44), "now", "a minute that has not happened is not 1m");
    assert.equal(ago(120), "2m");
    assert.equal(ago(3 * 3600), "3h");
    assert.equal(ago(50 * 3600), "2d");
  });
});

describe("the notification kinds", () => {
  test("every kind has a colour, and none of them is terra", () => {
    /* Green means LIVE in this product and nothing else; a card borrowing it
       would put "live" on a wall of tiles that are not. The alarm red is held
       for the detections and faults still to come. */
    for (const [kind, style] of Object.entries(n.KINDS)) {
      assert.ok(style.accent && style.wash && style.line && style.solid, kind);
      const all = Object.values(style).join(" ");
      assert.doesNotMatch(all, /terra/, `${kind} must not spend the live colour`);
      assert.doesNotMatch(all, /alert-banner|critical/, `${kind} must not look like an alarm`);
    }
  });

  test("three cards are visible at once, and the rest wait", () => {
    /* These sit over live video. A stack that grows without limit is a modal
       with extra steps. */
    assert.equal(n.MAX_VISIBLE, 3);
  });
});
