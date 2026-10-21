// Two browsers, one share, and the camera that was "not on your fleet any more".
//
// ══════════════════════════════════════════════════════════════════════════
//  WHAT THIS CHECKS THAT NOTHING ELSE CAN
// ══════════════════════════════════════════════════════════════════════════
//
// The field failure was entirely a matter of TIMING AND TWO SESSIONS. One
// person requests, ANOTHER accepts, and the first one presses Watch. Nothing
// about that is visible to a component test, to a screenshot of a fixture, or
// to a server test: the server was right the whole time. What was wrong was
// that the borrower's browser had read the fleet before the share existed and
// never read it again, so the drill-in looked the tower up in a stale list and
// said "this tower is not on your fleet any more" about access just granted.
//
// So this drives two real browsers against the running demo, whose store is
// now shaped like the lab: hub records, hub inventories, and NO `towers` rows
// on the data centre at all. The devices include two HUB MASTS (cameras cabled
// to a hub, with no registry row anywhere) and four towers behind hubs, which
// is the shape every fixture used to get wrong.
//
// ── WHAT IT DOES NOT CHECK ────────────────────────────────────────────────
//
// ⚠ PIXELS. The demo's cells are sim hubs: they hold a real uplink and
// report a real inventory, and they have no cameras, so they refuse media
// honestly (`forward.result status=error`). What is proved here is that
// pressing Watch REACHES THE SHARED FEED -- the tower view opens for the right
// device and the "unavailable" screen does not appear. Whether SRT then
// arrives is a question for a hub with cameras on it.
//
//   node scripts/check-real-fleet-sharing.mjs [outdir]

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/* ⚠ NOT CALLED `URL`. That shadows the global `URL`, and the response
   handler below uses it to shorten a path. */
const APP = process.env.DEMO_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? ".";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password";
await mkdir(OUT, { recursive: true });

/** The hub's OWN mast at North Camp: two cameras cabled to the hub, no record. */
const MAST = "kln_north_000003";
/** A tower that enrolled with that hub and is reachable only through it. */
const BEHIND = "kln_north_000002";

/* ⚠ AND THE NAMES, because that is what is on screen. A fleet that parses
   carries each device's LABEL, and the picker lists "North Camp Mast", not
   `kln_north_000003` -- which is the right way round for a person and the
   wrong way round for a test that only knows ids. Both are kept: the name is
   what gets clicked, the id is what the "unavailable" screen would print. */
const MAST_NAME = "North Camp Mast";
const BEHIND_NAME = "North Fence";

/* The messages this test writes, so its own rows can be told from the
   demo store's seeded ones. */
const ASKED_FOR_TEN = "Ten minutes on the mast, this is the browser check.";
const ASKED_FOR_A_DAY = "All day tomorrow, if you can spare it (browser check).";

let failures = 0;
let passes = 0;
const ok = (what) => { passes += 1; console.log(`  ok   ${what}`); };
const bad = (what, detail) => {
  failures += 1;
  console.log(`  FAIL ${what}${detail ? `: ${detail}` : ""}`);
};
const is = (what, got, want) =>
  got === want ? ok(what) : bad(what, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
const has = (what, text, needle) =>
  (text ?? "").includes(needle) ? ok(what) : bad(what, `no ${JSON.stringify(needle)} in: ${(text ?? "").slice(0, 300)}`);
const hasNot = (what, text, needle) =>
  !(text ?? "").includes(needle) ? ok(what) : bad(what, `unexpected ${JSON.stringify(needle)}`);

/** Every device one person is shown, read from coordination as that person. */
const API = process.env.VITE_COORDINATION_URL ?? "http://127.0.0.1:9099";
async function fleetDevices(login) {
  const auth = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password: PASSWORD }),
  });
  if (!auth.ok) return `login ${auth.status}`;
  const { session_ref: ref } = await auth.json();
  const r = await fetch(`${API}/v1/viewer/towers`, {
    headers: { Authorization: `Bearer ${ref}` },
  });
  if (!r.ok) return `fleet ${r.status}`;
  return ((await r.json()).towers ?? []).map((t) => t.device_id);
}

