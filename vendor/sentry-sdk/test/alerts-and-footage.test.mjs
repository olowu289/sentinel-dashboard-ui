/**
 * Site alerts, the live channel, and the new footage fields — on real shapes.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THESE BODIES ARE NOT HAND-BUILT
 * ══════════════════════════════════════════════════════════════════════
 *
 * `test/fixtures/alerts_and_footage.json` is the OUTPUT of coordination's own
 * code at sentry-core 8a5b019 — `project_footage`, `SiteAlert.to_wire`,
 * `timeline_extras`, `COLOURS` — dumped to JSON, not a transcription of the
 * docs. That matters for exactly the failure this round of work exists to
 * prevent: a field the server sends and the SDK drops. A fixture I typed by
 * hand would agree with the type I wrote beside it and prove nothing, which is
 * how `label` and `patrol` were both lost — the type was right and the
 * VALIDATOR never read the field.
 *
 * So every assertion below goes through an exported parser or through
 * `SentryClient` over an injected `fetch`, against bytes the server produced.
 *
 *   node --test test/alerts-and-footage.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AlertRevisionGate,
  SentryClient,
  SseBuffer,
  ValidationError,
  alertEventOf,
  parseSiteAlert,
  parseSiteAlertList,
  parseSseFrame,
  parseTowerInfo,
} from "../dist/esm/index.js";

const F = JSON.parse(
  readFileSync(new URL("./fixtures/alerts_and_footage.json", import.meta.url), "utf8"),
);

const json = (body, status = 200) => ({
  status,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

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
      body: r.stream,
    };
  };
  fn.calls = calls;
  return fn;
}

const client = (f, over = {}) =>
  new SentryClient({ baseUrl: "https://coord.test", token: "vt_abc", fetch: f, ...over });

/* ================================================================== *
 * 1. Site alerts — docs/alerts.md section 4
 * ================================================================== */

test("listSiteAlerts returns the real alerts AND the colours map", async () => {
  const f = fakeFetch(() =>
    json({ alerts: [F.alert_acked_with_clip, F.alert_live], colours: F.colours }),
  );
  const out = await client(f).listSiteAlerts();

  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/site-alerts");
  assert.equal(f.calls[0].headers.Authorization, "Bearer vt_abc");
  assert.equal(out.alerts.length, 2);
  // The map is the whole reason a dashboard can render a type it has not heard
  // of — so it is checked for the five this build raises, by value.
  assert.deepEqual(out.colours, {
    TOWER_OFFLINE: "red",
    CAMERA_STOPPED: "orange",
    TOWER_ONLINE: "green",
    FOOTAGE_RECOVERING: "purple",
    FOOTAGE_RECOVERED: "teal",
  });
});

test("listSiteAlerts sends since and limit, and only when given", async () => {
  const f = fakeFetch(() => json({ alerts: [], colours: F.colours }));
  const c = client(f);
  await c.listSiteAlerts();
  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/site-alerts");
  await c.listSiteAlerts({ since: 1793188743, limit: 50 });
  assert.equal(
    f.calls[1].url,
    "https://coord.test/v1/viewer/site-alerts?since=1793188743&limit=50",
  );
});

test("every field of a real acknowledged alert with a clip survives", async () => {
  const a = parseSiteAlert(F.alert_acked_with_clip);

  assert.equal(a.id, "26ba7dd47c66402e9f1a0c8e4b1d3f55");
  assert.equal(a.type, "CAMERA_STOPPED");
  assert.equal(a.colour, "orange");
  assert.equal(a.device_id, "kln_lab_000001");
  assert.deepEqual(a.cameras, [1]);
  assert.equal(a.started_at, "2026-10-28T11:59:03Z");
  assert.equal(a.started_epoch, 1793188743);
  assert.equal(a.recovered_at, "2026-10-28T12:04:10Z");
  assert.equal(a.acknowledged, true);
  assert.equal(a.acknowledged_by, "Terra Industries");
  assert.equal(a.acknowledged_at, "2026-10-28T12:05:00Z");
  assert.equal(a.best_quality, "standard");
  assert.equal(a.rev, 7);

  const [clip] = a.clips;
  assert.equal(clip.camera, 1);
  assert.equal(clip.quality, "standard");
  assert.match(clip.key, /_standard_26ba7dd47c66\.mp4$/);
  assert.equal(clip.start, "2026-10-28T11:58:03Z");
  assert.equal(clip.start_epoch, 1793188683);
  assert.equal(clip.duration, 60);
  assert.equal(clip.size, 7812345);
  assert.equal(clip.filename, "labtower1_cam1_2026-10-28_12-58-03_WAT_26ba7dd47c66.mp4");
  assert.match(clip.url, /^\/v1\/viewer\/alerts\/clip\?/);
  assert.match(clip.download_url, /&dl=1$/);

  assert.deepEqual(a.progress, {
    files_left: 6,
    bytes_left: 4294967296,
    progress: 0,
    eta_sec: 1718,
  });
});

