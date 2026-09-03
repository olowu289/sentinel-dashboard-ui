# Backend integration — the campaign reference

Documentation only. Nothing here is imported, built or executed.

This is the record of four read-only study passes over this frontend and over the real
system it is being wired to, plus the plan that came out of them. It exists because the
decisions below were expensive to reach and are cheap to forget — and because several of
them look arbitrary until you read why.

**Read `README.md` and `CLAUDE.md` first.** They are the design record for the frontend
itself. This file covers only the integration.

**Decision on record:** this frontend is the foundation. Its UI, design, motion and
components are kept; every faked behaviour is replaced with the real, proven logic from
`sentry-core` / `sentry-sdk` / `sentry-dashboard`. The frontend has excellent *display*
honesty and no *action* honesty — every mutation is fire-and-forget. Closing that gap is
the job.

---

## Contents

1. [The three sibling repos](#1-the-three-sibling-repos)
2. [This frontend, as found](#2-this-frontend-as-found)
3. [Functional inventory — what each surface fakes](#3-functional-inventory--what-each-surface-fakes)
4. [Capability map](#4-capability-map)
5. [The real system, as built](#5-the-real-system-as-built)
6. [What does not exist](#6-what-does-not-exist)
7. [Joining architecture](#7-joining-architecture)
8. [Seam map](#8-seam-map)
9. [`src/lib/api/` signatures](#9-srclibapi-signatures)
10. [Roadmap](#10-roadmap)
11. [Risk register](#11-risk-register)
12. [What we keep untouched](#12-what-we-keep-untouched)
13. [Stage ledger](#13-stage-ledger)

---

## 1. The three sibling repos

| Path | What it is |
|---|---|
| `../sentry-sdk` | `@kallon/sentry-sdk` — typed, signaling-only client for coordination. 2 746 lines of TS, zero runtime deps. |
| `../sentry-core/coordination` | The Python coordination service the SDK talks to. Owns accounts, sessions, grants, the tower WSS link, the inventory projection. |
| `../sentry-dashboard` | The proven Next.js client. **The reference implementation of the honest logic.** Read it before writing the equivalent here. |

Protocol authority is `../sentry-core/docs/session-protocol.md` (protocol v1). The SDK's
own doc comments cite it section by section; where a type and the document disagree, the
document is right.

---

## 2. This frontend, as found

**Stack.** Vite 7 + React 19 + TypeScript 5.9 (strict, `noUnusedLocals`,
`verbatimModuleSyntax`) + Tailwind v4 via `@tailwindcss/vite` + `motion` v12. npm. No
router, no state library, no test runner, no linter. `npm run build` (= `tsc --noEmit &&
vite build`) is the only gate.

Three runtime dependencies: `react`, `react-dom`, `motion`. `sharp` sits in
`devDependencies` with no consumer — inferred to be an ad-hoc tool for the Figma image
exports.

**Structure.** Flat and shallow. `src/App.tsx` (664 lines) is simultaneously the router
and the entire store; `src/components/` is 37 files with no subfolders; `src/lib/` holds
`types.ts`, `data.ts` (the seed), `time.ts`, `dateFilter.ts`, `motion.ts` and three hooks.

**Five screens**, selected by a ternary chain in `App.tsx`:

| Screen | File |
|---|---|
| Fleet dashboard (landing) | `src/components/DashboardView.tsx` |
| Tower view | `src/components/TowerView.tsx` |
| Fleet alerts | `src/components/AlertsView.tsx` |
| People of interest | `src/components/PeopleView.tsx` |
| Add tower | `src/components/AddTowerView.tsx` |

Plus `CameraSettingsPanel` (1 170 lines, the largest file), `ClipPlayer`, the fullscreen
tile takeover, and `StateSimulator` (a `Shift+S` review affordance).

**No backend, no auth, no persistence.** Grepped and confirmed: zero `fetch`/`axios`/
`WebSocket`/`EventSource`, zero `localStorage`/`sessionStorage`/IndexedDB, zero
`import.meta.env`. The only network access is Google Fonts in `index.html`. The signed-in
operator is two string constants (`"A. Bello"` at `App.tsx:38`, `"A. Okafor"` inline at
`App.tsx:530`).

**Why `App.tsx` owns everything** — this is load-bearing and documented in `CLAUDE.md`:
both walls render the same feeds, and the recording tick and latency walk are live, so a
copy each would have the fleet wall and the tower wall disagreeing about one camera within
a second. Keep it that way.

**Strengths for this work.** Timestamps are epoch ms everywhere, never pre-formatted.
Domain types in `src/lib/types.ts` are already close to backend-shaped. Presentation is
genuinely dumb — views take data and callbacks. `src/lib/data.ts` is a single clean seam.

**The cost.** All ~20 mutations are synchronous optimistic `setState` with no loading,
error, retry or rollback path anywhere in the app.

---

## 3. Functional inventory — what each surface fakes

### Fleet dashboard

Shows `TowersPanel` (a `TowerCard` per tower, `PendingTowerCard` on top) beside a camera
wall banded by tower.

Fakes: the `TOWERS` seed; **`status` authored, not derived** (the README lists this as a
known gap — the word and the numbers beside it can disagree); battery moved by the 1 s
interval at `App.tsx:392`; alert counts from the `ALERTS` seed; `formatRelative` computed
once and never re-ticked. The dismissed-notice set is component-local `useState` in
`TowersPanel.tsx:38`, and `DashboardView` unmounts on every drill-in — so a dismissed
notice returns after a single visit to a tower.

The two-cameras-per-tower assumption is **not** `CAMERAS_PER_TOWER` (grepped: nothing
reads it). It is the hardcoded `grid-cols-2` at `DashboardView.tsx:293`, plus the seed and
`UnclaimedUnit.cameras` always arriving as a 2-tuple.

### Tower view

`TopBar` + optional `NewAlertBanner`/`LiveViewBanner` + the camera wall + a right column
that is *either* `AlertsPanel` or `CameraSettingsPanel`.

`CameraTile.tsx:208` branches `feed.video ? <video src> : <img src={poster}>`. **No seed
sets `video`, so the video branch is dead code.** `MonitorTile.tsx:174` has no branch at
all. Both apply the PTZ transform to the media element, which is why it will work
unchanged on a real `<video>`.

The eight simulator states are six real `FeedState`s plus two synthesised tiers.
`"Reconnecting… attempt 3 of 5"` (`CameraTile.tsx:265`) and `"Last seen 14:02"`
(`:267`) are **hardcoded literals**. The error string is one constant, `App.tsx:28`.

The eight tile actuators (`src/lib/useTileControls.ts:172`), shared by both walls:

| Control | Real? |
|---|---|
| Fullscreen | real (view only) |
| Record | flips `feed.state`, no session, no artifact |
| Talk | `setInterval` timer + a red border. No audio captured or sent. |
| Siren | Web Audio oscillator **in the operator's browser**, not at the site |
| Screenshot | `setFlash(true)` + `setTimeout(180)`. Nothing is written. |
| Zoom ± | local CSS transform |
| Overlays | **dead** — toggles state nothing reads |

PTZ (`PtzPad.tsx`) issues five commands into a local CSS transform, with hold repeating at
**8 Hz** (125 ms). Bounds: `BASE_SCALE 1.15`, `PAN_STEP 2.5%`, zoom 1–3, pan clamped to
`((scale-1)/(2*scale))*100`.

### Camera settings panel

Despite the name it is **tower-wide** (`TowerView.tsx:281` passes `tower.id` into a
parameter named `feedId`). Thirteen operational device settings — detect mode,
sensitivity, zones, night vision, stream quality, recording quality, mic, speaker volume,
recording mode, retention, power mode, monitoring master switch, tower rename — plus six
read-only telemetry rows.

None is cosmetic in intent; **all are cosmetic in effect.** Every one merges into an
in-memory `Record<string, CameraSettings>` in `App.tsx` that no other component reads.
Turning `monitoring` off does not stop the simulator raising alerts. "Update Firmware"
(`CameraSettingsPanel.tsx:794`) has no `onClick`.

The zone editor (`:938`) is the most integration-ready code in the repo: real pointer
capture with `pointercancel`/`lostpointercapture` handling, normalised 0–1 coordinates,
`MAX_ZONES = 3`, sub-5 % drafts discarded.

### Alerts

`AlertsView` (fleet) and `AlertsPanel` (per-tower) share `AlertRow`, `AlertDetail`, the
date filter and `ClipPlayer` deliberately.

Fakes: `setStatus` stamps `acknowledgedBy: "A. Okafor"` — a hardcoded name that is **not**
the `OPERATOR` constant, and with no timestamp. `Escalate` (`AlertDetail.tsx:405`) and the
hero frame's play button (`:265`) are **dead controls**. The seed is computed relative to
page load (`data.ts:31`), so the feed is only "live" relative to when the tab opened.

`ClipPlayer` is the most elaborate fake in the repo: real transport — play/pause, 0.5–4×
rate, ±10 s skip, seek, mute, prev/next-*detection* jumps, a scrubber marked with the
alert's own timeline, a wall-clock playhead — all driven by a `requestAnimationFrame`
clock over a static JPEG. Its own comment says swapping in a real `<video>` means
replacing that clock with `timeupdate` and leaving everything else alone.

### People / watchlist

The best-modelled thing in the repo: `reason` and `expiresAt` are **required**, and
`stoppedReason`/`stoppedBy`/`stoppedAt` record why watching ended. Sightings are derived
from `alerts.filter(a => a.matchedPersonId === id)`, so the roster and the feed cannot
disagree.

**There is no matcher, and the README says so.** `matchedPersonId` and `confidence: 91`
are hand-written into the seed; enrolling somebody produces zero future matches; the
uploaded photo becomes a `URL.createObjectURL` blob that dies on reload
(`PeopleView.tsx:651`); expiry stops nothing because nothing was matching.

### Add tower

Five step components. `FakeQr` encodes nothing. `setTimeout(HANDOFF_MS = 4500)` at
`AddTowerView.tsx:386` **claims unconditionally**. Manual entry string-matches one minted
unit. Four "bringing online" checks resolve on `setTimeout(900)` each. `nextUnclaimed()`
mints units arithmetically and never runs out of hardware. `pending` survives navigation
but not a reload.

### Settings, and identity

The rail declares a `settings` destination (`IconRail.tsx:13`) that `navigate()` does not
handle — a silent no-op. There is no application-settings surface at all.

Identity appears in the UI at the person detail's ADDED/STOPPED fields, the alert detail's
"Resolved by …", and the enrolment disclosure "your name stays on it."

### Cross-cutting

Three simulation intervals in `App.tsx`, and where each value is displayed:

| Interval | Writes | Read by |
|---|---|---|
| Battery, 1 s (`:392`) | `tower.batteryPct` | `TowerCard` mast + hover panel, `TopBar` glyph, settings header, `AddTowerView` |
| Recording elapsed, 1 s (`:414`) | `feed.elapsedSec` | `FeedChip` only (`RECORDING mm:ss`), plus the frozen/reconnecting discriminators |
| Latency walk, 1.4 s (`:429`) | `feed.latencyMs` | `FeedChip` — `{ms}ms`, its tone, and the wifi glyph |

Plus the talk timer, `SiteClock`, and the live-viewing counter.

`tower.link` is authored and never changes. `tower.status` is authored — nothing derives
it from the readings.

**Persistence: nothing survives a reload.** Wall order, all camera settings and zones,
every acknowledgement, every enrolment (and its blob URL), every stop/extend/delete, every
rejected match, the pending claim, renamed towers, simulator feed states. And because the
seed is computed at module load, a reload re-times the entire alert feed.

---

## 4. Capability map

`FAKED` = the UI performs the behaviour with a local stand-in. `ABSENT` = no representation.

| Screen | login/session | enrollment | live video | per-camera status | PTZ | recording | renewal/expiry | honest failure |
|---|---|---|---|---|---|---|---|---|
| Fleet dashboard | ABSENT | FAKED (`pending`) | FAKED (posters; no video branch) | FAKED (6 states, no unknown/stale) | FAKED (CSS) | FAKED (state flip) | ABSENT | PARTIAL — good fallbacks; authored `status`; no freshness |
| Tower view | ABSENT | N/A | FAKED (video branch never fires) | FAKED (literals for attempts/last-seen) | FAKED (8 Hz → CSS) | FAKED | FAKED (battery advisory only) | GOOD for stream failure; ABSENT for command failure |
| Camera settings | FAKED (stamps, never shows) | N/A | N/A | read-only authored `link` | ABSENT | FAKED | ABSENT | ABSENT — no field can fail, retry or pend |
| Alerts | FAKED (hardcoded acker) | N/A | FAKED (rAF over a JPEG) | N/A | N/A | FAKED (seed clips) | ABSENT | PARTIAL — absence is diagnostic; 2 dead controls |
| People | FAKED (`addedBy`) | N/A | N/A | N/A | N/A | N/A | FAKED (expiry stops nothing) | ABSENT — no matcher |
| Add tower | ABSENT | **FAKED most heavily** | FAKED | FAKED | N/A | N/A | ABSENT (no release path) | PARTIAL — real inline error on manual entry |
| Settings (rail) | ABSENT | N/A | N/A | N/A | N/A | N/A | N/A | ABSENT — silent no-op |

---

## 5. The real system, as built

Everything in this section was read from source, not assumed. The proving file is named.

### 5.1 Signaling is browser-direct

`sentry-dashboard` has **no API routes** (`find app -name route.ts` → nothing), no
`server-only`, no `next/headers`. All 31 component/page files are `"use client"`.
`lib/sdk.ts` builds the client in page JS from `NEXT_PUBLIC_SENTRY_API_URL`;
`lib/http.ts` calls `globalThis.fetch` in the browser.

Nothing structural is Next-specific. The whole Next surface in the client path is
`process.env.NEXT_PUBLIC_*`, `next/font`, and `useRouter` in `AuthGate`.

### 5.2 The SDK is browser-safe

`grep -rE 'from "(next|node:|fs|path|crypto|buffer|stream|http|os)"|require\(|process\.|server-only'`
over `sentry-sdk/src/` → **no hits**. Same over `dist/esm/`.

It needs three platform globals, declared ambiently rather than imported
(`src/http.ts:53`, `src/env.d.ts`): `fetch`, `AbortController`, timers. Packaging:
`"type": "module"`, `sideEffects: false`, an `exports` map, `dist/esm/package.json` =
`{"type":"module"}`, `.js` extensions on internal imports, `lib: ["ES2022"]` only — **no
DOM types in the public API** (`FetchResponseLike`/`AbortSignalLike` are structural). No
React anywhere; no peer dependencies.

> ### ⚠ THE MANDATORY BOUND FETCH
>
> `sentry-dashboard/lib/http.ts` exists solely for this. The SDK stores `fetch` and calls
> it as `this.doFetch(...)` (`sentry-sdk/src/http.ts:144` and `:187`), detaching it from
> `Window`. Chrome brand-checks and throws:
>
> ```
> TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
> ```
>
> Symptom: **login works and every SDK call fails, in the same tab** — a bare `fetch(...)`
> falls back to the global receiver, a stored one does not. Node's undici does not
> brand-check, so **no Node test catches it.**
>
> Always pass `fetch: sdkFetch` where `sdkFetch = (u, i) => globalThis.fetch(u, i)`.
> Never `export const f = globalThis.fetch` — that re-detaches it.

### 5.3 Session: bearer token in `sessionStorage`

`lib/auth/session.ts`, key `sentinel.session.v1`, holding `{ref, expiresAt, account}`.
An httpOnly cookie is *unavailable* to this architecture, not merely unchosen: the browser
calls coordination directly and the SDK sets `Authorization: Bearer <ref>` in page JS, and
a cookie JS cannot read cannot go into that header. `sessionStorage` over `localStorage`
so it dies with the tab.

The token reaches the SDK as a **callback**: `token: () => getSessionRef()`. A captured
string would keep sending a revoked reference until a full reload.

**Login exists.** ⚠ `sentry-dashboard/lib/auth/contract.ts` says there is no login route —
**that comment is stale.** `coordination/stub/server.py:1587` routes it, implemented at
`:1491`, with tests in `coordination/tests/test_auth_routes.py`.

```
POST /v1/auth/login  {login, password}
  200 {session_ref, expires_at, account{account_id, login, role, status}}
  401 {error:{code:"unauthorized"}}   ← uniform: unknown org, wrong password and
                                        disabled account are indistinguishable,
                                        with a constant-time hash on unknown logins
  422 invalid_request · 501 not_configured
POST /v1/auth/logout  (Bearer)
```

**`login` is sent verbatim.** No trim, no lowercase, no unicode folding.
`accounts._normalise_login` is the identity function *by decision*, so `" Terra"` is a
different login and must fail.

Session resolution on load uses **no `whoami`** — it calls `listTowers()`. 200 = valid,
401 = not. **An empty tower list is a valid 200**; treating empty as unauthenticated would
sign out every new account.

### 5.4 TLS: a private CA, and the browser must trust it

```
sentry-core/tls/ca.crt            CN=Kallon Sentry Local CA   (to 2036)
sentry-core/tls/coordination.crt  CN=coordination, issued by the above
                                  SAN: IP:192.168.1.230, IP:127.0.0.1, DNS:localhost
```

`sentry-core/docs/tower-bringup.md:250` names the failure. Confirmed empirically in the
Stage 0 spike:

```
untrusted CA →  NetworkError { code: "network_error", status: 0 }
                "GET /v1/viewer/towers failed: Failed to fetch"
```

**`status: 0` with no HTTP code means CA trust, never a code bug.** Fix: trust `ca.crt`
in the OS store, or visit `https://<coord-ip>:8081/healthz` once and click through. The
URL must match a SAN — an IP, not a hostname.

### 5.5 Status vocabulary

```ts
// sentry-sdk/src/models.ts:302
type CameraStatus = "live" | "down" | "unknown";
// :383 — a word, not a boolean, so a third state can arrive without a break
type LinkState = "up" | "down" | (string & {});
```

`"unknown"` is **valid and expected**, never an error, and §A.3.2 forbids rendering it as
good.

Three freshness facts, deliberately distinct (`sentry-sdk/src/client.ts:130`):

- `link` — **always current.** Coordination watches the WSS link itself.
- `cameras[].status` — **last-known, as of `as_of`** (`null` before the first hello).
- `health_as_of` — stamps the *sensor* block only.

> A camera reading `"live"` under `link: "down"` with an ageing `as_of` is true only in the
> past tense, and must render as stale. **The SDK surfaces `as_of` and refuses to
> interpret it** — the freshness threshold is ours to choose.

The reference derivation, `sentry-dashboard/lib/inventory/adapter.ts:112` — priority order
matters:

```ts
if (!linkUp)                return { status: "down",    reason: "tower_offline"  };
if (reported === "unknown") return { status: "unknown", reason: "never_reported" };
if (reported === "down")    return { status: "down",    reason: "feed_lost"      };
return { status: "live" };
```

Tower rollup (`:271`): `!linkUp → offline` · `no cameras → unknown` · `any down →
degraded` · `all unknown → unknown` · else `live`.

Playback failure is a **separate axis** (`lib/webrtc.ts:66`):

```ts
type PlaybackFailure =
  | "media_unreachable" | "not_permitted" | "tower_offline" | "tower_timeout"
  | "camera_unavailable" | "session_expired" | "negotiation_failed" | "unreachable";
```

`media_unreachable` is singled out because the direct-media architecture makes it likely:
signaling can round-trip perfectly while no packet ever arrives, and a black `<video>` is
indistinguishable from a dark scene.

Sensor health: `TowerHealth { door, cover, impact, thermal{soc_c,state}, disk{free_pct},
feeds[] }`. Every member optional — `tower.state` pushes **partial** health, so consumers
**merge, never replace**.

### 5.6 PTZ

```ts
sendPtz(ref, command, opts?)                    // POST /v1/viewer/sessions/{id}/ptz
ptzMove(ref, camera, params, opts?)             // {camera, action, params}
ptzStop(ref, camera, {home?}, opts?)
ptzKeepalive(ref, camera, opts?)
ptzStatus(ref, camera, opts?)
ptzHold(ref, camera, params, opts?) → { stop(p?), started }
```

`mode ∈ "absolute" | "continuous" | "jog"`. Axes normalised: `pan`/`tilt` −1…1; `zoom`
0…1 absolute, −1…1 as a rate. `clampMove()` enforces the mode-dependent bound.

What the working UI sends (`components/live/PtzControls.tsx:60`):

```ts
up {tilt: 0.5}  down {tilt: -0.5}  left {pan: -0.5}  right {pan: 0.5}
in {zoom: 0.5}  out {zoom: -0.5}
beginHold(camera, { mode: "jog", ...AXES[dir] })
```

`PTZ_DEADMAN_MS = 4000` · `PTZ_KEEPALIVE_MS = 1500` · `MIN_PRESS_MS = 260`.

> **`ptzHold` owns the keepalive. `lib/ptz.ts`: "THE DASHBOARD MUST NOT HAND-ROLL
> KEEPALIVES."** Getting it wrong is a *safety* bug — a mount that keeps moving. `stop()`
> always issues a real stop even if keepalives were failing.

Failures throw typed: `PtzError` (409 or a `200 {ok:false}`), `GrantError` (403),
`TowerTimeoutError` (504, 8 s — tighter than the offer's 10 s), `RateLimitedError` (429).
**`SUPERSEDED` is a normal outcome** of a rapid tap or direction change and must not read
as a fault — `isNormalPtzOutcome()` exists for it.

**Stop is unconditional** (§5.3): never gate it on your own permission check, never skip
it on a looks-expired session. *"Refusing a stop can only leave a camera moving; accepting
one can only leave it still."*

`ptz_capable` is **capability, not permission**. The viewer never sees the grant, so
`403 grant_permission` on the first command is the only way to learn it may not steer.

Recorded from real hardware: `mode: "continuous"` with bounded `seconds` failed with
`invalid_request` (ONVIF route broken by camera clock skew). Zoom works over `jog` → Dahua
CGI. **Use `jog` for everything.**

### 5.7 WHEP flow

`sentry-dashboard/lib/webrtc.ts openPlayback()`, in order:

```
1. session = await client.createSession({ device_id, camera })   // EXACTLY two fields
     → { session_id, device_id, camera, expires_at, ice_servers[], offer_url, ice_url }
2. pc = new RTCPeerConnection({ iceServers: session.ice_servers })
3. pc.ontrack = e => onStream(e.streams[0])           // BEFORE the answer is applied
   pc.onconnectionstatechange: "failed" ⇒ media_unreachable
                               "disconnected" is NOT terminal — ICE often recovers
4. pc.addTransceiver("video", { direction: "recvonly" })
   await pc.setLocalDescription(await pc.createOffer())
   await waitForIceGathering(pc, signal)              // 3 s cap; listens for BOTH
                                                      // icegatheringstatechange AND
                                                      // the null candidate
5. answer = await client.sendOffer(session, pc.localDescription.sdp)   // 15 s client / 10 s server
   await pc.setRemoteDescription({ type: "answer", sdp: answer })
6. registerSession(camera.id, session)                // shared with the PTZ path
7. teardown: receivers' tracks stopped, pc.close(), await client.closeSession(session)
```

Media flows **direct tower→browser**. Coordination relays SDP verbatim and must not
rewrite it.

Three properties to carry:

- **Every `await` is an abort point.** A peer created after cleanup keeps a tower session
  alive and a camera busy.
- **Two guards, both required**: the `AbortSignal` stops work *continuing*; a `disposed`
  closure flag stops a late success *leaking*.
- **No retry loop.** §7.7: retry storms wedged a camera in v1. One attempt, an honest
  error, a deliberate operator retry.

`closeSession` is idempotent (204 even when already gone) and also fires on `pagehide`.

### 5.8 Renewal and expiry

```ts
readSessionExpiry(session, signal): Promise<string | null>   // null ⇒ ENDED
msUntilSessionExpiry(session, now?): number
STATUS_POLL_MS = 60_000        // §7.4 renews at 5 min remaining
STATUS_POLL_TOLERANCE = 3
```

- `getSessionStatus` **returns** `{status:"ended"}` on a 404 rather than throwing —
  absent *is* ended, and that is an answer to act on. Network/5xx still **throw**.
- `expiresAt === null` → stop, and say *access ended*. Definitive.
- A thrown poll → `misses++`, **keep playing.** Not an authorization answer.
- A hard-stop watcher re-arms every 1 s against the *current* deadline. After ≥3 misses the
  copy says "the session expired and coordination could not be reached" rather than "the
  viewing session ended."

> **The viewer never extends its own clock.** §7.4 renewal is coordination re-asking
> whether this viewer may still watch, and it advances `expires_at` only when the answer
> is yes — so reading the field *is* reading the authorization verdict. A client that added
> time locally would turn a revocation into a feed that keeps playing.

Default grant lifetime is 15 minutes, renewed in place.

### 5.9 Enrollment / pending claim

```
POST /v1/viewer/claims  {pairing_code, label} → 201 Claim
   409 claim_conflict · 422/400 invalid · 403 may-not-register · 401 session gone
GET  /v1/viewer/claims                        → 200 {claims: Claim[]}

Claim { claim_id, label, expires_at, status }
ClaimStatus = "open" | "consumed" | "expired" | "superseded"
```

`POST /v1/enroll` and `/v1/enroll/confirm` also exist — that is the tower's
key-possession proof, not the browser's business.

The client is not pushed to. `status` flips `open → consumed`, at which point the tower
appears in `GET /v1/viewer/towers`. So: poll `listClaims` while any claim is open.

**Pending survives reload because it is server-side.** The pending window is invisible in
`/v1/viewer/towers` — no tower record exists until enrolment binds one.

**The pairing code is never returned** in any response and never logged: *"a response body
is no safer than a log line: it reaches a browser, a proxy, and devtools."* The client
clears its own input on success. 15-minute TTL with a real countdown. `superseded` is the
*same* account re-registering; `claim_conflict` is a *different* account, where refusing is
the safe answer.

### 5.10 Two stale comments in the reference implementation

The dashboard's code is ahead of two of its own headers. Ignore both:

- `lib/auth/contract.ts` — says there is no login route. There is.
- `lib/session.ts` — says the session seam is empty. `lib/webrtc.ts` registers sessions.

---

## 6. What does not exist

Grepped across the SDK and coordination. These have **no backend at all**:

| This frontend's surface | Real system | Evidence |
|---|---|---|
| Alerts — `AlertsView`, `AlertsPanel`, `AlertDetail`, `AlertRow`, `NewAlertBanner`, date filter | **absent entirely** | no alert type in `models.ts`, no route in `server.py` |
| Watchlist — `PeopleView`, enrol, sightings, `matchedPersonId` | **absent entirely** | no person/face/watchlist anywhere |
| Clips — `ClipPlayer`, `ClipCard`, export | **deferred by decision** | `models.ts`: `export type RecordingPlaybackDeferred = never`; `RECORD_ENABLE=0` on both towers, so no segments exist |
| Battery / solar / cabinet temp — `TowerBattery`, mast gauge, charge banner | **absent** | `grep -i battery\|solar` returns only test passwords |

Real health is door · cover · impact · thermal · disk. `thermal.soc_c` is **SoC**
temperature, not cabinet temperature; `disk.free_pct` is a percentage, not the
`storageUsedGb`/`storageTotalGb` pair modelled here.

That is roughly 40 % of this frontend's surface. **The scoping decision:** ship the real
surfaces, and keep the unbacked ones on seed data behind a **visible marker** —
`*_BACKED = false` per module, mirroring the dashboard's `FIXTURE` badge and its
`bypassed` auth status that *"nothing downstream can mistake for a fake authenticated."*
Converge on removing them from the rail until a contract exists.

What this must never become is alerts that look live and are not.

---

## 7. Joining architecture

**(a′) — the SDK as a direct dependency, behind an app-owned adapter layer.**

```
@kallon/sentry-sdk      unchanged npm dependency
      ↓
src/lib/api/*           NEW — this app's adapter. Owns every SDK call,
                        returns this app's own types.
      ↓
src/App.tsx             UNCHANGED as the single owner of domain state
      ↓
src/components/*        UNCHANGED — still data + callbacks as props
```

**Not a port.** The honest failure vocabulary lives *inside* the client logic; a copy is
proven on the day it is made and unproven the first time coordination changes a field.

**Not raw SDK calls in components.** All domain state lives in `App.tsx` and both walls
therefore read one set of feeds. Sprinkling SDK calls through components kills that
guarantee quietly. The adapter exists to keep `App.tsx` the only thing that talks to the
data layer — exactly as it talks to `data.ts` today.

**The adapter's interface is already specified**: `data.ts`'s export surface. Satisfy it
asynchronously and `App.tsx`'s import block is the only line that changes at the top of
the file.

Session state goes in an `AuthProvider` context in `src/main.tsx`, **above**
`<SentinelApp/>` — not in `App.tsx`. `App.tsx` owns *domain* state; session state has a
different lifetime (it survives reload, gates the whole tree, and must be readable before
any domain fetch fires). This app has no Context anywhere; this is the one place one is
justified.

Persistence, three tiers that must not share a mechanism:

| What | Where | Why |
|---|---|---|
| Session | `sessionStorage` (httpOnly is unavailable — see §5.3) | matches the proven client |
| Wall order, notice dismissals | `localStorage`, keyed by user id | pure view preference |
| Pending claim | **server-side** | a claim is ownership; the route already exists |

Config (this app uses none today):

```
VITE_COORDINATION_URL=https://192.168.1.230:8081   # no /v1 — the SDK's paths carry it
```

Anything `VITE_`-prefixed is inlined into the bundle and is **public**. No secrets.

---

## 8. Seam map

### Data layer

`src/lib/data.ts` — module constants `TOWERS` (:63), `FEEDS` (:109), `UNCLAIMED` (:157),
`PEOPLE` (:260), `ALERTS` (:649), all computed at import against `NOW` (:31).

Selectors split three ways:

- **Keep** — pure derivations: `feedsForTower` (:398), `alertsForTower` (:656),
  `isExpired` (:394), `solarState` (:381), `findPerson` (:388), `ALERT_BADGE` (:661).
- **Delete** — fake provisioning: `nextUnclaimed` (:201), `findUnclaimed` (:225).
- **Fix before wiring** — `findTower` (:105) returns `?? TOWERS[0]`. A missing tower
  silently renders **another tower's data**; under real scoping that is access-control
  shaped. Same at `App.tsx:668`. Must become an explicit not-found.

Type reshaping — short, because the types were built for this:

| Type | Change |
|---|---|
| `Tower.status` | server-supplied/derived, not authored |
| `Tower` | **add** `asOf`, `healthAsOf`, `link`, `health`; **remove** `batteryPct`, `solar`, `tempC`, `storageUsedGb/TotalGb` (no source) |
| `CameraFeed` | **add** `index`, `lens`, `ptzCapable`, `enclosure`, `role`, `lastSeenAt` |
| `Alert` | add `acknowledgedAt` |
| `Person.photo` | blob URL → server asset id |
| `CameraSettings` | `changedBy`/`changedAt` already correct — **no change** |
| all timestamps | already epoch ms — **no change** |

One live bug to fix: `SESSION_NOW = Date.now()` (`time.ts:163`) is frozen at module load
and drives every date filter, so ranges drift as the tab ages.

### Auth

Mount `AuthProvider` in `src/main.tsx`. `OPERATOR` (`App.tsx:38`) → `session.operatorName`.

**`acknowledgedBy` (`App.tsx:530`) must NOT become `session.name`** — that has the client
asserting who performed an auditable action. It comes back from the server's response to
the ack mutation.

⚠ `src/main.tsx` renders under `StrictMode`, so effects double-invoke in dev. A login POST
or a session create in a bare `useEffect` fires twice. Idempotent or abort-aware.

### Live video

`CameraTile.tsx:208` — `<video src={...}>` **cannot take a `MediaStream`.** It becomes a
`ref` + `videoEl.srcObject = stream` set from `ontrack`. Everything around it survives:
`autoPlay muted playsInline` is already correct for autoplay policy, `onLoadedData →
setFirstFrame(true)` already drives the fade, and the PTZ transform applies unchanged.

`MonitorTile.tsx:174` has no video branch and must gain one — or not, per the concurrency
decision below.

**The peer connection is owned in `App.tsx`, never in a tile.** `TowerView` is keyed
(`App.tsx:665`) and remounts on every drill-in; `DashboardView` unmounts entirely. A
tile-owned peer would be renegotiated on every navigation. `watchedTower` (`App.tsx:376`)
is the existing precedent for this exact lifetime problem.

**Fleet-wall concurrency is a real decision.** `FeedView` deliberately guards `&& !compact`
so an inset never opens a second peer — *"a load decision that deserves to be made
deliberately."* This app's fleet wall is 4+ tiles, against off-grid towers whose battery
cost `LiveViewBanner` already exists to warn about. Recommendation: posters on the fleet
wall, live in the tower view.

Mapping the eight simulator states onto real ones:

| Simulator state | Real replacement |
|---|---|
| Recording | **should stop being a `FeedState`** — a camera can be recording *and* down. Make it `feed.recording: boolean`. |
| Live | real — track attached, frames advancing |
| Delayed | real if derivable from `getStats()` jitter/RTT; else retire |
| Frozen | real — `framesDecoded` not advancing between samples |
| Connecting | **splits**: ICE/negotiation vs **awaiting-media** (session up, no track) |
| Signal lost | real attempt counts, or gone if reconnection is transparent |
| Offline | **splits**: **down** (tower unreachable) vs **no-media-path** (reachable, no route) |
| Stream error | real transport error; `STREAM_ERROR` (`App.tsx:28`) dies |
| — | **add unknown/stale** |
| — | **add session-ended** |

### Per-camera status

`FeedChip` owns `stateLabel` and `DOT` (`FeedChip.tsx:11`) and both walls render
`FeedChip` itself — so it is a one-file change, with two caveats:

- **`DEAD_STATES` is duplicated** — `CameraTile.tsx:16` and `MonitorTile.tsx:15`. Hoist it
  beside the grammar or the two walls will disagree about whether a camera is dead.
- `TileFallback` needs `AwaitingMedia`, `NoMediaPath`, `SessionEnded` variants, all on
  `--color-tile-dead` per the existing rule.

**Free guard already in place:** `stateLabel` is an exhaustive `switch` with **no
`default`**, and `tsconfig` sets `noFallthroughCasesInSwitch`. Adding a state fails the
build until every site handles it. **Never add a `default` case.**

Colour call under the reserved-colour rule: `unknown` must not be green — grey, as offline
uses. `session-ended` is not a fault, so red is wrong; grey again.

### PTZ

The local transform is **digital** (cropping the delivered frame); real PTZ is
**mechanical**. Both are legitimate. `PtzPad` is already correctly gated on `feed.ptz`;
the `ControlStack` zoom buttons are the digital ones.

For a real-PTZ camera, issue the command and **do not apply the local transform** — the
picture moving *is* the feedback. Applying both moves the frame twice.

`PtzPad.tsx:63` fires every 125 ms — **8 commands/second at a CGI endpoint.** The jog
mapping is cleaner *and* quieter: single press → one step; hold → `jog start` on
pointerdown, `jog stop` on pointerup/leave/cancel. The existing handler set
(`PtzPad.tsx:73`) is already the right shape, and `useTileControls`' `hold: {onStart,
onEnd}` contract (`ControlStack.tsx:30`), built for talk-down, is the same pattern.

### Enrollment

| Step | Fake | Real |
|---|---|---|
| `intro` | — | unchanged |
| `handoff` | `FakeQr` (`AddTowerView.tsx:301`) | real QR encoding the claim URL; the `qr-scan` animation survives |
| `handoff` | `setTimeout(4500)` claims unconditionally (`:386`) | **the shape is already right** — `useRef(onClaimed)` + `useEffect` + cleanup *is* a subscription. Swap the timer for a `listClaims` poll. |
| `manual` | `findUnclaimed` string-match | real claim call. **The error path is already good.** |
| `site` | local naming | real PATCH |
| `online` | 4 × `setTimeout(900)` (:721) | real probes. **Keep "amber does not block".** |
| — | `nextUnclaimed()` | **deleted** |
| — | `pending` in `App.tsx` | server-side claim |

Three states the README lists as *not built* map onto real failures that already exist:
already-claimed-by-another-org, claimed-with-no-uplink, blocked-clipboard. Plus the missing
release-a-claim path.

### Session renewal / expiry

Absent here. The nearest thing is `liveViewSec` + `LiveViewBanner` (`App.tsx:365`) — wrong
axis (battery), **right shape** (a 43 px bar above the wall, dismissible, non-blocking,
that gives way to the red alert banner).

1. **Renewal is silent while it succeeds.** The operator learns only when it fails.
2. Renewal-failing-soon reuses `LiveViewBanner`'s shape.
3. **"Access ended" is terminal and belongs on the tile** — a new `TileFallback` variant
   with a Resume action where renewal is possible. A dismissible banner for a dead stream
   lets an operator dismiss the only thing telling them they are looking at nothing.

### Mutation honesty — one pattern

The ~20 mutations, all in `App.tsx`: `renameTower` :147 · `changeSettings` :155 ·
`rejectMatch` :238 · `enrolPerson` :256 · `stopWatching` :268 · `deletePerson` :287 ·
`extendWatch` :294 · `addTower` :316 · `reorderWall` :340 · `retryFeed` :485 ·
`toggleRecord` :509 · `setStatus` :521 — plus zone edits, the tile actuators, and the
notice dismissal.

**The pattern already exists here.** `src/lib/useExportPhase.ts` is a three-phase
`idle | working | done` hook invented for the fake clip export, and its visual grammar is
already designed and shipped in `ClipCard` and `ClipPlayer`: spinner → check → the check
*retracts* rather than blinking out, plus `aria-busy` and an `sr-only` `role="status"`.

Generalise it into `src/lib/mutation.ts` returning
`{ run, phase: "idle"|"pending"|"error", error, retry }`. You inherit a designed,
accessible pending/success language and add only the failure half.

| Phase | Rendering | Precedent |
|---|---|---|
| Pending | control keeps its box, existing `Spinner`, `aria-busy` | `ClipCard`, `TileFallback` |
| Success | check-that-retracts for consequential acts; **silence** for routine ones | `ClipCard` |
| Failure | **inline at the site**: `role="alert"`, red text, `ring-1 ring-critical` on the control, retry | `AddTowerView.tsx:494` |

**No optimistic updates for consequential mutations.** A value that changes and then
changes back is a value the operator may already have acted on. Go pending, commit on
server confirmation. Optimism is fine only for `reorderWall` and the notice dismissal.

Two placement traps:

- **`AlertDetail` is never remounted** by design (`AlertsPanel.tsx:216`), so a `useState`
  for a pending ack survives the swap and appears against the *next* alert. Key mutation
  state by target id, held above. **The single most likely bug in the integration.**
- `PersonDetail` **is** keyed (`PeopleView.tsx:302`) and is safe. Know the asymmetry.

---

## 9. `src/lib/api/` signatures

```
src/lib/api/
  client.ts    SDK singleton + bound fetch + config          [Stage 1]
  session.ts   the session ref the token provider reads       [Stage 1 stub → Stage 2]
  auth.ts      login / logout / resolve                       [Stage 2]
  fleet.ts     towers & feeds                    REAL         [Stage 3/6]
  media.ts     WHEP playback                     REAL         [Stage 3]
  ptz.ts       jog control                       REAL         [Stage 7]
  claim.ts     enrollment                        REAL         [Stage 8]
  map.ts       projection → this app's types                  [Stage 3]
  settings.ts  NO BACKEND — local only, marked
  alerts.ts    NO BACKEND — seed-backed, marked
  people.ts    NO BACKEND, NO MATCHER — seed-backed, marked
```

### client.ts

```ts
export const sdkFetch: FetchLike = (u, i) => globalThis.fetch(u, i as RequestInit);
export class NotConfiguredError extends Error {}
export function coordinationBaseUrl(): string | undefined;
export function isConfigured(): boolean;
export function getClient(): SentryClient;   // throws NotConfiguredError
// built once: new SentryClient({ baseUrl, token: () => getSessionRef(), fetch: sdkFetch })
//                                      ^^^^^^ a CALLBACK, never a captured string
```

### auth.ts

```ts
export interface AuthAccount { account_id: string; login: string; role: string; status: string }
export interface StoredSession { ref: string; expiresAt: string; account: AuthAccount }
export type SessionEndReason = "expired" | "revoked" | "unknown" | "logged_out";

export class AuthRejectedError extends Error {}   // uniform; NO reason field
export const UNIFORM_AUTH_MESSAGE = "Wrong organization name or password";
export class AuthUnreachableError extends Error {
  readonly reason: "network" | "no_endpoint" | "server_error" | "bad_response";
}

/** organizationName is sent VERBATIM — no trim, no toLowerCase. Ever. */
export function login(organizationName: string, password: string, signal?: AbortSignal): Promise<StoredSession>;
export function logout(ref: string, signal?: AbortSignal): Promise<boolean>;
/** Probes listTowers(). 200 (incl. empty) = valid; 401 = not. Rethrows anything else. */
export function resolveSession(signal?: AbortSignal): Promise<boolean>;
export function isUnauthorized(err: unknown): boolean;

export function getSession(): StoredSession | null;   // synchronous
export function getSessionRef(): string | undefined;
export function loadSession(): StoredSession | null;
export function saveSession(s: StoredSession): void;
export function clearSession(reason?: SessionEndReason): void;
export function markSessionEnded(reason?: SessionEndReason): void;
export function subscribeToSession(fn: (s: StoredSession | null, r?: SessionEndReason) => void): () => void;
```

### fleet.ts

```ts
export interface FleetSnapshot {
  towers: Tower[];
  feeds: CameraFeed[];
  asOf: Record<string, number | null>;
}
export function listFleet(signal?: AbortSignal): Promise<FleetSnapshot>;
export function getTower(deviceId: string, signal?: AbortSignal): Promise<{
  tower: Tower; feeds: CameraFeed[]; asOf: number | null; healthAsOf: number | null;
}>;
export class TowerUnavailableError extends Error {}   // replaces findTower's ?? TOWERS[0]
```

### map.ts

```ts
export const STALE_AFTER_MS = 90_000;   // the SDK refuses to interpret as_of; this is our call

export type FeedStateReason = "feed_lost" | "tower_offline" | "never_reported" | "stale";
/** Priority order copied from adapter.ts:112 — do not reorder. */
export function feedStateFor(link: string, reported: CameraStatus, asOf: number | null, now?: number):
  { state: FeedState; reason: FeedStateReason };
export function towerStatusFor(link: string, feeds: CameraFeed[]): Tower["status"];
export function toTower(info: TowerInfo | TowerDetail): Tower;
export function toFeed(deviceId: string, cam: CameraInfo, link: string, asOf: number | null): CameraFeed;
/** `${deviceId}:${index}` — index is the ONLY address a session or PTZ call may carry. */
export function feedId(deviceId: string, index: number): string;
```

Required `FeedState` extension, 6 → 9:

```ts
export type FeedState =
  | "recording" | "live" | "delayed" | "frozen" | "connecting" | "offline"
  | "unknown"        // status unknown, or as_of older than STALE_AFTER_MS. NEVER green.
  | "no-media-path"  // PlaybackFailure media_unreachable
  | "session-ended"; // PlaybackFailure session_expired. Not a fault — grey, not red.
```

### media.ts

```ts
export type PlaybackFailure = /* the eight from §5.5 */;
export class PlaybackError extends Error { readonly failure: PlaybackFailure }
export interface PlaybackHandle { session: ViewerSession; pc: RTCPeerConnection; close: () => Promise<void> }

/** Every await is an abort point. Tears down what it built rather than returning it. */
export function openPlayback(
  feed: { deviceId: string; index: number },
  handlers: { onStream: (s: MediaStream) => void; onMediaFailure: (e: PlaybackError) => void },
  signal: AbortSignal,
): Promise<PlaybackHandle>;

/** null ⇒ the session ENDED (definitive). Throws on network/5xx — never proof of an ending. */
export function readSessionExpiry(s: ViewerSession, signal?: AbortSignal): Promise<string | null>;
export function msUntilSessionExpiry(s: ViewerSession, now?: number): number;

export const STATUS_POLL_MS = 60_000;
export const STATUS_POLL_TOLERANCE = 3;
export const ICE_GATHER_TIMEOUT_MS = 3_000;
```

### ptz.ts

```ts
export const MIN_PRESS_MS = 260;
export class PtzUnavailableError extends Error { readonly reason: string }
export interface PtzHold { stop(p?: PtzStopParams): Promise<PtzResult> }

/** Delegates to client.ptzHold — the SDK owns the 1.5 s keepalive. DO NOT ADD A TIMER. */
export function beginHold(feed: CameraFeed, params: PtzMoveParams): Promise<PtzHold>;
/** ALWAYS send. Never gate on your own permission check; never skip on a looks-expired session. */
export function stopOrHome(feed: CameraFeed, home?: boolean): Promise<PtzResult>;
/** null ⇒ say nothing (SUPERSEDED is normal, not a fault). */
export function describePtzFailure(err: unknown): string | null;

export const JOG_AXES = {
  up: { tilt: 0.5 }, down: { tilt: -0.5 }, left: { pan: -0.5 }, right: { pan: 0.5 },
  in: { zoom: 0.5 }, out: { zoom: -0.5 },
} as const;   // always { mode: "jog", ...axis }
```

### claim.ts

```ts
export type ClaimStatus = "open" | "consumed" | "expired" | "superseded";
export interface Claim { claim_id: string; label: string; expires_at: string; status: ClaimStatus }

export class ClaimConflictError extends Error {}      // 409 — a DIFFERENT account
export class ClaimRejectedError extends Error {}      // 422/400
export class ClaimUnreachableError extends Error { readonly reason: "network"|"no_endpoint"|"server_error"|"bad_response" }
export class SessionEndedError extends Error {}       // 401 anywhere

/** pairingCode is a parameter only — retained nowhere, logged nowhere. */
export function createClaim(pairingCode: string, label: string, signal?: AbortSignal): Promise<Claim>;
/** What makes the pending state survive a reload. Poll while any claim is open. */
export function listClaims(signal?: AbortSignal): Promise<Claim[]>;
export function msUntilExpiry(c: Claim, now?: number): number;
export function formatCountdown(ms: number): string;
```

---

## 10. Roadmap

Ten stages, dependency-ordered, each independently verifiable. The first three are
deliberately narrow: nothing broad happens until one real video tile has played.

| # | Stage | Wires | Verify | Risk |
|---|---|---|---|---|
| 0 | **SDK spike** (outside the repo) | throwaway Vite page: login → session → one stream | a frame appears | none — no repo code touched |
| 1 | **Config plumbing** | `.env.example`, `config.ts`, `api/client.ts`, the SDK dependency | builds and runs **byte-identical** | none — deliberately inert |
| 2 | **Auth gate** | `AuthProvider` in `main.tsx`, `LoginView`, session persistence, `OPERATOR` → session | unreachable unauthenticated; reload keeps you in; wrong password shows a real error. **Everything below still on seed data.** | StrictMode double-login |
| 3 | **⭐ Vertical slice** | real fleet list → one real tower → **one `CameraTile` playing real WHEP** | video plays; **pull the tower's power and confirm a real down state**; navigate 10× and check `webrtc-internals` for leaked peers | the go/no-go |
| 4 | **State grammar** | `FeedState` +3, hoist `DEAD_STATES`, `lastSeenAt`, new fallbacks, retire the literals | reach every state by **inducing** it, not by a simulator button | two walls disagreeing if `DEAD_STATES` is not hoisted |
| 5 | **Mutation primitive** (gate) | `useMutation` + three consumers: ack/resolve, rename, one settings row | kill the network mid-ack → pending, real failure, working retry | if this slips, ~17 more mutations get written in the old style |
| 6 | **Data breadth** | alerts, people, all towers/feeds; `acknowledgedBy` server-supplied; `SESSION_NOW` live; `findTower` fallback removed | **per-account scoping** — log in as a one-tower account and confirm nothing else is reachable by any path | filter/lookup behaviour changes |
| 7 | **Actuators + PTZ** | real jog, record, talk-down, siren | each against a real tower, including its failure path | **deliberately late — these reach a physical site** |
| 8 | **Enrollment** | real QR, claim, probes, server-side pending | claim from a phone; kill the browser mid-claim and confirm pending survives | creates state |
| 9 | **Renewal + persistence** | silent renewal, failing banner, `SessionEndedFallback`; `localStorage` for wall order | force an expiry and confirm the tile says so | — |
| 10 | **Sweep** | dead controls, the `feedId`/`tower.id` key mismatch, drop `sharp` | build clean | — |

---

## 11. Risk register

Ordered by how quietly the failure would happen.

| # | Risk | Guard |
|---|---|---|
| 1 | **`findTower` substitutes a different tower.** `?? TOWERS[0]` (`data.ts:105`, `App.tsx:668`). Under real scoping, an unauthorised id renders another tower's telemetry. | Explicit not-found. Fix **before** Stage 6. |
| 2 | **`retryFeed` promotes to `live` on a timer, not evidence** (`App.tsx:494`). Already had one race bug fixed. Wired to a real retry that fails, it still paints green. | Promotion driven by `ontrack`. Never a timer. |
| 3 | **Client-asserted actor identity.** The obvious adaptation of `acknowledgedBy` is `session.name`. | Identity on write comes from the server's response. |
| 4 | **Client filters mistaken for access control.** Every selector is `filter(x => x.towerId === id)`; this app has no notion of an org. | Scoping is server-side. Verify explicitly at Stage 6. |
| 5 | **Pending mutation state leaking across alerts** (`AlertDetail` is never remounted). | Key by target id, held above the panel. |
| 6 | **Peer-connection leaks on navigation.** `TowerView` remounts; `DashboardView` unmounts. | Sessions owned in `App.tsx`, explicitly closed. Check `webrtc-internals`. |
| 7 | **StrictMode double-invoke** → two sessions or two logins in dev. | Idempotent/abort-aware effects. Do not remove StrictMode. |
| 8 | **Optimistic-then-revert on a monitoring surface.** | No optimism for consequential mutations. |
| 9 | **`SESSION_NOW` frozen at module load** — filters drift over a long shift. | Live now. |
| 10 | **Settings key ambiguity** — keyed `feedId`, called with `tower.id`. | Resolve the naming before wiring settings. |
| 11 | **`toggleRecord` carries no session id** — a stop could target the wrong segment. | Real record returns an id the stop references. |
| 12 | **Blob-URL enrolment photos** die on reload. | Upload before enrol. |
| 13 | **Fake-green from an unhandled state.** | Structurally guarded: exhaustive switch + `noFallthroughCasesInSwitch`. **Never add a `default`.** |
| 14 | **"Illegal invocation."** Omit the bound fetch and login works while every SDK call dies. Invisible to Node tests. | One bound-fetch helper, used everywhere. Verify in a browser. |
| 15 | **CA trust reads as a code bug** — `status: 0`, `Failed to fetch`, no HTTP status. | Trust `ca.crt` first. The banner must distinguish three cases: `Illegal invocation` = code; `Failed to fetch` = CA/network; `401` = actually signed out. |
| 16 | **CORS on the real gateway.** The stub reflects any origin, so this app will work in dev and fail in prod. | Add the deployed origin to `CORS_ALLOWED_ORIGINS` (`tower-agent/gateway/gateway.py:1099`). |
| 17 | **Rendering `unknown` as live.** The contract expects it and forbids drawing it as good. | `FeedState` gains `unknown`; the compile error is the feature. |
| 18 | **The stale-but-green trap.** `link: "down"` + `status: "live"` + an old `as_of`. | Check `link` **first**, then `as_of` against `STALE_AFTER_MS`. |
| 19 | **Extending the session clock locally** turns a revocation into a feed that keeps playing. | `deadline` only ever takes a server-reported value. |
| 20 | **`enclosure`/`role`/tile id leaking into an address.** | Only `{device_id, camera: index}` reaches `createSession`/PTZ. |
| 21 | **Hand-rolled PTZ keepalive** — a mount that keeps moving. **Safety bug.** | `beginHold` delegates to `ptzHold`. No timer, ever. |
| 22 | **Surfacing `SUPERSEDED` as a fault.** The 8 Hz repeat produces it constantly. | Jog start/stop; `describePtzFailure` returns `null` for it. |
| 23 | **Retaining the pairing code.** Currently held in component state and written to the clipboard in a fabricated link. | Parameter only; clear on success; remove the fake link. |
| 24 | **`login` normalisation.** A `.trim()` authenticates a string the user did not type. | Verbatim, client and server. |
| 25 | **Uniform 401 drift.** This app's instinct is to say *why*; here that is a customer enumerator. | One exported constant. Reachability uses a different class and different wording. |
| 26 | **`404 tower_unknown` = "no such tower OR not yours"**, deliberately indistinguishable. | Copy says "unavailable", never "does not exist". |
| 27 | **`ProjectionLeakError` misdiagnosed** — a leak is a coordination bug, but the first reader debugs the wrong repo. | Carry the dashboard's `explain()` wrapper. |
| 28 | **Unbacked screens reading as live** — the largest correctness risk here. | A visible marker per unbacked surface + `*_BACKED = false`. Never a silent fallback. |
| 29 | **A custom request header silently breaks every authenticated call.** Found in Stage 2. Passing `userAgent` to `SentryClient` makes it send `X-Sentry-Client`; coordination's CORS allows exactly `Content-Type, Authorization`, so the browser's preflight refuses it and the request never leaves. The SDK's own comment says "Browsers ignore it", which is true of `User-Agent` and false of a custom header. **It fails as a *network* error, indistinguishable from coordination being down.** | Send no header coordination does not allow. Add one only alongside a CORS change. See the note at the `getClient()` call site. |
| 31 | **A real tower reports no battery, solar, cabinet temperature, storage, uplink *quality*, location, model, IP, backup connection or serial.** Found in Stage 3. None of those exist in the §A.3 projection. Keeping the seed values would have shown a live site at 87% charge — the fake-green failure, in the one place an operator would never think to doubt it. | Those `Tower` fields are now **optional**, `undefined` means *not reported*, and every read site renders absence: no battery cell on the mast (the pending card's own precedent), `NO CABINET READINGS` in the hover panel, `Not reported` in the settings rows (already the row's fallback), and the battery glyph omitted from the tower bar. The mapper is tested to leave all eleven absent. |
| 32 | **The latency walk and the battery tick would have invented telemetry on real feeds.** Both are simulations that ran unconditionally. | The walk is gated on the seed source; the battery tick skips any tower with no reported charge. `FeedChip` already omits the latency segment when it is absent. |
| 30 | **Treating our own `abort` as a verdict.** Found in Stage 2. A StrictMode cleanup aborts the in-flight session probe; if the catch reads that as "unreachable, keep the session", a **revoked session restores to a fully rendered app**. A shared `alive` ref cannot fix it — the second run sets it back to true and un-guards the first run's late handlers. | The per-run `controller.signal.aborted` is the authority, checked after the await **and inside the catch**. On abort, say nothing and let the surviving run decide. |

---

## 12. What we keep untouched

These are pure presentation or already backend-ready. Protect them in review.

**Design system.** The whole `@theme` block in `src/index.css` and the reserved-colour rule
it encodes — new states get tokens *inside* that grammar, never new hues. All CSS keyframes
(`sentinel-pulse`, `siren-a/b`, `charge`, `bell-swing`, `solar`, `qr-scan`) and the
`prefers-reduced-motion` block. `src/lib/motion.ts` — `ENTER`/`EXIT`/`FADE` and the
no-springs rule. `MaskIcon` and all 60 glyphs in `public/icons/` (one addition needed:
`wifi-bad.svg`, absent today, which is why a poor uplink renders no glyph).

**Layout and interaction.** Every responsive decision — the `lg` breakpoints,
`MobileViewBar`, the desktop-only wall, the portrait/landscape toggle, `dvh`,
`env(safe-area-inset-*)`. The band drag-and-drop in `DashboardView` (`moveBand`,
`onBandKey`, the held/dragging fill, and the deliberate non-`motion` `<section>` carrying
the native handlers). The `layoutKey` discipline in both tiles — **anything added that
changes a tile's box goes in that key**. Fullscreen takeover and its focus management. All
breadcrumbs, and the shell's single-router pattern: extend `navigate()`, never wire nav in
a view.

**Backend-ready as-is.** The `ZoneEditor` geometry (`CameraSettingsPanel.tsx:938`) — ship
the normalised coordinates unchanged. `ClipPlayer`'s transport, marker maths, breadcrumb
and capture-phase key handling — **only the rAF clock changes**, to `timeupdate`.
`TowerBattery`'s geometry (`BODY_START/END`, `TIERS`, the under-mast layer order), if the
battery reading ever gains a source. `src/lib/time.ts` formatting and the site-timezone
policy (only `SESSION_NOW` changes). `src/lib/dateFilter.ts`. `useTileControls`' control-list
*structure* and the `hold`/`tone`/`persistent` contract. **`FeedChip` as the single home for
state grammar — reinforce it, never route around it.**

**The copy.** Every string here is argued for in `README.md`. Express real behaviour in
that register: name what happened and what it means, the way the existing absence states
do (`No footage — feed was down`, `Not scored`, `Not acknowledged`).

---

## 13. Stage ledger

| Stage | Status | Notes |
|---|---|---|
| 0 — SDK spike | ✅ **PASSED** | All five criteria green against the live tower. See below. |
| 1 — Config plumbing | ✅ done | `.env.example`, `src/lib/config.ts`, `src/lib/api/client.ts`, `src/lib/api/session.ts`, the SDK dependency + Vite config. Inert. |
| 2 — Auth gate | ✅ done | `api/auth.ts`, `AuthProvider`, `AuthGate`, `LoginView`, sign-out in the rail, `OPERATOR` from the session. 17/17 verified. See below. |
| 3 — Vertical slice | 🟡 built, awaiting the live run | Real fleet + one real tower + real WHEP in `CameraTile`. Mapper 42/42; the end-to-end needs the operator's password. See below. |
| 4 — State grammar | 🟡 built, awaiting the induction run | Stale already landed in Stage 3. Net-new: the shell cannot-reach state (4 classified failures), the fabricated retry count removed, STREAM_ERROR marked simulated, the simulator narrowed. Classifier 15/15; mapper 42/42. |
| 5 — Mutation primitive | — | |
| 6 — Data breadth | — | |
| 7 — Actuators + PTZ | — | |
| 8 — Enrollment | — | |
| 9 — Renewal + persistence | — | |
| 10 — Sweep | — | |

### Stage 0 result

A throwaway Vite + React-TS app outside all four repos, importing the real SDK as a `file:`
dependency, run against live coordination at `https://192.168.1.230:8081` with a real tower
linked.

| Criterion | Result |
|---|---|
| ① login returns `session_ref` | ✅ |
| ② `listTowers()` projection, no `ProjectionLeakError` | ✅ |
| ③ `createSession` returns `ice_servers` | ✅ |
| ④ **MEDIA OK — a real frame** | ✅ |
| ⑤ PTZ jog moves the camera | ✅ |

Media connected over **host candidates on the LAN**, with `ice_servers = 0`. Expected —
phase one is direct-only and TURN is a later configuration change (§9).

Also established:

- `tsc -b` clean and `vite build` clean (21 modules, 210.97 kB, 154 ms). **No polyfill, no
  Node shim, no `lib: ["DOM"]` addition, no externalisation warning.**
- Vite resolves the **symlinked** `file:` dependency with `server.fs.allow` +
  `optimizeDeps.exclude` — both necessary, both sufficient.
- The SDK loads and executes in real headless Chrome through Vite. All 41 exports present;
  `PROTOCOL_VERSION = 1`, `API_PREFIX = "/v1"`.
- **The bound-fetch gotcha reproduces verbatim.** Same page, same server, same tab:

  ```
  fetch: (u,i) => globalThis.fetch(u,i)   →  AuthError, status 401     ← works
  fetch: globalThis.fetch                 →  NetworkError, status 0
     "GET /v1/viewer/towers failed: Failed to execute 'fetch' on 'Window': Illegal invocation"
  ```

- **The untrusted-CA symptom is `status: 0` + `Failed to fetch` with no HTTP status** — and
  it is only distinguishable from the bound-fetch bug by the message tail. Chasing the
  wrong one costs an afternoon.

**Verdict: joining architecture (a′) is proven.**

### Stage 3 result — the vertical slice

Built. The mapper is verified 42/42 as pure functions against the real
`kln_lab_000001` camera shapes; the end-to-end run needs the operator's
password and is the outstanding go/no-go.

**What is real now:** the fleet list, one tower's cameras and their status, and
WHEP playback in `CameraTile` via `srcObject`. **What is still seeded:** alerts,
people, camera settings, and the fleet wall's pictures.

`VITE_INVENTORY_SOURCE=sdk|seed` (default `sdk`) is the way back, and a seeded
fleet is badged `SEEDED FLEET — NOT YOUR TOWERS` because fixture towers must
never pass for an account's own.

**Peer ownership** is `usePlayback`, called from `App.tsx`. Not in the tile:
`TowerView` is keyed and remounts on every drill-in and `DashboardView`
unmounts entirely, so a tile-owned peer would renegotiate on every navigation.
Same problem the live-viewing clock already had, same solution.

**Only the open tower's live cameras stream.** The fleet wall stays on stills —
a session costs a grant and a busy camera, and this app already warns that live
viewing drains an off-grid battery, so four streams on the landing screen would
contradict its own advice.

**Session-leak checking** goes through coordination's own `/dev/status` session
list rather than `chrome://webrtc-internals`. That is the authoritative count of
what the SERVER still holds, which is what actually matters — a browser can drop
a peer and still leave a tower waiting on a reap. Baseline observation: three
sessions (`ses_f3b5…`, `ses_e442…`, `ses_820e…`) were already open before this
stage began, most likely from the Stage 0 spike, whose teardown was manual.

The mapper's tested properties, worth keeping true:

- the priority order — a down link outranks a reported `live`, `unknown` is
  never promoted, a stale `as_of` decays to `unknown`
- **exactly one of 36 link × reported × freshness combinations yields a live
  state**, and it is the one where all three agree
- no camera with no cameras reads `online`; all-unknown reads `degraded`
- eleven absent tower fields stay absent
- no poster, no latency, no `as_of` of `0` — inventing a plausible value is the
  only way this mapper could lie

### Stage 2 result

A real login in front of the app. Everything below the gate still runs on the
seed — verified: only `AuthProvider` and `LoginView` import `src/lib/api/*`, and
`App.tsx` still seeds `feeds`/`alerts`/`towers`/`people` from `data.ts`.

Driven headlessly against live coordination. 17/17:

| Group | Checks |
|---|---|
| the gate | login screen shows; the app is **not** rendered behind it; the organization field is not `uppercase`-transformed |
| uniform rejection | wrong password, unknown organization and a **leading space** all rejected, all with the **byte-identical** message, none mentioning reachability |
| unreachable | a blocked network gives `Can't reach coordination`, says explicitly it is not a password problem, and never claims the credentials were wrong |
| session ended | a revoked stored session drops to login, says *"Your session ended"*, and clears `sessionStorage`; the probe uses `GET /v1/viewer/towers` rather than an invented `whoami` |
| StrictMode | exactly one login POST per submit; a triple click still produces one |

Two bugs were found by the probe rather than by reading, both recorded as risks
29 and 30 above. Worth knowing they present identically to something else:

- `X-Sentry-Client` (from `userAgent`) fails CORS preflight, and surfaces as a
  **network** error — so it is indistinguishable from coordination being down,
  or from an untrusted CA. Three different causes, one symptom.
- A StrictMode `abort` caught as "unreachable" restored a **revoked** session to
  a fully rendered app. The per-run `controller.signal.aborted` is the fix; a
  shared `alive` ref is not, because the second run un-guards the first.

Still open, and needs the operator's password: the **success** path — right
organization plus right password renders the (still seeded) app.

`acknowledgedBy` is deliberately **not** collapsed into the session. `changedBy`
and `stoppedBy` are authoring stamps the server will re-verify; this one records
who *performed* an auditable action, and having the client assert that is the
boundary risk 3 is about. Alerts have no backend to return it, so the seed's
visibly-fake placeholder stays until they do.

`operatorName()` returns the **organization** name. Coordination authenticates an
organization and its account record carries no per-user identity, so provenance
is org-level — a real reduction against this app's design position that
enrolling somebody is an act with a name on it, and one to raise with whoever
owns the protocol.
