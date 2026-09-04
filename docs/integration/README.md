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

## 6a. ⚠ DEMO CABINET READINGS — a recorded, deliberate departure

**Battery, solar array state, cabinet temperature, uplink QUALITY and storage
shown on a real tower are SEED/DEMO VALUES, not real telemetry.**

None of them exist in coordination's §A.3 projection — not withheld, not
unimplemented, simply absent from the contract. `map.ts` leaves them absent and
every read site renders that absence properly (no battery cell on the mast,
`NO CABINET READINGS` in the hover panel, `Not reported` in the settings rows).
`src/lib/api/demoCabinet.ts` then puts fabricated values back, so the populated
UI can be seen during development.

This is an owner-approved departure from the honest-absence rule, taken
consciously. **One of the following must happen before this ships, and it is not
optional:**

1. the readings become real — the protocol grows them, `map.ts` maps them, and
   `demoCabinet.ts` is deleted; or
2. they are **marked on screen** as demo values, so nobody reads a fabricated
   87% as their site's actual charge; or
3. `DEMO_CABINET_READINGS` is set to `false` and the honest-absence states
   return — a one-line change, already wired.

Shipping as-is is the fake-green failure this integration exists to refuse, in
the one place an operator would never think to doubt it: a number on a card, in
the right font, beside real data. On an off-grid site, charge is what a dispatch
decision gets made on.

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
| 5 — Mutation primitive | ✅ **GATE PASSED** 14/14 | `useMutation` (keyed) + `MutationFeedback`. Three consumers: fleet reload (REAL, really fails), alert ack/resolve (seeded, proves the AlertDetail keying), tower rename (seeded, quiet). |
| 6a — Read breadth | ✅ **22/22** | All towers/feeds real, live clock, scoping proven cross-account, three fleet states, AlertsView nav. No mutations converted. |
| 6b — Mutation breadth | ✅ 13 wrapped, 2 optimistic by design, 0 fire-and-forget | Failure path proven by a one-shot injected throw, reverted. |
| 7 — Actuators + PTZ | ✅ **15/15 — the camera physically moves** | PTZ real via jog. Record/siren/talk stay shells: no backend exists for any of them. |
| 8 — Enrollment | ✅ **21/21** | Real claim, server-side pending that survives a reload. Serial removed. QR screens kept but cannot fake-add. |
| 15 — Live fleet wall | ✅ **19/19** | Visible tiles stream sub; off-screen closes. |
| 14 — Real network health | ✅ **15/15** | Real uplink grade from a real dBm; the IP row replaced by `connected_at`. |
| 13 — Per-camera playback | ✅ **13/13** | One camera's switch no longer drops its sibling's peer. |
| 12 — Real stream profiles | ✅ **20/20** | The Stream Quality row stops inventing options and drives the session. |
| 11 — Real rename | ✅ **18/18** | The first setting on the panel to become real. |
| 10 — The final sweep | ✅ **23/23** | Dead controls disabled-not-removed, the settings key named, `sharp` dropped. |
| 9 — Renewal + persistence | ✅ **25/25** | Part 1 was already complete from Stage 3 — verified, not rebuilt. Part 2 net-new: per-account view prefs. |
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

### Stage 15 result — the fleet wall streams what is visible, 19/19

**The wall used to draw stills** and tell the operator to open a tower. The
reasoning is still in `App.tsx` — a session costs a grant and a busy camera on
an off-grid site — and the half it got wrong was the arithmetic: "the fleet
screen" is not the fleet, it is the eight or so tiles that fit on a monitor, and
that number does not grow with the estate. A hundred towers cost what two do.

**Bounded three ways**, and the battery argument survives all three: by the
viewport, by a hard ceiling of **`MAX_LIVE_TILES = 8`** (four sites at two
cameras — the widest the design's two-column bands go, and a number a browser
holds peers for without complaint), and by the **sub** profile.

**Sub, always, on this wall.** Twelve tiles at 2K is a different order of uplink
and battery than twelve at 704×576, and nobody reads detail off a tile that
size. The operator's per-camera profile choice is deliberately NOT consulted
here — it is a choice about how they watch ONE camera, not licence to pull 2K
twelve times over. Verified: every fleet session asks `profile: "sub"` and every
fleet video is 704 wide.

**The churn guard is asymmetric hysteresis**, in `useVisibleTiles`:

| | | |
|---|---|---|
| open | `VISIBLE_SETTLE_MS = 400` | a tile must still be there after the scroll stops |
| close | `HIDDEN_SETTLE_MS = 1200` | 3× longer — a nudge off-screen and back must not cost a renegotiation |
| threshold | `VISIBLE_RATIO = 0.25` | a sliver at the edge is not worth a tower's battery |

