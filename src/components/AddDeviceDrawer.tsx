/**
 * Add a cell or a tower, without leaving the page you were on.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY A DRAWER AND NOT A PAGE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Because of where this is used from. Somebody adding a mast is standing at a
 * mast, or on the phone to somebody who is, reading a code off a console. The
 * list behind them is the thing that tells them whether it worked. A wizard
 * that replaced that list would make them navigate back to find out, and the
 * last state of this flow is a sentence worth reading — "waiting for the
 * tower", "that cell is offline, it will be added when it reconnects".
 *
 * So the list stays visible behind it, closing returns to exactly where they
 * were, and nothing here navigates.
 *
 * ── THE FIVE OUTCOMES, AND WHY EACH IS ITS OWN SENTENCE ────────────────
 *
 * This flow fails in ways that are not the user's fault and not fixable by
 * trying again, so each one says what to DO:
 *
 *   waiting         the claim is open; the device has N minutes to appear
 *   queued          THE CELL IS OFFLINE. Nothing was sent. It will be, and the
 *                   window starts then, so there is nothing to redo
 *   wrong code      no device is waiting behind that code
 *   expired         the fifteen minutes closed. Re-enter it
 *   cell full       refused here, before the code went anywhere, so nobody
 *                   drives out to find out
 *
 * ⚠ AND ONE THING IT SAYS UNPROMPTED: nothing in this flow configures a radio.
 * Radios are set up before a hub ships. Without that line, somebody adds a
 * tower, sees "waiting", and waits for a link that was never going to come up.
 *
 * ── COLOUR ─────────────────────────────────────────────────────────────
 *
 * None of its own. Amber for the two states that need a person (`queued`,
 * every error), white for the rest. Green means live and this screen has
 * nothing live on it.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ManagedCell, Site } from "@kallon/sentry-sdk";

import { addCell, addTower } from "@/lib/api/sites";
import { ENTER, EXIT, FADE } from "@/lib/motion";
import {
  Field,
  PrimaryButton,
  QuietButton,
  inputClass,
} from "@/components/SitesPrimitives";

export type AddWhat = "cell" | "tower";

/** What the drawer is showing. One of these at a time, and never two. */
type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  /** The claim is open. `until` is when the window closes, if there is one. */
  | { kind: "waiting"; name: string; until?: string; what: AddWhat }
  /** The cell was offline. Nothing was sent, and nothing needs redoing. */
  | { kind: "queued"; name: string; message: string }
  | { kind: "failed"; code: string; message: string };

/** The errors the server can answer with, in words for the person reading them. */
function humanError(code: string, message: string): string {
  switch (code) {
    case "claim_refused":
    case "invalid_request":
      /* The server's own message is better than anything here: it names the
         field and the rule. */
      return message;
    case "claim_conflict":
      return "Another account is already waiting for that code. If that was "
        + "you on another screen, finish there; if not, the code is not yours "
        + "to use.";
    case "cell_full":
      return message;
    case "hub_offline":
      return "That cell is offline, so nothing could be sent to it.";
    case "hub_timeout":
      return "That cell did not answer in time. Nothing was sent. Try again in "
        + "a moment.";
    case "cell_unknown":
      return "That cell is not one you can add to.";
    case "site_unknown":
      return "That site is not one you can add to.";
    case "no_pairing_code":
      return message;
    default:
      return message || "That did not work, and the server did not say why.";
  }
}

function minutesLeft(until?: string): string | null {
  if (!until) return null;
  const ms = Date.parse(until) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.ceil(ms / 60000);
  return mins === 1 ? "1 minute" : `${mins} minutes`;
}

