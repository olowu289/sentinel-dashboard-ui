/**
 * Site alerts — the four a customer reads, and the live channel they arrive on.
 *
 * Source of truth: `sentry-core/docs/alerts.md` §4. Scope: the viewer-facing
 * routes `GET /v1/viewer/site-alerts`, `GET /v1/viewer/site-alerts/{id}`,
 * `POST /v1/viewer/site-alerts/{id}/ack`, and `GET /v1/viewer/events`.
 *
 * ## Why a module of its own
 *
 * Same reasoning `sites.ts` gives: these are a different surface with a
 * different lifetime from §4.2's towers and sessions, and a consumer rendering
 * a camera wall should not have to import them.
 *
 * ## THE FIELD RULES, which a renderer depends on
 *
 * These are not style notes. Each one exists because its opposite put something
 * wrong on a screen.
 *
 * - **Absent, never null.** Everything that does not apply is simply missing.
 *   A `recovered_at: null` on a live alert is a field every renderer has to
 *   know to special-case, and "the camera is still down" is said better by
 *   there being nothing to say. So these parsers **omit** rather than emit
 *   `null`, and `"x" in alert` is the check.
 * - **`acknowledged` is always a boolean.** Never absent, never null. `false`
 *   and "an older hub that did not say" must not be the same thing on a screen,
 *   so the parser requires it and fails loudly if it is missing.
 * - **`type` and `colour` are CODES, not text.** There is deliberately no
 *   `message` field anywhere (§9). The website owns every sentence a customer
 *   reads; the server owns the facts. A colour arrives for a `type` this build
 *   has never heard of, which is what the list's `colours` map is for.
 * - **`rev` is machine ordering.** It increases on every change to the row and
 *   is how a consumer drops an out-of-order update — see
 *   {@link AlertRevisionGate}.
 * - **`url` and `download_url` MUST NOT be cached.** They are minted per
 *   request and a presigned bucket URL lives fifteen minutes. `key` is the
 *   stable identity. Re-read the alert to get fresh URLs; never stash one in
 *   component state and render it an hour later.
 */

import { ValidationError } from "./errors.js";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/**
 * The alert types this build of the server raises (§4, `sitealerts.COLOURS`).
 *
 * Open on purpose: a newer hub forwards a type this build has not heard of, and
 * `colour_for` answers `grey` for it rather than refusing it. An alert whose
 * word we cannot name is still an alert that must appear.
 */
export type AlertType =
  | "TOWER_OFFLINE"
  | "CAMERA_STOPPED"
  | "TOWER_ONLINE"
  | "FOOTAGE_RECOVERING"
  | "FOOTAGE_RECOVERED"
  | (string & {});

/**
 * A colour **key**, not a CSS colour: `red`, `orange`, `green`, `purple`,
 * `teal`, or `grey` for a type the server itself could not name. The website
 * maps it to its own palette.
 */
export type AlertColour = string;

/** Clip quality as a machine value. `2k` beats `standard` (§2). */
export type ClipQuality = "standard" | "2k" | (string & {});

/**
 * One clip cut around an alert (§2).
 *
 * `url` and `download_url` are **minted for the request that returned this
 * object** and are not cached anywhere on the server either — a row holding one
 * would serve a dead link to every reader after fifteen minutes.
 */
export interface AlertClip {
  /** The camera this clip is of. */
  readonly camera: number;
  readonly quality: ClipQuality;
  /** The stable identity. Cache against this, never against the URLs. */
  readonly key: string;
  /** RFC 3339. When the clip's footage begins — a minute before the event. */
  readonly start?: string;
  readonly start_epoch?: number;
  /** Seconds. */
  readonly duration?: number;
  /** Bytes. */
  readonly size?: number;
  /** The name a person reads. Built by the hub; use it as the `download` attr. */
  readonly filename?: string;
  /**
   * Plays inline. Relative → resolve against the API origin; absolute → a
   * presigned bucket URL, used untouched. **Do not cache.**
   */
  readonly url?: string;
  /** Same object as an attachment. **Do not cache.** */
  readonly download_url?: string;
}

