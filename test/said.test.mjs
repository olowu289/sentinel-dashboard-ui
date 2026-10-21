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
const { said, readsLikeASentence } = await import(
  pathToFileURL(join(out, "said.mjs")).href
);

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
      said({ message: "scope: must be a non-empty list of towers", status: 422 },
           "Choose a camera."),
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
      assert.equal(said({ message: bad, status: 422 }, "fallback"), "fallback", bad);
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
    assert.equal(said(null, "That request did not go out."),
      "That request did not go out.");
    assert.equal(said(undefined, "That answer did not go through."),
      "That answer did not go through.");
    assert.equal(said({}, "That share did not go out."),
      "That share did not go out.");
  });

  test("and there is always one", () => {
    assert.ok(said(new Error("x")).length > 0);
  });
});
