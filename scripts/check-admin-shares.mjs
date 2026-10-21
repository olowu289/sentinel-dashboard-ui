// Three browsers: the administrator, the site that owns the cameras, and the
// site that gets to see them.
//
// ══════════════════════════════════════════════════════════════════════════
//  WHAT THIS CHECKS THAT NOTHING ELSE CAN
// ══════════════════════════════════════════════════════════════════════════
//
// An admin share has three points of view and they have to agree:
//
//   the ADMIN picks both sites and the terms;
//   the VIEWING site gets a card it can accept or decline, marked as the
//     administrator's, with no other choices;
//   the OWNING site is TOLD, and can do nothing about it.
//
// The last one is the whole reason this exists as its own flow. The old
// behaviour -- an admin requesting "on behalf of" a site -- put a card in
// front of the owning site reading "the other site is asking for yours" about
// a request that site had never made, and the admin could not answer it
// either, so it sat there until it expired. Nothing short of three real
// sessions shows that.
//
// It also checks the two smaller ones from the same session: that only the
// SHARED camera appears on the receiving site's screens, and that a site with
// no cameras is not offered as one to ask.
//
// ⚠ NOT PIXELS. The demo's cells are sim hubs: a real uplink, a real
// inventory, no cameras. What is proved is which cameras are LISTED and who
// may do what about a share.
//
//   node scripts/check-admin-shares.mjs [outdir]

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const APP = process.env.DEMO_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? ".";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password";
const ORG = process.env.DEMO_ORG ?? "kallon-demo";
await mkdir(OUT, { recursive: true });

/** North Camp's own mast, two cameras, at North Gate. */
const MAST_NAME = "North Camp Mast";
const MAST = "kln_north_000003";

let failures = 0;
let passes = 0;
const ok = (what) => { passes += 1; console.log(`  ok   ${what}`); };
const bad = (what, detail) => {
  failures += 1;
  console.log(`  FAIL ${what}${detail ? `: ${detail}` : ""}`);
};
const is = (what, got, want) =>
  got === want ? ok(what) : bad(what, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
/* ⚠ CASE-INSENSITIVE, because `innerText` returns what CSS RENDERS. The
   administrator badge is `uppercase` in the stylesheet, so the DOM says "By
   the administrator" and the browser hands back "BY THE ADMINISTRATOR". A
   test that matched the source would fail on a styling choice. */
const holds = (text, needle) =>
  (text ?? "").toLowerCase().includes(needle.toLowerCase());
const has = (what, text, needle) =>
  holds(text, needle) ? ok(what) : bad(what, `no ${JSON.stringify(needle)} in: ${(text ?? "").slice(0, 300)}`);
const hasNot = (what, text, needle) =>
  !holds(text, needle) ? ok(what) : bad(what, `unexpected ${JSON.stringify(needle)}`);

/**
 * The cameras one person is SHOWN for one device, read from coordination.
 *
 * Through the API rather than through the page, for the reason above, and as
 * that person rather than as the admin: what is listed is the whole question.
 */
const API = process.env.VITE_COORDINATION_URL ?? "http://127.0.0.1:9099";
async function fleetCameras(login, device) {
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
  const d = await r.json();
  const t = (d.towers ?? []).find((x) => x.device_id === device);
  return t ? (t.cameras ?? []).map((c) => c.index).sort() : null;
}

const browser = await chromium.launch();

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

const shot = (who, name) =>
  who.page.screenshot({ path: join(OUT, `as-${name}.png`), fullPage: false });

/** The row for one share, found by something only it says. */
const rowSaying = (who, text) => who.page.locator("li").filter({ hasText: text });

const WHY = "Contractors at the north gate this week (browser check).";

// ===========================================================================
const admin = await signIn(ORG);                 // the organization IS the admin
const ada = await signIn(`ada.${ORG}`);          // North Gate: owns the cameras
const dele = await signIn(`dele.${ORG}`);        // West Yard: gets to see them

console.log("=== 1. the administrator has ONE share form, not a site's two ===");
await openSharing(admin);
{
  const page = admin.page;
  const tabs = await page.locator("main").innerText();
  has("there is a Share cameras section", tabs, "Share cameras");
  hasNot("and no New request", tabs, "New request");
  hasNot("and no Share a feed", tabs, "Share a feed");
  await shot(admin, "01-admin-sections");
}

console.log("=== 2. the admin picks both sites, the cameras and the terms ===");
await section(admin, "Share cameras");
{
  const page = admin.page;
  const selects = page.locator("select");
  await selects.nth(0).selectOption({ label: "North Gate" });
  await page.waitForTimeout(900);
  await selects.nth(1).selectOption({ label: "West Yard" });
  await page.waitForTimeout(700);

  const share = page.getByRole("button", { name: /^(Share|Choose)/ }).last();
  is("it will not go out with no cameras chosen", await share.isDisabled(), true);

  // ONE CAMERA OF A TWO-CAMERA MAST, which is what item 1 is about. Picking
  // the tower selects all of it; the per-camera chips appear underneath and
  // turning one off is what narrows the scope.
  await page.getByRole("button", { name: MAST_NAME, exact: true }).click();
  await page.waitForTimeout(500);
  const cam2 = page.getByRole("button", { name: "Cam 2", exact: true });
  await cam2.waitFor({ state: "visible", timeout: 10000 });
  await cam2.click();
  await page.waitForTimeout(400);
  is("the tower now says one of its two cameras",
     (await page.locator("main").innerText()).includes("1 of 2"), true);
  await page.getByRole("switch", { name: "Controls" }).first().click()
    .catch(() => {});
  await page.getByRole("radio", { name: "1 hour", exact: true }).click();
  await page.locator("textarea").first().fill(WHY);
  await page.waitForTimeout(400);
  is("and with all of it, it can", await share.isDisabled(), false);
  await shot(admin, "02-admin-share-form");
  await share.click();
  await page.waitForTimeout(2500);
  const after = await page.locator("main").innerText();
  has("it says who answers and who was told", after, "accept or decline");
  await shot(admin, "03-admin-shared");
}

console.log("=== 3. the VIEWING site is asked ===");
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "Incoming");
  const row = rowSaying(dele, WHY);
  await row.first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  const body = await page.locator("main").innerText();
  has("the share is waiting for them", body, "North Gate");
  has("and it is marked as the administrator's", body, "By the administrator");
  hasNot("it does not claim the other site offered it", body, "is offering you");
  await shot(dele, "04-viewing-site-card");

  const see = page.getByRole("button", { name: /^See what is offered/ }).first();
  is("it shows the terms rather than a form", await see.isVisible(), true);
  await see.click();
  await page.waitForTimeout(1200);
  const terms = await page.locator("main").innerText();
  has("the terms name the camera", terms, MAST);
  has("and how long for", terms, "1 hour");
  hasNot("there is nothing to choose", terms, "For how long");
  await shot(dele, "05-viewing-site-terms");
}

