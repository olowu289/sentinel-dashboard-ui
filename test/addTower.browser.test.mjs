/**
 * THE ADD TOWER SCREEN, AND THE MOMENT IT USED NOT TO NOTICE.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE BUG
 * ══════════════════════════════════════════════════════════════════════
 *
 * A pairing code was claimed, the tower enrolled, and this screen carried on
 * saying WAITING FOR THE TOWER with the pairing countdown running down -- for
 * a tower that had already arrived. The operator had to click Dashboard to
 * find out it had worked.
 *
 * It was not a missed poll. The shell asks `GET /v1/viewer/claims` every five
 * seconds and sees the status change immediately; what it then handed this
 * screen was `claims.find(c => c.status === "open")`, which is `null` from
 * that moment on. The screen's own effect bailed on the null and its local
 * copy of the claim kept saying `open` for ever.
 *
 * So the fix is about identity, and these tests are written against it: the
 * screen follows ONE claim by id, through the status it is waiting for.
 *
 * ⚠ THE HARNESS RE-RENDERS ON A TIMER, ON PURPOSE. `onDone` is an inline
 * arrow at the shell's call site and the shell re-renders about once a second
 * on its own. A `setTimeout` whose effect listed that callback as a
 * dependency would be cleared and restarted before it ever fired, and the
 * screen would sit on the finished state looking perfectly correct. A static
 * harness cannot see that; this one re-renders every 250 ms, so the
 * five-second redirect below is also the test for it.
 *
 *     node --test test/addTower.browser.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const SDK = join(ROOT, "vendor/sentry-sdk/dist/esm/index.js");
const SCRATCH = join(ROOT, "node_modules/.cache");

const ENV = JSON.stringify({
  MODE: "test",
  DEV: false,
  PROD: true,
  VITE_COORDINATION_URL: "https://coordination.test",
  VITE_SITE_TZ: "Africa/Lagos",
});

const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/** The name as it was typed, which this product stores and shows in capitals. */
const LABEL = "NORTH GATE MAST";
const CLAIM_ID = "clm_000001";

/** A claim fifteen minutes from lapsing, in whatever state a test wants. */
const claimRow = (status, minutesLeft = 14) => ({
  claim_id: CLAIM_ID,
  label: LABEL,
  expires_at: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
  status,
});

/* ======================================================================
 *  THE SCREEN, IN A REAL BROWSER
 * ====================================================================== */

