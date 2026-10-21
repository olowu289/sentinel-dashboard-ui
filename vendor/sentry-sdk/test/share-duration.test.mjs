// Whoever starts a share decides it, and how long is always said out loud.
//
// ── WHY THIS FILE ─────────────────────────────────────────────────────────
//
// Two things went wrong in the field and both were contract-shaped.
//
// 1. HOW LONG WAS OPTIONAL, AND THE TWO SIDES DISAGREED ABOUT THE DEFAULT.
//    This SDK's `SHARE_DEFAULT_SEC` is fifteen minutes; the server's fallback
//    was two hours. A share created without a duration lasted whichever one
//    the sending side happened to be. It is required now, on both directions,
//    and the type for a request will not compile without it.
//
// 2. AN OFFER WAS TREATED AS A FORM TO FILL IN. The receiving side was shown
//    a tower picker fed from the LENDER's site, which they are not a member of
//    and which answers 404 "no such site" to them on purpose. An offer arrives
//    complete; `acceptShare(id)` on one takes nothing.
//
// Everything here is the WIRE, which is what this package is for: what fields
// go up, which ones do not, and what comes back.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_DEFAULT_SEC,
  SHARE_MAX_SEC,
  SHARE_MIN_SEC,
  SentryClient,
  parseShare,
} from "../dist/esm/index.js";

/** A client whose transport records the one request it was given.
 *
 * The same fetch stand-in `sites.test.mjs` uses, for the same reason: what is
 * worth checking here is the WIRE, and a real server would only make that
 * harder to read. */
function recording(reply) {
  const seen = [];
  const client = new SentryClient({
    baseUrl: "https://dc.example.com",
    token: "t0ken",
    fetch: async (url, init) => {
      seen.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        async text() {
          return JSON.stringify(reply);
        },
        async json() {
          return reply;
        },
      };
    },
  });
  return { client, seen };
}

const SHARE = {
  share_id: "shr_1",
  direction: "offer",
  status: "pending",
  owner_site_id: "site_a",
  owner_site_name: "All sites",
  viewer_site_id: "site_b",
  viewer_site_name: "Test Site",
  scope: [{ device_id: "kln_lab_000003", cameras: [1] }],
  live: true,
  ptz: false,
  playback: false,
  playback_from: null,
  playback_to: null,
  expires_at: "2026-10-20T13:00:00Z",
  created_at: "2026-10-20T12:00:00Z",
  decided_at: null,
  message: null,
  asked_duration_sec: 3600,
};

const body = (seen) => JSON.parse(seen[0].init.body);

// ── the bounds are exported, and they are the server's ──────────────────
test("the duration bounds are exported so a box can refuse what it typed", () => {
  assert.equal(SHARE_MIN_SEC, 5 * 60, "five minutes");
  assert.equal(SHARE_MAX_SEC, 30 * 24 * 60 * 60, "thirty days");
  assert.ok(SHARE_MIN_SEC < SHARE_DEFAULT_SEC, "the default is a usable length");
  assert.ok(SHARE_DEFAULT_SEC < SHARE_MAX_SEC);
});

// ── a request carries a length and a message, and nothing else ──────────
test("a request sends no scope and no permissions it has no business asserting", async () => {
  const { client, seen } = recording({ share: { ...SHARE, direction: "request" } });
  await client.createShare({
    direction: "request",
    mySiteId: "site_b",
    otherSiteId: "site_a",
    message: "please",
    durationSec: 4 * 3600,
  });
  const sent = body(seen);
  assert.equal(sent.direction, "request");
  assert.deepEqual(sent.scope, [], "a request names no cameras");
  assert.equal(sent.ptz, false, "and asserts no controls");
  assert.equal(sent.playback, false);
  assert.equal(sent.playback_from, undefined);
  assert.equal(sent.duration_sec, 4 * 3600, "how long it is ASKING for");
});

test("an offer carries its scope, its permissions and its length", async () => {
  const { client, seen } = recording({ share: SHARE });
  await client.createShare({
    direction: "offer",
    mySiteId: "site_a",
    otherSiteId: "site_b",
    scope: [{ device_id: "kln_lab_000003", cameras: [1] }],
    ptz: true,
    durationSec: 900,
  });
  const sent = body(seen);
  assert.equal(sent.direction, "offer");
  assert.deepEqual(sent.scope, [{ device_id: "kln_lab_000003", cameras: [1] }]);
  assert.equal(sent.ptz, true);
  assert.equal(sent.duration_sec, 900);
});

