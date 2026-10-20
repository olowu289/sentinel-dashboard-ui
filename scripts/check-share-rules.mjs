// Three people signed in at once: does each card reach exactly the right one?
//
//   node scripts/check-share-rules.mjs [outdir]
//
// ══════════════════════════════════════════════════════════════════════
//  WHY A BROWSER AND NOT ANOTHER SERVER TEST
// ══════════════════════════════════════════════════════════════════════
//
// The server tests prove the RULES. They cannot prove that a card reaches one
// person and not another, because "reaches" is a thing that happens in a
// browser, over a poll, to a component that decides whether to raise it. Every
// bug in this batch lived in exactly that gap: the server knew who should
// answer, and the UI raised the card for somebody else.
//
// So this signs three people in at once -- an admin, a North Gate user and a
// West Yard user -- makes a real share, and asserts who sees what. It is the
// only test here that can fail because of a single misread field.
//
// It needs the demo running (tools/demo/start-demo.ps1 in sentry-core).
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const URL = process.env.DEMO_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? ".";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password";
await mkdir(OUT, { recursive: true });

/** The share feed polls every 20s; give a change a poll and a half. */
const SETTLE = 32_000;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch();

async function signIn(login) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const boxes = page.locator("input");
  await boxes.nth(0).fill(login);
  await boxes.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|continue|log ?in/i }).first().click();
  await page.waitForTimeout(3000);
  return { ctx, page, login };
}

/** Every share card currently on screen, by its title. */
async function cardTitles(page) {
  const stack = page.getByRole("region", { name: "Notifications" });
  if ((await stack.count()) === 0) return [];
  return stack.getByRole("group").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter(Boolean),
  );
}

async function openSharing(page) {
  await page.getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("link", { name: "Sharing" }).first().click();
  await page.waitForTimeout(2000);
}

const admin = await signIn("admin");
const ada = await signIn("ada");     // North Gate
const dele = await signIn("dele");   // West Yard

try {
  // ── 1. Nobody's own site in their "share with" list ────────────────────
  await openSharing(dele.page);
  const askOptions = await dele.page
    .getByLabel("Which site").first()
    .evaluateAll((els) =>
      Array.from(els[0].options ?? []).map((o) => o.textContent?.trim()),
    )
    .catch(() => []);
  check(
    "a site user is not offered their own site to share with",
    !askOptions.includes("West Yard"),
    `offered: ${askOptions.filter(Boolean).join(", ") || "(none)"}`,
  );

  // ── 2. The acting site is on screen ────────────────────────────────────
  const actingText = await dele.page.locator("body").innerText();
  check(
    "a site user can see which site they are acting as",
    /West Yard/.test(actingText),
    "found 'West Yard' on the Sharing page",
  );

  // ── 3. A request reaches the answering site, and only it ───────────────
  await dele.page.getByLabel("Which site").first().selectOption({ label: "North Gate" });
  await dele.page.getByLabel("Message").fill(
    "Browser test: our truck is at your gate.",
  );
  await dele.page.getByRole("button", { name: "Send request" }).click();
  await dele.page.waitForTimeout(2500);

  for (const p of [admin, ada, dele]) await p.page.waitForTimeout(0);
  await new Promise((r) => setTimeout(r, SETTLE));

  const adaCards = await cardTitles(ada.page);
  const deleCards = await cardTitles(dele.page);
  const adminCards = await cardTitles(admin.page);

  check(
    "the card reaches the site that must answer",
    adaCards.some((t) => /asking/i.test(t)),
    `ada: ${adaCards.join(" | ") || "(none)"}`,
  );
  check(
    "the card does NOT go back to the person who sent it",
    !deleCards.some((t) => /asking/i.test(t)),
    `dele: ${deleCards.join(" | ") || "(none)"}`,
  );
  check(
    "an administrator gets no card for a share between two sites",
    adminCards.length === 0,
    `admin: ${adminCards.join(" | ") || "(none)"}`,
  );
  await ada.page.screenshot({ path: join(OUT, "ada-has-the-card.png") });
  await admin.page.screenshot({ path: join(OUT, "admin-has-no-card.png") });

  // ── 4. The admin's Sharing page: sees everything, answers nothing ──────
  await openSharing(admin.page);
  const adminTabs = await admin.page.getByRole("button").evaluateAll((els) =>
    els.map((e) => e.textContent?.trim())
       .filter((t) => t && /^(New request|Share a feed|All shares|Incoming|Outgoing|Active|History)/.test(t)),
  );
  check(
    "an administrator gets 'All shares' and no 'Incoming'",
    adminTabs.some((t) => t.startsWith("All shares")) &&
      !adminTabs.some((t) => t.startsWith("Incoming")),
    adminTabs.join(" | "),
  );
  await admin.page.getByRole("button", { name: /^All shares/ }).first().click();
  await admin.page.waitForTimeout(1200);
  const adminPane = await admin.page.locator("main").innerText();
  check(
    "an administrator is offered no Accept anywhere",
    !/\bAccept\b/.test(adminPane),
    "no Accept button on the admin's share list",
  );
  check(
    "but an administrator can still end a share",
    /End now|Withdraw/.test(adminPane),
  );
  await admin.page.screenshot({ path: join(OUT, "admin-all-shares.png") });

  // ── 5. Accepting: the answer goes back to the asker, not the answerer ──
  await openSharing(ada.page);
  await ada.page.getByRole("button", { name: /^Incoming/ }).first().click();
  await ada.page.waitForTimeout(1200);
  await ada.page.getByRole("button", { name: "Choose and accept" }).first().click();
  await ada.page.waitForTimeout(1500);
  const towerBox = ada.page.getByRole("button", { name: /kln_|mast/i }).first();
  if (await towerBox.count()) await towerBox.click();
  await ada.page.waitForTimeout(400);
  const acceptBtn = ada.page.getByRole("button", { name: "Accept" }).first();
  const accepted = (await acceptBtn.count()) > 0;
  if (accepted) {
    await acceptBtn.click();
    await ada.page.waitForTimeout(2500);
  }
  check("the answering site could accept it", accepted);

  /* POLL FOR IT RATHER THAN SLEEPING PAST IT. The answer card is actionable
     and lives 45s, but the feed only notices on its next poll, so the window
     to see it is "after the poll, before it expires" -- watching is the only
     way to test that honestly. */
  let deleAfter = [];
  let adaAfter = [];
  for (let i = 0; i < 20; i++) {
    await new Promise((r2) => setTimeout(r2, 2500));
    deleAfter = await cardTitles(dele.page);
    adaAfter = await cardTitles(ada.page);
    if (deleAfter.some((t) => /accepted/i.test(t))) break;
  }
  check(
    "the answer reaches the site that asked",
    deleAfter.some((t) => /accepted/i.test(t)),
    `dele: ${deleAfter.join(" | ") || "(none)"}`,
  );
  check(
    "the site that answered is not told what it just did",
    !adaAfter.some((t) => /accepted/i.test(t)),
    `ada: ${adaAfter.join(" | ") || "(none)"}`,
  );
  await dele.page.screenshot({ path: join(OUT, "dele-told-it-was-accepted.png") });
} finally {
  for (const p of [admin, ada, dele]) await p.ctx.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:\n  " + failed.map((f) => f.name).join("\n  "));
  process.exit(1);
}
