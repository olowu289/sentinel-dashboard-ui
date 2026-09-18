/**
 * Minimal runtime validation for API responses.
 *
 * ## Why this exists
 *
 * v1's SDK had none. TypeScript types are erased at runtime, so every response
 * body was a blind `as` cast: if coordination ever changed a field name or sent
 * `null` where a number was promised, the SDK handed the dashboard a lie and
 * the failure surfaced hundreds of lines later as `Cannot read properties of
 * undefined`. That is the worst kind of bug to debug across a service boundary,
 * because the stack trace points at the consumer and the fault is at the
 * producer.
 *
 * ## Why it is hand-rolled
 *
 * Zod or valibot would be the obvious choice and both are good. Neither earns a
 * runtime dependency here: this SDK validates **six** response shapes, the
 * checks are shallow, and the whole file is smaller than the dependency's
 * README. The rule for this package is zero runtime dependencies (as v1 had),
 * and that rule is worth more than the ergonomics of a schema DSL for six
 * shapes.
 *
 * ## What it does and does not enforce
 *
 * It is **structural, not exhaustive**. It checks that required fields exist
 * with the right primitive type, and that arrays contain the right kind of
 * thing. It does **not** reject unknown extra fields: §2.2 and §A.9 make
 * forward compatibility explicit, and a validator that rejects a field the
 * server added last week would turn a compatible change into an outage. Unknown
 * fields pass through untouched.
 *
 * **There is exactly one exception**, and it is not an inconsistency: a
 * projected inventory carrying `path`, `whep_path` or `boot_id` is rejected
 * loudly, because §A.6 puts those in a MUST-NOT tier and puts the obligation to
 * refuse them on the consumer. See {@link assertNoProjectionLeak}. Everything
 * else in §A.6's SHOULD-omit tier — `codec`, `calibrated`, internal health
 * detail — is tolerated in silence whether present or absent.
 */

import { ProjectionLeakError, ValidationError } from "./errors.js";
import type {
  CameraInfo,
  StreamProfile,
  UplinkHealth,
  IceCandidate,
  IceCandidatesResponse,
  IceServer,
  PtzResult,
  SensorInfo,
  TowerDetail,
  ViewerSessionStatus,
  TowerHealth,
  TowerInfo,
  TowerListResponse,
  ViewerSession,
} from "./models.js";

/* ------------------------------------------------------------------ *
 * Tiny checking kernel
 * ------------------------------------------------------------------ */

/** Collects field paths that failed, so one error reports every problem. */
class Check {
  readonly issues: string[] = [];

  fail(path: string, expected: string, got: unknown): void {
    this.issues.push(`${path}: expected ${expected}, got ${describe(got)}`);
  }

