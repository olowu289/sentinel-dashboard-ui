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
import { useSession } from "@/components/AuthProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEntry, Person, Share, Site } from "@kallon/sentry-sdk";
import { said } from "@/lib/said";
import { AUDIT_GROUPS, sentenceFor } from "@/lib/auditSentence";
import { siteDayEnd, siteDayStart } from "@/lib/time";
import { isAdminRole, isShareLive } from "@kallon/sentry-sdk";
import {
  adminAddPerson,
  adminCreateSite,
  adminRemovePerson,
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
  ConfirmDialog,
  CopyableLogin,
  Empty,
  Failed,
  Field,
  Loading,
  MultiSelect,
  OverflowMenu,
  PaneHead,
  PrimaryButton,
  QuietButton,
  Row,
  SidePanel,
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
  /** The "Add a site" panel. */
  const [naming, setNaming] = useState(false);
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
      setNaming(false);
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
      {/* ⚠ ONE PRIMARY, AND THE OTHER TWO MOVED TO WHERE THEY MEAN
          SOMETHING.
          The head carried three buttons: Add a site, Add a cell, Add a tower.
          The second and third ask "which site?" and "which cell?" as their
          first question, and every site card already offers Add a cell and
          every cell row already offers Add a tower -- where the answer is the
          card somebody pressed. So the head keeps the one action that needs
          no target.

          The exception is an organization with NO sites yet: its first cell
          has nowhere else to be added from, so the button appears there and
          only there. */}
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <PaneHead
          title="Sites"
          blurb="A site is a place: North Gate, the yard, the workshop. It holds cells, and a cell is one hub with its towers."
        />
        <div className="flex flex-wrap items-center gap-[8px]">
          {list.length === 0 && !sites.loading ? (
            <QuietButton onClick={() => setAdding({ what: "cell" })}>
              Add a cell
            </QuietButton>
          ) : null}
          <PrimaryButton onClick={() => setNaming(true)}>
            Add a site
          </PrimaryButton>
        </div>
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

      {error ? (
        <p role="alert" className="text-[0.8125rem] text-critical">
          {error}
        </p>
      ) : null}

      <SidePanel
        open={naming}
        title="Add a site"
        onClose={() => {
          setNaming(false);
          setNewName("");
        }}
        footer={
          <>
            <PrimaryButton disabled={busy || !newName.trim()} onClick={create}>
              {busy ? "Creating…" : "Create site"}
            </PrimaryButton>
            <QuietButton
              onClick={() => {
                setNaming(false);
                setNewName("");
              }}
            >
              Cancel
            </QuietButton>
          </>
        }
      >
        <Field
          label="Name"
          hint={
            /* ⚠ AND NOT "All sites". That name means the ACCESS CHOICE --
               "may see every site" -- and a place called the same thing cannot
               be told apart from it. The server refuses it too, in the same
               words, so the rule is not only in the browser. */
            "A place: North Gate, the yard, the workshop. Not “All sites”: that is what the access choice is called."
          }
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="North Gate"
            className={inputClass}
          />
        </Field>
      </SidePanel>

      {list.length === 0 ? (
        <Empty
          title="No sites yet"
          why="Add a site for each place you have cameras: North Gate, the yard, the workshop. Until a cell is in a site, only an administrator can see it."
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
                  <OverflowMenu
                    label={`Actions for ${site.name}`}
                    items={[
                      {
                        label: "Rename",
                        onSelect: () => {
                          setRenaming(site.site_id);
                          setRenameTo(site.name);
                        },
                      },
                      {
                        label: "Add a cell",
                        onSelect: () =>
                          setAdding({ what: "cell", siteId: site.site_id }),
                      },
                      {
                        label: "Delete",
                        onSelect: () => setDeleting(site.site_id),
                        danger: true,
                      },
                    ]}
                  />
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
                  empty" sends somebody hunting through three screens. The
                  dialog is the shared one, so this reads like the People
                  screen's Remove rather than like its own invention. */}
              <ConfirmDialog
                open={deleting === site.site_id}
                busy={busy}
                title={`Delete ${site.name}?`}
                consequence="Only an empty site can be deleted: its cells and its people have to be moved first. The site stays in the audit log, so old entries still make sense."
                confirmLabel="Delete"
                onCancel={() => setDeleting(null)}
                onConfirm={() => void removeSite(site.site_id)}
              />
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
                {/* ⚠ THE CELL'S NAME, NOT ITS HUB ID. This printed
                    `hub-lab-01` in a monospace chip, which is the one kind of
                    string this product must never show a customer. The name
                    comes from /v1/cells; a hub that has enrolled and never
                    been named has no name to show, and "An unnamed cell" is
                    the honest version of that rather than its id. */}
                <span className="rounded-[8px] border border-detect/30 px-[10px] py-[4px] text-[0.75rem] text-detect">
                  {(cells.value?.cells ?? []).find((c) => c.hub_id === hubId)
                    ?.name || "An unnamed cell"}
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
 * One row per person, every action in one menu, and the real status.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS REPLACED, AND THE BUG IT SHIPPED WITH
 * ══════════════════════════════════════════════════════════════════════
 *
 * Six buttons in a row per person (Edit sites, Reset password, Fix a typo,
 * Disable, and a chip per site), wrapping onto three lines on a laptop. The
 * site membership was a row of chips whose state was readable only by colour.
 * And the status was not shown at all: owner1 and guest1 are DISABLED on the
 * production DC and the page offered both of them a "Disable" button, because
 * it never read `status` — so the one fact that explains why somebody cannot
 * sign in was the one fact missing, and the action offered was the one that
 * had already been taken.
 *
 * Now: name, login with a copy button, role, a STATUS BADGE, a sites summary,
 * and one overflow menu. The membership editor is a side panel with a
 * searchable multi-select. Removing somebody is a real route, behind a
 * confirmation that names them.
 */
function PeoplePane() {
  const people = usePeople();
  const sites = useSites();
  /* WHO IS SIGNED IN, so this screen does not offer an administrator a
     Disable or Remove for itself. The server refuses both -- that is what
     stops an admin locking the organization out of itself -- and a menu item
     that cannot work is a refusal waiting to be discovered. */
  const { account } = useSession();
  const meId = account?.account_id ?? null;

  /* ── THE PANELS AND DIALOGS, one of each, named by what they are for ── */
  const [panel, setPanel] = useState<
    | { kind: "add" }
    | { kind: "sites"; person: Person }
    | { kind: "password"; person: Person }
    | { kind: "rename"; person: Person }
    | null
  >(null);
  const [confirm, setConfirm] = useState<
    { kind: "remove" | "disable" | "enable"; person: Person } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* THE LOGIN, SHOWN ONCE, right after somebody is added. The only moment a
     credential belongs on screen: an admin has to be able to tell them what
     to type, and reconstructing `name.organization` by hand is how a person is
     given the wrong login on their first day. */
  const [justAdded, setJustAdded] = useState<Person | null>(null);

  const reload = people.reload;
  const allSites = sites.value?.sites ?? [];
  const orgSlug = people.value?.org?.slug ?? "";
  const orgName = people.value?.org?.name ?? "this organization";

  /** Every action goes through this, so one place sets busy and says why. */
  const act = useCallback(
    async (what: string, fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        setError(said(err, `${what} did not work. Try again.`));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (people.loading) return <Loading rows={4} label="Loading people" />;
  if (people.error)
    return <Failed message={people.error} onRetry={people.reload} />;

  const rows = people.value?.people ?? [];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <PaneHead
          title="People"
          blurb="Everyone who signs in to this organization. Each person has their own login; there are no shared site passwords."
        />
        <PrimaryButton onClick={() => setPanel({ kind: "add" })}>
          Add a person
        </PrimaryButton>
      </div>

      {error ? (
        <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
          {error}
        </p>
      ) : null}

      {justAdded ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={ENTER}
          className="flex flex-wrap items-center justify-between gap-[10px] rounded-[10px] border border-line bg-card/60 px-[14px] py-[12px]"
        >
          <span className="flex min-w-0 flex-col gap-[4px]">
            <span className="font-display text-[0.875rem] text-body-ink">
              {justAdded.name ?? justAdded.login} can sign in now
            </span>
            <CopyableLogin login={justAdded.login} />
            <span className="text-[0.8125rem] text-muted">
              That is their login, with the password you just set. They can
              change the password in Settings; the login never changes.
            </span>
          </span>
          <QuietButton onClick={() => setJustAdded(null)}>Got it</QuietButton>
        </motion.div>
      ) : null}

      {rows.length === 0 ? (
        <Empty
          title="Nobody here yet"
          why="Add the people who work at your sites. Each one gets their own login, and you choose which sites they can see."
        />
      ) : (
        <div className="flex flex-col gap-[8px]">
          {rows.map((p) => (
            <PersonRow
              key={p.account_id}
              person={p}
              sites={allSites}
              isMe={p.account_id === meId}
              onPanel={setPanel}
              onConfirm={setConfirm}
            />
          ))}
        </div>
      )}

      {/* ── ADD, AND EDIT, IN THE SAME PANEL ─────────────────────────── */}
      <AddPersonPanel
        open={panel?.kind === "add"}
        sites={allSites}
        orgSlug={orgSlug}
        busy={busy}
        onClose={() => setPanel(null)}
        onAdd={async (input) => {
          let created: Person | null = null;
          const ok = await act("Adding that person", async () => {
            created = await adminAddPerson(input);
          });
          if (ok) {
            setPanel(null);
            if (created) setJustAdded(created);
          }
        }}
      />

      <SitesPanel
        open={panel?.kind === "sites"}
        person={panel?.kind === "sites" ? panel.person : null}
        sites={allSites}
        busy={busy}
        onClose={() => setPanel(null)}
        onSave={async (person, next) => {
          const ok = await act("Changing their sites", () =>
            adminSetPersonSites(person.account_id, next),
          );
          if (ok) setPanel(null);
        }}
      />

      <PasswordPanel
        open={panel?.kind === "password"}
        person={panel?.kind === "password" ? panel.person : null}
        busy={busy}
        onClose={() => setPanel(null)}
        onSave={async (person, password) => {
          const ok = await act("Setting that password", () =>
            adminResetPassword(person.account_id, password),
          );
          if (ok) setPanel(null);
        }}
      />

      <RenamePanel
        open={panel?.kind === "rename"}
        person={panel?.kind === "rename" ? panel.person : null}
        orgSlug={orgSlug}
        busy={busy}
        onClose={() => setPanel(null)}
        onSave={async (person, name) => {
          const ok = await act("Changing that name", () =>
            adminRenamePerson(person.account_id, name),
          );
          if (ok) setPanel(null);
        }}
      />

      {/* ── AND THE ONE PLACE RED IS SPENT ──────────────────────────── */}
      <ConfirmDialog
        open={confirm !== null}
        busy={busy}
        title={
          confirm === null
            ? ""
            : confirm.kind === "remove"
              ? `Remove ${personLabel(confirm.person)}?`
              : confirm.kind === "disable"
                ? `Disable ${personLabel(confirm.person)}?`
                : `Enable ${personLabel(confirm.person)}?`
        }
        consequence={
          confirm === null
            ? ""
            : confirm.kind === "remove"
              ? `They are signed out at once, taken out of every site, and can no longer sign in to ${orgName}. The audit log keeps their name against everything they did.`
              : confirm.kind === "disable"
                ? "They are signed out at once and cannot sign in until you enable them again. Nothing they did is removed."
                : "They can sign in again, with the password they already have."
        }
        confirmLabel={
          confirm === null
            ? ""
            : confirm.kind === "remove"
              ? "Remove"
              : confirm.kind === "disable"
                ? "Disable"
                : "Enable"
        }
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          const { kind, person } = confirm;
          const ok = await act(
            kind === "remove"
              ? "Removing that person"
              : kind === "disable"
                ? "Disabling them"
                : "Enabling them",
            () =>
              kind === "remove"
                ? adminRemovePerson(person.account_id)
                : adminSetPersonStatus(
                    person.account_id,
                    kind === "disable" ? "disabled" : "active",
                  ),
          );
          if (ok) setConfirm(null);
        }}
      />
    </div>
  );
}

/** What to call somebody on screen: their name, never their login. */
function personLabel(p: Person): string {
  return p.name ?? p.login;
}

/** "2 sites", "Every site", or the honest "No sites yet". */
function sitesSummary(p: Person, total: number): string {
  const n = p.sites.length;
  if (isAdminRole(p.role)) return "Every site";
  if (n === 0) return "No sites yet";
  if (total > 0 && n === total) return "Every site";
  return n === 1 ? "1 site" : `${n} sites`;
}

function PersonRow({
  person,
  sites,
  isMe,
  onPanel,
  onConfirm,
}: {
  person: Person;
  sites: readonly Site[];
  isMe: boolean;
  onPanel: (p: { kind: "sites" | "password" | "rename"; person: Person }) => void;
  onConfirm: (c: { kind: "remove" | "disable" | "enable"; person: Person }) => void;
}) {
  /* ⚠ THE REAL STATUS, WHICH THE PAGE USED TO IGNORE. `status` has been on the
     wire all along; owner1 and guest1 are disabled on the production DC and
     this screen showed them as if they were not. A disabled row is muted and
     badged, and its menu offers Enable rather than Disable. */
  const disabled = person.status !== "active";
  const admin = isAdminRole(person.role);
  /* An ORGANIZATION's own login has no `name`: it is the customer's
     credential, not a person on a list. It cannot be renamed, removed or
     disabled, and the menu says so rather than offering an action the server
     will refuse. */
  const isOrganization = person.name === undefined;

  return (
    <Row>
      <span className={"flex min-w-0 flex-1 flex-col gap-[4px] " + (disabled ? "opacity-60" : "")}>
        <span className="flex flex-wrap items-center gap-[8px]">
          <span
            className={
              "text-[0.875rem] leading-[20px] " +
              (disabled ? "text-muted line-through" : "text-body-ink")
            }
          >
            {personLabel(person)}
          </span>
          {person.was ? (
            <span className="text-[0.75rem] text-muted">(was {person.was})</span>
          ) : null}
          <StatusPill status={disabled ? "disabled" : "active"} />
          {/* ONE PHRASE, NOT TWO CHIPS. The organization's row ran
              "ADMINISTRATOR THE ORGANIZATION" together, which reads as a
              sentence that lost its verb. It is an administrator -- saying
              what it IS covers that and explains why it has no menu. */}
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
            {isOrganization
              ? "the organization's own login"
              : admin
                ? "administrator"
                : "site user"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-[10px]">
          <CopyableLogin login={person.login} />
          <span className="text-[0.75rem] text-sub/80">
            {sitesSummary(person, sites.length)}
          </span>
        </span>
      </span>

      <OverflowMenu
        label={`Actions for ${personLabel(person)}`}
        items={[
          {
            label: "Edit sites",
            onSelect: () => onPanel({ kind: "sites", person }),
            disabled: admin,
            why: "An administrator sees every site, so there is no membership to change.",
          },
          {
            label: "Reset password",
            onSelect: () => onPanel({ kind: "password", person }),
            disabled: isMe || isOrganization,
            why: isMe
              ? "Change your own password in Settings, where it asks for the current one."
              : "This is the organization's own login. Change it in Settings.",
          },
          {
            label: "Fix a typo in the name",
            onSelect: () => onPanel({ kind: "rename", person }),
            disabled: isMe || isOrganization,
            why: isMe
              ? "Nobody renames themselves: the audit log would read as though somebody else did it."
              : "An organization's login is not a person's name.",
          },
          disabled
            ? {
                label: "Enable",
                onSelect: () => onConfirm({ kind: "enable", person }),
                disabled: isMe || isOrganization,
                why: "This login is not yours to enable.",
              }
            : {
                label: "Disable",
                onSelect: () => onConfirm({ kind: "disable", person }),
                disabled: isMe || isOrganization,
                why: isMe
                  ? "You cannot disable yourself."
                  : "The organization's own login cannot be disabled.",
                danger: true,
              },
          {
            label: "Remove",
            onSelect: () => onConfirm({ kind: "remove", person }),
            disabled: isMe || isOrganization,
            why: isMe
              ? "Ask another administrator to remove you."
              : "The organization's own login cannot be removed.",
            danger: true,
          },
        ]}
      />
    </Row>
  );
}

function AddPersonPanel({
  open,
  sites,
  orgSlug,
  busy,
  onClose,
  onAdd,
}: {
  open: boolean;
  sites: readonly Site[];
  orgSlug: string;
  busy: boolean;
  onClose: () => void;
  onAdd: (input: {
    name: string;
    password: string;
    role: "admin" | "site_user";
    sites: string[];
  }) => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "site_user">("site_user");
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPassword("");
    setRole("site_user");
    setChosen([]);
  }, [open]);

  const ready = name.trim().length > 0 && password.length > 0;
  return (
    <SidePanel
      open={open}
      title="Add a person"
      onClose={onClose}
      footer={
        <>
          <PrimaryButton
            disabled={!ready || busy}
            onClick={() =>
              onAdd({ name: name.trim(), password, role, sites: chosen })
            }
          >
            {busy ? "Adding…" : "Add person"}
          </PrimaryButton>
          <QuietButton onClick={onClose}>Cancel</QuietButton>
        </>
      }
    >
      <Field
        label="Name"
        hint={
          /* THE REAL SLUG, FROM THE SERVER. This promised
             `they will sign in as guest2.<organization>` -- angle brackets and
             all -- because the page did not know the organization's login
             half. With no slug there is nothing to promise, so the hint falls
             back to the rule. */
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
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label="First password"
        hint="They can change it in Settings. Nobody else can read it, including you."
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="At least 12 characters"
          autoComplete="new-password"
        />
      </Field>

      <Field label="Role" hint="An administrator sees every site and this area.">
        <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-[6px]">
          {(
            [
              ["site_user", "Site user"],
              ["admin", "Administrator"],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={role === id}
              onClick={() => setRole(id)}
              className={
                "rounded-[8px] border px-[10px] py-[6px] text-[0.8125rem] transition-colors " +
                (role === id
                  ? "border-action bg-action text-action-ink"
                  : "border-stroke text-muted hover:text-sub")
              }
            >
              {text}
            </button>
          ))}
        </div>
      </Field>

      {role === "admin" ? (
        <p className="text-[0.8125rem] leading-[18px] text-muted">
          An administrator sees every site, so there is no membership to choose.
        </p>
      ) : (
        <MultiSelect
          label="Which sites they can see"
          options={sites.map((s) => ({ id: s.site_id, name: s.name }))}
          selected={chosen}
          onChange={setChosen}
        />
      )}
    </SidePanel>
  );
}

function SitesPanel({
  open,
  person,
  sites,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  person: Person | null;
  sites: readonly Site[];
  busy: boolean;
  onClose: () => void;
  onSave: (person: Person, next: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (open && person) setChosen([...person.sites]);
  }, [open, person]);

  return (
    <SidePanel
      open={open && person !== null}
      title={person ? `${personLabel(person)}'s sites` : "Sites"}
      onClose={onClose}
      footer={
        <>
          <PrimaryButton
            disabled={busy}
            onClick={() => person && onSave(person, chosen)}
          >
            {busy ? "Saving…" : "Save"}
          </PrimaryButton>
          <QuietButton onClick={onClose}>Cancel</QuietButton>
        </>
      }
    >
      <p className="text-[0.8125rem] leading-[18px] text-muted">
        They see the cameras at the sites you choose, and nothing else. Changes
        take effect the next time they load a screen.
      </p>
      <MultiSelect
        label="Sites"
        options={sites.map((s) => ({ id: s.site_id, name: s.name }))}
        selected={chosen}
        onChange={setChosen}
      />
    </SidePanel>
  );
}

function PasswordPanel({
  open,
  person,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  person: Person | null;
  busy: boolean;
  onClose: () => void;
  onSave: (person: Person, password: string) => void;
}) {
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (open) setPassword("");
  }, [open]);
  return (
    <SidePanel
      open={open && person !== null}
      title={person ? `Reset ${personLabel(person)}'s password` : "Reset password"}
      onClose={onClose}
      footer={
        <>
          <PrimaryButton
            disabled={busy || password.length === 0}
            onClick={() => person && onSave(person, password)}
          >
            {busy ? "Setting…" : "Set password"}
          </PrimaryButton>
          <QuietButton onClick={onClose}>Cancel</QuietButton>
        </>
      }
    >
      <p className="text-[0.8125rem] leading-[18px] text-muted">
        They are signed out everywhere and will need this new password. Tell it
        to them yourself; it is never shown again.
      </p>
      <Field label="New password" hint="At least 12 characters.">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          /* WORDS, NOT DOTS. A dotted placeholder in a password box cannot be
             told apart from a filled one; `test/passwordHints.test.mjs` is the
             rule and it caught this field with no hint at all. */
          placeholder="The password you will tell them"
          autoComplete="new-password"
        />
      </Field>
    </SidePanel>
  );
}

