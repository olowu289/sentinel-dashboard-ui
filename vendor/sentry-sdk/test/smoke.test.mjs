/**
 * Smoke tests: `node --test`, built-in runner, no test dependency.
 *
 * These run against the built ESM output with an injected `fetch`, which is the
 * point of `FetchLike` existing — the contract can be exercised without a
 * server, a mock library or a browser. They cover the three things most likely
 * to break silently: the request the SDK actually puts on the wire, the typed
 * exception a `{error:{code,message}}` body maps to, and the runtime validation
 * that v1 did not have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AuthError,
  GrantError,
  InvalidRequestError,
  NotFoundError,
  ProjectionLeakError,
  PtzError,
  SentryClient,
  TowerOfflineError,
  TowerTimeoutError,
  ValidationError,
  isNormalPtzOutcome,
  isPtzPermissionDenied,
} from "../dist/esm/index.js";

/** Minimal `FetchLike` that records calls and replays scripted responses. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const r = (await handler(url, init)) ?? {};
    const status = r.status ?? 200;
    const headers = new Map(Object.entries(r.headers ?? {}));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
      text: async () => r.body ?? "",
    };
  };
  fn.calls = calls;
  return fn;
}

const SESSION = {
  session_id: "ses_01K3F9QW7YB2X4",
  device_id: "kln_lab_000002",
  camera: 1,
  expires_at: "2026-08-26T04:27:33Z",
  ice_servers: [{ urls: ["stun:stun.example.com:3478"] }],
  offer_url: "/v1/viewer/sessions/ses_01K3F9QW7YB2X4/offer",
  ice_url: "/v1/viewer/sessions/ses_01K3F9QW7YB2X4/ice",
};

const json = (body, status = 200) => ({
  status,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

function client(fetchImpl, opts = {}) {
  return new SentryClient({ baseUrl: "https://coord.test", token: "vt_abc", fetch: fetchImpl, ...opts });
}

test("createSession posts the §4.2 body and returns the parsed session", async () => {
  const f = fakeFetch(() => json(SESSION, 201));
  const session = await client(f).createSession({ device_id: "kln_lab_000002", camera: 1 });

  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/sessions");
  assert.equal(f.calls[0].method, "POST");
  assert.equal(f.calls[0].headers.Authorization, "Bearer vt_abc");
  // §4.2 documents exactly two fields; the optional stub-only ones must not
  // appear unless the caller asked for them.
  assert.deepEqual(JSON.parse(f.calls[0].body), { device_id: "kln_lab_000002", camera: 1 });
  assert.equal(session.session_id, "ses_01K3F9QW7YB2X4");
  assert.deepEqual(session.ice_servers[0].urls, ["stun:stun.example.com:3478"]);
});

test("a malformed session response raises ValidationError, not a silent undefined", async () => {
  const broken = { ...SESSION, camera: "one", ice_servers: [{ urls: 42 }] };
  const f = fakeFetch(() => json(broken, 201));
  await assert.rejects(
    () => client(f).createSession({ device_id: "kln_lab_000002", camera: 1 }),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.equal(err.issues.length, 2);
      assert.match(err.issues.join(" "), /camera: expected finite number/);
      return true;
    },
  );
});

test("sendOffer sends application/sdp and returns the raw answer", async () => {
  const f = fakeFetch(() => ({
    status: 200,
    body: "v=0\r\no=- 38 0 IN IP4 0.0.0.0\r\n",
    headers: { "content-type": "application/sdp" },
  }));
  const answer = await client(f).sendOffer(SESSION, "v=0\r\no=- 46 2 IN IP4 127.0.0.1\r\n");

  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/sessions/ses_01K3F9QW7YB2X4/offer");
  assert.equal(f.calls[0].headers["Content-Type"], "application/sdp");
  assert.match(answer, /^v=0/);
});

test("503 tower_offline maps to TowerOfflineError and is not retryable (§7.6)", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "tower_offline", message: "tower kln_lab_000002 is not connected" } }, 503),
  );
  await assert.rejects(
    () => client(f).sendOffer("ses_x", "v=0"),
    (err) => {
      assert.ok(err instanceof TowerOfflineError);
      assert.equal(err.code, "tower_offline");
      assert.equal(err.status, 503);
      assert.equal(err.retryable, false, "§7.6: an absent tower is an answer, not a wait");
      return true;
    },
  );
});

test("504 tower_timeout maps to TowerTimeoutError and is retryable", async () => {
  const f = fakeFetch(() => json({ error: { code: "tower_timeout", message: "no answer in 10s" } }, 504));
  await assert.rejects(
    () => client(f).sendOffer("ses_x", "v=0"),
    (err) => err instanceof TowerTimeoutError && err.retryable === true,
  );
});

test("the code beats the status: a 502 carrying grant_expired is a GrantError", async () => {
  const f = fakeFetch(() => json({ error: { code: "grant_expired", message: "expired" } }, 502));
  await assert.rejects(
    () => client(f).sendOffer("ses_x", "v=0"),
    (err) => err instanceof GrantError && err.code === "grant_expired",
  );
});

test("closeSession is idempotent and swallows a 404 (§4.2)", async () => {
  const f = fakeFetch(() => json({ error: { code: "session_unknown", message: "gone" } }, 404));
  await client(f).closeSession(SESSION); // must not throw
  assert.equal(f.calls[0].method, "DELETE");
  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/sessions/ses_01K3F9QW7YB2X4");
});

test("ptz clamps to the §5.1 normalized ranges", async () => {
  const f = fakeFetch(() => json({ session_id: "ses_x", ok: true, result: { transport: "cgi" } }));
  await client(f).ptzMove("ses_x", 1, { mode: "jog", pan: 4.2, tilt: -9, zoom: 0.5 });
  const sent = JSON.parse(f.calls[0].body);
  assert.deepEqual(sent.params, { mode: "jog", pan: 1, tilt: -1, zoom: 0.5 });
});

test("a 200 {ok:false} PTZ result throws, and SUPERSEDED is flagged as normal (§5.2)", async () => {
  const f = fakeFetch(() =>
    json({ session_id: "ses_x", ok: false, error: { code: "SUPERSEDED", message: "newer move" } }),
  );
  await assert.rejects(
    () => client(f).ptzStop("ses_x", 1),
    (err) => {
      assert.ok(err instanceof PtzError);
      assert.ok(isNormalPtzOutcome(err), "SUPERSEDED must not be surfaced as a fault");
      return true;
    },
  );
});

test("a per-call timeout raises RequestTimeoutError rather than hanging", async () => {
  const f = fakeFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  await assert.rejects(
    () => client(f).createSession({ device_id: "d", camera: 1, timeoutMs: 30 }),
    (err) => err.name === "RequestTimeoutError" && err.timeoutMs === 30,
  );
});

/* --- §4.2.1 / §6.5: permissions and lifetime are never the viewer's ------- */