test("an offer may leave its own site to the server to derive", async () => {
  // "Share this camera" starts from a camera and a client cannot know which
  // of its sites owns it. A request cannot work this way and the type says so.
  const { client, seen } = recording({ share: SHARE });
  await client.createShare({
    direction: "offer",
    otherSiteId: "site_b",
    scope: [{ device_id: "kln_lab_000003" }],
    durationSec: 900,
  });
  assert.equal(body(seen).my_site_id, undefined);
});

// ── the administrator's share ───────────────────────────────────────────
test("an admin share goes up as an OFFER, with the sites the admin named", async () => {
  // On the wire it IS an offer: the cameras travel from one site to another
  // and the receiving site answers. The separate shape exists so an admin
  // cannot send the site-to-site one, where `mySiteId` means "mine".
  const { client, seen } = recording({ share: SHARE });
  await client.createShare({
    direction: "admin",
    fromSiteId: "site_a",
    toSiteId: "site_b",
    scope: [{ device_id: "kln_lab_000003", cameras: [1] }],
    ptz: true,
    durationSec: 4 * 3600,
  });
  const sent = body(seen);
  assert.equal(sent.direction, "offer", "an admin share is an offer");
  assert.equal(sent.my_site_id, "site_a", "where the cameras are");
  assert.equal(sent.other_site_id, "site_b", "who gets to see them");
  assert.equal(sent.ptz, true);
  assert.equal(sent.duration_sec, 4 * 3600);
});

test("the client never CLAIMS to be an administrator", async () => {
  // ⚠ THE SERVER DECIDES IT FROM THE SESSION. A flag in the body would be
  // a client asserting its own authority, which is the one thing every rule
  // in this area exists to stop.
  const { client, seen } = recording({ share: SHARE });
  await client.createShare({
    direction: "admin",
    fromSiteId: "site_a",
    toSiteId: "site_b",
    scope: [{ device_id: "kln_lab_000003" }],
    durationSec: 900,
  });
  const sent = body(seen);
  assert.equal(sent.by_admin, undefined, "the body asserted it");
  assert.equal(sent.admin, undefined);
});

test("by_admin comes back on the share, and is false for a site's own", () => {
  assert.equal(parseShare({ share: { ...SHARE, by_admin: true } }).by_admin, true);
  assert.equal(parseShare({ share: SHARE }).by_admin, false,
    "absent reads as false, which is what every share made by a site is");
});

// ── accepting ───────────────────────────────────────────────────────────
test("accepting an offer sends an empty decision, because it is accepted as sent", async () => {
  const { client, seen } = recording({ share: { ...SHARE, status: "active" } });
  await client.acceptShare("shr_1");
  const sent = body(seen);
  for (const key of ["scope", "live", "ptz", "playback", "duration_sec"]) {
    assert.equal(sent[key], undefined, `${key} must not be asserted`);
  }
  assert.ok(seen[0].url.endsWith("/v1/shares/shr_1/accept"));
});

test("accepting a request carries the whole answer, including the final length", async () => {
  const { client, seen } = recording({ share: { ...SHARE, status: "active" } });
  await client.acceptShare("shr_1", {
    scope: [{ device_id: "kln_lab_000002" }],
    ptz: true,
    durationSec: 7 * 24 * 3600,
  });
  const sent = body(seen);
  assert.deepEqual(sent.scope, [{ device_id: "kln_lab_000002" }]);
  assert.equal(sent.ptz, true);
  assert.equal(
    sent.duration_sec,
    7 * 24 * 3600,
    "more than was asked for is allowed: the owner of the cameras decides",
  );
});

// ── the asked duration comes back, and is not guessed ───────────────────
test("asked_duration_sec is parsed and is what was ASKED, not what it became", () => {
  const share = parseShare({ share: { ...SHARE, asked_duration_sec: 14400 } });
  assert.equal(share.asked_duration_sec, 14400);
  // The expiry is an hour out, so these two are deliberately different
  // numbers: the question and the answer.
  assert.equal(share.expires_at, "2026-10-20T13:00:00Z");
});

test("an older server that sends no asked_duration_sec reads as null, never as a guess", () => {
  const { asked_duration_sec: _drop, ...older } = SHARE;
  const share = parseShare({ share: older });
  assert.equal(
    share.asked_duration_sec,
    null,
    "created_at to expires_at is the asked length on a PENDING share and not " +
      "on an accepted one, so deriving it would make one number mean two things",
  );
});

test("an explicit null is kept as null rather than becoming NaN", () => {
  const share = parseShare({ share: { ...SHARE, asked_duration_sec: null } });
  assert.equal(share.asked_duration_sec, null);
});
