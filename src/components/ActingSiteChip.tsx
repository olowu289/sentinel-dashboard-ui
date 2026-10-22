/**
 * Which site you are, in the chrome, on every screen that has a header.
 *
 * ⚠ A SITE USER COULD NOT TELL WHICH SITE THEY WERE IN. That sounds
 * cosmetic until you watch somebody share something: every share is BETWEEN
 * two sites, so "who is asking" is half of what a request means, and a person
 * in two sites had no way to say which one they were acting for at all.
 *
 * ── WHAT IT SHOWS, AND TO WHOM ────────────────────────────────────────
 *
 *   one site      the name, flat. Nothing to choose, so nothing to click
 *   several       a button that opens the list, with the current one marked
 *   an ADMIN      "Every site", because an admin is in none of them by
 *                 membership and sees all of them. Their acting site is
 *                 chosen per share, on the Sharing page, where the choice has
 *                 a consequence -- putting it in permanent chrome would make
 *                 it look like a filter on what they can see, which it is not
 *   no site       nothing at all. A person in no site has no site to be
 *
 * It is NOT a filter. Nothing on any wall changes when it changes; the only
 * thing that reads it is a share being started. Making that obvious is why it
 * says "Acting as" rather than showing a bare name beside a chevron.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ENTER } from "@/lib/motion";
import { useActingSite } from "@/lib/useActingSite";

export function ActingSiteChip({ className = "" }: { className?: string }) {
  const acting = useActingSite();
  const [open, setOpen] = useState(false);

  if (acting.loading) return null;
  if (acting.isAdmin) {
    return (
      <span
        className={`shrink-0 font-display text-[0.6875rem] uppercase tracking-[0.11px] text-muted ${className}`}
        title="An administrator sees every site. Which site you act for is chosen per share."
      >
        {/* ⚠ "EVERY SITE", THE SAME TWO WORDS AS EVERYWHERE ELSE. This
            said "All sites", which is also what the first migration called a
            SITE, so one phrase meant a place on one screen and "all of them"
            on another. */}
        Every site
      </span>
    );
  }
  if (acting.candidates.length === 0) return null;

  if (acting.candidates.length === 1) {
    return (
      <span
        className={`flex shrink-0 items-center gap-[6px] ${className}`}
        title="The site you are in. Shares you start are from here."
      >
        <span className="size-[5px] rounded-full bg-notify-share" aria-hidden />
        <span className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-sub">
          {acting.site?.name}
        </span>
      </span>
    );
  }

  return (
    <div className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] transition-colors hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <span className="size-[5px] rounded-full bg-notify-share" aria-hidden />
        <span className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-sub">
          {acting.site?.name ?? "Choose a site"}
        </span>
        <img src="/icons/chevron-right.svg" alt="" width={12} height={12}
             className="rotate-90 opacity-60" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.ul
            role="listbox"
            aria-label="Acting as"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={ENTER}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            className="chip-blur absolute right-0 top-[28px] z-40 min-w-[160px] overflow-hidden rounded-[8px] border border-line-panel bg-panel/95 py-[4px]"
          >
            {acting.candidates.map((s) => (
              <li key={s.site_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.site_id === acting.site?.site_id}
                  onClick={() => {
                    acting.choose(s.site_id);
                    setOpen(false);
                  }}
                  className={`block w-full px-[10px] py-[6px] text-left text-[0.8125rem] transition-colors hover:bg-card-hover ${
                    s.site_id === acting.site?.site_id ? "text-body-ink" : "text-sub"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
            <li className="border-t border-row-line px-[10px] pb-[2px] pt-[6px]">
              <span className="text-[0.6875rem] leading-[14px] text-muted">
                Only affects shares you start. Your cameras do not change.
              </span>
            </li>
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