  obj(path: string, v: unknown): Record<string, unknown> | undefined {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, "object", v);
      return undefined;
    }
    return v as Record<string, unknown>;
  }

  str(path: string, v: unknown): string {
    if (typeof v !== "string") {
      this.fail(path, "string", v);
      return "";
    }
    return v;
  }

  num(path: string, v: unknown): number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, "finite number", v);
      return 0;
    }
    return v;
  }

  bool(path: string, v: unknown): boolean {
    if (typeof v !== "boolean") {
      this.fail(path, "boolean", v);
      return false;
    }
    return v;
  }

  arr(path: string, v: unknown): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "array", v);
      return [];
    }
    return v;
  }

  /** Integer with an optional inclusive minimum — §A.2's `index` is ≥ 1. */
  int(path: string, v: unknown, min?: number): number {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      this.fail(path, min === undefined ? "integer" : `integer >= ${min}`, v);
      return min ?? 0;
    }
    if (min !== undefined && v < min) {
      this.fail(path, `integer >= ${min}`, v);
      return min;
    }
    return v;
  }

  /**
   * A closed enum. Used only where the contract fixes the value set — `lens`,
   * `status` and `role` (§A.2/§A.5).
   *
   * Deliberately **not** used for `link`: §A.3 made that a word specifically so
   * a further state such as `"reconnecting"` can appear without a breaking
   * change (§A.12 #2), and validating it against a closed set would make the
   * forward compatibility it was reshaped for impossible to exercise.
   */
  enum<T extends string>(path: string, v: unknown, allowed: readonly T[], fallback: T): T {
    if (typeof v !== "string" || !allowed.includes(v as T)) {
      this.fail(path, `one of ${allowed.map((a) => `"${a}"`).join(" | ")}`, v);
      return fallback;
    }
    return v as T;
  }

  /**
   * An ISO-8601 timestamp, or `null`.
   *
   * The key must be **present** — §A.3.2 makes `as_of` a MUST because it is
   * what stops a stale camera status rendering as a current one, and a missing
   * stamp is the silent failure it exists to remove. `null` is a legitimate
   * value (before the first `tower.hello`), an absent key is not.
   *
   * This checks only that a string parses. It does **not** compare against the
   * clock: computing staleness is the dashboard's job (§A.3.2), and an SDK that
   * applied its own freshness threshold would be making a display decision on
   * the consumer's behalf.
   */
  isoOrNull(path: string, present: boolean, v: unknown): string | null {
    if (!present) {
      this.fail(path, "ISO-8601 timestamp or null (required, §A.3.2)", undefined);
      return null;
    }
    if (v === null) return null;
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
      this.fail(path, "parseable ISO-8601 timestamp or null", v);
      return null;
    }
    return v;
  }

  /** Optional field: absent/`null` is fine, present-and-wrong is not. */
  optStr(path: string, v: unknown): string | undefined {
    if (v === undefined || v === null) return undefined;
    return this.str(path, v);
  }

  optNum(path: string, v: unknown): number | undefined {
    if (v === undefined || v === null) return undefined;
    return this.num(path, v);
  }

  optBool(path: string, v: unknown): boolean | undefined {
    if (v === undefined || v === null) return undefined;
    return this.bool(path, v);
  }

  /** Throw once, with every issue found, or return the value. */
  done<T>(value: T, what: string, ctx: { status?: number; path?: string }): T {
    if (this.issues.length > 0) {
      throw new ValidationError(
        `${what} from the coordination service did not match the session-protocol shape`,
        { issues: this.issues, status: ctx.status, path: ctx.path },
      );
    }
    return value;
  }
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}

/** Context threaded in from the HTTP layer so errors name the request. */
export interface ValidateContext {
  status?: number;
  path?: string;
}

/* ------------------------------------------------------------------ *
 * §A.6 — the MUST-NOT tier
 * ------------------------------------------------------------------ */

/**
 * Fields §A.6 says MUST NOT ever reach a viewer, anywhere in a projected
 * inventory document.
 *
 * `path` and `whep_path` are loopback media-plane addresses internal to the
 * tower. `boot_id` is the link-layer restart discriminator (§3.1, §7.3) and
 * leaks reboot timing for a physical asset; §A.13 records the ruling that moved
 * it here from the SHOULD tier, and the general rule it settled — when MUST NOT
 * and SHOULD collide on one field, MUST NOT wins absent a concrete viewer need.
 */
const FORBIDDEN_KEYS = ["path", "whep_path", "boot_id"] as const;

/**
 * Reject a projected document that carries a §A.6 MUST-NOT field, naming every
 * offending path exactly.
 *
 * **This is the single exception to this module's unknown-field tolerance**,
 * and the asymmetry is deliberate rather than inconsistent. An unknown field is
 * usually a compatible addition (§2.2, §A.9), so rejecting one would turn a
 * safe change into an outage. These three are not additions — they are a
 * projection that failed to strip what it was required to strip, and §A.6 puts
 * the obligation on the consumer in as many words: the dashboard **MUST reject**
 * a projection containing any of them, "loud at the door, never silently
 * ignored".
 *
 * The scan is recursive because §A.6 says *anywhere in the document*: a `path`
 * nested three levels into a camera entry is the same leak as one at the top.
 */
export function assertNoProjectionLeak(raw: unknown, ctx: ValidateContext = {}): void {
  const leaked: string[] = [];

  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = at ? `${at}.${key}` : key;
      if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) leaked.push(here);
      walk(value, here);
    }
  };
  walk(raw, "");

  if (leaked.length > 0) {
    throw new ProjectionLeakError(
      `projection leaked ${leaked.length} field(s) §A.6 says MUST NOT reach a viewer: ` +
        leaked.join(", ") +
        " — this is a coordination bug, not a compatible addition",
      { leaked, status: ctx.status, path: ctx.path },
    );
  }
}

/* ------------------------------------------------------------------ *
 * §4.2 — POST /v1/viewer/sessions response
 * ------------------------------------------------------------------ */

