/**
 * Shares: what my sites have lent, what they have been lent, and the two flows
 * for asking and offering.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  DESIGNED FOR SOMEBODY IN A HURRY
 * ══════════════════════════════════════════════════════════════════════
 *
 * The moment this screen exists for is "the gate guard can see something I
 * cannot and I need eyes on it now". So:
 *
 *   * the two actions are the first thing on the screen, not behind a menu;
 *   * the form is three fields and the DEFAULTS ARE THE FASTEST SAFE ONES --
 *     live only, no PTZ, no playback, two hours. Lending control and a day of
 *     footage should be a decision somebody makes, not the default they accept;
 *   * accept and decline are on the row, because the person answering is
 *     usually not the person who will later audit it.
 *
 * ── TIMES ARE WALL-CLOCK, IN SITE TIME, LABELLED ───────────────────────
 *
 * `formatSiteStamp`, per the product's rule, with one documented exception:
 * the "expires in" line uses `formatDuration` on a remaining interval, which is
 * a DURATION and not a relative timestamp. It answers "how long have I got",
 * which is the question, and it does not re-tick on its own.
 */

import { motion } from "motion/react";
import { IconRail } from "@/components/IconRail";
import { said } from "@/lib/said";
import { useCallback, useMemo, useState } from "react";
import type { Share, ShareScopeEntry } from "@kallon/sentry-sdk";
import { isShareLive } from "@kallon/sentry-sdk";
import {
  acceptShare,
  createShare,
  declineShare,
  revokeShare,
} from "@/lib/api/sites";
import { useShares, useSites } from "@/lib/useSites";
import { useActingSite } from "@/lib/useActingSite";
import { useSiteTowers } from "@/lib/useSiteTowers";
import { scopeSummary } from "@/lib/shareRules";
import { spellSeconds } from "@/lib/auditSentence";
import {
  DurationPicker,
  SitePicker,
  TowerPicker,
} from "@/components/sharing/ShareControls";
import { ENTER, FADE } from "@/lib/motion";
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
  timeLeft,
} from "@/components/SitesPrimitives";

type TabId = "incoming" | "outgoing" | "active" | "history";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "incoming", label: "Incoming" },
  { id: "outgoing", label: "Outgoing" },
  { id: "active", label: "Active" },
  { id: "history", label: "History" },
];

/** Seconds left, or null when it has gone. */
function remaining(share: Share, now: number): number | null {
  const t = Date.parse(share.expires_at);
  if (!Number.isFinite(t)) return null;
  const left = Math.floor((t - now) / 1000);
  return left > 0 ? left : null;
}

function bucket(share: Share): TabId {
  if (share.status === "pending") return share.incoming ? "incoming" : "outgoing";
  if (isShareLive(share)) return "active";
  return "history";
}

