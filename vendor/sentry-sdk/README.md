# @kallon/sentry-sdk

The typed TypeScript client and shared data-contract library for **Sentry v2** — what
the dashboard (and any other consumer) uses to talk to the coordination service.

Source of truth for every shape in here is
[`sentry-core/docs/session-protocol.md`](../sentry-core/docs/session-protocol.md),
protocol **v1**, including the frozen inventory contract of **§A.1–§A.13**. Each type
cites the section it comes from. If a type here and the protocol disagree, **the protocol
is right and this package is a bug.**

- **Zero runtime dependencies.** Platform `fetch` / `AbortController` only.
- **One devDependency**, `typescript`.
- **`dist/` is committed** so a `file:` or `github:` consumer needs no build step.

## What it is, and what it is not

| | |
|---|---|
| **Is** | The viewer ↔ coordination HTTPS client — sessions (§4.2.1), PTZ (§4.2.2), inventory/health (§4.2.3) — and the shapes a viewer sees |
| **Is** | A typed exception per protocol error code, over the `{error:{code,message}}` envelope |
| **Is** | Runtime validation of every response at the client boundary |
| **Is not** | WebRTC. The **dashboard** owns the `RTCPeerConnection`; the SDK owns the signaling conversation that sets it up (§4.1 puts media between viewer and MediaMTX, never through coordination) |
| **Is not** | The tower link. §1–§3 is tower ↔ coordination over WSS and no viewer speaks it |
| **Is not** | Recording / playback. §9 lists those messages as *reserved and rejected at v1*; see "Deferred" below |

This is a **fresh v2 build**, not a port. The v1 SDK's *pattern* carries over — one
versioned base URL, one error envelope, an exception hierarchy, a dependency-free fetch
wrapper with timeouts. Its *data model* does not: there is no `vpn_ip`, no
`wg_public_key`, no `hub_*`, no enrollment lifecycle. v2 has no VPN and no hub.

## Install

**During development — local path** (what the dashboard uses now):

```jsonc
// sentry-dashboard/package.json
{
  "dependencies": {
    "@kallon/sentry-sdk": "file:../sentry-sdk"
  }
}
```

```bash
npm install
```

**For deploy — GitHub reference:**

```jsonc
{
  "dependencies": {
    "@kallon/sentry-sdk": "github:<org>/sentry-sdk#v0.1.0"
  }
}
```

Pin a tag or commit, not a branch — a moving `#main` makes a deploy non-reproducible.

Both forms work with **no build step in the consumer**, because `dist/` is committed.

### Why `dist/` is committed

A `github:` dependency is fetched as a git tree, not as a published tarball. npm runs
`prepare` for git dependencies, but that requires the consumer's install environment to
have the SDK's devDependencies and a working toolchain — and on Vercel, `NODE_ENV=production`
means devDependencies are skipped, so `tsc` is not there to run and the install fails with a
missing entrypoint. Committing `dist/` sidesteps the whole class of problem: the tree that
lands on disk is already the built package. This is the same reason v1 did it.

The cost is real and worth stating: **`dist/` must be rebuilt and committed with every
source change**, or consumers silently get stale code. `npm run build` before every commit
that touches `src/`. `.gitattributes` marks `dist/` generated so it collapses in diffs.

### Package name

`@kallon/sentry-sdk`, not `@sentry/sdk`. The `@sentry` npm scope belongs to Sentry.io
(the error-tracking product), whose packages are `@sentry/browser`, `@sentry/node` and
so on. Even installing only from `file:`/`github:`, naming this `@sentry/sdk` invites a
genuinely confusing mistake the first time someone types `npm install @sentry/...`.
`kln_` is already the device-id prefix, so the scope matches the fleet.

## Usage

The full viewer flow. Note where the SDK stops and the dashboard's WebRTC starts:

