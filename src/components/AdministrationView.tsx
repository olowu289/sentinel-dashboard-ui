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

import { AnimatePresence, motion } from "motion/react";
import { IconRail } from "@/components/IconRail";
import { useSession } from "@/components/AuthProvider";
import { useCallback, useMemo, useState } from "react";
import type { Person, Share, Site } from "@kallon/sentry-sdk";
import { said } from "@/lib/said";
import { isShareLive } from "@kallon/sentry-sdk";
import {
  adminAddPerson,
  adminCreateSite,
  adminRemoveSite,
  adminRenamePerson,
  adminRenameSite,
  adminResetPassword,
  adminSetPersonSites,
  adminSetPersonStatus,
  adminMoveCell,
  revokeShare,
} from "@/lib/api/sites";
import {
  useAdminShares,
  useAudit,
  useCells,
  usePeople,
  useSites,
} from "@/lib/useSites";

import { AddDeviceDrawer, type AddWhat } from "@/components/AddDeviceDrawer";
import { SiteCells } from "@/components/SiteCells";
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
  /* THE CELLS, NAMED. `sites.value.sites[].hubs` is a list of hub ids and
     nothing else; a cell has a name somebody chose, a tower count and a
     ceiling, and this route is the only place they exist. */
  const cells = useCells();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  /* The drawer: what it is adding, and what it is adding it to. Null means
     closed, and the page behind keeps its place. */
  const [adding, setAdding] = useState<
    { what: AddWhat; siteId?: string; hubId?: string } | null
  >(null);

  const reloadAll = useCallback(() => {
    sites.reload();
    cells.reload();
  }, [sites, cells]);

  const removeSite = useCallback(
    async (siteId: string) => {
      setBusy(true);
      setError(null);
      try {
        await adminRemoveSite(siteId);
        setDeleting(null);
        reloadAll();
      } catch (err) {
        /* The server names what is still in it, which is more useful than
           anything written here: "North Camp still has 2 cells and 1 person".
           `said` keeps that and refuses anything written for a programmer. */
        setError(said(err, "Could not delete that site. Try again."));
        setDeleting(null);
      } finally {
        setBusy(false);
      }
    },
    [reloadAll],
  );

  const create = useCallback(async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminCreateSite(newName.trim());
      setNewName("");
      sites.reload();
    } catch (err) {
      const e = err as { status?: number };
      setError(
        e?.status === 409
          ? "A site with that name already exists."
          : said(err, "Could not create that site. Try again."),
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

  /* NO `place` AND `unplace` ANY MORE. They assigned and unassigned a hub
     by id, which is how a cell used to be put in a site. A cell now ARRIVES
     in a site -- the claim carries the site, and the hub lands there when it
     enrols -- and moving one is `adminMoveCell`, which also ends the shares
     the move invalidates. Two ways to place a hub would have been two ways
     for the shares half to be forgotten.

     `adminSetSiteHubs` still exists in the SDK for the unassigned-hub case
     below, which is a hub that enrolled before any of this. */

  if (sites.loading) return <Loading rows={3} label="Loading sites" />;
  if (sites.error) return <Failed message={sites.error} onRetry={sites.reload} />;

  const list = sites.value?.sites ?? [];
  const unassigned = sites.value?.unassigned_hubs ?? [];

  return (
    <div className="flex flex-col gap-[20px]">
      {/* ADD, FROM THE TOP OF THE PANE as well as from inside a site: the
          first cell in an organization is added before any site has one. */}
      <div className="flex flex-wrap gap-[8px]">
        <PrimaryButton onClick={() => setAdding({ what: "cell" })}>
          Add a cell
        </PrimaryButton>
        <QuietButton onClick={() => setAdding({ what: "tower" })}>
          Add a tower
        </QuietButton>
      </div>

      <AddDeviceDrawer
        open={adding !== null}
        what={adding?.what ?? "cell"}
        sites={list}
        cells={cells.value?.cells ?? []}
        {...(adding?.siteId ? { siteId: adding.siteId } : {})}
        {...(adding?.hubId ? { hubId: adding.hubId } : {})}
        onClose={() => setAdding(null)}
        onAdded={reloadAll}
      />

      <Card>
        <Field
          label="Add a site"
          hint="A named location, like North Gate. It holds one or more cells."
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
                    {/* ⚠ COUNTED FROM THE LIST BELOW IT, not from
                        `site.hubs`. The header read /v1/sites and the body
                        reads /v1/cells, and the screenshots caught them
                        disagreeing: "West Yard · 0 cells" with Yard Shed
                        listed underneath it. Two sources for one number is how
                        a heading lies about what is under it. */}
                    <span className="ml-[8px] font-mono text-[0.6875rem] text-muted">
                      {(() => {
                        const n = (cells.value?.cells ?? []).filter(
                          (c) => c.site_id === site.site_id,
                        ).length;
                        return n === 1 ? "1 cell" : `${n} cells`;
                      })()}
                    </span>
                  </h3>
                )}
                {renaming === site.site_id ? null : (
                  <span className="flex gap-[8px]">
                    <QuietButton
                      onClick={() => {
                        setRenaming(site.site_id);
                        setRenameTo(site.name);
                      }}
                    >
                      Rename
                    </QuietButton>
                    <QuietButton danger onClick={() => setDeleting(site.site_id)}>
                      Delete
                    </QuietButton>
                  </span>
                )}
              </div>

              <SiteCells
                site={site}
                cells={cells.value?.cells ?? []}
                sites={list}
                onChanged={reloadAll}
                onAddCell={(siteId) =>
                  setAdding({ what: "cell", siteId })
                }
                onAddTower={(hubId) =>
                  setAdding({ what: "tower", hubId })
                }
              />

              {/* DELETE, AND IT IS REFUSED UNLESS THE SITE IS EMPTY. The
                  server counts what is in it and names it, because "not
                  empty" sends somebody hunting through three screens. */}
              <AnimatePresence>
                {deleting === site.site_id ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={ENTER}
                    className="flex flex-col gap-[8px] rounded-[8px] border border-critical/40 bg-critical/5 p-[12px]"
                    role="alertdialog"
                    aria-label={`Delete ${site.name}?`}
                  >
                    <p className="font-display text-[0.8125rem] text-body-ink">
                      Delete {site.name}?
                    </p>
                    <p className="text-[0.75rem] leading-[16px] text-muted">
                      Only an empty site can be deleted. Its cells and its
                      people have to be moved first. The site stays in the
                      audit log, so old entries still make sense.
                    </p>
                    <div className="flex gap-[8px]">
                      <QuietButton
                        danger
                        disabled={busy}
                        onClick={() => void removeSite(site.site_id)}
                      >
                        {busy ? "Working…" : "Delete it"}
                      </QuietButton>
                      <QuietButton onClick={() => setDeleting(null)}>
                        Keep it
                      </QuietButton>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
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
          <ul className="flex flex-col gap-[8px]">
            {unassigned.map((hubId) => (
              <li
                key={hubId}
                className="flex flex-wrap items-center gap-[8px]"
              >
                <span className="rounded-[8px] border border-detect/30 px-[10px] py-[4px] font-mono text-[0.75rem] text-detect">
                  {hubId}
                </span>
                <span className="text-[0.75rem] text-sub/80">put it in</span>
                {list.map((site) => (
                  <QuietButton
                    key={site.site_id}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await adminMoveCell(hubId, site.site_id);
                        reloadAll();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {site.name}
                  </QuietButton>
                ))}
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

/**
 * Copy a login to the clipboard, and say that it happened.
 *
 * ⚠ IT FALLS BACK RATHER THAN FAILING SILENTLY. `navigator.clipboard` needs a
 * secure context and a permission, and a hub's LAN dashboard is served over
 * plain HTTP to a browser that will refuse it. When it refuses, the button
 * says to select it instead — the login beside it is `select-all` text, which
 * is why that is a complete answer and not an apology.
 */
function CopyLogin({ login }: { login: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const copy = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(login);
        setState("copied");
        setTimeout(() => setState("idle"), 2_000);
      } catch {
        setState("manual");
      }
    })();
  }, [login]);
  return (
    <QuietButton onClick={copy} label={`Copy the login ${login}`}>
      {state === "copied" ? "Copied" : state === "manual" ? "Select it" : "Copy"}
    </QuietButton>
  );
}

function PeoplePane() {
  const people = usePeople();
  const sites = useSites();
  /* WHO IS SIGNED IN, so this screen does not offer an administrator a
     Disable button for itself. The server refuses it -- that is what stops
     an admin disabling the only admin -- and a button that cannot work is
     not a safeguard, it is a 404 waiting for somebody to press it. */
  const { account } = useSession();
  const meId = account?.account_id ?? null;
  const [adding, setAdding] = useState(false);
  /* A NAME, not a login. Their login is `name.organization` and the
     organization half is this admin's own, so there is nothing to type and
     nothing to get wrong. */
  const [name, setName] = useState("");
  /* THE LOGIN, SHOWN ONCE, right after somebody is added. This is the only
     moment it belongs on screen: an admin has to be able to tell them what
     to type, and a list of credentials is a worse list than a list of
     names. */
  const [justAdded, setJustAdded] = useState<Person | null>(null);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "site_user">("site_user");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const add = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await adminAddPerson({
        name,
        password,
        role,
        sites: chosen,
      });
      setAdding(false);
      setName("");
      setPassword("");
      setChosen([]);
      setJustAdded(created);
      people.reload();
    } catch (err) {
      const e = err as { status?: number; code?: string };
      setError(
        e?.code === "name_taken" || e?.status === 409
          ? "Somebody in this organization already has that name."
          : said(err, "Could not add that person. Check the name and try again."),
      );
    } finally {
      setBusy(false);
    }
  }, [name, password, role, chosen, people]);

  const rename = useCallback(
    async (person: Person, to: string) => {
      setBusy(true);
      setError(null);
      try {
        await adminRenamePerson(person.account_id, to);
        setRenaming(null);
        people.reload();
      } catch (err) {
        const e = err as { code?: string };
        setError(
          e?.code === "name_taken"
            ? "Somebody in this organization already has that name."
            : said(err, "Could not change that name. Try again."),
        );
      } finally {
        setBusy(false);
      }
    },
    [people],
  );

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
  /* THE ORGANIZATION'S LOGIN HALF. Every person's login is `name.slug`, and
     this screen cannot say what a new login will be without it. "" when the
     server does not send one, and every sentence that would have used it
     falls back rather than guessing. */
  const orgSlug = people.value?.org?.slug ?? "";

  return (
    <div className="flex flex-col gap-[20px]">
      {/* ⚠ THE ONE MOMENT A LOGIN BELONGS ON SCREEN. An admin who has just
          added somebody has to be able to tell them what to type, and
          reconstructing `name.organization` by hand is how a person is given
          the wrong login on their first day. It is dismissible, and it does
          not come back: the list shows names. */}
      {justAdded ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={ENTER}
          className="flex flex-wrap items-center justify-between gap-[10px] rounded-[10px] border border-line bg-card/60 px-[14px] py-[12px]"
        >
          <span className="flex flex-col gap-[4px]">
            <span className="font-display text-[0.875rem] text-body-ink">
              {justAdded.name ?? justAdded.login} can sign in now
            </span>
            {/* ⚠ THE WHOLE LOGIN, EXACTLY AS TYPED AT THE PROMPT, and a
                button that copies it. An administrator read
                `guest2.<organization>` off this screen and passed it on,
                because the hint below used to say that and this line was a
                sentence somebody had to pick the login out of. */}
            <span className="flex flex-wrap items-center gap-[8px]">
              <code
                data-login={justAdded.login}
                className="select-all rounded-[6px] bg-ink/40 px-[8px] py-[3px] font-mono text-[0.8125rem] text-body-ink"
              >
                {justAdded.login}
              </code>
              <CopyLogin login={justAdded.login} />
            </span>
            <span className="text-[0.8125rem] text-muted">
              That is their login, with the password you just set. They can
              change the password in Settings; the login never changes.
            </span>
          </span>
          <QuietButton onClick={() => setJustAdded(null)}>Got it</QuietButton>
        </motion.div>
      ) : null}
      {adding ? (
        <motion.div initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}>
          <Card>
            <div className="grid gap-[16px] sm:grid-cols-2">
              <Field
                label="Name"
                hint={
                  /* ⚠ THE REAL SLUG, FROM THE SERVER. This said
                     `they will sign in as guest2.<organization>` -- angle
                     brackets and all -- because the page never knew the
                     organization's login half. `GET /v1/admin/people` says
                     it now. With no slug there is nothing to promise, so the
                     hint falls back to the rule rather than inventing one. */
                  name.trim() && orgSlug
                    ? `They will sign in as ${name.trim().toLowerCase()}.${orgSlug}`
                    : "Lower case letters, digits and hyphens. No dots: the dot is what separates a name from its organization."
                }
              >
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="dave"
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
                disabled={busy || !name.trim() || !password}
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
                      {p.name ?? p.login}
                      {/* `dele (was chi)`. The ledger holds account ids, so
                          an old entry still resolves to this person -- this
                          is how a READER of the list connects the two. */}
                      {p.was ? (
                        <span className="ml-[6px] text-[0.75rem] text-muted">
                          (was {p.was})
                        </span>
                      ) : null}
                    </span>
                    {/* THE LOGIN, quiet and monospaced. It is a credential,
                        not a name, and it is here because somebody on the
                        phone to this person needs to read it out.

                        ⚠ NOT WHEN IT IS THE NAME BESIDE IT. An organization's
                        own account has no `name`, the line above falls back to
                        the login, and this printed it a second time:
                        `guest2.terra-industries guest2.terra-industries` was
                        on screen in production. */}
                    {p.name && p.name !== p.login ? (
                      <span
                        data-login={p.login}
                        className="select-all font-mono text-[0.6875rem] text-muted/80"
                      >
                        {p.login}
                      </span>
                    ) : null}
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
                    {p.account_id === meId ? (
                      /* YOUR OWN ROW. Nothing here is yours to press: the
                         password is changed in Settings, where it asks for
                         the current one, and disabling yourself is refused
                         by the server. */
                      <span className="text-[0.75rem] text-muted">
                        This is you. Change your password in Settings.
                      </span>
                    ) : null}
                    {p.account_id === meId ? null : (
                    <QuietButton
                      onClick={() =>
                        setResetting(
                          resetting === p.account_id ? null : p.account_id,
                        )
                      }
                    >
                      Reset password
                    </QuietButton>
                    )}
                    {/* ONLY A PERSON CAN BE RENAMED, and only to fix a
                        typo. An organization's own login is not somebody's
                        name, and the slug behind it is in every person's
                        login in the organization. */}
                    {p.name && p.account_id !== meId ? (
                      <QuietButton
                        onClick={() => {
                          setRenaming(
                            renaming === p.account_id ? null : p.account_id,
                          );
                          setRenameTo(p.name ?? "");
                        }}
                      >
                        Fix a typo
                      </QuietButton>
                    ) : null}
                    {p.account_id === meId ? null : disabled ? (
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

                {renaming === p.account_id ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={ENTER}
                    className="flex flex-col gap-[8px]"
                  >
                    <Field
                      label="Correct the name"
                      hint={
                        "This changes their login to " +
                        (renameTo.trim().toLowerCase() || "name") +
                        ".<organization>, so tell them. Their history keeps their old name beside the new one."
                      }
                    >
                      <div className="flex flex-wrap gap-[8px]">
                        <input
                          value={renameTo}
                          onChange={(e) => setRenameTo(e.target.value)}
                          className={inputClass + " max-w-[220px]"}
                          autoComplete="off"
                        />
                        <PrimaryButton
                          disabled={busy || !renameTo.trim()}
                          onClick={() => void rename(p, renameTo.trim())}
                        >
                          Save
                        </PrimaryButton>
                        <QuietButton onClick={() => setRenaming(null)}>
                          Cancel
                        </QuietButton>
                      </div>
                    </Field>
                  </motion.div>
                ) : null}
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
}: {
  onNavigate?: (id: string) => void;
}) {
  const [pane, setPane] = useState<PaneId>("sites");
  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      {/* No `sites`/`admin` here: the rail asks the server itself. Passing
          them from a screen is a second source of truth that can disagree
          with the probe, and nine screens forgetting to was the bug that hid
          this very page from the people who administer it. */}
      <IconRail active="admin" onSelect={onNavigate} />
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
