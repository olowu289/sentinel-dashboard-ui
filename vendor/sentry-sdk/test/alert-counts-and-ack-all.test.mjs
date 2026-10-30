/**
 * The badge count, the batch acknowledgement, and the event it puts on the
 * live channel — on the real bytes of a running node.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHERE THESE BODIES CAME FROM
 * ══════════════════════════════════════════════════════════════════════
 *
 * `test/fixtures/alert_counts_and_ack_all.json` is not a transcription and not
 * a projection function's return value: a coordination node at sentry-core
 * `e368a3f` was started on a loopback port with the harness from its own
 * `test_alert_counts_and_ack_all.py`, and these are the HTTP responses it gave
 * and the bytes it wrote to its event stream while the ack-all was in flight.
 * The fixture's header says exactly how.
 *
 * That is worth the trouble for the same reason the alerts fixtures were:
 * a shape I typed by hand would agree with the type I wrote beside it and
 * prove nothing. Four things here would have been typed wrong — a cleared
 * tower is ABSENT from `by_device` rather than zero; a missing anchor and an
 * unresolvable one are the same 400 with the same sentence; the `from`
 * refusals are two MORE sentences under that one status; and the event frame
 * echoes the `from` it used, which the whitelist would otherwise drop.
 *
 * The `from` window is pinned by what it LEAVES BEHIND rather than by the
 * number it returns: a count is one number and would pass against the wrong
 * bound, so the tests read the counts the node gave afterwards and check that
 * the alert outside the window is still outstanding.
 *
 *   node --test test/alert-counts-and-ack-all.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AuthError,
  InvalidRequestError,
  SentryClient,
  SseBuffer,
  ValidationError,
  alertEventOf,
  isAlertRowEvent,
  parseAlertsAcknowledged,
  parseSiteAlertCounts,
} from "../dist/esm/index.js";

const F = JSON.parse(
  readFileSync(new URL("./fixtures/alert_counts_and_ack_all.json", import.meta.url), "utf8"),
);
const A = JSON.parse(
  readFileSync(new URL("./fixtures/alerts_and_footage.json", import.meta.url), "utf8"),
);

const D1 = "kln_north_000001";
const D2 = "kln_north_000002";

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
 * 1. GET /v1/viewer/site-alerts/counts
 * ================================================================== */

test("siteAlertCounts asks the counts route and maps by_device → byDevice", async () => {
  const f = fakeFetch(() => json(F.counts_two_towers));
  const counts = await client(f).siteAlertCounts();

  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://coord.test/v1/viewer/site-alerts/counts");
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[0].headers.Authorization, "Bearer vt_abc");

  assert.equal(counts.total, 5);
  assert.deepEqual(counts.byDevice, { [D1]: 3, [D2]: 2 });
  // The wire name must not survive into the object a dashboard reads.
  assert.equal("by_device" in counts, false);
});

test("A DEVICE WITH NONE IS ABSENT, not a zero", () => {
  // The same node one ack-all later: three alerts on the first tower were
  // acknowledged and the tower leaves the map entirely.
  const counts = parseSiteAlertCounts(F.counts_after_ack);

  assert.equal(counts.total, 2);
  assert.equal(counts.byDevice[D1], undefined, "the cleared tower is gone, not 0");
  assert.equal(counts.byDevice[D2], 2);
  // Which is why a card reads it through `?? 0`. Rendering `byDevice[id]`
  // straight puts "undefined" on every quiet tower, and most are quiet.
  assert.equal(counts.byDevice[D1] ?? 0, 0);
});

test("a fleet with nothing outstanding is a zero and an empty map", () => {
  const counts = parseSiteAlertCounts(F.counts_empty);
  assert.equal(counts.total, 0);
  assert.deepEqual(counts.byDevice, {});
});

test("a count that is not a number fails loudly, with the path", () => {
  // A badge that renders as nothing on a tower with fifty outstanding is worth
  // failing for — this is the one case where silence is worse than an error.
  assert.throws(
    () => parseSiteAlertCounts({ total: 2, by_device: { [D1]: null } }),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.issues.join(" "), /\$\.by_device\.kln_north_000001: expected finite number/);
      return true;
    },
  );
  assert.throws(() => parseSiteAlertCounts({ by_device: {} }), ValidationError);
});