test("ABSENT, NEVER NULL: a live alert has no recovered_at key at all", () => {
  const a = parseSiteAlert(F.alert_live);
  // The rule is about PRESENCE, so `in` is the check — `=== undefined` would
  // pass for a null that leaked through and defeat the point.
  assert.equal("recovered_at" in a, false);
  assert.equal("acknowledged_by" in a, false);
  assert.equal("acknowledged_at" in a, false);
  assert.equal("clips" in a, false);
  assert.equal("best_quality" in a, false);
  assert.equal("progress" in a, false);
  assert.equal("via_hub_id" in a, false);
});

test("a null arriving for an optional field is DROPPED, not carried through", () => {
  // An older tier, a forward or a hand-written body can still produce one, and
  // one null in the object re-creates the special-case the rule deletes.
  const a = parseSiteAlert({ ...F.alert_live, recovered_at: null, progress: null });
  assert.equal("recovered_at" in a, false);
  assert.equal("progress" in a, false);
});

test("acknowledged is ALWAYS a boolean — a missing one is a hard failure", () => {
  assert.equal(parseSiteAlert(F.alert_live).acknowledged, false);
  const { acknowledged, ...without } = F.alert_live;
  assert.equal(acknowledged, false);
  // `false` and "an older hub that did not say" must not be the same thing on a
  // screen, so this cannot be allowed to default.
  assert.throws(
    () => parseSiteAlert(without),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.issues.join(" "), /\$\.acknowledged: expected boolean/);
      return true;
    },
  );
});

test("type and colour are CODES — no message field anywhere", () => {
  for (const key of ["alert_acked_with_clip", "alert_live", "alert_unknown_type"]) {
    const a = parseSiteAlert(F[key]);
    // The website owns every sentence a customer reads; the server owns facts.
    assert.equal("message" in a, false, `${key} must carry no message`);
    assert.equal(typeof a.type, "string");
    assert.equal(typeof a.colour, "string");
  }
});

test("an unknown alert type still parses, and carries grey", () => {
  // A newer hub forwards a type this build never heard of. An alert whose word
  // we cannot name is still an alert that must appear.
  const a = parseSiteAlert(F.alert_unknown_type);
  assert.equal(a.type, "GENERATOR_LOW");
  assert.equal(a.colour, "grey");
});

test("getSiteAlert reads one alert by id", async () => {
  const f = fakeFetch(() => json(F.alert_acked_with_clip));
  const a = await client(f).getSiteAlert("26ba7dd47c66402e9f1a0c8e4b1d3f55");
  assert.equal(
    f.calls[0].url,
    "https://coord.test/v1/viewer/site-alerts/26ba7dd47c66402e9f1a0c8e4b1d3f55",
  );
  assert.equal(f.calls[0].method, "GET");
  assert.equal(a.rev, 7);
});

test("getSiteAlert: 404 alert_unknown is NotFoundError (unknown == not yours)", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "alert_unknown", message: "no such alert" } }, 404),
  );
  await assert.rejects(
    () => client(f).getSiteAlert("deadbeef"),
    (err) => err.name === "NotFoundError" && err.code === "alert_unknown",
  );
});

test("ackSiteAlert POSTs with NO body and returns the updated alert", async () => {
  const f = fakeFetch(() => json(F.alert_acked_with_clip));
  const a = await client(f).ackSiteAlert("26ba7dd47c66402e9f1a0c8e4b1d3f55");

  assert.equal(f.calls[0].method, "POST");
  assert.match(f.calls[0].url, /\/site-alerts\/26ba7dd47c66402e9f1a0c8e4b1d3f55\/ack$/);
  // Who acknowledged is the authenticated caller, never a name in a request: a
  // name in the body would be an unverified claim written into an audit fact.
  assert.equal(f.calls[0].body, undefined);
  assert.equal(a.acknowledged, true);
  assert.equal(a.acknowledged_by, "Terra Industries");
});

