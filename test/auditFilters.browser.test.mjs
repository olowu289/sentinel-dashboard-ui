/**
 * The audit log's filters, pressed in a real browser.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS ONE HAS TO BE A BROWSER
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every filter on this page was dead on the live site. The group chips lit up,
 * the person dropdown changed, the dates took a value -- and the rows never
 * moved, because `useLoader` watched `enabled`, `tick` and `what`, and not the
 * thing the request was built from. The first fetch was the only fetch.
 *
 * Nothing short of a browser catches that. The filter object was memoised
 * correctly, `useAudit` listed every field in its dependency array, the SDK
 * put every parameter on the query string, and the server honoured all of
 * them: four correct layers with nothing connecting the top two. A unit test
 * of any one of them passes.
 *
 * So this presses the controls and asserts two things each time: that the
 * REQUEST carried the filter, and that the ROWS changed. The first without the
 * second would have passed while the page was broken; the second without the
 * first could pass on a page that filtered in the browser, which is not what
 * this page does -- 200 unfiltered rows on a busy fleet are almost all
 * `ptz.command`.
 *
 * It drives `screens.html`, the harness that mounts the real components over a
 * stubbed fetch, so there is no server, no account and no fleet -- and the
 * stub honours the same four filters the DC does.
 *
 *     node --test test/auditFilters.browser.test.mjs
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
let page;
/**
 * The screen under test, NOT the harness's own picker.
 *
 * ⚠ THE PICKER IS A ROW OF BUTTONS WITH THE SAME WORDS. Its "Sharing: new
 * request" matches a loose search for "Sharing", and `.first()` finds it
 * before the filter chip -- so a test that did not scope itself pressed the
 * harness, swapped the whole screen, and then reported that the rows had
 * changed. They had: it was a different page.
 */
let pane;

/** The sentences currently on screen, in order. */
async function rows() {
  return page.$$eval("[data-testid='audit-row']", (els) =>
    els.map((e) => e.innerText.trim()),
  );
}

/** Every /v1/admin/audit URL the page has asked for, oldest first. */
async function asked() {
  return page.evaluate(() => window.__auditAsked ?? []);
}

/**
 * Do something, wait for the page to ask again, and hand back what it asked.
 *
 * The harness records it: a stubbed `window.fetch` makes no network request,
 * so there is nothing for Playwright's own request events to see.
 */
async function afterAFetch(action) {
  const before = (await asked()).length;
  await action();
  const deadline = Date.now() + 8_000;
  let all = await asked();
  while (all.length === before && Date.now() < deadline) {
    await page.waitForTimeout(50);
    all = await asked();
  }
  /* The rows are rendered from the answer, so give React the frame after it. */
  await page.waitForTimeout(300);
  return all[all.length - 1] ?? "";
}

/** One filter chip, by its exact name, inside the pane. */
function chip(name) {
  return pane.getByRole("button", { name, exact: true });
}