test("createSession cannot be made to request permissions or a lifetime (§6.5)", async () => {
  const f = fakeFetch(() => json(SESSION, 201));
  // A caller reaching for the old stub fields — the type system rejects this,
  // and the wire must too. Nothing but device_id and camera may leave.
  await client(f).createSession({
    device_id: "kln_lab_000002",
    camera: 1,
    permissions: ["view", "ptz"],
    lifetime_sec: 86400,
    viewer_ref: "vwr_someone_else",
    role: "operator",
  });
  const sent = JSON.parse(f.calls[0].body);
  assert.deepEqual(Object.keys(sent).sort(), ["camera", "device_id"]);
  assert.equal(sent.permissions, undefined);
  assert.equal(sent.lifetime_sec, undefined);
  assert.equal(sent.viewer_ref, undefined);
  assert.equal(sent.role, undefined);
});

/* --- §A.3: the projected inventory contract ------------------------------ */

/**
 * The §A.3 example, verbatim: one tower with one dual-lens body — a PTZ lens
 * and a fixed lens sharing an `enclosure`, which the dashboard draws as one
 * tile with the fixed as a swappable inset (§A.4/§A.5).
 *
 * This fixture is the contract. If it stops validating, either the SDK drifted
 * or the contract moved, and both are worth a failing test.
 */
