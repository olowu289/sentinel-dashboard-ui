/**
 * Nothing a person reads is written for a programmer.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE ONE THAT WAS SEEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * A site was asked to lend a camera it did not have. The picker said "This
 * site has no towers to lend yet", Accept was pressed anyway, and the card
 * showed, in red:
 *
 *     scope: must be a non-empty list of towers
 *
 * The server says that properly now. This is the second half: a client that
 * shows whatever arrives will show whatever arrives, including from an older
 * server, a proxy, or a route nobody thought about.
 *
 * ⚠ IT IS NOT "ALWAYS USE OUR OWN WORDS". The server knows things this
 * screen does not -- "Test Site has no cameras yet", "a share has to last at
 * least 5 minutes" -- and those come from rules that live there because that
 * is where they are enforced. Replacing them with "That did not work" throws
 * away the only useful part.
 *
 *     node --test test/said.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "said-"));
execFileSync(
  "node",
  [
    join("node_modules", "esbuild", "bin", "esbuild"),
    "src/lib/said.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    `--outdir=${out}`,
    "--out-extension:.js=.mjs",
  ],
  { stdio: "pipe" },
);
const { said, readsLikeASentence, SUPPORT_HINT } = await import(
  pathToFileURL(join(out, "said.mjs")).href
);

/* THE CONSOLE IS PART OF THE CONTRACT, so it is captured rather than silenced:
   when `said` discards a technical message it has to put it somewhere a
   developer can find, under the same reference the person was given. */
const logged = [];
console.error = (...args) => {
  logged.push(args);
};

/** `said` with the reference stripped, plus the reference it used. */
function plainly(err, fallback) {
  const text = fallback === undefined ? said(err) : said(err, fallback);
  const m = /^(.*) \(ref ([0-9A-Z]{4})\)$/.exec(text);
  return m ? { text: m[1], ref: m[2] } : { text, ref: null };
}

describe("what a sentence looks like", () => {
  test("the server's own plain refusals are kept", () => {
    for (const good of [
      "Test Site has no cameras yet, so there is nothing to ask them for.",
      "choose at least one camera to share, then try again",
      "a share has to last at least 5 minutes: a shorter one can expire while the video is still being connected. Asked for 2 minutes",
      "you can only offer cameras your own site owns",
      "somebody has already accepted this share",
      "an administrator shares cameras rather than asking for them.",
    ]) {
      assert.equal(readsLikeASentence(good), true, good);
      assert.equal(said({ message: good, status: 422 }), good);
    }
  });

  test("the shape that actually reached a card is refused", () => {
    // `field: message`, which is how a validator stringifies.
    assert.equal(readsLikeASentence("scope: must be a non-empty list of towers"), false);
    assert.equal(
      plainly({ message: "scope: must be a non-empty list of towers", status: 422 },
           "Choose a camera.").text,
      "Choose a camera.",
    );
  });

  test("and the rest of the shapes that mean nobody thought about a reader", () => {
    for (const bad of [
      "duration_sec: must be an integer number of seconds",
      "must be a non-empty list of towers",
      "TypeError: Cannot read properties of undefined",
      "Traceback (most recent call last):",
      "share_id not found",
      "{'error': 'nope'}",
      "invalid_request",
      "",
      "   ",
      "None",
    ]) {
      assert.equal(readsLikeASentence(bad), false, bad);
      assert.equal(plainly({ message: bad, status: 422 }, "fallback").text,
        "fallback", bad);
    }
  });

  test("an absurdly long one is not a sentence either", () => {
    assert.equal(readsLikeASentence("word ".repeat(200)), false);
  });
});

describe("the ones worth replacing even when readable", () => {
  test("a signed-out session says what to do about it", () => {
    assert.match(said({ status: 401, message: "unauthorized" }), /sign in again/i);
  });

  test("an unreachable server is not the user's mistake", () => {
    assert.match(said({ code: "network_error" }), /Could not reach coordination/);
    assert.match(said({ status: 0 }), /Could not reach coordination/);
  });

  test("a 500 says it is not about what they typed", () => {
    assert.match(said({ status: 503, message: "upstream" }), /had a problem/);
  });

  test("a 403 with no message says whose decision it was", () => {
    assert.match(said({ status: 403 }), /not yours to do/);
  });

  test("but a 403 WITH a sentence keeps it: the server said which rule", () => {
    const why = "this share is not yours to end";
    assert.equal(said({ status: 403, message: why }), why);
  });
});