const browser = await chromium.launch();

/** A signed-in browser for one person, watching for failed API calls. */
async function signIn(login) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 940 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("response", (r) => {
    if (r.url().includes("/v1/") && r.status() >= 400) {
      errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  const boxes = page.locator("input");
  await boxes.nth(0).fill(login);
  await boxes.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|continue|log ?in/i }).first().click();
  await page.waitForTimeout(3500);
  return { ctx, page, errors, login };
}

async function openSharing(who) {
  await who.page.getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Settings" }).click();
  await who.page.waitForTimeout(700);
  await who.page.getByRole("link", { name: "Sharing" }).first().click();
  await who.page.waitForTimeout(1800);
}

async function section(who, name) {
  await who.page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await who.page.waitForTimeout(900);
}

/**
 * The row for OUR share, by the message we wrote in it.
 *
 * ⚠ NOT `.first()`. The demo store is seeded with a pending request of its
 * own, so "the first Incoming row" is somebody else's and the test spent a
 * while asserting things about it. A share is identified by what was said in
 * it, which is the only thing on screen that is ours.
 */
const rowSaying = (who, text) => who.page.locator("li").filter({ hasText: text });

const shot = (who, name) =>
  who.page.screenshot({ path: join(OUT, `rf-${name}.png`), fullPage: false });

// ===========================================================================
// dele is at West Yard, which has one mast of its own.
// ada is at North Gate, which has the hub mast and two towers behind it.
// ===========================================================================
/* ⚠ `name.organization`, NOT A BARE NAME. A person's login carries the
   organization's slug; only the organization itself signs in with a bare
   name, matched byte for byte. `dele` alone is a 401. */
const ORG = process.env.DEMO_ORG ?? "kallon-demo";
const dele = await signIn(`dele.${ORG}`);
const ada = await signIn(`ada.${ORG}`);

console.log("=== 0. the borrower's fleet, before any share ===");
{
  /* ⚠ READ FROM THE API, NOT FROM INSIDE THE PAGE. This used to be a
     relative `fetch("/v1/viewer/towers")` run in the page, which goes to the
     dev server on 5173 -- and that answers index.html for anything it does
     not recognise, so the JSON parse threw, the catch swallowed it, and the
     check printed "could not read the fleet" and carried on. A check that
     reports its own failure as a shrug is not a check. */
  const ids = await fleetDevices(`dele.${ORG}`);
  if (Array.isArray(ids)) {
    hasNot("West Yard cannot see North Gate's hub mast", ids.join(","), MAST);
  } else {
    bad("could not read the borrower's fleet", String(ids));
  }
}

// ===========================================================================
// 1. A REQUEST, WITH A TYPED DURATION
// ===========================================================================
console.log("=== 1. dele asks North Gate, for ten minutes ===");
await openSharing(dele);
await section(dele, "New request");
{
  const page = dele.page;
  // Pick North Gate in the "Ask" selector.
  const asks = page.locator("select");
  await asks.first().selectOption({ label: "North Gate" }).catch(async () => {
    await asks.first().selectOption({ index: 1 });
  });
  await page.locator("textarea").first().fill(ASKED_FOR_TEN);
  await page.waitForTimeout(300);

  // ⚠ NOTHING CHOSEN YET. The length used to be pre-filled at fifteen
  // minutes, so every untouched share went out at a length nobody decided on.
  const send = page.getByRole("button", { name: /^(Request|Ask|Send)/ }).first();
  is("the Request button is off until a length is chosen", await send.isDisabled(), true);

  // The CUSTOM field: ten minutes, which none of the four buttons offers.
  await page.getByLabel("How long, a number").fill("10");
  await page.getByLabel("Minutes or hours").selectOption("minutes");
  await page.waitForTimeout(400);
  const body = await page.locator("main").innerText();
  has("a typed length is said back in words", body, "10 minutes");
  is("and the button comes on", await send.isDisabled(), false);

  await shot(dele, "01-request-custom-duration");
  await send.click();
  await page.waitForTimeout(2500);
  has("it says where the request went", await page.locator("main").innerText(), "Outgoing");
}