const PROJECTED = {
  device_id: "kln_northridge_004821",
  label: "04 — North Ridge",
  link: "up",
  as_of: "2026-08-26T04:31:02Z",
  cameras: [
    { index: 1, lens: "ptz", ptz_capable: true,
      resolution: { width: 1920, height: 1080 }, status: "live",
      enclosure: "encl-a", role: "primary" },
    { index: 2, lens: "fixed", ptz_capable: false,
      resolution: { width: 1920, height: 1080 }, status: "live",
      enclosure: "encl-a", role: "secondary" },
  ],
  sensors: [],
};

test("the §A.3 projected example validates clean", async () => {
  const f = fakeFetch(() => json({ towers: [PROJECTED] }));
  const [t] = await client(f).listTowers();

  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/towers");
  assert.equal(t.device_id, "kln_northridge_004821");
  assert.equal(t.label, "04 — North Ridge");
  assert.equal(t.link, "up");
  assert.equal(t.as_of, "2026-08-26T04:31:02Z");
  assert.deepEqual(t.sensors, []);
  // §A.4 — two cameras, one enclosure. Not one camera with two feeds.
  assert.equal(t.cameras.length, 2);
  assert.deepEqual(t.cameras.map((c) => c.enclosure), ["encl-a", "encl-a"]);
  assert.deepEqual(t.cameras.map((c) => c.role), ["primary", "secondary"]);
  assert.deepEqual(t.cameras.map((c) => c.status), ["live", "live"]);
  assert.equal(t.cameras[0].resolution.width, 1920);
});

/* --- §A.6 MUST-NOT tier: reject loud, name the field --------------------- */

for (const leak of ["path", "whep_path", "boot_id"]) {
  test(`§A.6: a projection leaking ${leak} is rejected loudly, naming the field`, async () => {
    // Nested inside a camera — §A.6 says "anywhere in the document", so a leak
    // three levels down is the same leak as one at the top.
    const dirty = structuredClone(PROJECTED);
    dirty.cameras[1][leak] = leak === "boot_id" ? "8f14e45f-ceea-467a" : "cam2";
    const f = fakeFetch(() => json({ towers: [dirty] }));

    await assert.rejects(
      () => client(f).listTowers(),
      (err) => {
        assert.ok(err instanceof ProjectionLeakError, "must be its own class, not a generic failure");
        assert.ok(err instanceof ValidationError, "and still catchable as a validation failure");
        assert.deepEqual(err.leaked, [`towers[0].cameras[1].${leak}`], "names the exact path");
        assert.match(err.message, new RegExp(leak));
        assert.match(err.message, /MUST NOT reach a viewer/);
        return true;
      },
    );
  });
}

test("§A.6: a top-level leak is caught too, and every offender is listed", async () => {
  const dirty = { ...structuredClone(PROJECTED), boot_id: "8f14e45f" };
  dirty.cameras[0].path = "cam1";
  const f = fakeFetch(() => json({ towers: [dirty] }));
  await assert.rejects(
    () => client(f).listTowers(),
    (err) => {
      assert.deepEqual(err.leaked.sort(), ["towers[0].boot_id", "towers[0].cameras[0].path"]);
      return true;
    },
  );
});

test("§A.6 SHOULD-omit tier: codec and calibrated are tolerated in silence", async () => {
  const withNoise = structuredClone(PROJECTED);
  withNoise.cameras[0].codec = "H264";
  withNoise.cameras[0].calibrated = false;
  const f = fakeFetch(() => json({ towers: [withNoise] }));
  const [t] = await client(f).listTowers(); // must not throw
  // Tolerated, not consumed — they are noise, not a violation, and not typed.
  assert.equal(t.cameras[0].status, "live");
});

/* --- §A.12 #2: link is a word; there is no boolean form ------------------ */

test("online:true instead of link is rejected — §A.12 #2 removed the boolean", async () => {
  const old = { ...structuredClone(PROJECTED), online: true };
  delete old.link;
  const f = fakeFetch(() => json({ towers: [old] }));
  await assert.rejects(
    () => client(f).listTowers(),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.issues.join(" "), /towers\[0\]\.link: expected string/);
      return true;
    },
  );
});

test("an unrecognised link word passes — the field exists to allow a third state", async () => {
  // §A.3: a word, "so a further state (e.g. 'reconnecting') can be added
  // without a breaking change". Validating it against a closed set would make
  // that impossible to use, so the SDK accepts any string here on purpose.
  const t2 = { ...structuredClone(PROJECTED), link: "reconnecting" };
  const f = fakeFetch(() => json({ towers: [t2] }));
  const [t] = await client(f).listTowers();
  assert.equal(t.link, "reconnecting");
});