test("siteAlertCounts surfaces the real 401 as an AuthError", async () => {
  const { status, body } = F.counts_unauthenticated;
  const f = fakeFetch(() => json(body, status));
  await assert.rejects(client(f).siteAlertCounts(), (err) => {
    assert.ok(err instanceof AuthError, `got ${err.constructor.name}`);
    assert.equal(err.code, "unauthorized");
    return true;
  });
});

test("siteAlertCounts surfaces a 403 as an AuthError", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "not_authorized", message: "not yours" } }, 403),
  );
  await assert.rejects(client(f).siteAlertCounts(), (err) => {
    assert.ok(err instanceof AuthError, `got ${err.constructor.name}`);
    assert.equal(err.code, "not_authorized");
    return true;
  });
});

/* ================================================================== *
 * 2. POST /v1/viewer/site-alerts/ack-all
 * ================================================================== */

test("ackAllSiteAlerts posts the anchor and reads back how many changed", async () => {
  const f = fakeFetch(() => json(F.ack_all_filtered));
  const result = await client(f).ackAllSiteAlerts({
    upTo: "camera_stopped-kln_north_000001-2",
    deviceId: D1,
  });

  const [call] = f.calls;
  assert.equal(call.url, "https://coord.test/v1/viewer/site-alerts/ack-all");
  assert.equal(call.method, "POST");
  assert.deepEqual(JSON.parse(call.body), {
    up_to: "camera_stopped-kln_north_000001-2",
    device_id: D1,
  });
  assert.equal(result.acknowledged, 3);
});

test("every optional field maps to its snake_case name, and nothing else is sent", async () => {
  const f = fakeFetch(() => json(F.ack_all_from_and_site));
  await client(f).ackAllSiteAlerts({
    upTo: "tower_offline-kln_north_000002-1",
    from: "2026-10-29T08:00:00Z",
    siteId: F.site_id,
    deviceId: D2,
    // ⚠ TRANSPORT OPTIONS SHARE THIS ARGUMENT and must not reach the wire. A
    // spread instead of a whitelist is how `timeoutMs` ends up looking like a
    // filter the server might one day start reading.
    timeoutMs: 9000,
  });

  assert.deepEqual(JSON.parse(f.calls[0].body), {
    up_to: "tower_offline-kln_north_000002-1",
    from: "2026-10-29T08:00:00Z",
    site_id: F.site_id,
    device_id: D2,
  });
});

test("an unfiltered sweep sends the anchor ALONE — no nulls for what was omitted", async () => {
  const f = fakeFetch(() => json(F.ack_all_unfiltered));
  await client(f).ackAllSiteAlerts({ upTo: "tower_offline-kln_north_000002-1" });
  const body = JSON.parse(f.calls[0].body);
  assert.deepEqual(Object.keys(body), ["up_to"]);
});

test("0 acknowledged is a normal answer, not a failure", async () => {
  // A second click on a screen already cleared. Nothing changed, so nothing is
  // announced on the live channel either.
  const f = fakeFetch(() => json(F.ack_all_nothing_left));
  const result = await client(f).ackAllSiteAlerts({ upTo: "tower_offline-kln_north_000002-1" });
  assert.equal(result.acknowledged, 0);
});

test("a missing `acknowledged` is a contract break, never a silent 0", async () => {
  const f = fakeFetch(() => json({}));
  await assert.rejects(client(f).ackAllSiteAlerts({ upTo: "x" }), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.issues.join(" "), /\$\.acknowledged: expected finite number/);
    return true;
  });
});

test("the real 400 for an anchor the server cannot resolve is an InvalidRequestError", async () => {
  const { status, body } = F.ack_all_bad_anchor;
  const f = fakeFetch(() => json(body, status));
  await assert.rejects(
    client(f).ackAllSiteAlerts({ upTo: "no-such-alert" }),
    (err) => {
      assert.ok(err instanceof InvalidRequestError, `got ${err.constructor.name}`);
      assert.equal(err.code, "invalid_request");
      // The sentence to put in front of an operator comes from the server.
      assert.match(err.apiError.message, /list is out of date/i);
      return true;
    },
  );
  // ⚠ AND A MISSING ANCHOR IS THE SAME ANSWER, word for word. An id this
  // account may not see must be indistinguishable from one that never existed,
  // or the anchor becomes a way to learn somebody else's alert is there.
  assert.deepEqual(F.ack_all_no_anchor.body, F.ack_all_bad_anchor.body);
});

