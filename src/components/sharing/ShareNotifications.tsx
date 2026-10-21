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
import { said } from "@/lib/said";
import { isAdminNotice } from "@/lib/shareRules";
import {
  otherSiteName,
  scopeSummary,
  useShareFeed,
} from "@/lib/useShareFeed";
import { sayDuration } from "@/lib/durations";
import { useWatch } from "@/lib/watch";
import { useSiteTowers } from "@/lib/useSiteTowers";
import {
  OfferTerms,
  ShareDecision,
  acceptOffer,
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

  const isRequest = share.direction === "request";
  /* ⚠ ONLY FOR A REQUEST, AND THE OLD COMMENT HERE SAID WHY IT WAS SAFE.
     It read "the towers are MINE: this is a request to lend my site's
     cameras", which is true of a request and false of an offer -- and this
     card draws both. For an offer the owner site is THEIRS, the receiver is
     not a member of it, and `GET /v1/sites/{id}` answers 404 "no such site" to
     them by design. The card printed that in red beside an empty picker
     saying "They named no towers", directly under a line that had correctly
     summarised the scope: three statements about one share, two of them
     wrong, from a request that should never have been sent.

     An offer needs no towers at all. It arrives complete and `OfferTerms`
     renders it from `share.scope`, which is already on the wire. */
  const towers = useSiteTowers(open && isRequest ? share.owner_site_id : null);
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
        if (what === "accept") {
          /* AN OFFER IS ACCEPTED AS SENT. Sending the form's state would be
             sending terms the receiver did not choose and the server does not
             accept -- it refuses a body that would change an offer. */
          await feed.accept(
            share.share_id,
            isRequest ? decisionToChoices(state) : acceptOffer(),
          );
        } else await feed.decline(share.share_id);
        onDone();
      } catch (err) {
        setError(said(err, "That answer did not go through."));
        setBusy(false);
      }
    },
    [feed, isRequest, onDone, share.share_id, state],
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
        {/* ⚠ AN ADMIN SHARE DID NOT COME FROM THE OTHER SITE, and saying
            "North Gate is offering you cameras" about one would be putting
            words in their mouth: they were not asked either. */}
        {share.by_admin ? (
          <>
            Cameras at <span className="font-display">{who}</span> are being
            shared with you.
          </>
        ) : (
          <>
            <span className="font-display">{who}</span>{" "}
            {isRequest
              ? "would like to see your cameras."
              : "is offering you cameras."}
          </>
        )}
      </p>
      {share.by_admin ? (
        <p className="mt-[4px] font-display text-[0.6875rem] uppercase tracking-[0.11px] text-notify-share">
          By the administrator
        </p>
      ) : null}
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
          {share.asked_duration_sec
            ? ` · ${sayDuration(share.asked_duration_sec)}`
            : ""}
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
              {isRequest ? (
                <>
                  <ShareDecision
                    compact
                    share={share}
                    towers={towers.towers}
                    loadingTowers={towers.loading}
                    state={state}
                    onChange={setState}
                  />
                  {towers.error ? (
                    <p className="mt-[6px] text-[0.75rem] text-critical">
                      {towers.error}
                    </p>
                  ) : null}
                </>
              ) : (
                /* An offer, in full, with nothing to set. The receiver's only
                   two answers are the buttons below. */
                <OfferTerms share={share} />
              )}
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
                /* ⚠ THE LABEL IS THE STATE OF THE FORM, and an offer has
                   no form: it can always be accepted, because accepting it is
                   agreeing to what it already says. */
                label={
                  !isRequest
                    ? "Accept"
                    : state.scope.length === 0
                      ? "Choose towers"
                      : state.durationSec <= 0
                        ? "Choose how long"
                        : "Accept"
                }
              />
            ) : (
              <Accept
                onClick={() => setOpen(true)}
                label={isRequest ? "Choose and accept" : "See what is offered"}
              />
            )}
            <Quiet onClick={startDecline}>Decline</Quiet>
            {open ? <Quiet onClick={() => setOpen(false)}>Collapse</Quiet> : null}
          </>
        )}
      </Buttons>
    </div>
  );
}

/**
 * My request was accepted: say so, and offer the one thing wanted next.
 *
 * ⚠ WATCH GOES THROUGH `useWatch`, NOT THROUGH A PROP. It used to take an
 * `onWatch` the shell passed down, which navigated straight to the tower --
 * and on the real fleet the tower was not in the client's copy of it yet,
 * because the fleet is read on mount and this card appears when a share lands.
 * The operator got "this tower is not on your fleet any more" about a camera
 * that had just been granted. `useWatch` re-reads the fleet first. See
 * lib/watch.tsx.
 */