/* --- §A.2 / §A.3.2: status and as_of ------------------------------------- */

test('status "unknown" with as_of null passes — the honest pre-report value', async () => {
  // §A.3.2: before the first tower.hello every status is "unknown" and as_of is
  // null. Neither is an error; neither is ever rendered as good.
  const fresh = {
    device_id: "kln_new_000009", label: "09 — Unpacked", link: "down",
    as_of: null,
    cameras: [{ index: 1, lens: "ptz", ptz_capable: true, status: "unknown" }],
    sensors: [],
  };
  const f = fakeFetch(() => json({ towers: [fresh] }));
  const [t] = await client(f).listTowers();
  assert.equal(t.as_of, null);
  assert.equal(t.cameras[0].status, "unknown");
});

test("a missing as_of is rejected — staleness must never be unknowable (§A.3.2)", async () => {
  const noStamp = structuredClone(PROJECTED);
  delete noStamp.as_of;
  const f = fakeFetch(() => json({ towers: [noStamp] }));
  await assert.rejects(
    () => client(f).listTowers(),
    (err) => {
      assert.match(err.issues.join(" "), /towers\[0\]\.as_of/);
      return true;
    },
  );
});

test("an unparseable as_of is rejected", async () => {
  const bad = { ...structuredClone(PROJECTED), as_of: "last tuesday" };
  const f = fakeFetch(() => json({ towers: [bad] }));
  await assert.rejects(
    () => client(f).listTowers(),
    (err) => /as_of: expected parseable ISO-8601/.test(err.issues.join(" ")),
  );
});

/* --- §A.12 #1: resolution is an object, not a string --------------------- */

test('resolution as "1920x1080" is rejected — the object form won (§A.12 #1)', async () => {
  const strRes = structuredClone(PROJECTED);
  strRes.cameras[0].resolution = "1920x1080";
  const f = fakeFetch(() => json({ towers: [strRes] }));
  await assert.rejects(
    () => client(f).listTowers(),
    (err) => {
      assert.match(
        err.issues.join(" "),
        /towers\[0\]\.cameras\[0\]\.resolution: expected object, got string/,
      );
      return true;
    },
  );
});

/* --- §A.2: index is the protocol address --------------------------------- */

test("index 0 is rejected — §A.2 requires an integer >= 1", async () => {
  const zero = structuredClone(PROJECTED);
  zero.cameras[0].index = 0;
  const f = fakeFetch(() => json({ towers: [zero] }));
  await assert.rejects(
    () => client(f).listTowers(),
    (err) => /cameras\[0\]\.index: expected integer >= 1/.test(err.issues.join(" ")),
  );
});

test("path is no longer required — a camera without one validates", async () => {
  // 0.1.0 required `path` to join health.feeds[] for liveness. §A.2 serves
  // status directly, so the join and its key are both gone.
  const f = fakeFetch(() => json({ towers: [PROJECTED] }));
  const [t] = await client(f).listTowers();
  assert.equal(t.cameras[0].path, undefined);
});

/* --- §4.2.3 detail: two stamps, kept distinct ---------------------------- */

test("getTower carries both as_of (cameras) and health_as_of (sensors) (§A.3.2)", async () => {
  const detail = {
    ...structuredClone(PROJECTED),
    health: {
      door: { open: false },
      cover: { exposed: false },
      impact: { last_delta_mg: null },
      thermal: { soc_c: 46.5, state: "ok" },
      disk: { free_pct: 71.2 },
    },
    health_as_of: "2026-08-26T04:31:02Z",
  };
  const f = fakeFetch(() => json(detail));
  const t = await client(f).getTower("kln_northridge_004821");

  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/towers/kln_northridge_004821");
  assert.equal(t.as_of, "2026-08-26T04:31:02Z");
  assert.equal(t.health_as_of, "2026-08-26T04:31:02Z");
  assert.equal(t.health.impact.last_delta_mg, null, "null is a documented value, not an absence");
});