/** How far the clip pipeline has to go (§3). Absent when there is nothing left. */
export interface AlertProgress {
  readonly files_left?: number;
  readonly bytes_left?: number;
  /** 0…1. */
  readonly progress?: number;
  readonly eta_sec?: number;
  /**
   * A verdict rather than a measurement, and the reason this block can appear
   * with no numbers in it at all: `"none"` means the hub **answered** and has
   * no recording covering that moment — the disk was full, the camera was not
   * recording, the box was rebuilt (§2 "No footage of that moment"). A screen
   * reading it says "No footage of that moment" and stops waiting.
   *
   * ⚠ ITS ABSENCE IS NOT "THERE IS FOOTAGE". Nothing has been answered yet is
   * also absent, which is the state every `HUB_OFFLINE` alert starts in and
   * may sit in for weeks while its hub is away. Only `"none"` is a statement.
   *
   * A code, like {@link SiteAlert.type} and {@link SiteAlert.colour}, left as
   * a plain string so a later verdict needs no SDK release to pass through.
   */
  readonly footage?: string;
}

/**
 * One alert, exactly as §4 "One alert" documents it — and the same shape the
 * live channel's `data` carries.
 *
 * Every optional field here is optional because the server **omits** it, not
 * because it might be null. See the module header.
 */
export interface SiteAlert {
  readonly id: string;
  /** A code. Never shown to a customer as itself. */
  readonly type: AlertType;
  /** A colour key for {@link type}, so an unknown type still renders. */
  readonly colour: AlertColour;
  readonly device_id: string;
  /**
   * Plural because `TOWER_OFFLINE` is about every camera on the mast. **Absent
   * when there are none** — not an empty array.
   */
  readonly cameras?: number[];
  /** RFC 3339, stamped at the event rather than at the raise (§1). */
  readonly started_at: string;
  readonly started_epoch: number;
  /** Absent while the condition still holds. Presence *is* "recovered". */
  readonly recovered_at?: string;
  /**
   * **Always present.** `false` is a fact; a missing field would be
   * indistinguishable from an older hub that did not say.
   */
  readonly acknowledged: boolean;
  /** The authenticated caller who acknowledged. Absent when nobody has. */
  readonly acknowledged_by?: string;
  readonly acknowledged_at?: string;
  /**
   * The best quality among {@link clips}, decided server-side so a pop-up and
   * a detail view cannot rank the list differently. Appears only with clips.
   */
  readonly best_quality?: ClipQuality;
  /** Absent when empty. */
  readonly clips?: AlertClip[];
  /** Absent when there is nothing in flight. */
  readonly progress?: AlertProgress;
  /** Machine ordering. Increases on every change to the row. */
  readonly rev: number;
  /** Present on the data centre only — which hub forwarded this. */
  readonly via_hub_id?: string;
}

/** `200` body of `GET /v1/viewer/site-alerts`. */
export interface SiteAlertList {
  /** Newest first. */
  readonly alerts: SiteAlert[];
  /**
   * The colour key per type, **including types this build of the website has
   * never heard of**. That is the whole reason it is sent: render by looking a
   * type up here, not by a switch in the bundle.
   */
  readonly colours: Readonly<Record<string, AlertColour>>;
}

/** Query for {@link SentryClient.listSiteAlerts}. */
export interface SiteAlertQuery {
  /**
   * Epoch seconds. A **recovery tool**: a client whose live stream dropped
   * re-reads from the last alert it saw. The stream replays nothing,
   * deliberately — a replay buffer would be a second and lossier answer to the
   * same question (§4, §9).
   */
  since?: number;
  limit?: number;
}

/** The two event kinds on `GET /v1/viewer/events`. */
export type AlertEventKind = "alert.new" | "alert.updated";