export function AcceptedCard({
  share,
  onDone,
}: {
  share: Share;
  onDone: () => void;
}) {
  const { watch, ready } = useWatch();
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
        {first && ready ? (
          <Accept
            onClick={() => {
              void watch(first);
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

/**
 * Your cameras were shared by the administrator. Nothing to answer.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS CARD HAS NO BUTTONS
 * ══════════════════════════════════════════════════════════════════════
 *
 * An administrator sharing one site's cameras with another does not ask the
 * owning site. It never agreed, so it has nothing to withdraw: it cannot
 * accept, decline, end or extend this, and the server refuses all four.
 *
 * That is a real transfer of authority and the card does not pretend
 * otherwise. It says what was shared, with whom, for how long, and that the
 * administrator did it. A Close, because it is a statement, and the statement
 * stays in Sharing > History and in the audit log with a name on it.
 *
 * ⚠ NO "END NOW" EVEN GREYED OUT. A disabled button is a promise that
 * something could be allowed, and this one never will be for this site.
 */
export function AdminNoticeCard({
  share,
  onDone,
}: {
  share: Share;
  onDone: () => void;
}) {
  return (
    <div>
      <p className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-notify-share">
        By the administrator
      </p>
      <p className="mt-[4px] text-[0.8125rem] leading-[18px] text-body-ink">
        Your cameras are now shared with{" "}
        <span className="font-display">{share.viewer_site_name}</span>.
      </p>
      <p className="mt-[4px] text-[0.75rem] text-muted">
        {scopeSummary(share.scope)}
        {share.ptz ? " · controls" : ""}
        {share.playback ? " · playback" : ""}
        {share.asked_duration_sec
          ? ` · ${sayDuration(share.asked_duration_sec)}`
          : ""}
      </p>
      {share.message ? (
        <div className="mt-[8px]">
          <Quote text={share.message} />
        </div>
      ) : null}
      <Buttons>
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

/**
 * Turns changes in the share feed into cards.
 *
 * It used to take an `onWatch` for the one card that has a Watch button;
 * that card reaches `useWatch` itself now, so there is one way to open a
 * borrowed camera and it is the way that re-reads the fleet first.
 */
export function ShareDeck() {
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
          /* ── THE OWNING SITE OF AN ADMIN SHARE IS TOLD, NOT ASKED ─────

             It cannot answer, end or extend it, so `can_answer` is false and
             the card above is not for it. But its cameras have just been
             shared with somebody, which it has every right to know the moment
             it happens rather than by noticing a row in a list.

             TRANSIENT, because there is nothing to answer, and it carries no
             buttons for the same reason. `isAdminNotice` is the one place
             that decides this. */
          if (share.status === "pending" && !was && isAdminNotice(share)) {
            notify({
              id: `${id}:notice`,
              kind: "share",
              at: Date.parse(share.created_at) || Date.now(),
              ttlMs: ACTIONABLE_TTL_MS,
              title: `${share.viewer_site_name} was given your cameras`,
              render: ({ dismiss: close }) => (
                <AdminNoticeCard share={share} onDone={close} />
              ),
            });
            continue;
          }

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
                  <AcceptedCard share={share} onDone={close} />
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
    [feed, notify, dismiss, resolve, isAdmin],
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
/**
 * The badge on a borrowed feed: whose it is, and how long is left on it.
 *
 * ── AND A WAY BACK IN ──────────────────────────────────────────────────
 *
 * It was `pointer-events-none`, which was right while it only stated two
 * facts. A share's clock runs whether or not anybody is watching, so somebody
 * who ducks out of a borrowed feed to check something is spending time they
 * were lent and had nothing to click to get back; they had to find the mast on
 * the wall again. `onWatch` makes the badge the way back, and it is given only
 * where that means something -- on a tile that is NOT the feed already open,
 * because a button that reopens what you are looking at is furniture.
 */
export function SharedFeedBadge({
  share,
  onWatch,
}: {
  share: Share;
  /** Given on the wall, omitted inside the feed this badge is about. */
  onWatch?: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = timeLeftLabel(share.expires_at);
  const body = (
    <>
      <span className="size-[5px] rounded-full bg-notify-share" aria-hidden />
      <span className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-notify-share">
        {share.owner_site_name}
      </span>
      <span className="text-[0.6875rem] tabular-nums text-muted">
        {left ? `${left} left` : "ended"}
      </span>
    </>
  );
  const skin =
    "chip-blur flex items-center gap-[6px] rounded-[4px] border border-notify-share-line bg-notify-share-wash/80 px-[8px] py-[3px]";

  if (!onWatch) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={FADE}
        className={`${skin} pointer-events-none`}
      >
        {body}
      </motion.div>
    );
  }
  return (
    <motion.button
      type="button"
      onClick={onWatch}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      aria-label={`Watch ${share.owner_site_name}${left ? `, ${left} left` : ""}`}
      className={`${skin} transition-colors hover:bg-notify-share-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action`}
    >
      {body}
    </motion.button>
  );
}