test("getTower rejects a response missing health_as_of", async () => {
  const detail = { ...structuredClone(PROJECTED), health: { disk: { free_pct: 10 } } };
  const f = fakeFetch(() => json(detail));
  await assert.rejects(
    () => client(f).getTower("kln_northridge_004821"),
    (err) => /health_as_of/.test(err.issues.join(" ")),
  );
});

/* --- §3.1 health.battery: reachable is the contract ---------------------- */

test("a battery block parses its readings", async () => {
  const detail = {
    ...structuredClone(PROJECTED),
    health: {
      battery: {
        reachable: true,
        as_of: "2026-09-12T10:00:00Z",
        soc_pct: 37,
        voltage_v: 13.94,
        current_a: -4.86,
        temp_c: 24,
      },
    },
    health_as_of: "2026-09-12T10:00:00Z",
  };
  const f = fakeFetch(() => json(detail));
  const t = await client(f).getTower("kln_northridge_004821");
  assert.equal(t.health.battery.reachable, true);
  assert.equal(t.health.battery.soc_pct, 37);
  assert.equal(t.health.battery.voltage_v, 13.94);
  assert.equal(t.health.battery.current_a, -4.86, "negative is discharging");
  assert.equal(t.health.battery.temp_c, 24);
});

test("a battery block without `reachable` is rejected — the ordering guarantee", async () => {
  // Coordination returns NO battery block unless it has a real boolean here, so
  // this response should be impossible. It is asserted anyway, because the
  // whole safety of the deploy order rests on this field being mandatory: if it
  // ever became optional, a half-deployed tower could blank the cell silently
  // instead of failing loudly here.
  const detail = {
    ...structuredClone(PROJECTED),
    health: { battery: { soc_pct: 37 } },
    health_as_of: "2026-09-12T10:00:00Z",
  };
  const f = fakeFetch(() => json(detail));
  await assert.rejects(
    () => client(f).getTower("kln_northridge_004821"),
    (err) => /battery\.reachable/.test(err.issues.join(" ")),
  );
});

test("an unreachable battery parses with no readings at all", async () => {
  // One BLE connection: something else holding it is routine, not an error, and
  // it must be representable without a charge level. Absent, not stale.
  const detail = {
    ...structuredClone(PROJECTED),
    health: { battery: { reachable: false, as_of: "2026-09-12T10:00:00Z" } },
    health_as_of: "2026-09-12T10:00:00Z",
  };
  const f = fakeFetch(() => json(detail));
  const t = await client(f).getTower("kln_northridge_004821");
  assert.equal(t.health.battery.reachable, false);
  assert.equal(t.health.battery.soc_pct, undefined);
  assert.equal(t.health.battery.voltage_v, undefined);
});

test("a viewer with no authorized towers gets an empty list, not an error", async () => {
  const f = fakeFetch(() => json({ towers: [] }));
  assert.deepEqual(await client(f).listTowers(), []);
});

test("404 tower_unknown maps to NotFoundError (§4.2.3, unknown == not yours)", async () => {
  const f = fakeFetch(() => json({ error: { code: "tower_unknown", message: "unavailable" } }, 404));
  await assert.rejects(
    () => client(f).getTower("kln_someone_elses_000003"),
    (err) => err.name === "NotFoundError" && err.code === "tower_unknown",
  );
});

/* --- rename: PATCH /v1/viewer/towers/{device_id} ------------------------- */

