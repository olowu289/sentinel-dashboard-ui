/**
 * Sites, shares, people and audit: the request the SDK puts on the wire, and
 * the validation of what comes back.
 *
 * Same approach as `smoke.test.mjs`: the built ESM output with an injected
 * `fetch`, so the contract is exercised without a server. What is worth testing
 * here is not "does it call fetch" but the three things that would break
 * silently across the service boundary:
 *
 *   * the PATH and BODY, because a renamed field is invisible until a customer
 *     clicks the button;
 *   * `unassigned_hubs` being ABSENT rather than empty for a non-admin, since a
 *     UI that checks `.length` would show an empty admin group to a site user;
 *   * `isShareLive`, which has to agree with the server about an expired share
 *     whose status column has not caught up yet.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SentryClient,
  ValidationError,
  isAdminRole,
  isShareLive,
} from "../dist/esm/index.js";

/** Records calls and replays one scripted response per call. */
function recorder(responses) {
  const calls = [];
  let i = 0;
  const fetchLike = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.status < 400,
      status: r.status,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify(r.body ?? {});
      },
      async json() {
        return r.body ?? {};
      },
    };
  };
  return { calls, fetchLike };
}

function clientFor(responses) {
  const { calls, fetchLike } = recorder(responses);
  const client = new SentryClient({
    baseUrl: "https://coord.example.test",
    token: "t0ken",
    fetch: fetchLike,
  });
  return { client, calls };
}

const SITE = {
  site_id: "site_1",
  name: "North Gate",
  status: "active",
  created_at: "2026-10-01T00:00:00Z",
  hubs: ["hub_north"],
};

const SHARE = {
  share_id: "shr_1",
  direction: "request",
  status: "active",
  owner_site_id: "site_1",
  owner_site_name: "North Gate",
  viewer_site_id: "site_2",
  viewer_site_name: "West Yard",
  scope: [{ device_id: "kln_north_000001", cameras: [1] }],
  live: true,
  ptz: false,
  playback: false,
  playback_from: null,
  playback_to: null,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  decided_at: "2026-10-01T00:05:00Z",
};

// ── capabilities, the gate everything else hangs off ──────────────────────
test("capabilities reports whether this node has sites at all", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { role: "datacenter", features: { sites: true } } },
  ]);
  const caps = await client.capabilities();
  assert.equal(caps.features.sites, true);
  assert.equal(caps.role, "datacenter");
  assert.match(calls[0].url, /\/v1\/capabilities$/);
});

test("a hub reports sites:false, which is its normal state", async () => {
  const { client } = clientFor([
    { status: 200, body: { role: "hub", features: { sites: false } } },
  ]);
  const caps = await client.capabilities();
  assert.equal(caps.features.sites, false);
});

test("a capabilities body missing features is a ValidationError", async () => {
  const { client } = clientFor([{ status: 200, body: { role: "hub" } }]);
  await assert.rejects(() => client.capabilities(), ValidationError);
});

// ── sites ────────────────────────────────────────────────────────────────
test("listSites parses sites and the admin-only unassigned group", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { sites: [SITE], unassigned_hubs: ["hub_spare"] } },
  ]);
  const out = await client.listSites();
  assert.equal(out.sites.length, 1);
  assert.equal(out.sites[0].name, "North Gate");
  assert.deepEqual(out.unassigned_hubs, ["hub_spare"]);
  assert.match(calls[0].url, /\/v1\/sites$/);
});

test("unassigned_hubs is ABSENT for a site user, not empty", async () => {
  // THE DISTINCTION MATTERS. A UI that checks `.length` would render an empty
  // admin group to a site user; one that checks presence renders nothing.
  const { client } = clientFor([{ status: 200, body: { sites: [SITE] } }]);
  const out = await client.listSites();
  assert.equal(out.unassigned_hubs, undefined);
  assert.ok(!("unassigned_hubs" in out));
});

test("getSite returns the site and its cells", async () => {
  const { client, calls } = clientFor([
    {
      status: 200,
      body: {
        site: SITE,
        cells: [{ hub_id: "hub_north", towers: ["kln_north_000001"] }],
      },
    },
  ]);
  const out = await client.getSite("site_1");
  assert.equal(out.cells[0].hub_id, "hub_north");
  assert.deepEqual(out.cells[0].towers, ["kln_north_000001"]);
  assert.match(calls[0].url, /\/v1\/sites\/site_1$/);
});

test("a site id is URL-encoded", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { site: SITE, cells: [] } },
  ]);
  await client.getSite("site/../../etc");
  assert.ok(!calls[0].url.includes("/../"), calls[0].url);
});

test("a site with a status the SDK does not know is rejected", async () => {
  const { client } = clientFor([
    { status: 200, body: { sites: [{ ...SITE, status: "deleted" }] } },
  ]);
  await assert.rejects(() => client.listSites(), ValidationError);
});

// ── shares ───────────────────────────────────────────────────────────────
test("listShares parses the whole share shape", async () => {
  const { client } = clientFor([{ status: 200, body: { shares: [SHARE] } }]);
  const out = await client.listShares();
  const s = out.shares[0];
  assert.equal(s.share_id, "shr_1");
  assert.equal(s.owner_site_name, "North Gate");
  assert.deepEqual(s.scope[0].cameras, [1]);
  assert.equal(s.playback_from, null);
});