function iceServer(c: Check, path: string, raw: unknown): IceServer {
  const o = c.obj(path, raw);
  if (!o) return { urls: [] };
  // Tolerate the single-string form some servers emit for `urls`; the browser
  // accepts both and normalizing here saves every call site the branch.
  const urls =
    typeof o["urls"] === "string"
      ? [o["urls"]]
      : c.arr(`${path}.urls`, o["urls"]).map((u, i) => c.str(`${path}.urls[${i}]`, u));
  const out: IceServer = { urls };
  const username = c.optStr(`${path}.username`, o["username"]);
  const credential = c.optStr(`${path}.credential`, o["credential"]);
  if (username !== undefined) out.username = username;
  if (credential !== undefined) out.credential = credential;
  return out;
}

/**
 * Validate the `201` body of `POST /v1/viewer/sessions` (§4.2).
 *
 * `offer_url` and `ice_url` are treated as **required**, because a client that
 * silently reconstructs them when the server omitted them is guessing at the
 * API surface. §4.2 documents both as present.
 */
export function parseViewerSession(raw: unknown, ctx: ValidateContext = {}): ViewerSession {
  const c = new Check();
  const o = c.obj("$", raw) ?? {};
  const value: ViewerSession = {
    session_id: c.str("session_id", o["session_id"]),
    device_id: c.str("device_id", o["device_id"]),
    camera: c.num("camera", o["camera"]),
    expires_at: c.str("expires_at", o["expires_at"]),
    ice_servers: c
      .arr("ice_servers", o["ice_servers"])
      .map((s, i) => iceServer(c, `ice_servers[${i}]`, s)),
    offer_url: c.str("offer_url", o["offer_url"]),
    ice_url: c.str("ice_url", o["ice_url"]),
  };
  return c.done(value, "session", ctx);
}

/* ------------------------------------------------------------------ *
 * §4.2 / §4.5 — GET .../ice
 * ------------------------------------------------------------------ */

function iceCandidate(c: Check, path: string, raw: unknown): IceCandidate {
  const o = c.obj(path, raw);
  if (!o) return { candidate: "" };
  const out: IceCandidate = { candidate: c.str(`${path}.candidate`, o["candidate"]) };
  // `sdpMid` / `sdpMLineIndex` are legitimately null in WebRTC, so null is a
  // value here rather than an absence: pass it through as the browser expects.
  if (o["sdpMid"] !== undefined) {
    out.sdpMid = o["sdpMid"] === null ? null : c.str(`${path}.sdpMid`, o["sdpMid"]);
  }
  if (o["sdpMLineIndex"] !== undefined) {
    out.sdpMLineIndex =
      o["sdpMLineIndex"] === null ? null : c.num(`${path}.sdpMLineIndex`, o["sdpMLineIndex"]);
  }
  if (typeof o["usernameFragment"] === "string") out.usernameFragment = o["usernameFragment"];
  return out;
}

/** Validate `GET /v1/viewer/sessions/{id}` (§4.2, §7.4). */
export function parseSessionStatus(raw: unknown, ctx: ValidateContext = {}): ViewerSessionStatus {
  const c = new Check();
  const o = c.obj("$", raw) ?? {};
  const value: ViewerSessionStatus = {
    session_id: c.str("session_id", o["session_id"]),
    camera: c.num("camera", o["camera"]),
    // The field this route exists for. A missing expiry is a hard failure: a
    // client that defaulted it would either tear a live session down early or
    // keep a dead one on screen.
    expires_at: c.str("expires_at", o["expires_at"]),
    status: o["status"] === "ended" ? "ended" : "active",
  };
  // Optional: fresh ICE servers re-issued each poll. Absent on older servers and
  // direct-only deployments, so a missing/empty field is not an error.
  if (Array.isArray(o["ice_servers"])) {
    value.ice_servers = o["ice_servers"].map((s, i) =>
      iceServer(c, `ice_servers[${i}]`, s));
  }
  return c.done(value, "session status", ctx);
}

/** Validate the `200` body of `GET /v1/viewer/sessions/{id}/ice` (§4.2). */
export function parseIceCandidates(
  raw: unknown,
  ctx: ValidateContext = {},
): IceCandidatesResponse {
  const c = new Check();
  const o = c.obj("$", raw) ?? {};
  const value: IceCandidatesResponse = {
    candidates: c
      .arr("candidates", o["candidates"])
      .map((x, i) => iceCandidate(c, `candidates[${i}]`, x)),
  };
  const eoc = c.optBool("end_of_candidates", o["end_of_candidates"]);
  if (eoc !== undefined) value.end_of_candidates = eoc;
  return c.done(value, "ICE candidates", ctx);
}

