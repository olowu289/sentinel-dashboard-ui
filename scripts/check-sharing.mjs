// A real browser against the running demo: does the sharing UI actually work?
//
//   node scripts/check-sharing.mjs [outdir]
//
// Signs in, opens Settings -> Sharing, reads what each section shows, and
// photographs it. This is the check that a screenshot harness cannot make:
// the harness proves a component renders against a fixture, and this proves
// the app reaches the server, gets real shares back and puts them on screen.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const URL = process.env.DEMO_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? ".";
await mkdir(OUT, { recursive: true });

const WHO = process.env.LOGINS?.split(",") ?? ["ada", "dele"];

const browser = await chromium.launch();
for (const login of WHO) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures = [];
  page.on("response", (r) => {
    if (r.url().includes("/v1/") && r.status() >= 400) {
      failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const boxes = page.locator("input");
  await boxes.nth(0).fill(login);
  await boxes.nth(1).fill("demo-password");
  await page.getByRole("button", { name: /sign in|continue|log ?in/i }).first().click();
  await page.waitForTimeout(3000);

  // Settings, then the Sharing section.
  await page.getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("link", { name: "Sharing" }).first().click();
  await page.waitForTimeout(2500);

  const tabs = await page
    .getByRole("button")
    .evaluateAll((els) =>
      els
        .map((e) => e.textContent?.trim())
        .filter((t) => t && /^(New request|Share a feed|Incoming|Outgoing|Active|History)/.test(t)),
    );
  await page.screenshot({ path: join(OUT, `sharing-${login}.png`), fullPage: false });

  // And one section with rows in it.
  await page.getByRole("button", { name: /^Active/ }).first().click();
  await page.waitForTimeout(600);
  const activeText = (await page.locator("main").innerText()).split("\n").slice(0, 10);
  await page.screenshot({ path: join(OUT, `sharing-${login}-active.png`) });

  console.log(
    `${login.padEnd(5)} tabs: ${tabs.join(" | ")}\n` +
      `      active: ${activeText.filter(Boolean).slice(2, 7).join(" / ")}\n` +
      `      failed requests: ${failures.length ? failures.join(", ") : "none"}`,
  );
  await ctx.close();
}
await browser.close();
