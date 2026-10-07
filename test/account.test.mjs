/**
 * The account-settings contract: the policy mirror, and the status mapping.
 *
 * WHY THESE TWO THINGS AND NOT THE COMPONENT. This app has no component test
 * harness — no vitest, no testing-library, one `node --test` file that builds
 * with Vite's JS API — and adding one to ship a settings screen is a bigger
 * change than the screen. So this tests the two pieces where a mistake is
 * SILENT and EXPENSIVE, and leaves the rendering to review:
 *
 *   accountPolicy   the numbers that mirror coordination. If 12 drifts to 8
 *                   here, the form promises something the server refuses.
 *   api/account     the status -> error mapping. If 403 is ever folded into the
 *                   401 path, a MISTYPED CURRENT PASSWORD SIGNS THE CUSTOMER
 *                   OUT instead of telling them they mistyped — losing the form
 *                   and presenting a typo as a login failure. That is the whole
 *                   reason this file exists.
 *
 * ── HOW TYPESCRIPT GETS RUN ────────────────────────────────────────────
 *
 * The sources are `.ts` and import `@/...` aliases and `import.meta.env`, none
 * of which `node --test` understands. esbuild (already here, as a Vite
 * dependency) bundles a tiny entry point that re-exports the real modules, with
 * the alias and the env resolved exactly as Vite resolves them. The test
 * therefore runs THE SHIPPED SOURCE, not a transcription of it — which matters,
 * because a transcription is where a mapping test quietly stops testing the
 * mapping.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://coord.example.test:9081";

/** The bundled modules, loaded once. */
let mod;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "account-test-"));
  const entry = join(dir, "entry.ts");
  /* Imported through the `@/` alias, the same way every source file in this app
     imports its neighbours — so the alias esbuild is given below is the one
     actually under test, and a path that only works from a temp directory
     cannot pass here and fail in a build. */
  await writeFile(
    entry,
    `export * from "@/lib/accountPolicy";
     export * as api from "@/lib/api/account";
     export * as auth from "@/lib/api/auth";`,
    "utf8",
  );
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    /* The `@/` alias, as `vite.config.ts` sets it. */
    alias: { "@": join(ROOT, "src") },
    /* `import.meta.env`, as Vite injects it. The coordination URL is a real
       absolute URL so the client builds its request the way it will in a
       browser; nothing is ever actually connected to. */
    define: {
      "import.meta.env": JSON.stringify({
        VITE_COORDINATION_URL: BASE,
        MODE: "test",
        DEV: false,
        PROD: true,
      }),
    },
    logLevel: "silent",
  });
  mod = await import(pathToFileURL(out).href);
});

/* ------------------------------------------------------------------ *
 * A fetch stub, so nothing leaves the machine
 * ------------------------------------------------------------------ */

const realFetch = globalThis.fetch;
/** The last request the code under test made. */
let lastRequest = null;
/** What the next call answers with. */
let nextResponse = null;

function respond({ status = 200, body = {}, headers = {} } = {}) {
  nextResponse = { status, body, headers };
}

before(() => {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url: String(url), init: init ?? {} };
    const r = nextResponse ?? { status: 200, body: {}, headers: {} };
    nextResponse = null;
    if (r.throw) throw r.throw;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name) => r.headers[name] ?? null },
      json: async () => {
        if (r.body === "not json") throw new SyntaxError("bad json");
        return r.body;
      },
    };
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

/** A live local session, so `requireBearer` has something to find. */
function signedIn(login = "Terra Industries") {
  mod.auth.saveSession({
    ref: "ses_testreference",
    expiresAt: "2099-01-01T00:00:00.000Z",
    account: {
      account_id: "acct_AAAAAAAAAAAAAAAAAAAAAA",
      login,
      role: "owner",
      status: "active",
    },
  });
}

/* ================================================================== *
 * THE POLICY MIRROR
 * ================================================================== */

