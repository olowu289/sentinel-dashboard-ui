/**
 * The fleet changed: a card for the administrator, from the ledger.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THE AUDIT LOG IS THE FEED
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every device and person event is already written there, in one transaction
 * with the thing it records, scoped to the organization by the server row by
 * row. A second channel would be a second thing to keep in step with the
 * first, and the first is the one that has to be right.
 *
 * So this polls the ledger, diffs by `seq`, and turns what is new into cards.
 * No new route, no new table, and an event that reached the log reaches the
 * card by construction.
 *
 * ── WHO GETS THESE ────────────────────────────────────────────────────
 *
 * ONLY THE ADMINISTRATOR. `/v1/admin/audit` answers 403 for anybody else, so
 * this is not a decision this file makes — it is a decision it cannot avoid.
 * That is the right shape: the admin is the person who has to know the shape
 * of the fleet is not what it was an hour ago, and a site user does not need a
 * card about a mast in a site they cannot see.
 *
 * ⚠ AND NOT FOR THINGS THE ADMIN DID. The ledger records the actor, and an
 * admin who has just renamed a cell does not need to be told that a cell was
 * renamed. This is the same rule the sharing work arrived at the hard way —
 * nobody answers their own — and the case it exists for is the one that
 * matters: a SITE USER adding a device. They may do that without asking
 * anybody, and this is how the office finds out the same minute.
 *
 * ⚠ THE FIRST POLL RAISES NOTHING. Signing in after a week of changes must not
 * throw nine cards over the video. They are in the audit log, where somebody
 * went looking for them. The stack is for what happens WHILE you are watching.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuditEntry } from "@kallon/sentry-sdk";

import { adminAudit } from "@/lib/api/sites";
import { useNotifications } from "@/lib/notifications";

/** Twenty seconds, matching the share feed. One request for the whole account. */
export const FLEET_POLL_MS = 20_000;

/** How many entries to read per poll. */
const WINDOW = 50;

/**
 * The actions worth a card, and which colour each takes.
 *
 * `fleet` is "there is more than there was", which can wait. `revoked` is
 * "something was taken away", which is the sentence an admin re-reads to check
 * they meant it. Everything else in the ledger — a login, a share, a password
 * reset — belongs in the log and not over the video.
 */
const WATCHED: Readonly<Record<string, "fleet" | "revoked">> = {
  "device.added": "fleet",
  "device.moved": "fleet",
  "device.renamed": "fleet",
  "device.replaced": "fleet",
  "device.removed": "revoked",
  "person.disable": "revoked",
};

interface Detail {
  what?: string;
  name?: string;
  person_name?: string;
  hub_id?: string;
  site_id?: string;
  pending?: boolean;
  queued?: boolean;
  shares_ended?: readonly string[];
}

/** The ledger nests its own fields under `detail`, sometimes twice. */
function detailOf(entry: AuditEntry): Detail {
  const outer = (entry.detail ?? {}) as Record<string, unknown>;
  const inner = (outer.detail ?? outer) as Record<string, unknown>;
  return inner as Detail;
}

/** One line, for the card and for assistive technology. */
export function fleetTitle(entry: AuditEntry): string {
  const d = detailOf(entry);
  const thing = d.what === "cell" ? "cell" : d.what === "tower" ? "tower" : "device";
  const name = d.name || d.person_name || "";
  switch (entry.action) {
    case "device.added":
      return d.queued
        ? `A ${thing} is queued for an offline cell${name ? `: ${name}` : ""}`
        : `A ${thing} was added${name ? `: ${name}` : ""}`;
    case "device.renamed":
      return `A ${thing} was renamed${name ? ` to ${name}` : ""}`;
    case "device.moved":
      return `A ${thing} was moved${name ? `: ${name}` : ""}`;
    case "device.replaced":
      return `Hardware was replaced${name ? `: ${name}` : ""}`;
    case "device.removed":
      return `A ${thing} was removed${name ? `: ${name}` : ""}`;
    case "person.disable":
      return "Somebody was signed out and disabled";
    default:
      return entry.action;
  }
}

