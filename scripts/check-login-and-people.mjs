// Adding a person, signing in as one, and being locked out of it.
//
// ══════════════════════════════════════════════════════════════════════════
//  WHAT THIS CHECKS THAT NOTHING ELSE CAN
// ══════════════════════════════════════════════════════════════════════════
//
// Four things went wrong in production in one afternoon, and three of them
// only exist in a browser:
//
//   A. a person WAS created and the page said "people list from
//      /v1/admin/people is not the documented shape", then listed the login
//      twice and promised the new person would sign in as
//      `guest2.<organization>`;
//   B. `guest2.Terra Industries` -- the organization as every screen writes
//      it -- was refused, five times, and then locked out;
//   D. the lockout said "wait a few minutes" while the server had sent the
//      exact number of seconds, and an early retry made the wait longer;
//   E. the error above is the kind of sentence no screen may ever show.
//
// The demo's organization is `kallon-demo` and it is DISPLAYED as "Kallon
// Demo", so the same three spellings exist here: the slug, the display name,
// and the display name in lower case.
//
// ⚠ IT NEEDS THE BENCH STARTED WITH A SHORT LOCK, or the countdown cannot be
// watched reaching zero inside a test:
//
//   powershell -File tools\demo\start-demo.ps1 -LoginMaxFailures 3 -LoginLockoutSec 15
//   node scripts/check-login-and-people.mjs [outdir]

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const APP = process.env.DEMO_URL ?? "http://localhost:5173/";
const API = process.env.VITE_COORDINATION_URL ?? "http://127.0.0.1:9099";
const OUT = process.argv[2] ?? ".";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password";
const ORG = process.env.DEMO_ORG ?? "kallon-demo";
/** How the organization is WRITTEN, which is what somebody types. */
const ORG_DISPLAY = process.env.DEMO_ORG_DISPLAY ?? "Kallon Demo";
/** The bench's cap and lock, as passed to start-demo.ps1. */
const CAP = Number(process.env.DEMO_LOGIN_CAP ?? 3);
const LOCK_SEC = Number(process.env.DEMO_LOCK_SEC ?? 15);
await mkdir(OUT, { recursive: true });

let failures = 0;
let passes = 0;
const ok = (what) => { passes += 1; console.log(`  ok   ${what}`); };
const bad = (what, detail) => {
  failures += 1;
  console.log(`  FAIL ${what}${detail ? `: ${detail}` : ""}`);
};
const is = (what, got, want) =>
  got === want
    ? ok(what)
    : bad(what, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
const holds = (text, needle) =>
  (text ?? "").toLowerCase().includes(String(needle).toLowerCase());
const has = (what, text, needle) =>
  holds(text, needle)
    ? ok(what)
    : bad(what, `no ${JSON.stringify(needle)} in: ${(text ?? "").slice(0, 400)}`);
const hasNot = (what, text, needle) =>
  !holds(text, needle) ? ok(what) : bad(what, `unexpected ${JSON.stringify(needle)}`);

/* ══════════════════════════════════════════════════════════════════════
    THE SITE-WIDE ERROR RULE, AS A SWEEP
   ══════════════════════════════════════════════════════════════════════

   Every string below is machinery. After each step this script reads the
   whole visible page and asserts that none of them is on it -- so a message
   that leaks on a screen nobody thought to assert on still fails the run. */
const BANNED = [
  "/v1/",
  "documented",
  "schema",
  " shape",
  "field:",
  "Error:",
  "Traceback",
  "undefined",
  "NoneType",
  "response_invalid",
  "invalid_request",
  "no_org_slug",
  "name_taken",
  "throttle",
];

async function noMachineryOn(page, where) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const found = BANNED.filter((b) => holds(text, b));
  /* `null` on its own is a word the product uses nowhere; as a substring it
     appears inside perfectly ordinary words, so it is matched as a token. */
  if (/\bnull\b/i.test(text)) found.push("null");
  if (/\bHTTP\b/.test(text)) found.push("HTTP");
  if (/\b[45]\d{2}\b/.test(text) && !/\b[45]\d{2}\s*(cameras?|days?|minutes?)/i.test(text)) {
    found.push("a status code");
  }
  if (found.length === 0) ok(`nothing written for a programmer on ${where}`);
  else bad(`machinery on ${where}`, found.join(", "));
}

