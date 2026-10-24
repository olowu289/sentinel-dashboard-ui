/**
 * "This login is already in use on 5 screens."
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS REFUSAL NEEDED ITS OWN ERROR
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠ BECAUSE THE PASSWORD WAS RIGHT. Every other refusal this screen handles
 * is `AuthRejectedError`, which is uniform BY CONSTRUCTION: an unknown
 * organization, a wrong password and a disabled account are deliberately
 * indistinguishable so the endpoint cannot be used to enumerate customers, and
 * the class carries no reason field so the UI has nothing to leak.
 *
 * `too_many_sign_ins` is not one of those. It is reachable only by somebody
 * who already typed the right password, so naming it reveals nothing they did
 * not already know -- and they need it named, because the uniform message
 * ("That login and password do not match") sends them to check a password that
 * was fine, on a screen that would let them in the moment one of their other
 * screens signed out.
 *
 * These drive the real `login()` against a stubbed `fetch`, because the thing
 * worth testing is which error comes out of which response -- and because one
 * change here reads the refusal body for every refusal, which is exactly the
 * sort of edit that quietly breaks the lockout countdown sharing that body.
 *
 *   node --test test/tooManySignIns.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, beforeEach, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let auth;
const BASE = "https://coord.example.test";

before(async () => {
  /* The config module reads the origin at import, so it is pinned before the
     bundle is loaded rather than stubbed afterwards. */
  process.env.VITE_COORDINATION_URL = BASE;
  const dir = await mkdtemp(join(tmpdir(), "too-many-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/api/auth";\n`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    /* ⚠ THE WHOLE OBJECT, not one key off it. `config.ts` reads several
       `import.meta.env` members at import, and defining a single one leaves
       the object itself undefined -- which fails on the first other read
       rather than on the one being stubbed. */
    define: {
      "import.meta.env": JSON.stringify({
        VITE_COORDINATION_URL: BASE,
        VITE_INVENTORY_SOURCE: "sdk",
        VITE_SITE_TZ: "",
      }),
    },
    alias: { "@": SRC, "@kallon/sentry-sdk": join(ROOT, "vendor/sentry-sdk/dist/esm/index.js") },
  });
  auth = await import(pathToFileURL(out).href);
});

/** One canned response for the next `login()`. */
function answer({ status, body, headers = {} }) {
  globalThis.fetch = async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
}

const signIn = () => auth.login("terra-industries", "hunter2hunter2");

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("no response was canned for this test");
  };
});

/* ======================================================================
 *  THE NEW REFUSAL
 * ====================================================================== */

describe("too_many_sign_ins", () => {
  test("⭐ is its own error, not a credential failure", async () => {
    answer({ status: 403, body: { error: { code: "too_many_sign_ins" } } });
    const err = await signIn().then(() => null, (e) => e);
    assert.ok(err instanceof auth.AuthTooManySignInsError, `got ${err?.name}`);
    assert.ok(!(err instanceof auth.AuthRejectedError), "it reads as a wrong password");
  });

  test("⭐ says what happened and what to do, with the count", async () => {
    answer({ status: 403, body: { error: { code: "too_many_sign_ins" }, sessions: 5 } });
    const err = await signIn().then(() => null, (e) => e);
    assert.equal(
      err.message,
      "This login is already in use on 5 screens. Sign out on one of them, then try again.",
    );
    assert.equal(err.screens, 5);
  });

  test("⭐ the SERVER's sentence wins where it sends one", async () => {
    /* It knows the limit and the count; this app knows neither, and a number
       invented here would be wrong the first time the limit changed. */
    answer({
      status: 403,
      body: {
        error: { code: "too_many_sign_ins", message: "Only 3 screens at once on this plan." },
      },
    });
    const err = await signIn().then(() => null, (e) => e);
    assert.equal(err.message, "Only 3 screens at once on this plan.");
  });

  test("⭐ and without a count it still says what to do", async () => {
    answer({ status: 403, body: { error: { code: "too_many_sign_ins" } } });
    const err = await signIn().then(() => null, (e) => e);
    assert.equal(
      err.message,
      "This login is already in use on other screens. Sign out on one of them, then try again.",
    );
    assert.equal(err.screens, null);
  });

  test("one screen is a screen, not 1 screens", async () => {
    answer({ status: 403, body: { code: "too_many_sign_ins", count: 1 } });
    const err = await signIn().then(() => null, (e) => e);
    assert.match(err.message, /on 1 screen\./);
  });

  test("the code is taken whatever status carries it", async () => {
    /* Which status coordination picks is its choice; a guess here would stop
       working silently and fall back to "that login and password do not
       match" on a password that was right. */
    for (const status of [400, 403, 409, 429, 503]) {
      answer({ status, body: { error: { code: "too_many_sign_ins" }, sessions: 2 } });
      const err = await signIn().then(() => null, (e) => e);
      assert.ok(err instanceof auth.AuthTooManySignInsError, `status ${status}: ${err?.name}`);
    }
  });

  test("the message is one short line, with no em-dash", async () => {
    /* The writing rules. Two sentences here are deliberate -- what happened
       and what to do -- and the whole thing still has to fit a screen. */
    const text = auth.tooManySignInsMessage(5);
    assert.ok(text.length < 110, `${text.length} characters`);
    assert.ok(!text.includes("—"), "an em-dash reached the sign-in screen");
  });
});

/* ======================================================================
 *  AND NOTHING ELSE MOVED
 * ====================================================================== */

describe("every other sign-in answer is unchanged", () => {
  test("⭐ a plain refusal is still the UNIFORM one", async () => {
    /* The anti-enumeration property: an unknown organization, a wrong
       password and a disabled account must stay indistinguishable. */
    for (const status of [401, 403]) {
      answer({ status, body: { error: { code: "invalid_login" } } });
      const err = await signIn().then(() => null, (e) => e);
      assert.ok(err instanceof auth.AuthRejectedError, `status ${status}: ${err?.name}`);
      assert.equal(err.message, auth.UNIFORM_AUTH_MESSAGE);
    }
  });

  test("a refusal with no body at all is still the uniform one", async () => {
    answer({ status: 401 });
    const err = await signIn().then(() => null, (e) => e);
    assert.ok(err instanceof auth.AuthRejectedError, err?.name);
  });

  test("⭐ the lockout still reads its seconds OUT OF THE BODY", async () => {
    /* THE REGRESSION THIS CHANGE COULD HAVE CAUSED. A body can only be read
       once, and the refusal code is now read for every refusal -- so a second
       `response.json()` in the 429 branch would throw and the countdown would
       silently become a lock with no number. */
    answer({ status: 429, body: { retry_after_sec: 240 } });
    const err = await signIn().then(() => null, (e) => e);
    assert.ok(err instanceof auth.AuthLockedError, err?.name);
    assert.equal(err.retryAfterSec, 240);
  });

  test("and falls back to the Retry-After header", async () => {
    answer({ status: 429, body: {}, headers: { "Retry-After": "90" } });
    const err = await signIn().then(() => null, (e) => e);
    assert.ok(err instanceof auth.AuthLockedError, err?.name);
    assert.equal(err.retryAfterSec, 90);
  });

  test("a 429 with neither is still a lock, just one that cannot count", async () => {
    answer({ status: 429 });
    const err = await signIn().then(() => null, (e) => e);
    assert.ok(err instanceof auth.AuthLockedError, err?.name);
    assert.equal(err.retryAfterSec, 0);
  });

  test("a missing endpoint is still unreachable, not a refusal", async () => {
    for (const status of [404, 405]) {
      answer({ status });
      const err = await signIn().then(() => null, (e) => e);
      assert.ok(err instanceof auth.AuthUnreachableError, `status ${status}: ${err?.name}`);
      assert.equal(err.reason, "no_endpoint");
    }
  });

  test("a server error is still unreachable", async () => {
    answer({ status: 500, body: { error: { code: "internal" } } });
    const err = await signIn().then(() => null, (e) => e);
    assert.ok(err instanceof auth.AuthUnreachableError, err?.name);
    assert.equal(err.reason, "server_error");
  });

  test("⭐ and a good sign-in still signs in", async () => {
    answer({
      status: 200,
      body: {
        session_ref: "ses_abc",
        expires_at: "2026-10-25T09:00:00Z",
        account: { account_id: "acct_1", login: "terra-industries", role: "owner" },
      },
    });
    const session = await signIn();
    assert.equal(session.ref, "ses_abc");
    assert.equal(session.account.login, "terra-industries");
  });
});

/* ======================================================================
 *  THE SCREEN
 * ====================================================================== */

describe("the sign-in screen shows it", () => {
  let view;
  before(async () => {
    const { readFile } = await import("node:fs/promises");
    view = await readFile(join(SRC, "components/LoginView.tsx"), "utf8");
  });

  test("⭐ it has a branch of its own, before the credential one", () => {
    const mine = view.indexOf("err instanceof AuthTooManySignInsError");
    const uniform = view.indexOf("err instanceof AuthRejectedError");
    assert.ok(mine > 0, "the screen does not handle it");
    assert.ok(mine < uniform, "it falls through to the uniform message");
  });

  test("⭐ and shows the server's words, not a sentence of its own", () => {
    const from = view.indexOf("err instanceof AuthTooManySignInsError");
    const to = view.indexOf("err instanceof AuthRejectedError");
    assert.match(view.slice(from, to), /message: err\.message/);
  });

  test("it rings the boxes, like any refusal a person can act on from here", () => {
    const from = view.indexOf("err instanceof AuthTooManySignInsError");
    const to = view.indexOf("err instanceof AuthRejectedError");
    assert.match(view.slice(from, to), /kind: "rejected"/);
  });
});