test("clip URLs are never cached — a re-read mints fresh ones", async () => {
  let n = 0;
  const f = fakeFetch(() => {
    n += 1;
    const alert = structuredClone(F.alert_acked_with_clip);
    alert.clips[0].url = `/v1/viewer/alerts/clip?key=k&exp=${1793190000 + n}&sig=s${n}`;
    return json(alert);
  });
  const c = client(f);
  const first = await c.getSiteAlert("a");
  const second = await c.getSiteAlert("a");
  assert.notEqual(first.clips[0].url, second.clips[0].url, "a new URL per request");
  // ...and the stable identity is the key, which does NOT change.
  assert.equal(first.clips[0].key, second.clips[0].key);
});

test("rev orders updates: a stale forward cannot overwrite a fresh row", () => {
  const gate = new AlertRevisionGate();
  const fresh = parseSiteAlert({ ...F.alert_live, rev: 7, recovered_at: "2026-10-28T12:30:00Z" });
  const stale = parseSiteAlert({ ...F.alert_live, rev: 4 });

  assert.equal(gate.accept(fresh), true);
  // Without this the recovered alert flips back to live on screen, because the
  // live frame and the recovery read race and nothing else orders them.
  assert.equal(gate.accept(stale), false, "rev 4 must not land after rev 7");
  assert.equal(gate.accept(fresh), false, "an equal rev carries no new fact");
  assert.equal(gate.revOf(fresh.id), 7);

  const newer = parseSiteAlert({ ...F.alert_live, rev: 8 });
  assert.equal(gate.accept(newer), true);
});

/* ================================================================== *
 * 2. The live channel — docs/alerts.md section 4, GET /v1/viewer/events
 * ================================================================== */

/** The exact bytes `events.py` writes: `retry:`/`: open`, frames, `: keepalive`. */
function sseBytes(...blocks) {
  return new TextEncoder().encode(blocks.join(""));
}
const OPEN = "retry: 3000\n: open\n\n";
const KEEPALIVE = ": keepalive\n\n";
const frameFor = (kind, alert, id) =>
  `id: ${id}\nevent: ${kind}\ndata: ${JSON.stringify(alert)}\n\n`;

/** A reader over scripted chunks, as `resp.body.getReader()` gives one. */
function streamOf(chunks, { thenHang = false } = {}) {
  let i = 0;
  let cancelled = false;
  return {
    getReader: () => ({
      read: async () => {
        if (cancelled) return { done: true };
        if (i < chunks.length) return { done: false, value: chunks[i++] };
        if (!thenHang) return { done: true };
        // Model an idle-but-open stream: resolves only on cancel.
        return await new Promise((resolve) => {
          const t = setInterval(() => {
            if (cancelled) {
              clearInterval(t);
              resolve({ done: true });
            }
          }, 5);
        });
      },
      cancel: async () => {
        cancelled = true;
      },
    }),
  };
}

test("a keepalive and the opening comment are IGNORED, not surfaced", () => {
  assert.equal(parseSseFrame(": keepalive"), null);
  assert.equal(parseSseFrame("retry: 3000\n: open"), null);
  // ...and a `retry:` on its own is the browser's hint, not an error.
  assert.equal(parseSseFrame("retry: 3000"), null);
});

test("SseBuffer reassembles a frame split across two reads", () => {
  const whole = frameFor("alert.new", F.alert_live, 12);
  const cut = Math.floor(whole.length / 2);
  const buf = new SseBuffer();
  // The network does not respect \n\n. A parser that treated each chunk as a
  // frame would drop the tail of one alert and the head of the next, which is
  // what makes an event channel look "mostly reliable".
  assert.deepEqual(buf.push(whole.slice(0, cut)), []);
  const frames = buf.push(whole.slice(cut));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "alert.new");
  assert.equal(frames[0].id, "12");
  assert.equal(JSON.parse(frames[0].data).id, F.alert_live.id);
});