test("ackAllSiteAlerts surfaces a 403 as an AuthError", async () => {
  const f = fakeFetch(() =>
    json({ error: { code: "not_authorized", message: "not yours" } }, 403),
  );
  await assert.rejects(client(f).ackAllSiteAlerts({ upTo: "x" }), (err) => {
    assert.ok(err instanceof AuthError, `got ${err.constructor.name}`);
    return true;
  });
});

/* ================================================================== *
 * 2a. `from` — the near end of the window
 * ================================================================== */

test("`from` NARROWS THE SWEEP, and the alert outside it survives", async () => {
  // Three alerts on one tower, a second apart. `from` is the MIDDLE one's
  // second and the anchor is the newest, so two are in the window and the
  // oldest is not.
  const f = fakeFetch(() => json(F.ack_all_with_from));
  const result = await client(f).ackAllSiteAlerts({
    upTo: F.anchor_newest_d1,
    from: F.from_at_second_alert,
  });

  assert.deepEqual(JSON.parse(f.calls[0].body), {
    up_to: F.anchor_newest_d1,
    from: F.from_at_second_alert,
  });
  assert.equal(result.acknowledged, 2);

  // ⚠ AND THIS IS THE ASSERTION THAT MATTERS. "2" alone would pass against a
  // route that ignored `from` and happened to find two rows; what proves the
  // bound is the one the node LEFT BEHIND. Before the sweep: three on that
  // tower. After it: one, still unanswered, because it is older than `from`.
  assert.equal(F.counts_before.by_device[D1], 3);
  assert.equal(F.counts_after_from.by_device[D1], 1);
  // The other tower was never in scope of this anchor at all.
  assert.equal(F.counts_after_from.by_device[D2], 2);
});

test("NO OFFSET MEANS UTC — the same instant, bare, gets the same answer", async () => {
  // `2026-10-26T07:33:21` and `2026-10-26T07:33:21Z` are one instant to this
  // route. Left to a naive `datetime` it would have been read in whatever zone
  // the answering machine sits in, which is a different set of alerts.
  assert.equal(F.from_no_offset + "Z", F.from_at_second_alert);

  const f = fakeFetch(() => json(F.ack_all_from_no_offset));
  const result = await client(f).ackAllSiteAlerts({
    upTo: F.anchor_newest_d1,
    from: F.from_no_offset,
  });

  assert.equal(result.acknowledged, 2, "the bare form must not shift the window");
  assert.deepEqual(F.counts_after_no_offset, F.counts_after_from);
});

test("the window is INCLUSIVE at both ends", async () => {
  // `from` on the anchor's own second acknowledges exactly the anchor: one
  // row, not zero. A range shown on a screen starts at a moment, and an alert
  // raised in that second is on the screen.
  const f = fakeFetch(() => json(F.ack_all_from_equals_anchor));
  const result = await client(f).ackAllSiteAlerts({
    upTo: F.anchor_newest_d1,
    from: "2026-10-26T07:33:22Z",
  });
  assert.equal(result.acknowledged, 1);
});

test("a `from` the route cannot read is an InvalidRequestError of its own", async () => {
  for (const block of ["ack_all_unreadable_from", "ack_all_impossible_date"]) {
    const { status, body } = F[block];
    const f = fakeFetch(() => json(body, status));
    await assert.rejects(
      client(f).ackAllSiteAlerts({ upTo: F.anchor_newest_d1, from: "not-a-date" }),
      (err) => {
        assert.ok(err instanceof InvalidRequestError, `${block}: ${err.constructor.name}`);
        assert.equal(err.code, "invalid_request");
        assert.match(err.apiError.message, /dates could not be read/i);
        return true;
      },
    );
  }
});