export function AddDeviceDrawer({
  open,
  what,
  sites,
  cells,
  /** Pre-selected when the drawer is opened from inside a site or a cell. */
  siteId,
  hubId,
  onClose,
  onAdded,
}: {
  open: boolean;
  what: AddWhat;
  /** The sites this caller may add to. A site user sees only their own. */
  sites: readonly Site[];
  /** The cells this caller may add a tower to. */
  cells: readonly ManagedCell[];
  siteId?: string;
  hubId?: string;
  onClose: () => void;
  /** Called once the server has accepted it, so a list can refresh. */
  onAdded: () => void;
}) {
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [site, setSite] = useState(siteId ?? "");
  const [cell, setCell] = useState(hubId ?? "");
  const firstField = useRef<HTMLInputElement | null>(null);

  /* Reset on open, not on close: a drawer that cleared itself as it animated
     out flashes empty on the way. */
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "form" });
    setName("");
    setCode("");
    setSite(siteId ?? (sites.length === 1 ? sites[0].site_id : ""));
    setCell(hubId ?? (cells.length === 1 ? cells[0].hub_id : ""));
    /* Focus the first field, after the frame that mounts it. */
    const t = window.setTimeout(() => firstField.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, what, siteId, hubId, sites, cells]);

  /* ESCAPE CLOSES IT, which is the other half of "never loses your place": a
     drawer you cannot dismiss with the keyboard is a modal with extra steps. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const chosenCell = useMemo(
    () => cells.find((c) => c.hub_id === cell) ?? null,
    [cells, cell],
  );

  const ready =
    name.trim().length > 0 &&
    code.trim().length > 0 &&
    (what === "cell" ? site.length > 0 : cell.length > 0);

  const submit = useCallback(async () => {
    if (!ready) return;
    setPhase({ kind: "sending" });
    try {
      const out =
        what === "cell"
          ? await addCell({ siteId: site, name: name.trim(), pairingCode: code })
          : await addTower({ hubId: cell, name: name.trim(), pairingCode: code });
      onAdded();
      if (out.pending.queued) {
        setPhase({
          kind: "queued",
          name: out.pending.name ?? name.trim(),
          message:
            out.pending.message ??
            "That cell is offline. It will be added when it reconnects.",
        });
        return;
      }
      setPhase({
        kind: "waiting",
        name: out.pending.name ?? name.trim(),
        ...(out.pending.expires_at ? { until: out.pending.expires_at } : {}),
        what,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setPhase({
        kind: "failed",
        code: String(e.code ?? ""),
        message: humanError(String(e.code ?? ""), String(e.message ?? "")),
      });
    }
  }, [ready, what, site, cell, name, code, onAdded]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          {/* The page behind stays readable: this dims it rather than hiding
              it, because the list behind is what says whether it worked. */}
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="fixed inset-0 z-40 cursor-default bg-ink/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[min(26rem,100vw)] flex-col gap-[20px] overflow-y-auto border-l border-stroke bg-panel p-[20px] sm:p-[24px]"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            /* The exit transition rides on the exit target, not on
               `transition`: motion's Transition type has no `exit` key, and
               putting one there typechecks nowhere and silently does nothing. */
            exit={{ x: 24, opacity: 0, transition: EXIT }}
            transition={ENTER}
          >
            <div className="flex items-start justify-between gap-[12px]">
              <h2
                id={titleId}
                className="font-display text-[1rem] tracking-[0.2px] text-body-ink"
              >
                {what === "cell" ? "Add a cell" : "Add a tower"}
              </h2>
              <QuietButton onClick={onClose}>Close</QuietButton>
            </div>

            {phase.kind === "form" || phase.kind === "sending" ? (
              /* ⚠ NOT A <form>, AND THAT IS AN APP-WIDE RULE, not a style.
                 Chrome's "save password?" prompt hangs off a form submission,
                 this app has never had one, and test/passwordHints.test.mjs
                 asserts it stays that way — it caught this component. Enter is
                 bound explicitly instead, which is what every other screen
                 here does. */
              <div
                className="flex flex-col gap-[16px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              >
                <p className="text-[0.8125rem] leading-[18px] text-muted">
                  {what === "cell"
                    ? "A cell is one hub and the towers on it. Enter the code the hub printed when it was installed."
                    : "Enter the code the tower printed when it was installed. It joins the cell you choose."}
                </p>

                {what === "cell" ? (
                  <Field
                    label="Site"
                    hint={
                      sites.length === 0
                        ? "You are not a member of any site, so there is nowhere to add one."
                        : undefined
                    }
                  >
                    <select
                      className={inputClass}
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                      disabled={sites.length === 0}
                    >
                      <option value="">Choose a site</option>
                      {sites.map((s) => (
                        <option key={s.site_id} value={s.site_id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field
                    label="Cell"
                    hint={
                      chosenCell
                        ? chosenCell.full
                          ? `${chosenCell.name} is full.`
                          : chosenCell.capacity !== undefined
                            ? `${chosenCell.towers} of ${chosenCell.capacity} towers.`
                            : `${chosenCell.towers} tower(s).`
                        : cells.length === 0
                          ? "There are no cells you can add a tower to yet. Add a cell first."
                          : undefined
                    }
                  >
                    <select
                      className={inputClass}
                      value={cell}
                      onChange={(e) => setCell(e.target.value)}
                      disabled={cells.length === 0}
                    >
                      <option value="">Choose a cell</option>
                      {cells.map((c) => (
                        <option key={c.hub_id} value={c.hub_id} disabled={c.full}>
                          {c.name}
                          {c.site_name ? ` — ${c.site_name}` : ""}
                          {c.full ? " (full)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field
                  label="Name"
                  hint={
                    what === "cell"
                      ? "What people at the site call it. “North Camp”."
                      : "What people at the site call this mast. “North Gate”."
                  }
                >
                  <input
                    ref={firstField}
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={what === "cell" ? "North Camp" : "North Gate"}
                    autoComplete="off"
                  />
                </Field>

                <Field
                  label="Pairing code"
                  hint="Dashes and capitals do not matter."
                >
                  <input
                    className={inputClass + " font-mono tracking-[1px]"}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>

                {/* ⚠ SAID UNPROMPTED. Without it somebody adds a tower, sees
                    "waiting", and waits for a radio link nobody configured. */}
                <p className="rounded-[8px] border border-stroke bg-ink/40 px-[12px] py-[10px] text-[0.75rem] leading-[16px] text-muted">
                  This does not configure a radio. Radios are set up before the
                  equipment ships; everything else on the board is set up for
                  you.
                </p>

                <div className="flex items-center gap-[10px]">
                  <PrimaryButton
                    onClick={() => void submit()}
                    disabled={!ready || phase.kind === "sending"}
                  >
                    {phase.kind === "sending" ? "Adding…" : "Add"}
                  </PrimaryButton>
                  <QuietButton onClick={onClose}>Cancel</QuietButton>
                </div>
              </div>
            ) : null}

            {phase.kind === "waiting" ? (
              <motion.div
                className="flex flex-col gap-[12px]"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={ENTER}
              >
                <p className="font-display text-[0.9375rem] text-body-ink">
                  Waiting for {phase.name}
                </p>
                <p className="text-[0.8125rem] leading-[18px] text-muted">
                  {phase.what === "cell"
                    ? "Power the hub on and connect it. It will appear here when it joins."
                    : "Power the tower on. It will appear in the cell when it joins."}
                  {minutesLeft(phase.until)
                    ? ` The code is good for another ${minutesLeft(phase.until)}.`
                    : ""}
                </p>
                <div className="flex items-center gap-[10px]">
                  <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                  <QuietButton onClick={() => setPhase({ kind: "form" })}>
                    Add another
                  </QuietButton>
                </div>
              </motion.div>
            ) : null}

            {phase.kind === "queued" ? (
              <motion.div
                className="flex flex-col gap-[12px]"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={ENTER}
              >
                {/* Amber: *this needs you*, eventually. Not a fault — nothing
                    went wrong and nothing has to be redone. */}
                <p className="font-display text-[0.9375rem] text-detect">
                  {phase.name} is queued
                </p>
                <p className="text-[0.8125rem] leading-[18px] text-muted">
                  {phase.message}
                </p>
                <p className="text-[0.75rem] leading-[16px] text-muted/80">
                  There is nothing to redo. The code has not been used, and its
                  fifteen minutes start when the cell receives it.
                </p>
                <div className="flex items-center gap-[10px]">
                  <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                  <QuietButton onClick={() => setPhase({ kind: "form" })}>
                    Add another
                  </QuietButton>
                </div>
              </motion.div>
            ) : null}

            {phase.kind === "failed" ? (
              <motion.div
                className="flex flex-col gap-[12px]"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={ENTER}
                role="alert"
              >
                <p className="font-display text-[0.9375rem] text-detect">
                  Not added
                </p>
                <p className="text-[0.8125rem] leading-[18px] text-muted">
                  {phase.message}
                </p>
                <div className="flex items-center gap-[10px]">
                  <PrimaryButton onClick={() => setPhase({ kind: "form" })}>
                    Try again
                  </PrimaryButton>
                  <QuietButton onClick={onClose}>Close</QuietButton>
                </div>
              </motion.div>
            ) : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
