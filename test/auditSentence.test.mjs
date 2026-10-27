/**
 * The audit log, as sentences a customer can read.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS GUARDING
 * ══════════════════════════════════════════════════════════════════════
 *
 * The page used to print the row: the action verbatim, the actor's account id,
 * the device id, a timestamp.
 *
 *     17:25:45   person.create   acct_1kt52KaWSz66g2pFJcoAJQ   -
 *     17:26:02   login.failure   -                             -
 *
 * Two things were wrong and this file holds both of them shut.
 *
 *   1. NO ROW MAY CONTAIN MACHINERY. Not an action name, not an id, not a
 *      code -- the sentence names PEOPLE and PLACES or it says "somebody".
 *   2. A ROW WITH NO WORDS IS NOT SHOWN AT ALL. `ptz.command`, `grant.issue`,
 *      `session.open` and the renewal and enrolment internals stay on the DC
 *      exactly as they are recorded; `sentenceFor` returns null for them and
 *      the page drops them. A build that "helpfully" fell back to printing the
 *      action would put `ptz.command` back on the screen, which is how it got
 *      there the first time.
 *
 *     node --test test/auditSentence.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* Bundled the way the other lib tests are: TypeScript that imports a type
   from `@kallon/sentry-sdk`, which esbuild resolves in the same step. */
const out = mkdtempSync(join(tmpdir(), "audit-"));
execFileSync(
  "node",
  [
    join("node_modules", "esbuild", "bin", "esbuild"),
    "src/lib/auditSentence.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    `--outdir=${out}`,
    "--out-extension:.js=.mjs",
  ],
  { stdio: "pipe" },
);
const a = await import(pathToFileURL(join(out, "auditSentence.mjs")).href);

/** A row as the DC sends it, with the bits every row has. */
function row(action, detail = {}, extra = {}) {
  return {
    seq: 1,
    ts: "2026-10-21T17:25:45Z",
    action,
    account_id: "acct_admin",
    device_id: null,
    detail,
    ...extra,
  };
}

/** The server's id -> name map, which is why these read as sentences. */
const NAMES = {
  acct_admin: "Terra Industries",
  acct_dele: "dele",
  acct_chi: "chi",
  site_north: "North Gate",
  site_south: "South Pit",
  "hub-lab": "Lab Hub",
  kln_lab_000002: "Lab Mast",
  kln_lab_000003: "Back Mast",
};

/* The shapes that must never appear in a rendered sentence. The id patterns
   are this product's real prefixes; the action pattern is `a.b`, which is what
   printing `entry.action` looks like. */
const MACHINERY = [
  [/\bacct_[A-Za-z0-9]{3,}/, "an account id"],
  [/\bkln_[a-z0-9_]+/i, "a tower serial"],
  [/\bhub[-_][a-z0-9][a-z0-9-]{2,}/i, "a hub id"],
  [/\bsite_[a-z0-9_]+/i, "a site id"],
  [/\b[a-z_]+\.[a-z_]+\b/, "a bare action name"],
  [/[A-Z][A-Z0-9]*_[A-Z0-9_]+/, "a shouted code"],
];

function assertReadable(sentence, where) {
  assert.ok(sentence, `${where}: no sentence at all`);
  for (const [re, why] of MACHINERY) {
    assert.doesNotMatch(sentence, re, `${where} contains ${why}: ${sentence}`);
  }
}

describe("sign-ins", () => {
  test("a successful one names the person", () => {
    assert.equal(
      a.sentenceFor(row("login.success"), NAMES),
      "Terra Industries signed in",
    );
  });

  test("the server's own name for the actor wins over the map", () => {
    /* `who` is resolved on the DC, and it is the only thing that still knows
       the name of a person who has since been REMOVED. */
    assert.equal(
      a.sentenceFor(row("login.success", {}, { who: "dele" }), NAMES),
      "dele signed in",
    );
  });

  test("a refusal says WHY, in words, and never the reason code", () => {
    const s = a.sentenceFor(
      row("login.failure", { reason: "wrong_password" }, { who: "dele" }),
      NAMES,
    );
    assert.equal(s, "Sign-in failed for dele (wrong password)");
    assertReadable(s, "login.failure");
  });

  test("a refusal with no account does not invent a person", () => {
    /* THE INTERESTING CASE. A login that matched nothing has no account id --
       that is what makes it worth reading -- and the row used to be four
       dashes. */
    assert.equal(
      a.sentenceFor(row("login.failure", { reason: "unknown_login" }, { account_id: null }), {}),
      "Sign-in failed (no such login)",
    );
  });

  test("an unknown reason still reads as a sentence", () => {
    const s = a.sentenceFor(row("login.failure", { reason: "teapot_shaped" }), NAMES);
    assert.equal(s, "Sign-in failed for Terra Industries");
    assertReadable(s, "login.failure with an unknown reason");
  });

  test("a lockout says how long it lasts", () => {
    assert.equal(
      a.sentenceFor(row("login.locked", { retry_after_sec: 900 }), NAMES),
      "Sign-in locked after too many attempts for 15 minutes",
    );
  });
});