test("a `from` later than the anchor is refused rather than answered 0", async () => {
  // Nobody can have seen alerts from after the newest row on their own screen.
  // A 0 here would read as a click that worked.
  const { status, body } = F.ack_all_backwards_from;
  const f = fakeFetch(() => json(body, status));
  await assert.rejects(
    client(f).ackAllSiteAlerts({ upTo: F.anchor_newest_d1, from: "2026-10-26T07:41:40Z" }),
    (err) => {
      assert.ok(err instanceof InvalidRequestError);
      assert.match(err.apiError.message, /ends before it starts/i);
      return true;
    },
  );
});

test("THREE REFUSALS, THREE SENTENCES — one status, and a UI must tell them apart", () => {
  // Same class and same code, because they are all "the request was wrong".
  // The remedy differs: reload the list, or choose the dates again. A screen
  // that printed one sentence for all three would send two callers the wrong
  // way, so the message is the server's to write and ours to show.
  const messages = [
    F.ack_all_bad_anchor,
    F.ack_all_unreadable_from,
    F.ack_all_backwards_from,
  ].map((r) => {
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "invalid_request");
    return r.body.error.message;
  });
  assert.equal(new Set(messages).size, 3, messages.join(" | "));
});

test("a refused sweep changes NOTHING — every alert is still outstanding", () => {
  // Captured after all three refusals in a row on one node.
  assert.deepEqual(F.counts_untouched_by_refusals, F.counts_before);
});

test("both bounds and a site filter travel together", async () => {
  const f = fakeFetch(() => json(F.ack_all_from_and_site));
  const result = await client(f).ackAllSiteAlerts({
    upTo: "tower_offline-kln_north_000002-1",
    from: "2026-10-26T07:35:00Z",
    siteId: F.site_id,
  });
  assert.deepEqual(JSON.parse(f.calls[0].body), {
    up_to: "tower_offline-kln_north_000002-1",
    from: "2026-10-26T07:35:00Z",
    site_id: F.site_id,
  });
  assert.equal(result.acknowledged, 2);
  // The site's own tower cleared; the one outside the window untouched.
  assert.equal(F.counts_after_from_and_site.by_device[D2], undefined);
  assert.equal(F.counts_after_from_and_site.by_device[D1], 3);
});

/* ================================================================== *
 * 3. The alerts.acknowledged frame
 * ================================================================== */

/** The node's own bytes, split into frames exactly as the client does. */
const framesOf = (raw) => new SseBuffer().push(raw);

test("the real alerts.acknowledged bytes parse, with device_id → deviceId", () => {
  // `retry: 3000`, `: open`, then the frame — captured off the live stream the
  // moment the ack-all landed.
  const frames = framesOf(F.sse_acknowledged_raw);
  const event = alertEventOf(frames[frames.length - 1]);

  assert.equal(event.kind, "alerts.acknowledged");
  assert.equal(event.count, 3);
  assert.equal(event.deviceId, D1);
  assert.equal(event.id, "1");
  // Absent, never null — the same rule the alert rows follow.
  assert.equal("siteId" in event, false);
  // ⚠ AND NO ALERTS. One frame stands for the whole batch; a reader that
  // expects a row here is holding stale ones and does not know it.
  assert.equal("alert" in event, false);
  assert.equal(isAlertRowEvent(event), false);
});

test("the site-filtered sweep carries site_id → siteId instead", () => {
  const frames = framesOf(F.sse_acknowledged_site_raw);
  const event = alertEventOf(frames[frames.length - 1]);

  assert.equal(event.count, 2);
  assert.equal(event.siteId, F.site_id);
  assert.equal("deviceId" in event, false);
  assert.equal(event.id, "2");
});

test("the frame ECHOES THE WINDOW the sweep used, in UTC", () => {
  // The real bytes of a sweep sent with `from`. The field is the caller's own
  // filter, which is why it is in the body at all — unlike the devices, which
  // are the delivery scope and stay out of it.
  const frames = framesOf(F.sse_acknowledged_from_raw);
  const event = alertEventOf(frames[frames.length - 1]);

  assert.equal(event.kind, "alerts.acknowledged");
  assert.equal(event.count, 2);
  assert.equal(event.from, F.from_at_second_alert);
  // ⚠ RFC 3339 IN UTC whatever offset it was sent in, so every subscriber
  // reads one format rather than parsing whatever the clicker's browser sent.
  assert.match(event.from, /Z$/);
  assert.equal("siteId" in event, false);
  assert.equal("deviceId" in event, false);
});

