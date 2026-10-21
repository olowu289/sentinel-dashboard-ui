/**
 * The cells in one site, and the towers in one cell.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS REPLACES, AND WHY IT MATTERED
 * ══════════════════════════════════════════════════════════════════════
 *
 * A list of `hub_kaduna_01`. The Administration area drew a site's cells as
 * their HUB IDS, because that is all `/v1/sites` carries, and an operator on
 * the phone to a site had to translate "North Camp" into an identifier nobody
 * at the site has ever seen. Every row here is now the name somebody chose.
 *
 * ── WHAT EACH ACTION ACTUALLY DOES, SAID BEFORE IT HAPPENS ─────────────
 *
 * Four of these are irreversible or have consequences off this screen, and the
 * product's rule is that a destructive thing says what it will do first:
 *
 *   move a cell      ENDS EVERY LIVE SHARE involving its cameras. The server
 *                    returns their ids; this names them afterwards, and warns
 *                    before.
 *   remove a cell    revokes the hub's key. Refused while it has towers,
 *                    because a tower whose hub has no key cannot be reached by
 *                    anybody, including whoever drives out to find out why.
 *   remove a tower   revokes its keys and KEEPS ITS RECORDINGS until normal
 *                    retention, because they may be evidence. The only
 *                    deletion in this product that leaves data behind, and the
 *                    confirm says so.
 *   rename a tower   goes through the cell, so it needs the cell reachable.
 *                    `hub_offline` means it did NOT happen, not that it is
 *                    pending.
 *
 * ── COLOUR ─────────────────────────────────────────────────────────────
 *
 * Amber for a cell that is offline or full — *this needs you*. Red only on the
 * two destructive confirms. Nothing is green: none of this is live video.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import type { ManagedCell, Site } from "@kallon/sentry-sdk";

import {
  adminMoveCell,
  adminRemoveCell,
  adminRemoveTower,
  adminRenameCell,
  adminRenameTower,
} from "@/lib/api/sites";
import { useCell } from "@/lib/useSites";
import { ENTER, FADE } from "@/lib/motion";
import {
  Failed,
  Loading,
  PrimaryButton,
  QuietButton,
  inputClass,
} from "@/components/SitesPrimitives";
import { SUPPORT_HINT, said } from "@/lib/said";

/** What a failed action should say, in words an operator can act on. */
function why(err: unknown): string {
  const e = err as { code?: string; message?: string; status?: number };
  switch (e?.code) {
    case "cell_not_empty":
    case "cell_full":
    case "site_not_empty":
    case "already_there":
      /* The server's message names the counts and the names. Nothing written
         here could be more useful than that -- as long as it reads like a
         sentence, and `said` is the one place that decides. */
      return said(err, "That cell cannot take this change.");
    case "hub_offline":
      return "That cell is offline, so this has NOT happened. Try again when it is back.";
    case "hub_timeout":
      return "That cell did not answer. Nothing was changed.";
    case "forbidden":
      return "Only an administrator can do that.";
    default:
      return said(err, `That did not work. Try it again; ${SUPPORT_HINT}.`);
  }
}

