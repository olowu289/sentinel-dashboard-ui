/**
 * Sharing: the page where everything is started, and everything is managed.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS FOR, GIVEN THE CARDS EXIST
 * ══════════════════════════════════════════════════════════════════════
 *
 * The floating cards are the SHORTCUT: they find you wherever you are, over
 * the video, while something is happening. This page is the HOME: it is where
 * a request is started (there is no card to start one from -- a card is a
 * reply to something, and the first move has nowhere to arrive), and it is
 * where everything that already exists can be found again.
 *
 * ⚠ ONE LIST BEHIND BOTH. Every section here reads `useShareFeed`, which is
 * the same object the cards read and the same object every Accept writes
 * through. "Answering in one updates the other at once" is not a thing this
 * code does; it is a thing it cannot avoid doing.
 *
 * ── THE SIX SECTIONS, AND WHY THEY ARE SIX ────────────────────────────
 *
 * New request and Share a feed are the two ways to START something, and they
 * are genuinely different: one asks for cameras you cannot see, the other
 * offers cameras you own. Incoming and Outgoing are the same objects seen from
 * the two ends -- what is waiting on me, and what I am waiting on. Active is
 * what is in force right now, which is the only section anybody opens in a
 * hurry, and it is the only one with End now and Extend on it. History is
 * everything finished, because "did we ever lend them that" is a real question.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Share } from "@kallon/sentry-sdk";
import { SHARE_DEFAULT_SEC } from "@kallon/sentry-sdk";
import { ENTER, FADE } from "@/lib/motion";
import { timeLeftLabel } from "@/lib/notifications";
import {
  otherSiteName,
  scopeSummary,
  useShareFeed,
} from "@/lib/useShareFeed";
import { useSites } from "@/lib/useSites";
import { useActingSite } from "@/lib/useActingSite";
import { otherSiteRole } from "@/lib/shareRules";
import { useSiteTowers } from "@/lib/useSiteTowers";
import { useWatch } from "@/lib/watch";
import {
  Allowances,
  Empty,
  Failed,
  Loading,
  PrimaryButton,
  QuietButton,
  inputClass,
  StatusPill,
} from "@/components/SitesPrimitives";
import {
  DurationPicker,
  MessageBox,
  OfferTerms,
  ShareDecision,
  acceptOffer,
  SitePicker,
  TowerPicker,
  Allow,
  PlaybackWindow,
  composeIsReady,
  composeToRequest,
  decisionToChoices,
  initialCompose,
  initialDecision,
  type ComposeState,
  type DecisionState,
} from "./ShareControls";

type SectionId =
  | "new"
  | "offer"
  | "incoming"
  | "outgoing"
  | "all"
  | "active"
  | "history";

const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: "new", label: "New request" },
  { id: "offer", label: "Share a feed" },
  { id: "incoming", label: "Incoming" },
  { id: "outgoing", label: "Outgoing" },
  { id: "active", label: "Active" },
  { id: "history", label: "History" },
];

/**
 * An administrator's sections, which are deliberately not the same five.
 *
 * There is no Incoming for them, because an admin answers nothing: a share is
 * an agreement between two sites and administration is not a party to it. What
 * replaces it is ALL -- every share in the organization, which is the thing an
 * admin actually needs and the thing nobody else can see.
 *
 * They keep New request and Share a feed, because starting one on a site's
 * behalf is a reasonable administrative act, and Active, because ending one is
 * the authority administration does have here.
 */
const ADMIN_SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: "new", label: "New request" },
  { id: "offer", label: "Share a feed" },
  { id: "all", label: "All shares" },
  { id: "active", label: "Active" },
  { id: "history", label: "History" },
];

/**
 * "Requesting as North Gate", and a way to change it when there is a choice.
 *
 * ⚠ ALWAYS ON SCREEN WHERE A SHARE IS STARTED OR ANSWERED. Every share is
 * between two sites, so which one you are is half of what the thing means --
 * and a site user could not tell which site they were in at all.
 */