test("the window and a site filter arrive on the same frame", () => {
  const frames = framesOf(F.sse_acknowledged_from_site_raw);
  const event = alertEventOf(frames[frames.length - 1]);

  assert.equal(event.count, 2);
  assert.equal(event.siteId, F.site_id);
  assert.match(event.from, /^2026-10-26T\d\d:\d\d:\d\dZ$/);
  assert.equal("deviceId" in event, false);
});

test("a sweep with no window carries no `from` key at all", () => {
  // Absent, never null — the rule the alert rows follow, and the reason a
  // dashboard can ask `"from" in event` to know whether a range was used.
  const frames = framesOf(F.sse_acknowledged_raw);
  const event = alertEventOf(frames[frames.length - 1]);
  assert.equal("from" in event, false);
});

test("the payload is a WHITELIST — a field the server adds is not carried", () => {
  // The scope the publisher filters on is deliberately not in the body; if it
  // ever appears there, it still must not reach a dashboard.
  const event = parseAlertsAcknowledged({
    count: 4,
    device_id: D1,
    device_ids: [D1, D2],
    scope: { device_ids: [D1] },
  });
  assert.deepEqual(event, { kind: "alerts.acknowledged", count: 4, deviceId: D1 });
});

test("a null filter is dropped rather than carried through", () => {
  const event = parseAlertsAcknowledged({
    count: 1,
    site_id: null,
    device_id: null,
    from: null,
  });
  assert.deepEqual(event, { kind: "alerts.acknowledged", count: 1 });
});

test("a frame CLAIMING to be an acknowledgement without a count is a real failure", () => {
  const [frame] = framesOf('event: alerts.acknowledged\ndata: {"site_id":"s1"}\n\n');
  assert.throws(
    () => alertEventOf(frame),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.match(err.issues.join(" "), /\$\.count: expected finite number/);
      return true;
    },
  );
});

test("an unknown event kind is STILL dropped, exactly as before", () => {
  // The whole point of adding one kind is that the next one still costs
  // nothing: a new kind on this channel is an additive server change.
  for (const kind of ["alert.archived", "alerts.cleared", "hub.hello"]) {
    const [frame] = framesOf(`event: ${kind}\ndata: {"count":1}\n\n`);
    assert.equal(alertEventOf(frame), null, `${kind} must be ignored`);
  }
});

/* ================================================================== *
 * 4. Delivery through subscribeSiteAlerts
 * ================================================================== */