before(async () => {
  server = await createServer({
    root: ROOT,
    server: { port: 5231, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  const port = server.config.server.port ?? 5231;

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  });
  page = await ctx.newPage();

  await page.goto(`http://localhost:${port}/screens.html?screen=admin-sites`, {
    waitUntil: "networkidle",
  });
  pane = page.locator("[data-screen]");
  await pane.getByRole("tab", { name: "Audit log" }).first().click();
  await page.waitForTimeout(600);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

describe("the audit log's filters", () => {
  test("it opens with every group, and rows to show", async () => {
    const all = await rows();
    assert.ok(all.length >= 6, `expected a page of rows, got ${all.length}`);
    /* The four groups are on by default, so the first request names all four
       rather than asking for everything and hiding most of it. */
    const sent = await asked();
    assert.ok(sent.length > 0, "the page asked for nothing at all");
    assert.match(sent[0], /groups=/);
  });

  test("turning a group OFF asks again, and takes those rows away", async () => {
    const before = await rows();
    const hadAShare = before.some((r) => /shared|share/i.test(r));
    assert.ok(hadAShare, "the fixture has no sharing row to remove");

    const url = await afterAFetch(() => chip("Sharing").click());
    assert.doesNotMatch(url, /sharing/, "the request still asks for sharing");

    const after = await rows();
    assert.notDeepEqual(after, before, "the rows did not change");
    assert.ok(
      !after.some((r) => /\bshared\b|\bended a share\b/i.test(r)),
      `a sharing row survived: ${after.join(" | ")}`,
    );
  });

  test("turning it back on brings them back", async () => {
    const before = await rows();
    await afterAFetch(() => chip("Sharing").click());
    const after = await rows();
    assert.notDeepEqual(after, before);
    assert.ok(after.some((r) => /share/i.test(r)), after.join(" | "));
  });

  test("ONE group leaves only that group's sentences", async () => {
    const url = await afterAFetch(async () => {
      for (const name of ["People", "Sharing", "Sites and towers"]) {
        await chip(name).click();
        await page.waitForTimeout(200);
      }
    });
    assert.match(url, /groups=sign_ins/);
    const only = await rows();
    assert.ok(only.length > 0, "sign-ins alone left nothing at all");
    for (const row of only) {
      assert.match(row, /signed in|Sign-in/i, `not a sign-in: ${row}`);
    }
    // And back to all four for the next test.
    await afterAFetch(async () => {
      for (const name of ["People", "Sharing", "Sites and towers"]) {
        await chip(name).click();
        await page.waitForTimeout(200);
      }
    });
  });

  test("choosing a PERSON asks for them and shows only their rows", async () => {
    const before = await rows();
    const url = await afterAFetch(() =>
      pane.getByLabel("Person", { exact: true }).selectOption({ label: "abu" }),
    );
    assert.match(url, /account_id=acct_abu/);

    const after = await rows();
    assert.notDeepEqual(after, before, "the rows did not change");
    assert.ok(after.length > 0, "abu has rows in the fixture");
    for (const row of after) {
      assert.match(row, /abu/, `somebody else's row survived: ${row}`);
    }
  });

  test("and \"Anyone\" puts everybody back", async () => {
    const url = await afterAFetch(() =>
      pane.getByLabel("Person", { exact: true }).selectOption({ label: "Anyone" }),
    );
    assert.doesNotMatch(url, /account_id=/);
    const after = await rows();
    assert.ok(
      after.some((r) => !/abu/.test(r)),
      "still only one person's rows",
    );
  });

  test("a DATE RANGE with nothing in it empties the page, in words", async () => {
    const url = await afterAFetch(() =>
      pane.getByLabel("From", { exact: true }).fill("2030-01-01"),
    );
    /* ⚠ SITE DAYS, SENT AS INSTANTS. The rows are stamped in UTC and shown in
       the site's clock, so the boundary is the site's midnight; it used to
       send `2030-01-01T00:00:00Z` literally, which is an hour out in Lagos. */
    assert.match(url, /since=2029-12-31T23%3A00%3A00|since=2030-01-01T00%3A00%3A00/);
    assert.deepEqual(await rows(), []);
    const text = await page.innerText("body");
    assert.match(text, /Nothing here for that filter/);
  });

  test("widening it brings the rows back", async () => {
    const url = await afterAFetch(() =>
      pane.getByLabel("From", { exact: true }).fill("2000-01-01"),
    );
    assert.match(url, /since=/);
    assert.ok((await rows()).length > 0, "a wide range showed nothing");
  });

  test("a TO date before the rows empties it too", async () => {
    await afterAFetch(() => pane.getByLabel("To", { exact: true }).fill("2000-01-02"));
    assert.deepEqual(await rows(), []);
  });

  test("Clear filters restores the whole page in one press", async () => {
    const url = await afterAFetch(() =>
      chip("Clear filters").click(),
    );
    assert.doesNotMatch(url, /since=/);
    assert.doesNotMatch(url, /until=/);
    assert.doesNotMatch(url, /account_id=/);
    assert.ok((await rows()).length >= 6, "the page did not come back");
  });

  test("a filter is asked for ONCE, not on every render", async () => {
    /* The bug on the other side of this fix is a request per keystroke: a
       loader that re-ran whenever anything re-rendered.

       ⚠ TWO IN A ROW IS NOT A BUG HERE. The harness renders under
       `StrictMode`, which deliberately runs every effect twice in
       development, so the first fetch of any filter arrives in a pair. Three
       of the same URL in a row is a loader watching something it should not.
    */
    const all = await asked();
    let run = 1;
    for (let i = 1; i < all.length; i += 1) {
      run = all[i] === all[i - 1] ? run + 1 : 1;
      assert.ok(run <= 2, `asked ${run} times in a row for ${all[i]}`);
    }
    /* And it did ask many different things: this whole file pressed them. */
    assert.ok(new Set(all).size >= 6, `only ${new Set(all).size} distinct requests`);
  });
});