// ===========================================================================
// 2. THE OWNER ANSWERS IT, STARTING FROM WHAT WAS ASKED
// ===========================================================================
console.log("=== 2. ada answers, and gives longer than was asked ===");
await openSharing(ada);
await section(ada, "Incoming");
{
  const page = ada.page;
  await page.waitForTimeout(2500);
  const row = rowSaying(ada, ASKED_FOR_TEN);
  await row.first().waitFor({ state: "visible", timeout: 30000 });
  const body = await row.first().innerText();
  has("the request is there", body, "West Yard");
  has("with what they said", body, "Ten minutes on the mast");

  await row.first().getByRole("button", { name: /^Choose and accept/ }).click();
  await row.first().getByRole("button", { name: MAST_NAME, exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  const open = await rowSaying(ada, ASKED_FOR_TEN).first().innerText();
  // ⚠ THE PANEL OPENS ON THE ASKED LENGTH. It opened on a default, so the
  // owner's untouched answer silently replaced the question.
  has("it says what was asked for", open, "They asked for 10 minutes");
  // AND THE TOWERS ARE THE OWNER'S OWN, which they can see.
  has("the hub's own mast is offerable", open, MAST_NAME);
  has("so is the tower behind the hub", open, BEHIND_NAME);
  hasNot("and nothing says no such site", open, "no such site");
  hasNot("nor that they named no towers", open, "They named no towers");
  await shot(ada, "02-owner-answers-request");

  // Lend the HUB MAST, for four hours, which is MORE than was asked.
  const mine = rowSaying(ada, ASKED_FOR_TEN).first();
  /* ⚠ A BUTTON WITH aria-pressed, NOT A CHECKBOX, and labelled by the
     tower's NAME. See TowerPicker: the row is a pressable button so the whole
     line is the target, which is what a finger needs. */
  await mine.getByRole("button", { name: MAST_NAME, exact: true }).click();
  await page.waitForTimeout(300);
  await mine.getByRole("radio", { name: "4 hours", exact: true }).click();
  await page.waitForTimeout(300);
  await mine.getByRole("button", { name: /^Accept$/ }).click();
  await page.waitForTimeout(2500);
  const after = await page.locator("main").innerText();
  hasNot("the accept was not refused", after, "did not go through");
  await shot(ada, "03-accepted");
}

// ===========================================================================
// 3. THE PRESS THAT FAILED IN THE FIELD
// ===========================================================================
console.log("=== 3. dele presses Watch on the hub mast ===");
{
  const page = dele.page;
  // The card arrives on the share feed's poll. It is actionable, so it lives
  // for 45 seconds rather than nine.
  const watch = page.getByRole("button", { name: /^Watch now/ }).first();
  await watch.waitFor({ state: "visible", timeout: 40000 }).catch(() => {});
  if (await watch.isVisible().catch(() => false)) {
    ok("the accepted card offers Watch now");
    await shot(dele, "04-accepted-card");
    await watch.click();
  } else {
    bad("the accepted card never offered Watch now");
    // Fall back to the Sharing page, which is the other way in.
    await openSharing(dele);
    await section(dele, "Active");
    await page.getByRole("button", { name: /^Watch/ }).first().click();
  }
  await page.waitForTimeout(4000);
  const feed = await page.locator("body").innerText();
  // ⚠ THE WHOLE BUG, IN ONE ASSERTION.
  hasNot("it does NOT say the tower is unavailable", feed, "IS UNAVAILABLE");
  hasNot("nor that it is not on the fleet any more", feed, "not on your fleet any more");
  has("the shared device is on screen", feed, MAST_NAME);
  await shot(dele, "05-watching-the-shared-mast");
}

// ===========================================================================
// 4. LEAVING, AND GOING BACK IN FROM ACTIVE
// ===========================================================================
console.log("=== 4. dele leaves and re-opens from Sharing > Active ===");
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "Active");
  const body = await page.locator("main").innerText();
  has("the share is listed as active", body, "North Gate");
  has("with the time left on it", body, "left");
  const watch = page.getByRole("button", { name: /^Watch/ }).first();
  is("and there is a way back in", await watch.isVisible(), true);
  has("whose label carries the time left", await watch.innerText(), "left");
  await shot(dele, "06-active-has-watch");
  await watch.click();
  await page.waitForTimeout(4000);
  const feed = await page.locator("body").innerText();
  hasNot("re-opening does not say unavailable", feed, "IS UNAVAILABLE");
  has("and lands on the shared device", feed, MAST_NAME);
  await shot(dele, "07-reopened-from-active");
}