test("alertEventOf parses alert.new and alert.updated off real frames", () => {
  const buf = new SseBuffer();
  const frames = buf.push(
    OPEN +
      frameFor("alert.new", F.alert_live, 12) +
      KEEPALIVE +
      frameFor("alert.updated", F.alert_acked_with_clip, 13),
  );
  const events = frames.map(alertEventOf).filter(Boolean);
  assert.equal(events.length, 2, "two events, and the keepalive is not one of them");
  assert.equal(events[0].kind, "alert.new");
  assert.equal(events[0].alert.type, "TOWER_OFFLINE");
  assert.equal(events[1].kind, "alert.updated");
  assert.equal(events[1].alert.acknowledged, true);
  assert.equal(events[1].id, "13");
});

test("an unknown event kind is ignored rather than thrown on", () => {
  const [frame] = new SseBuffer().push('event: alert.archived\ndata: {"id":"x"}\n\n');
  // A new kind on this channel is an additive server change; a reader that
  // threw would turn it into a broken dashboard.
  assert.equal(alertEventOf(frame), null);
});

test("a frame CLAIMING to be an alert with bad data is a real failure", () => {
  const [frame] = new SseBuffer().push("event: alert.new\ndata: {not json\n\n");
  assert.throws(() => alertEventOf(frame), (err) => err instanceof ValidationError);
});

test("subscribeSiteAlerts reads the stream with fetch and a Bearer header", async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith("/v1/viewer/events")) {
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        stream: streamOf(
          [sseBytes(OPEN), sseBytes(KEEPALIVE), sseBytes(frameFor("alert.new", F.alert_live, 12))],
          { thenHang: true },
        ),
      };
    }
    return json({ alerts: [], colours: F.colours });
  });

  const seen = [];
  const sub = client(f).subscribeSiteAlerts({ onAlert: (e) => seen.push(e) });
  while (seen.length === 0) await new Promise((r) => setTimeout(r, 5));
  sub.stop();
  await sub.done;

  const events = f.calls.find((c) => c.url.endsWith("/v1/viewer/events"));
  assert.ok(events, "it must call /v1/viewer/events");
  // ⚠ NOT EventSource, which cannot set this header — the whole reason this
  // helper exists rather than the browser's own one-liner.
  assert.equal(events.headers.Authorization, "Bearer vt_abc");
  assert.equal(events.headers.Accept, "text/event-stream");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, "alert.new");
  assert.equal(seen[0].alert.id, F.alert_live.id);
});

test("on a drop it reconnects AND re-reads listSiteAlerts from the last alert seen", async () => {
  const opens = [];
  const lists = [];
  const f = fakeFetch((url) => {
    if (url.endsWith("/v1/viewer/events")) {
      opens.push(url);
      if (opens.length === 1) {
        // One frame, then the stream ENDS — which is what a slow reader gets,
        // and what the 65th subscriber on a node gets immediately.
        return {
          status: 200,
          stream: streamOf([sseBytes(frameFor("alert.new", F.alert_live, 12))]),
        };
      }
      return { status: 200, stream: streamOf([], { thenHang: true }) };
    }
    lists.push(url);
    // The recovery read turns up the SAME alert, recovered and at a higher rev.
    return json({
      alerts: [{ ...F.alert_live, rev: 9, recovered_at: "2026-10-28T12:40:00Z" }],
      colours: F.colours,
    });
  });

  const seen = [];
  const errors = [];
  const sub = client(f).subscribeSiteAlerts({
    onAlert: (e) => seen.push(e),
    onError: (e) => errors.push(e),
    retryMs: 10,
  });
  while (lists.length === 0 || seen.length < 2) await new Promise((r) => setTimeout(r, 5));
  sub.stop();
  await sub.done;

  assert.ok(opens.length >= 2, "it must reconnect after the drop");
  assert.ok(errors.length >= 1, "the drop is reported, informationally");
  // THE RECOVERY READ IS FROM THE LAST ALERT SEEN, not from zero: the stream
  // replays nothing, deliberately, so `since` is the only way to close the gap.
  assert.match(lists[0], /[?&]since=1793189400$/);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].alert.rev, 9, "the recovered row, from the recovery read");
  assert.equal(seen[1].alert.recovered_at, "2026-10-28T12:40:00Z");
});