/** One parsed frame off the live channel. */
export interface AlertEvent {
  readonly kind: AlertEventKind;
  readonly alert: SiteAlert;
  /** The SSE `id:`, when the frame carried one. */
  readonly id?: string;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

interface Ctx {
  readonly status?: number;
  readonly path?: string;
}

/** Same kernel as `sites.ts`, for the same reason: structural, not exhaustive. */
class Check {
  readonly issues: string[] = [];

  fail(path: string, expected: string, got: unknown): void {
    const shown = got === null ? "null" : Array.isArray(got) ? "array" : typeof got;
    this.issues.push(`${path}: expected ${expected}, got ${shown}`);
  }

  obj(path: string, v: unknown): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, "object", v);
      return {};
    }
    return v as Record<string, unknown>;
  }

  arr(path: string, v: unknown): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "array", v);
      return [];
    }
    return v;
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

  done(what: string, ctx: Ctx): void {
    if (this.issues.length === 0) return;
    throw new ValidationError(
      `${what} from ${ctx.path ?? "(unknown path)"} is not the documented shape`,
      { issues: this.issues, status: ctx.status, path: ctx.path },
    );
  }
}

/**
 * Copy an optional field only when the server actually sent a value.
 *
 * ⚠ THIS IS THE "ABSENT, NEVER NULL" RULE IN CODE. A `null` arriving from
 * anywhere — an older tier, a forward, a hand-written fixture — is dropped
 * rather than carried through, because the contract a consumer was promised is
 * that presence means a value. One `null` leaking into the object re-creates
 * exactly the special-case the rule exists to delete.
 */
function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) out[key] = value;
}

function clip(c: Check, path: string, raw: unknown): AlertClip {
  const o = c.obj(path, raw);
  const out: Record<string, unknown> = {
    camera: c.num(`${path}.camera`, o.camera),
    quality: c.str(`${path}.quality`, o.quality),
    key: c.str(`${path}.key`, o.key),
  };
  if (o.start !== undefined && o.start !== null) put(out, "start", c.str(`${path}.start`, o.start));
  if (o.start_epoch !== undefined && o.start_epoch !== null) {
    put(out, "start_epoch", c.num(`${path}.start_epoch`, o.start_epoch));
  }
  if (o.duration !== undefined && o.duration !== null) {
    put(out, "duration", c.num(`${path}.duration`, o.duration));
  }
  if (o.size !== undefined && o.size !== null) put(out, "size", c.num(`${path}.size`, o.size));
  if (o.filename !== undefined && o.filename !== null) {
    put(out, "filename", c.str(`${path}.filename`, o.filename));
  }
  // MINTED PER REQUEST. Carried through as given — a relative path is resolved
  // by the client against the API origin, an absolute presigned URL passes
  // untouched. Neither is cached here, and neither should be cached by a caller.
  if (o.url !== undefined && o.url !== null) put(out, "url", c.str(`${path}.url`, o.url));
  if (o.download_url !== undefined && o.download_url !== null) {
    put(out, "download_url", c.str(`${path}.download_url`, o.download_url));
  }
  return out as unknown as AlertClip;
}

function progress(c: Check, path: string, raw: unknown): AlertProgress {
  const o = c.obj(path, raw);
  const out: Record<string, unknown> = {};
  for (const key of ["files_left", "bytes_left", "progress", "eta_sec"] as const) {
    if (o[key] !== undefined && o[key] !== null) {
      put(out, key, c.num(`${path}.${key}`, o[key]));
    }
  }
  // The one non-numeric key, carried beside them. A block holding ONLY this is
  // the whole shape of a `HUB_OFFLINE` answer, so nothing here may assume a
  // number was seen first.
  if (o.footage !== undefined && o.footage !== null) {
    put(out, "footage", c.str(`${path}.footage`, o.footage));
  }
  return out as AlertProgress;
}