/** A confirm that says what it will do, inline, without a browser dialog. */
function Confirm({
  question,
  consequence,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  question: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex flex-col gap-[8px] rounded-[8px] border border-critical/40 bg-critical/5 p-[12px]"
      role="alertdialog"
      aria-label={question}
    >
      <p className="font-display text-[0.8125rem] text-body-ink">{question}</p>
      <p className="text-[0.75rem] leading-[16px] text-muted">{consequence}</p>
      <div className="flex gap-[8px]">
        <QuietButton danger onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </QuietButton>
        <QuietButton onClick={onCancel} disabled={busy}>
          Keep it
        </QuietButton>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * The towers in one cell
 * ------------------------------------------------------------------ */

function CellTowers({
  cell,
  onChanged,
}: {
  cell: ManagedCell;
  onChanged: () => void;
}) {
  const detail = useCell(cell.hub_id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rename = useCallback(
    async (deviceId: string) => {
      if (!renameTo.trim()) return;
      setBusy(true);
      setError(null);
      try {
        await adminRenameTower(deviceId, renameTo.trim());
        setRenaming(null);
        detail.reload();
        onChanged();
      } catch (err) {
        setError(why(err));
      } finally {
        setBusy(false);
      }
    },
    [renameTo, detail, onChanged],
  );

  const remove = useCallback(
    async (deviceId: string) => {
      setBusy(true);
      setError(null);
      try {
        await adminRemoveTower(deviceId);
        setRemoving(null);
        detail.reload();
        onChanged();
      } catch (err) {
        setError(why(err));
      } finally {
        setBusy(false);
      }
    },
    [detail, onChanged],
  );

  if (detail.loading) return <Loading rows={2} label={`Loading ${cell.name}`} />;
  if (detail.error) {
    return <Failed message={detail.error} onRetry={detail.reload} />;
  }

  const towers = detail.value?.towers ?? [];

  return (
    <div className="flex flex-col gap-[8px]">
      {towers.length === 0 ? (
        <p className="text-[0.8125rem] leading-[18px] text-muted">
          No towers on this cell yet. Add one with the code the tower printed
          when it was installed.
        </p>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {towers.map((t) => (
            <li
              key={t.device_id}
              className="flex flex-col gap-[8px] rounded-[8px] border border-line/70 bg-card/30 px-[12px] py-[8px]"
            >
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                {renaming === t.device_id ? (
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <input
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      aria-label={`New name for ${t.name}`}
                      className={inputClass + " max-w-[220px]"}
                    />
                    <PrimaryButton
                      disabled={busy}
                      onClick={() => void rename(t.device_id)}
                    >
                      Save
                    </PrimaryButton>
                    <QuietButton onClick={() => setRenaming(null)}>
                      Cancel
                    </QuietButton>
                  </div>
                ) : (
                  <span className="flex flex-col">
                    <span className="text-[0.875rem] text-body-ink">
                      {t.name}
                    </span>
                    {/* The device id, small and muted. It is what an engineer
                        needs in a log and what nobody at a site says out
                        loud, so it is present and quiet. */}
                    <span className="font-mono text-[0.6875rem] text-muted">
                      {t.device_id}
                    </span>
                  </span>
                )}
                {renaming === t.device_id ? null : (
                  <span className="flex gap-[8px]">
                    <QuietButton
                      onClick={() => {
                        setRenaming(t.device_id);
                        setRenameTo(t.name);
                      }}
                    >
                      Rename
                    </QuietButton>
                    <QuietButton danger onClick={() => setRemoving(t.device_id)}>
                      Remove
                    </QuietButton>
                  </span>
                )}
              </div>
              <AnimatePresence>
                {removing === t.device_id ? (
                  <Confirm
                    question={`Remove ${t.name}?`}
                    /* ⚠ THE SENTENCE THAT MUST COME BEFORE THE CLICK. */
                    consequence={
                      "It is unpaired and its keys are revoked, so it cannot "
                      + "reconnect. Its recordings stay until normal retention: "
                      + "they may be evidence."
                    }
                    confirmLabel="Remove it"
                    busy={busy}
                    onConfirm={() => void remove(t.device_id)}
                    onCancel={() => setRemoving(null)}
                  />
                ) : null}
              </AnimatePresence>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-[0.8125rem] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One cell
 * ------------------------------------------------------------------ */

function CellRow({
  cell,
  sites,
  onChanged,
  onAddTower,
}: {
  cell: ManagedCell;
  /** Every site in the organization, for the move list. */
  sites: readonly Site[];
  onChanged: () => void;
  onAddTower: (hubId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState(cell.name);
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<readonly string[]>([]);

  const rename = useCallback(async () => {
    if (!renameTo.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminRenameCell(cell.hub_id, renameTo.trim());
      setRenaming(false);
      onChanged();
    } catch (err) {
      setError(why(err));
    } finally {
      setBusy(false);
    }
  }, [cell.hub_id, renameTo, onChanged]);

  const move = useCallback(
    async (siteId: string) => {
      setBusy(true);
      setError(null);
      try {
        const out = await adminMoveCell(cell.hub_id, siteId);
        setMoving(false);
        setEnded(out.shares_ended);
        onChanged();
      } catch (err) {
        setError(why(err));
      } finally {
        setBusy(false);
      }
    },
    [cell.hub_id, onChanged],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await adminRemoveCell(cell.hub_id);
      setRemoving(false);
      onChanged();
    } catch (err) {
      setError(why(err));
      setRemoving(false);
    } finally {
      setBusy(false);
    }
  }, [cell.hub_id, onChanged]);

  const capacityLine =
    cell.capacity !== undefined
      ? `${cell.towers} of ${cell.capacity} towers`
      : cell.towers === 1
        ? "1 tower"
        : `${cell.towers} towers`;

  return (
    <li className="flex flex-col gap-[10px] rounded-[10px] border border-line/70 bg-card/30 p-[12px]">
      <div className="flex flex-wrap items-start justify-between gap-[8px]">
        {renaming ? (
          <div className="flex flex-wrap items-center gap-[8px]">
            <input
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              aria-label={`New name for ${cell.name}`}
              className={inputClass + " max-w-[240px]"}
            />
            <PrimaryButton disabled={busy} onClick={() => void rename()}>
              Save
            </PrimaryButton>
            <QuietButton onClick={() => setRenaming(false)}>Cancel</QuietButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex flex-col items-start text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          >
            <span className="font-display text-[0.9375rem] text-body-ink">
              {cell.name}
            </span>
            <span className="flex flex-wrap items-center gap-[8px] text-[0.75rem] text-muted">
              <span>{capacityLine}</span>
              {/* OFFLINE IS AMBER, not red: a cell being away is normal on a
                  solar site and is not a fault. FULL is amber too, because it
                  is the thing that will refuse the next add. */}
              {cell.online ? null : (
                <span className="text-detect">offline</span>
              )}
              {cell.full ? <span className="text-detect">full</span> : null}
              {!cell.full && cell.filling ? (
                <span className="text-detect">nearly full</span>
              ) : null}
              <span className="font-mono text-[0.6875rem] text-muted/70">
                {cell.hub_id}
              </span>
            </span>
          </button>
        )}
        {renaming ? null : (
          <div className="flex flex-wrap gap-[8px]">
            <QuietButton
              onClick={() => onAddTower(cell.hub_id)}
              disabled={cell.full}
            >
              Add a tower
            </QuietButton>
            <QuietButton
              onClick={() => {
                setRenaming(true);
                setRenameTo(cell.name);
              }}
            >
              Rename
            </QuietButton>
            <QuietButton onClick={() => setMoving((m) => !m)}>Move</QuietButton>
            <QuietButton danger onClick={() => setRemoving(true)}>
              Remove
            </QuietButton>
          </div>
        )}
      </div>

      <AnimatePresence>
        {moving ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={ENTER}
            className="flex flex-col gap-[8px] rounded-[8px] border border-detect/40 bg-detect-bg p-[12px]"
          >
            <p className="font-display text-[0.8125rem] text-detect">
              Move {cell.name} to another site
            </p>
            {/* ⚠ WARNED BEFORE, NAMED AFTER. */}
            <p className="text-[0.75rem] leading-[16px] text-sub/90">
              Every active share involving this cell&rsquo;s cameras ends when it
              moves. Both sides are told.
            </p>
            <div className="flex flex-wrap gap-[8px]">
              {sites
                .filter((s) => s.site_id !== cell.site_id)
                .map((s) => (
                  <QuietButton
                    key={s.site_id}
                    disabled={busy}
                    onClick={() => void move(s.site_id)}
                  >
                    {s.name}
                  </QuietButton>
                ))}
              <QuietButton onClick={() => setMoving(false)}>Cancel</QuietButton>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {removing ? (
          <Confirm
            question={`Remove ${cell.name}?`}
            consequence={
              cell.towers > 0
                ? `It still has ${capacityLine}. This will be refused: take the `
                  + "towers off first, because removing the cell revokes its "
                  + "hub's key and a tower whose hub has no key cannot be "
                  + "reached at all."
                : "Its hub's key is revoked and it leaves the site. Recordings "
                  + "already in the bucket are unaffected."
            }
            confirmLabel="Remove it"
            busy={busy}
            onConfirm={() => void remove()}
            onCancel={() => setRemoving(false)}
          />
        ) : null}
      </AnimatePresence>

      {ended.length ? (
        <p className="rounded-[8px] border border-detect/40 bg-detect-bg px-[12px] py-[8px] text-[0.75rem] leading-[16px] text-sub/90">
          {ended.length === 1
            ? "1 share ended because the cameras left the site."
            : `${ended.length} shares ended because the cameras left the site.`}{" "}
          Both sides have been told.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[0.8125rem] text-critical">
          {error}
        </p>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={FADE}
          >
            <CellTowers cell={cell} onChanged={onChanged} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * The cells in one site
 * ------------------------------------------------------------------ */

export function SiteCells({
  site,
  cells,
  sites,
  onChanged,
  onAddCell,
  onAddTower,
}: {
  site: Site;
  /** Every cell this caller can see; filtered to this site here. */
  cells: readonly ManagedCell[];
  sites: readonly Site[];
  onChanged: () => void;
  onAddCell: (siteId: string) => void;
  onAddTower: (hubId: string) => void;
}) {
  const mine = cells.filter((c) => c.site_id === site.site_id);
  return (
    <div className="flex flex-col gap-[10px]">
      {mine.length === 0 ? (
        <p className="text-[0.8125rem] leading-[18px] text-muted">
          No cells here yet. A cell is one hub and the towers on it.
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {mine.map((cell) => (
            <CellRow
              key={cell.hub_id}
              cell={cell}
              sites={sites}
              onChanged={onChanged}
              onAddTower={onAddTower}
            />
          ))}
        </ul>
      )}
      <div>
        <QuietButton onClick={() => onAddCell(site.site_id)}>
          Add a cell
        </QuietButton>
      </div>
    </div>
  );
}