/* ------------------------------------------------------------------ *
 * §5.2 — ptz.result relayed over HTTPS
 * ------------------------------------------------------------------ */

/**
 * Validate a relayed `ptz.result` payload (§5.2).
 *
 * `result` is intentionally unvalidated beyond "is an object": §5.2 shows it
 * carrying transport diagnostics, and `status` adds calibration-dependent
 * bearing/elevation. Pinning that down would make the SDK the reason a tower
 * cannot add a diagnostic field.
 */
export function parsePtzResult(raw: unknown, ctx: ValidateContext = {}): PtzResult {
  const c = new Check();
  const o = c.obj("$", raw) ?? {};
  const value: PtzResult = {
    session_id: c.str("session_id", o["session_id"]),
    ok: c.bool("ok", o["ok"]),
  };
  if (o["result"] !== undefined && o["result"] !== null) {
    const r = c.obj("result", o["result"]);
    if (r) value.result = r;
  }
  if (o["error"] !== undefined && o["error"] !== null) {
    const e = c.obj("error", o["error"]);
    if (e) {
      value.error = {
        code: c.str("error.code", e["code"]),
        message: c.str("error.message", e["message"]),
      };
    }
  }
  return c.done(value, "PTZ result", ctx);
}

/* ------------------------------------------------------------------ *
 * §3.1 / §3.4 — inventory and health
 * ------------------------------------------------------------------ */

/**
 * Validate one camera of the **projected** inventory (§A.2).
 *
 * Required: `index`, `lens`, `ptz_capable`, `status`. Optional: `resolution`
 * (an object — a `"WIDTHxHEIGHT"` string is rejected, §A.12 #1), `enclosure`,
 * `role`.
 *
 * **`path` is not read and not required.** 0.1.0 required it, because it needed
 * it to join `health.feeds[]` for liveness. §A.2 serves `status` directly and
 * §A.6 puts `path` in the MUST-NOT tier, so the field is gone from both ends of
 * that join: not consumed here, and rejected by {@link assertNoProjectionLeak}
 * if coordination sends it anyway.
 *
 * `resolution` stays per-camera — §3.1 warns cam1 is 1080p and cam2 1440p on
 * the same tower, and "consumers MUST NOT assume uniformity".
 */
export function parseCameraInfo(c: Check, path: string, raw: unknown): CameraInfo {
  const o = c.obj(path, raw);
  if (!o) return { index: 0, lens: "fixed", ptz_capable: false, status: "unknown" };
  const out: CameraInfo = {
    // §A.2 — integer ≥ 1. A 0 or a float is not an address this protocol has.
    index: c.int(`${path}.index`, o["index"], 1),
    lens: c.enum(`${path}.lens`, o["lens"], ["ptz", "fixed"] as const, "fixed"),
    ptz_capable: c.bool(`${path}.ptz_capable`, o["ptz_capable"]),
    // §A.2 — "unknown" is the honest pre-report value and MUST pass. It is
    // never an error here; §A.3.2 forbids only *rendering* it as good.
    status: c.enum(`${path}.status`, o["status"], ["live", "down", "unknown"] as const, "unknown"),
  };
  if (o["resolution"] !== undefined && o["resolution"] !== null) {
    // §A.12 #1 — the object form won. A string reaches c.obj and fails as
    // "expected object, got string", which is exactly the message we want.
    const r = c.obj(`${path}.resolution`, o["resolution"]);
    if (r) {
      out.resolution = {
        width: c.num(`${path}.resolution.width`, r["width"]),
        height: c.num(`${path}.resolution.height`, r["height"]),
      };
    }
  }
  if (o["profiles"] !== undefined && o["profiles"] !== null) {
    // §3.1 — default first, but order is the tower's business and not asserted
    // here. Each entry is whitelisted the way the projection whitelists it:
    // `id` and `default` always, `resolution` only when both dimensions are
    // there. An entry with no usable id is DROPPED rather than defaulted to
    // one, because a profile id is a name a session will be opened by — a
    // wrong one sends a viewer at a stream that never goes ready.
    out.profiles = c
      .arr(`${path}.profiles`, o["profiles"])
      .map((x, i) => {
        const po = c.obj(`${path}.profiles[${i}]`, x);
        if (!po) return undefined;
        const id = c.str(`${path}.profiles[${i}].id`, po["id"]);
        if (!id) return undefined;
        const entry: StreamProfile = {
          id,
          default: c.bool(`${path}.profiles[${i}].default`, po["default"]),
        };
        if (po["resolution"] !== undefined && po["resolution"] !== null) {
          const r = c.obj(`${path}.profiles[${i}].resolution`, po["resolution"]);
          if (r) {
            entry.resolution = {
              width: c.num(`${path}.profiles[${i}].resolution.width`, r["width"]),
              height: c.num(`${path}.profiles[${i}].resolution.height`, r["height"]),
            };
          }
        }
        return entry;
      })
      .filter((p): p is StreamProfile => p !== undefined);
  }
  const enclosure = c.optStr(`${path}.enclosure`, o["enclosure"]);
  if (enclosure !== undefined) out.enclosure = enclosure;
  if (o["role"] !== undefined && o["role"] !== null) {
    out.role = c.enum(`${path}.role`, o["role"], ["primary", "secondary"] as const, "primary");
  }
  // §A.6 SHOULD-omit tier: `codec` and `calibrated` are read by nothing here
  // and are tolerated in silence whether present or absent. Their presence is
  // noise, not a violation — the opposite of the MUST-NOT tier above.
  return out;
}