Each timer cancels the other, so a tile that leaves and returns inside the grace
never notices, and one that arrives and leaves inside the settle never opens.
**12 fast visibility flips opened 0 sessions and closed 0.**

**The two screens are mutually exclusive, not additive.** Drilling in hands the
sessions over rather than opening a second set beside them — otherwise a grace
period would leave four sessions live on a two-camera tower.

⚠ **A bug my own cap test caught.** The tile prop conflated "is being streamed"
with "is visible", so a tile that was *on screen but over the ceiling* showed
the off-screen copy — a visible lie about a tile the operator is looking at. Now
`onScreen` is passed separately from `playback`, and the two reasons read
differently: *"Live — not on screen · Scroll it into view"* versus *"Live — not
streaming here · Too many cameras on screen to stream them all"* with an Open
tower button. Proven by temporarily setting the ceiling to 1.

⚠ **Scroll-off-screen is unreachable on this fleet** and the test says so rather
than passing vacuously: the dashboard is a fixed-height flex layout
(`scrollHeight === clientHeight`, no overflow container), so with one tower
nothing ever scrolls out of view. Visibility was driven by viewport size, which
enters the IntersectionObserver by exactly the same path. My first run had
B/C passing on a page that could not scroll — caught and rewritten.

### Stage 14 addendum — the "No signal reading" report was a stale dev server

Reported as a parse bug: the wire carried `uplink.signal_dbm` and the row said
"No signal reading". The hypothesis was that the SDK typed `uplink` without
parsing it, so a whitelist parser stripped it at the boundary.

**It did not.** `parseTowerList` keeps it — fed the real body it returns
`{"uplink":{"signal_dbm":-58}}` — and the row renders correctly. Four dev
servers were running and they disagreed on identical source:

| port | started | Uplink row |
|---|---|---|
| 5173 | 16:37 | ❌ No signal reading |
| 5190 | 17:27 | ❌ No signal reading |
| 5191 | 18:49 | ✅ Great · −56 dBm |
| 5174 | 19:11 | ✅ Great · −56 dBm |

The SDK's `dist/` was rebuilt at **18:43:59**. Every server started before it was
wrong; every one started after was right. The boundary is exact.

**Cause:** the SDK is `file:../sentry-sdk`, a symlink whose real path is outside
Vite's root, and the watcher only walks the root. Nothing tells a running server
the file changed, so the transformed module stays cached for the life of the
process — silently, with no error.

**Fix:** `vite.config.ts` gained a small `watch-linked-sdk` plugin that adds the
SDK's `dist/` to the watcher and triggers a full reload on change (full reload
rather than HMR: this is the boundary all the app's data passes through, and
patching it in place would leave half the tree holding values parsed by the old
copy). Verified by touching `dist/` and watching the server log it. Also written
up in `CLAUDE.md`, because the next person will hit it from the other direction.

No product code changed — the grading path was correct as committed in `a8d3305`.

### Stage 14 result — "Connected since" is real, 12/12 (uplink grade blocked)

**The IP row is gone, replaced by something the tower actually reports.** It
printed `192.168.1.230` on every tower in the fleet — a demo literal. It now
reads e.g. `06:16:53 PM WAT · up 2m`, from coordination's `connected_at`,
checked against what the server actually served rather than against itself.

`ipAddress` is deleted from `Tower`, from the seed and from the demo cabinet —
grep confirms no IPv4 is rendered anywhere. It is also the kind of routing
detail §A.6 keeps off the wire, so the projection is unlikely ever to carry one.

**Wall clock first, duration second, and that ordering is the app's time rule
rather than a layout preference.** The brief suggested "connected 3 days ago",
but `formatRelative` is reserved for two transient banners whose whole job is
*this just happened*, and neither re-ticks. Operators hand incidents over by
radio across shifts; a row that only said "3 days ago" gives the next shift
nothing to quote. So the instant leads, in site time and labelled, and a new
`formatUptime` rides beside it — a duration is a *second* value, not a
replacement for the instant.

`connected_at` is **per connection**, not cumulative: coordination builds its
link object fresh on each connect, so a short value is itself the reading — it
says the site is flapping, which a cumulative uptime would average away. Absent
while offline, and the row says **"Not connected"** rather than
`RowReading`'s generic "Not reported" — the tower did not fail to report a
connection time, it has no connection.

The tick is `useNow` in its own `ConnectedSince` component. The hook's own note
warns against calling it in `TowerView`, where a re-render twice a minute pushes
through the tile tree and makes a takeover snap instead of animate. Verified:
the video tiles are untouched across a tick.

⚠ **The SDK had no `connected_at`** — coordination served it, nothing could read
it. Added (see `sentry-sdk`), preserving absence as absence rather than coercing
it to null: "offline" and "connected at an unknown time" are different claims.

#### The uplink grade — now real, across three layers

