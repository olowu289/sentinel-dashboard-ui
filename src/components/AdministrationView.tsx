/**
 * Administration: Sites, People, Shares, Audit log. Admins only.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT MAKES THIS NOT AN ADMIN PANEL
 * ══════════════════════════════════════════════════════════════════════
 *
 * Four things, and they are the difference between a settings screen and a
 * screen somebody uses while a site is on the phone:
 *
 *  1. **A cell is drawn as a cell.** A site is not a row with a hub count; it
 *     is its hubs, each with its towers under it, because "which masts are at
 *     North Gate" is the question an admin actually has.
 *  2. **An unassigned hub is impossible to miss.** It sits in its own group at
 *     the bottom of Sites, in detect amber -- the same claim amber makes
 *     everywhere in this product: *this needs you*. A hub nobody can see is the
 *     one state this screen exists to end.
 *  3. **Every destructive thing says what it will do first.** Revoke says whose
 *     feed it cuts. Disable says the person loses access within a minute.
 *  4. **Absence is diagnostic, everywhere.** No empty list is rendered without
 *     a sentence saying why it is empty and what to do.
 *
 * ── COLOUR ─────────────────────────────────────────────────────────────
 *
 * None of its own. Green is live, amber is *needs you*, red is a fault, and
 * everything else is white on black (CLAUDE.md). An Administration area that
 * invented an accent would be competing with the readings on the wall behind
 * it.
 *
 * ── THIS IS NOT THE ACCESS CONTROL ─────────────────────────────────────
 *
 * `/v1/admin/*` answers 403 for a site user whatever this renders, and the
 * rail hides the item. Both, because one of them is the security boundary and
 * the other is the product not lying.
 */

import { motion } from "motion/react";
import { IconRail } from "@/components/IconRail";
import { useCallback, useMemo, useState } from "react";
import type { Person, Share, Site } from "@kallon/sentry-sdk";
import { isShareLive } from "@kallon/sentry-sdk";
import {
  adminCreatePerson,
  adminCreateSite,
  adminRenameSite,
  adminResetPassword,
  adminSetPersonSites,
  adminSetPersonStatus,
  adminSetSiteHubs,
  revokeShare,
} from "@/lib/api/sites";
import {
  useAdminShares,
  useAudit,
  usePeople,
  useSites,
} from "@/lib/useSites";
import { ENTER, FADE } from "@/lib/motion";

import { ShareRow } from "@/components/SharesView";
import {
  Allowances,
  Card,
  Empty,
  Failed,
  Field,
  Loading,
  PaneHead,
  PrimaryButton,
  QuietButton,
  Row,
  StatusPill,
  Tabs,
  inputClass,
  siteStampLine,
} from "@/components/SitesPrimitives";

type PaneId = "sites" | "people" | "shares" | "audit";

const PANES: readonly { id: PaneId; label: string }[] = [
  { id: "sites", label: "Sites" },
  { id: "people", label: "People" },
  { id: "shares", label: "Shares" },
  { id: "audit", label: "Audit log" },
];

/* ------------------------------------------------------------------ *
 * Sites
 * ------------------------------------------------------------------ */