/**
 * Validate a health block (§3.1 `health`, §3.4 `tower.state.health`).
 *
 * Every member is optional because §3.4 pushes **partial** health — only what
 * changed. Requiring the full set would reject every state push.
 */
export function parseTowerHealth(c: Check, path: string, raw: unknown): TowerHealth {
  const o = c.obj(path, raw);
  if (!o) return {};
  const out: TowerHealth = {};

  const door = o["door"] === undefined || o["door"] === null ? undefined : c.obj(`${path}.door`, o["door"]);
  if (door) out.door = { open: c.bool(`${path}.door.open`, door["open"]) };

  const cover = o["cover"] === undefined || o["cover"] === null ? undefined : c.obj(`${path}.cover`, o["cover"]);
  if (cover) out.cover = { exposed: c.bool(`${path}.cover.exposed`, cover["exposed"]) };

  const impact = o["impact"] === undefined || o["impact"] === null ? undefined : c.obj(`${path}.impact`, o["impact"]);
  if (impact) {
    // §3.1 shows `last_delta_mg: null` on a tower that has recorded nothing —
    // null is a documented value here, not a missing field.
    const d = impact["last_delta_mg"];
    out.impact = { last_delta_mg: d === null || d === undefined ? null : c.num(`${path}.impact.last_delta_mg`, d) };
  }

  const thermal = o["thermal"] === undefined || o["thermal"] === null ? undefined : c.obj(`${path}.thermal`, o["thermal"]);
  if (thermal) {
    const soc = thermal["soc_c"];
    out.thermal = { soc_c: soc === null || soc === undefined ? null : c.num(`${path}.thermal.soc_c`, soc) };
    const state = c.optStr(`${path}.thermal.state`, thermal["state"]);
    if (state !== undefined) out.thermal.state = state;
  }

  const disk = o["disk"] === undefined || o["disk"] === null ? undefined : c.obj(`${path}.disk`, o["disk"]);
  if (disk) {
    /* `free_pct` stays REQUIRED whenever a disk block is present — it is the
       protocol's field, and a disk reported without it is a tower saying
       nothing while appearing to say something. The gigabytes are additive and
       optional, so an older agent that sends only the percentage still parses.
       Each is taken only when it is actually a number: a null or a string here
       would otherwise reach a UI that renders it as a size. */
    const d: { free_pct: number; used_gb?: number; total_gb?: number } = {
      free_pct: c.num(`${path}.disk.free_pct`, disk["free_pct"]),
    };
    if (typeof disk["used_gb"] === "number") d.used_gb = disk["used_gb"];
    if (typeof disk["total_gb"] === "number") d.total_gb = disk["total_gb"];
    out.disk = d;
  }

  const uplink =
    o["uplink"] === undefined || o["uplink"] === null
      ? undefined
      : c.obj(`${path}.uplink`, o["uplink"]);
  if (uplink) {
    /* Every member optional, and each absence is its own claim — see
       `UplinkHealth`. Nothing is defaulted in: a missing `signal_dbm` must stay
       missing so a consumer cannot mistake a wired link for a 0 dBm one. */
    const out2: UplinkHealth = {};
    if (uplink["signal_dbm"] !== undefined && uplink["signal_dbm"] !== null) {
      out2.signal_dbm = c.num(`${path}.uplink.signal_dbm`, uplink["signal_dbm"]);
    }
    const kind = c.optStr(`${path}.uplink.type`, uplink["type"]);
    if (kind !== undefined) out2.type = kind;
    if (uplink["associated"] !== undefined && uplink["associated"] !== null) {
      out2.associated = c.bool(`${path}.uplink.associated`, uplink["associated"]);
    }
    out.uplink = out2;
  }

  const battery =
    o["battery"] === undefined || o["battery"] === null
      ? undefined
      : c.obj(`${path}.battery`, o["battery"]);
  if (battery) {
    /* `reachable` is the ONLY required field, and it is what makes the deploy
       order safe: coordination returns no battery block at all unless it has a
       real boolean here, so this cannot be handed a block that throws.

       Every reading is optional because a tower that cannot reach its pack —
       the phone app holds the single BLE connection — is a normal state that
       must be representable with no numbers. Each is taken only when it really
       is a number, so a null or a string cannot reach a UI that would draw it
       as a charge level. Local shape rather than a new type import, matching
       the disk block above. */
    const b: {
      reachable: boolean;
      as_of?: string;
      soc_pct?: number;
      voltage_v?: number;
      current_a?: number;
      temp_c?: number;
    } = { reachable: c.bool(`${path}.battery.reachable`, battery["reachable"]) };
    const stamp = c.optStr(`${path}.battery.as_of`, battery["as_of"]);
    if (stamp !== undefined) b.as_of = stamp;
    if (typeof battery["soc_pct"] === "number") b.soc_pct = battery["soc_pct"];
    if (typeof battery["voltage_v"] === "number") b.voltage_v = battery["voltage_v"];
    if (typeof battery["current_a"] === "number") b.current_a = battery["current_a"];
    if (typeof battery["temp_c"] === "number") b.temp_c = battery["temp_c"];
    out.battery = b;
  }

  if (o["feeds"] !== undefined && o["feeds"] !== null) {
    out.feeds = c.arr(`${path}.feeds`, o["feeds"]).map((f, i) => {
      const fo = c.obj(`${path}.feeds[${i}]`, f);
      if (!fo) return { path: "", live: false };
      const feed = {
        path: c.str(`${path}.feeds[${i}].path`, fo["path"]),
        live: c.bool(`${path}.feeds[${i}].live`, fo["live"]),
      } as { path: string; live: boolean; since?: string };
      const since = c.optStr(`${path}.feeds[${i}].since`, fo["since"]);
      if (since !== undefined) feed.since = since;
      return feed;
    });
  }
  return out;
}