test("createShare sends the snake_case body the server expects", async () => {
  const { client, calls } = clientFor([{ status: 201, body: { share: SHARE } }]);
  await client.createShare({
    direction: "request",
    mySiteId: "site_2",
    otherSiteId: "site_1",
    scope: [{ device_id: "kln_north_000001" }],
    live: true,
    ptz: true,
    playback: true,
    playbackFrom: "2026-10-01T00:00:00Z",
    playbackTo: "2026-10-02T00:00:00Z",
    durationSec: 7200,
  });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    direction: "request",
    my_site_id: "site_2",
    other_site_id: "site_1",
    scope: [{ device_id: "kln_north_000001" }],
    live: true,
    ptz: true,
    playback: true,
    playback_from: "2026-10-01T00:00:00Z",
    playback_to: "2026-10-02T00:00:00Z",
    duration_sec: 7200,
  });
  assert.equal(calls[0].init.method, "POST");
});

test("createShare defaults to live only, no PTZ, no playback", async () => {
  const { client, calls } = clientFor([{ status: 201, body: { share: SHARE } }]);
  await client.createShare({
    direction: "offer",
    mySiteId: "site_1",
    otherSiteId: "site_2",
    scope: [{ device_id: "kln_north_000001" }],
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.live, true);
  assert.equal(body.ptz, false);
  assert.equal(body.playback, false);
});

test("acceptShare omits what the caller did not change", async () => {
  const { client, calls } = clientFor([{ status: 200, body: { share: SHARE } }]);
  await client.acceptShare("shr_1", { ptz: false, durationSec: 3600 });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ptz, false);
  assert.equal(body.duration_sec, 3600);
  // omitted keys are not sent as null, so the server keeps what was asked for
  assert.ok(!("scope" in body), Object.keys(body).join(","));
  assert.match(calls[0].url, /\/v1\/shares\/shr_1\/accept$/);
});

test("decline and revoke hit their own paths", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { share: { ...SHARE, status: "declined" } } },
    { status: 200, body: { share: { ...SHARE, status: "revoked" } } },
  ]);
  const declined = await client.declineShare("shr_1");
  assert.equal(declined.status, "declined");
  const revoked = await client.revokeShare("shr_1");
  assert.equal(revoked.status, "revoked");
  assert.match(calls[0].url, /\/shr_1\/decline$/);
  assert.match(calls[1].url, /\/shr_1\/revoke$/);
});

// ── the two helpers, which carry real rules ──────────────────────────────
test("isShareLive needs active AND unexpired", () => {
  assert.equal(isShareLive(SHARE), true);
  assert.equal(isShareLive({ ...SHARE, status: "pending" }), false);
  assert.equal(isShareLive({ ...SHARE, status: "revoked" }), false);
  assert.equal(
    isShareLive({ ...SHARE, expires_at: "2020-01-01T00:00:00Z" }),
    false,
    "an expired share is not live even while its status still says active",
  );
});

test("an unreadable expiry reads as expired, matching the server", () => {
  assert.equal(isShareLive({ ...SHARE, expires_at: "not-a-date" }), false);
});

test("isAdminRole treats owner as admin, because every old account is one", () => {
  assert.equal(isAdminRole("owner"), true);
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("OWNER"), true);
  assert.equal(isAdminRole("site_user"), false);
  assert.equal(isAdminRole(undefined), false);
  assert.equal(isAdminRole(null), false);
});

// ── administration ───────────────────────────────────────────────────────
test("adminSetSiteHubs sends the whole set", async () => {
  const { client, calls } = clientFor([{ status: 200, body: { site: SITE } }]);
  await client.adminSetSiteHubs("site_1", ["hub_a", "hub_b"]);
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), { hubs: ["hub_a", "hub_b"] });
  assert.match(calls[0].url, /\/v1\/admin\/sites\/site_1\/hubs$/);
});

test("adminListPeople parses people and their site membership", async () => {
  const { client } = clientFor([
    {
      status: 200,
      body: {
        people: [
          {
            account_id: "acct_1",
            login: "north",
            role: "site_user",
            status: "active",
            sites: ["site_1"],
          },
        ],
      },
    },
  ]);
  const out = await client.adminListPeople();
  assert.equal(out.people[0].login, "north");
  assert.deepEqual(out.people[0].sites, ["site_1"]);
});

test("adminCreatePerson defaults the role to site_user", async () => {
  const { client, calls } = clientFor([{ status: 201, body: {} }]);
  await client.adminCreatePerson({ login: "newhire", password: "x".repeat(16) });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.role, "site_user");
  assert.deepEqual(body.sites, []);
});

test("adminAudit builds its query by hand and skips empty filters", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { entries: [], limit: 100, offset: 0 } },
  ]);
  await client.adminAudit({ action: "share.", limit: 50 });
  const url = calls[0].url;
  assert.match(url, /action=share\./);
  assert.match(url, /limit=50/);
  assert.ok(!url.includes("device_id="), url);
  assert.ok(!url.includes("offset="), url);
});

test("adminAudit tolerates a free-form detail and a null account", async () => {
  const { client } = clientFor([
    {
      status: 200,
      body: {
        entries: [
          {
            seq: 7,
            ts: "2026-10-01T00:00:00Z",
            action: "share.revoke",
            account_id: null,
            device_id: null,
            detail: { share_id: "shr_1", anything: [1, 2, 3] },
          },
        ],
        limit: 100,
        offset: 0,
      },
    },
  ]);
  const out = await client.adminAudit();
  assert.equal(out.entries[0].account_id, null);
  assert.deepEqual(out.entries[0].detail.anything, [1, 2, 3]);
});

test("an audit entry missing its action is rejected", async () => {
  const { client } = clientFor([
    {
      status: 200,
      body: {
        entries: [{ seq: 1, ts: "2026-10-01T00:00:00Z" }],
        limit: 1,
        offset: 0,
      },
    },
  ]);
  await assert.rejects(() => client.adminAudit(), ValidationError);
});
