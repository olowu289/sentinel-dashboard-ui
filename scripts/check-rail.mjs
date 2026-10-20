// Drive a real browser against the running demo and report what each login
// actually sees in the rail. node verify-rail.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const URL = process.env.DEMO_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? ".";
await mkdir(OUT, { recursive: true });

const WHO = [
  ["admin", "demo-password"],
  ["dele", "demo-password"],
  ["chi", "demo-password"],
];

const browser = await chromium.launch();
for (const [login, password] of WHO) {
  // A fresh context per login: no storage carried over, which is what the
  // incognito window in the report was doing by hand.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const caps = [];
  page.on("response", async (r) => {
    if (r.url().includes("/v1/capabilities")) {
      caps.push(`${r.status()} ${await r.text().catch(() => "")}`.replace(/\s+/g, " "));
    }
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  const boxes = page.locator("input");
  await boxes.nth(0).fill(login);
  await boxes.nth(1).fill(password);
  await page.getByRole("button", { name: /sign in|continue|log ?in/i }).first().click();

  await page.waitForTimeout(3500);

  const rail = page.getByRole("navigation", { name: "Primary" });
  const labels = await rail.getByRole("button").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter(Boolean),
  );
  await page.screenshot({ path: join(OUT, `rail-${login}.png`) });
  console.log(
    `${login.padEnd(6)} capabilities=[${caps.join(" | ") || "none seen"}]\n` +
      `       rail: ${labels.join(", ") || "(none)"}`,
  );
  await ctx.close();
}
await browser.close();