test("a recovery read cannot push a STALE row over a live frame", async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith("/v1/viewer/events")) {
      return f.calls.filter((c) => c.url.endsWith("/v1/viewer/events")).length === 1
        ? { status: 200, stream: streamOf([sseBytes(frameFor("alert.updated", { ...F.alert_live, rev: 9 }, 1))]) }
        : { status: 200, stream: streamOf([], { thenHang: true }) };
    }
    // ...and the list still has the OLD revision of that row.
    return json({ alerts: [{ ...F.alert_live, rev: 2 }], colours: F.colours });
  });

  const seen = [];
  const sub = client(f).subscribeSiteAlerts({
    onAlert: (e) => seen.push(e),
    onError: () => {},
    retryMs: 10,
  });
  // Wait for the reconnect's recovery read to have happened.
  while (!f.calls.some((c) => c.url.includes("/v1/viewer/site-alerts?"))) {
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 30));
  sub.stop();
  await sub.done;

  assert.equal(seen.length, 1, "rev 2 from the recovery read must be dropped");
  assert.equal(seen[0].alert.rev, 9);
});

test("subscribe surfaces an auth failure like every other route", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "unauthorized", message: "authentication required" } }, 401),
  );
  const errors = [];
  const sub = client(f).subscribeSiteAlerts({
    onAlert: () => {},
    onError: (e) => errors.push(e),
    retryMs: 10,
  });
  while (errors.length === 0) await new Promise((r) => setTimeout(r, 5));
  sub.stop();
  await sub.done;
  assert.equal(errors[0].name, "AuthError");
  assert.equal(errors[0].code, "unauthorized");
});

/* ================================================================== *
 * 3. listArchivedRecordings — docs/footage-sync.md 3.5 and 4.4.2
 * ================================================================== */

const recordings = (extras = {}) => ({
  device_id: "kln_lab_000001",
  camera: 1,
  archive_enabled: true,
  segments: [
    {
      key: "archive/kln_lab_000001/cam1/2026-10-26/2026-10-26_01-00-00.mp4",
      camera: 1,
      device_id: "kln_lab_000001",
      start: "2026-10-26T01:00:00.000Z",
      start_epoch: 1792976400,
      duration: 900,
      size: 118374912,
      url: "/v1/viewer/recordings/segment?key=k0&exp=1&sig=s0",
      download_url: "/v1/viewer/recordings/segment?key=k0&exp=1&sig=s0&dl=1",
      filename: "labtower1_cam1_2026-10-26_02-00-00_WAT.mp4",
    },
  ],
  ...extras,
});

test("a healthy archive: every new field EMPTY, never an error", async () => {
  const f = fakeFetch(() => json(recordings(F.timeline_extras_healthy)));
  const out = await client(f).listArchivedRecordings("kln_lab_000001", "cam1");

  assert.equal(out.segments.length, 1, "the playable timeline is untouched");
  assert.deepEqual(out.timeUnknown, [], "empty, not undefined and not a throw");
  assert.deepEqual(out.towerSpans, []);
  assert.equal(out.towerTimesUnreliable, false);
  assert.equal("towerSync" in out, false, "the tower said nothing about its sync");
});

test("tower_spans map, carry no url, and keep a segment's own arithmetic", async () => {
  const f = fakeFetch(() => json(recordings(F.timeline_extras_with_spans)));
  const out = await client(f).listArchivedRecordings("kln_lab_000001", "cam1");

  assert.equal(out.towerSpans.length, 1);
  const [span] = out.towerSpans;
  assert.equal(span.camera, 1);
  assert.equal(span.start, "2026-10-26T03:00:00.000Z");
  assert.equal(span.startEpoch, 1792983600);
  assert.equal(span.duration, 5400);
  assert.equal(span.state, "on_tower");
  // THE ONLY HONEST DIFFERENCE from a playable segment. A span with a URL would
  // be offering something to play that does not exist on the hub yet.
  assert.equal("url" in span, false);
  assert.equal("downloadUrl" in span, false);
  // Same keys a segment carries, so one piece of arithmetic lays both out.
  for (const key of ["start", "startEpoch", "duration"]) {
    assert.ok(key in out.segments[0] && key in span, `both carry ${key}`);
  }
});

test("tower_sync carries state and the five-value VERDICT", async () => {
  const f = fakeFetch(() => json(recordings(F.timeline_extras_with_spans)));
  const out = await client(f).listArchivedRecordings("kln_lab_000001", "cam1");
  assert.deepEqual(out.towerSync, { state: "sending", reason: "behind" });
  assert.equal(out.towerCopy, "tower");
});

