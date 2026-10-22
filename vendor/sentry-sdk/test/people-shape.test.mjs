/**
 * The people list, parsed from THE REPLY THE SERVER ACTUALLY SENDS.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS FILE IS NOT MORE HAND-WRITTEN FIXTURES
 * ══════════════════════════════════════════════════════════════════════
 *
 * Adding a person failed in production with
 *
 *     people list from /v1/admin/people is not the documented shape
 *
 * after the person had already been created. Both suites were green: this
 * one parsed a fixture somebody typed, and the server answered something
 * else. `POST` carried `name` and no `sites`; `GET` carried `sites` and no
 * `name`; this parser needed both and got one from each.
 *
 * So `test/fixtures/admin_people_reply.json` is CAPTURED from the real
 * routes, not typed. Its twin lives in the server's suite
 * (`core/coordination/tests/fixtures/`), beside a test that regenerates it
 * from a running server and fails if it has drifted. Volatile values (account
 * ids, timestamps) are normalised in the capture; nothing else is.
 *
 * The organization in it is shaped like the real customer: a login that is a
 * display name with a space, `Terra Industries`, whose slug is therefore
 * `terra-industries`. That difference is the whole reason `org.slug` exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SentryClient, ValidationError, parsePeopleList } from "../dist/esm/index.js";

const REPLY = JSON.parse(
  readFileSync(new URL("./fixtures/admin_people_reply.json", import.meta.url), "utf8"),
);

function clientFor(responses) {
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
  const client = new SentryClient({
    baseUrl: "https://coord.example.test",
    token: "t0ken",
    fetch: fetchLike,
  });
  return { client, calls };
}

test("the captured reply parses, which is the whole of the bug", () => {
  const out = parsePeopleList(REPLY, { status: 200, path: "/v1/admin/people" });
  assert.equal(out.people.length, 2);
});

test("the organization's own account is not a person and has no name", () => {
  const { people } = parsePeopleList(REPLY);
  const org = people.find((p) => p.login === "Terra Industries");
  assert.ok(org, "the administrator's own login is in the list");
  assert.equal(org.name, undefined);
  /* A UI that renders `{name ?? login}` and then the login beside it printed
     the same string twice. `name === undefined` is what tells it this row is
     an organization, so it can show one. */
});

test("a person carries a name that is not their login", () => {
  const { people } = parsePeopleList(REPLY);
  const person = people.find((p) => p.name === "guest2");
  assert.ok(person);
  assert.equal(person.login, "guest2.terra-industries");
  assert.deepEqual(person.sites, ["site_FIXTURE"]);
});

test("the organization block carries the slug a login is built from", () => {
  const { org } = parsePeopleList(REPLY);
  assert.ok(org, "the reply says which organization this is");
  assert.equal(org.name, "Terra Industries");
  assert.equal(org.slug, "terra-industries");
  assert.notEqual(org.name, org.slug);
  /* A screen with only `name` cannot build a login: `guest2.Terra Industries`
     is not anybody's login. With only `slug` it cannot name the customer. */
});

test("adminListPeople returns the organization through the client too", async () => {
  const { client } = clientFor([{ status: 200, body: REPLY }]);
  const out = await client.adminListPeople();
  assert.equal(out.org.slug, "terra-industries");
  assert.equal(out.people.length, 2);
});

test("adminAddPerson parses the 201 the server really sends", async () => {
  /* The create reply is one person and no organization: the same parser, the
     shape that threw. */
  const person = REPLY.people.find((p) => p.name === "guest2");
  const { client } = clientFor([{ status: 201, body: { person } }]);
  const out = await client.adminAddPerson({
    name: "guest2",
    password: "a stronger one than this",
    sites: ["site_FIXTURE"],
  });
  assert.equal(out.login, "guest2.terra-industries");
  assert.equal(out.name, "guest2");
  assert.deepEqual(out.sites, ["site_FIXTURE"]);
});