```ts
import { SentryClient, TowerOfflineError, isSessionEnded } from "@kallon/sentry-sdk";

const client = new SentryClient({
  baseUrl: "https://coord.example.com",   // no /v1 — that is in the paths
  token: () => auth.getAccessToken(),     // string, or a (possibly async) provider
});

// §4.2 (1) — open a session. The viewer gets a session_id and ICE servers.
// It never gets the grant: coordination mints that and sends it to the tower.
const session = await client.createSession({ device_id: "kln_lab_000002", camera: 1 });

// The dashboard's job, not the SDK's.
const pc = new RTCPeerConnection({ iceServers: session.ice_servers });
pc.addTransceiver("video", { direction: "recvonly" });
pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; };
await pc.setLocalDescription(await pc.createOffer());
await waitForIceGathering(pc);           // §4.5: non-trickle is the phase-one baseline

// §4.2 (2) — relay the offer. Blocks server-side until the tower answers (§10.3).
const sdpAnswer = await client.sendOffer(session, pc.localDescription!.sdp);
await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });

// §4.2 (9) — teardown. Idempotent. Call it on unload too, or the tower waits for a reap.
await client.closeSession(session);
```

### Errors

```ts
try {
  await client.sendOffer(session, sdp);
} catch (err) {
  if (err instanceof TowerOfflineError) {
    // §7.6 — an absent tower is an ANSWER, not a wait. Show it. Do not queue.
    // (`err.retryable` is false here on purpose.)
    ui.showOffline(err.message);
  } else if (isSessionEnded(err)) {
    // §10.1 — grant expiry ends a live session. Start a new one.
    await restart();
  } else throw err;
}
```

Every failure is a `SentryError` subclass carrying the raw `code` and `status`, so an
error code this package predates still arrives typed and inspectable.

### PTZ

Axes are the daemon's ONVIF-normalized values (§5.1): `pan`/`tilt` in `-1…1`, `zoom` in
`0…1` absolute or `-1…1` as a rate. The SDK clamps; the **tower** converts to degrees and
coordination does no PTZ maths.

```ts
// Hold-to-move, with the §5.1 keepalive handled for you.
const held = await client.ptzHold(session, 1, { mode: "jog", pan: 0.5 });
// ...on pointer-up:
await held.stop();
```

`ptzHold` keeps the daemon's **4 s deadman** (`PTZ_DEADMAN_MS`) fed at ~1.5 s
(`PTZ_KEEPALIVE_MS`), because over a WAN that budget includes RTT. Its `stop()` always
issues a real `stop`, which §5.3 makes unconditional on the tower — refusing a stop can
only leave a camera moving.

`SUPERSEDED` is a **normal** outcome for a rapid tap or direction change (§5.2). Route
PTZ failures through `isNormalPtzOutcome(err)` before rendering anything.

## Client methods → protocol sections

| Method | Endpoint | Section |
|---|---|---|
| `createSession({device_id, camera})` | `POST /v1/viewer/sessions` | §4.2 |
| `sendOffer(session, sdp)` | `POST .../offer` — `application/sdp`, blocks for the answer | §4.2, §10.3 |
| `sendIceCandidates(session, [...])` | `PATCH .../ice` | §4.2, §4.5 |
| `getIceCandidates(session)` | `GET .../ice` | §4.2, §4.5 |
| `closeSession(session)` | `DELETE /v1/viewer/sessions/{id}` — idempotent | §4.2, §4.6 |
| `sendPtz` / `ptzMove` / `ptzStop` / `ptzKeepalive` / `ptzStatus` / `ptzHold` | `POST .../ptz` | §4.2.2, §5.1, §5.2 |
| `listTowers()` | `GET /v1/viewer/towers` | §4.2.3 |
| `getTower(device_id)` | `GET /v1/viewer/towers/{device_id}` | §4.2.3 |
| `renameTower(device_id, label)` | `PATCH /v1/viewer/towers/{device_id}` — `{label}`; route not yet in §4.2 | §A.3.1 |

PTZ is **session-scoped**: the session is the authorization, and §4.2.2 defines no PTZ
endpoint outside one. Coordination checks the session grant covers `ptz` and that camera,
relays the command verbatim as §5.1 `ptz.command`, and returns the §5.2 `ptz.result`.

## Runtime validation

