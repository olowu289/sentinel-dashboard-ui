/**
 * Live viewing that comes back by itself, and stops only when it is really over.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE THREE FAILURES THIS IS ABOUT
 * ══════════════════════════════════════════════════════════════════════
 *
 * On sentri.watch, tiles showed "Viewing ended / Access to this camera ended"
 * with a Resume button about fifteen minutes in, on cameras nobody had
 * touched. Three separate readings of one fact, each wrong in its own way:
 *
 *   1. EVERY REFUSED POLL READ AS ACCESS ENDING. `session_status` answers 404
 *      for "gone or not yours" -- the same code for a withdrawn share, a
 *      restarted server and an ordinary lapse -- and the viewer turned all of
 *      them into a sentence about somebody's business relationship.
 *   2. A TOWER THAT WAS OFF WAS RETRIED ANYWAY, minting grants and claiming
 *      camera slots on a box that could not answer.
 *   3. A TOWER THAT WAS ON gave up after five attempts and waited for a click
 *      that, on a wall nobody is standing at, never came.
 *
 * The decisions are now functions over values in `lib/liveRecovery.ts`, which
 * is what makes them testable at all. The player asks; it does not decide.
 *
 *   node --test test/liveRecovery.test.mjs
 */
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let r;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "live-recovery-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/liveRecovery";\n`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC, "@kallon/sentry-sdk": join(ROOT, "vendor/sentry-sdk/dist/esm/index.js") },
  });
  r = await import(pathToFileURL(out).href);
});

/* ======================================================================
 *  1. THE REASON MAPPER
 * ====================================================================== */

describe("what the server said, and what it means", () => {
  test("⭐ the real access-ended reasons end the view", () => {
    /* Every one is a decision about a PERSON: the share ended or was
       withdrawn, the account went, the camera left their sites. Asking again
       cannot change any of them. */
    for (const code of [
      "live_forbidden", "grant_permission", "grant_scope", "share_unknown",
      "share_revoked", "share_ended", "forbidden", "unauthorized",
      "account_disabled", "account_removed", "site_unknown", "camera_not_shared",
    ]) {
      assert.equal(r.verdictFor(code), "ended", code);
      assert.equal(r.accessEnded(code), true, code);
    }
  });

  test("⭐ an UNKNOWN reason retries", () => {
    /* Including one sentry-core adds next month. Being wrong this way costs a
       request; being wrong the other way tells an operator they have lost a
       site they still have. */
    for (const code of ["weather_balloon", "teapot", "some_future_code", "409"]) {
      assert.equal(r.verdictFor(code), "retry", code);
      assert.equal(r.accessEnded(code), false, code);
    }
  });

  test("⭐ a MISSING reason retries", () => {
    for (const nothing of [undefined, null, "", "   ", 7, {}]) {
      assert.equal(r.verdictFor(nothing), "retry", String(nothing));
    }
  });

  test("⭐ `session_unknown` RETRIES, which is the whole bug", () => {
    /* Coordination answers it for any session it no longer holds: a withdrawn
       share, a restarted server, an ordinary lapse. One code, three meanings,
       and only one of them final -- so it reopens, and if access really ended
       the NEXT request is refused with a reason that says so. One extra
       request is the entire cost of being right about this. */
    assert.equal(r.verdictFor("session_unknown"), "retry");
    assert.equal(r.verdictFor("grant_expired"), "retry");
  });

  test("the machine failures all retry", () => {
    for (const code of [
      "tower_offline", "tower_timeout", "hub_offline", "hub_timeout",
      "hub_media_unavailable", "dc_media_unavailable", "stream_starting",
      "camera_unknown", "hub_at_capacity", "dc_at_capacity", "relay_timeout",
    ]) {
      assert.equal(r.verdictFor(code), "retry", code);
    }
  });

  test("case and stray whitespace do not change the answer", () => {
    /* Two services spell their own constants and one of them will shout. */
    assert.equal(r.verdictFor("LIVE_FORBIDDEN"), "ended");
    assert.equal(r.verdictFor("  share_unknown  "), "ended");
    assert.equal(r.verdictFor("Session_Unknown"), "retry");
  });
});

/* ======================================================================
 *  2. THE SCHEDULE
 * ====================================================================== */

describe("how long it waits", () => {
  const noJitter = () => 0.5;   // the midpoint: delay exactly as written

  test("⭐ about 1, 2, 4, 8, 15, then every 30 seconds", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map((n) => r.reconnectDelay(n, noJitter)),
      [1_000, 2_000, 4_000, 8_000, 15_000, 30_000],
    );
  });

  test("⭐ and it does NOT run out after five", () => {
    /* The cap was the bug: five attempts over thirty seconds is long enough
       for a lift and far too short for an uplink down for ten minutes. */
    for (const n of [6, 7, 20, 500, 10_000]) {
      assert.equal(r.reconnectDelay(n, noJitter), 30_000, `attempt ${n}`);
    }
  });

  test("the ceiling is the last step, not a separate number", () => {
    assert.equal(r.RECONNECT_MAX_DELAY_MS, 30_000);
    assert.equal(
      r.RECONNECT_MAX_DELAY_MS,
      r.RECONNECT_DELAYS_MS[r.RECONNECT_DELAYS_MS.length - 1],
    );
  });

  test("every wait is jittered, within ±20%", () => {
    /* A hub going down drops every tile at once; without jitter the first
       thing it meets on coming back is a herd of its own making. */
    assert.equal(r.reconnectDelay(1, () => 0), 800);
    assert.equal(r.reconnectDelay(1, () => 1), 1_200);
    for (let n = 1; n <= 8; n += 1) {
      const d = r.reconnectDelay(n);
      const base = r.RECONNECT_DELAYS_MS[Math.min(n - 1, r.RECONNECT_DELAYS_MS.length - 1)];
      assert.ok(d >= base * 0.8 - 1 && d <= base * 1.2 + 1, `${n}: ${d}`);
    }
  });

  test("attempt zero and negatives are the first step, not a crash", () => {
    assert.equal(r.reconnectDelay(0, noJitter), 1_000);
    assert.equal(r.reconnectDelay(-5, noJitter), 1_000);
  });
});

/* ======================================================================
 *  3. WHETHER TO ASK AT ALL
 * ====================================================================== */

describe("a box that is off is not asked", () => {
  const up = { online: true };
  const down = { online: false };

  test("⭐ tower offline", () => {
    assert.equal(r.reachabilityOf(down, up), "tower-offline");
    assert.equal(r.reachWord("tower-offline"), "Tower offline");
  });

  test("⭐ hub offline, and it decides for its towers too", () => {
    /* A hub that is down takes its masts' video with it whatever those masts
       last said about themselves. Saying "Tower offline" there sends somebody
       to the wrong mast, in the dark. */
    assert.equal(r.reachabilityOf(up, down), "hub-offline");
    assert.equal(r.reachabilityOf(down, down), "hub-offline", "the hub wins");
    assert.equal(r.reachWord("hub-offline"), "Hub offline");
  });

  test("⭐ both up is nothing in the way", () => {
    assert.equal(r.reachabilityOf(up, up), null);
    assert.equal(r.reachabilityOf(up, null), null);
    assert.equal(r.reachabilityOf(up, undefined), null);
  });

  test("a box that has said nothing is not treated as down", () => {
    /* `online` absent is "not reported", not "off". Blacking out a tile over a
       field the fleet simply did not carry would be inventing an outage. */
    assert.equal(r.reachabilityOf({}, {}), null);
    assert.equal(r.reachabilityOf(null, null), null);
  });
});

/* ======================================================================
 *  4. THE RECORD
 * ====================================================================== */

describe("every interruption is traceable afterwards", () => {
  const lines = [];
  const fake = { info: (s) => lines.push(s) };

  test("⭐ the time, the camera, what happened and the server's reason", () => {
    lines.length = 0;
    r.logInterruption(
      { camera: "kln_lab_000001:1", event: "renewal-refused",
        reason: "session_unknown", action: "retry", attempt: 3, waitMs: 4000 },
      fake,
    );
    const line = lines[0];
    assert.match(line, /^\d{4}-\d{2}-\d{2}T/, "no timestamp");
    assert.match(line, /kln_lab_000001:1/);
    assert.match(line, /renewal-refused/);
    assert.match(line, /reason=session_unknown/);
    assert.match(line, /action=retry/);
    assert.match(line, /attempt=3/);
    assert.match(line, /in=4s/);
  });

  test("a missing reason says so rather than printing nothing", () => {
    /* "reason=" with an empty value reads as a parsing bug when somebody is
       scrolling a console at 3am. */
    lines.length = 0;
    r.logInterruption({ camera: "c:1", event: "dropped", reason: null, action: "retry" }, fake);
    assert.match(lines[0], /reason=none/);
  });

  test("it is info, not warn: reconnecting is normal on a radio link", () => {
    let warned = false;
    r.logInterruption(
      { camera: "c:1", event: "dropped", reason: null, action: "retry" },
      { info: () => {}, warn: () => { warned = true; } },
    );
    assert.equal(warned, false);
  });
});

/* ======================================================================
 *  5. THE PLAYER ASKS, AND DOES NOT DECIDE
 * ====================================================================== */

describe("the player is wired to those decisions", () => {
  let player, media, tile, monitor, app, code;
  before(async () => {
    const { stripComments } = await import("./lib/copyScan.mjs");
    player = await readFile(join(SRC, "lib/usePlayback.ts"), "utf8");
    media = await readFile(join(SRC, "lib/api/media.ts"), "utf8");
    tile = await readFile(join(SRC, "components/CameraTile.tsx"), "utf8");
    monitor = await readFile(join(SRC, "components/MonitorTile.tsx"), "utf8");
    app = await readFile(join(SRC, "App.tsx"), "utf8");
    code = stripComments(player);
  });

  test("⭐ `session_expired` is no longer terminal", () => {
    /* It is produced for `grant_expired` and `session_unknown`, and as a
       terminal failure it put "Access to this camera ended" on healthy
       cameras a quarter of an hour in. */
    const terminal = /const TERMINAL[\s\S]*?\]\);/.exec(code)[0];
    assert.ok(!/session_expired/.test(terminal), "session_expired is terminal again");
    assert.match(terminal, /not_permitted/);
  });

  test("⭐ and even a terminal failure needs the server's reason", () => {
    assert.match(code, /TERMINAL\.has\(why\.failure\) && accessEnded\(why\.reason\)/);
  });

  test("⭐ the server's reason survives the classification", () => {
    /* `classify` maps many codes onto one `failure` on purpose; the original
       has to outlive that or nothing can tell a withdrawn share from a lapse. */
    assert.match(media, /readonly reason: string \| null;/);
    assert.match(media, /reason: string \| null = null/);
  });

  test("⭐ a refused poll is answered, not thrown away", () => {
    /* It used to collapse every non-active answer to `null` and end the view. */
    assert.match(media, /kind: "refused"; reason: string \| null/);
    assert.match(media, /kind: "unreachable"/);
    assert.match(code, /status\.kind === "refused"/);
    assert.match(code, /accessEnded\(status\.reason\)/);
  });

  test("⭐ nothing is asked of a box that is off, on the first try or a later one", () => {
    /* Two gates: one in `connect` for a tile being opened at a dark site, one
       in `backOff` for a tile that was playing when the site went. */
    const gates = code.match(/reachRef\.current\(entry\.target\.towerId\)/g) ?? [];
    assert.ok(gates.length >= 2, `only ${gates.length} reachability gate(s)`);
    assert.match(code, /kind: "offline", which:/);
  });

  test("⭐ and it resumes by itself: reachability is part of the trigger", () => {
    /* A tile parked on "Tower offline" keeps no timer -- it is not retrying,
       so there is nothing to fire. The effect re-running is what brings it
       back, and that only happens if the key changes with the fleet. */
    const key = /const key = \[[\s\S]*?\]\.join\("\|"\);/.exec(code)[0];
    assert.match(key, /reachRef\.current\(t\.towerId\)/);
  });

  test("⭐ make before break: the old session closes LAST", () => {
    const renew = /const renew = async \(\) => \{[\s\S]*?\n          \};/.exec(code)[0];
    assert.match(renew, /set\(\{ kind: "playing", stream \}\)/, "no swap");
    const swap = renew.indexOf('set({ kind: "playing", stream })');
    const close = renew.indexOf("previous.close()");
    assert.ok(swap > 0 && close > swap, "the old session is closed before the swap");
    assert.match(code, /RENEW_BEFORE_MS/);
  });

  test("⭐ both tiles draw the offline state, above reconnecting", () => {
    for (const [name, src] of [["CameraTile", tile], ["MonitorTile", monitor]]) {
      assert.match(src, /playback\?\.kind === "offline"/, name);
      assert.match(src, /<SiteOfflineFallback which=\{siteOffline\}/, name);
      const off = src.indexOf("siteOffline ? (");
      const drop = src.indexOf("dropped ? (", off);
      assert.ok(off > 0 && drop > off, `${name}: reconnecting is drawn before offline`);
    }
  });

  test("⭐ one tile's trouble is one tile's: the player is keyed by camera", () => {
    /* Entries are per camera and `backOff` closes over one of them, so a
       reconnect cannot reach a sibling. Both cameras of a tower are two
       entries, which is what makes them independent. */
    assert.match(code, /live = useRef<Map<string, Entry>>/);
    assert.match(code, /cameraKey = \(towerId: string, index: number\)/);
    assert.ok(!/for \(const e of live\.current\.values\(\)\)[\s\S]{0,200}connectRef/.test(code),
      "something reconnects every entry at once");
  });

  test("⭐ \"Viewing ended\" is reachable ONLY behind the server's word", () => {
    /* THE INVARIANT THE WHOLE CHANGE RESTS ON. `end` is the only thing that
       sets the terminal `session_expired` phase, and every call to it has to
       sit behind `accessEnded`. A deadline simply passing used to call it,
       which put the sentence on screen on a clock rather than on an answer. */
    const lines = code.split("\n");
    const at = lines
      .map((line, i) => [line, i])
      .filter(([line]) => /(^|[^A-Za-z.])end\("/.test(line));
    assert.ok(at.length >= 1, "end() is gone entirely");
    for (const [line, i] of at) {
      /* The guard is usually the line above -- `if (accessEnded(reason))` --
         so the window is what gets read, not the call on its own. */
      const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      assert.match(
        window,
        /accessEnded\(/,
        `end() called without the server's word: ${line.trim()}`,
      );
    }
  });

  test("⭐ a lapsed deadline reconnects rather than ending the view", () => {
    /* It used to call `end`, which put "The live view ended" on screen
       because a clock ran out -- not because anybody said access was over. */
    const watcher = /const watchExpiry = \(\) => \{[\s\S]*?\n          \};/.exec(code)[0];
    assert.match(watcher, /backOff\(/);
    assert.ok(!/(^|[^A-Za-z.])end\(/m.test(watcher), "a clock still ends the view");
  });

  test("the screen supplies the reachability, off the fleet it is drawing", () => {
    assert.match(app, /reach: reachOf/);
    assert.match(app, /const reachOf = useCallback/);
    assert.match(app, /device\.kind === "hub"/);
  });

  test("every interruption is logged where it is decided", () => {
    for (const event of ["renewal-refused", "renewal-failed", "renewed"]) {
      assert.ok(code.includes(`"${event}"`), `${event} is not logged`);
    }
    const calls = code.match(/logInterruption\(/g) ?? [];
    assert.ok(calls.length >= 5, `only ${calls.length} log points`);
  });
});