test("tower_copy hub_only and tower_times_unreliable come through", async () => {
  const f = fakeFetch(() => json(recordings(F.timeline_extras_no_disk)));
  const out = await client(f).listArchivedRecordings("kln_lab_000001", "cam1");
  assert.equal(out.towerCopy, "hub_only");
  // Said out loud rather than silently dropping the spans: "this tower holds
  // footage whose times cannot be trusted" is a fact an operator can act on.
  assert.equal(out.towerTimesUnreliable, true);
  assert.deepEqual(out.towerSync, { state: "unavailable", reason: "no_recording_disk" });
});

test("time_unknown rows map, and stay OUT of segments", async () => {
  const f = fakeFetch(() => json(recordings({ time_unknown: F.time_unknown_rows })));
  const out = await client(f).listArchivedRecordings("kln_lab_000001", "cam1");

  assert.equal(out.segments.length, 1, "undated footage is not on the timeline");
  assert.equal(out.timeUnknown.length, 1);
  const [row] = out.timeUnknown;
  assert.match(row.key, /_unknown\.mp4$/, "the fact travels in the name");
  assert.equal(row.camera, 1);
  assert.equal(row.deviceId, "kln_lab_000001");
  assert.equal(row.size, 118374912);
  assert.equal(row.filename, "labtower1_cam1_2026-10-26_06-12-44_WAT_unknown.mp4");
  // `arrived` is when the HUB RECEIVED it, not when it happened.
  assert.equal(row.arrived, "2026-10-26T05:12:44.000Z");
  assert.equal(row.arrivedEpoch, 1792991564);
  // Playable from `url` exactly like a timeline segment — resolved absolute.
  assert.equal(
    row.url,
    "https://coord.test/v1/viewer/recordings/segment?key=k1&exp=1793190000&sig=s1",
  );
  assert.match(row.downloadUrl, /&dl=1$/);
  // AND IT HAS NEITHER OF THE TWO FIELDS WHOSE VALUE WOULD BE A GUESS.
  assert.equal("start" in row, false);
  assert.equal("duration" in row, false);
});

test("an undated row carrying start or duration is REJECTED", async () => {
  const dated = [
    { ...F.time_unknown_rows[0], start: "2026-10-26T05:12:44.000Z" },
    { ...F.time_unknown_rows[0], key: "b_unknown.mp4", duration: 900 },
  ];
  const f = fakeFetch(() => json(recordings({ time_unknown: dated })));
  const out = await client(f).listArchivedRecordings("kln_lab_000001", "cam1");
  // Dropping the row loses one playable item from a side list; keeping it draws
  // footage at a time it was not recorded AND cuts the real segment before it
  // short to the gap in front of the intruder.
  assert.deepEqual(out.timeUnknown, []);
});

/* ================================================================== *
 * 4. The device footage block — footage-sync.md 3.3/3.4/3.4.1, alerts.md 8
 * ================================================================== */

const tower = (over = {}) => ({
  device_id: "kln_lab_000001",
  label: "LAB TOWER 1",
  link: "up",
  as_of: "2026-10-27T08:00:00Z",
  cameras: [],
  sensors: [],
  ...over,
});

test("the footage block parses as a sibling of health, field for field", () => {
  const t = parseTowerInfo(tower({ footage: F.footage_healthy }));
  const fo = t.footage;

  assert.equal(fo.as_of, "2026-10-27T08:00:00.000Z");
  assert.equal(fo.times, "reliable");
  assert.equal(fo.footage_stream, "2k");
  assert.equal(fo.record_stream, "main");
  assert.equal(fo.copy, "tower");
  assert.deepEqual(fo.clock, { state: "synced", unsynced_at_record_start: true });

  assert.equal(fo.sync.state, "ready");
  assert.equal(fo.sync.free_pct, 71.2);
  assert.equal(fo.sync.total_gb, 1863);
  assert.equal(fo.sync.separate_disk, true);

  assert.equal(fo.cameras.length, 2);
  const [one] = fo.cameras;
  assert.equal(one.camera, 1);
  const [stream] = one.streams;
  assert.equal(stream.stream, "main");
  assert.equal(stream.segments, 672);
  assert.equal(stream.bytes, 77000000000);
  assert.equal(stream.unconfirmed_segments, 12);
  assert.equal(stream.unconfirmed_bytes, 1390000000);
  assert.equal(stream.unplaced_segments, 2);
  assert.deepEqual(stream.spans, [
    {
      from: "2026-10-20T00:00:00.000Z",
      to: "2026-10-27T03:00:00.000Z",
      segments: 96,
      bytes: 11000000000,
      confirmed_bytes: 11000000000,
    },
  ]);
});

