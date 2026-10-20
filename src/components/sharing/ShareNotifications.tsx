/**
 * Share requests, offers and endings, as cards over the video.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  NOBODY LEAVES THE FEED
 * ══════════════════════════════════════════════════════════════════════
 *
 * Everything an operator can do about a share, they can do from here: read who
 * is asking and why, choose which of their towers to lend, turn controls and
 * playback on or off, set how long, accept, or decline -- while the camera
 * they are deciding about keeps playing behind the card.
 *
 * ── THE X HAS AN UNDO, AND THAT IS NOT POLITENESS ─────────────────────
 *
 * Declining is one click, next to a close button, on a card that appeared
 * while somebody was watching something else. A misclick that cannot be taken
 * back means telling another site "no" by accident and never knowing. So the
 * decline is HELD for a few seconds, shown as a countdown with an Undo, and
 * only then sent. Nothing reaches the server until the window passes.
 *
 * ── WHAT RAISES A CARD ────────────────────────────────────────────────
 *
 * `ShareDeck` watches the one share feed and nothing else. A change between
 * two polls becomes a card; the FIRST poll raises nothing, because signing in
 * with four pending requests from last week must not throw four cards over the
 * video. Those are on the Sharing page, where somebody went looking.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { isAdminRole, type Share } from "@kallon/sentry-sdk";
import { useSession } from "@/components/AuthProvider";
import { ENTER, FADE } from "@/lib/motion";
import {
  ACTIONABLE_TTL_MS,
  timeLeftLabel,
  useNotifications,
} from "@/lib/notifications";
import {
  otherSiteName,
  scopeSummary,
  useShareFeed,
} from "@/lib/useShareFeed";
import { useSiteTowers } from "@/lib/useSiteTowers";
import {
  ShareDecision,
  decisionToChoices,
  initialDecision,
  type DecisionState,
} from "./ShareControls";

/** How long a decline is held, in milliseconds, before it is sent. */
export const UNDO_MS = 6000;

/* ------------------------------------------------------------------ *
 * The card bodies
 * ------------------------------------------------------------------ */

function Quote({ text }: { text: string }) {
  return (
    /* What a person typed, rendered as what a person typed: their words, not
       a field value. The rule matters most on a request, where this is the
       only thing the reader has to decide on. */
    <p className="whitespace-pre-wrap border-l-2 border-notify-share/40 pl-[8px] text-[0.8125rem] leading-[18px] text-body-ink">
      {text}
    </p>
  );
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="mt-[10px] flex items-center gap-[8px]">{children}</div>;
}

function Accept({
  onClick,
  busy,
  label = "Accept",
}: {
  onClick: () => void;
  busy?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-[6px] bg-notify-share px-[12px] py-[6px] font-display text-[0.75rem] tracking-[0.12px] text-notify-share-ink transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-notify-share"
    >
      {busy ? "..." : label}
    </button>
  );
}

function Quiet({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[6px] border border-stroke px-[10px] py-[5px] text-[0.75rem] text-muted transition-colors hover:text-body-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      {children}
    </button>
  );
}

/**
 * A request or an offer, waiting for this operator.
 *
 * Collapsed it is a sentence and three buttons. Expanded it is the whole
 * decision, inline -- the same `ShareDecision` the Sharing page mounts, so the
 * two can never offer different choices.
 */