describe("people", () => {
  test("adding somebody names them", () => {
    assert.equal(
      a.sentenceFor(row("person.create", { created: "acct_dele" }), NAMES),
      "Terra Industries added dele",
    );
  });

  test("REMOVING somebody keeps their name when nothing can resolve it", () => {
    /* The whole reason the DC writes `person_name` into the row: a year from
       now the account is gone from every list, and the ledger still has to say
       who it was. */
    const s = a.sentenceFor(
      row("person.remove", { target: "acct_gone", person_name: "chi" }),
      NAMES,
    );
    assert.equal(s, "Terra Industries removed chi");
    assertReadable(s, "person.remove");
  });

  test("disabling and enabling are different sentences", () => {
    assert.equal(
      a.sentenceFor(row("person.disable", { target: "acct_dele" }), NAMES),
      "Terra Industries disabled dele",
    );
    assert.equal(
      a.sentenceFor(row("person.enable", { target: "acct_dele" }), NAMES),
      "Terra Industries enabled dele",
    );
  });

  test("a rename says what it was, because that is the point of the row", () => {
    assert.equal(
      a.sentenceFor(
        row("person.rename", {
          target: "acct_dele",
          previous_name: "chi",
          person_name: "dele",
        }),
        NAMES,
      ),
      "Terra Industries renamed chi to dele",
    );
  });

  test("site membership reads as access, not as a join table", () => {
    assert.equal(
      a.sentenceFor(
        row("site.member_add", { target: "acct_dele", site_id: "site_north" }),
        NAMES,
      ),
      "Terra Industries gave dele access to North Gate",
    );
    assert.equal(
      a.sentenceFor(
        row("site.member_remove", { target: "acct_dele", site_id: "site_north" }),
        NAMES,
      ),
      "Terra Industries took dele's access to North Gate away",
    );
  });
});

describe("sharing", () => {
  test("a request names both sites and how long was asked for", () => {
    const s = a.sentenceFor(
      row("share.request", {
        owner_site_id: "site_north",
        viewer_site_id: "site_south",
        asked_duration_sec: 7200,
      }),
      NAMES,
    );
    assert.equal(
      s,
      "Terra Industries asked North Gate to share cameras with South Pit for 2 hours",
    );
    assertReadable(s, "share.request");
  });

  test("an accepted share names the TOWERS, not their serials", () => {
    const s = a.sentenceFor(
      row("share.accept", { towers: ["kln_lab_000002", "kln_lab_000003"] }),
      NAMES,
    );
    assert.equal(s, "Terra Industries shared LAB MAST and BACK MAST");
    assertReadable(s, "share.accept");
  });

  test("and an unnameable tower becomes a word rather than a serial", () => {
    const s = a.sentenceFor(row("share.accept", { towers: ["kln_ghost_000009"] }), NAMES);
    assert.equal(s, "Terra Industries shared some cameras");
    assertReadable(s, "share.accept with an unknown tower");
  });

  test("an expiry has no actor, because nobody did it", () => {
    assert.equal(a.sentenceFor(row("share.expire", {}, { account_id: null }), {}), "A share ran out");
  });
});

describe("sites and towers", () => {
  test("a new site is named", () => {
    assert.equal(
      a.sentenceFor(row("site.create", { site_id: "site_north", name: "North Gate" }), NAMES),
      "Terra Industries added the site North Gate",
    );
  });

  test("a deleted site keeps its name from the row", () => {
    /* `site.archive` is a SOFT delete precisely so the ledger stays readable,
       and the name is in the row for the entries written before it went. */
    const s = a.sentenceFor(
      row("site.archive", { site_id: "site_gone", name: "Old Yard" }),
      NAMES,
    );
    assert.equal(s, "Terra Industries deleted the site Old Yard");
    assertReadable(s, "site.archive");
  });

  test("a cell is a cell, by name, in a site, by name", () => {
    const s = a.sentenceFor(
      row("site.hub_assign", { hub_id: "hub-lab", site_id: "site_north" }),
      NAMES,
    );
    assert.equal(s, "Terra Industries put LAB HUB in North Gate");
    assertReadable(s, "site.hub_assign");
  });

  test("a tower added to a cell says which tower and which cell", () => {
    const s = a.sentenceFor(
      row("device.added", { what: "tower", name: "Lab Mast", hub_id: "hub-lab" }),
      NAMES,
    );
    assert.equal(s, "Terra Industries added the tower LAB MAST to LAB HUB");
    assertReadable(s, "device.added");
  });

  test("a removed tower is named from the row, not from the fleet", () => {
    const s = a.sentenceFor(
      row("device.removed", { name: "Lab Mast" }, { device_id: "kln_lab_000002" }),
      NAMES,
    );
    assert.equal(s, "Terra Industries removed LAB MAST");
    assertReadable(s, "device.removed");
  });
});

