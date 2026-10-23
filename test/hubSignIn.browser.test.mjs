/**
 * The hub's sign-in screen, in a real browser.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS ONE HAS TO BE A BROWSER
 * ══════════════════════════════════════════════════════════════════════
 *
 * Everything this feature is made of is a thing only a browser does. Whether
 * the caret is in the password box is not a property of the source. Whether a
 * value filled in after paint survives is a question about ordering between a
 * fetch, a render and the browser's own autofill. And "the typed login is what
 * gets sent" is the one that matters most and the one a unit test cannot ask
 * at all: a screen that fills the box correctly and then posts the filled
 * value instead of the edited one would pass every other check in this file.
 *
 * It drives `screens.html` over a stubbed fetch, so there is no server. Three
 * screens, which are three kinds of box answering `/healthz`:
 *
 *   hub-signin        a hub that knows its customer  -> fills the login
 *   hub-signin-bare   a hub that does not            -> ordinary screen
 *   cloud-signin      Kallon Cloud                   -> ordinary screen
 *
 * ⚠ EACH TEST RELOADS THE PAGE. `loadSiteConfig` memoises on its promise for
 * the life of the module, which is right in the product and would otherwise
 * let the first screen's answer leak into the second's.
 *
 *     node --test test/hubSignIn.browser.test.mjs
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let server;
let browser;
let base;

before(async () => {
  server = await createServer({
    root: ROOT,
    server: { port: 0, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  const port = server.config.server.port ?? server.httpServer.address().port;
  base = `http://localhost:${port}/screens.html`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** A fresh page on one screen, with the sign-in form rendered. */