function ActingAs({
  verb,
  acting,
}: {
  verb: string;
  acting: ReturnType<typeof useActingSite>;
}) {
  if (acting.loading) return null;
  if (acting.candidates.length === 0) {
    return (
      <p className="text-[0.8125rem] leading-[18px] text-muted">
        You are not in a site yet, so there is nothing to share from. An
        administrator adds people to sites in Administration.
      </p>
    );
  }
  if (acting.candidates.length === 1 && acting.site) {
    return (
      <p className="text-[0.8125rem] text-muted">
        {verb} as{" "}
        <span className="font-display text-body-ink">{acting.site.name}</span>
      </p>
    );
  }
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
        {verb} as
      </span>
      <select
        aria-label={`${verb} as`}
        value={acting.site?.site_id ?? ""}
        onChange={(e) => acting.choose(e.target.value)}
        className={`${inputClass} text-[0.8125rem]`}
      >
        {/* An ADMIN starts with nothing chosen on purpose: acting on behalf of
            a site is a deliberate act, and defaulting to whichever site sorted
            first is how a request gets sent by accident. */}
        <option value="">Choose a site...</option>
        {acting.candidates.map((s) => (
          <option key={s.site_id} value={s.site_id}>
            {s.name}
          </option>
        ))}
      </select>
      {acting.isAdmin ? (
        <span className="text-[0.75rem] text-muted">
          On behalf of that site. Whoever is there answers it, not you.
        </span>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Shared row furniture
 * ------------------------------------------------------------------ */

function ShareRow({
  share,
  children,
  subtitle,
  asOnlooker,
}: {
  share: Share;
  children?: React.ReactNode;
  subtitle?: React.ReactNode;
  /**
   * The reader is not a party to this share -- an administrator looking at
   * the organization's list.
   *
   * ⚠ WITHOUT THIS THE ROW SAYS "YOURS", and an administrator has no
   * "yours": every site is theirs to see and none is theirs to be. It read
   * "South Pit is asking for yours" on a share between two other sites.
   */
  asOnlooker?: boolean;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={ENTER}
      className="rounded-[10px] border border-card-line bg-card p-[12px]"
    >
      <div className="flex flex-wrap items-center gap-[8px]">
        {asOnlooker ? (
          /* Both sites, in the direction the cameras travel: the lender on
             the left, the borrower on the right. Nothing is "yours". */
          <span className="flex items-center gap-[6px] text-[0.8125rem]">
            <span className="font-display text-body-ink">
              {share.owner_site_name}
            </span>
            <span className="text-muted" aria-label="lends to">
              &rarr;
            </span>
            <span className="font-display text-body-ink">
              {share.viewer_site_name}
            </span>
          </span>
        ) : (
          <>
            <span className="font-display text-[0.8125rem] text-body-ink">
              {otherSiteName(share)}
            </span>
            {/* WHAT THIS SITE IS TO ME, which depends on the status as much
                as on the direction: "wants yours" is true of a request nobody
                has answered and false of the share it became. */}
            <span className="text-[0.75rem] text-muted">{otherSiteRole(share)}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-[8px]">
          <StatusPill status={share.status} />
        </span>
      </div>
      {subtitle}
      {share.message ? (
        <p className="mt-[8px] whitespace-pre-wrap border-l-2 border-notify-share/40 pl-[8px] text-[0.8125rem] leading-[18px] text-body-ink">
          {share.message}
        </p>
      ) : null}
      <div className="mt-[8px] flex flex-wrap items-center gap-[10px]">
        <span className="text-[0.75rem] text-muted">{scopeSummary(share.scope)}</span>
        <Allowances
          live={share.live}
          ptz={share.ptz}
          playback={share.playback}
        />
      </div>
      {children}
    </motion.li>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[14px]">
      <div>
        <h3 className="font-display text-[0.9375rem] tracking-[0.12px] text-body-ink">
          {title}
        </h3>
        <p className="mt-[4px] text-[0.8125rem] leading-[18px] text-muted">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Starting something
 * ------------------------------------------------------------------ */

function NewRequest({ acting }: { acting: ReturnType<typeof useActingSite> }) {
  const feed = useShareFeed();
  const [state, setState] = useState<ComposeState>(initialCompose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /* WHO I AM AND WHO I MAY ASK both come from one place, and the second
     never contains the first: a site cannot share with itself, and it
     appeared in its own list until this was the only list. */
  const mySite = acting.site?.site_id ?? "";
  const others = acting.others;

  /* ONE RULE, FOR BOTH FORMS. See `composeIsReady`: the length used to be
     pre-filled, so "ready" never had to mention it and every share somebody
     sent without touching the picker went out at fifteen minutes by accident.
     Two copies of this condition is how one of them forgets a field. */
  const ready = composeIsReady(state, mySite, "request");

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await feed.create(composeToRequest(state, mySite, "request"));
      setState(initialCompose());
      setSent(true);
    } catch (err) {
      setError((err as { message?: string })?.message ?? "That did not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Ask another site"
      blurb="You cannot see their cameras, so you cannot name them. Say what you need and they choose what to lend."
    >
      {others.length === 0 && acting.candidates.length > 0 ? (
        <Empty
          title="No other sites"
          why="There is nobody to ask yet. An administrator adds sites in Administration."
        />
      ) : (
        <div className="flex flex-col gap-[14px]">
          <ActingAs verb="Requesting" acting={acting} />
          <label className="flex flex-col gap-[6px]">
            <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
              Ask
            </span>
            <SitePicker
              sites={others}
              value={state.otherSiteId}
              onChange={(otherSiteId) => setState({ ...state, otherSiteId })}
            />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
              Why
            </span>
            <MessageBox
              required
              value={state.message}
              onChange={(message) => setState({ ...state, message })}
              placeholder="Our truck is at your gate this afternoon."
            />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
              Suggested length
            </span>
            <DurationPicker
              value={state.durationSec}
              onChange={(durationSec) => setState({ ...state, durationSec })}
            />
            <span className="text-[0.75rem] text-muted">
              They set the final length when they answer.
            </span>
          </label>
          {error ? (
            <p className="text-[0.8125rem] text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <AnimatePresence initial={false}>
            {sent ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FADE}
                className="text-[0.8125rem] text-notify-share"
                role="status"
              >
                Sent. It is in Outgoing until they answer.
              </motion.p>
            ) : null}
          </AnimatePresence>
          <div>
            <PrimaryButton onClick={() => void send()} disabled={!ready || busy}>
              {busy ? "Sending..." : "Send request"}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Section>
  );
}

function OfferFeed({
  acting,
  initialScope,
}: {
  acting: ReturnType<typeof useActingSite>;
  /** Pre-chosen cameras, when this was opened from a camera's own settings. */
  initialScope?: readonly { device_id: string; cameras?: readonly number[] }[];
}) {
  const feed = useShareFeed();
  const mySite = acting.site?.site_id ?? "";
  const others = acting.others;
  const [state, setState] = useState<ComposeState>(() => ({
    ...initialCompose(),
    scope: initialScope ?? [],
  }));
  const towers = useSiteTowers(mySite || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const ready = composeIsReady(state, mySite, "offer");

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await feed.create(composeToRequest(state, mySite, "offer"));
      setState({ ...initialCompose(), scope: [] });
      setSent(true);
    } catch (err) {
      setError((err as { message?: string })?.message ?? "That did not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Offer your cameras"
      blurb="Pick what to lend, what they can do with it and for how long. They still have to accept."
    >
      <div className="flex flex-col gap-[14px]">
        <ActingAs verb="Sharing" acting={acting} />
        <label className="flex flex-col gap-[6px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            Share with
          </span>
          <SitePicker
            sites={others}
            value={state.otherSiteId}
            onChange={(otherSiteId) => setState({ ...state, otherSiteId })}
          />
        </label>
        <div className="flex flex-col gap-[6px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            Cameras
          </span>
          <TowerPicker
            towers={towers.towers}
            loading={towers.loading}
            value={state.scope}
            onChange={(scope) => setState({ ...state, scope })}
            emptyNote="This site has no towers to lend yet."
          />
        </div>
        <Allow
          label="Controls"
          detail="They can point the camera. Your site always wins a contest for it."
          on={state.ptz}
          onChange={(ptz) => setState({ ...state, ptz })}
        />
        <Allow
          label="Playback"
          detail="They can watch recorded footage from the window below."
          on={state.playback}
          onChange={(playback) => setState({ ...state, playback })}
        />
        <AnimatePresence initial={false}>
          {state.playback ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={FADE}
              className="overflow-hidden"
            >
              <PlaybackWindow
                from={state.from}
                to={state.to}
                onChange={(from, to) => setState({ ...state, from, to })}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex flex-col gap-[6px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            For how long
          </span>
          <DurationPicker
            value={state.durationSec}
            onChange={(durationSec) => setState({ ...state, durationSec })}
          />
        </div>
        <label className="flex flex-col gap-[6px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            Message
          </span>
          <MessageBox
            value={state.message}
            onChange={(message) => setState({ ...state, message })}
            placeholder="Gate camera, yours for the hour."
          />
        </label>
        {error ? (
          <p className="text-[0.8125rem] text-critical" role="alert">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p className="text-[0.8125rem] text-notify-share" role="status">
            Offered. It is in Outgoing until they accept.
          </p>
        ) : null}
        <div>
          <PrimaryButton onClick={() => void send()} disabled={!ready || busy}>
            {busy ? "Sending..." : "Offer"}
          </PrimaryButton>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Answering, on the page: the same controls the card mounts
 * ------------------------------------------------------------------ */

function IncomingRow({ share }: { share: Share }) {
  const feed = useShareFeed();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DecisionState>(() => initialDecision(share));
  const isRequest = share.direction === "request";
  /* ⚠ A REQUEST ONLY. For an OFFER the owner site is THEIRS, this account
     is not in it, and `GET /v1/sites/{id}` answers 404 "no such site" by
     design. See `OfferTerms` for what that 404 looked like on screen. */
  const towers = useSiteTowers(open && isRequest ? share.owner_site_id : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (what: "accept" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      if (what === "accept")
        await feed.accept(
          share.share_id,
          isRequest ? decisionToChoices(state) : acceptOffer(),
        );
      else await feed.decline(share.share_id);
    } catch (err) {
      setError((err as { message?: string })?.message ?? "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ShareRow share={share}>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={ENTER}
            className="overflow-hidden"
          >
            <div className="mt-[12px] border-t border-row-line pt-[12px]">
              {isRequest ? (
                <ShareDecision
                  share={share}
                  towers={towers.towers}
                  loadingTowers={towers.loading}
                  state={state}
                  onChange={setState}
                />
              ) : (
                <OfferTerms share={share} />
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {error ? (
        <p className="mt-[8px] text-[0.8125rem] text-critical" role="alert">
          {error}
        </p>
      ) : null}
      {/* ⚠ THE SERVER DECIDES WHO ANSWERS, and this list can contain a
          share that is not mine to answer (an admin sees every share; a
          pending one can be answered by somebody else while this page is
          open). Drawing the buttons anyway produces a 403 and a person who
          thinks the product is broken. */}
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        {share.can_answer ? (
          <>
            {open ? (
              <PrimaryButton
                onClick={() => void act("accept")}
                disabled={
                  busy ||
                  (isRequest &&
                    (state.scope.length === 0 || state.durationSec <= 0))
                }
              >
                {!isRequest
                  ? "Accept"
                  : state.scope.length === 0
                    ? "Choose towers"
                    : state.durationSec <= 0
                      ? "Choose how long"
                      : "Accept"}
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => setOpen(true)}>
                {isRequest ? "Choose and accept" : "See what is offered"}
              </PrimaryButton>
            )}
            <QuietButton onClick={() => void act("decline")} disabled={busy}>
              Decline
            </QuietButton>
          </>
        ) : (
          <p className="text-[0.8125rem] text-muted">
            {share.direction === "request"
              ? `${share.owner_site_name} answers this.`
              : `${share.viewer_site_name} answers this.`}
          </p>
        )}
      </div>
    </ShareRow>
  );
}

function ActiveRow({ share }: { share: Share }) {
  const feed = useShareFeed();
  const { watch, ready } = useWatch();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = timeLeftLabel(share.expires_at);
  /* ⚠ ONLY A SHARE COMING TO ME GETS A WATCH BUTTON. `incoming` is true
     when one of MY sites owns the cameras, so for those this row is about
     something I have lent out -- it is already on my own wall and "watch the
     camera they borrowed" is not a thing anybody means. */
  const borrowed = share.incoming === false;
  const first = share.scope[0]?.device_id;

  return (
    <ShareRow
      share={share}
      subtitle={
        <p className="mt-[4px] text-[0.75rem] tabular-nums text-muted">
          {left ? `${left} left` : "ending"}
        </p>
      }
    >
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        {/* ── GOING BACK IN ───────────────────────────────────────────

            Somebody who leaves a borrowed feed had no way back to it except
            to find the mast on the wall, and a share's clock runs whether or
            not anybody is watching -- so leaving it to look something up was
            spending time they had been lent. The row already counts down; now
            it also reopens. */}
        {borrowed && first && ready ? (
          <PrimaryButton onClick={() => void watch(first)} disabled={busy}>
            {left ? `Watch (${left} left)` : "Watch"}
          </PrimaryButton>
        ) : null}
        {/* EXTEND IS THE LENDER'S, END IS EITHER SIDE'S OR AN ADMIN'S, and
            both answers come from the server rather than from `incoming` --
            which is true of every share in the organization for an admin. */}
        {share.can_extend ? (
          <QuietButton
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void feed
                .extend(share.share_id, SHARE_DEFAULT_SEC)
                .finally(() => setBusy(false));
            }}
          >
            +15 min
          </QuietButton>
        ) : null}
        {share.can_end ? (
          <QuietButton
            danger
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void feed.revoke(share.share_id).finally(() => setBusy(false));
            }}
          >
            End now
          </QuietButton>
        ) : null}
      </div>
    </ShareRow>
  );
}

/* ------------------------------------------------------------------ *
 * The pane
 * ------------------------------------------------------------------ */

export function SharingPane({
  startOn = "new",
  initialOfferScope,
}: {
  startOn?: SectionId;
  initialOfferScope?: readonly { device_id: string; cameras?: readonly number[] }[];
}) {
  const feed = useShareFeed();
  const sites = useSites();
  /* WHO I AM ACTING AS, and therefore who I may share WITH. One source, so a
     form cannot assemble a list that includes the site it is acting for. */
  const acting = useActingSite();
  const sections = acting.isAdmin ? ADMIN_SECTIONS : SECTIONS;
  const [tab, setTab] = useState<SectionId>(
    acting.isAdmin && startOn === "incoming" ? "all" : startOn,
  );
  const mine = acting.candidates;

  if (sites.loading && mine.length === 0) {
    return <Loading rows={3} label="Loading sharing" />;
  }
  if (sites.error) {
    return <Failed message={sites.error} onRetry={sites.reload} />;
  }

  const pane = () => {
    switch (tab) {
      case "new":
        return <NewRequest acting={acting} />;
      case "offer":
        return <OfferFeed acting={acting} initialScope={initialOfferScope} />;
      case "all":
        return (
          <Section
            title="Every share in the organization"
            blurb="Administration sees all of them and can end any of them. Answering one is for the site it is addressed to."
          >
            {feed.shares.length === 0 ? (
              <Empty title="No shares yet" why="Nobody has asked for or offered anything." />
            ) : (
              <ul className="flex flex-col gap-[10px]">
                {feed.shares.map((s) => (
                  <ShareRow key={s.share_id} share={s} asOnlooker>
                    {s.can_end ? (
                      <div className="mt-[12px]">
                        <QuietButton danger onClick={() => void feed.revoke(s.share_id)}>
                          {s.status === "pending" ? "Withdraw" : "End now"}
                        </QuietButton>
                      </div>
                    ) : null}
                  </ShareRow>
                ))}
              </ul>
            )}
          </Section>
        );
      case "incoming":
        return (
          <Section
            title="Waiting for you"
            blurb="Requests for your cameras, and offers of somebody else's."
          >
            {feed.awaitingMe.length === 0 ? (
              <Empty title="Nothing waiting" why="Nobody is asking you for anything." />
            ) : (
              <ul className="flex flex-col gap-[10px]">
                <AnimatePresence initial={false}>
                  {feed.awaitingMe.map((s) => (
                    <IncomingRow key={s.share_id} share={s} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Section>
        );
      case "outgoing":
        return (
          <Section
            title="Waiting on them"
            blurb="What you have asked for or offered, and where it got to."
          >
            {feed.awaitingThem.length === 0 ? (
              <Empty
                title="Nothing outstanding"
                why="Start one from New request or Share a feed."
              />
            ) : (
              <ul className="flex flex-col gap-[10px]">
                <AnimatePresence initial={false}>
                  {feed.awaitingThem.map((s) => (
                    <ShareRow key={s.share_id} share={s}>
                      {/* ⚠ WITHDRAW ONLY WHEN THE SERVER SAYS SO. This list
                          holds anything pending that is not mine to answer,
                          which includes a share between two other sites that
                          I can see but have no part in. */}
                      {s.can_end ? (
                        <div className="mt-[12px]">
                          <QuietButton onClick={() => void feed.revoke(s.share_id)}>
                            Withdraw
                          </QuietButton>
                        </div>
                      ) : null}
                    </ShareRow>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Section>
        );
      case "active":
        return (
          <Section
            title="In force now"
            blurb="Both directions, with the time each has left."
          >
            {feed.active.length === 0 ? (
              <Empty title="Nothing active" why="No cameras are being lent either way." />
            ) : (
              <ul className="flex flex-col gap-[10px]">
                <AnimatePresence initial={false}>
                  {feed.active.map((s) => (
                    <ActiveRow key={s.share_id} share={s} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Section>
        );
      case "history":
        return (
          <Section
            title="Finished"
            blurb="Everything that ended: declined, withdrawn, revoked or run out."
          >
            {feed.finished.length === 0 ? (
              <Empty title="Nothing yet" why="Shares appear here once they end." />
            ) : (
              <ul className="flex flex-col gap-[10px]">
                {feed.finished.map((s) => (
                  <ShareRow key={s.share_id} share={s} />
                ))}
              </ul>
            )}
          </Section>
        );
    }
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-wrap gap-[6px]">
        {sections.map((s) => {
          const on = s.id === tab;
          const count =
            s.id === "incoming"
              ? feed.awaitingMe.length
              : s.id === "outgoing"
                ? feed.awaitingThem.length
                : s.id === "all"
                  ? feed.shares.length
                  : s.id === "active"
                    ? feed.active.length
                    : 0;
          return (
            <button
              key={s.id}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => setTab(s.id)}
              className={`rounded-[8px] border px-[10px] py-[6px] text-[0.8125rem] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
                on
                  ? "border-action bg-action text-action-ink"
                  : "border-stroke text-sub hover:text-body-ink"
              }`}
            >
              {s.label}
              {count > 0 ? (
                <span
                  className={`ml-[6px] tabular-nums ${on ? "" : "text-notify-share"}`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {feed.error ? (
        <p className="text-[0.8125rem] text-critical" role="alert">
          {feed.error}
        </p>
      ) : null}

      <motion.div
        key={tab}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={FADE}
      >
        {pane()}
      </motion.div>
    </div>
  );
}