export function PendingCard({
  share,
  onDone,
  initialOpen = false,
}: {
  share: Share;
  onDone: () => void;
  /** The screenshot harness, which has to photograph the expanded state. */
  initialOpen?: boolean;
}) {
  const feed = useShareFeed();
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DecisionState>(() => initialDecision(share));
  /* The decline, held. `null` means nothing is pending. */
  const [undoLeft, setUndoLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* The towers are MINE: this is a request to lend my site's cameras, so the
     list is the site that owns the share, which is one of mine. */
  const towers = useSiteTowers(open ? share.owner_site_id : null);

  const isRequest = share.direction === "request";
  const who = otherSiteName(share);
  /* DEFENCE IN DEPTH, AND NOTHING MORE. The deck only raises this card when
     the server says this account may answer, so this should always be true --
     but a card that outlives the share it is about (somebody else answered
     while it sat there) must not offer buttons the server will refuse. */
  const mayAnswer = share.can_answer === true;

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const send = useCallback(
    async (what: "accept" | "decline") => {
      setBusy(true);
      setError(null);
      try {
        if (what === "accept") await feed.accept(share.share_id, decisionToChoices(state));
        else await feed.decline(share.share_id);
        onDone();
      } catch (err) {
        setError((err as { message?: string })?.message ?? "That did not go through.");
        setBusy(false);
      }
    },
    [feed, onDone, share.share_id, state],
  );

  const startDecline = () => {
    setUndoLeft(Math.round(UNDO_MS / 1000));
    timer.current = setInterval(() => {
      setUndoLeft((left) => {
        if (left === null) return null;
        if (left <= 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          void send("decline");
          return null;
        }
        return left - 1;
      });
    }, 1000);
  };

  const cancelDecline = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setUndoLeft(null);
  };

  if (undoLeft !== null) {
    return (
      <div>
        <p className="text-[0.8125rem] leading-[18px] text-body-ink">
          Declining {who}.
        </p>
        <Buttons>
          <Accept onClick={cancelDecline} label={`Undo (${undoLeft})`} />
          {/* Nothing has been sent yet: this only stops the waiting. */}
          <Quiet
            onClick={() => {
              cancelDecline();
              void send("decline");
            }}
          >
            Decline now
          </Quiet>
        </Buttons>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[0.8125rem] leading-[18px] text-body-ink">
        <span className="font-display">{who}</span>{" "}
        {isRequest ? "would like to see your cameras." : "is offering you cameras."}
      </p>
      {share.message ? (
        <div className="mt-[8px]">
          <Quote text={share.message} />
        </div>
      ) : null}
      {!isRequest ? (
        <p className="mt-[6px] text-[0.75rem] text-muted">
          {scopeSummary(share.scope)}
          {share.ptz ? " · controls" : ""}
          {share.playback ? " · playback" : ""}
        </p>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={ENTER}
            className="overflow-hidden"
          >
            <div className="mt-[10px] border-t border-notify-share-line pt-[10px]">
              <ShareDecision
                compact
                share={share}
                towers={towers.towers}
                loadingTowers={towers.loading}
                state={state}
                onChange={setState}
              />
              {towers.error ? (
                <p className="mt-[6px] text-[0.75rem] text-critical">{towers.error}</p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error ? (
        <p className="mt-[8px] text-[0.75rem] text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <Buttons>
        {!mayAnswer ? (
          <>
            <p className="text-[0.75rem] leading-[16px] text-muted">
              Somebody at {share.direction === "request"
                ? share.owner_site_name
                : share.viewer_site_name}{" "}
              answers this.
            </p>
            <Quiet onClick={onDone}>Close</Quiet>
          </>
        ) : (
          <>
            {open ? (
              <Accept
                onClick={() => void send("accept")}
                busy={busy}
                label={state.scope.length === 0 ? "Choose towers" : "Accept"}
              />
            ) : (
              <Accept onClick={() => setOpen(true)} label="Choose and accept" />
            )}
            <Quiet onClick={startDecline}>Decline</Quiet>
            {open ? <Quiet onClick={() => setOpen(false)}>Collapse</Quiet> : null}
          </>
        )}
      </Buttons>
    </div>
  );
}

/** My request was accepted: say so, and offer the one thing wanted next. */
export function AcceptedCard({
  share,
  onWatch,
  onDone,
}: {
  share: Share;
  onWatch?: (deviceId: string) => void;
  onDone: () => void;
}) {
  const first = share.scope[0]?.device_id;
  return (
    <div>
      <p className="text-[0.8125rem] leading-[18px] text-body-ink">
        <span className="font-display">{share.owner_site_name}</span> accepted.{" "}
        {scopeSummary(share.scope)}.
      </p>
      <p className="mt-[4px] text-[0.75rem] text-muted">
        {share.ptz ? "Controls included. " : ""}
        {timeLeftLabel(share.expires_at)
          ? `${timeLeftLabel(share.expires_at)} left.`
          : "Expired."}
      </p>
      <Buttons>
        {first && onWatch ? (
          <Accept
            onClick={() => {
              onWatch(first);
              onDone();
            }}
            label="Watch now"
          />
        ) : null}
        <Quiet onClick={onDone}>Close</Quiet>
      </Buttons>
    </div>
  );
}

/** A statement: declined, revoked, expired. Nothing to answer. */
export function EndedCard({ text, onDone }: { text: string; onDone: () => void }) {
  return (
    <div>
      <p className="text-[0.8125rem] leading-[18px] text-body-ink">{text}</p>
      <Buttons>
        <Quiet onClick={onDone}>Close</Quiet>
      </Buttons>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The deck: what turns a change in the feed into a card
 * ------------------------------------------------------------------ */

const shareCardId = (share: Share) => `share:${share.share_id}`;

export function ShareDeck({ onWatch }: { onWatch?: (deviceId: string) => void }) {
  const feed = useShareFeed();
  const { notify, dismiss, resolve } = useNotifications();
  const { account } = useSession();
  /* ── AN ADMINISTRATOR GETS NO CARDS AT ALL ─────────────────────────────

     Not "fewer cards": none. An admin is in every site, so every share in the
     organization looked like one of theirs to answer -- and one of them did
     answer a request they had sent themselves, on behalf of a site, without
     anybody at that site seeing it.

     Administration sees every share on the Sharing page and in the audit log,
     and can END any of them. It does not agree to things on a site's behalf,
     so there is nothing here for it to be interrupted about. */
  const isAdmin = isAdminRole(account?.role);
  /* The first poll is the state of the world, not news about it. */
  const seeded = useRef(false);

  useEffect(
    () =>
      feed.subscribe((next, prev) => {
        if (isAdmin) return;
        if (!seeded.current) {
          seeded.current = true;
          return;
        }
        const before = new Map(prev.map((s) => [s.share_id, s]));

        for (const share of next) {
          const was = before.get(share.share_id);
          const id = shareCardId(share);

          /* NEW AND WAITING FOR ME. `can_answer` is the SERVER's answer and
             the only thing this gates on.

             ⚠ IT USED TO BE `share.incoming`, which is a fact about SITES:
             true for an admin (in every site), and true for the OWNER of an
             offer -- who is the side that SENT it. That one word put every
             offer's card back in front of the person who made it.

             Persistent: a question that fades is a question answered by
             whoever was looking elsewhere. */
          if (share.status === "pending" && share.can_answer && !was) {
            notify({
              id,
              kind: "share",
              at: Date.parse(share.created_at) || Date.now(),
              persistent: true,
              title:
                share.direction === "request"
                  ? `${otherSiteName(share)} is asking`
                  : `${otherSiteName(share)} is offering`,
              render: ({ dismiss: close }) => (
                <PendingCard share={share} onDone={close} />
              ),
            });
            continue;
          }

          /* IT STOPPED BEING PENDING. The question is gone either way, so the
             card goes with it; if it was MY question, what happened to it is
             worth one short statement. */
          if (was?.status === "pending" && share.status !== "pending") {
            dismiss(id, "resolved");
            /* THE ANSWER GOES BACK TO THE SIDE THAT ASKED, which is the side
               that could not answer it. `was.can_answer` is false for them by
               definition, and true for the people who just decided -- who do
               not need telling what they have this second done. */
            const iAsked = was.can_answer === false;
            if (iAsked && share.status === "active") {
              notify({
                id: `${id}:accepted`,
                kind: "share",
                at: Date.now(),
                /* It carries a Watch now, so it waits to be used rather than
                   to be read. See ACTIONABLE_TTL_MS. */
                ttlMs: ACTIONABLE_TTL_MS,
                title: `${share.owner_site_name} accepted`,
                render: ({ dismiss: close }) => (
                  <AcceptedCard share={share} onWatch={onWatch} onDone={close} />
                ),
              });
            } else if (iAsked && share.status === "declined") {
              notify({
                id: `${id}:declined`,
                kind: "system",
                at: Date.now(),
                title: `${share.owner_site_name} declined`,
                render: ({ dismiss: close }) => (
                  <EndedCard
                    text={`${share.owner_site_name} declined your request. You can ask again.`}
                    onDone={close}
                  />
                ),
              });
            }
            continue;
          }

          /* IT ENDED. Both sides are told, because both sides lose something:
             one loses the view, the other stops lending a camera. */
          if (
            was &&
            was.status === "active" &&
            (share.status === "expired" || share.status === "revoked")
          ) {
            const ended =
              share.status === "revoked"
                ? `${share.owner_site_name} ended the share`
                : `The share with ${otherSiteName(share)} ran out`;
            notify({
              id: `${id}:ended`,
              kind: "system",
              at: Date.now(),
              title: ended,
              render: ({ dismiss: close }) => (
                <EndedCard
                  text={`${ended}. ${
                    share.incoming
                      ? "Their access stopped straight away."
                      : "Those cameras are no longer on your board."
                  }`}
                  onDone={close}
                />
              ),
            });
          }
        }

        /* A share that vanished from the list entirely takes its card away.
           Nothing should be left asking about something that is not there. */
        const ids = new Set(next.map((s) => shareCardId(s)));
        resolve((n) => n.id.startsWith("share:") && !ids.has(n.id.split(":").slice(0, 2).join(":")));
      }),
    [feed, notify, dismiss, resolve, onWatch, isAdmin],
  );

  return null;
}

/**
 * The strip a shared feed carries: whose it is, and how long is left.
 *
 * ⚠ ALWAYS, AND NOT ONLY WHEN IT IS ABOUT TO RUN OUT. An operator looking at
 * a camera is entitled to know it is not theirs -- it changes what they do
 * with what they see, and it explains why the controls may be refused.
 */
export function SharedFeedBadge({ share }: { share: Share }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = timeLeftLabel(share.expires_at);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="chip-blur pointer-events-none flex items-center gap-[6px] rounded-[4px] border border-notify-share-line bg-notify-share-wash/80 px-[8px] py-[3px]"
    >
      <span className="size-[5px] rounded-full bg-notify-share" aria-hidden />
      <span className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-notify-share">
        {share.owner_site_name}
      </span>
      <span className="text-[0.6875rem] tabular-nums text-muted">
        {left ? `${left} left` : "ended"}
      </span>
    </motion.div>
  );
}