function RenamePanel({
  open,
  person,
  orgSlug,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  person: Person | null;
  orgSlug: string;
  busy: boolean;
  onClose: () => void;
  onSave: (person: Person, name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open && person) setName(person.name ?? "");
  }, [open, person]);
  return (
    <SidePanel
      open={open && person !== null}
      title={person ? `Fix ${personLabel(person)}'s name` : "Fix a typo"}
      onClose={onClose}
      footer={
        <>
          <PrimaryButton
            disabled={busy || name.trim().length === 0}
            onClick={() => person && onSave(person, name.trim())}
          >
            {busy ? "Saving…" : "Save name"}
          </PrimaryButton>
          <QuietButton onClick={onClose}>Cancel</QuietButton>
        </>
      }
    >
      <p className="text-[0.8125rem] leading-[18px] text-muted">
        Their LOGIN changes with the name, so tell them the new one. The audit
        log keeps both, so a year-old entry still reads as the same person.
      </p>
      <Field
        label="Name"
        hint={
          name.trim() && orgSlug
            ? `They will sign in as ${name.trim().toLowerCase()}.${orgSlug}`
            : "Lower case letters, digits and hyphens."
        }
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
    </SidePanel>
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

/**
 * The history, as sentences.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS REPLACED
 * ══════════════════════════════════════════════════════════════════════
 *
 * A four-column table of raw rows: the action verbatim (`person.create`), the
 * actor's account id, the device id, and a time. Eight filter chips, two of
 * which (Viewing, Camera control) were almost the entire table on a busy
 * fleet, so the page a customer opens to read their own history mostly said
 * `ptz.command` and an id.
 *
 * Now: four groups, one plain sentence per row with NAMES in it, times in the
 * site's own clock, newest first, and filters for a person and a date range.
 *
 * ── WHAT IS NOT SHOWN, AND WHERE IT WENT ──────────────────────────────
 *
 * Nothing. The DC records exactly what it recorded before -- every PTZ nudge,
 * every grant, every session and renewal -- and this view asks for the four
 * groups it has words for. That is a SERVER filter (`groups=`), because a page
 * that asked for 200 rows and hid the technical ones would show four sentences
 * and a lot of nothing.
 */
function AuditPane() {
  const people = usePeople();
  const [groups, setGroups] = useState<readonly string[]>(
    AUDIT_GROUPS.map((g) => g.id),
  );
  const [person, setPerson] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  /* ⚠ THE DATES ARE SITE DAYS, TURNED INTO INSTANTS HERE.
     The rows are stamped in UTC and shown in the site's own clock, so a range
     typed as "21 Oct to 21 Oct" has to mean midnight to midnight AT THE SITE.
     It used to send `2026-10-21T00:00:00Z` literally, which in Lagos starts an
     hour into the day and ends an hour into the next one: rows the page itself
     was displaying as the 21st fell outside the filter for the 21st.
     `siteDayEnd` is the first moment of the next day, so a millisecond comes
     off it to keep the range inclusive at both ends. */
  const filter = useMemo(
    () => ({
      limit: 200,
      groups,
      ...(person ? { accountId: person } : {}),
      ...(since ? { since: new Date(siteDayStart(since) * 1000).toISOString() } : {}),
      ...(until
        ? { until: new Date(siteDayEnd(until) * 1000 - 1).toISOString() }
        : {}),
    }),
    [groups.join(","), person, since, until],
  );
  const audit = useAudit(filter);
  const names = audit.value?.names ?? {};

  /* A ROW WITH NO SENTENCE IS DROPPED. The server filters to the groups; this
     is the second half of the same promise, for a row in a group whose action
     this build has no words for yet. */
  const rows = (audit.value?.entries ?? [])
    .map((e) => ({ entry: e, text: sentenceFor(e, names) }))
    .filter((r): r is { entry: AuditEntry; text: string } => r.text !== null);

  const toggle = (id: string) =>
    setGroups((cur) =>
      cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id],
    );

  return (
    <div className="flex flex-col gap-[16px]">
      <PaneHead
        title="Audit log"
        blurb="Who signed in, who changed what, and every share. Newest first, in this site's time. Kept by the server and scoped to this organization."
      />

      <div className="flex flex-col gap-[10px]">
        <div className="flex flex-wrap gap-[6px]">
          {AUDIT_GROUPS.map((g) => {
            const on = groups.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g.id)}
                className={
                  "rounded-[8px] border px-[10px] py-[4px] text-[0.75rem] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
                  /* ⚠ A CHOSEN FILTER IS NOT A PRIMARY BUTTON. All four are
                     on when the page opens, and in the action colour that is
                     four solid white pills -- louder than anything else on
                     the screen and a shout about the default state. Chosen
                     is a lit outline; the page's one primary stays the one
                     thing that acts. */
                  (on
                    ? "border-action/60 bg-action/15 text-body-ink"
                    : "border-stroke text-muted hover:text-sub")
                }
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-[10px]">
          <label className="flex flex-col gap-[4px]">
            <span className="font-display text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
              Person
            </span>
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              aria-label="Person"
              className={inputClass + " h-[34px] max-w-[220px] py-0"}
            >
              <option value="">Anyone</option>
              {(people.value?.people ?? []).map((p) => (
                <option key={p.account_id} value={p.account_id}>
                  {p.name ?? p.login}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="font-display text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
              From
            </span>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              aria-label="From"
              className={inputClass + " h-[34px] max-w-[170px] py-0"}
            />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="font-display text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
              To
            </span>
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              aria-label="To"
              className={inputClass + " h-[34px] max-w-[170px] py-0"}
            />
          </label>
          {person || since || until || groups.length !== AUDIT_GROUPS.length ? (
            <QuietButton
              onClick={() => {
                setPerson("");
                setSince("");
                setUntil("");
                setGroups(AUDIT_GROUPS.map((g) => g.id));
              }}
            >
              Clear filters
            </QuietButton>
          ) : null}
        </div>
      </div>

      {audit.loading ? (
        <Loading rows={6} label="Loading the audit log" />
      ) : audit.error ? (
        <Failed message={audit.error} onRetry={audit.reload} />
      ) : groups.length === 0 ? (
        <Empty
          title="Nothing chosen"
          why="Pick at least one of the four groups above to see what happened."
        />
      ) : rows.length === 0 ? (
        <Empty
          title="Nothing here for that filter"
          why="Sign-ins, people, sharing, and changes to sites and towers all appear here. Try widening the dates or choosing more groups."
        />
      ) : (
        <motion.ul
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="flex flex-col gap-[6px]"
        >
          {rows.map(({ entry, text }) => (
            <li
              key={entry.seq}
              data-testid="audit-row"
              className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[2px] rounded-[10px] border border-line bg-card/40 px-[14px] py-[10px]"
            >
              <span className="text-[0.8125rem] leading-[20px] text-body-ink">
                {text}
              </span>
              <span className="ml-auto whitespace-nowrap text-[0.75rem] text-muted">
                {siteStampLine(Date.parse(entry.ts))}
              </span>
            </li>
          ))}
        </motion.ul>
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