test("sync.reason is the VERDICT and sync.blocked_by is the tower's code", () => {
  // `behind`, derived by the hub from oldest_unconfirmed_start against the same
  // four hours FOOTAGE_SYNC_BEHIND fires at — with no blocked_by, because
  // nothing is blocking it.
  const healthy = parseTowerInfo(tower({ footage: F.footage_healthy })).footage;
  assert.equal(healthy.sync.reason, "behind");
  assert.equal("blocked_by" in healthy.sync, false);

  // ...and on a tower with no SSD, BOTH: the verdict a screen reads, and the
  // refusal code this key used to carry.
  const noDisk = parseTowerInfo(tower({ footage: F.footage_no_disk })).footage;
  assert.equal(noDisk.sync.reason, "no_recording_disk");
  assert.equal(noDisk.sync.blocked_by, "no_recording_disk");
  assert.equal(noDisk.sync.state, "unavailable");
  assert.equal(noDisk.sync.separate_disk, false);
  assert.equal(noDisk.copy, "hub_only");
  assert.equal(noDisk.times, "unreliable");
});

test("all five sync.reason verdicts parse", () => {
  for (const reason of ["ok", "behind", "unreachable", "no_recording_disk", "recording_off"]) {
    const t = parseTowerInfo(tower({ footage: { sync: { state: "ready", reason } } }));
    assert.equal(t.footage.sync.reason, reason);
  }
});

test("all five blocked_by codes parse", () => {
  for (const code of [
    "no_recording_disk",
    "recording_disabled",
    "wireguard_link",
    "no_recording_path",
    "cannot_determine",
  ]) {
    const t = parseTowerInfo(
      tower({ footage: { sync: { state: "unavailable", blocked_by: code } } }),
    );
    assert.equal(t.footage.sync.blocked_by, code);
  }
});

test("a tower that said nothing about sync gets NO verdict", () => {
  // `ok` derived from silence is a guess on a screen — the same mistake as
  // rendering an unreported camera as live.
  const fo = parseTowerInfo(tower({ footage: F.footage_silent_sync })).footage;
  assert.equal("sync" in fo, false);
  assert.equal(fo.copy, "tower");
  assert.equal(fo.cameras[0].streams[0].segments, 4);
});

test("oldest_unconfirmed_start crosses, and _exact is read as === false", () => {
  const fo = parseTowerInfo(tower({ footage: F.footage_healthy })).footage;

  // Camera 1: the start could NOT be established exactly.
  const inexact = fo.cameras[0].streams[0];
  assert.equal(inexact.oldest_unconfirmed_start, "2026-10-27T03:00:00.000Z");
  assert.equal(inexact.oldest_unconfirmed_exact, false);

  // Camera 2: it could — so the field is ABSENT, and that absence is the
  // stronger statement. It must never be defaulted to true.
  const exact = fo.cameras[1].streams[0];
  assert.equal(exact.oldest_unconfirmed_start, "2026-10-27T07:00:00.000Z");
  assert.equal("oldest_unconfirmed_exact" in exact, false);
});

test("a tower with no footage block has no footage key — not an empty one", () => {
  // Absent is not an empty archive: a tower that has never said is not a tower
  // with nothing, and that difference is the honest one.
  const t = parseTowerInfo(tower());
  assert.equal("footage" in t, false);
});

test("the footage block reaches the TOWER LIST too, not just the detail", async () => {
  const f = fakeFetch(() => json({ towers: [tower({ footage: F.footage_no_disk })] }));
  const [t] = await client(f).listTowers();
  // It is projected onto the tower itself, so the list carries it — which is
  // where a fleet board reads it from.
  assert.equal(t.footage.sync.reason, "no_recording_disk");
  assert.equal(t.footage.copy, "hub_only");
});