/**
 * One entry of the projected inventory (§A.3), shared by the list and detail
 * endpoints.
 *
 * Required per §A.3: `device_id`, `label`, `link`, `as_of`, `cameras`,
 * `sensors`. Note what is **not** here any more:
 *
 * - **`online` is gone.** §A.12 #2 replaced it with `link`, a word rather than
 *   a boolean, so a third state (`"reconnecting"`) can arrive without a
 *   breaking change. There is no boolean form to fall back to, and a response
 *   sending `online: true` fails here as a missing `link`.
 * - **`agent_version`, `capabilities`, `last_seen` are optional.** §A.3.3 is
 *   explicit that narrowing them out of the required set is deliberate and not
 *   a prohibition: §4.2.3 still serves them, so they are read when present.
 *
 * `sensors` must be **present even when empty** (§A.3, §A.9). An absent array
 * and an empty one mean different things — reserved-and-none versus a server
 * that has not implemented the field — and only the second is a contract miss.
 */
function towerInfo(c: Check, path: string, raw: unknown): TowerInfo {
  const o = c.obj(path, raw);
  const p = path === "$" ? "" : `${path}.`;
  if (!o) {
    return { device_id: "", label: "", link: "down", as_of: null, cameras: [], sensors: [] };
  }
  const value: TowerInfo = {
    device_id: c.str(`${p}device_id`, o["device_id"]),
    // §A.3.1 — the human name from the account layer. Required: without it a
    // consumer falls back to slug-parsing `device_id`, which is the "Tower 1"
    // trap the field exists to close.
    label: c.str(`${p}label`, o["label"]),
    // §A.3/§A.12 #2 — a word, validated as a string rather than a closed set.
    link: c.str(`${p}link`, o["link"]),
    as_of: c.isoOrNull(`${p}as_of`, "as_of" in o, o["as_of"]),
    cameras: c
      .arr(`${p}cameras`, o["cameras"])
      .map((x, i) => parseCameraInfo(c, `${p}cameras[${i}]`, x)),
    sensors: c.arr(`${p}sensors`, o["sensors"]).map((s, i) => {
      // §A.9 — reserved. Unknown item types MUST be tolerated, so this checks
      // shape and nothing else: no discriminator is required yet, and the UI
      // degrades to a placeholder rather than crashing on one it cannot draw.
      const so = c.obj(`${p}sensors[${i}]`, s);
      return (so ?? {}) as SensorInfo;
    }),
  };
  /* Present only while the link is up, so its ABSENCE is meaningful and is
     preserved as absence rather than coerced to null — "offline" and "connected
     at an unknown time" are different claims. */
  if (o["connected_at"] !== undefined && o["connected_at"] !== null) {
    const at = c.isoOrNull(`${p}connected_at`, true, o["connected_at"]);
    if (at !== null) value.connected_at = at;
  }
  const agent = c.optStr(`${p}agent_version`, o["agent_version"]);
  if (agent !== undefined) value.agent_version = agent;
  if (o["last_seen"] !== undefined) {
    value.last_seen = o["last_seen"] === null ? null : c.str(`${p}last_seen`, o["last_seen"]);
  }
  if (o["capabilities"] !== undefined && o["capabilities"] !== null) {
    value.capabilities = c
      .arr(`${p}capabilities`, o["capabilities"])
      .map((x, i) => c.str(`${p}capabilities[${i}]`, x));
  }
  if (o["health"] !== undefined && o["health"] !== null) {
    value.health = parseTowerHealth(c, `${p}health`, o["health"]);
  }
  return value;
}