describe("accountPolicy", () => {
  test("the floor is 12, and it is the server's number", () => {
    /* `accounts.PASSWORD_MIN_LEN` on the server. If this is ever lowered to
       match the OLD 8-character seed floor, the form will promise something
       coordination refuses, and the person finds out after submitting. */
    assert.equal(mod.PASSWORD_MIN_LEN, 12);
    assert.equal(mod.PASSWORD_MAX_LEN, 1024);
    assert.equal(mod.LOGIN_MAX_LEN, 100);
  });

  test("eleven characters is refused and twelve is accepted", () => {
    assert.match(mod.checkNewPassword("x".repeat(11)), /at least 12/);
    assert.equal(mod.checkNewPassword("x".repeat(12)), null);
  });

  test("an empty box is not yet an error", () => {
    /* The button is disabled; a red line under an untouched field is noise. */
    assert.equal(mod.checkNewPassword(""), null);
    assert.equal(mod.checkNewLogin(""), null);
  });

  test("whitespace alone is not a password", () => {
    assert.match(mod.checkNewPassword(" ".repeat(20)), /only spaces/);
  });

  test("a trailing space in a real password is kept, not an error", () => {
    /* The server preserves it, so this must not reject or trim it. */
    assert.equal(mod.checkNewPassword("a real passphrase "), null);
  });

  test("the new password cannot be the current one", () => {
    const pw = "the same passphrase";
    assert.match(mod.checkNewPassword(pw, pw), /already using/);
    assert.equal(mod.checkNewPassword(pw, "something else entirely"), null);
  });

  test("over the length cap is refused", () => {
    assert.equal(mod.checkNewPassword("x".repeat(1024)), null);
    assert.match(mod.checkNewPassword("x".repeat(1025)), /at most 1024/);
  });

  test("an organization name is never trimmed, only cautioned about", () => {
    /* `accounts._normalise_login` is the identity function by deliberate
       decision: " Terra" and "Terra" are two different organizations. A client
       that trimmed would store a name other than the one typed. */
    assert.equal(mod.checkNewLogin(" Terra Industries "), null);
    assert.equal(mod.hasEdgeSpace(" Terra Industries "), true);
    assert.equal(mod.hasEdgeSpace("Terra Industries"), false);
    assert.equal(mod.hasEdgeSpace(""), false);
  });

  test("control characters are refused, the way the server refuses them", () => {
    assert.match(mod.checkNewLogin("Terra\nIndustries"), /invisible/);
    assert.match(mod.checkNewLogin("Terra\tIndustries"), /invisible/);
    assert.equal(mod.checkNewLogin("Ström & Sons"), null);
  });

  test("a blank name is refused and a long one is capped", () => {
    assert.match(mod.checkNewLogin("   "), /organization's name/);
    assert.equal(mod.checkNewLogin("x".repeat(100)), null);
    assert.match(mod.checkNewLogin("x".repeat(101)), /at most 100/);
  });
});

/* ================================================================== *
 * THE STATUS MAPPING — the reason this file exists
 * ================================================================== */

describe("api/account status mapping", () => {
  test("403 bad_current_password is a FIELD error and NOT a dead session", async () => {
    /* ⚠ THE ONE THAT MATTERS. `isUnauthorized` must say false, or the app signs
       the customer out over a typo instead of telling them about it. */
    signedIn();
    respond({
      status: 403,
      body: {
        error: {
          code: "bad_current_password",
          field: "current_password",
          message: "the current password is not correct",
        },
      },
    });
    const err = await mod.api
      .changePassword("wrong", "a long enough passphrase")
      .then(() => null, (e) => e);

    assert.ok(err, "it must reject");
    assert.equal(err.name, "AccountFieldError");
    assert.equal(err.code, "bad_current_password");
    assert.equal(err.field, "current_password");
    /* The server's wording, verbatim. Not re-written locally. */
    assert.equal(err.message, "the current password is not correct");
    assert.equal(mod.auth.isUnauthorized(err), false);
    /* And the local session survives, which is the half a 401 would break. */
    assert.ok(mod.auth.getSession());
  });

  test("401 IS a dead session and is recognised as one", async () => {
    signedIn();
    respond({ status: 401, body: { error: { code: "unauthorized" } } });
    const err = await mod.api
      .changePassword("whatever", "a long enough passphrase")
      .then(() => null, (e) => e);
    assert.equal(err.status, 401);
    assert.equal(mod.auth.isUnauthorized(err), true);
  });

  test("422 is a field error on the field the server named", async () => {
    signedIn();
    respond({
      status: 422,
      body: {
        error: {
          code: "weak_password",
          field: "new_password",
          message: "must be at least 12 characters",
        },
      },
    });
    const err = await mod.api
      .changePassword("right", "short")
      .then(() => null, (e) => e);
    assert.equal(err.name, "AccountFieldError");
    assert.equal(err.field, "new_password");
    assert.equal(mod.auth.isUnauthorized(err), false);
  });

  test("409 login_taken is a field error on the name, not a server fault", async () => {
    signedIn();
    respond({
      status: 409,
      body: {
        error: {
          code: "login_taken",
          field: "new_login",
          message: "that organization name is already registered",
        },
      },
    });
    const err = await mod.api
      .changeLogin("right", "Taken Ltd")
      .then(() => null, (e) => e);
    assert.equal(err.name, "AccountFieldError");
    assert.equal(err.code, "login_taken");
    assert.equal(err.field, "new_login");
  });

  test("a field error with no field falls back to the form's own field", async () => {
    /* A server that answers 422 without naming a field must still place the
       message somewhere, and the field being changed is the honest guess. */
    signedIn();
    respond({ status: 422, body: { error: { code: "invalid_request" } } });
    const err = await mod.api
      .changeLogin("right", "Whatever")
      .then(() => null, (e) => e);
    assert.equal(err.field, "new_login");
  });

  test("429 carries whole minutes, rounded up", async () => {
    signedIn();
    respond({ status: 429, body: {}, headers: { "Retry-After": "61" } });
    const err = await mod.api
      .changePassword("x", "a long enough passphrase")
      .then(() => null, (e) => e);
    assert.equal(err.name, "AccountThrottledError");
    /* 61 seconds is 2 minutes, never 1: the wording must not promise a sooner
       retry than the lock allows. */
    assert.equal(err.minutes, 2);
    assert.match(err.message, /2 min/);
  });

  test("a junk Retry-After does not become an immediate retry", async () => {
    /* `Number("soon")` is NaN, and `NaN > 0` is false. A `|| 0` here would have
       been fine; a `|| 30` would have invented a number. Neither may promise
       "try again now". */
    signedIn();
    respond({ status: 429, body: {}, headers: { "Retry-After": "soon" } });
    const err = await mod.api
      .changePassword("x", "a long enough passphrase")
      .then(() => null, (e) => e);
    assert.equal(err.minutes, 0);
    assert.doesNotMatch(err.message, /\d/);
  });

  test("404 and 501 mean the route is not there, not a wrong password", async () => {
    /* Coordination older than this dashboard, or running without a store. A
       real deployment state, and showing it as a credential failure sends
       somebody to reset a password that was fine. */
    for (const status of [404, 405, 501]) {
      signedIn();
      respond({ status, body: {} });
      const err = await mod.api
        .changeLogin("right", "New Name")
        .then(() => null, (e) => e);
      assert.equal(err.name, "AuthUnreachableError", `status ${status}`);
      assert.equal(err.reason, "no_endpoint", `status ${status}`);
      assert.equal(mod.auth.isUnauthorized(err), false);
    }
  });

  test("a 5xx is unreachable, not a verdict", async () => {
    signedIn();
    respond({ status: 503, body: {} });
    const err = await mod.api
      .changeLogin("right", "New Name")
      .then(() => null, (e) => e);
    assert.equal(err.name, "AuthUnreachableError");
    assert.equal(err.reason, "server_error");
  });

  test("a 200 with no account block is not a success", async () => {
    /* The point of the response is the fresh copy that replaces the stale one.
       Storing `undefined` and failing later is worse than failing here. */
    signedIn();
    respond({ status: 200, body: { reauthenticate: true } });
    const err = await mod.api
      .changePassword("right", "a long enough passphrase")
      .then(() => null, (e) => e);
    assert.equal(err.name, "AuthUnreachableError");
    assert.equal(err.reason, "bad_response");
  });
});

/* ================================================================== *
 * WHAT GOES ON THE WIRE
 * ================================================================== */

describe("api/account requests", () => {
  test("the bearer is sent and the body carries both fields", async () => {
    signedIn();
    respond({
      status: 200,
      body: {
        account: { account_id: "acct_A", login: "Terra Industries", role: "owner", status: "active" },
        sessions_revoked: 3,
        reauthenticate: true,
      },
    });
    const result = await mod.api.changePassword("old one", "a long enough passphrase");

    assert.equal(lastRequest.url, `${BASE}/v1/account/password`);
    assert.equal(lastRequest.init.method, "POST");
    assert.equal(lastRequest.init.headers.Authorization, "Bearer ses_testreference");
    assert.deepEqual(JSON.parse(lastRequest.init.body), {
      current_password: "old one",
      new_password: "a long enough passphrase",
    });
    assert.equal(result.sessionsRevoked, 3);
    assert.equal(result.reauthenticate, true);
  });

  test("the organization name goes on the wire untouched", async () => {
    /* No trim, no case folding, on the one field where exactness is the rule. */
    signedIn();
    respond({
      status: 200,
      body: {
        account: { account_id: "acct_A", login: "  Terra  ", role: "owner", status: "active" },
      },
    });
    await mod.api.changeLogin("pw", "  Terra  ");
    assert.equal(JSON.parse(lastRequest.init.body).new_login, "  Terra  ");
  });

  test("reauthenticate defaults to true and is read, not assumed", async () => {
    signedIn();
    respond({
      status: 200,
      body: {
        account: { account_id: "acct_A", login: "Terra", role: "owner", status: "active" },
        reauthenticate: false,
      },
    });
    const kept = await mod.api.changePassword("pw", "a long enough passphrase");
    assert.equal(kept.reauthenticate, false, "a client that hardcoded true would stop obeying");

    signedIn();
    respond({
      status: 200,
      body: { account: { account_id: "acct_A", login: "Terra", role: "owner", status: "active" } },
    });
    const absent = await mod.api.changePassword("pw", "a long enough passphrase");
    assert.equal(absent.reauthenticate, true, "absent means the safe reading");
  });

  test("no session means a 401-shaped failure, not a request", async () => {
    mod.auth.clearSession();
    lastRequest = null;
    const err = await mod.api
      .changePassword("pw", "a long enough passphrase")
      .then(() => null, (e) => e);
    assert.equal(err.status, 401);
    assert.equal(mod.auth.isUnauthorized(err), true);
    assert.equal(lastRequest, null, "nothing may go on the wire without a bearer");
  });

  test("a rename updates the stored account, keeping the same reference", async () => {
    /* Otherwise the app keeps stamping yesterday's organization name on today's
       actions until a reload. */
    signedIn("Old Name");
    respond({
      status: 200,
      body: {
        account: { account_id: "acct_A", login: "New Name", role: "owner", status: "active" },
      },
    });
    const updated = await mod.api.changeLogin("pw", "New Name");
    mod.auth.updateStoredAccount(updated);
    assert.equal(mod.auth.getSession().account.login, "New Name");
    assert.equal(mod.auth.getSession().ref, "ses_testreference",
      "a rename must not re-issue the credential");
  });

  test("updateStoredAccount with no session is a no-op, not an invention", async () => {
    mod.auth.clearSession();
    mod.auth.updateStoredAccount({
      account_id: "acct_A", login: "Ghost", role: "owner", status: "active",
    });
    assert.equal(mod.auth.getSession(), null);
  });
});