Unblocked by building all three: coordination projects it, the SDK types it,
the dashboard grades it.

**Coordination projects `health.uplink` and NOTHING ELSE from the health block.**
Door, cover, impact, thermal, disk and feeds are operational detail for the
platform, not viewer data, and §A.6's posture is a whitelist. Proven against a
full internal health block — every one of those is absent from the projection,
and so is **`iface`**, which sits *inside* the uplink block and is the easy one
to miss: an interface name describes how the tower is plumbed and is exactly the
routing internal `test_no_ip_or_routing_internal_is_exposed` already forbids.

**The grade is computed in the dashboard, and only ever from a number.**
`uplinkReading` in `map.ts` is the single place; the tower reports the fact and
refuses to grade it, coordination passes it through and refuses to grade it, and
this file decides. Same split as `as_of` → staleness.

| dBm | Grade |
|---|---|
| better than −60 | **Great** |
| −60 … −75 | **Fair** |
| worse than −75 | **Poor** |

Exercised against the real module, every branch:

```
-45 -> great   -59 -> great   -60 -> fair   -68 -> fair
-75 -> fair    -76 -> poor    -91 -> poor
ethernet -> wired        associated:false -> unassociated
named-only -> unmeasured        absent -> unmeasured

graded: 7 (all carry a dbm)   non-graded: 4 (none carry a grade)
```

That last line is the structural guarantee: **there is no arrangement of missing
data that produces a grade**, because every non-numeric path returns a variant
with no `grade` field at all.

**The dBm is shown beside the grade** — `Great · -57 dBm`, live from the tower —
for the same reason a stream profile shows its resolution: a label with the
measurement behind it can be checked; one without it has to be believed.

The three non-signal states get **no colour**. They are not degradations, and
painting "Wired" amber would report a fault on hardware that is working. The
demo grade is gone from `demoCabinet` entirely.

**Coordination does not project the health block to a viewer at all.**
`project_tower` returns `device_id`, `label`, `link`, `as_of`, `cameras`,
`sensors` and now `connected_at` — and nothing else. Confirmed live: the tower
detail response has no `health` key, and `grep` finds no `uplink` or
`signal_dbm` anywhere in `coordination/`.

The tower agent's half is complete and its reasoning already matches the brief:

> **THE FACT, NOT THE VERDICT.** This reports `signal_dbm` and nothing else — no
> Great/Fair/Poor. The tower measures; the dashboard decides what counts as
> good. — `UplinkProbe`, `kallon_watchdog.py`

`inventory.py` forwards `health["uplink"]`, ethernet reports `type: ethernet`
with no `signal_dbm`, and a failed read reports nothing. Coordination *absorbs*
that block (`_absorb_health`) and uses it internally to derive camera status —
but never projects it outward.

So three layers are needed, not one: coordination must project `health`, the
SDK's `TowerHealth` needs an `uplink` member, and only then can the dashboard
grade it. Until then the Uplink row still shows its **demo** grade, which now
sits against this stage's own honesty rule and is recorded as open.

### Stage 13 result — playback is per camera, 13/13

**The bug.** Switching camera 1's profile tore down camera 2's peer as well —
both tiles went to *awaiting media* when only one had been asked to change.

**Root cause: one effect owned every camera, and a cleanup cannot close *some*
of what it owns.** `usePlayback` built its `entries` map fresh inside the
effect, so the only way to close anything was the effect's cleanup — which
loops over every entry unconditionally. The dependency is a single string joined
across all targets, so any one camera's segment changing re-ran the whole
effect: cleanup closed all peers, the body reopened all peers.

Not tower-scoped by design — **list-scoped**, and the list happens to be the
open tower's cameras. Two independent sessions with one shared fate.

⚠ **This predates the profile work.** `attempts[t.id]` was already in that same
key, so *retrying camera 1 already dropped camera 2*. Stage 12 only made it easy
to hit: a retry is rare, changing quality is not.

**The fix is a `continue`.** The pool of open peers moved to a ref that survives
across effect runs, so the effect can now reconcile instead of rebuild:

1. close only entries whose own per-camera key changed, or that are gone;
2. prune phases for cameras nobody is watching;
3. open only what is missing.

`targetKey` is now **one camera's** identity — `towerId:index/profile#attempt` —
compared per feed rather than concatenated into a list. The joined string stays
as the effect's *trigger*, but it is no longer its *scope*, and the code says
so at the site.

The reconciling effect deliberately has **no cleanup**: a cleanup runs before
the next body and cannot know what that body wants, so anything it closed would
be closed unconditionally — which is the bug. Closing belongs in the body, where
the diff is known. A separate mount-only effect closes everything on unmount,
which is the one moment that is correct.

**Verified against the real tower, both cameras live.** The other camera's
`videoWidth` and `currentTime` were sampled every 120ms *through* each switch:

| | |
|---|---|
| switch camera 1 → 2K | camera 2's minimum width throughout: **704** (never 0), clock monotonic, **exactly one** session POST — `{camera: 1, profile: "main"}` |
| switch camera 2 → 1080p | camera 1's minimum width: **2560**, one POST for camera 2 |
| four rapid switches on camera 1 | four POSTs, **all `camera: 1`**; camera 2 untouched at 1920 |

**Control run: the test was checked against the unfixed code** and fails exactly
where it should — camera 2's width drops to **0** and a second POST appears for
`{camera: 2}`. 7/13 unfixed, 13/13 fixed. A test that cannot fail proves
nothing, which is the lesson from the Stage 5 gate.

### Stage 12 result — Stream Quality is real, 20/20

The second field on the settings panel to stop pretending, and the first that
was actively **wrong** rather than merely inert: it offered "Full HD (1080P) ·
30 fps" on a camera serving **2560×1440**.

**Real options, per camera.** The list comes from the projection's per-camera
`profiles`, so camera 1 shows `sub` and `2K · 2560×1440` while camera 2 shows
`sub` and `Full HD · 1920×1080` — different hardware, different lists. Stream
Quality joins Activity Zones as the only rows on a tower-wide panel that have to
say which camera they mean.

**Switching re-opens the session, and that is not a workaround.** A profile is
signed into the grant, so there is no such thing as changing the profile of an
open session — a different profile IS a different session. Putting `profile` in
`usePlayback`'s effect key means choosing one tears the old peer down and opens
a new one through exactly the path a retry already uses: no second mechanism,
and the honest `connecting` state comes for free rather than being simulated.

**Proven end to end:** picking 2K took the video element from **704 → 2560**
wide. The label was true.

| | |
|---|---|
| honest switching | `connecting` observed, sampled rather than slept past — not a frozen frame of the old quality |
| failed switch | session POST severed → *"Stream unavailable"* + retry; **no dead tile**, and retry recovers |
| persistence | `cameraProfiles` in `sentinel.prefs.v1:<account_id>`, keyed **per feed** — reload re-opens at `main` |

**The label rule, and the case that tested it.** The tower declares no
resolution for `sub` — it *serves* 704 wide but never says so, because
resolutions are declared from config and never probed. So the option is labelled
`sub`, with the note *"The tower reports no resolution for it."* Reading 704 off
the `<video>` element was available and was refused: that measures what arrived
rather than what was advertised, and it cannot label the option the operator is
**not** currently watching. The tier is only ever an addition to the numbers —
`2K · 2560×1440`, never `2K` alone — because a tier standing in for a number is
exactly how "1080p" ended up printed over a 2K stream.

**How the fake setting was reconciled: deleted, not repurposed.**
`CameraSettings.quality` is gone from the type, the defaults and the store. It
was tower-keyed while a profile choice is per-camera, so repurposing the key
would have silently given one camera's choice to the other. The row now writes
nothing to `settings` at all.

**Persistence: a view preference, deliberately.** Choosing a profile does not
configure the tower — it does not change what the camera records or what anyone
else sees; it selects which of the streams the tower is *already serving* this
browser pulls. Two operators can watch the same camera at different profiles and
neither is more correct. So it sits beside the wall arrangement, not in
`cameraSettings`. If it were ever pushed to the tower it would stop being a
preference and would have to move.

A remembered id the camera no longer advertises is **dropped**, not sent:
coordination refuses an id it does not recognise, so a stale preference would
become a feed that will not start. Falling through to the default is the honest
recovery.

⚠ **Three blockers had to clear first**, and two were the staleness trap again:
coordination and the tower agent were both running pre-14:49 code, so no
profiles were advertised at all — the running coordination accepted
`profile: "NOT-A-PROFILE"` and returned `201`, where current code returns `422`.
The third was not staleness: **the SDK had no profile support written**, so it
was added here (see `sentry-sdk`, 39/39).

### Stage 11 result — the tower rename is real, 18/18

The first field on the settings panel to stop pretending. `PATCH
/v1/viewer/towers/{device_id}` landed in coordination and `renameTower` in the
SDK, so the client half written back in 6b finally has the server half it was
waiting for.

**The bug that is fixed:** an operator renamed a site, the name changed on
screen, the write went nowhere, and the old name came back on the next load.
Verified gone — rename, reload, and the new name is on the fleet card, the band
header, the breadcrumb and the panel, because all four read one field that now
lives in the registry.

**No optimism, and that is the point.** The old path wrote to local state before
anything was sent, which is *how* the revert bug looked correct for a second.
The order is now run → the field shows it is saving → the registry answers →
and the name that lands is read out of the server's own projection, not the
string that was typed. A failed write leaves `towers` untouched.