test("renameTower PATCHes {label} and returns the updated projected tower", async () => {
  const renamed = { ...structuredClone(PROJECTED), label: "04 — North Ridge (upper)" };
  const f = fakeFetch(() => json(renamed));

  const t = await client(f).renameTower("kln_northridge_004821", "04 — North Ridge (upper)");

  assert.equal(f.calls[0].method, "PATCH");
  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/towers/kln_northridge_004821");
  assert.equal(f.calls[0].headers.Authorization, "Bearer vt_abc", "same auth as every other call");
  assert.equal(f.calls[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(f.calls[0].body), { label: "04 — North Ridge (upper)" });
  // The response is the tower, so a caller re-renders from the server's answer
  // rather than from the string it just sent.
  assert.equal(t.label, "04 — North Ridge (upper)");
  assert.equal(t.device_id, "kln_northridge_004821");
  assert.equal(t.cameras.length, 2);
});

test("renameTower passes the label through verbatim — no client-side mangling", async () => {
  // Whitespace and case are the user's business. The server validates and its
  // 422 says why; a client-side rule here would be a second copy free to drift.
  const messy = "  north  RIDGE  ";
  const f = fakeFetch(() => json({ ...structuredClone(PROJECTED), label: messy }));
  await client(f).renameTower("kln_northridge_004821", messy);
  assert.equal(JSON.parse(f.calls[0].body).label, messy, "sent exactly as given");
});

test("renameTower: 404 tower_unknown → NotFoundError (unknown == not yours)", async () => {
  // §4.2.3 — a rename endpoint that distinguished the two would be a fleet
  // enumerator with a side effect.
  const f = fakeFetch(() => json({ error: { code: "tower_unknown", message: "no such tower" } }, 404));
  await assert.rejects(
    () => client(f).renameTower("kln_someone_elses_000003", "Mine Now"),
    (err) => {
      assert.ok(err instanceof NotFoundError);
      assert.equal(err.code, "tower_unknown");
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test("renameTower: 422 invalid_label → InvalidRequestError, carrying the reason", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "invalid_label", message: "label must be 1-64 characters" } }, 422),
  );
  await assert.rejects(
    () => client(f).renameTower("kln_northridge_004821", ""),
    (err) => {
      assert.ok(err instanceof InvalidRequestError, "the REQUEST was refused");
      assert.ok(
        !(err instanceof ValidationError),
        "not ValidationError — that means the RESPONSE broke the contract, a different fault",
      );
      assert.equal(err.code, "invalid_label");
      assert.match(err.message, /1-64 characters/, "show the server's reason, do not invent one");
      return true;
    },
  );
});

test("renameTower: 401 → AuthError", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "unauthorized", message: "authentication required" } }, 401),
  );
  await assert.rejects(
    () => client(f).renameTower("kln_northridge_004821", "Nice Try"),
    (err) => err instanceof AuthError && err.code === "unauthorized",
  );
});

test("renameTower applies the §A.6 leak scan to its response too", async () => {
  // A write's response is a projection like any other; §A.6 does not stop
  // applying because the verb changed.
  const dirty = structuredClone(PROJECTED);
  dirty.cameras[0].path = "cam1";
  const f = fakeFetch(() => json(dirty));
  await assert.rejects(
    () => client(f).renameTower("kln_northridge_004821", "Renamed"),
    (err) => {
      assert.ok(err instanceof ProjectionLeakError);
      assert.deepEqual(err.leaked, ["cameras[0].path"]);
      return true;
    },
  );
});

/* --- §A.5 / §A.8: two refusals, two classes ------------------------------ */

test("§A.5: a refused promotion is AuthError/not_authorized, not a grant error", async () => {
  // Promoting a secondary inset means a NEW session on a different index, and
  // §6.1's camera allow-list can legitimately refuse it. A createSession that
  // never receives a grant cannot fail on a grant's permissions — §A.12 #5.
  const f = fakeFetch(() =>
    json({ error: { code: "not_authorized", message: "camera 2 not permitted" } }, 403),
  );
  await assert.rejects(
    () => client(f).createSession({ device_id: "kln_northridge_004821", camera: 2 }),
    (err) => {
      assert.ok(err instanceof AuthError, "session refusal is AuthError");
      assert.ok(!(err instanceof GrantError), "and must NOT collide with the PTZ refusal class");
      assert.equal(err.code, "not_authorized");
      assert.equal(isPtzPermissionDenied(err), false, "must not flip a camera to view-only");
      return true;
    },
  );
});

test("§A.8: a refused PTZ command is GrantError/grant_permission — the view-only flip", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "grant_permission", message: "ptz not granted" } }, 403),
  );
  await assert.rejects(
    () => client(f).ptzMove("ses_x", 1, { mode: "jog", pan: 0.5 }),
    (err) => {
      assert.ok(err instanceof GrantError, "PTZ refusal is GrantError");
      assert.ok(!(err instanceof AuthError), "and must NOT collide with the session refusal class");
      assert.equal(err.code, "grant_permission");
      assert.ok(isPtzPermissionDenied(err), "this is the flip-to-view-only trigger");
      return true;
    },
  );
});