v1's SDK had none: types were erased and every body was a blind `as` cast, so a contract
drift surfaced in the dashboard as `Cannot read properties of undefined`, hundreds of lines
from the actual fault. **This was not deferred.** Every response is checked at the client
boundary and a mismatch raises `ValidationError` with the failing field paths:

```
ValidationError: session from the coordination service did not match the session-protocol shape
  issues: [ "camera: expected finite number, got string",
            "ice_servers[0].urls: expected array, got number" ]
```

It is hand-rolled (`src/validate.ts`, ~250 lines) rather than Zod, because the package
validates six shapes with shallow checks and the zero-runtime-dependency rule is worth
more than a schema DSL at that size. If the surface grows past ~20 shapes, revisit.

It is **structural, not exhaustive**, and deliberately **does not reject unknown fields**:
§2.2 makes forward compatibility explicit, and a validator that rejects a field added last
week turns a compatible change into an outage.

## Shapes → protocol sections

| Type | Section |
|---|---|
| `ViewerSession`, `CreateSessionRequest`, `IceServer` | §4.2 |
| `IceCandidate`, `IceCandidatesRequest/Response` | §4.2, §4.5 |
| `SessionCloseReason` | §4.6 |
| `GrantPermission`, `GrantRole` — the *vocabulary* a viewer sees | §6.1 |
| `PtzCommand`, `PtzMoveParams`, `PtzAxes`, `PtzResult`, `PtzStatusResult`, `PtzErrorCode` | §5.1, §5.2 |
| `TowerInfo`, `TowerListResponse`, `TowerDetail`, `CameraInfo`, `CameraResolution`, `SensorInfo`, `LinkState`, `CameraStatus`, `CameraRole` | §A.2, §A.3, §A.9 — the **projected** inventory |
| `TowerHealth` — door · cover · impact · thermal · disk · feeds | §3.1, §3.4 |
| `TowerStateEvent`, `TowerStateReason` | §3.4 |
| `ApiError`, `ApiErrorCode`, `ApiErrorEnvelope` + the exception hierarchy | §4.2, §7.1 |

Two notes on what is **absent** on purpose:

- **No grant type.** The viewer never receives a grant (§4.2, §16.3) — only an opaque
  `session_id`. Modelling the grant here would suggest a viewer might hold one.
- **No `whep_path`** on `CameraInfo`, and no MediaMTX `Location`. The viewer never speaks
  WHEP, and the `Location` handle is tower-local and MUST NOT reach it (§4.3 step 4).

### Inventory and health

`listTowers()` and `getTower(device_id)` consume the **projected** inventory of §A.3 —
coordination's narrowing of `tower.hello`, not the hello itself (§A.1). Four things to
know before building a fleet board on it:

**Freshness is not uniform, and that is the whole point of §A.3.2.**

| Field | Guarantee |
|---|---|
| `link` | **Always current.** Coordination watches the WSS link directly |
| `cameras[].status` | **Last-known, as of `as_of`.** The tower reports it; coordination knows only what it was last told |

A camera reading `"live"` under `link: "down"` with an ageing `as_of` is true only in the
past tense — render it as stale. The SDK guarantees `as_of` is present and parseable and
then **surfaces it untouched**: applying a freshness threshold is your call, not the SDK's.
`getTower` carries a second stamp, `health_as_of`, for the sensor block; they are usually
the same instant but are served separately, so read the one that stamps what you're drawing.

**`status: "unknown"` is valid and you will see it.** Until §A.10.5 puts per-camera
liveness on `tower.state`, a conforming service serves `"unknown"` rather than inferring —
a guessed `"live"` is exactly what §A.3.2 forbids. Never render it as good.

**A leak throws.** `path`, `whep_path` and `boot_id` are §A.6's MUST-NOT tier; a projection
carrying any of them, anywhere, raises `ProjectionLeakError` naming the exact field paths.
This is the one place the SDK rejects an unknown field, because §A.6 puts that obligation
on the consumer — a leak is a coordination bug and must be loud at the door. `codec`,
`calibrated` and internal health detail are the SHOULD-omit tier and are tolerated silently.

