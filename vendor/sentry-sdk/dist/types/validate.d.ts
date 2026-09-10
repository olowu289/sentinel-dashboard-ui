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
import type { CameraInfo, IceCandidatesResponse, PtzResult, TowerDetail, ViewerSessionStatus, TowerHealth, TowerInfo, TowerListResponse, ViewerSession } from "./models.js";
/** Collects field paths that failed, so one error reports every problem. */
declare class Check {
    readonly issues: string[];
    fail(path: string, expected: string, got: unknown): void;
    obj(path: string, v: unknown): Record<string, unknown> | undefined;
    str(path: string, v: unknown): string;
    num(path: string, v: unknown): number;
    bool(path: string, v: unknown): boolean;
    arr(path: string, v: unknown): unknown[];
    /** Integer with an optional inclusive minimum — §A.2's `index` is ≥ 1. */
    int(path: string, v: unknown, min?: number): number;
    /**
     * A closed enum. Used only where the contract fixes the value set — `lens`,
     * `status` and `role` (§A.2/§A.5).
     *
     * Deliberately **not** used for `link`: §A.3 made that a word specifically so
     * a further state such as `"reconnecting"` can appear without a breaking
     * change (§A.12 #2), and validating it against a closed set would make the
     * forward compatibility it was reshaped for impossible to exercise.
     */
    enum<T extends string>(path: string, v: unknown, allowed: readonly T[], fallback: T): T;
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
    isoOrNull(path: string, present: boolean, v: unknown): string | null;
    /** Optional field: absent/`null` is fine, present-and-wrong is not. */
    optStr(path: string, v: unknown): string | undefined;
    optNum(path: string, v: unknown): number | undefined;
    optBool(path: string, v: unknown): boolean | undefined;
    /** Throw once, with every issue found, or return the value. */
    done<T>(value: T, what: string, ctx: {
        status?: number;
        path?: string;
    }): T;
}
/** Context threaded in from the HTTP layer so errors name the request. */
export interface ValidateContext {
    status?: number;
    path?: string;
}
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
export declare function assertNoProjectionLeak(raw: unknown, ctx?: ValidateContext): void;
/**
 * Validate the `201` body of `POST /v1/viewer/sessions` (§4.2).
 *
 * `offer_url` and `ice_url` are treated as **required**, because a client that
 * silently reconstructs them when the server omitted them is guessing at the
 * API surface. §4.2 documents both as present.
 */
export declare function parseViewerSession(raw: unknown, ctx?: ValidateContext): ViewerSession;
/** Validate `GET /v1/viewer/sessions/{id}` (§4.2, §7.4). */
export declare function parseSessionStatus(raw: unknown, ctx?: ValidateContext): ViewerSessionStatus;
/** Validate the `200` body of `GET /v1/viewer/sessions/{id}/ice` (§4.2). */
export declare function parseIceCandidates(raw: unknown, ctx?: ValidateContext): IceCandidatesResponse;
/**
 * Validate a relayed `ptz.result` payload (§5.2).
 *
 * `result` is intentionally unvalidated beyond "is an object": §5.2 shows it
 * carrying transport diagnostics, and `status` adds calibration-dependent
 * bearing/elevation. Pinning that down would make the SDK the reason a tower
 * cannot add a diagnostic field.
 */
export declare function parsePtzResult(raw: unknown, ctx?: ValidateContext): PtzResult;
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
export declare function parseCameraInfo(c: Check, path: string, raw: unknown): CameraInfo;
/**
 * Validate a health block (§3.1 `health`, §3.4 `tower.state.health`).
 *
 * Every member is optional because §3.4 pushes **partial** health — only what
 * changed. Requiring the full set would reject every state push.
 */
export declare function parseTowerHealth(c: Check, path: string, raw: unknown): TowerHealth;
/**
 * Validate one projected tower (§A.3).
 *
 * The §A.6 leak scan runs **first**, before any shape check. A leak is a
 * different class of problem from a malformed field — it is a contract
 * violation with a security rationale, and reporting it as one of several
 * shape issues would bury it.
 */
export declare function parseTowerInfo(raw: unknown, ctx?: ValidateContext): TowerInfo;
/** Validate the `200` body of `GET /v1/viewer/towers` (§4.2.3, §A.3). */
export declare function parseTowerList(raw: unknown, ctx?: ValidateContext): TowerListResponse;
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
export declare function parseTowerDetail(raw: unknown, ctx?: ValidateContext): TowerDetail;
/** Exposed so a consumer can validate a shape this SDK does not fetch itself. */
export { Check as ValidationCheck };
//# sourceMappingURL=validate.d.ts.map