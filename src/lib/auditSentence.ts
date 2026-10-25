/**
 * One audit row, as a sentence with names in it.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THE PAGE USED TO SHOW
 * ══════════════════════════════════════════════════════════════════════
 *
 * Four columns: the action verbatim, the actor's account id, the device id,
 * and a timestamp.
 *
 *     17:25:45   person.create   acct_1kt52KaWSz66g2pFJcoAJQ   —
 *     17:26:02   login.failure   —                             —
 *
 * Every rule this product has about not showing identifiers, broken in one
 * table, on the screen whose entire job is to let a customer READ their own
 * history. And the second row is the one that mattered most: a failed sign-in
 * with no account id, no reason and nothing to go on.
 *
 * ── WHY THE SENTENCE IS BUILT HERE AND THE NAMES COME FROM THERE ──────
 *
 * The DC resolves ids to names (`AuditResponse.names`): it holds the accounts,
 * sites, hubs and towers, and the rows that most need a name are exactly the
 * ones a browser cannot resolve -- a REMOVED person is not in the people list
 * any more, an archived site is not in the sites list, so the oldest entries
 * would be the ones that fell back to an id.
 *
 * The WORDS are here, because they are words: one function, one test, no
 * component writing its own version of "shared with".
 *
 * ⚠ A ROW WITH NO SENTENCE IS NOT SHOWN AT ALL. `sentenceFor` returns null for
 * an action this file has no words for, and the page drops it. The server
 * already filters to the four groups, so this is the second half of the same
 * promise: nothing reaches a customer's screen that was written for us.
 */

import type { AuditEntry } from "@kallon/sentry-sdk";

/** The four groups the page offers, in the order they are shown. */
export const AUDIT_GROUPS: readonly {
  readonly id: "sign_ins" | "people" | "sharing" | "places";
  readonly label: string;
}[] = [
  { id: "sign_ins", label: "Sign-ins" },
  { id: "people", label: "People" },
  { id: "sharing", label: "Sharing" },
  { id: "places", label: "Sites and towers" },
];

/** Why a sign-in was refused, in words. Never the code. */
const WHY_REFUSED: Readonly<Record<string, string>> = {
  unknown_login: "no such login",
  wrong_password: "wrong password",
  account_disabled: "the account is disabled",
  account_removed: "the person has been removed",
  bad_credentials: "wrong login or password",
};

type Names = Readonly<Record<string, string>>;

/**
 * "Camera 1", from whatever the ledger recorded as the camera.
 *
 * The number is what the operator reads on the tile and quotes on the radio.
 * An entry with no camera on it says "a camera" rather than "Camera
 * undefined", which is the one answer that looks like a bug in the log.
 */
function cameraName(camera: unknown): string {
  const n = typeof camera === "number" && Number.isFinite(camera) ? camera : null;
  return n === null ? "a camera" : `Camera ${n}`;
}

/**
 * How often a patrol runs, as the middle of a sentence.
 *
 * ⚠ LOWER CASE AND MID-SENTENCE, which is why it is not `everyWord` from
 * `lib/patrol.ts`. That one is a row VALUE and is capitalised for a column of
 * values; this one is read inside "set Camera 1 to patrol every 4 hours", and
 * "to patrol Every 4 hours" is the kind of seam that makes a log read as
 * generated rather than written.
 */
function everyPhrase(every: unknown): string {
  const code = typeof every === "string" ? every.trim().toLowerCase() : "";
  if (code === "random") return "at random times";
  if (code === "1h") return "every hour";
  const hours = /^(\d+)h$/.exec(code);
  return hours ? `every ${hours[1]} hours` : "on a schedule";
}

interface Detail {
  readonly [key: string]: unknown;
}