**`tower_unknown` conflates "no such tower" with "not yours"** (§4.2.3), so the endpoint
cannot enumerate the fleet. Surface it as *unavailable*, never as *does not exist*.

### Tiles, promotion, and the two 403s

A dual-lens body is **two cameras sharing an `enclosure`** (§A.4), not one camera with
sub-feeds — the protocol never had a sub-feed and §A.7 explains why it must not gain one.
Group by `enclosure` (else `index`) to form a tile; `role: "primary"` is the main view and
secondaries are swappable insets.

**Promotion is a session change, not a view toggle** (§A.5): promoting an inset means
viewing a different `index`, so `closeSession` → `createSession` → a new peer connection.
It is also a permission checkpoint, and the two refusals are **different classes**:

| Situation | Wire | Class | What to do |
|---|---|---|---|
| Promotion refused — `createSession` on the new index | `403 not_authorized` | `AuthError` | A valid outcome, not an error to paper over. Leave the tile as it was |
| PTZ command refused | `403 grant_permission` | `GrantError`, and `isPtzPermissionDenied(err)` | Flip that camera's controls to disabled "view only" for the session (§A.8) |

A `createSession` that never receives a grant cannot fail on a grant's permissions — §A.12
#5 corrected an earlier draft that said otherwise. Use `isPtzPermissionDenied()` rather
than `instanceof GrantError` for the view-only flip: `GrantError` also covers
`grant_expired`, which wants a new session, not a disabled control.

**Render PTZ controls on `ptz_capable`, never on permission** (§A.8). Capability is a
hardware fact you can read from inventory; permission lives in the grant the viewer never
receives, so it is unknowable up front and only discoverable by trying.

### Permissions and lifetime are not yours to ask for

`createSession` takes `{device_id, camera}` and there is **no field** for `permissions`,
`lifetime_sec`, `role` or `viewer_ref` — not even an optional one. §4.2.1 and §6.5 make
this a security boundary: coordination derives all of them from the viewer's authenticated
role, and a conforming service ignores or `422`s any that appear in the body.

An optional field would invite a call site to set it and then believe it had asked for
something. There is nothing to ask for. A test locks this in — see
`test/smoke.test.mjs`, "createSession cannot be made to request permissions or a lifetime".

> The development stub in `sentry-core/coordination/stub/server.py` still accepts those
> fields and mints from them. That is a stub shortcut with no authentication behind it, is
> recorded as a known deviation in §4.2, and the real coordination service must not copy it.

## Deferred

**Recording and playback are not built.** §9 lists `recording.request` / `recording.chunk`
as *reserved, rejected at v1*, and `permissions: ["recordings","arm"]` as *defined,
unused*. Architecture §15 records that egress transport is unresolved and `RECORD_ENABLE=0`
on both towers, so **no segments exist yet**. Modelling a playback API against a protocol
that rejects its messages would be inventing a contract. `GrantPermission` already carries
the words for it.

Also deferred, and reflected as fields rather than features: TURN servers and
`ice_config.policy: "relay"` (§9 — phase one is direct-only), and the PTZ `priority` field
(absent at v1; single commander today per §10.4).

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run build        # clean, then ESM + CJS + .d.ts into dist/
npm test             # builds, then node --test (built-in runner, no test dep)
git add dist && git commit   # dist/ is committed — do not skip this
```

Layout:

```
src/models.ts     shapes, each citing its protocol section
src/errors.ts     SentryError + one subclass per failure mode; code → class map
src/validate.ts   response validation at the client boundary
src/http.ts       fetch wrapper: timeouts, auth header, JSON vs SDP, error mapping
src/client.ts     SentryClient — one method per §4.2 endpoint
src/index.ts      public surface
test/             node --test smoke tests over an injected fetch
```

Targets ES2022 with `lib: ["ES2022"]` only — no `DOM`, no `@types/node`. Nothing
DOM-typed or Node-typed appears in the public API, so a consumer never has to add a `lib`
or `@types` entry to build against this package, and `fetch` can be injected for tests.