| Failure | Induced by | Result |
|---|---|---|
| bad label | committing an empty name | **`422`**, *"label: must be a non-empty string"* shown verbatim, **name unchanged**, retry offered |
| unreachable | aborting the PATCH | *"failed: Failed to fetch"* — reads as a network problem, **not** as a bad name; **name unchanged** |
| retry | letting the request through, clicking retry | **genuinely re-runs**: a second PATCH, `200`, and the name lands |

**Two client-side rules were deleted, not kept.** The old commit did
`.trim().toUpperCase()` and dropped an empty result silently. Both had to go:
`set_label` is the only validator, its `422` says which rule was broken, and a
copy of that policy here would be free to drift — while the emptiness check
swallowed the one error an operator most needs to see. The field still displays
uppercase, which is CSS and does not touch the value.

**The local-only path is gone.** Not kept as a fallback: two names for one site
with no way to tell which the registry holds is a worse failure than the one
being fixed.

A rename touches the registry and nothing else — no envelope, no WSS relay, no
tower involvement — so **an offline tower can still be renamed**. It is the one
write on the fleet screen that does not need the site to be reachable.

⚠ **Operational note.** The route 404'd for the first run of this suite, and the
cause was not the code: coordination had been running since 03:54 the previous
day and `server.py` was edited at 12:56, so the running process had no such
route. The tell was the 404 *body* — `{code: "not_found", message: "<path>"}`,
byte-identical to a route that does not exist, where the real route answers
`tower_unknown`. Worth knowing: **the `towers` table is empty in the DB and
tower records are held in memory**, established when the tower links. Whether a
label survives a coordination restart is a separate question from surviving a
browser reload, and is not yet answered.

### Stage 10 result — the final sweep, 23/23

**No control was removed.** Each dead one is still drawn, dimmed, `disabled`,
and carries a title saying why. The global `button:disabled { cursor: not-allowed }`
rule in `index.css` already existed, so all four say it before they are pressed.

| Control | Treatment | Why not wired |
|---|---|---|
| **Escalate** (`AlertDetail`) | disabled + *"not available yet"* | Coordination serves **no alert routes at all** — no ticket, no rota, no recipient |
| **Hero play** (`AlertDetail`) | ⭐ **WIRED** | It is the alert's own attachment; it now hands the same pair to the same panel its sibling clip cards do |
| **Update Firmware** (`CameraSettingsPanel`) | disabled + *"not available yet"*, **and the green removed** | The agent reports `agent_version` and accepts nothing back |
| **Settings** (`IconRail`) | disabled + *"not available yet"*, `unavailable` flag on the NAV entry | No account-level settings screen exists; per-tower settings are reached from the tower bar |

The hero play button was the one worth wiring rather than disabling: it looked
exactly like the timeline's clip-card play buttons and did nothing. `alert.attachment`
is hoisted to a local so the narrowing survives into the callback — a non-null
assertion there would be one typo away from showing an operator the wrong
incident's footage.

Two audits ran rather than trusting the list. Every `<button>` with no click
handler: five hits, of which `TowerCard:127` was the word `<button>` **inside a
comment** and `PtzPad:92` spreads `{...press(dir)}` — three real, all treated.
Every optional `on*` prop never passed by a parent: **none**. And `settings` is
the only `navigate` fallthrough.

`Zoom out` shows disabled twice on the tower screen and is **correct** —
`view.zoom <= ZOOM_MIN`, once per camera. Honest state, not a dead control.

**The settings key: the TOWER's id won, and nothing changed behaviourally.**
`App.tsx` named its parameters `feedId`; every caller passed `tower.id`, because
`TowerView` opens one panel from the tower bar and there is no per-camera
settings surface. So the stored key was **always** a tower id and only the name
was wrong. Nothing had ever read the wrong record — the hazard was the next
person to trust the name and look one up by feed, at which point a two-camera
site silently gets defaults instead of its own configuration. Renamed to
`towerId` throughout, with the reason at the site.

It is per-tower because that is what the panel edits: zones, uplink, retention
and power are properties of a site, not of one lens. ⚠ If settings ever become
per-camera, the key must change **with a migration** — `lib/prefs.ts` persists
this map verbatim, so a bare reinterpretation would hand every operator back
defaults on their next visit.

**`sharp` dropped.** devDependency, no import in `src/`, no npm script, no
config reference — the only textual hits were the word *"sharpest"* in two
comments. Removed from `package.json` and the lockfile (6 packages); build clean
at the same 498 modules.

### Stage 9 result — session lifecycle + persistence, 25/25

**Part 1 was already complete from Stage 3** and was verified rather than
rebuilt: `readSessionExpiry`, `msUntilSessionExpiry`, `STATUS_POLL_MS = 60_000`,
`STATUS_POLL_TOLERANCE = 3`, the re-arming hard-stop watcher, and the
server-only deadline rule.