describe("the Add Tower screen, once the tower has registered", () => {
  let browser;
  let page;
  let bundle;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "addtower-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement, useEffect, useState } from "react";
       import { createRoot } from "react-dom/client";
       import { AddTowerView, REGISTERED_DWELL_MS } from "@/components/AddTowerView";
       import { AuthProvider } from "@/components/AuthProvider";

       (window as any).__DWELL = REGISTERED_DWELL_MS;

       function Harness() {
         const [claim, setClaim] = useState<any>((window as any).__claim);
         const [mounted, setMounted] = useState(true);
         /* ⚠ A TICKING PARENT. The real shell re-renders about once a
            second for the battery fill and the latency walk, so every
            callback below is a new function on every render. A redirect
            timer that depended on one would never fire. */
         const [, tick] = useState(0);
         useEffect(() => {
           const t = setInterval(() => tick((n) => n + 1), 250);
           return () => clearInterval(t);
         }, []);
         useEffect(() => {
           (window as any).__setClaim = (next: any) => setClaim(next);
           (window as any).__leave = () => setMounted(false);
         }, []);
         if (!mounted) return createElement("p", null, "ELSEWHERE");
         return createElement(AddTowerView, {
           pendingClaim: claim,
           /* The shell's live reading: by id, whatever the status. */
           claimById: (id: string) =>
             claim && claim.claim_id === id ? claim : null,
           onNavigate: (id: string) => (window as any).__nav.push(id),
           onCancel: () => (window as any).__nav.push("cancel"),
           onClaimed: () => {},
           onDone: () => (window as any).__done.push(Date.now()),
         });
       }
       /* The rail inside this screen reads the session, so the provider has
          to be above it. Nothing here signs in: an empty session is what a
          harness gets and the rail draws the same destinations either way. */
       (window as any).__mount = () => {
         const host = document.getElementById("root")!;
         createRoot(host).render(
           createElement(AuthProvider, null, createElement(Harness)),
         );
       };
      `,
      "utf8",
    );
    const out = join(dir, "bundle.js");
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": ENV },
    });
    bundle = await readFile(out, "utf8");
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
  });

  /** A fresh screen showing one claim. Each test gets its own page. */
  async function open(claim) {
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.setContent(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.evaluate((c) => {
      window.__claim = c;
      window.__done = [];
      window.__nav = [];
      /* No server. Nothing in this screen asks for one until a code is
         typed, and the session probe above it must not reach out either. */
      window.fetch = async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    }, claim);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.__mount());
    try {
      await page.waitForSelector("h1", { timeout: 10_000 });
    } catch (err) {
      throw new Error([err.message, "ERRORS", ...errors].join(" | "));
    }
    return page;
  }

  const heading = () => page.textContent("h1");
  const countdown = () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-claim-countdown]");
      return el ? el.textContent.trim() : null;
    });
  const done = () => page.evaluate(() => window.__done.length);

  /* ---------------------------------------------- before the tower arrives */

  test("⭐ while the code is still good, the screen is what it always was", async () => {
    /* Nothing about the waiting state changes. The countdown is the honest
       shape for a fifteen-minute window, and it is running. */
    await open(claimRow("open"));
    assert.equal((await heading()).trim(), "WAITING FOR THE TOWER");
    assert.match(await page.textContent("body"), /Registered, waiting to connect/);
    assert.match(await countdown(), /^\d{1,2}:\d{2}$/);

    const first = await countdown();
    await page.waitForFunction(
      (was) =>
        document.querySelector("[data-claim-countdown]")?.textContent.trim() !==
        was,
      first,
      { timeout: 4000 },
    );
    /* And nothing has moved the operator anywhere. */
    assert.equal(await done(), 0);
    await page.close();
  });

  test("a claim that lapsed still says so, and still offers the way back", async () => {
    await open(claimRow("expired"));
    assert.equal((await heading()).trim(), "REGISTRATION EXPIRED");
    assert.match(await page.textContent("body"), /Not registered/);
    assert.equal(await countdown(), null, "a lapsed claim still drew a clock");
    assert.match(await page.textContent("body"), /Register again/);
    await page.waitForTimeout(500);
    assert.equal(await done(), 0, "an expired claim redirected somewhere");
    await page.close();
  });

  test("and so does one the operator superseded by re-registering", async () => {
    await open(claimRow("superseded"));
    assert.equal((await heading()).trim(), "REGISTRATION EXPIRED");
    assert.equal(await done(), 0);
    await page.close();
  });

  /* ----------------------------------------------- the moment it arrives */

  test("⭐ the countdown stops and goes the moment the tower enrols", async () => {
    /* ⚠ THE WHOLE BUG, IN ONE ASSERTION. That clock is the time left to TYPE
       THE CODE and nothing else. A screen still running it after enrolment
       is counting down to a deadline that cannot be missed any more, and an
       operator reads a running number as something still being waited for. */
    await open(claimRow("open"));
    assert.match(await countdown(), /^\d{1,2}:\d{2}$/);

    await page.evaluate((c) => window.__setClaim(c), claimRow("consumed"));
    await page.waitForFunction(
      () => document.querySelector("[data-claim-countdown]") === null,
      { timeout: 4000 },
    );
    /* And it does not come back on a later render. */
    await page.waitForTimeout(1200);
    assert.equal(await countdown(), null);
    await page.close();
  });

  test("⭐ and the screen says so, by name, with somewhere to go", async () => {
    await open(claimRow("open"));
    await page.evaluate((c) => window.__setClaim(c), claimRow("consumed"));
    await page.waitForFunction(
      () => /is registered/.test(document.querySelector("h1")?.textContent ?? ""),
      { timeout: 4000 },
    );
    /* The tower's own name, in the capitals this product stores it in. */
    assert.equal((await heading()).trim(), `${LABEL} is registered`);
    assert.match(
      await page.textContent("body"),
      /It will show online once it connects\./,
    );
    assert.match(await page.textContent("body"), /Go to dashboard/);
    /* The waiting pulse is gone with the wait. */
    assert.ok(
      !/WAITING FOR TOWER/.test(await page.textContent("body")),
      "the screen is still waiting for something",
    );
    await page.close();
  });

  test("⭐ then it goes to the dashboard on its own, about five seconds later", async () => {
    /* ⚠ THIS IS ALSO THE TEST FOR THE TIMER'S DEPENDENCIES. The harness
       re-renders every 250 ms, so roughly twenty new `onDone` functions are
       handed to this screen while the clock runs. An effect that depended on
       the callback would restart on each one and never fire. */
    await open(claimRow("open"));
    const dwell = await page.evaluate(() => window.__DWELL);
    assert.equal(dwell, 5000);

    await page.evaluate((c) => window.__setClaim(c), claimRow("consumed"));
    await page.waitForFunction(
      () => /is registered/.test(document.querySelector("h1")?.textContent ?? ""),
      { timeout: 4000 },
    );
    const at = Date.now();

    /* Not yet: the operator gets to read it. */
    await page.waitForTimeout(1500);
    assert.equal(await done(), 0, "it left before anybody could read the screen");

    await page.waitForFunction(() => window.__done.length > 0, {
      timeout: dwell + 4000,
    });
    const waited = Date.now() - at;
    assert.ok(
      waited >= dwell - 500,
      `it left after ${waited}ms, which is sooner than the dwell`,
    );
    /* Once, not once per render. */
    await page.waitForTimeout(1500);
    assert.equal(await done(), 1);
    await page.close();
  });

  test("⭐ and the button goes straight away, without waiting it out", async () => {
    await open(claimRow("open"));
    await page.evaluate((c) => window.__setClaim(c), claimRow("consumed"));
    await page.waitForSelector("text=Go to dashboard", { timeout: 4000 });
    const at = Date.now();
    await page.click("text=Go to dashboard");
    await page.waitForFunction(() => window.__done.length > 0, { timeout: 2000 });
    assert.ok(
      Date.now() - at < 2000,
      "the button waited for the timer it was offered instead of",
    );
    await page.close();
  });

  test("⭐ an operator who has already left is NOT pulled back", async () => {
    /* ⚠ A REDIRECT THAT OUTLIVES THE SCREEN MOVES SOMEBODY WHO CHOSE WHERE TO
       BE. Five seconds is long enough to press Dashboard, or a rail
       destination, or the breadcrumb -- all of which leave this screen -- and
       a timer still running afterwards would take them off the page they
       asked for. Leaving is the cancel. */
    await open(claimRow("open"));
    await page.evaluate((c) => window.__setClaim(c), claimRow("consumed"));
    await page.waitForSelector("text=Go to dashboard", { timeout: 4000 });

    await page.evaluate(() => window.__leave());
    await page.waitForFunction(
      () => /ELSEWHERE/.test(document.body.innerText),
      { timeout: 2000 },
    );
    await page.waitForTimeout(6500);
    assert.equal(
      await done(),
      0,
      "the screen redirected an operator who had already gone somewhere else",
    );
    await page.close();
  });

  test("⭐ a claim that is consumed before the screen opens is finished too", async () => {
    /* Resuming from the dashboard's pending card a moment after the tower
       came up. There is nothing left to wait for, so nothing waits. */
    await open(claimRow("consumed"));
    assert.equal((await heading()).trim(), `${LABEL} is registered`);
    assert.equal(await countdown(), null);
    await page.waitForFunction(() => window.__done.length > 0, { timeout: 9000 });
    await page.close();
  });
});

/* ======================================================================
 *  THE WHOLE SHELL, BECAUSE THE BUG WAS IN THE WIRING
 * ====================================================================== */

/**
 * ⚠ THE TESTS ABOVE CANNOT SEE THE ORIGINAL BUG, AND SAYING SO MATTERS.
 *
 * They hand the screen a `claimById` that answers for a consumed claim,
 * because that is what the fix is. But the defect was never inside the
 * screen: it was the shell handing down `claims.find(c => c.status ===
 * "open")`, which is `null` from the instant the tower enrols. Every
 * assertion above would have passed against the broken shell.
 *
 * So this one drives the real `SentinelApp` over a stubbed wire: a claim that
 * flips to `consumed` on the server, a fleet that gains the tower, and an
 * operator who ends up on the dashboard looking at it without touching
 * anything.
 */
describe("registering a tower, from the real shell", () => {
  let browser;
  let page;
  let bundle;
  /** `/v1/viewer/towers` reads at the moment the finished state appeared. */
  let readsAtRegistered = 0;

  /** The tower that was already there, and the one about to arrive. */
  const OLD_TOWER = {
    device_id: "kln_lab_000001",
    label: "LAB TOWER 1",
    link: "up",
    as_of: "2026-10-30T09:00:00Z",
    sensors: [],
    cameras: [{ index: 1, lens: "fixed", ptz_capable: false, status: "live" }],
  };
  const NEW_TOWER = {
    device_id: "kln_lab_000009",
    label: LABEL,
    link: "down",
    as_of: "2026-10-30T09:00:00Z",
    sensors: [],
    cameras: [{ index: 1, lens: "fixed", ptz_capable: false, status: "down" }],
  };

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "addtower-app-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement } from "react";
       import { createRoot } from "react-dom/client";
       import { SentinelApp } from "@/App";
       import { AuthProvider } from "@/components/AuthProvider";
       (window as any).__mount = () => {
         createRoot(document.getElementById("root")!).render(
           createElement(AuthProvider, null, createElement(SentinelApp)),
         );
       };
      `,
      "utf8",
    );
    const out = join(dir, "bundle.js");
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": ENV },
    });
    bundle = await readFile(out, "utf8");
    browser = await chromium.launch();
  });

  after(async () => {
    await page?.close();
    await browser?.close();
  });

  before(async () => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.evaluate(
      ([claim, oldTower]) => {
        const w = window;
        const NL = String.fromCharCode(10);
        /* The server's own state, which the tests below move. */
        w.__claims = [claim];
        w.__towers = [oldTower];
        w.__fleetReads = 0;

        const json = (body, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });

        w.fetch = async (url) => {
          const path = String(url);
          if (path.includes("/v1/capabilities")) {
            return json({ features: { sites: false } });
          }
          if (path.includes("/v1/viewer/events")) {
            return new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(
                    new TextEncoder().encode(": open" + NL + NL),
                  );
                },
              }),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            );
          }
          if (path.includes("/v1/viewer/claims")) return json({ claims: w.__claims });
          if (path.includes("/v1/viewer/towers")) {
            w.__fleetReads += 1;
            return json({ towers: w.__towers });
          }
          if (path.includes("/v1/viewer/site-alerts")) {
            return json({ alerts: [], colours: {} });
          }
          return json({});
        };
      },
      [claimRow("open"), OLD_TOWER],
    );

    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.__mount());
    try {
      /* The dashboard, with the pending registration's card on it. */
      await page.waitForSelector("text=LAB TOWER 1", { timeout: 15_000 });
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
      throw new Error([err.message, "ERRORS", ...errors, "BODY", body].join(" | "));
    }
  });

  /** The device ids the fleet list has a real card for, pending ones aside. */
  const cardIds = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label$="camera wall"]')].map((el) =>
        (el.getAttribute("aria-label") ?? "").replace(/^Open | camera wall$/g, ""),
      ),
    );

  test("⭐ the dashboard carries the registration while it is open", async () => {
    /* The pending card is in the towers list and the tower is NOT: no tower
       record exists until enrolment binds one, which is the whole reason
       `GET /v1/viewer/claims` is a route at all. */
    await page.waitForSelector("text=Waiting for the tower to connect", {
      timeout: 10_000,
    });
    assert.deepEqual(await cardIds(), ["kln_lab_000001"]);
    assert.match(await page.textContent("body"), /VIEW REGISTRATION/);
  });

  test("⭐ opening the registration resumes the wait, countdown and all", async () => {
    await page.click('[aria-label*="registered, waiting for the tower"]');
    await page.waitForSelector("h1:text('WAITING FOR THE TOWER')", {
      timeout: 10_000,
    });
    assert.match(
      await page.evaluate(
        () => document.querySelector("[data-claim-countdown]")?.textContent ?? "",
      ),
      /\d{1,2}:\d{2}/,
    );
  });

  test("⭐ THE BUG: the tower enrols and this screen finds out by itself", async () => {
    /* ⚠ THE SHELL SEES THIS WITHIN FIVE SECONDS AND ALWAYS DID. What it used
       to do with it was hand the screen `null`, because the claim it hands
       down is the one whose status is `open` and this one no longer is. The
       screen then kept its own stale copy and waited for ever. */
    await page.evaluate(
      ([claim, towers]) => {
        window.__claims = [claim];
        window.__towers = towers;
      },
      [claimRow("consumed"), [OLD_TOWER, NEW_TOWER]],
    );

    await page.waitForSelector(`h1:text("${LABEL} is registered")`, {
      timeout: 15_000,
    });
    /* Counted from here, for the test below. */
    readsAtRegistered = await page.evaluate(() => window.__fleetReads);
    assert.equal(
      await page.evaluate(
        () => document.querySelector("[data-claim-countdown]"),
      ),
      null,
      "the pairing countdown is still running after the tower arrived",
    );
    assert.match(
      await page.textContent("body"),
      /It will show online once it connects\./,
    );
  });

  test("⭐ and lands on the dashboard with the new tower in the list", async () => {
    /* ⚠ REQUIREMENT AND TRAP IN ONE. The operator is being sent to a list
       specifically to see the tower they just registered. Arriving at a list
       without it in reads as the registration having failed, and a manual
       reload is not an answer. */
    await page.waitForSelector('[aria-label="Sentry towers"]', {
      timeout: 15_000,
    });
    await page.waitForFunction(
      (name) =>
        document
          .querySelector('[aria-label="Sentry towers"]')
          ?.textContent?.includes(name) ?? false,
      LABEL,
      { timeout: 15_000 },
    );
    /* A real card, not the pending one: a consumed claim IS a tower, and two
       cards for one mast would be the fleet counted twice. */
    assert.deepEqual(await cardIds(), ["kln_lab_000001", "kln_lab_000009"]);
    /* ⚠ AND THE MOVE ITSELF ASKED FOR THE FLEET. The claim poll re-reads
       it too, on the tick that sees the enrolment, and that is usually what
       has already happened by now -- but "usually" is not what an operator
       being sent to a list to see their tower is owed. The transition does
       not lean on a poll having succeeded. */
    assert.ok(
      (await page.evaluate(() => window.__fleetReads)) > readsAtRegistered,
      "going to the dashboard did not re-read the fleet",
    );
    assert.ok(
      !(await page.textContent("body")).includes("VIEW REGISTRATION"),
      "the pending card outlived the claim it was about",
    );
  });

  test("⚠ and the fleet is not re-read every five seconds for ever after", async () => {
    /* A consumed claim stays consumed and stays in the list, so a poll that
       tested the status alone fetched the whole fleet again on every tick
       for the rest of the session. */
    const before = await page.evaluate(() => window.__fleetReads);
    await page.waitForTimeout(11_000);
    const after = await page.evaluate(() => window.__fleetReads);
    assert.ok(
      after - before <= 1,
      `the fleet was read ${after - before} times in eleven idle seconds`,
    );
  });
});