// ===========================================================================
// 5. AN OFFER: THE RECEIVER ONLY ANSWERS
// ===========================================================================
console.log("=== 5. ada offers the tower behind the hub, and dele accepts ===");
await openSharing(ada);
await section(ada, "Share a feed");
{
  const page = ada.page;
  await page.waitForTimeout(1200);
  const sel = page.locator("select");
  await sel.first().selectOption({ label: "West Yard" }).catch(async () => {
    await sel.first().selectOption({ index: 1 });
  });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: BEHIND_NAME, exact: true }).first().click();
  await page.waitForTimeout(300);
  const offer = page.getByRole("button", { name: /^Offer/ }).first();
  is("an offer with no length cannot be sent either", await offer.isDisabled(), true);
  await page.getByRole("radio", { name: "1 hour", exact: true }).first().click();
  await page.waitForTimeout(300);
  is("and with one it can", await offer.isDisabled(), false);
  await shot(ada, "08-offer-composed");
  await offer.click();
  await page.waitForTimeout(2500);
}
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "Incoming");
  await page.waitForTimeout(2500);
  const body = await page.locator("main").innerText();
  has("the offer is there", body, "North Gate");
  const see = page.getByRole("button", { name: /^See what is offered/ }).first();
  is("it offers to show the terms, not a form", await see.isVisible(), true);
  await see.click();
  await page.waitForTimeout(1200);
  const terms = await page.locator("main").innerText();
  // ⚠ THE THREE CONTRADICTORY SENTENCES, GONE.
  has("the terms name the camera", terms, BEHIND);   // an offer card prints the id
  has("and how long for", terms, "1 hour");
  hasNot("nothing says no such site", terms, "no such site");
  hasNot("nothing says they named no towers", terms, "They named no towers");
  hasNot("and there is no length to pick", terms, "For how long");
  await shot(dele, "09-offer-terms-read-only");

  await page.getByRole("button", { name: /^Accept$/ }).first().click();
  await page.waitForTimeout(3000);
  hasNot("accepting an offer is not refused", await page.locator("main").innerText(),
    "did not go through");
  await shot(dele, "10-offer-accepted");
}

console.log("=== 6. and the tower BEHIND the hub is watchable too ===");
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "Active");
  await page.waitForTimeout(1500);
  const rows = page.getByRole("button", { name: /^Watch/ });
  const n = await rows.count();
  is("both live shares offer a way in", n >= 2, true);
  // The newest row is the offer, which is the tower behind the hub.
  let landed = false;
  for (let i = 0; i < n; i += 1) {
    await rows.nth(i).click();
    await page.waitForTimeout(3500);
    const feed = await page.locator("body").innerText();
    hasNot("no row leads to an unavailable screen", feed, "IS UNAVAILABLE");
    if (feed.includes(BEHIND_NAME) || feed.includes(BEHIND)) landed = true;
    await openSharing(dele);
    await section(dele, "Active");
    await page.waitForTimeout(1200);
  }
  is("one of them lands on the tower behind the hub", landed, true);
  await shot(dele, "11-behind-the-hub-watched");
}