test("isPtzPermissionDenied stays narrow: an expired grant is not a view-only flip", async () => {
  const f = fakeFetch(() => json({ error: { code: "grant_expired", message: "expired" } }, 403));
  await assert.rejects(
    () => client(f).ptzMove("ses_x", 1, { mode: "jog", pan: 0.5 }),
    (err) => {
      assert.ok(err instanceof GrantError);
      assert.equal(isPtzPermissionDenied(err), false, "wants a new session, not a disabled control");
      return true;
    },
  );
});
test("a non-envelope error body still produces a typed error", async () => {
  const f = fakeFetch(() => ({
    status: 502,
    body: "<html>Bad Gateway</html>",
    headers: { "content-type": "text/html" },
  }));
  await assert.rejects(
    () => client(f).getIceCandidates("ses_x"),
    (err) => err.name === "ServerError" && err.code === "internal" && err.status === 502,
  );
});

test("listArchivedRecordings requests the account-scoped hub route with the range", async () => {
  const f = fakeFetch(() => json({
    device_id: "kln_lab_000002", camera: "cam1", archive_enabled: true,
    segments: [
      { key: "recordings/kln_lab_000002/cam1/2026-09-18/2026-09-18_14-00-00-000000.mp4",
        camera: "cam1", device_id: "kln_lab_000002",
        start: "2026-09-18T14:00:00.000Z", start_epoch: 1758204000, duration: 900, size: 300,
        url: "/v1/viewer/recordings/segment?key=recordings%2F...&exp=1&sig=aa",
        download_url: "/v1/viewer/recordings/segment?key=recordings%2F...&exp=1&sig=aa&dl=1" },
    ],
  }));
  const out = await client(f).listArchivedRecordings("kln_lab_000002", "cam1", { from: 100, to: 200 });

  const url = new URL(f.calls[0].url);
  assert.equal(url.pathname, "/v1/viewer/recordings");
  assert.equal(url.searchParams.get("device_id"), "kln_lab_000002");
  assert.equal(url.searchParams.get("camera"), "cam1");
  assert.equal(url.searchParams.get("from"), "100");
  assert.equal(url.searchParams.get("to"), "200");
  assert.equal(f.calls[0].headers.Authorization, "Bearer vt_abc");

  assert.equal(out.archiveEnabled, true);
  assert.equal(out.segments.length, 1);
  const seg = out.segments[0];
  assert.equal(seg.startEpoch, 1758204000);
  assert.equal(seg.duration, 900);
  // A relative local stream URL is resolved to an absolute coordination URL —
  // directly usable as a <video src>.
  assert.ok(seg.url.startsWith("https://coord.test/v1/viewer/recordings/segment?"));
  assert.ok(seg.downloadUrl.endsWith("&dl=1"));
});

test("listArchivedRecordings leaves an absolute presigned bucket URL untouched", async () => {
  const presigned = "https://s3.us-west-004.backblazeb2.com/bkt/recordings/x.mp4?X-Amz-Signature=deadbeef";
  const f = fakeFetch(() => json({
    device_id: "d", camera: null, archive_enabled: true,
    segments: [
      { key: "recordings/d/cam1/2026-09-18/2026-09-18_14-00-00-000000.mp4",
        camera: "cam1", device_id: "d",
        start: "2026-09-18T14:00:00.000Z", start_epoch: 1758204000, duration: 900, size: 5,
        url: presigned, download_url: presigned + "&response-content-disposition=attachment" },
    ],
  }));
  const out = await client(f).listArchivedRecordings("d");

  // No camera in the query when none was asked for.
  assert.equal(new URL(f.calls[0].url).searchParams.get("camera"), null);
  // The presigned URL passes through: the frontend never learns it is a bucket.
  assert.equal(out.segments[0].url, presigned);
  assert.equal(out.camera, null);
});

test("listArchivedRecordings reports an honest empty archive", async () => {
  const f = fakeFetch(() => json({
    device_id: "d", camera: "cam1", archive_enabled: false, segments: [],
  }));
  const out = await client(f).listArchivedRecordings("d", "cam1");
  assert.equal(out.archiveEnabled, false);
  assert.deepEqual(out.segments, []);
});