console.log("=== 4. the OWNING site is told, and can do nothing about it ===");
{
  const page = ada.page;
  await openSharing(ada);
  await section(ada, "Outgoing");
  await page.waitForTimeout(2000);
  const body = await page.locator("main").innerText();
  has("the owning site can see it", body, "West Yard");
  has("and that the administrator did it", body, "By the administrator");
  // ⚠ NO BUTTONS. It never agreed, so it has nothing to withdraw.
  const row = rowSaying(ada, "By the administrator").first();
  for (const label of [/^Accept/, /^Decline/, /^Withdraw/, /^End now/]) {
    const n = await row.getByRole("button", { name: label }).count();
    is(`no ${label.source} button for the owning site`, n, 0);
  }
  await shot(ada, "06-owning-site-told");
}

console.log("=== 5. the viewing site accepts, and sees ONLY the shared camera ===");
{
  const page = dele.page;
  await page.getByRole("button", { name: /^Accept$/ }).first().click();
  await page.waitForTimeout(3000);
  hasNot("accepting was not refused", await page.locator("main").innerText(),
    "did not go through");

  /* ⚠ READ FROM THE API, NOT FROM THE PAGE'S OWN ORIGIN. A relative
     `fetch("/v1/viewer/towers")` inside the page goes to the dev server on
     5173, which answers with index.html for anything it does not recognise --
     so the check "succeeded" against a lump of HTML. The dashboard itself
     uses VITE_COORDINATION_URL; so does this. */
  const cams = await fleetCameras(`dele.${ORG}`, MAST);
  if (Array.isArray(cams)) {
    is("only the shared camera is listed", cams.join(","), "1");
  } else {
    bad("could not read the borrowed fleet", String(cams));
  }
  await shot(dele, "07-accepted");
}