function streamOf(chunks, { thenHang = false } = {}) {
  let i = 0;
  let cancelled = false;
  return {
    getReader: () => ({
      read: async () => {
        if (cancelled) return { done: true };
        if (i < chunks.length) return { done: false, value: chunks[i++] };
        if (!thenHang) return { done: true };
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

const bytes = (...blocks) => new TextEncoder().encode(blocks.join(""));

/** Drive a subscription over scripted stream bytes until `want` events land. */
async function collect(chunks, want) {
  const f = fakeFetch((url) => {
    if (url.endsWith("/v1/viewer/events")) {
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        stream: streamOf(chunks, { thenHang: true }),
      };
    }
    return json({ alerts: [], colours: A.colours });
  });
  const seen = [];
  const sub = client(f).subscribeSiteAlerts({ onAlert: (e) => seen.push(e) });
  while (seen.length < want) await new Promise((r) => setTimeout(r, 5));
  sub.stop();
  await sub.done;
  return { seen, f };
}

test("subscribeSiteAlerts DELIVERS alerts.acknowledged beside the alerts", async () => {
  const { seen } = await collect(
    [
      bytes(F.sse_acknowledged_raw.slice(0, F.sse_acknowledged_raw.indexOf("id: 1"))),
      bytes(`id: 7\nevent: alert.new\ndata: ${JSON.stringify(A.alert_live)}\n\n`),
      bytes(F.sse_acknowledged_raw.slice(F.sse_acknowledged_raw.indexOf("id: 1"))),
    ],
    2,
  );

  assert.equal(seen.length, 2);
  assert.equal(seen[0].kind, "alert.new");
  assert.ok(isAlertRowEvent(seen[0]));
  assert.equal(seen[0].alert.id, A.alert_live.id);

  // The one that used to be dropped on the floor.
  assert.equal(seen[1].kind, "alerts.acknowledged");
  assert.equal(isAlertRowEvent(seen[1]), false);
  assert.equal(seen[1].count, 3);
  assert.equal(seen[1].deviceId, D1);
});

test("subscribeSiteAlerts delivers the window on the frame it arrived with", async () => {
  const frame = F.sse_acknowledged_from_raw.slice(
    F.sse_acknowledged_from_raw.indexOf("id: 1"),
  );
  const { seen } = await collect([bytes(frame)], 1);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, "alerts.acknowledged");
  assert.equal(seen[0].from, F.from_at_second_alert);
  assert.equal(seen[0].count, 2);
});

test("a batch acknowledgement is NOT gated — two of them are two events", async () => {
  // The revision gate orders rows by `rev`. This frame has no row and no rev,
  // so there is nothing to order and nothing to de-duplicate: a second sweep
  // is a second fact, and dropping it would lose the only notice a dashboard
  // gets that its badges are wrong again.
  const frame = F.sse_acknowledged_raw.slice(F.sse_acknowledged_raw.indexOf("id: 1"));
  const { seen } = await collect([bytes(frame), bytes(frame)], 2);

  assert.equal(seen.length, 2);
  assert.ok(seen.every((e) => e.kind === "alerts.acknowledged" && e.count === 3));
});

test("a duplicate ALERT is still dropped by rev, beside an ungated one", async () => {
  // Both behaviours in one stream, so the ungating above cannot be read as the
  // gate having been switched off.
  const alertFrame = `event: alert.updated\ndata: ${JSON.stringify(A.alert_live)}\n\n`;
  const ackFrame = F.sse_acknowledged_raw.slice(F.sse_acknowledged_raw.indexOf("id: 1"));
  const { seen } = await collect(
    [bytes(alertFrame), bytes(alertFrame), bytes(ackFrame)],
    2,
  );

  assert.equal(seen.length, 2, "the repeated alert must not be delivered twice");
  assert.equal(seen[0].kind, "alert.updated");
  assert.equal(seen[1].kind, "alerts.acknowledged");
});

test("an acknowledgement does not move the recovery watermark", async () => {
  // The watermark is `started_epoch`, which this frame does not have. If the
  // ack were allowed to touch it, a reconnect would re-read from the wrong
  // place — or from `undefined`, skipping the recovery read altogether.
  const ackFrame = F.sse_acknowledged_raw.slice(F.sse_acknowledged_raw.indexOf("id: 1"));
  const alertFrame = `event: alert.new\ndata: ${JSON.stringify(A.alert_live)}\n\n`;

  const f = fakeFetch((url) => {
    if (url.endsWith("/v1/viewer/events")) {
      // One short stream, then an idle one: the end of the first is a drop,
      // and a drop is what triggers the recovery read.
      const first = f.calls.filter((c) => c.url.endsWith("/v1/viewer/events")).length === 1;
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        stream: first
          ? streamOf([bytes(ackFrame), bytes(alertFrame)])
          : streamOf([], { thenHang: true }),
      };
    }
    return json({ alerts: [], colours: A.colours });
  });

  const seen = [];
  const sub = client(f).subscribeSiteAlerts({ onAlert: (e) => seen.push(e), retryMs: 10 });
  let recovery;
  while (!recovery) {
    await new Promise((r) => setTimeout(r, 5));
    recovery = f.calls.find((c) => c.url.includes("/v1/viewer/site-alerts?since="));
  }
  sub.stop();
  await sub.done;

  // The alert's own epoch, not anything the acknowledgement left behind.
  assert.ok(
    recovery.url.endsWith(`since=${A.alert_live.started_epoch}`),
    `recovery read from the wrong watermark: ${recovery.url}`,
  );
});