test("a person with no sites is tolerated, not rejected", async () => {
  /* ⚠ THE COMPATIBILITY DIRECTION. The server sends `sites` from every route
     now, and the client and the server ship separately -- so a reply without
     it must still parse. Refusing it is what made a created person look like
     a failure. */
  const { client } = clientFor([
    {
      status: 201,
      body: {
        person: {
          account_id: "acct_x",
          login: "dele.terra-industries",
          name: "dele",
          role: "site_user",
          status: "active",
        },
      },
    },
  ]);
  const out = await client.adminAddPerson({ name: "dele", password: "x".repeat(16) });
  assert.deepEqual(out.sites, []);
});

test("a reply with no organization block still parses", () => {
  const out = parsePeopleList({ people: [] });
  assert.equal(out.org, undefined);
  assert.deepEqual(out.people, []);
});

test("something that is not a people list is still refused", () => {
  assert.throws(
    () => parsePeopleList({ people: [{ login: 7 }] }, { path: "/v1/admin/people" }),
    ValidationError,
  );
  /* Tolerance is for fields that may be absent, not for fields that are the
     wrong type. The first is a compatible change; the second is a bug. */
});

/* ══════════════════════════════════════════════════════════════════════
    REMOVING A PERSON, AND AN AUDIT PAGE THAT CAN BE READ
   ══════════════════════════════════════════════════════════════════════ */

test("adminRemovePerson deletes by id and returns the name", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { removed: "acct_x", name: "guest2" } },
  ]);
  const out = await client.adminRemovePerson("acct_x");
  assert.equal(calls[0].init.method, "DELETE");
  assert.match(calls[0].url, /\/v1\/admin\/people\/acct_x$/);
  assert.equal(out.name, "guest2");
  /* The NAME comes back because the confirmation afterwards is about a person
     who is no longer in any list to look up. */
});

test("the audit view asks for groups, not for everything", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { entries: [], limit: 100, offset: 0 } },
  ]);
  await client.adminAudit({ groups: ["people", "sharing"], limit: 100 });
  assert.match(calls[0].url, /groups=people%2Csharing/);
  /* ⚠ A SERVER FILTER. On a busy fleet 200 unfiltered rows are almost all
     ptz.command, so a page that filtered in the browser would show four
     sentences and a lot of nothing. */
});

test("no groups means no groups parameter at all", async () => {
  const { client, calls } = clientFor([
    { status: 200, body: { entries: [], limit: 100, offset: 0 } },
  ]);
  await client.adminAudit({ groups: [] });
  assert.doesNotMatch(calls[0].url, /groups=/);
});

test("the audit reply carries the names the page prints", async () => {
  const { client } = clientFor([
    {
      status: 200,
      body: {
        entries: [
          {
            seq: 9,
            ts: "2026-10-21T17:25:45Z",
            action: "person.create",
            account_id: "acct_admin",
            device_id: null,
            detail: { created: "acct_g2", person_name: "guest2" },
            who: "Terra Industries",
          },
        ],
        limit: 100,
        offset: 0,
        names: { acct_admin: "Terra Industries", acct_g2: "guest2" },
        groups: ["people", "places", "sharing", "sign_ins"],
      },
    },
  ]);
  const out = await client.adminAudit({ groups: ["people"] });
  assert.equal(out.entries[0].who, "Terra Industries");
  assert.equal(out.names.acct_g2, "guest2");
  assert.deepEqual([...out.groups].sort(), ["people", "places", "sharing", "sign_ins"]);
});

test("a server with no names map still parses", async () => {
  /* The browser's fallback is "somebody", never the id. */
  const { client } = clientFor([
    {
      status: 200,
      body: {
        entries: [
          { seq: 1, ts: "2026-10-21T00:00:00Z", action: "login.success",
            account_id: "acct_1", device_id: null, detail: null },
        ],
        limit: 100,
        offset: 0,
      },
    },
  ]);
  const out = await client.adminAudit();
  assert.equal(out.names, undefined);
  assert.equal(out.entries[0].who, undefined);
});