describe("the fallback", () => {
  test("says what did not happen, not that something went wrong", () => {
    assert.equal(plainly(null, "That request did not go out.").text,
      "That request did not go out.");
    assert.equal(plainly(undefined, "That answer did not go through.").text,
      "That answer did not go through.");
    assert.equal(plainly({}, "That share did not go out.").text,
      "That share did not go out.");
  });

  test("and there is always one", () => {
    assert.ok(said(new Error("x")).length > 0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
    THE SECOND ONE THAT WAS SEEN, AND THE RULE IT EARNED
   ══════════════════════════════════════════════════════════════════════ */

describe("the people-list message, which is the one that reached production", () => {
  const REAL = "people list from /v1/admin/people is not the documented shape";

  test("it is not a sentence, however much English it contains", () => {
    assert.equal(readsLikeASentence(REAL), false);
  });

  test("the screen says what did not load and what to do", () => {
    const { text } = plainly(
      { message: REAL, code: "response_invalid", status: 200 },
      `We could not load the people list. Refresh the page; ${SUPPORT_HINT}.`,
    );
    assert.match(text, /could not read the server's answer/i);
    assert.doesNotMatch(text, /\/v1\//);
  });

  test("and the detail is in the console under the reference the person was given",
    () => {
      logged.length = 0;
      const { ref } = plainly({ message: REAL, code: "response_invalid" }, "x");
      assert.ok(ref, "a discarded message is worth a reference");
      assert.equal(logged.length, 1);
      assert.match(String(logged[0][0]), new RegExp(ref));
    });
});

describe("nothing a person reads carries machinery", () => {
  /* ⚠ THIS IS THE RULE, AS A TEST. Every string below is one a screen could
     have been handed: by the server, by our own client library, by a proxy, by
     a browser. None of them may reach a person. */
  const MACHINERY = [
    "people list from /v1/admin/people is not the documented shape",
    "share list from /v1/shares is not the documented shape",
    "$.people[0].sites: expected array, got undefined",
    "scope: must be a non-empty list of towers",
    "duration_sec: must be an integer number of seconds",
    "field: owner_site_id",
    "TypeError: Cannot read properties of undefined (reading 'login')",
    "Error: fetch failed",
    "Traceback (most recent call last):",
    "    at SentryClient.adminListPeople (client.js:1587:11)",
    "HTTP 404",
    "HTTP 500 Internal Server Error",
    "status 429",
    "code 403",
    "422",
    "{\"error\": {\"code\": \"invalid_request\"}}",
    "response_invalid",
    "no_org_slug",
    "null",
    "undefined",
    "None",
    "NoneType has no attribute login",
    "the schema for this payload changed",
    "unexpected endpoint answer",
  ];

  const BANNED = [
    /\/v1\//,
    /\bshape\b/i,
    /\bschema\b/i,
    /\bdocumented\b/i,
    /\bfield:/i,
    /Error:/,
    /\bundefined\b/,
    /\bnull\b/,
    /\b[45]\d{2}\b/,
    /\bat [A-Za-z$_][\w$.]*\s*\(/,
    /:\d+:\d+/,
  ];

  test("every one of them is replaced, and the replacement is clean", () => {
    for (const raw of MACHINERY) {
      for (const shape of [
        { message: raw },
        { message: raw, status: 422 },
        { message: raw, status: 500 },
        { message: raw, code: "response_invalid" },
        new Error(raw),
      ]) {
        const shown = said(shape, "We could not do that. Try again.");
        for (const banned of BANNED) {
          assert.doesNotMatch(
            shown,
            banned,
            `${banned} survived into "${shown}" from ${JSON.stringify(raw)}`,
          );
        }
      }
    }
  });

  test("a quantity is not mistaken for a status code", () => {
    /* The guard that keeps the rule usable: a customer with a big site is
       allowed to be told about 500 of something. */
    assert.equal(readsLikeASentence("that site already holds 500 cameras"), true);
    assert.equal(readsLikeASentence("footage is kept for 400 days"), true);
    assert.equal(readsLikeASentence("the server answered 500"), false);
  });

  test("a plain sentence with a number in it still gets through", () => {
    const real =
      "a share has to last at least 5 minutes: a shorter one can expire while "
      + "the video is still being connected. Asked for 2 minutes";
    assert.equal(said({ message: real, status: 422 }), real);
  });
});

describe("the codes that have their own words", () => {
  test("a locked sign-in is not a wrong password", () => {
    assert.match(said({ code: "too_many_attempts", status: 429 }), /paused/i);
  });

  test("an organization with no login slug says what to do", () => {
    assert.match(said({ code: "no_org_slug", status: 409 }), /contact support/i);
  });

  test("a taken name is the server's decision, in our words", () => {
    assert.match(said({ code: "name_taken", status: 409 }), /already has that name/);
  });

  test("an offline cell says nothing was sent", () => {
    assert.match(said({ code: "hub_offline", status: 409 }), /offline/);
  });
});