/**
 * Validate one projected tower (§A.3).
 *
 * The §A.6 leak scan runs **first**, before any shape check. A leak is a
 * different class of problem from a malformed field — it is a contract
 * violation with a security rationale, and reporting it as one of several
 * shape issues would bury it.
 */
export function parseTowerInfo(raw: unknown, ctx: ValidateContext = {}): TowerInfo {
  assertNoProjectionLeak(raw, ctx);
  const c = new Check();
  return c.done(towerInfo(c, "$", raw), "tower", ctx);
}

/** Validate the `200` body of `GET /v1/viewer/towers` (§4.2.3, §A.3). */
export function parseTowerList(raw: unknown, ctx: ValidateContext = {}): TowerListResponse {
  assertNoProjectionLeak(raw, ctx);
  const c = new Check();
  const o = c.obj("$", raw) ?? {};
  const value: TowerListResponse = {
    towers: c.arr("towers", o["towers"]).map((t, i) => towerInfo(c, `towers[${i}]`, t)),
  };
  return c.done(value, "tower list", ctx);
}

/**
 * Validate the `200` body of `GET /v1/viewer/towers/{device_id}` (§4.2.3,
 * §A.3).
 *
 * `health` and `health_as_of` are **required** here, unlike on a list entry.
 * §4.2.3 makes `health_as_of` mandatory precisely so a stale reading cannot
 * render as a current one, and a validator that let it go missing would hand
 * the dashboard `undefined` for the field whose whole job is to prevent that.
 *
 * This document carries **two** stamps and they are not interchangeable
 * (§A.3.2): `as_of` covers the camera statuses, `health_as_of` covers the
 * sensor block. Usually the same instant, separately served.
 */
export function parseTowerDetail(raw: unknown, ctx: ValidateContext = {}): TowerDetail {
  assertNoProjectionLeak(raw, ctx);
  const c = new Check();
  const base = towerInfo(c, "$", raw);
  const o = c.obj("$", raw) ?? {};
  // An absent `health` reaches parseTowerHealth as undefined and fails there as
  // "expected object" — which is the required-field error we want, once.
  const health = parseTowerHealth(c, "health", o["health"]);
  const healthAsOf = c.isoOrNull("health_as_of", "health_as_of" in o, o["health_as_of"]);
  const value: TowerDetail = { ...base, health, health_as_of: healthAsOf };
  return c.done(value, "tower detail", ctx);
}

/** Exposed so a consumer can validate a shape this SDK does not fetch itself. */
export { Check as ValidationCheck };