function alert(c: Check, path: string, raw: unknown): SiteAlert {
  const o = c.obj(path, raw);
  const out: Record<string, unknown> = {
    id: c.str(`${path}.id`, o.id),
    type: c.str(`${path}.type`, o.type),
    colour: c.str(`${path}.colour`, o.colour),
    device_id: c.str(`${path}.device_id`, o.device_id),
    started_at: c.str(`${path}.started_at`, o.started_at),
    started_epoch: c.num(`${path}.started_epoch`, o.started_epoch),
    // ALWAYS A BOOLEAN, and required for it. An absent `acknowledged` would be
    // rendered as "not acknowledged" by every sensible falsy check, which is
    // the one reading the server promises never to make a consumer guess at.
    acknowledged: c.bool(`${path}.acknowledged`, o.acknowledged),
    rev: c.num(`${path}.rev`, o.rev),
  };
  if (o.cameras !== undefined && o.cameras !== null) {
    out.cameras = c
      .arr(`${path}.cameras`, o.cameras)
      .map((v, i) => c.num(`${path}.cameras[${i}]`, v));
  }
  if (o.recovered_at !== undefined && o.recovered_at !== null) {
    put(out, "recovered_at", c.str(`${path}.recovered_at`, o.recovered_at));
  }
  if (o.acknowledged_by !== undefined && o.acknowledged_by !== null) {
    put(out, "acknowledged_by", c.str(`${path}.acknowledged_by`, o.acknowledged_by));
  }
  if (o.acknowledged_at !== undefined && o.acknowledged_at !== null) {
    put(out, "acknowledged_at", c.str(`${path}.acknowledged_at`, o.acknowledged_at));
  }
  if (o.best_quality !== undefined && o.best_quality !== null) {
    put(out, "best_quality", c.str(`${path}.best_quality`, o.best_quality));
  }
  if (o.clips !== undefined && o.clips !== null) {
    out.clips = c.arr(`${path}.clips`, o.clips).map((v, i) => clip(c, `${path}.clips[${i}]`, v));
  }
  if (o.progress !== undefined && o.progress !== null) {
    out.progress = progress(c, `${path}.progress`, o.progress);
  }
  if (o.via_hub_id !== undefined && o.via_hub_id !== null) {
    put(out, "via_hub_id", c.str(`${path}.via_hub_id`, o.via_hub_id));
  }
  return out as unknown as SiteAlert;
}

/** Validate one alert — the `GET .../{id}`, the ack answer, and an event's `data`. */
export function parseSiteAlert(raw: unknown, ctx: Ctx = {}): SiteAlert {
  const c = new Check();
  const value = alert(c, "$", raw);
  c.done("site alert", ctx);
  return value;
}

/**
 * Validate `GET /v1/viewer/site-alerts`.
 *
 * `colours` is required. A list without it would leave a dashboard unable to
 * render a type it does not know, which is the one thing the map is for — and
 * an empty map from a server that forgot it is better surfaced here than as
 * uncoloured rows on a screen.
 */
export function parseSiteAlertList(raw: unknown, ctx: Ctx = {}): SiteAlertList {
  const c = new Check();
  const o = c.obj("$", raw);
  const alerts = c.arr("$.alerts", o.alerts).map((a, i) => alert(c, `$.alerts[${i}]`, a));
  const coloursRaw = c.obj("$.colours", o.colours);
  const colours: Record<string, string> = {};
  for (const [type, colour] of Object.entries(coloursRaw)) {
    colours[type] = c.str(`$.colours.${type}`, colour);
  }
  c.done("site alert list", ctx);
  return { alerts, colours };
}

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

/**
 * Drops out-of-order alert updates by `rev`.
 *
 * ⚠ THE LIVE CHANNEL AND THE LIST ENDPOINT ARE TWO SOURCES FOR ONE ROW, and a
 * client reads both: it re-reads the list after any drop (§4), so a recovery
 * read and a live frame routinely describe the same alert. Nothing orders them
 * against each other — the HTTP response and the stream frame race — so without
 * this a stale forward overwrites a fresh one and a recovered alert flips back
 * to live on screen.
 *
 * `rev` increases on every change to the row and is exactly what the data centre
 * uses to tell a stale forward from a fresh one. Same field, same job.
 *
 * ```ts
 * const gate = new AlertRevisionGate();
 * if (gate.accept(a)) store.upsert(a);   // else: already have this or newer
 * ```
 */