**No local clock extension.** `deadline` is assigned in exactly two places, and
both take a server value — `opened.session.expires_at` at creation and
`readSessionExpiry`'s return on each poll. Reading the field IS reading the
authorization verdict, so a client that added time locally would turn a
revocation into a feed that keeps playing.

**The three end-states are distinct, and each was induced for real:**

| | Induced by | Result |
|---|---|---|
| **renewed** | letting a watched feed run past a poll cycle | **2 status reads in 65s, feed uninterrupted, nothing on screen** |
| **revoked** | coordination's own `/dev/sessions/{id}/renew` with `lifetime_sec: 2` | *"Viewing ended — Access to this camera ended"*, **2 → 1 playing**, Resume offered |
| **outage** | severing only the status poll for 70s | **the feed kept playing** — a blip is not an authorization answer |

Revocation is **per session, not per tower**: one shortened grant ended one
tile while the second camera carried on. Killing the whole wall would be its own
kind of dishonesty.

**Resume viewing opens a NEW session.** `retry` bumps the attempt, the effect
re-runs `openPlayback`, and that calls `createSession` — a fresh authorization,
never a local un-expire.

**Part 2 — persistence, and the line it draws.**

| Persisted (`localStorage`, keyed by `account_id`) | Deliberately NOT |
|---|---|
| wall arrangement | **the session token** — stays in `sessionStorage`, dies with the tab |
| notice dismissals (lifted out of `TowersPanel`, which unmounted on every drill-in) | **the pending claim** — already server-side ownership; a local copy would be a second answer to "is this tower mine" |
| camera settings/zones, **marked local-only** | **seeded domain mutations** — acks, enrolments, watchlist changes, rejected matches |

The last one is the important line. Acknowledgements have **no backend**, so
persisting one would make it *look* durable: an operator would acknowledge an
alert, reload, see it still acknowledged, and reasonably conclude the record is
somewhere. It is not — it is in one browser, invisible to the next shift and to
any audit. Losing it is obvious and teaches the truth; faking its persistence
teaches the opposite and is only discovered when somebody needs the record.

Camera settings are persisted despite also lacking a backend, and the
distinction is deliberate: an acknowledgement is a claim about something that
**happened** and belongs in a record; a settings panel is a claim about what the
operator **wants**, which is a preference by nature. The moment settings gain a
backend this must move out, because then a local copy would disagree with a
tower.

**Cross-account isolation confirmed:** each account gets its own
`sentinel.prefs.v1:<account_id>` key, and a second account sees only its own.

### Stage 8 result — real enrolment, 21/21

**Two contract findings reshaped the flow**, both checked in coordination's
source rather than assumed:

1. **The pairing code is 12 Crockford characters**, not 6 digits —
   `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, with `I`, `L`, `O` and `U` absent by
   construction and **rejected rather than remapped** (silently turning a typed
   `O` into `0` would authenticate a code the operator never read). Grouped
   `K7QM-4X8N-P2W3`; case and separators are ignored.
2. **The label is set AT CLAIM TIME**, not after. `create_pending_claim` takes
   it alongside the code and carries it into the tower record at enrolment, and
   `do_PATCH` serves only session ICE — there is no route to change a label
   later. So the design's "NAME THIS SITE after it connects" ordering is not
   possible: asking after would mean inventing an endpoint or showing a field
   that quietly does nothing. Both real inputs are collected together instead.

**The serial is gone.** There is no serial anywhere in this system — the
pairing code IS the identifier, derived from the tower's own public key. The
field, its validation and `findUnclaimed`'s serial match are all removed.

**The fake provisioning is deleted**, not left unused: `UNCLAIMED`,
`nextUnclaimed`, `findUnclaimed`, `UnclaimedUnit`, `PendingTower` and
`addTower`. **No path in this app can now put a tower on a fleet the server
does not already have** — grep-confirmed: no client-side tower insertion
anywhere.

**The QR path keeps its screens and cannot finish.** The old
`setTimeout(4500) → onClaimed(unit)` fabricated a tower unconditionally.
Verified: sitting on that screen for 7s — well past the old timer — leaves the
tower count at 1 → 1.

**The pending state is real and server-side.** A registered claim survives a
full browser reload, because it was never ours to hold — `GET /v1/viewer/claims`
is the only reason a registered-but-not-yet-connected tower is anywhere at all.
15-minute TTL with a real countdown; a lapsed claim says "register again"
rather than spinning forever.

**Honest failures, all real:** a `409` from another account claiming the same
code says so specifically and is *not* phrased as a bad code; a severed network
reads `Can't reach coordination`; an excluded letter cannot even be submitted.
The pairing code is a parameter only — never logged, never in a response
(verified absent from the claim body), cleared from state on success.