// ===========================================================================
// 7. THE OWNER GIVING LESS THAN WAS ASKED
// ===========================================================================
console.log("=== 7. a second request, answered with LESS than was asked ===");
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "New request");
  const asks = page.locator("select");
  await asks.first().selectOption({ label: "North Gate" }).catch(async () => {
    await asks.first().selectOption({ index: 1 });
  });
  await page.locator("textarea").first().fill(ASKED_FOR_A_DAY);
  await page.getByRole("radio", { name: "24 hours", exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^(Request|Ask|Send)/ }).first().click();
  await page.waitForTimeout(2500);
}
{
  const page = ada.page;
  await openSharing(ada);
  await section(ada, "Incoming");
  await page.waitForTimeout(2500);
  const day = rowSaying(ada, ASKED_FOR_A_DAY).first();
  await day.waitFor({ state: "visible", timeout: 30000 });
  await day.getByRole("button", { name: /^Choose and accept/ }).click();
  // WAIT FOR THE PANEL, not for a guess at how long it takes to open. The
  // row animates its height, and a fixed pause read the collapsed text.
  await day.getByRole("button", { name: MAST_NAME, exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
  const open = await day.innerText();
  // ⚠ IN THE BUTTON'S OWN WORDS. It read "They asked for 1 day" before
  // `sayDuration` existed, which is the same length said two ways.
  has("it opens on the twenty-four hours they asked for", open, "They asked for 24 hours");
  await day.getByRole("button", { name: MAST_NAME, exact: true }).click();
  // LESS than was asked: fifteen minutes.
  await day.getByRole("radio", { name: "15 min", exact: true }).click();
  await page.waitForTimeout(300);
  await shot(ada, "12-giving-less-than-asked");
  await day.getByRole("button", { name: /^Accept$/ }).click();
  await page.waitForTimeout(2500);
  hasNot("giving less is allowed", await page.locator("main").innerText(), "did not go through");

  // ⚠ AND A LENGTH UNDER THE FLOOR IS REFUSED WHERE IT IS TYPED.
  await section(ada, "Active");
  await page.waitForTimeout(1200);
  ok("the owner's answer stands");
}

// ===========================================================================
// 8. the bounds, said under the field
// ===========================================================================
console.log("=== 8. two minutes is refused where somebody typed it ===");
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "New request");
  await page.getByLabel("How long, a number").fill("2");
  await page.getByLabel("Minutes or hours").selectOption("minutes");
  await page.waitForTimeout(500);
  const body = await page.locator("main").innerText();
  has("it names the floor", body, "at least 5 minutes");
  has("and says why there is one", body, "still connecting");
  await page.getByLabel("How long, a number").fill("2000");
  await page.getByLabel("Minutes or hours").selectOption("hours");
  await page.waitForTimeout(500);
  const over = await page.locator("main").innerText();
  has("and the ceiling", over, "at most 30 days");
  has("with what to do instead", over, "Administration");
  await shot(dele, "13-duration-bounds");
}

console.log("");
for (const who of [dele, ada]) {
  const real = who.errors.filter(
    (e) => !e.startsWith("401") && !e.includes("/v1/auth/login"),
  );
  if (real.length) {
    bad(`${who.login} saw failed API calls`, real.join(", "));
  } else {
    ok(`${who.login} saw no failed API call`);
  }
}

await browser.close();
console.log("");
if (failures === 0) {
  console.log(`PASS: ${passes} checks OK`);
} else {
  console.log(`FAILED: ${failures} of ${passes + failures} checks`);
  process.exitCode = 1;
}
