"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECORDING_MAX_CLIP_SEC = exports.RECORDING_MAX_SLICE_SEC = exports.PTZ_KEEPALIVE_MS = exports.PTZ_DEADMAN_MS = void 0;
/**
 * The daemon's safety deadman (§5.1): a held `jog` or unbounded `continuous`
 * must be refreshed more often than every 4 s or the mount stops itself.
 */
exports.PTZ_DEADMAN_MS = 4000;
/**
 * Recommended keepalive cadence (§5.1): "the viewer SHOULD send at ~1.5 s
 * intervals", because over a WAN the 4 s budget includes round-trip time.
 */
exports.PTZ_KEEPALIVE_MS = 1500;
/**
 * The longest slice a single request may ask for (§12.6), in seconds.
 *
 * Coordination refuses more with `slice_too_long`, and the reason is the link:
 * at the reference tower's measured ~7.4 Mbps a 30s slice is ~28MB, while a
 * whole 15-minute segment would be ~830MB — which the tower's control link
 * also carries heartbeats and PTZ keepalives on. The bound is the feature, not
 * a limitation of it.
 */
exports.RECORDING_MAX_SLICE_SEC = 30;
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
exports.RECORDING_MAX_CLIP_SEC = 300;
//# sourceMappingURL=models.js.map