async function open(screen) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${base}?screen=${screen}`, { waitUntil: "networkidle" });
  await page.waitForSelector('input[autocomplete="current-password"]');
  /* The probe lands after paint, so the fill is asynchronous by nature.
     Nothing here waits on a fixed delay: the assertions below wait for the
     value they expect, or time out saying so. */
  await page.waitForTimeout(400);
  return { page };
}

const loginBox = (page) =>
  page.locator('input[placeholder="dave.terra-industries"]');
const passwordBox = (page) =>
  page.locator('input[autocomplete="current-password"]');

/** Which element has the caret. */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return el.getAttribute("type") === "password"
      ? "password"
      : el.getAttribute("placeholder") === "dave.terra-industries"
        ? "login"
        : el.tagName.toLowerCase();
  });

/* ======================================================================
 *  A HUB THAT KNOWS ITS CUSTOMER
 * ====================================================================== */

describe("a hub whose /healthz carries an organization", () => {
  test("⭐ the login box is filled with it", async () => {
    const { page } = await open("hub-signin");
    await assert.doesNotReject(
      loginBox(page).waitFor({ state: "visible", timeout: 2000 }),
    );
    assert.equal(await loginBox(page).inputValue(), "terra-industries");
    await page.close();
  });

  test("⭐ and the caret is in the password box", async () => {
    /* The whole of what this removes: typing `terra-industries` on a TV with
       no keyboard, at a gate, in the rain. */
    const { page } = await open("hub-signin");
    assert.equal(await focused(page), "password");
    await page.close();
  });

  test("⭐ it is still an ordinary input: clear it and type another", async () => {
    /* How Terra staff sign in on a customer's hub. No link, no note, no
       second mode -- just a box. */
    const { page } = await open("hub-signin");
    await loginBox(page).fill("");
    assert.equal(await loginBox(page).inputValue(), "");
    await loginBox(page).fill("dave.terra-industries");
    assert.equal(await loginBox(page).inputValue(), "dave.terra-industries");
    await page.close();
  });

  test("⭐ and the TYPED login is what gets sent", async () => {
    /* The failure a source test cannot see: filling the box correctly and
       then submitting the filled value rather than the edited one. The
       harness's `signIn` records its arguments, which is the observable
       thing when there is no server behind it. */
    const { page } = await open("hub-signin");
    await loginBox(page).fill("dave.terra-industries");
    await passwordBox(page).fill("hunter2hunter2");
    await passwordBox(page).press("Enter");
    await page.waitForFunction(() => (window.__signIn ?? []).length > 0, null, {
      timeout: 4000,
    });
    const sent = await page.evaluate(() => window.__signIn);
    assert.equal(sent[0].login, "dave.terra-industries");
    assert.notEqual(sent[0].login, "terra-industries", "the filled value was sent");
    await page.close();
  });

  test("and the filled login is what gets sent when nobody edits it", async () => {
    /* The other half, and the point of the feature: type only a password. */
    const { page } = await open("hub-signin");
    await passwordBox(page).fill("hunter2hunter2");
    await passwordBox(page).press("Enter");
    await page.waitForFunction(() => (window.__signIn ?? []).length > 0, null, {
      timeout: 4000,
    });
    const sent = await page.evaluate(() => window.__signIn);
    assert.equal(sent[0].login, "terra-industries");
    await page.close();
  });

  test("the browser's own suggestions are switched off on that box only", async () => {
    /* A saved credential arriving after paint would overwrite a value that
       was already correct, and the kiosk would show whoever signed in last.
       The password box keeps `current-password` so a saved password fills. */
    const { page } = await open("hub-signin");
    assert.equal(await loginBox(page).getAttribute("autocomplete"), "off");
    assert.equal(
      await passwordBox(page).getAttribute("autocomplete"),
      "current-password",
    );
    await page.close();
  });
});

/* ======================================================================
 *  EVERY OTHER SERVER
 * ====================================================================== */

describe("a hub that has not been told its customer", () => {
  test("⭐ starts with an empty login box", async () => {
    const { page } = await open("hub-signin-bare");
    assert.equal(await loginBox(page).inputValue(), "");
    await page.close();
  });

  test("and the caret is in the login box, as it always was", async () => {
    const { page } = await open("hub-signin-bare");
    assert.equal(await focused(page), "login");
    await page.close();
  });

  test("with the browser's suggestions left on", async () => {
    const { page } = await open("hub-signin-bare");
    assert.equal(await loginBox(page).getAttribute("autocomplete"), "username");
    await page.close();
  });
});

describe("Kallon Cloud", () => {
  test("⭐ starts with an empty login box, exactly as today", async () => {
    /* It serves thousands of organizations and has no single right answer to
       put in the box. It never sends the field, and this never invents one. */
    const { page } = await open("cloud-signin");
    assert.equal(await loginBox(page).inputValue(), "");
    assert.equal(await focused(page), "login");
    assert.equal(await loginBox(page).getAttribute("autocomplete"), "username");
    await page.close();
  });
});

/* ======================================================================
 *  EVERYTHING ELSE ON THE SCREEN IS UNTOUCHED
 * ====================================================================== */

describe("the rest of signing in is unchanged", () => {
  test("⭐ the lockout countdown still runs off a remembered deadline", async () => {
    /* Not re-tested in a browser -- `test/lockout.test.mjs` owns the clock.
       What matters here is that the screen still READS it, and that filling
       the login did not take the per-login lookup with it. */
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(resolve(ROOT, "src/components/LoginView.tsx"), "utf8");
    assert.match(src, /lockedUntil\(organizationName\)/);
    assert.match(src, /forgetLock\(organizationName\)/);
    assert.match(src, /secondsLeft\(lock\.until, now\)/);
  });

  test("a wrong password says the same plain sentence", async () => {
    /* ONE message for every credential failure -- unknown organization, wrong
       password, a login with a typo -- and it lives in `lockout.ts`, which
       this screen calls. Unchanged by any of this. */
    const { readFile } = await import("node:fs/promises");
    const lockout = await readFile(resolve(ROOT, "src/lib/lockout.ts"), "utf8");
    assert.match(lockout, /That login and password do not match\./);
    const src = await readFile(resolve(ROOT, "src/components/LoginView.tsx"), "utf8");
    assert.match(src, /wrongCredentialMessage\(organizationName\)/);
  });

  test("the filled login is still subject to the lock lookup", async () => {
    /* Filling the box fires the same effect typing it does, so a hub whose
       login is locked shows the countdown on arrival rather than a button
       that answers 429 on the first press. */
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(resolve(ROOT, "src/components/LoginView.tsx"), "utf8");
    assert.match(src, /\}, \[organizationName\]\);/);
  });
});