describe("what the page must NOT show", () => {
  test("the technical actions have no sentence, so no row is drawn", () => {
    /* ⚠ THESE ARE STILL RECORDED. The DC keeps every one of them, exactly as
       before; this is about the website's view. */
    for (const action of [
      "ptz.command",
      "ptz.home_set",
      "grant.issue",
      "grant.renew",
      "session.open",
      "session.close",
      "renewal.ok",
      "renewal.failed",
      "enrol.request",
      "enrol.approve",
      "tower.enrol",
      "ota.target_set",
      "something.nobody.wrote.words.for",
    ]) {
      assert.equal(
        a.sentenceFor(row(action), NAMES),
        null,
        `${action} would be drawn on the page`,
      );
    }
  });

  test("every sentence this file can produce is free of machinery", () => {
    /* A sweep rather than a list: the actions the four groups cover, each with
       a detail that resolves to nothing, which is the worst case for a
       fallback. An id leaking through one of them is the bug this catches. */
    const actions = [
      "login.success",
      "login.failure",
      "login.locked",
      "login.throttled",
      "person.create",
      "person.remove",
      "person.disable",
      "person.enable",
      "person.password_reset",
      "person.rename",
      "site.member_add",
      "site.member_remove",
      "share.request",
      "share.offer",
      "share.accept",
      "share.decline",
      "share.revoke",
      "share.expire",
      "share.extend",
      "site.create",
      "site.rename",
      "site.archive",
      "site.delete",
      "site.hub_assign",
      "site.hub_unassign",
      "device.added",
      "device.renamed",
      "device.moved",
      "device.removed",
      "device.replaced",
    ];
    const nothingResolves = {
      target: "acct_1kt52KaWSz66g2pFJcoAJQ",
      created: "acct_1kt52KaWSz66g2pFJcoAJQ",
      site_id: "site_7f3a91",
      to_site_id: "site_7f3a91",
      owner_site_id: "site_7f3a91",
      viewer_site_id: "site_7f3a91",
      hub_id: "hub-lab-01",
      towers: ["kln_lab_000002"],
      reason: "WRONG_PASSWORD",
    };
    for (const action of actions) {
      const s = a.sentenceFor(
        row(action, nothingResolves, { account_id: "acct_1kt52KaWSz66g2pFJcoAJQ", device_id: "kln_lab_000002" }),
        {},
      );
      assertReadable(s, action);
    }
  });

  test("and every one of them is in a group the page offers", () => {
    /* A row the server sends for a chosen group and the page has no group for
       would be a filter chip that does not account for what it shows. */
    const ids = new Set(a.AUDIT_GROUPS.map((g) => g.id));
    for (const action of [
      "login.success",
      "person.remove",
      "site.member_add",
      "share.accept",
      "site.create",
      "device.added",
    ]) {
      const g = a.groupOf(row(action));
      assert.ok(ids.has(g), `${action} is in no group (${g})`);
    }
    assert.equal(a.groupOf(row("ptz.command")), null);
  });
});

describe("lengths in words", () => {
  test("minutes under an hour, hours above it", () => {
    assert.equal(a.spellSeconds(60), "1 minute");
    assert.equal(a.spellSeconds(2700), "45 minutes");
    assert.equal(a.spellSeconds(3600), "1 hour");
    assert.equal(a.spellSeconds(7200), "2 hours");
  });

  test("nothing at all for a missing or nonsense length", () => {
    /* The caller appends this to a sentence, so "" has to mean "say nothing"
       rather than "0 seconds". */
    for (const v of [undefined, null, 0, -5, "", "soon", NaN]) {
      assert.equal(a.spellSeconds(v), "", String(v));
    }
  });
});

describe("a DC that has not been updated yet", () => {
  test("a row whose detail is nested one level deeper still reads", () => {
    /* ⚠ THE WEBSITE SHIPS SEPARATELY FROM THE DC. These rows were stored as
       `{"detail": {...}}` because the route passed its fields as one argument
       and they were nested instead of merged. The newer DC flattens them; a
       customer on the older one must not get a page of "somebody added
       somebody". */
    const nested = row("person.create", { detail: { created: "acct_dele" } });
    assert.equal(a.sentenceFor(nested, NAMES), "Terra Industries added dele");
  });

  test("and a row that happens to carry other fields is left alone", () => {
    const flat = row("person.create", { created: "acct_dele", detail: "noise" });
    assert.equal(a.sentenceFor(flat, NAMES), "Terra Industries added dele");
  });
});