export function ShareRow({
  share,
  onAccept,
  onDecline,
  onRevoke,
  busy,
}: {
  share: Share;
  onAccept?: (s: Share) => void;
  onDecline?: (s: Share) => void;
  onRevoke?: (s: Share) => void;
  busy?: boolean;
}) {
  const now = Date.now();
  const left = remaining(share, now);
  const other = share.incoming ? share.viewer_site_name : share.owner_site_name;
  const verb = share.incoming
    ? share.direction === "request"
      ? "asked to see"
      : "offered to show"
    : share.direction === "request"
      ? "you asked to see"
      : "you offered";

  return (
    <Row>
      <div className="flex min-w-[220px] flex-1 flex-col gap-[4px]">
        <span className="text-[0.875rem] leading-[20px] text-body-ink">
          <span className="font-display">{other || "another site"}</span>{" "}
          <span className="text-muted">{verb}</span>{" "}
          {/* ⚠ COUNTED, NEVER NAMED BY SERIAL. This said `kln_lab_000002` for
              a one-tower share, which is the shape of the share wire -- the
              scope carries device ids and no labels -- leaking straight onto
              the screen. `scopeSummary` is what the rest of the sharing UI
              says, and it answers the question somebody has here: how much was
              lent, not which serial. */}
          <span className="text-[0.8125rem]">{scopeSummary(share.scope)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px]">
          <StatusPill status={share.status} />
          <Allowances
            live={share.live}
            ptz={share.ptz}
            playback={share.playback}
          />
          {/* ABSENCE IS DIAGNOSTIC. An expired share says so rather than
              showing a blank where a countdown used to be. */}
          <span className="text-[0.75rem] text-muted">
            {left === null
              ? share.status === "active"
                ? "expired"
                : `ended ${siteStampLine(Date.parse(share.decided_at ?? share.created_at))}`
              : `expires in ${timeLeft(left)}`}
          </span>
        </span>
        {share.playback && share.playback_from && share.playback_to ? (
          <span className="text-[0.75rem] text-muted">
            footage {siteStampLine(Date.parse(share.playback_from))} to{" "}
            {siteStampLine(Date.parse(share.playback_to))}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        {onAccept ? (
          <PrimaryButton disabled={busy} onClick={() => onAccept(share)}>
            Accept
          </PrimaryButton>
        ) : null}
        {onDecline ? (
          <QuietButton disabled={busy} onClick={() => onDecline(share)}>
            Decline
          </QuietButton>
        ) : null}
        {onRevoke ? (
          <QuietButton danger disabled={busy} onClick={() => onRevoke(share)}>
            Revoke
          </QuietButton>
        ) : null}
      </div>
    </Row>
  );
}

/**
 * The ask / offer form.
 *
 * One component for both directions, because they differ only in which site
 * owns the cameras: two forms would be two places to get the defaults wrong.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  IT USED TO ASK FOR IDENTIFIERS, BY HAND
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three fields collected machinery: a site to share with, typed as a `site id`
 * with "site id" for a placeholder; the towers, typed as device ids separated
 * by spaces, placeholder `kln_northgate_000001`; and the hours, as a number.
 * Nobody outside this office knows a device id, and the one place the product
 * shows one is nowhere -- so the form asked for a fact it also promises never
 * to show.
 *
 * All three are now the pickers the Sharing pane uses: sites by NAME from the
 * directory, towers by LABEL from the fleet, duration from the same list of
 * choices with the same custom option. Identical words in both places, and no
 * identifier anywhere.
 */
function ShareForm({
  direction,
  onDone,
  onCancel,
}: {
  direction: "request" | "offer";
  onDone: () => void;
  onCancel: () => void;
}) {
  const acting = useActingSite();
  const mine = acting.candidates;
  const [mySiteId, setMySiteId] = useState("");
  const [otherSiteId, setOtherSiteId] = useState("");
  const [scope, setScope] = useState<readonly ShareScopeEntry[]>([]);
  /* Required on a REQUEST, where it is the only thing the other site has
     to go on; optional on an offer, which carries its own meaning. */
  const [reason, setReason] = useState("");
  const [ptz, setPtz] = useState(false);
  const [playback, setPlayback] = useState(false);
  const [durationSec, setDurationSec] = useState(2 * 3600);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* A SITE USER HAS ONE SITE AND IS NOT ASKED WHICH. `useActingSite` settles
     it for them and leaves it unset for an administrator, who has every site
     and no default worth guessing. */
  const fromSite = mySiteId || acting.site?.site_id || "";
  const lendable = useSiteTowers(direction === "offer" ? fromSite || null : null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!fromSite) {
        setError(
          direction === "request"
            ? "Choose which of your sites is asking."
            : "Choose which of your sites is sharing.",
        );
        setBusy(false);
        return;
      }
      if (!otherSiteId) {
        setError("Choose the other site.");
        setBusy(false);
        return;
      }
      if (direction === "offer" && !scope.length) {
        setError("Choose at least one camera to share.");
        setBusy(false);
        return;
      }
      if (direction === "request" && !reason.trim()) {
        setError("Say what you need. It is the only thing they have to go on.");
        setBusy(false);
        return;
      }
      if (direction === "request") {
        /* ⚠ A REQUEST NAMES NO CAMERAS, and this form used to send the
           towers somebody typed into it along with `ptz` and `playback`. The
           site asking cannot see what the other site has -- that is the whole
           reason it is asking -- and what it is granted is the answering
           site's decision. So the picker is not even shown on a request. */
        await createShare({
          direction: "request",
          mySiteId: fromSite,
          otherSiteId,
          message: reason.trim(),
          durationSec,
        });
      } else {
        await createShare({
          direction: "offer",
          mySiteId: fromSite,
          otherSiteId,
          scope,
          ...(reason.trim() ? { message: reason.trim() } : {}),
          live: true,
          ptz,
          playback,
          // A WINDOW IS REQUIRED WHEN PLAYBACK IS, and it is the footage from
          // as far back as the share is long rather than an open end: the
          // server refuses playback with no window, and an unbounded one is
          // not something to offer by accident.
          playbackFrom: playback
            ? new Date(Date.now() - durationSec * 1000).toISOString()
            : undefined,
          playbackTo: playback ? new Date().toISOString() : undefined,
          durationSec,
        });
      }
      onDone();
    } catch (err) {
      setError(
        (err as { status?: number })?.status === 403
          ? "That is not one of your sites, or those are not your cameras."
          : said(err, "That did not go out."),
      );
      setBusy(false);
    }
  }, [
    direction,
    fromSite,
    otherSiteId,
    scope,
    reason,
    ptz,
    playback,
    durationSec,
    onDone,
  ]);

  return (
    <motion.form
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-[16px] rounded-[12px] border border-stroke bg-card/60 p-[20px]"
    >
      <h3 className="font-display text-[0.9375rem] leading-[20px] text-body-ink">
        {direction === "request" ? "Request access" : "Share my cameras"}
      </h3>
      <div className="grid gap-[16px] sm:grid-cols-2">
        <Field label={direction === "request" ? "Asking as" : "Sharing from"}>
          <SitePicker
            sites={mine}
            value={fromSite}
            onChange={setMySiteId}
            label={direction === "request" ? "Asking as" : "Sharing from"}
          />
        </Field>
        <Field
          label={direction === "request" ? "Site to ask" : "Site to share with"}
          hint="Sites you can reach, by name."
        >
          {/* ⚠ THE LIST, NOT A TYPED ID. The directory is what one site knows
              about another: its name, and whether it has cameras worth asking
              for. A request went to a site chosen from the ones worth asking;
              an offer can go to any of them, because giving a camera to an
              empty site is a sensible thing to do. */}
          <SitePicker
            sites={direction === "request" ? acting.othersToAsk : acting.others}
            value={otherSiteId}
            onChange={setOtherSiteId}
            label={direction === "request" ? "Site to ask" : "Site to share with"}
          />
        </Field>
      </div>
      {/* ⚠ CAMERAS ONLY ON AN OFFER. The site asking cannot see what the
          other site has, so there is nothing for it to name here: it says what
          it needs and the site answering chooses the cameras. */}
      {direction === "offer" ? (
        <Field label="Cameras" hint="A tower with no camera picked means all of them.">
          <TowerPicker
            towers={lendable.towers}
            loading={lendable.loading}
            value={scope}
            onChange={setScope}
            emptyNote={
              fromSite
                ? "This site has no towers to lend yet."
                : "Choose which of your sites is sharing first."
            }
          />
        </Field>
      ) : (
        <Field
          label="Why"
          hint="The only thing the other site has to decide on."
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Our truck is at your gate this afternoon."
            className={inputClass}
          />
        </Field>
      )}
      <Field label="How long">
        <DurationPicker value={durationSec} onChange={setDurationSec} />
      </Field>
      {/* ⚠ NOT ON A REQUEST, WHERE NEITHER IS SENT. What a request is granted
          is the answering site's decision, so two checkboxes that look like
          part of the ask and are dropped on the way out are two promises this
          form cannot keep. */}
      {direction === "offer" ? (
        <div className="flex flex-wrap items-end gap-[20px]">
          {/* THE DEFAULTS ARE THE FASTEST SAFE ONES. Live is always on because
              it is the point; control and footage are decisions. */}
          <label className="flex items-center gap-[8px] pb-[8px] text-[0.8125rem] text-sub">
            <input
              type="checkbox"
              checked={ptz}
              onChange={(e) => setPtz(e.target.checked)}
              className="size-[16px] accent-white"
            />
            Let them move the camera
          </label>
          <label className="flex items-center gap-[8px] pb-[8px] text-[0.8125rem] text-sub">
            <input
              type="checkbox"
              checked={playback}
              onChange={(e) => setPlayback(e.target.checked)}
              className="size-[16px] accent-white"
            />
            Include the last {spellSeconds(durationSec) || "2 hours"} of footage
          </label>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex gap-[8px]">
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Sending" : direction === "request" ? "Send request" : "Send offer"}
        </PrimaryButton>
        <QuietButton onClick={onCancel}>Cancel</QuietButton>
      </div>
    </motion.form>
  );
}

export function SharesView({
  onNavigate,
}: {
  onNavigate?: (id: string) => void;
}) {
  const sites = useSites();
  const shares = useShares();
  const [tab, setTab] = useState<TabId>("incoming");
  const [form, setForm] = useState<"request" | "offer" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = useCallback(
    async (share: Share, what: "accept" | "decline" | "revoke") => {
      setBusyId(share.share_id);
      try {
        if (what === "accept") await acceptShare(share.share_id);
        else if (what === "decline") await declineShare(share.share_id);
        else await revokeShare(share.share_id);
        shares.reload();
      } finally {
        setBusyId(null);
      }
    },
    [shares],
  );

  const grouped = useMemo(() => {
    const out: Record<TabId, Share[]> = {
      incoming: [],
      outgoing: [],
      active: [],
      history: [],
    };
    for (const s of shares.value?.shares ?? []) out[bucket(s)].push(s);
    return out;
  }, [shares.value]);

  const tabs = TABS.map((t) => ({ ...t, count: grouped[t.id].length }));
  const rows = grouped[tab];

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      {/* See the note in AdministrationView: the rail answers for itself. */}
      <IconRail active="shares" onSelect={onNavigate} />
      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[20px] sm:px-[24px]">
        <div className="mx-auto flex max-w-[920px] flex-col gap-[20px]">
      <PaneHead
        title="Shares"
        blurb="Sites lend each other cameras directly. Every share expires on its own, and either side can end one at any time."
        action={
          sites.value && sites.value.sites.length ? (
            <div className="flex gap-[8px]">
              <PrimaryButton onClick={() => setForm("request")}>
                Request access
              </PrimaryButton>
              <QuietButton onClick={() => setForm("offer")}>
                Share my cameras
              </QuietButton>
            </div>
          ) : undefined
        }
      />

      {form && sites.value ? (
        <ShareForm
          direction={form}
          onDone={() => {
            setForm(null);
            shares.reload();
          }}
          onCancel={() => setForm(null)}
        />
      ) : null}

      <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

      <div
        role="tabpanel"
        id={`pane-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="flex flex-col gap-[8px]"
      >
        {shares.loading ? (
          <Loading rows={3} label="Loading shares" />
        ) : shares.error ? (
          <Failed message={shares.error} onRetry={shares.reload} />
        ) : rows.length === 0 ? (
          <Empty
            title={
              tab === "incoming"
                ? "Nothing waiting for you"
                : tab === "outgoing"
                  ? "You have not asked for anything"
                  : tab === "active"
                    ? "No cameras are shared right now"
                    : "No finished shares yet"
            }
            why={
              tab === "incoming"
                ? "When another site asks to see your cameras, or offers you theirs, it appears here and as a banner at the top of the screen."
                : tab === "outgoing"
                  ? "Use Request access to ask another site for a camera. They decide what to grant and for how long."
                  : tab === "active"
                    ? "An accepted share appears here until it expires or somebody ends it."
                    : "Declined, revoked and expired shares are kept here so there is a record of who could see what."
            }
          />
        ) : (
          <motion.div initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE} className="flex flex-col gap-[8px]">
            {rows.map((s) => (
              <ShareRow
                key={s.share_id}
                share={s}
                busy={busyId === s.share_id}
                onAccept={
                  s.status === "pending" && s.incoming
                    ? (x) => void act(x, "accept")
                    : undefined
                }
                onDecline={
                  s.status === "pending" && s.incoming
                    ? (x) => void act(x, "decline")
                    : undefined
                }
                onRevoke={
                  isShareLive(s) ? (x) => void act(x, "revoke") : undefined
                }
              />
            ))}
          </motion.div>
        )}
      </div>

      {sites.value && sites.value.sites.length === 0 ? (
        <Card>
          <p className="text-[0.8125rem] leading-[20px] text-muted">
            You are not in a site yet, so there is nothing to share.
          </p>
        </Card>
      ) : null}
        </div>
      </div>
    </div>
  );
}
