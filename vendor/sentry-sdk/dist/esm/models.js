/**
 * Data contract for the Sentry v2 viewer-facing API.
 *
 * Every shape here is derived from `sentry-core/docs/session-protocol.md`
 * (protocol v1). Each block cites the section it comes from. **The protocol is
 * the authority**: if a type here and the document disagree, the document is
 * right and this file is a bug.
 *
 * Nothing from the v1 (Bayana / sentinel-sdk) data model carries over. There is
 * no VPN, no WireGuard, no hub and no enrollment lifecycle in the viewer's
 * vocabulary. A viewer knows about towers, cameras, sessions, PTZ and health.
 */
/**
 * The daemon's safety deadman (§5.1): a PURE LINK-DEATH safety net. If no
 * keepalive and no command reaches the tower for this long, the mount stops
 * itself (tab closed, link dropped). It is NOT the stop-on-release path — an
 * explicit Stop bounds the release coast to ~1 link-latency — so it is set
 * GENEROUS so it never false-fires mid-hold when keepalives merely JITTER over a
 * high-latency link (a 1s deadman fired during legit holds at ~1s latency,
 * because keepalives sent every 0.5s can arrive ~1s apart). It must exceed the
 * worst-case keepalive-ARRIVAL gap over the link. Mirrors the tower's
 * `CONTINUOUS_SAFETY_TIMEOUT_SEC`; keep the two in step.
 */
export const PTZ_DEADMAN_MS = 3000;
/**
 * Keepalive cadence while a continuous move is held (§5.1). It only REFRESHES
 * the deadman — the camera already moves continuously from one ContinuousMove,
 * so this causes no per-tick movement and never piles up regardless of latency.
 * Set WELL inside {@link PTZ_DEADMAN_MS} with generous headroom for round-trip
 * time and jitter, so even several late/jittered keepalives in a row cannot let
 * the deadman lapse during a genuine hold.
 */
export const PTZ_KEEPALIVE_MS = 600;
/**
 * The longest slice a single request may ask for (§12.6), in seconds.
 *
 * Coordination refuses more with `slice_too_long`, and the reason is the link:
 * at the reference tower's measured ~7.4 Mbps a 30s slice is ~28MB, while a
 * whole 15-minute segment would be ~830MB — which the tower's control link
 * also carries heartbeats and PTZ keepalives on. The bound is the feature, not
 * a limitation of it.
 */
export const RECORDING_MAX_SLICE_SEC = 30;
/**
 * The longest CLIP a viewer may download (§12.6), in seconds.
 *
 * Larger than a review slice because it answers a different question. A slice
 * is speculative and frequent — dragged past, mostly unwatched — so it is kept
 * small enough that a wasted one costs nothing. A clip is asked for once,
 * deliberately, by somebody who means to keep the file.
 *
 * ⚠ THE LARGER BOUND DOES NOT RELAX THE PACING. A clip is the same 64KB chunks
 * through the same priority writer as a slice; there are simply more of them,
 * and the tower's control-plane guarantee is a property of that writer rather
 * than of the transfer's size. At this fleet's ~7.4 Mbps main stream five
 * minutes is ~275MB, which neither side buffers.
 */
export const RECORDING_MAX_CLIP_SEC = 300;
//# sourceMappingURL=models.js.map