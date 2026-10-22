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
  /* ── WHAT A TILE SAYS WHEN THE PICTURE STOPS ────────────────────────
     Both of these used to be one line with a device serial shouted in it.
     They are the screens somebody is looking at at the worst moment to be
     read machinery, so they are photographed. */
  ["tile-ended", "tile-access-ended"],
  ["tile-offline", "tile-camera-offline"],
  ["ptz-refused", "ptz-not-included-in-the-share"],
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
            /* ⚠ AND THE STATES THAT ONLY EXIST AFTER A CLICK. A menu, a
               side panel and a confirmation are three quarters of this
               screen's design and none of them is in a static shot. Each
               step is guarded, so a control that is not there costs its own
               frame and not the run. */
            if (tab === "People") {
              written.push(...(await peopleFlow(page, label)));
              await button.first().click();
              await page.waitForTimeout(250);
            }
          }
        }
      }

      /* The same, for the tile whose share ended: Request more time opens the
         duration picker, which is the step the brief asks to see. */
      if (id === "tile-ended") {
        const ask = page.getByRole("button", { name: "Request more time" });
        if (await ask.count()) {
          await ask.first().click();
          await page.waitForTimeout(350);
          await hideChrome(page);
          const file = `${OUT}/tile-access-ended-asking-${label}.png`;
          await page.screenshot({ path: file, fullPage: true });
          written.push(file);

          /* And all the way through: a length, Send request, and what it
             says afterwards. The request goes to the stubbed coordination,
             so this is the real component's real success path. */
          const hour = page.getByRole("radio", { name: "1 hour" });
          if (await hour.count()) await hour.first().click();
          const send = page.getByRole("button", { name: "Send request" });
          if (await send.count()) {
            await send.first().click();
            await page.waitForTimeout(600);
            await hideChrome(page);
            const sent = `${OUT}/tile-access-ended-sent-${label}.png`;
            await page.screenshot({ path: sent, fullPage: true });
            written.push(sent);
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
/**
 * The People screen's three interactive states.
 *
 * The overflow menu on a DISABLED row (which is the bug this round fixed: the
 * page offered "Disable" and showed no status), the site panel with its
 * searchable list, and the removal confirmation that names who goes.
 */
async function peopleFlow(page, label) {
  const shots = [];
  const shoot = async (name) => {
    await hideChrome(page);
    const file = `${OUT}/${name}-${label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
  };

  const menuFor = async (who) => {
    const button = page.getByRole("button", { name: `Actions for ${who}` });
    if (!(await button.count())) return false;
    await button.first().click();
    await page.waitForTimeout(300);
    return true;
  };

  // The disabled person, with Enable where Disable used to be offered.
  if (await menuFor("ex")) {
    await shoot("administration-people-menu-disabled");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // Site membership, as a searchable multi-select.
  if (await menuFor("grace")) {
    const edit = page.getByRole("menuitem", { name: "Edit sites" });
    if (await edit.count()) {
      await edit.first().click();
      await page.waitForTimeout(400);
      await shoot("administration-people-sites-panel");
      const cancel = page.getByRole("button", { name: "Cancel" });
      if (await cancel.count()) await cancel.first().click();
      await page.waitForTimeout(250);
    } else {
      await page.keyboard.press("Escape");
    }
  }

  // And removal, which names them and says what it does.
  if (await menuFor("grace")) {
    const remove = page.getByRole("menuitem", { name: "Remove", exact: true });
    if (await remove.count()) {
      await remove.first().click();
      await page.waitForTimeout(400);
      await shoot("administration-people-remove");
      const keep = page.getByRole("button", { name: "Cancel" });
      if (await keep.count()) await keep.first().click();
      await page.waitForTimeout(250);
    } else {
      await page.keyboard.press("Escape");
    }
  }
  return shots;
}

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