function detailOf(entry: AuditEntry): Detail {
  const d = entry.detail;
  if (!d || typeof d !== "object" || Array.isArray(d)) return {};
  const detail = d as Detail;
  /* ⚠ AND A ROW WRITTEN ONE LEVEL DEEPER IS UNWRAPPED HERE TOO.
     A DC that has not been updated yet stores these rows as
     `{"detail": {...}}` -- the route passed its fields as one `detail=`
     argument and they were nested rather than merged. The newer DC flattens at
     the write and unwraps the old rows on the way out, but this website is
     deployed separately and talks to whichever DC a customer has, so the
     sentences have to read either shape. No writer passes a field called
     `detail`, so a lone one is always the old shape. */
  const only = Object.keys(detail);
  const inner = detail.detail;
  if (only.length === 1 && only[0] === "detail" && inner && typeof inner === "object"
      && !Array.isArray(inner)) {
    return inner as Detail;
  }
  return detail;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The name for an id, or a word. NEVER the id.
 *
 * `fallback` is deliberately a noun phrase ("somebody", "a site"): a sentence
 * reading "somebody signed in" is useful and honest, and one reading
 * "acct_1kt52 signed in" is neither.
 */
function nameOf(id: unknown, names: Names, fallback: string): string {
  const key = str(id);
  if (!key) return fallback;
  const found = names[key];
  return found && found.trim() ? found : fallback;
}

/** A list of tower names: "Lab Hub Mast and Tower 1". */
function towerList(detail: Detail, names: Names): string {
  const raw = Array.isArray(detail.towers) ? detail.towers : [];
  const got = raw
    .map((t) => nameOf(t, names, ""))
    .filter((t) => t.length > 0);
  if (got.length === 0) return "some cameras";
  if (got.length === 1) return got[0];
  if (got.length === 2) return `${got[0]} and ${got[1]}`;
  return `${got.slice(0, -1).join(", ")} and ${got[got.length - 1]}`;
}

/** "2 hours", "45 minutes", or "" when there is nothing to say. */
export function spellSeconds(sec: unknown): string {
  const n = typeof sec === "number" ? sec : Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 3600) {
    const m = Math.round(n / 60);
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  const h = Math.round((n / 3600) * 10) / 10;
  return h === 1 ? "1 hour" : `${h} hours`;
}

/**
 * The sentence for one row, or null when this page has no words for it.
 *
 * `who` is the actor's name, resolved by the server; it falls back to
 * "somebody" rather than to an id, and to "the system" for a row with no
 * actor at all (an expiry, a lapse: nobody did those).
 */
export function sentenceFor(entry: AuditEntry, names: Names = {}): string | null {
  const d = detailOf(entry);
  const who = (entry.who ?? "").trim() || nameOf(entry.account_id, names, "");
  const actor = who || "Somebody";
  const target = () =>
    nameOf(d.target ?? d.created ?? d.account_id, names, "somebody");

  switch (entry.action) {
    /* ── SIGN-INS ─────────────────────────────────────────────────── */
    case "login.success":
      return `${actor} signed in`;
    case "login.failure": {
      const why = WHY_REFUSED[str(d.reason)] ?? "";
      /* A FAILED SIGN-IN OFTEN HAS NO ACCOUNT, because the login matched
         nothing -- that is what makes it interesting. The organization it was
         aimed at is what the server attributes it to, so the sentence says
         "for somebody in this organization" rather than naming a person who
         does not exist. */
      const subject = who ? ` for ${who}` : "";
      return why
        ? `Sign-in failed${subject} (${why})`
        : `Sign-in failed${subject}`;
    }
    case "login.locked":
      return `Sign-in locked after too many attempts${
        spellSeconds(d.retry_after_sec) ? ` for ${spellSeconds(d.retry_after_sec)}` : ""
      }`;
    case "login.throttled":
      return "A sign-in was refused while the lock was running";

    /* ── PEOPLE ──────────────────────────────────────────────────── */
    case "person.create":
      return `${actor} added ${nameOf(d.created, names, str(d.person_name) || "somebody")}`;
    case "person.remove":
      return `${actor} removed ${nameOf(d.target, names, str(d.person_name) || "somebody")}`;
    case "person.disable":
      return `${actor} disabled ${target()}`;
    case "person.enable":
      return `${actor} enabled ${target()}`;
    case "person.password_reset":
      return `${actor} set a new password for ${target()}`;
    case "person.rename": {
      const was = str(d.previous_name);
      const now = str(d.person_name) || target();
      return was
        ? `${actor} renamed ${was} to ${now}`
        : `${actor} corrected ${now}'s name`;
    }
    case "site.member_add":
      return `${actor} gave ${target()} access to ${nameOf(d.site_id, names, "a site")}`;
    case "site.member_remove":
      return `${actor} took ${target()}'s access to ${nameOf(d.site_id, names, "a site")} away`;

    /* ── SHARING ─────────────────────────────────────────────────── */
    case "share.request": {
      const asked = nameOf(d.owner_site_id, names, "another site");
      const asking = nameOf(d.viewer_site_id, names, "a site");
      const how = spellSeconds(d.asked_duration_sec);
      return `${actor} asked ${asked} to share cameras with ${asking}${
        how ? ` for ${how}` : ""
      }`;
    }
    case "share.offer": {
      const owner = nameOf(d.owner_site_id, names, "a site");
      const viewer = nameOf(d.viewer_site_id, names, "another site");
      const what = towerList(d, names);
      return `${actor} offered ${viewer} ${what} from ${owner}`;
    }
    case "share.accept": {
      const what = towerList(d, names);
      return `${actor} shared ${what}`;
    }
    case "share.decline":
      return `${actor} declined a share`;
    case "share.revoke":
      return `${actor} ended a share`;
    case "share.expire":
      return "A share ran out";
    case "share.extend": {
      const how = spellSeconds(d.duration_sec ?? d.asked_duration_sec);
      return `${actor} extended a share${how ? ` by ${how}` : ""}`;
    }

    /* ── SITES AND TOWERS ────────────────────────────────────────── */
    case "site.create":
      return `${actor} added the site ${nameOf(d.site_id, names, str(d.name) || "a site")}`;
    case "site.rename": {
      const was = str(d.previous_name);
      const now = str(d.name) || nameOf(d.site_id, names, "a site");
      return was ? `${actor} renamed ${was} to ${now}` : `${actor} renamed a site to ${now}`;
    }
    case "site.archive":
    case "site.delete":
      return `${actor} deleted the site ${str(d.name) || nameOf(d.site_id, names, "")}`.trim();
    case "site.hub_assign":
      return `${actor} put ${nameOf(d.hub_id, names, "a cell")} in ${nameOf(d.site_id, names, "a site")}`;
    case "site.hub_unassign":
      return `${actor} took ${nameOf(d.hub_id, names, "a cell")} out of ${nameOf(d.site_id, names, "a site")}`;
    case "device.added": {
      const what = str(d.what) === "tower" ? "tower" : "cell";
      const name = str(d.name);
      const where =
        what === "tower"
          ? nameOf(d.hub_id, names, "a cell")
          : nameOf(d.site_id, names, "a site");
      return `${actor} added ${name ? `the ${what} ${name}` : `a ${what}`} to ${where}`;
    }
    case "device.renamed": {
      const was = str(d.previous_name);
      const now = str(d.name) || nameOf(entry.device_id ?? d.hub_id, names, "it");
      return was ? `${actor} renamed ${was} to ${now}` : `${actor} renamed ${now}`;
    }
    case "device.moved":
      return `${actor} moved ${nameOf(d.hub_id ?? entry.device_id, names, "a cell")} to ${nameOf(
        d.to_site_id ?? d.site_id,
        names,
        "another site",
      )}`;
    case "device.removed":
      return `${actor} removed ${
        str(d.name) || nameOf(entry.device_id ?? d.hub_id, names, "a tower")
      }`;
    case "device.replaced":
      return `${actor} replaced ${nameOf(entry.device_id, names, "a tower")}`;

    /* ── PATROL ───────────────────────────────────────────────────
       ⚠ TWO SENTENCES, BECAUSE TURNING IT OFF HAS NO SCHEDULE TO READ
       OUT. "Dave set Camera 1 on Tower 1 to patrol every never, nowhere" is
       what one sentence with holes in it produces; the reader of an audit log
       wants to know what somebody did, and turning patrol off is a different
       act from scheduling it. */
    case "patrol.set": {
      const where = `${cameraName(d.camera)} on ${nameOf(
        entry.device_id ?? d.device_id,
        names,
        str(d.name) || "a tower",
      )}`;
      if (d.enabled !== true) return `${actor} turned off patrol on ${where}`;
      const every = everyPhrase(d.every);
      const direction = str(d.direction);
      const way = direction === "random" ? "in a random direction"
        : direction === "anticlockwise" ? "anticlockwise"
        : direction === "clockwise" ? "clockwise"
        : null;
      return `${actor} set ${where} to patrol ${every}${way ? `, ${way}` : ""}`;
    }

    /* ── EVERYTHING ELSE ─────────────────────────────────────────── */
    default:
      /* ptz.command, grant.issue, session.open, renewal.*, enrolment
         internals: still recorded on the DC, exactly as before, and not shown
         here. A row this file has no words for is a row written for us. */
      return null;
  }
}

/** Which group a row belongs to, for the page's own grouping. */
export function groupOf(entry: AuditEntry): string | null {
  const a = entry.action;
  if (a.startsWith("login.")) return "sign_ins";
  if (a.startsWith("person.") || a.startsWith("site.member_")) return "people";
  if (a.startsWith("share.")) return "sharing";
  if (a.startsWith("site.") || a.startsWith("device.")) return "places";
  /* A tower setting, changed by a person, belongs with the towers. */
  if (a.startsWith("patrol.")) return "places";
  return null;
}