const browser = await chromium.launch();

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 940 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("response", (r) => {
    if (r.url().includes("/v1/") && r.status() >= 400 && r.status() !== 401
        && r.status() !== 429) {
      problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  return { ctx, page, problems };
}

async function fillLogin(page, login, password) {
  const boxes = page.locator("input");
  await boxes.nth(0).fill(login);
  await boxes.nth(1).fill(password);
}

async function pressSignIn(page) {
  await page.getByRole("button", { name: /sign in|try again in/i }).first().click();
}

async function signIn(login, password = PASSWORD) {
  const who = await fresh();
  await fillLogin(who.page, login, password);
  await pressSignIn(who.page);
  await who.page.waitForTimeout(3500);
  who.login = login;
  return who;
}

/** Did this context get past the sign-in screen? */
async function signedIn(page) {
  return (await page.getByRole("button", { name: /sign in/i }).count()) === 0;
}

const shot = (page, name) =>
  page.screenshot({ path: join(OUT, `login-${name}.png`), fullPage: false });

async function openAdmin(page) {
  const item = page.getByRole("button", { name: /administration/i });
  if ((await item.count()) === 0) return false;
  await item.first().click();
  await page.waitForTimeout(1500);
  return true;
}

async function pane(page, label) {
  /* A ROLE OF `tab`, not `button`: the Administration area's sections are a
     real tablist, and `getByRole("button")` finds none of them. */
  await page.getByRole("tab", { name: new RegExp(label, "i") }).first().click();
  await page.waitForTimeout(1200);
}

/** A name nothing else in the demo has, so a re-run does not collide. */
const stamp = Date.now().toString(36).slice(-5);
const PROBE = `probe${stamp}`;
const PROBE2 = `lock${stamp}`;
const PROBE_PASSWORD = "a-stronger-one-than-this";
const PROBE_NEW_PASSWORD = "and-a-different-one-again";

// ===========================================================================
console.log("=== 1. the administrator adds a person ===");
const admin = await signIn(ORG);
is("the organization signs in", await signedIn(admin.page), true);
is("it has an Administration area", await openAdmin(admin.page), true);
await pane(admin.page, "People");
await noMachineryOn(admin.page, "the People screen");
{
  const page = admin.page;
  /* ⚠ THE LIST, BEFORE ANYTHING IS ADDED. The organization's own row is in
     it, it is not a person, and it used to print its login twice. */
  const list = await page.locator("[role=tabpanel]").innerText();
  const twice = new RegExp(`${ORG}\\b[^\\n]*\\b${ORG}\\b`, "i").test(list);
  is("the organization's own row does not print its login twice", twice, false);

  await page.getByRole("button", { name: /^add (a )?person/i }).first().click();
  await page.waitForTimeout(600);
  const boxes = page.locator("[role=tabpanel] input");
  await boxes.nth(0).fill(PROBE);
  await page.waitForTimeout(400);

  /* THE HINT. It promised `name.<organization>` -- angle brackets and all --
     because the page did not know the organization's login half. */
  const form = await page.locator("[role=tabpanel]").innerText();
  has("the hint says the real login they will type", form, `${PROBE}.${ORG}`);
  hasNot("and not a placeholder", form, "<organization>");
  await shot(page, "01-add-person-hint");

  await boxes.nth(1).fill(PROBE_PASSWORD);
  await page.getByRole("button", { name: /^add person|^add$/i }).last().click();
  await page.waitForTimeout(2500);
  await noMachineryOn(page, "the People screen after adding somebody");

  /* THE CONFIRMATION. This is where "not the documented shape" appeared, on a
     person who had in fact been created. */
  const after = await page.locator("[role=tabpanel]").innerText();
  has("it says they can sign in now", after, "can sign in now");
  has("and shows the whole login", after, `${PROBE}.${ORG}`);
  const copy = page.getByRole("button", { name: new RegExp(`copy the login`, "i") });
  is("with a button that copies it", await copy.count() > 0, true);
  await shot(page, "02-person-added");

  /* THE ROW. A person's name, and the login once. */
  const row = page.locator(`[data-login="${PROBE}.${ORG}"]`);
  is("the list shows the login beside the name", await row.count() > 0, true);
  const rowText = await page.locator("[role=tabpanel]").innerText();
  const dup = new RegExp(`${PROBE}\\.${ORG}[^\\n]*${PROBE}\\.${ORG}`, "i").test(rowText);
  is("and does not print it twice", dup, false);
}
is("no failed calls while adding a person", admin.problems.join(", "), "");

// ===========================================================================
console.log("=== 2. the three ways somebody types their organization ===");
for (const [label, typed] of [
  ["the slug, as issued", `${PROBE}.${ORG}`],
  ["the organization as it is written", `${PROBE}.${ORG_DISPLAY}`],
  ["the same, lower case, with the space", `${PROBE}.${ORG_DISPLAY.toLowerCase()}`],
]) {
  const who = await signIn(typed, PROBE_PASSWORD);
  is(`${label} (${typed}) signs in`, await signedIn(who.page), true);
  await noMachineryOn(who.page, `the board after ${typed}`);
  await who.ctx.close();
}

// ===========================================================================
console.log("=== 3. they change their own password, and sign in again ===");
{
  const who = await signIn(`${PROBE}.${ORG_DISPLAY}`, PROBE_PASSWORD);
  await who.page.getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Settings" }).click();
  await who.page.waitForTimeout(1500);
  /* The password form is in its own section, not on the Account page the
     Settings screen opens on. */
  await who.page.getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: /password/i }).first().click();
  await who.page.waitForTimeout(1200);
  /* The section opens with the form CLOSED -- a password box on a screen
     nobody came to change a password on is a password box somebody's manager
     fills in by accident -- so the first "Change password" is the disclosure
     and the last one is the submit. */
  await who.page.getByRole("button", { name: /^change password$/i }).first().click();
  await who.page.waitForTimeout(600);
  const boxes = who.page.locator("main input[type=password]");
  const n = await boxes.count();
  if (n < 2) {
    bad("the password form is on the Settings screen", `${n} password boxes`);
  } else {
    await boxes.nth(0).fill(PROBE_PASSWORD);
    await boxes.nth(1).fill(PROBE_NEW_PASSWORD);
    if (n > 2) await boxes.nth(2).fill(PROBE_NEW_PASSWORD);
    await who.page.getByRole("button", { name: /change password/i }).last().click();
    await who.page.waitForTimeout(3000);
    await noMachineryOn(who.page, "the Settings screen after a password change");
    await shot(who.page, "03-password-changed");
    ok("the password change went through without a programmer's sentence");
  }
  await who.ctx.close();

  const again = await signIn(`${PROBE}.${ORG}`, PROBE_NEW_PASSWORD);
  is("the new password works", await signedIn(again.page), true);
  await again.ctx.close();

  const old = await signIn(`${PROBE}.${ORG}`, PROBE_PASSWORD);
  is("and the old one does not", await signedIn(old.page), false);
  await old.ctx.close();
}