export class AlertRevisionGate {
  private readonly seen = new Map<string, number>();

  /**
   * `true` when this alert is new or newer than what has been seen, and records
   * it. `false` when it is a duplicate or older, and changes nothing.
   *
   * Equal revs are rejected: a row that has not changed has nothing to apply,
   * and re-rendering it is work for no new fact.
   */
  accept(a: SiteAlert): boolean {
    const prev = this.seen.get(a.id);
    if (prev !== undefined && a.rev <= prev) return false;
    this.seen.set(a.id, a.rev);
    return true;
  }

  /** The highest `rev` seen for an alert, or `undefined`. */
  revOf(id: string): number | undefined {
    return this.seen.get(id);
  }

  /** Forget everything. For a sign-out or a site switch. */
  clear(): void {
    this.seen.clear();
  }
}

/* ------------------------------------------------------------------ *
 * SSE framing
 * ------------------------------------------------------------------ */

/** One raw SSE frame, before the `data` is understood as anything. */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Split a complete SSE frame into its fields, or `null` if it carries nothing.
 *
 * Comment lines are dropped, which is how `: keepalive` (every 15 s) and the
 * `: open` the stream starts with are **ignored rather than parsed**. A keepalive
 * is not an event and must never reach a consumer as one; it exists so a proxy
 * does not time the connection out.
 *
 * Exported because the framing is worth testing on its own, separately from the
 * transport that feeds it.
 */
export function parseSseFrame(block: string): SseFrame | null {
  let id: string | undefined;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // comment / keepalive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // One optional space after the colon is part of the framing, not the value.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
    // `retry:` is the browser's own reconnect hint and means nothing to a
    // reader that does its own backoff. Ignored, not an error.
  }
  if (data.length === 0 && event === undefined && id === undefined) return null;
  const out: SseFrame = { data: data.join("\n") };
  if (id !== undefined) out.id = id;
  if (event !== undefined) out.event = event;
  return out;
}

/**
 * Turn a decoded chunk stream into complete frames.
 *
 * Holds a buffer because **a frame can arrive split across two reads**: the
 * network does not respect `\n\n`, and a parser that treated every chunk as a
 * whole frame would drop the tail of one alert and the head of the next. This is
 * the bug that makes an event channel look "mostly reliable".
 */
export class SseBuffer {
  private buf = "";

  /** Feed a decoded chunk; get back the frames that are now complete. */
  push(chunk: string): SseFrame[] {
    // Normalize CRLF so a proxy that rewrites line endings cannot break framing.
    this.buf += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out: SseFrame[] = [];
    let cut: number;
    while ((cut = this.buf.indexOf("\n\n")) !== -1) {
      const block = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut + 2);
      const frame = parseSseFrame(block);
      if (frame) out.push(frame);
    }
    return out;
  }
}

/**
 * Read one frame as an alert event, or `null` when it is not one.
 *
 * `null` for anything that is not `alert.new` / `alert.updated` — a future event
 * kind on this channel is additive and a reader that threw on one would turn a
 * compatible server change into a broken dashboard (§A.9's rule, same shape).
 *
 * Throws {@link ValidationError} only when a frame *claims* to be an alert and
 * its `data` is not one: that is a real contract break, not an unknown.
 */
export function alertEventOf(frame: SseFrame): AlertEvent | null {
  if (frame.event !== "alert.new" && frame.event !== "alert.updated") return null;
  if (!frame.data) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data) as unknown;
  } catch {
    throw new ValidationError(`${frame.event} carried data that is not JSON`, {
      issues: [`$.data: expected JSON, got ${frame.data.slice(0, 60)}`],
      path: "/v1/viewer/events",
    });
  }
  const out: AlertEvent = {
    kind: frame.event,
    alert: parseSiteAlert(parsed, { path: "/v1/viewer/events" }),
  };
  if (frame.id !== undefined) return { ...out, id: frame.id };
  return out;
}