console.log("=== 6. both sites can see it, and the admin sees every share ===");
{
  /* ⚠ "HISTORY" IS WHAT HAS ENDED. A live share is in Active, and asserting
     it in History while it is still running was this test misreading its own
     product. Both are checked: here while it runs, and below once the admin
     ends it. */
  await openSharing(ada);
  await section(ada, "Active");
  /* ⚠ WAIT FOR THE ROW, NOT FOR A GUESS. The share feed polls every twenty
     seconds, so ada's copy can still say "pending" for a while after dele
     accepted; a fixed pause made this flap. */
  await rowSaying(ada, WHY).first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {});
  const owner = await ada.page.locator("main").innerText();
  has("the owning site sees it running", owner, "By the administrator");
  has("and who has it", owner, "West Yard");

  await openSharing(dele);
  await section(dele, "Active");
  await rowSaying(dele, WHY).first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {});
  const viewer = await dele.page.locator("main").innerText();
  has("the viewing site sees it running", viewer, "North Gate");
  has("marked as the administrator's there too", viewer, "By the administrator");

  await openSharing(admin);
  await section(admin, "All shares");
  await admin.page.waitForTimeout(1500);
  const all = await admin.page.locator("main").innerText();
  has("and the admin sees it among every share", all, "By the administrator");
  await shot(admin, "08-all-shares");
}

console.log("=== 6b. the admin ends it, and it is in both histories ===");
{
  const page = admin.page;
  await section(admin, "Active");
  await page.waitForTimeout(1200);
  const row = rowSaying(admin, WHY).first();
  await row.waitFor({ state: "visible", timeout: 20000 });
  await row.getByRole("button", { name: /^End now/ }).click();
  await page.waitForTimeout(3000);

  for (const [who, label] of [[ada, "owning"], [dele, "viewing"]]) {
    await openSharing(who);
    await section(who, "History");
    /* ⚠ WAIT FOR THE ROW. The share feed polls every twenty seconds, so a
       site's copy can still call the share live for a while after the admin
       ended it. A fixed pause passed for whoever was checked second and
       failed for whoever was checked first, which is the shape of a race
       rather than a fault. */
    await rowSaying(who, WHY.slice(0, 24)).first()
      .waitFor({ state: "visible", timeout: 40000 })
      .catch(() => {});
    const body = await who.page.locator("main").innerText();
    has(`the ${label} site's history has it`, body, WHY.slice(0, 24));
    has(`and says the administrator made it (${label})`, body,
        "By the administrator");
  }
  await shot(ada, "09-owner-history");
}

console.log("=== 7. a site with no cameras is not somebody to ask ===");
{
  const page = dele.page;
  await openSharing(dele);
  await section(dele, "New request");
  await page.waitForTimeout(1200);
  const options = await page.locator("select").first()
    .locator("option").allTextContents();
  const named = options.join(" | ");
  has("a site with cameras is offered", named, "North Gate");
  hasNot("a site with none is not", named, "East Ridge");
  await shot(dele, "09-nothing-to-ask-an-empty-site");
}

console.log("=== 8. Accept stays off until something is chosen ===");
{
  // dele asks North Gate; ada opens it with nothing picked.
  const page = dele.page;
  await page.locator("select").first().selectOption({ label: "North Gate" });
  await page.locator("textarea").first()
    .fill("Nothing chosen yet (browser check).");
  await page.getByRole("radio", { name: "1 hour", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^(Request|Ask|Send)/ }).first().click();
  await page.waitForTimeout(2500);

  await openSharing(ada);
  await section(ada, "Incoming");
  const row = rowSaying(ada, "Nothing chosen yet").first();
  await row.waitFor({ state: "visible", timeout: 30000 });
  await row.getByRole("button", { name: /^Choose and accept/ }).click();
  await ada.page.waitForTimeout(1500);
  const accept = row.getByRole("button", { name: /^(Accept|Choose)/ }).last();
  is("Accept is off with nothing chosen", await accept.isDisabled(), true);
  has("and it says what is missing", await accept.innerText(), "Choose towers");
  await shot(ada, "10-accept-disabled");

  // ⚠ AND THE RAW VALIDATOR TEXT IS NOT REACHABLE FROM HERE ANY MORE.
  const body = await ada.page.locator("main").innerText();
  hasNot("no field name on screen", body, "scope:");
  hasNot("and no schema words", body, "non-empty list");
}

console.log("");
for (const who of [admin, ada, dele]) {
  const real = who.errors.filter(
    (e) => !e.startsWith("401") && !e.includes("/v1/auth/login"),
  );
  if (real.length) bad(`${who.login} saw failed API calls`, real.join(", "));
  else ok(`${who.login} saw no failed API call`);
}

await browser.close();
console.log("");
if (failures === 0) {
  console.log(`PASS: ${passes} checks OK`);
} else {
  console.log(`FAILED: ${failures} of ${passes + failures} checks`);
  process.exitCode = 1;
}