/** The body: what else a reader needs, and nothing they do not. */
export function fleetBody(entry: AuditEntry): string | null {
  const d = detailOf(entry);
  if (entry.action === "device.added" && d.pending && !d.queued) {
    return "It will appear when the equipment comes online.";
  }
  if (entry.action === "device.added" && d.queued) {
    return "Nothing was sent yet. It goes out when the cell reconnects, and "
      + "its fifteen minutes start then.";
  }
  if (entry.action === "device.moved" && d.shares_ended?.length) {
    return d.shares_ended.length === 1
      ? "1 share ended because the cameras left the site."
      : `${d.shares_ended.length} shares ended because the cameras left the site.`;
  }
  if (entry.action === "device.removed") {
    return "Its keys are revoked. Recordings stay until normal retention.";
  }
  if (entry.action === "person.disable") {
    return "Their sessions and any live video ended at once. The account is "
      + "kept, so the log still makes sense.";
  }
  return null;
}

interface Ctx {
  /** The newest watched entries, newest first. For the Administration area. */
  readonly recent: readonly AuditEntry[];
  readonly reload: () => void;
}

const FleetFeedContext = createContext<Ctx>({ recent: [], reload: () => {} });

export function FleetFeedProvider({
  enabled,
  /** The caller's own account id, so their own actions raise nothing. */
  meAccountId,
  children,
}: {
  /** Admin, on a server with sites. Anything else and this does not poll. */
  enabled: boolean;
  meAccountId?: string | null;
  children: ReactNode;
}) {
  const { notify } = useNotifications();
  const [recent, setRecent] = useState<readonly AuditEntry[]>([]);
  const [tick, setTick] = useState(0);
  /** The highest `seq` already seen. -1 means "nothing yet": see below. */
  const seen = useRef<number>(-1);

  useEffect(() => {
    if (!enabled) return;
    let live = true;

    const poll = async () => {
      let entries: readonly AuditEntry[];
      try {
        const out = await adminAudit({ limit: WINDOW });
        entries = out.entries;
      } catch {
        /* A failed poll is nothing. The ledger is still the ledger, and a card
           saying "could not check for changes" is noise over live video. */
        return;
      }
      if (!live) return;

      const watched = entries.filter((e) => e.action in WATCHED);
      setRecent(watched);

      const highest = watched.reduce((m, e) => Math.max(m, e.seq), -1);
      if (seen.current < 0) {
        /* ⚠ THE FIRST POLL RAISES NOTHING, only a watermark. */
        seen.current = highest;
        return;
      }

      const fresh = watched
        .filter((e) => e.seq > seen.current)
        /* ⚠ NOT MINE. The ledger records the actor; an admin who just renamed
           a cell does not need to be told a cell was renamed. */
        .filter((e) => !meAccountId || e.account_id !== meAccountId)
        /* Oldest first, so a burst stacks in the order it happened. */
        .sort((a, b) => a.seq - b.seq);

      seen.current = Math.max(seen.current, highest);

      for (const entry of fresh) {
        const kind = WATCHED[entry.action];
        const body = fleetBody(entry);
        notify({
          id: `fleet:${entry.seq}`,
          kind: kind === "revoked" ? "revoked" : "fleet",
          title: fleetTitle(entry),
          at: Date.parse(entry.ts) || Date.now(),
          /* NOT PERSISTENT. These report; they do not ask. A card that stayed
             until dismissed would pile up on an admin's screen during a site
             installing eight towers in an afternoon. */
          ttlMs: 45_000,
          ...(body
            ? {
                render: () => (
                  <p className="text-[0.8125rem] leading-[18px] text-muted">
                    {body}
                  </p>
                ),
              }
            : {}),
        });
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), FLEET_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
    /* `notify` is stable; `tick` is the manual reload. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, meAccountId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return (
    <FleetFeedContext.Provider value={{ recent, reload }}>
      {children}
    </FleetFeedContext.Provider>
  );
}

export function useFleetFeed(): Ctx {
  return useContext(FleetFeedContext);
}