**The "bringing online" checks were removed rather than faked.** They were four
`setTimeout(900)` ladders reporting `UPLINK`, `SOLAR`, `BATTERY`, `FIRST FRAME`
as pass/fail probes we cannot run — coordination exposes no such probe, and
three of the four are the cabinet readings that do not exist. What replaces them
is the tower simply appearing on the fleet with its real link state and real
per-camera status, which is the same information without the theatre.

### Stage 7 result — real PTZ, 15/15

**The camera physically moved, proven by its own reported position** — read via
`action: "status"` on the session the app itself opened, so nothing steered by a
side door:

```
BEFORE  pan -0.1636   pan_deg 209.45°
AFTER   pan -0.9854   pan_deg 357.37°     (a 2.6s left jog through Terra's pad)
```

That is the "moves only small" fix. The old pad nudged the on-screen IMAGE by
2.5% per 125ms tick, clamped so the frame's own edge never showed — the picture
shifted a fraction and stopped, and **the camera never moved at all.**

**The command shape, captured off the wire:**

```
move → keepalive → stop        4 commands for one 2.6s hold
move params: {"mode":"jog","pan":-0.5}
```

One move on press, **one keepalive from the SDK** (~1.5s cadence, inside the
daemon's 4s deadman), one stop on release. The old repeat would have sent ~21
commands for the same gesture and produced a stream of `SUPERSEDED`.

**Which actuators became real, and which did not.** Checked, not assumed:

| Actuator | Backend | Result |
|---|---|---|
| **PTZ** | `move · stop · keepalive · status` | **REAL** |
| Record | none — and `RECORD_ENABLE=0` on both towers, recording unported, no segments exist | shell |
| Siren | no route in coordination, not in `PtzAction` | shell (local browser audio) |
| Talk | no two-way audio anywhere | shell |

`PtzAction` is exactly four verbs and coordination serves no record/siren/audio
route, so three of the four stay honest shells from Stage 6b. Nothing was faked.

**The two zooms are separated.** The control-stack zoom is DIGITAL — it crops
the delivered frame, costs the tower nothing, and stays a local CSS transform
(verified: **0** PTZ commands sent). The pad is OPTICAL and issues real
commands, and for a real head **the local transform is not applied** — the frame
would otherwise jump by the CSS amount and then drift again as the head
arrived, showing one movement twice.

**Stop is unconditional.** Navigating away mid-move still issued a stop
(`move → stop`), and a hold is also released when the feed dies or the tile
unmounts. Relying on the 4s deadman for ordinary teardown is how a safety
backstop stops being a backstop.

**`SUPERSEDED` is never shown.** Four rapid direction changes produced no error
chip. It is the normal outcome of a rapid tap, and with jog start/stop it is
rare anyway — but rarity is not a reason to report it.

### Stage 6b result — every mutation wrapped

**13 wrapped · 2 intentionally optimistic · 0 left fire-and-forget.**

| Mutation | Decision | Why |
|---|---|---|
| fleet reload | pending-silent | **REAL server.** The fleet appearing is the confirmation |
| rename tower | pending-silent | the new name is already on four surfaces |
| settings (+ zones) | pending-silent | each row shows its own new value; the drawn rectangle is the confirmation |
| add tower | pending-silent | the flow **lands on the tower** — a check on a replaced screen is shown to nobody |
| record | pending-silent | the glyph changes shape, circle → square |
| retry feed | pending-silent | the tile shows CONNECTING at once |
| siren · talk · screenshot | pending-silent | each confirms itself: the beacon lights, the timer starts, the frame flashes |
| acknowledge / resolve | **pending-check** | changes an auditable record whose row does not visibly move |
| reject match | **pending-check** | drops an identity from a detection that keeps its record |
| enrol person | **pending-check** | puts a named person under fleet-wide matching; the subject is not in the room |
| stop watching | **pending-check** | matching ends now, and the card does not say so loudly |
| delete person | **pending-check** | irreversible |
| extend watch | **pending-check** | only visible change is a date further down the panel |
| **reorder wall** | **optimistic** | pure view preference; instant is correct |
| **dismiss notice** | **optimistic** | pure view preference |

`setFeedState` and `raiseAlert` are simulator affordances, not product
mutations, and are already withheld on a real fleet.

**Talk-down's release is deliberately never wrapped.** `onEnd` fires
unconditionally, following the same rule the protocol gives PTZ stop: refusing
to close a channel can only leave a microphone open into a live yard; accepting
one can only leave it shut. It must not be gated behind a pending state, a
permission check, or a failure.

**How the failure path was proven without shipping a synthetic failure:** the
suite was run twice. Once against the product as it ships, and once against a
build where ONE seeded mutation (`extendWatch`) was temporarily given a
one-shot throw. That run showed the inline error carrying the thrown message
verbatim, `role="alert"`, Try again and Dismiss, and a **retry that genuinely
re-ran and succeeded** — the throw being one-shot is what makes the re-run
observable rather than assumed. The edit was reverted and the absence of any
`forced failure` string re-grepped; the normal suite then passed again.

`TileControl` gained `busy`, distinct from `disabled`: disabled says *you
cannot*, busy says *you already did, wait*. On a control that reaches a physical
site those are different things to tell somebody, and only one is temporary.

### Stage 6a result — read breadth, 22/22

**Video policy at breadth, confirmed by measurement:** the fleet wall opened
**0** sessions and drew **0** `<video>` elements; drilling in opened **2** (one
per live camera) and real frames decoded. A session costs a grant and a busy
camera, and this app already warns that live viewing drains an off-grid battery
— four streams on the landing screen would contradict its own advice.

**A gap that only appeared at breadth:** a real camera carries no poster (the
mapper refuses to attach one), so a live camera on the fleet wall rendered an
empty `<img>` under a green LIVE chip — a picture-shaped hole with no
explanation. `NotStreamingFallback` now says *"Live — not streaming here"* with
a way to open the tower. Grey, because nothing is wrong.

**The clock is live.** `SESSION_NOW` was a module-load constant, so on a wall
left open for a shift "last hour" meant "the hour before this tab was opened".
It is now `siteNow()` plus a `useNow(30s)` tick inside the two alert feeds —
inside them deliberately, because a tick in `TowerView` would push a re-render
through the tile tree twice a minute and snap the takeover animation. Verified
by jumping the browser clock +2h with no reload: **`Last hour` 6 → 0** while
`Last 7 days` held at 12.

**Per-account scoping, proven cross-account** by seeding a second account
(`Northgate Security`) and trying to reach the first's tower:

| Attempt | Result |
|---|---|
| Terra → its own tower | `200` |
| **Northgate → Terra's tower** | **`404 tower_unknown` "no such tower"** |
| Northgate → a tower that does not exist | **byte-identical `404`** |
| Northgate → `createSession` on Terra's camera | `404` — cannot even open one |
| No token | `401` |

The two 404s are indistinguishable, which is the anti-enumeration property
working. A new account's fleet is `{"towers": []}` with a **200**, never a 403.

**Three fleet states, kept distinct:** loading · a read failure (the shell
banner) · genuinely empty (*"No towers on this account yet"*) — verified that
empty reads as neither a failure nor a signed-out state.

`findTower` is **deleted**, not merely unused: its `?? TOWERS[0]` returned a
different tower's data for an id it could not find, which under real scoping
draws another account's telemetry under the requested name.

`AlertsView` gained the arrow stepping it never had — verified Down/Up/Escape,
matching `AlertsPanel` exactly.

### Stage 5 result — the gate, passed 14/14

Run against the live app, live coordination and the real tower, with the
network genuinely severed at the network layer rather than mocked.

| | Result |
|---|---|
| **A** sever `/v1/` | banner + Try again; pending shows `aria-busy`, spinner and "Trying…"; **the retry really re-issued the request** (4→5) and failed again honestly |
| **B** restore | **the same retry succeeded** (5→7) and the real fleet came back — the retry genuinely re-runs the work rather than clearing the error |
| **C** three rapid clicks | **one** request. The ref latch holds |
| **D** the `AlertDetail` trap | acknowledged ALT-8841, confirmed the check **was** showing, swapped to ALT-8840 → **no check, spinner, busy or error carried across** |

Two things the run corrected, both in the TEST rather than the product:

- **A3 first reported a false failure.** It slept 400ms then looked for the
  pending state. Sampling every frame from the click showed pending renders
  correctly at t=8ms and t=9ms — it lasts about **10ms**, because an intercepted
  abort fails almost instantly. With a 600ms delay before the failure it is
  visible for the full 613ms. The product was right; the probe was looking too
  late. Fixed to sample from the click.
- **D initially proved nothing.** It read the alert id from `document.body`
  text, which matches the first `ALT-` anywhere — a row in the list behind the
  panel, not the open alert — and it arrowed, which does not step the fleet
  feed (see below). It now reads the id from the detail's own header, asserts
  the check **is** showing first as a positive control, and swaps by selecting a
  row, which is the identical in-place content swap the trap needs.

**Finding, pre-existing and unrelated to this stage:** arrow-key stepping
through the feed is bound in `AlertsPanel` (the per-tower feed) and **not** in
`AlertsView` (the fleet feed) — zero occurrences at `master`, so it has never
been there. The two feeds are otherwise deliberately the same pieces, and this
is the kind of divergence the shared-components decision exists to prevent.
Worth closing in Stage 6.

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
