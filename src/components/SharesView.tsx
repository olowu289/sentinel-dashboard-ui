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
import { useCallback, useMemo, useState } from "react";
import type { Share, SiteListResponse } from "@kallon/sentry-sdk";
import { isShareLive } from "@kallon/sentry-sdk";
import {
  acceptShare,
  createShare,
  declineShare,
  revokeShare,
} from "@/lib/api/sites";
import { useShares, useSites } from "@/lib/useSites";
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
  const towers = share.scope.map((e) => e.device_id);
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
          <span className="font-mono text-[0.75rem]">
            {towers.length === 1
              ? towers[0]
              : `${towers.length} towers`}
          </span>
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
 */
function ShareForm({
  direction,
  sites,
  onDone,
  onCancel,
}: {
  direction: "request" | "offer";
  sites: SiteListResponse;
  onDone: () => void;
  onCancel: () => void;
}) {
  const mine = sites.sites;
  const [mySiteId, setMySiteId] = useState(mine[0]?.site_id ?? "");
  const [otherSiteId, setOtherSiteId] = useState("");
  const [towers, setTowers] = useState("");
  const [ptz, setPtz] = useState(false);
  const [playback, setPlayback] = useState(false);
  const [hours, setHours] = useState("2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const scope = towers
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((device_id) => ({ device_id }));
      if (!scope.length) {
        setError("Name at least one tower.");
        setBusy(false);
        return;
      }
      const h = Number(hours);
      await createShare({
        direction,
        mySiteId,
        otherSiteId,
        scope,
        live: true,
        ptz,
        playback,
        // A WINDOW IS REQUIRED WHEN PLAYBACK IS, and it is the last `h` hours of
        // footage rather than an open end: the server refuses playback with no
        // window, and an unbounded one is not something to offer by accident.
        playbackFrom: playback
          ? new Date(Date.now() - h * 3600_000).toISOString()
          : undefined,
        playbackTo: playback ? new Date().toISOString() : undefined,
        durationSec: Number.isFinite(h) && h > 0 ? Math.round(h * 3600) : 7200,
      });
      onDone();
    } catch (err) {
      const e = err as { message?: string; status?: number };
      setError(
        e?.status === 403
          ? "That is not one of your sites, or those are not your cameras."
          : e?.message || "Could not send that.",
      );
      setBusy(false);
    }
  }, [direction, mySiteId, otherSiteId, towers, ptz, playback, hours, onDone]);

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
          <select
            value={mySiteId}
            onChange={(e) => setMySiteId(e.target.value)}
            className={inputClass}
          >
            {mine.map((s) => (
              <option key={s.site_id} value={s.site_id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={direction === "request" ? "Site to ask" : "Site to share with"}
          hint="The name the administrator gave it."
        >
          <input
            value={otherSiteId}
            onChange={(e) => setOtherSiteId(e.target.value)}
            placeholder="site id"
            className={inputClass}
          />
        </Field>
      </div>
      <Field
        label="Towers"
        hint="One or more device ids, separated by spaces or commas."
      >
        <input
          value={towers}
          onChange={(e) => setTowers(e.target.value)}
          placeholder="kln_northgate_000001"
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-[20px]">
        <Field label="Hours">
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            inputMode="numeric"
            className={inputClass + " max-w-[96px]"}
          />
        </Field>
        {/* THE DEFAULTS ARE THE FASTEST SAFE ONES. Live is always on because it
            is the point; control and footage are decisions. */}
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
          Include the last {hours || "2"} hours of footage
        </label>
      </div>
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
          sites={sites.value}
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
            You are not assigned to a site yet, so there is nothing to share.
            An administrator assigns people to sites.
          </p>
        </Card>
      ) : null}
        </div>
      </div>
    </div>
  );
}
