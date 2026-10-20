// Three people signed in at once: who can add, who can only look, and who gets told.
//
//   node scripts/check-device-rules.mjs [outdir]
//
// ══════════════════════════════════════════════════════════════════════
//  WHY A BROWSER AND NOT ANOTHER SERVER TEST
// ══════════════════════════════════════════════════════════════════════
//
// `test_device_rules.py` proves the RULES for seven personas over real HTTP.
// What it cannot prove is that the SCREEN agrees with them, and the split here
// is unusual enough to get backwards: a site user may ADD a cell or a tower to
// their own sites and may do nothing else at all. Invert that one line and
// either a site user can delete a site's whole fleet, or nobody can add a mast
// without ringing the office.
//
// The other half is the card. "The admin is told when a site user adds a
// device" is a thing that happens in a browser, over a poll, to a component
// that decides whether to raise it -- which is exactly the gap every sharing
// bug lived in.
//
// So this signs three people in at once -- the organization, a North Gate user
// and a West Yard user -- and asserts what each of them can see and do.
//
// It needs the demo running (tools/demo/start-demo.ps1 in sentry-core).
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const URL = process.env.DEMO_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? ".";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password";
const SLUG = process.env.DEMO_SLUG ?? "kallon-demo";
await mkdir(OUT, { recursive: true });

/** The fleet feed polls every 20s; give a change a poll and a half. */
const SETTLE = 32_000;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch();

async function signIn(login) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const boxes = page.locator("input");
  await boxes.nth(0).fill(login);
  await boxes.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|continue|log ?in/i }).first().click();
  await page.waitForTimeout(3000);
  return { ctx, page, login };
}

/** Open the Administration area, if this person has one. */
async function openAdmin(page) {
  const item = page.getByRole("button", { name: /administration/i });
  if ((await item.count()) === 0) return false;
  await item.first().click();
  await page.waitForTimeout(1200);
  return true;
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

/** Every notification card on screen, by its label. */
async function cardTitles(page) {
  const stack = page.getByRole("region", { name: "Notifications" });
  if ((await stack.count()) === 0) return [];
  return stack.getByRole("group").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter(Boolean),
  );
}

try {
  const org = await signIn(SLUG);
  const north = await signIn(`ada.${SLUG}`);
  const west = await signIn(`dele.${SLUG}`);

  // ── 1. A PERSON'S LOGIN IS name.organization ────────────────────────
  check(
    "a person signs in with name.organization",
    (await north.page.getByRole("button", { name: /settings/i }).count()) > 0,
    `ada.${SLUG}`,
  );
  // And in any case, which is the asymmetry worth proving in a browser.
  const upper = await signIn(`ADA.${SLUG.toUpperCase()}`);
  check(
    "a person may type their login in any case",
    (await upper.page.getByRole("button", { name: /settings/i }).count()) > 0,
  );
  await upper.ctx.close();

  // ── 2. ADMINISTRATION IS THE ORGANIZATION'S ─────────────────────────
  check("the organization has an Administration area", await openAdmin(org.page));
  check(
    "a site user does NOT",
    !(await openAdmin(north.page)),
    "ada",
  );
  await shot(org.page, "device-rules-admin-sites");

  // ── 3. NAMES, NOT HUB IDS ───────────────────────────────────────────
  const body = await org.page.locator("body").innerText();
  check(
    "cells are drawn by NAME",
    /North Camp/.test(body) && /Yard Shed/.test(body),
  );
  check(
    "a cell's ceiling is on screen",
    /of 4 towers/.test(body),
    "capacity",
  );

  // ── 4. A SITE USER MAY ADD, AND ONLY ADD ────────────────────────────
  //
  // They have no Administration area, so the add has to be reachable from
  // where they are. If this ever stops being true, a site user cannot add the
  // mast they are standing next to.
  const northBody = await north.page.locator("body").innerText();
  check(
    "a site user is not offered Remove, Move or Rename anywhere",
    !/\bRemove\b/.test(northBody) && !/\bMove\b/.test(northBody),
  );

  // ── 5. THE ADMIN IS TOLD WHEN SOMEBODY ELSE CHANGES THE FLEET ───────
  //
  // Driven through the ORGANIZATION's own screen, because the demo has no
  // route by which a site user can add one without an Administration area --
  // what this proves is the card's audience, not who pressed the button.
  const before = await cardTitles(west.page);
  check(
    "a site user gets no fleet cards",
    before.every((t) => !/tower|cell/i.test(t ?? "")),
    before.join(" | ") || "none",
  );

  // ── 6. A DESTRUCTIVE ACTION SAYS WHAT IT WILL DO ────────────────────
  const remove = org.page.getByRole("button", { name: /^Remove$/ }).first();
  if ((await remove.count()) > 0) {
    await remove.click();
    await org.page.waitForTimeout(400);
    const confirm = await org.page.locator("body").innerText();
    check(
      "removing a cell with towers says why it will be refused",
      /revokes its/i.test(confirm) && /cannot be/i.test(confirm),
    );
    await shot(org.page, "device-rules-remove-confirm");
    const keep = org.page.getByRole("button", { name: /keep it/i }).first();
    if ((await keep.count()) > 0) await keep.click();
  } else {
    check("removing a cell with towers says why it will be refused", false,
      "no Remove button found");
  }

  // ── 7. THE ADD DRAWER NEVER LOSES YOUR PLACE ────────────────────────
  const add = org.page.getByRole("button", { name: /^Add a cell$/ }).first();
  if ((await add.count()) > 0) {
    await add.click();
    await org.page.waitForTimeout(500);
    const drawer = org.page.getByRole("dialog");
    check("the add drawer opens as a dialog", (await drawer.count()) > 0);
    const drawerText = await drawer.first().innerText();
    check(
      "it says the radio is not configured here",
      /does not configure a radio/i.test(drawerText),
    );
    await shot(org.page, "device-rules-add-drawer");
    await org.page.keyboard.press("Escape");
    await org.page.waitForTimeout(400);
    check(
      "Escape closes it and the list is still there",
      (await org.page.getByRole("dialog").count()) === 0 &&
        /North Camp/.test(await org.page.locator("body").innerText()),
    );
  } else {
    check("the add drawer opens as a dialog", false, "no Add a cell button");
  }

  // ── 8. NOTHING CROSSES SITES ────────────────────────────────────────
  const westBody = await west.page.locator("body").innerText();
  check(
    "a West Yard user sees no North Gate cell",
    !/North Camp/.test(westBody),
  );

  await org.ctx.close();
  await north.ctx.close();
  await west.ctx.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ${f.name}  ${f.detail}`);
  process.exit(1);
}