// ===========================================================================
console.log("=== 4. a wrong password says what to check, and names no field ===");
{
  /* A SECOND PERSON, so the lockout below belongs to somebody whose other
     spellings are not needed again. */
  const r = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: ORG, password: PASSWORD }),
  });
  const { session_ref: ref } = await r.json();
  const made = await fetch(`${API}/v1/admin/people`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${ref}` },
    body: JSON.stringify({ name: PROBE2, password: PROBE_PASSWORD, role: "site_user" }),
  });
  is("a second person exists to be locked out", made.status, 201);

  const who = await fresh();
  await fillLogin(who.page, `${PROBE2}.${ORG_DISPLAY}`, "not the password");
  await pressSignIn(who.page);
  await who.page.waitForTimeout(2000);
  const text = await who.page.locator("body").innerText();
  has("it says the two do not match", text, "do not match");
  has("and gives a real example of the shape", text, `name.${ORG}`);
  hasNot("not a placeholder", text, "<organization>");
  await noMachineryOn(who.page, "the sign-in screen after a wrong password");
  await shot(who.page, "04-wrong-password");
  await who.ctx.close();
}

// ===========================================================================
console.log("=== 5. the lockout, with a countdown that ticks ===");
let lockedPage = null;
{
  const who = await fresh();
  lockedPage = who;
  const login = `${PROBE2}.${ORG}`;
  /* One failure has already been spent above, on the SAME counter: the
     server folds the organization half, so `.Kallon Demo` and `.kallon-demo`
     are one login. That is the point, and it is asserted in the suite. */
  const locked = who.page.locator('[data-locked="true"]');
  for (let i = 0; i < CAP + 2 && (await locked.count()) === 0; i += 1) {
    await fillLogin(who.page, login, "not the password");
    /* ⚠ NEVER PRESS A DISABLED BUTTON. Playwright waits for it to become
       enabled, and a fifteen-second lock LIFTS while it waits -- so the loop
       spent the lock it was supposed to be observing, and the next attempt
       answered 401 with the lock gone. */
    const button = who.page.getByRole("button", { name: /sign in|try again in/i }).first();
    if (await button.isDisabled()) break;
    await button.click();
    await who.page.waitForTimeout(1200);
  }
  is("the screen says sign-in is paused", await locked.count() > 0, true);

  const panel = await who.page.locator("body").innerText();
  has("in plain words", panel, "for your security");
  has("and says nothing is wrong with the account", panel, "nothing is wrong");
  hasNot("it never says throttle", panel, "throttle");
  hasNot("and never shows the status code", panel, "429");
  await noMachineryOn(who.page, "the sign-in screen while locked");
  await shot(who.page, "05-locked");

  const countdown = who.page.locator('[data-countdown="true"]');
  const first = (await countdown.innerText()).trim();
  is("the countdown is mm:ss", /^\d+:\d{2}$/.test(first), true);
  hasNot("and not raw seconds", first, "second");

  const button = who.page.getByRole("button", { name: /try again in/i });
  is("the button says when, not that it is disabled", await button.count() > 0, true);
  is("and it is disabled", await button.first().isDisabled(), true);

  await who.page.waitForTimeout(2200);
  const second = (await countdown.innerText()).trim();
  is("it ticks", second !== first, true);
  console.log(`       ${first} -> ${second}`);
}

// ===========================================================================
console.log("=== 6. a refresh mid-lockout still knows how long is left ===");
{
  const who = lockedPage;
  const before = Number((await who.page.locator('[data-countdown="true"]').innerText())
    .trim().split(":").pop());
  await who.page.reload({ waitUntil: "domcontentloaded" });
  await who.page.waitForTimeout(800);
  /* The deadline is remembered against the login, so typing it is what brings
     the countdown back -- which is also what the person does. */
  await who.page.locator("input").nth(0).fill(`${PROBE2}.${ORG}`);
  await who.page.waitForTimeout(600);
  const back = who.page.locator('[data-countdown="true"]');
  is("the countdown is back after a reload", await back.count() > 0, true);
  if (await back.count() > 0) {
    const left = (await back.innerText()).trim();
    const secs = Number(left.split(":").pop());
    is("and it is the time that is actually left, not the time it started with",
       secs <= before && secs >= 0, true);
    console.log(`       ${left} left after the reload`);
    const button = who.page.getByRole("button", { name: /try again in/i });
    is("the button is still disabled", await button.first().isDisabled(), true);
  }
  await shot(who.page, "06-after-reload");
}

// ===========================================================================
console.log("=== 7. one person's lockout is not everybody's ===");
{
  /* THE PRODUCTION LOCKOUT. Same browser, same address, different login. */
  const other = await signIn(ORG);
  is("the administrator still signs in", await signedIn(other.page), true);
  await other.ctx.close();
  const third = await signIn(`${PROBE}.${ORG}`, PROBE_NEW_PASSWORD);
  is("and so does a colleague", await signedIn(third.page), true);
  await third.ctx.close();
}

// ===========================================================================
console.log("=== 8. it ends by itself, with no reload ===");
{
  const who = lockedPage;
  const countdown = who.page.locator('[data-countdown="true"]');
  const deadline = Date.now() + (LOCK_SEC + 8) * 1000;
  while (Date.now() < deadline && (await countdown.count()) > 0) {
    await who.page.waitForTimeout(1000);
  }
  is("the message cleared itself", await countdown.count(), 0);
  const button = who.page.getByRole("button", { name: /sign in/i });
  is("the button says SIGN IN again", await button.count() > 0, true);
  is("and is pressable once a password is typed",
     await (async () => {
       await fillLogin(who.page, `${PROBE2}.${ORG}`, PROBE_PASSWORD);
       await who.page.waitForTimeout(300);
       return !(await button.first().isDisabled());
     })(), true);
  await shot(who.page, "07-lock-lifted");

  await pressSignIn(who.page);
  await who.page.waitForTimeout(3500);
  is("and the right password now works", await signedIn(who.page), true);
  await who.ctx.close();
}

// ===========================================================================
console.log("=== 9. the administrator can see every refusal in the ledger ===");
{
  const page = admin.page;
  await openAdmin(page);
  await pane(page, "Audit log");
  await page.waitForTimeout(1500);
  const log = await page.locator("[role=tabpanel]").innerText();
  has("the failed sign-ins are there", log, "login.failure");
  has("and the moment it locked", log, "login.locked");
  await shot(page, "08-audit");
  /* ⚠ AND NOT THE PASSWORD. The typed string is never recorded, because a
     wrong guess at a login is very often a password in the wrong box. */
  hasNot("no password in the ledger", log, "not the password");
  hasNot("nor the real one", log, PROBE_PASSWORD);
}
is("no failed calls in the admin's whole session", admin.problems.join(", "), "");
await admin.ctx.close();

await browser.close();
console.log("");
console.log(`  ${passes} checks passed, ${failures} failed`);
if (failures > 0) {
  console.log("FAILED: see above");
  process.exit(1);
}
console.log("PASS: adding a person, signing in three ways, and a lockout you can wait out");