function SitesPane() {
  const sites = useSites();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [placing, setPlacing] = useState<string | null>(null);

  const create = useCallback(async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateSite(newName.trim());
      setNewName("");
      sites.reload();
    } catch (err) {
      const e = err as { status?: number; message?: string };
      setError(
        e?.status === 409
          ? "A site with that name already exists."
          : e?.message || "Could not create that site.",
      );
    } finally {
      setBusy(false);
    }
  }, [newName, sites]);

  const rename = useCallback(
    async (site: Site) => {
      if (!renameTo.trim()) return;
      setBusy(true);
      try {
        await adminRenameSite(site.site_id, renameTo.trim());
        setRenaming(null);
        setRenameTo("");
        sites.reload();
      } finally {
        setBusy(false);
      }
    },
    [renameTo, sites],
  );

  const place = useCallback(
    async (site: Site, hubId: string) => {
      setBusy(true);
      try {
        const next = [...(site.hubs ?? []), hubId];
        await adminSetSiteHubs(site.site_id, next);
        setPlacing(null);
        sites.reload();
      } finally {
        setBusy(false);
      }
    },
    [sites],
  );

  const unplace = useCallback(
    async (site: Site, hubId: string) => {
      setBusy(true);
      try {
        await adminSetSiteHubs(
          site.site_id,
          (site.hubs ?? []).filter((h) => h !== hubId),
        );
        sites.reload();
      } finally {
        setBusy(false);
      }
    },
    [sites],
  );

  if (sites.loading) return <Loading rows={3} label="Loading sites" />;
  if (sites.error) return <Failed message={sites.error} onRetry={sites.reload} />;

  const list = sites.value?.sites ?? [];
  const unassigned = sites.value?.unassigned_hubs ?? [];

  return (
    <div className="flex flex-col gap-[20px]">
      <Card>
        <Field
          label="Add a site"
          hint="A named location, like North Gate. It holds one or more hubs."
        >
          <div className="flex flex-wrap gap-[8px]">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="North Gate"
              className={inputClass + " max-w-[320px]"}
            />
            <PrimaryButton disabled={busy || !newName.trim()} onClick={create}>
              Create
            </PrimaryButton>
          </div>
        </Field>
        {error ? (
          <p role="alert" className="text-[0.8125rem] text-critical">
            {error}
          </p>
        ) : null}
      </Card>

      {list.length === 0 ? (
        <Empty
          title="No sites yet"
          why="Create one above, then put this organization's hubs in it. Until a hub is in a site, only you can see it."
        />
      ) : (
        <motion.div initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE} className="flex flex-col gap-[12px]">
          {list.map((site) => (
            <div
              key={site.site_id}
              className="flex flex-col gap-[12px] rounded-[12px] border border-line bg-card/40 p-[16px]"
            >
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                {renaming === site.site_id ? (
                  <div className="flex flex-wrap gap-[8px]">
                    <input
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      aria-label={`New name for ${site.name}`}
                      className={inputClass + " max-w-[260px]"}
                    />
                    <PrimaryButton disabled={busy} onClick={() => rename(site)}>
                      Save
                    </PrimaryButton>
                    <QuietButton onClick={() => setRenaming(null)}>
                      Cancel
                    </QuietButton>
                  </div>
                ) : (
                  <h3 className="font-display text-[0.9375rem] leading-[20px] text-body-ink">
                    {site.name}
                    <span className="ml-[8px] font-mono text-[0.6875rem] text-muted">
                      {(site.hubs ?? []).length === 1
                        ? "1 cell"
                        : `${(site.hubs ?? []).length} cells`}
                    </span>
                  </h3>
                )}
                {renaming === site.site_id ? null : (
                  <QuietButton
                    onClick={() => {
                      setRenaming(site.site_id);
                      setRenameTo(site.name);
                    }}
                  >
                    Rename
                  </QuietButton>
                )}
              </div>

              {(site.hubs ?? []).length === 0 ? (
                <p className="text-[0.8125rem] leading-[20px] text-muted">
                  No cells here yet. A cell is one hub and the towers on it.
                </p>
              ) : (
                <ul className="flex flex-col gap-[6px]">
                  {(site.hubs ?? []).map((hubId) => (
                    <li
                      key={hubId}
                      className="flex items-center justify-between gap-[8px] rounded-[8px] border border-line/70 bg-card/30 px-[12px] py-[8px]"
                    >
                      <span className="font-mono text-[0.75rem] text-sub">
                        {hubId}
                      </span>
                      <QuietButton onClick={() => unplace(site, hubId)}>
                        Remove
                      </QuietButton>
                    </li>
                  ))}
                </ul>
              )}

              {unassigned.length ? (
                placing === site.site_id ? (
                  <div className="flex flex-wrap items-center gap-[8px]">
                    {unassigned.map((hubId) => (
                      <QuietButton key={hubId} onClick={() => place(site, hubId)}>
                        {hubId}
                      </QuietButton>
                    ))}
                    <QuietButton onClick={() => setPlacing(null)}>
                      Cancel
                    </QuietButton>
                  </div>
                ) : (
                  <QuietButton onClick={() => setPlacing(site.site_id)}>
                    Add a cell
                  </QuietButton>
                )
              ) : null}
            </div>
          ))}
        </motion.div>
      )}

      {/* UNASSIGNED HUBS, IN THEIR OWN GROUP AND IN AMBER.
          This is the only place in the product they appear, and a hub nobody
          can see is the state this screen exists to end. */}
      {unassigned.length ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
          className="flex flex-col gap-[10px] rounded-[12px] border border-detect/40 bg-detect-bg p-[16px]"
        >
          <h3 className="font-display text-[0.9375rem] leading-[20px] text-detect">
            {unassigned.length === 1
              ? "1 hub is not in a site"
              : `${unassigned.length} hubs are not in a site`}
          </h3>
          <p className="text-[0.8125rem] leading-[20px] text-sub/90">
            Only administrators can see an unassigned hub. Put it in a site so
            the people who work there can.
          </p>
          <ul className="flex flex-wrap gap-[8px]">
            {unassigned.map((hubId) => (
              <li
                key={hubId}
                className="rounded-[8px] border border-detect/30 px-[10px] py-[4px] font-mono text-[0.75rem] text-detect"
              >
                {hubId}
              </li>
            ))}
          </ul>
        </motion.div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

function PeoplePane() {
  const people = usePeople();
  const sites = useSites();
  const [adding, setAdding] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "site_user">("site_user");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const add = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await adminCreatePerson({ login, password, role, sites: chosen });
      setAdding(false);
      setLogin("");
      setPassword("");
      setChosen([]);
      people.reload();
    } catch (err) {
      const e = err as { status?: number; message?: string };
      setError(
        e?.status === 409
          ? "That login is taken."
          : e?.message || "Could not add that person.",
      );
    } finally {
      setBusy(false);
    }
  }, [login, password, role, chosen, people]);

  const toggleSite = useCallback(
    async (person: Person, siteId: string) => {
      const next = person.sites.includes(siteId)
        ? person.sites.filter((s) => s !== siteId)
        : [...person.sites, siteId];
      setBusy(true);
      try {
        await adminSetPersonSites(person.account_id, next);
        people.reload();
      } finally {
        setBusy(false);
      }
    },
    [people],
  );

  const setStatus = useCallback(
    async (person: Person, status: "active" | "disabled") => {
      setBusy(true);
      try {
        await adminSetPersonStatus(person.account_id, status);
        people.reload();
      } finally {
        setBusy(false);
      }
    },
    [people],
  );

  const reset = useCallback(
    async (person: Person) => {
      setBusy(true);
      try {
        await adminResetPassword(person.account_id, newPassword);
        setResetting(null);
        setNewPassword("");
      } finally {
        setBusy(false);
      }
    },
    [newPassword],
  );

  if (people.loading) return <Loading rows={4} label="Loading people" />;
  if (people.error)
    return <Failed message={people.error} onRetry={people.reload} />;

  const rows = people.value?.people ?? [];
  const allSites = sites.value?.sites ?? [];

  return (
    <div className="flex flex-col gap-[20px]">
      {adding ? (
        <motion.div initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}>
          <Card>
            <div className="grid gap-[16px] sm:grid-cols-2">
              <Field label="Username">
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="First password"
                hint="They can change it themselves in Settings."
              >
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  /* WORDS, NOT DOTS. A password input renders real input as
                     dots, so a dotted placeholder reads as "already filled in"
                     (test/passwordHints.test.mjs). */
                  placeholder="their first password"
                  className={inputClass}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "admin" | "site_user")
                }
                className={inputClass + " max-w-[240px]"}
              >
                <option value="site_user">
                  Site user: everything, inside their sites
                </option>
                <option value="admin">
                  Administrator: everything, everywhere
                </option>
              </select>
            </Field>
            {allSites.length ? (
              <Field label="Sites">
                <div className="flex flex-wrap gap-[8px]">
                  {allSites.map((s) => (
                    <label
                      key={s.site_id}
                      className="flex items-center gap-[6px] rounded-[8px] border border-stroke px-[10px] py-[6px] text-[0.8125rem] text-sub"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(s.site_id)}
                        onChange={(e) =>
                          setChosen((c) =>
                            e.target.checked
                              ? [...c, s.site_id]
                              : c.filter((x) => x !== s.site_id),
                          )
                        }
                        className="size-[16px] accent-white"
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </Field>
            ) : null}
            {error ? (
              <p role="alert" className="text-[0.8125rem] text-critical">
                {error}
              </p>
            ) : null}
            <div className="flex gap-[8px]">
              <PrimaryButton
                disabled={busy || !login.trim() || !password}
                onClick={add}
              >
                Add person
              </PrimaryButton>
              <QuietButton onClick={() => setAdding(false)}>Cancel</QuietButton>
            </div>
          </Card>
        </motion.div>
      ) : (
        <div>
          <PrimaryButton onClick={() => setAdding(true)}>
            Add a person
          </PrimaryButton>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title="Nobody yet"
          why="Add people and assign them to sites. Everyone gets their own login; there are no shared site passwords."
        />
      ) : (
        <motion.div initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE} className="flex flex-col gap-[8px]">
          {rows.map((p) => {
            const isAdmin = p.role === "admin" || p.role === "owner";
            const disabled = p.status !== "active";
            return (
              <div
                key={p.account_id}
                className="flex flex-col gap-[10px] rounded-[10px] border border-line bg-card/40 px-[14px] py-[12px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  <span className="flex flex-wrap items-center gap-[10px]">
                    <span
                      className={
                        "text-[0.875rem] leading-[20px] " +
                        (disabled ? "text-muted line-through" : "text-body-ink")
                      }
                    >
                      {p.login}
                    </span>
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
                      {isAdmin ? "administrator" : "site user"}
                    </span>
                    {disabled ? (
                      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-critical">
                        disabled
                      </span>
                    ) : null}
                  </span>
                  <span className="flex gap-[8px]">
                    <QuietButton
                      onClick={() =>
                        setResetting(
                          resetting === p.account_id ? null : p.account_id,
                        )
                      }
                    >
                      Reset password
                    </QuietButton>
                    {disabled ? (
                      <QuietButton
                        disabled={busy}
                        onClick={() => setStatus(p, "active")}
                      >
                        Enable
                      </QuietButton>
                    ) : (
                      <QuietButton
                        danger
                        disabled={busy}
                        onClick={() => setStatus(p, "disabled")}
                      >
                        Disable
                      </QuietButton>
                    )}
                  </span>
                </div>

                {resetting === p.account_id ? (
                  <div className="flex flex-wrap items-end gap-[8px]">
                    <Field label="New password">
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="a new password for them"
                        className={inputClass + " max-w-[260px]"}
                        autoComplete="new-password"
                      />
                    </Field>
                    <PrimaryButton
                      disabled={busy || !newPassword}
                      onClick={() => reset(p)}
                    >
                      Set it
                    </PrimaryButton>
                  </div>
                ) : null}

                {isAdmin ? (
                  <p className="text-[0.75rem] leading-[16px] text-muted">
                    An administrator sees every site, so site membership does
                    not apply.
                  </p>
                ) : allSites.length === 0 ? (
                  <p className="text-[0.75rem] leading-[16px] text-muted">
                    No sites exist yet, so there is nothing to assign.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-[6px]">
                    {allSites.map((s) => {
                      const on = p.sites.includes(s.site_id);
                      return (
                        <button
                          key={s.site_id}
                          type="button"
                          disabled={busy}
                          aria-pressed={on}
                          onClick={() => toggleSite(p, s.site_id)}
                          className={
                            "rounded-[8px] border px-[10px] py-[4px] text-[0.75rem] transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
                            (on
                              ? "border-action bg-action text-action-ink"
                              : "border-stroke text-muted hover:text-sub")
                          }
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!isAdmin && p.sites.length === 0 ? (
                  <p className="text-[0.75rem] leading-[16px] text-detect">
                    Not in any site, so they can see nothing.
                  </p>
                ) : null}
              </div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shares, across the whole organization
 * ------------------------------------------------------------------ */

function SharesPane() {
  const shares = useAdminShares();
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = useCallback(
    async (s: Share) => {
      setBusyId(s.share_id);
      try {
        await revokeShare(s.share_id);
        shares.reload();
      } finally {
        setBusyId(null);
      }
    },
    [shares],
  );

  if (shares.loading) return <Loading rows={3} label="Loading shares" />;
  if (shares.error)
    return <Failed message={shares.error} onRetry={shares.reload} />;

  const all = shares.value?.shares ?? [];
  // WRAPPED, NOT PASSED. `.filter(isShareLive)` hands the callback the array
  // INDEX as its second argument, which `isShareLive` takes as `now: Date`, so
  // every share after the first would be compared against a nonsense clock.
  // tsc caught it; a plain JS version of this would not have.
  const live = all.filter((s) => isShareLive(s));
  const rest = all.filter((s) => !isShareLive(s));

  return (
    <div className="flex flex-col gap-[20px]">
      <PaneHead
        title="Active shares"
        blurb="Every share in this organization. Revoking one cuts the other site's live view immediately, not at the next renewal."
      />
      {live.length === 0 ? (
        <Empty
          title="No cameras are shared right now"
          why="When one site lends another a camera it appears here, and you can end it from this screen."
        />
      ) : (
        <div className="flex flex-col gap-[8px]">
          {live.map((s) => (
            <ShareRow
              key={s.share_id}
              share={s}
              busy={busyId === s.share_id}
              onRevoke={(x) => void revoke(x)}
            />
          ))}
        </div>
      )}

      {rest.length ? (
        <div className="flex flex-col gap-[8px]">
          <h3 className="font-display text-[0.8125rem] tracking-[0.12px] text-muted">
            Finished and pending
          </h3>
          {rest.map((s) => (
            <Row key={s.share_id}>
              <span className="flex min-w-[220px] flex-1 flex-wrap items-center gap-[10px]">
                <span className="text-[0.875rem] text-sub">
                  {s.owner_site_name} to {s.viewer_site_name}
                </span>
                <StatusPill status={s.status} />
                <Allowances live={s.live} ptz={s.ptz} playback={s.playback} />
              </span>
              <span className="text-[0.75rem] text-muted">
                {siteStampLine(Date.parse(s.decided_at ?? s.created_at))}
              </span>
            </Row>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Audit log
 * ------------------------------------------------------------------ */

const AUDIT_FILTERS: readonly { id: string; label: string; prefix?: string }[] = [
  { id: "all", label: "Everything" },
  { id: "share", label: "Shares", prefix: "share." },
  { id: "site", label: "Sites", prefix: "site." },
  { id: "person", label: "People", prefix: "person." },
  { id: "login", label: "Sign-ins", prefix: "login." },
  { id: "session", label: "Viewing", prefix: "session." },
  { id: "ptz", label: "Camera control", prefix: "ptz." },
  { id: "recording", label: "Footage", prefix: "recording." },
];

function AuditPane() {
  const [which, setWhich] = useState("all");
  const prefix = AUDIT_FILTERS.find((f) => f.id === which)?.prefix;
  const filter = useMemo(() => ({ action: prefix, limit: 200 }), [prefix]);
  const audit = useAudit(filter);

  return (
    <div className="flex flex-col gap-[16px]">
      <PaneHead
        title="Audit log"
        blurb="Who viewed, controlled, downloaded, shared, revoked and signed in. Scoped to this organization by the server."
      />
      <div className="flex flex-wrap gap-[6px]">
        {AUDIT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={which === f.id}
            onClick={() => setWhich(f.id)}
            className={
              "rounded-[8px] border px-[10px] py-[4px] text-[0.75rem] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
              (which === f.id
                ? "border-action bg-action text-action-ink"
                : "border-stroke text-muted hover:text-sub")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {audit.loading ? (
        <Loading rows={6} label="Loading the audit log" />
      ) : audit.error ? (
        <Failed message={audit.error} onRetry={audit.reload} />
      ) : (audit.value?.entries.length ?? 0) === 0 ? (
        <Empty
          title="Nothing recorded for that filter"
          why="The log keeps sign-ins, viewing, camera control, footage requests and every change to sites, people and shares. Try Everything."
        />
      ) : (
        <motion.div initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE} className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <caption className="sr-only">
              Audit log entries, newest first
            </caption>
            <thead>
              <tr className="border-b border-line text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
                <th scope="col" className="py-[8px] pr-[12px] font-normal">
                  When
                </th>
                <th scope="col" className="py-[8px] pr-[12px] font-normal">
                  What
                </th>
                <th scope="col" className="py-[8px] pr-[12px] font-normal">
                  Who
                </th>
                <th scope="col" className="py-[8px] font-normal">
                  Where
                </th>
              </tr>
            </thead>
            <tbody>
              {(audit.value?.entries ?? []).map((e) => (
                <tr
                  key={e.seq}
                  className="border-b border-row-line/60 align-top text-[0.8125rem]"
                >
                  <td className="py-[8px] pr-[12px] whitespace-nowrap text-muted">
                    {siteStampLine(Date.parse(e.ts))}
                  </td>
                  <td className="py-[8px] pr-[12px] font-mono text-[0.75rem] text-body-ink">
                    {e.action}
                  </td>
                  {/* ABSENCE IS DIAGNOSTIC: a system action with no account
                      says so rather than leaving the cell blank. */}
                  <td className="py-[8px] pr-[12px] font-mono text-[0.75rem] text-sub">
                    {e.account_id ?? "the system"}
                  </td>
                  <td className="py-[8px] font-mono text-[0.75rem] text-sub">
                    {e.device_id ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The area
 * ------------------------------------------------------------------ */

export function AdministrationView({
  onNavigate,
  sites = true,
  admin = false,
}: {
  onNavigate?: (id: string) => void;
  /** Does this server have sites? Passed to the rail so it agrees with here. */
  sites?: boolean;
  admin?: boolean;
}) {
  const [pane, setPane] = useState<PaneId>("sites");
  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      <IconRail
        active="admin"
        onSelect={onNavigate}
        sites={sites}
        admin={admin}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[20px] sm:px-[24px]">
        <div className="mx-auto flex max-w-[920px] flex-col gap-[20px]">
      <PaneHead
        title="Administration"
        blurb="Sites, the people who work at them, what is shared between them, and a record of everything that happened."
      />
      <Tabs
        tabs={PANES}
        active={pane}
        onChange={(id) => setPane(id as PaneId)}
      />
      <div role="tabpanel" id={`pane-${pane}`} aria-labelledby={`tab-${pane}`}>
        {pane === "sites" ? <SitesPane /> : null}
        {pane === "people" ? <PeoplePane /> : null}
        {pane === "shares" ? <SharesPane /> : null}
        {pane === "audit" ? <AuditPane /> : null}
      </div>
        </div>
      </div>
    </div>
  );
}
