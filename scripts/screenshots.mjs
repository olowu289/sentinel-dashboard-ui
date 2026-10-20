/**
 * Capture every new screen at desktop and phone width.
 *
 *   npm run screenshots              -> ../sentry-core/docs/design/screens/
 *   OUT=/some/dir npm run screenshots
 *
 * ── WHY IT DRIVES THE HARNESS AND NOT THE APP ──────────────────────────
 *
 * `src/screens.tsx` mounts the real components against fixture data with a
 * stubbed fetch, so this needs no coordination, no account and no fleet. The
 * alternative was standing up a DC, seeding two organizations and six people,
 * and then photographing whatever state they happened to be in -- which is a
 * slower way to get a less reproducible picture.
 *
 * ── IT CAPTURES THE UNHAPPY STATES TOO ────────────────────────────────
 *
 * Empty, loading and refused are in the list, because they are the screens a
 * reviewer never thinks to ask for and the ones an operator meets on a bad day.
 *
 * The harness's own screen picker is hidden before each shot: it is the
 * harness, not the product, and leaving it in every frame would put a control
 * in the review that does not exist.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT
  ? resolve(process.env.OUT)
  : resolve(HERE, "..", "..", "sentry-core", "docs", "design", "screens");

/** id in screens.tsx -> file name. */
const SCREENS = [
  ["admin-sites", "administration-sites"],
  ["admin-empty", "administration-empty"],
  ["admin-loading", "administration-loading"],
  ["admin-failed", "administration-refused"],
  ["shares", "shares"],
  ["shares-empty", "shares-empty"],
  ["rail", "icon-rail"],
  ["ptz-yielded", "ptz-yielded-to-owner"],
  // Every state a card can be in. The brief asks for each by name, and they
  // are the part of this feature nobody can review from prose.
  ["card-request", "card-new-request"],
  ["card-expanded", "card-expanded"],
  ["card-offer", "card-offer"],
  ["card-undo", "card-declined-undo"],
  ["card-accepted", "card-accepted"],
  ["card-ended", "card-ended"],
  ["card-stack", "card-stack"],
  ["sharing-new", "sharing-new-request"],
  ["sharing-offer", "sharing-share-a-feed"],
  ["sharing-incoming", "sharing-incoming"],
  ["sharing-outgoing", "sharing-outgoing"],
  ["sharing-active", "sharing-active"],
  ["sharing-history", "sharing-history"],
  ["sharing-empty", "sharing-empty"],
  ["sharing-admin-all", "sharing-admin-all-shares"],
  // ── CELLS, TOWERS AND PEOPLE ──────────────────────────────────────
  // Each add-drawer outcome is here because each is a sentence somebody
  // reads at a mast, and prose cannot show whether it fits.
  ["add-cell", "add-a-cell"],
  ["add-tower", "add-a-tower"],
  ["add-waiting", "add-waiting"],
  ["add-queued", "add-queued-cell-offline"],
  ["add-failed", "add-refused"],
  ["add-full", "add-cell-full"],
  ["card-fleet", "card-a-tower-was-added"],
  ["card-revoked", "card-a-tower-was-removed"],
];

/** The two widths the brief asks for. Heights are generous; shots are full page. */
const WIDTHS = [
  ["desktop", 1440, 900],
  ["phone", 390, 844],
];

/** Panes inside Administration that are worth their own frame. */
const PANES = [
  ["People", "administration-people"],
  ["Shares", "administration-shares"],
  ["Audit log", "administration-audit"],
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const server = await createServer({
    root: resolve(HERE, ".."),
    server: { port: 5199, strictPort: false },
    logLevel: "warn",
  });
  await server.listen();
  const port = server.config.server.port ?? 5199;
  const base = `http://localhost:${port}/screens.html`;

  const browser = await chromium.launch();
  const written = [];

  for (const [label, width, height] of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      colorScheme: "dark",
      // The fixtures use relative times ("expires in 1h 30m"), so a frozen
      // clock would be a lie about a live screen. They are generated at load.
    });
    const page = await ctx.newPage();

    for (const [id, name] of SCREENS) {
      await page.goto(`${base}?screen=${id}`, { waitUntil: "networkidle" });
      // The loading screen never settles by design, so do not wait for it.
      // The add-drawer outcome screens fill the form and press Add on a
      // timer inside the harness, so they need longer than a static screen.
      if (id.startsWith("add-") && id !== "add-cell" && id !== "add-tower")
        await page.waitForTimeout(900);
      else if (id !== "admin-loading") await page.waitForTimeout(400);
      else await page.waitForTimeout(250);
      await hideChrome(page);
      const file = `${OUT}/${name}-${label}.png`;
      await page.screenshot({ path: file, fullPage: true });
      written.push(file);

      // Administration's other panes, from the same page.
      if (id === "admin-sites") {
        for (const [tab, paneName] of PANES) {
          const button = page.getByRole("tab", { name: tab });
          if (await button.count()) {
            await button.first().click();
            await page.waitForTimeout(400);
            await hideChrome(page);
            const paneFile = `${OUT}/${paneName}-${label}.png`;
            await page.screenshot({ path: paneFile, fullPage: true });
            written.push(paneFile);
          }
        }
      }
    }
    await ctx.close();
  }

  await browser.close();
  await server.close();

  await writeFile(
    `${OUT}/README.md`,
    [
      "# Screens: sites, people and sharing",
      "",
      "Captured by `Terra-Sentinel/scripts/screenshots.mjs` from",
      "`Terra-Sentinel/src/screens.tsx`, which mounts the real components",
      "against fixture data with a stubbed fetch. No coordination, no account",
      "and no fleet are involved, so these are reproducible.",
      "",
      "Two widths: `-desktop` is 1440x900, `-phone` is 390x844, both at 2x.",
      "Full page, so a long screen is one tall image rather than a crop.",
      "",
      "The empty, loading and refused states are here on purpose. They are the",
      "screens nobody asks to see and the ones an operator meets on a bad day.",
      "",
      "To regenerate:",
      "",
      "```bash",
      "cd Terra-Sentinel && npm run screenshots",
      "```",
      "",
      "## Files",
      "",
      ...written
        .map((f) => f.split(/[\\/]/).pop())
        .sort()
        .map((f) => `* \`${f}\``),
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`${written.length} screenshots -> ${OUT}`);
}

/** The harness's own picker is not part of any screen under review. */
async function hideChrome(page) {
  await page.evaluate(() => {
    const el = document.querySelector("[data-harness-chrome]");
    if (el instanceof HTMLElement) el.style.display = "none";
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
