/**
 * The screenshot harness: every new screen, against fixture data, with no
 * server.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS AND WHAT IT IS NOT
 * ══════════════════════════════════════════════════════════════════════
 *
 * These screens need to be reviewable as DESIGN -- "is this the best screen in
 * the product" is a question somebody answers by looking, and the alternative
 * was asking a reviewer to stand up a DC, seed two organizations and six people
 * first. So this mounts the real components, with the real tokens and the real
 * motion, against a stubbed `window.fetch`.
 *
 * **It is not a test.** It asserts nothing. It renders every state worth
 * looking at, including the empty and failed ones, which is exactly what a
 * screenshot pass should capture and what a happy-path demo would miss.
 *
 * **It is not part of the app.** `index.html` does not reference it; only
 * `screens.html` does, and the hub bundle is built from `index.html`. A
 * reviewer runs `npm run dev` and opens `/screens.html`.
 *
 *   npm run dev            then http://localhost:5173/screens.html
 *   npm run screenshots    the same, captured at two widths
 */

import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthContextForHarness } from "@/components/AuthProvider";
import { AdministrationView } from "@/components/AdministrationView";
import { SharesView } from "@/components/SharesView";
import { IconRail } from "@/components/IconRail";
import { AddDeviceDrawer } from "@/components/AddDeviceDrawer";
import { CARD_SKIN, CARD_TITLE, KINDS } from "@/lib/notifications";
import { NotificationProvider, useNotifications } from "@/lib/notifications";
import { NotificationStack } from "@/components/NotificationStack";
import { ShareFeedProvider } from "@/lib/useShareFeed";
import { SharingPane } from "@/components/sharing/SharingPane";
import {
  AcceptedCard,
  EndedCard,
  PendingCard,
  SharedFeedBadge,
} from "@/components/sharing/ShareNotifications";
import { PtzPad } from "@/components/PtzPad";
import { AccessEnded, CameraGone } from "@/components/AccessEnded";
import { describeControl, describePtzFailure } from "@/lib/api/ptz";
import { DEFAULT_FEATURES, type Feature } from "@/lib/features";
import { resetCapabilities } from "@/lib/api/sites";
import { resetClient } from "@/lib/api/client";
import { AUDIT_GROUPS, groupOf } from "@/lib/auditSentence";
import { CameraSettingsPanel } from "@/components/CameraSettingsPanel";
import { DEFAULT_CAMERA_SETTINGS, type CameraFeed, type Tower } from "@/lib/types";
import type { CloudReading } from "@/lib/api/fleet";

/* ------------------------------------------------------------------ *
 * Fixtures: a plausible organization, not a tidy one
 * ------------------------------------------------------------------ */

const SITES = [
  {
    site_id: "site_north",
    name: "North Gate",
    status: "active",
    created_at: "2026-09-01T08:00:00Z",
    hubs: ["kln_hub_north", "kln_hub_northeast"],
  },
  {
    site_id: "site_pit",
    name: "South Pit",
    status: "active",
    created_at: "2026-09-04T08:00:00Z",
    hubs: ["kln_hub_pit"],
  },
  {
    site_id: "site_yard",
    name: "West Yard",
    status: "active",
    created_at: "2026-10-11T08:00:00Z",
    hubs: [],
  },
];

const hourFromNow = (h: number) =>
  new Date(Date.now() + h * 3600_000).toISOString();
const hourAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const SHARES = [
  {
    share_id: "shr_pending_in",
    direction: "request",
    status: "pending",
    owner_site_id: "site_north",
    owner_site_name: "North Gate",
    viewer_site_id: "site_pit",
    viewer_site_name: "South Pit",
    scope: [{ device_id: "kln_northgate_000001" }],
    live: true,
    ptz: true,
    playback: false,
    playback_from: null,
    playback_to: null,
    expires_at: hourFromNow(4),
    created_at: hourAgo(0.08),
    decided_at: null,
    incoming: true,
    outgoing: false,
    /* A REQUEST CARRIES ITS REASON, and on a request card it is most of what
       is on screen: the site being asked has nothing else to decide on. */
    message:
      "Two of our trucks are at your gate until about four. Could we watch the mast while they are on your side?",
    can_answer: true,
    can_end: true,
    can_extend: false,
  },
  {
    share_id: "shr_active",
    direction: "request",
    status: "active",
    owner_site_id: "site_north",
    owner_site_name: "North Gate",
    viewer_site_id: "site_yard",
    viewer_site_name: "West Yard",
    scope: [
      { device_id: "kln_northgate_000001", cameras: [1] },
      { device_id: "kln_northgate_000002" },
    ],
    live: true,
    ptz: false,
    playback: true,
    playback_from: hourAgo(12),
    playback_to: hourAgo(0),
    expires_at: hourFromNow(1.5),
    created_at: hourAgo(3),
    decided_at: hourAgo(3),
    incoming: true,
    outgoing: false,
    can_answer: false,
    can_end: true,
    can_extend: true,
  },
  {
    share_id: "shr_out",
    direction: "request",
    status: "pending",
    owner_site_id: "site_pit",
    owner_site_name: "South Pit",
    viewer_site_id: "site_north",
    viewer_site_name: "North Gate",
    scope: [{ device_id: "kln_southpit_000003" }],
    live: true,
    ptz: false,
    playback: false,
    playback_from: null,
    playback_to: null,
    expires_at: hourFromNow(2),
    created_at: hourAgo(0.5),
    decided_at: null,
    incoming: false,
    outgoing: true,
    can_answer: false,
    can_end: true,
    can_extend: false,
  },
  {
    share_id: "shr_revoked",
    direction: "offer",
    status: "revoked",
    owner_site_id: "site_north",
    owner_site_name: "North Gate",
    viewer_site_id: "site_pit",
    viewer_site_name: "South Pit",
    scope: [{ device_id: "kln_northgate_000002" }],
    live: true,
    ptz: true,
    playback: false,
    playback_from: null,
    playback_to: null,
    expires_at: hourAgo(20),
    created_at: hourAgo(48),
    decided_at: hourAgo(26),
    incoming: true,
    outgoing: false,
    can_answer: false,
    can_end: false,
    can_extend: false,
  },
];

/**
 * The people, as /v1/admin/people reports them.
 *
 * ⚠ THE LOGINS CHANGED MEANING. These used to be arbitrary strings with
 * dots in them -- `abu.north`, `former.contractor` -- and a dot now means
 * `name.organization`, so `abu.north` reads as a person called `abu` in an
 * organization called `north`. Every person here is now `name.kaduna-mine`,
 * matching the organization's own login above them.
 *
 * ⚠ AND ONE HAS BEEN RENAMED. `dele (was chi)` is the only way a reader of
 * a list connects a person to a log entry written under their old name, and
 * it is the kind of row nobody builds a fixture for.
 */
const PEOPLE = [
  {
    /* THE ORGANIZATION'S OWN LOGIN, which IS the administrator: no dot, no
       `name`. A people list that showed it with a blank name would offer
       `disable` on the only administrator. */
    account_id: "acct_admin",
    login: "kaduna-mine",
    role: "owner",
    status: "active",
    sites: [],
  },
  {
    account_id: "acct_abu",
    login: "abu.kaduna-mine",
    name: "abu",
    role: "site_user",
    status: "active",
    sites: ["site_north"],
  },
  {
    account_id: "acct_grace",
    login: "grace.kaduna-mine",
    name: "grace",
    role: "site_user",
    status: "active",
    sites: ["site_pit", "site_north"],
  },
  {
    /* RENAMED, to fix a typo. Their account id did not change, so every
       entry in the log still resolves to them. */
    account_id: "acct_dele",
    login: "dele.kaduna-mine",
    name: "dele",
    was: "chi",
    role: "site_user",
    status: "active",
    sites: ["site_yard"],
  },
  {
    account_id: "acct_new",
    login: "sam.kaduna-mine",
    name: "sam",
    role: "site_user",
    status: "active",
    sites: [],
  },
  {
    /* DISABLED AND NOT DELETED, so the log keeps resolving. */
    account_id: "acct_gone",
    login: "ex.kaduna-mine",
    name: "ex",
    role: "site_user",
    status: "disabled",
    sites: ["site_pit"],
  },
];

/**
 * The ledger, as the DC sends it.
 *
 * ⚠ DETAIL AND NAMES, NOT JUST ACTIONS. The page draws a SENTENCE per row out
 * of the detail and the server's `names` map, so a fixture of bare actions
 * would photograph a page of "Somebody did something". The technical rows are
 * in here on purpose: the website asks the server for four groups and draws
 * nothing for anything else, and a picture of the page is the proof.
 */
interface AuditRow {
  readonly action: string;
  readonly account_id: string | null;
  readonly device_id: string | null;
  readonly ts: string;
  readonly detail: Record<string, unknown>;
}

const AUDIT_ROWS: readonly AuditRow[] = ([
  ["share.revoke", "acct_admin", null, hourAgo(0.2), {}],
  ["share.accept", "acct_abu", null, hourAgo(3),
   { towers: ["kln_northgate_000001", "kln_northgate_000002"] }],
  ["session.opened", "acct_grace", "kln_northgate_000001", hourAgo(3.1), {}],
  ["ptz.command", "acct_grace", "kln_northgate_000001", hourAgo(3.2),
   { pan: 0.3 }],
  ["recording.segment_url", "acct_abu", "kln_southpit_000003", hourAgo(5), {}],
  ["person.remove", "acct_admin", null, hourAgo(20),
   { target: "acct_left", person_name: "tunde", sessions_closed: 1 }],
  ["site.member_add", "acct_admin", null, hourAgo(24),
   { target: "acct_grace", site_id: "site_pit" }],
  ["person.create", "acct_admin", null, hourAgo(26), { created: "acct_new" }],
  ["site.hub_assign", "acct_admin", "kln_hub_pit", hourAgo(27),
   { hub_id: "kln_hub_pit", site_id: "site_pit" }],
  ["login.success", "acct_abu", null, hourAgo(27.5), {}],
  ["login.failure", null, null, hourAgo(30),
   { reason: "wrong_password", org_id: "org_kaduna" }],
  ["login.locked", null, null, hourAgo(30.1),
   { retry_after_sec: 300, org_id: "org_kaduna" }],
] as const).map(([action, account_id, device_id, ts, detail]) => ({
  action: action as string,
  account_id: (account_id ?? null) as string | null,
  device_id: (device_id ?? null) as string | null,
  ts: ts as string,
  detail: detail as Record<string, unknown>,
}));

const AUDIT = AUDIT_ROWS.map((r, i) => ({
  ...r,
  seq: 900 - i,
  /* The actor's name, resolved by the server. "" means nobody did it, which
     is what a refused sign-in and an expiry look like. */
  who: r.account_id === "acct_admin" ? "kaduna-mine"
    : r.account_id === "acct_abu" ? "abu"
    : r.account_id === "acct_grace" ? "grace"
    : "",
}));

/** The id -> name map the DC sends with the page. Removed people included. */
const AUDIT_NAMES = {
  acct_admin: "kaduna-mine",
  acct_abu: "abu",
  acct_grace: "grace",
  acct_new: "sam",
  acct_left: "tunde",
  site_north: "North Gate",
  site_pit: "South Pit",
  site_yard: "West Yard",
  kln_hub_pit: "Pit Office",
  kln_northgate_000001: "North Gate",
  kln_northgate_000002: "North Fence",
  kln_southpit_000003: "Pit Ramp",
};

/* ------------------------------------------------------------------ *
 * The stub
 * ------------------------------------------------------------------ */

type Mode = "full" | "empty" | "failed" | "loading";

function install(mode: Mode) {
  resetCapabilities();
  resetClient();
  const body = (o: unknown) =>
    new Response(JSON.stringify(o), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as Request).url);
    const method = (
      init?.method ?? (typeof input === "object" && "method" in input
        ? (input as Request).method
        : "GET")
    ).toUpperCase();
    /* THE CAPABILITY PROBE ANSWERS IN EVERY MODE, before the mode is even
       looked at. "loading" and "failed" are states of THIS SCREEN's data, not
       of what the server is: letting them swallow /v1/capabilities would empty
       the rail as well, and a screenshot of a refused page would also be a
       screenshot of a rail that is missing two destinations for an unrelated
       reason. */
    if (url.includes("/v1/capabilities"))
      return body({ role: "datacenter", features: { sites: true } });
    if (mode === "loading") {
      // Never resolves: this is what the skeleton state actually looks like.
      return new Promise<Response>(() => {});
    }
    if (mode === "failed") {
      return new Response(
        JSON.stringify({
          error: { code: "forbidden", message: "This account may not see that." },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    const empty = mode === "empty";
    if (url.includes("/v1/admin/people"))
      return body({ people: empty ? [] : PEOPLE });
    if (url.includes("/v1/admin/audit")) {
      /* ⚠ EVERY FILTER IS THE SERVER'S, so the stub honours all four or the
         harness proves nothing about the page that sends them. Same rules as
         `_audit` on the DC: the groups name the actions, the person is the
         row's account, and the dates are compared as ISO strings.

         The page's filters were DEAD on the real site -- `useLoader` never
         watched the filter, so the first request was the only request -- and a
         stub that answered everything the same way could not have shown it. */
      /* ⚠ RECORDED, BECAUSE A STUBBED FETCH MAKES NO NETWORK REQUEST.
         The browser check for the filters has to prove the page ASKED for
         them, and `page.on("request")` sees nothing here: `install()` replaces
         `window.fetch` with a function that returns a Response. So the harness
         keeps the list, and the test reads it. Harness only: `screens.tsx` is
         not in the shipped bundle. */
      const log = (window as unknown as { __auditAsked?: string[] });
      log.__auditAsked = [...(log.__auditAsked ?? []), url];
      const q = new URL(url, "http://x").searchParams;
      const asked = q.get("groups");
      const groups = asked ? asked.split(",") : [];
      const who = q.get("account_id") ?? "";
      const since = q.get("since") ?? "";
      const until = q.get("until") ?? "";
      const keep = (e: { action: string; account_id: string | null; ts: string }) =>
        (groups.length === 0 || groups.includes(groupOf(e as never) ?? ""))
        && (!who || e.account_id === who)
        && (!since || e.ts >= since)
        && (!until || e.ts <= until);
      return body({
        entries: empty ? [] : AUDIT.filter(keep),
        limit: 200,
        offset: 0,
        names: AUDIT_NAMES,
        groups: AUDIT_GROUPS.map((g) => g.id),
      });
    }
    if (url.includes("/v1/admin/shares"))
      return body({ shares: empty ? [] : SHARES });
    if (url.includes("/v1/shares")) {
      /* ⚠ A POST IS A CREATE AND ANSWERS LIKE ONE. The stub used to return
         the LIST to every call on this path, so asking for more time from a
         tile whose share had ended got "We could not read the server's
         answer" -- the harness failing, photographed as though the product
         were. One share back, in the shape the SDK parses. */
      if (method === "POST") {
        return body({
          share: {
            ...SHARES[0],
            share_id: "shr_asked_again",
            direction: "request",
            status: "pending",
            owner_site_id: "site_north",
            owner_site_name: "North Gate",
            viewer_site_id: "site_pit",
            viewer_site_name: "South Pit",
            incoming: false,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          },
        });
      }
      return body({ shares: empty ? [] : SHARES });
    }
    /* One site's cells, for the tower picker. Before the list below, because
       `/v1/sites/site_north` also contains `/v1/sites`. */
    if (/\/v1\/sites\/[^/?]+$/.test(url))
      return body({
        site: SITES[0],
        cells: [
          {
            hub_id: "kln_hub_northgate",
            towers: ["kln_northgate_000001", "kln_northgate_000002"],
          },
        ],
      });
    /* The §A.3 PROJECTED SHAPE, not a convenient approximation. The SDK
       validates this at the client boundary and a fixture that is nearly
       right fails the whole list, which renders as a tower picker full of
       device ids -- which is exactly what the first run of these screenshots
       showed. */
    if (url.includes("/v1/viewer/towers"))
      return body({
        towers: [
          {
            device_id: "kln_northgate_000001",
            label: "North Gate mast",
            link: "up",
            as_of: new Date().toISOString(),
            cameras: [
              { index: 1, lens: "ptz", ptz_capable: true, status: "live",
                resolution: { width: 2560, height: 1440 } },
              { index: 2, lens: "fixed", ptz_capable: false, status: "live",
                resolution: { width: 1920, height: 1080 } },
            ],
            sensors: [],
          },
          {
            device_id: "kln_northgate_000002",
            label: "Gatehouse",
            link: "down",
            as_of: new Date().toISOString(),
            cameras: [
              { index: 1, lens: "fixed", ptz_capable: false, status: "unknown",
                resolution: { width: 1920, height: 1080 } },
            ],
            sensors: [],
          },
        ],
      });
    /* THE CELLS, NAMED. The whole point of these screens: a site's cells
       were hub ids before, and a reviewer has to be able to see that they
       are "North Camp" now. One cell is NEARLY FULL and one is OFFLINE,
       because those are the two states a fixture never has by accident. */
    if (/\/v1\/cells\/[^/]+$/.test(url))
      return body({
        cell: CELLS[0],
        towers: [
          { device_id: "kln_northgate_000001", name: "North Gate",
            last_seen: new Date().toISOString() },
          { device_id: "kln_northgate_000002", name: "North Fence",
            last_seen: new Date().toISOString() },
          { device_id: "kln_northgate_000003", name: "Weighbridge" },
        ],
      });
    if (url.includes("/v1/cells"))
      return body({ cells: empty ? [] : CELLS });
    if (url.includes("/v1/sites"))
      return body({
        sites: empty ? [] : SITES,
        others: empty
          ? []
          : [
              { site_id: "site_yard", name: "West Yard" },
              { site_id: "site_pit", name: "South Pit" },
            ],
        unassigned_hubs: empty ? [] : ["kln_hub_spare", "kln_hub_eastridge"],
      });
    return body({});
  }) as typeof window.fetch;
}

/**
 * The cells, as /v1/cells reports them.
 *
 * ⚠ ONE IS NEARLY FULL AND ONE IS OFFLINE, on purpose. Those are the two
 * states that carry amber on this screen, and a fixture where every cell is
 * healthy photographs a screen that cannot warn anybody about anything.
 */
const CELLS = [
  {
    hub_id: "kln_hub_northgate", name: "North Camp",
    site_id: "site_north", site_name: "North Gate", status: "active",
    towers: 3, online: true, capacity: 4, full: false, filling: true,
  },
  {
    hub_id: "kln_hub_pit", name: "Pit Office",
    site_id: "site_pit", site_name: "South Pit", status: "active",
    towers: 1, online: false, capacity: 4, full: false, filling: false,
  },
  {
    hub_id: "kln_hub_yard", name: "Yard Shed",
    site_id: "site_yard", site_name: "West Yard", status: "active",
    towers: 4, online: true, capacity: 4, full: true, filling: true,
  },
] as const;

/**
 * The signed-in person, BY ROLE.
 *
 * ⚠ THE SCREENS DIFFER BY ROLE NOW, so the harness has to be able to be
 * both. An administrator sees every share and answers none of them; a site
 * user sees their own and answers the ones addressed to their site. A harness
 * stuck as an admin would photograph an Accept button that no administrator
 * can press, which is the bug these screens exist to document the fix for.
 */
const sessionAs = (role: "owner" | "site_user", login: string) => ({
  status: "signed-in" as const,
  account: {
    account_id: role === "owner" ? "acct_admin" : "acct_ada",
    login,
    role,
    status: "active",
  },
  features: new Set<Feature>(DEFAULT_FEATURES),
  endedReason: null,
  pending: false,
  signIn: async () => {},
  signOut: async () => {},
});

const SESSION = sessionAs("owner", "kaduna-mine");
const SESSION_SITE_USER = sessionAs("site_user", "ada");

/* ------------------------------------------------------------------ *
 * The harness page
 * ------------------------------------------------------------------ */

const SCREENS = [
  { id: "admin-sites", label: "Administration · Sites", mode: "full" },
  { id: "admin-empty", label: "Administration · nothing yet", mode: "empty" },
  { id: "admin-loading", label: "Administration · loading", mode: "loading" },
  { id: "admin-failed", label: "Administration · refused", mode: "failed" },
  { id: "shares", label: "Shares", mode: "full" },
  { id: "shares-empty", label: "Shares · nothing waiting", mode: "empty" },
  /* THE RAIL IS HERE FOR ITS ICONS. Administration had no glyph of its own and
     borrowed the Settings gear, so the rail carried two identical gears; the
     drawn `nav-admin` is the fix, and a rail nobody photographs is a rail
     where that regresses unnoticed. */
  { id: "rail", label: "Icon rail (sites on)", mode: "full" },
  /* The PTZ pad as a SHARED site sees it while the owning site is driving. */
  { id: "ptz-yielded", label: "PTZ yielded to the owner", mode: "full" },
  /* ── THE CARDS ──────────────────────────────────────────────────────
     Every state one can be in, over a stand-in for the video, because the
     whole claim of this feature is that it never covers the picture. */
  { id: "card-request", label: "Card: new request", mode: "full" },
  { id: "card-expanded", label: "Card: expanded", mode: "full" },
  { id: "card-offer", label: "Card: an offer", mode: "full" },
  { id: "card-undo", label: "Card: declined, undo", mode: "full" },
  { id: "card-accepted", label: "Card: accepted", mode: "full" },
  { id: "card-ended", label: "Card: ended", mode: "full" },
  { id: "card-stack", label: "Cards: three, stacked", mode: "full" },
  /* ── THE PAGE ───────────────────────────────────────────────────────── */
  { id: "sharing-new", label: "Sharing: new request", mode: "full" },
  { id: "sharing-offer", label: "Sharing: share a feed", mode: "full" },
  { id: "sharing-incoming", label: "Sharing: incoming", mode: "full" },
  { id: "sharing-outgoing", label: "Sharing: outgoing", mode: "full" },
  { id: "sharing-active", label: "Sharing: active", mode: "full" },
  { id: "sharing-history", label: "Sharing: history", mode: "full" },
  { id: "sharing-empty", label: "Sharing: nothing yet", mode: "empty" },
  /* The same page as an ADMINISTRATOR: every share, and nothing to answer. */
  { id: "sharing-admin-all", label: "Sharing: admin, all shares", mode: "full" },
  /* ── CELLS, TOWERS AND PEOPLE ───────────────────────────────────────
     The screens this change adds. Each of the add-drawer states is here
     because each is a sentence somebody reads at a mast, and prose cannot
     show whether it fits. */
  { id: "add-cell", label: "Add a cell", mode: "full" },
  { id: "add-tower", label: "Add a tower", mode: "full" },
  { id: "add-waiting", label: "Add: waiting", mode: "full" },
  { id: "add-queued", label: "Add: queued (cell offline)", mode: "full" },
  { id: "add-failed", label: "Add: refused", mode: "full" },
  { id: "add-full", label: "Add: cell full", mode: "full" },
  { id: "admin-people", label: "Administration · People", mode: "full" },
  { id: "card-fleet", label: "Card: a tower was added", mode: "full" },
  { id: "card-revoked", label: "Card: a tower was removed", mode: "full" },
  /* ── WHAT A TILE SAYS WHEN IT CANNOT SHOW THE PICTURE ───────────────
     The three states that used to be one shouted line with a device serial
     in it ("kln_lab_000002 IS UNAVAILABLE"). They are photographed because
     they are what somebody is looking at when they stop being able to see,
     which is the worst moment to be read machinery. */
  { id: "tile-ended", label: "Tile: access ended", mode: "full" },
  { id: "tile-offline", label: "Tile: camera offline", mode: "full" },
  /* And the refusal a shared viewer meets when steering was not included. */
  { id: "ptz-refused", label: "PTZ: not included in the share", mode: "full" },
  /* ── TOWER SETTINGS, AND A HUB MAST'S ───────────────────────────────
     Photographed because the whole point of the change is which rows are
     READINGS and which are controls, and that is visible and not describable:
     a reviewer has to see that "Keep footage for" has no chevron and carries
     "Set by Kallon" under it, and that the Network group says different things
     on the two boxes. Lab-shaped values throughout -- a mast at -62 dBm on
     sector B, a hub on fibre with three sectors and an archive disk. */
  { id: "settings-tower", label: "Tower settings (real data)", mode: "full" },
  { id: "settings-hub", label: "Hub mast settings (real data)", mode: "full" },
] as const;

/* ------------------------------------------------------------------ *
 * The cards, over a stand-in for the video
 * ------------------------------------------------------------------ */

/** A dark rectangle with a badge on it: enough to prove the card clears. */
function FakeWall({ borrowed }: { borrowed?: boolean }) {
  return (
    <div className="grid h-full w-full grid-cols-2 gap-[10px] bg-ink p-[10px]">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded-[10px] bg-tile"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 14px, transparent 14px 28px)",
          }}
        >
          <div className="absolute left-[16px] top-[10px] flex flex-col gap-[6px]">
            <span className="chip-blur rounded-[4px] bg-black/50 px-[8px] py-[3px] font-display text-[0.6875rem] uppercase tracking-[0.11px] text-sub">
              {["Gate", "Yard", "Perimeter", "Loading"][i]}
            </span>
            {borrowed && i === 0 ? (
              <SharedFeedBadge share={SHARES[1] as never} />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Seeds the stack with exactly what a screenshot needs, then stands back. */
function Seed({ which }: { which: string }) {
  const { notify } = useNotifications();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const request = SHARES[0] as never;
    const offer = { ...SHARES[0], direction: "offer", ptz: true, playback: true } as never;
    const active = SHARES[1] as never;

    if (which === "card-request" || which === "card-stack") {
      notify({
        id: "c1",
        kind: "share",
        at: Date.now() - 40_000,
        persistent: true,
        title: "South Pit is asking",
        render: ({ dismiss }) => <PendingCard share={request} onDone={dismiss} />,
      });
    }
    if (which === "card-expanded") {
      notify({
        id: "c2",
        kind: "share",
        at: Date.now(),
        persistent: true,
        title: "South Pit is asking",
        render: ({ dismiss }) => (
          <PendingCard initialOpen share={request} onDone={dismiss} />
        ),
      });
    }
    if (which === "card-offer" || which === "card-stack") {
      notify({
        id: "c3",
        kind: "share",
        at: Date.now() - 120_000,
        persistent: true,
        title: "South Pit is offering",
        render: ({ dismiss }) => <PendingCard share={offer} onDone={dismiss} />,
      });
    }
    if (which === "card-accepted" || which === "card-stack") {
      notify({
        id: "c4",
        kind: "share",
        at: Date.now() - 5_000,
        title: "North Gate accepted",
        render: ({ dismiss }) => (
          <AcceptedCard share={active} onDone={dismiss} />
        ),
      });
    }
    if (which === "card-ended") {
      notify({
        id: "c5",
        kind: "system",
        at: Date.now(),
        title: "The share with West Yard ran out",
        render: ({ dismiss }) => (
          <EndedCard
            text="The share with West Yard ran out. Those cameras are no longer on your board."
            onDone={dismiss}
          />
        ),
      });
    }
  }, [notify, which]);
  return null;
}

function Cards({ which }: { which: string }) {
  return (
    <NotificationProvider>
      <ShareFeedProvider enabled={false}>
        <div className="relative h-full w-full">
          <FakeWall borrowed={which === "card-accepted"} />
          <Seed which={which} />
          <NotificationStack />
        </div>
      </ShareFeedProvider>
    </NotificationProvider>
  );
}

/** The undo state is a state of the card, so it is driven rather than faked. */
function UndoCard() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    /* Press Decline once the card is on screen: the countdown is the thing
       being photographed, and faking it would photograph a different
       component from the one that ships. */
    const t = setTimeout(() => {
      const buttons = ref.current?.querySelectorAll("button") ?? [];
      for (const b of Array.from(buttons)) {
        if (b.textContent?.trim() === "Decline") {
          (b as HTMLButtonElement).click();
          break;
        }
      }
    }, 350);
    return () => clearTimeout(t);
  }, []);
  return (
    <NotificationProvider>
      <ShareFeedProvider enabled={false}>
        <div ref={ref} className="relative h-full w-full">
          <FakeWall />
          <Seed which="card-request" />
          <NotificationStack />
        </div>
      </ShareFeedProvider>
    </NotificationProvider>
  );
}

function SharingScreen({ tab }: { tab: string }) {
  return (
    <ShareFeedProvider>
      <div className="h-full w-full overflow-y-auto bg-ink px-[16px] py-[20px] sm:px-[28px]">
        <div className="mx-auto w-full max-w-[720px]">
          <SharingPane startOn={tab as never} />
        </div>
      </div>
    </ShareFeedProvider>
  );
}

/**
 * The pad, and the line that says why it will not move.
 *
 * ⚠ THE CHIP'S CLASSES ARE MIRRORED FROM `CameraTile`, not imported, and
 * that is the one compromise in this file: the tile needs a live peer
 * connection, a session and a fleet to mount, which is what this harness
 * exists to avoid. The PAD is the real component and the TEXT comes from the
 * real `describeControl`, so the two things worth reviewing here are the
 * product's own. If the chip is restyled in the tile, restyle it here.
 */
function PtzYielded() {
  const held = describeControl({
    held: true,
    yours: false,
    holder_site: "North Gate",
    holder_is_owner: true,
    expires_in_sec: 41,
  });
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[28px] bg-ink">
      <div className="relative h-[220px] w-[320px] rounded-[8px] bg-panel">
        <div className="absolute bottom-[18px] left-[16px]">
          <PtzPad disabled />
        </div>
        <div className="chip-blur absolute bottom-[18px] left-[104px] rounded-[4px] bg-black/60 px-[8px] py-[4px]">
          <p className="font-display text-[0.75rem] tracking-[0.11px] text-body-ink lg:text-[0.6875rem]">
            {held}
          </p>
        </div>
      </div>
      <p className="max-w-[420px] px-[24px] text-center text-[0.8125rem] leading-[20px] text-muted">
        Ordinary ink, not red and not amber: nothing is wrong and nothing is
        wanted. The camera's own site is driving a camera it owns, and the line
        lasts as long as their hold rather than the four seconds a fault lasts.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The add drawer, in each of its outcomes
 *
 * ⚠ DRIVEN THROUGH THE REAL COMPONENT, with the server's answer stubbed per
 * screen. The alternative was four hand-built mock-ups of a drawer, which
 * would photograph whatever I imagined rather than what it renders -- and the
 * whole reason these states are worth a picture is that each one is a
 * sentence somebody reads at a mast, and prose cannot show whether it fits.
 * ------------------------------------------------------------------ */

function AddScreen({ which }: { which: string }) {
  const what = which === "add-tower" || which === "add-queued"
    || which === "add-full" ? "tower" : "cell";

  /* The outcome the stubbed POST produces, which is what puts the drawer
     into the state being photographed. */
  useEffect(() => {
    const original = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      const post = (init?.method ?? "GET").toUpperCase() === "POST";
      if (post && (url.includes("/v1/cells") || url.includes("/v1/towers"))) {
        const answer = {
          "add-waiting": {
            status: 201,
            body: {
              pending: {
                claim_id: "clm_demo", name: "South Camp", what: "cell",
                status: "open",
                expires_at: new Date(Date.now() + 13 * 60_000).toISOString(),
              },
            },
          },
          "add-queued": {
            status: 202,
            body: {
              pending: {
                queued: true, name: "Far Gate", hub_id: "kln_hub_pit",
                status: "waiting_for_cell",
                message: "That cell is offline. The tower will be added as "
                  + "soon as it reconnects.",
              },
            },
          },
          "add-failed": {
            status: 409,
            body: {
              error: {
                code: "claim_conflict",
                message: "another account already has an open claim for "
                  + "this code",
              },
            },
          },
          "add-full": {
            status: 409,
            body: {
              error: {
                code: "cell_full",
                message: "Yard Shed is full: 4 of 4 towers. Remove one, or "
                  + "add this tower to another cell.",
              },
            },
          },
        }[which];
        if (answer) {
          return new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { "content-type": "application/json" },
          });
        }
      }
      return original(input as never, init);
    }) as typeof window.fetch;
    return () => {
      window.fetch = original;
    };
  }, [which]);

  /* Fill the form and press Add, for the screens that photograph an
     OUTCOME. The three form screens are left as the form. */
  useEffect(() => {
    if (which === "add-cell" || which === "add-tower") return;
    const t = window.setTimeout(() => {
      const root = document.querySelector('[role="dialog"]');
      if (!root) return;
      const inputs = [...root.querySelectorAll("input")];
      const selects = [...root.querySelectorAll("select")];
      const set = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
        const proto = el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      if (selects[0]) set(selects[0], selects[0].options[1]?.value ?? "");
      if (inputs[0]) set(inputs[0], what === "cell" ? "South Camp" : "Far Gate");
      if (inputs[1]) set(inputs[1], "7Q2K-4M9X-ABCD");
      window.setTimeout(() => {
        const add = [...root.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Add",
        );
        add?.click();
      }, 60);
    }, 120);
    return () => window.clearTimeout(t);
  }, [which, what]);

  return (
    <div className="relative h-full w-full bg-ink">
      <FakeWall />
      <AddDeviceDrawer
        open
        what={what as "cell" | "tower"}
        sites={SITES as never}
        cells={CELLS as never}
        onClose={() => {}}
        onAdded={() => {}}
      />
    </div>
  );
}

/* The two new card kinds, over the wall, where they actually appear. */
function FleetCards({ which }: { which: string }) {
  const removed = which === "card-revoked";
  return (
    <div className="relative h-full w-full bg-ink">
      <FakeWall />
      <div className="absolute right-[16px] top-[16px] flex w-[320px] flex-col gap-[10px]">
        <HarnessCard
          kind={removed ? "revoked" : "fleet"}
          title={removed
            ? "A tower was removed: North Fence"
            : "A tower was added: North Fence"}
          body={removed
            ? "Its keys are revoked. Recordings stay until normal retention."
            : "It will appear when the equipment comes online."}
        />
        {removed ? null : (
          <HarnessCard
            kind="fleet"
            title="A cell is queued for an offline cell: Far Gate"
            body={"Nothing was sent yet. It goes out when the cell "
              + "reconnects, and its fifteen minutes start then."}
          />
        )}
      </div>
    </div>
  );
}

/** One card, drawn with the real tokens for the kind. */
function HarnessCard({
  kind,
  title,
  body,
}: {
  kind: "fleet" | "revoked";
  title: string;
  body: string;
}) {
  const k = KINDS[kind];
  return (
    /* The real tokens: the app's card, and the kind as a strip along the top.
       `overflow-hidden` so the strip takes the card's own corners. */
    <div className={`overflow-hidden rounded-[12px] border ${CARD_SKIN}`}>
      <div className={`h-[2px] w-full ${k.strip}`} aria-hidden />
      <div className="flex flex-col gap-[6px] px-[14px] py-[12px]">
        <span className={`font-display text-[0.8125rem] ${CARD_TITLE}`}>
          {title}
        </span>
        <span className="text-[0.75rem] leading-[16px] text-muted">{body}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A tile that cannot show the picture, and why
 * ------------------------------------------------------------------ */

/** The share that lent a camera and has since finished. */
const ENDED_SHARE = {
  share_id: "shr_ended",
  direction: "offer" as const,
  status: "expired" as const,
  owner_site_id: "site_north",
  owner_site_name: "North Gate",
  viewer_site_id: "site_pit",
  viewer_site_name: "South Pit",
  incoming: false,
  scope: [{ device_id: "kln_northgate_000001" }],
  live: true,
  ptz: false,
  playback: false,
  created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  decided_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  expires_at: new Date(Date.now() - 60_000).toISOString(),
};

function TileState({ which }: { which: string }) {
  return (
    <ShareFeedProvider enabled={false}>
      <div className="flex h-full w-full items-center justify-center bg-ink p-[24px]">
        {/* Tile-shaped, because the point of these words is that they fit
            inside one card on a wall of nine. */}
        <div className="h-[320px] w-[520px] overflow-hidden rounded-[12px] border border-line bg-tile">
          {which === "tile-ended" ? (
            <AccessEnded share={ENDED_SHARE as never} onClose={() => {}} />
          ) : (
            <CameraGone reason="offline" onClose={() => {}} />
          )}
        </div>
      </div>
    </ShareFeedProvider>
  );
}

/** The arrow a viewer pressed, and what the refusal says now. */
function PtzRefused() {
  const refusal = describePtzFailure({ code: "ptz_forbidden", status: 403 });
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[28px] bg-ink">
      <div className="relative h-[220px] w-[320px] rounded-[8px] bg-panel">
        <div className="absolute bottom-[18px] left-[16px]">
          <PtzPad disabled />
        </div>
        <div className="chip-blur absolute bottom-[18px] left-[104px] max-w-[200px] rounded-[4px] bg-black/60 px-[8px] py-[4px]">
          <p className="font-display text-[0.75rem] leading-[16px] tracking-[0.11px] text-body-ink">
            {refusal}
          </p>
        </div>
      </div>
      <p className="max-w-[420px] px-[24px] text-center text-[0.8125rem] leading-[20px] text-muted">
        It said &ldquo;PTZ FAILED &mdash; PTZ_FORBIDDEN&rdquo;. A share is per
        camera and per capability, so the sentence names what was not included
        and leaves the next step obvious: ask the site that lent it.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tower settings, and a hub mast's: every row real, read-only, or absent
 * ------------------------------------------------------------------ */

/* ⚠ LAB VALUES, SHAPED EXACTLY AS THE WIRE CARRIES THEM. Each one is here to
   put a particular row into the state worth photographing:

     radio.signal_dbm -62 from the TOWER's own radio    -> "Good · -62 dBm"
     recording mode hub, stream main                    -> the 2K stream
     disk absent on the tower                           -> "Recorded at the hub"
     battery absent                                     -> "Not connected"
     cloud connected over Fibre at 42 ms                -> the Kallon Cloud row

   Nothing here is a reading the product invents: every field below exists on
   the wire, and a reviewer comparing this frame to a lab tower should see the
   same rows with that tower's numbers in them. */
const SETTINGS_TOWER: Tower = {
  id: "kln_northgate_000001",
  site: "NORTH GATE",
  status: "online",
  online: true,
  asOf: Date.now() - 20_000,
  healthAsOf: Date.now() - 20_000,
  connectedAt: Date.now() - 3 * 24 * 3600 * 1000 - 4 * 3600 * 1000,
  model: "TWR-2CR-PTZ",
  serial: "KLN-T-2610-0001",
  boardSerial: "1424422012345",
  firmware: "v1.5.0-255",
  firmwareChannel: "stable",
  health: {
    radio: {
      associated: true,
      nodeId: 1,
      state: "up",
      sector: "B",
      signalDbm: -62,
      signalFrom: "tower",
    },
    /* The footage is the hub's. A tower on an SD card has no disk to offer and
       must not print its root filesystem as the site's storage.

       ⚠ AND NO `stream`. `RECORD_STREAM` says what THIS box would write; with
       the hub writing, the hub's config decides, and a tower repeating its own
       unused value would state somebody else's behaviour from the one box that
       cannot know it. The hub's own fixture below carries the stream. */
    recording: { mode: "hub" },
    thermal: { socC: 47, state: "ok" },
  },
};

/** The hub's own mast: its uplink, its sectors, its archive. */
const SETTINGS_HUB: Tower = {
  id: "kln_hub_kaduna",
  site: "KADUNA HUB",
  status: "online",
  online: true,
  kind: "hub",
  asOf: Date.now() - 12_000,
  healthAsOf: Date.now() - 12_000,
  /* The hub's link to Kallon Cloud, in the tower's own `connected_at` field.
     A real hub fills it from its uplink agent's published state. */
  connectedAt: Date.now() - 9 * 24 * 3600 * 1000,
  model: "HUB-3S",
  serial: "KLN-H-2610-0001",
  boardSerial: "1424498765432",
  firmware: "v1.5.0-255",
  firmwareChannel: "stable",
  /* The ARCHIVE disk, from the archiver's own status file -- not a fixture and
     not the hub's root filesystem. */
  storageUsedGb: 1218,
  storageTotalGb: 2118,
  health: {
    /* How this hub reaches the cloud, in the tower's own field. A real hub
       fills this from HUB_INTERNET. */
    uplink: { type: "Fibre" },
    disk: { freePct: 42.5 },
    /* ⚠ THE ROW THAT WAS A PROMISE ABOUT EVIDENCE. Asked for thirty days, and
       the disk fills at about twelve, so both numbers are here and the screen
       says which is deciding. */
    recording: {
      mode: "hub",
      stream: "sub",
      retainDays: 30,
      effectiveDays: 12.4,
      boundBy: "disk",
    },
    sectors: [
      {
        id: "A",
        state: "up",
        azimuth: 0,
        ssid: "kallon-kaduna",
        associations: "observed",
        towers: ["kln_northgate_000001"],
        towerSignals: [{ deviceId: "kln_northgate_000001", signalDbm: -62 }],
      },
      {
        id: "B",
        state: "up",
        azimuth: 120,
        ssid: "kallon-kaduna",
        associations: "observed",
        towers: ["kln_southpit_000003", "kln_yard_000004"],
        towerSignals: [
          { deviceId: "kln_southpit_000003", signalDbm: -58 },
          { deviceId: "kln_yard_000004", signalDbm: -77 },
        ],
      },
      /* A radio that would not answer its station list. `associations:
         "unknown"` carries NO tower list, and the row says the masts were not
         read rather than claiming the sector is empty. */
      { id: "C", state: "up", azimuth: 240, associations: "unknown" },
    ],
  },
};

const SETTINGS_FEEDS: CameraFeed[] = [
  {
    id: "kln_northgate_000001:1",
    towerId: "kln_northgate_000001",
    index: 1,
    name: "GATE",
    state: "live",
    ptz: true,
    profiles: [
      { id: "sub", resolution: { width: 704, height: 576 }, default: true },
      { id: "main", resolution: { width: 2560, height: 1440 } },
    ],
  },
  {
    id: "kln_northgate_000001:2",
    towerId: "kln_northgate_000001",
    index: 2,
    name: "YARD",
    state: "live",
    ptz: false,
    profiles: [
      { id: "sub", resolution: { width: 704, height: 576 }, default: true },
      { id: "main", resolution: { width: 2560, height: 1440 } },
    ],
  },
] as unknown as CameraFeed[];

const SETTINGS_CLOUD: CloudReading = {
  connected: true,
  iface: "Fibre",
  since: new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString(),
  latencyMs: 42,
};

function SettingsScreen({ which }: { which: string }) {
  const hub = which === "settings-hub";
  /* ⚠ THE HUB MAST'S CAMERA ADVERTISES NO PROFILES, and that is the fixture
     being honest rather than convenient. A hub's own mast reports no stream
     list on the wire, which is why Picture quality on that page was blank
     while the tower's beside it read "Standard" off a profile set. The row
     names the one quality a camera without a list has; copying the tower's
     profiles in here would have hidden the thing the screen is for. */
  const feeds = hub
    ? ([{
        ...SETTINGS_FEEDS[0],
        id: "kln_hub_kaduna:1",
        towerId: "kln_hub_kaduna",
        name: "HUB MAST",
        profiles: undefined,
      }] as unknown as CameraFeed[])
    : SETTINGS_FEEDS;
  return (
    <div className="flex h-full w-full justify-end bg-ink">
      <CameraSettingsPanel
        tower={hub ? SETTINGS_HUB : SETTINGS_TOWER}
        cloud={SETTINGS_CLOUD}
        feeds={feeds}
        settings={DEFAULT_CAMERA_SETTINGS}
        onChange={() => {}}
        onRename={() => {}}
        onClose={() => {}}
        className="w-[420px] max-w-full"
      />
    </div>
  );
}

function Harness() {
  const [which, setWhich] = useState<string>(
    new URLSearchParams(location.search).get("screen") ?? "admin-sites",
  );
  const screen = SCREENS.find((s) => s.id === which) ?? SCREENS[0];
  install(screen.mode as Mode);

  const body =
    /* ⚠ THE TWO FLEET CARDS COME FIRST, because `card-fleet` and
       `card-revoked` also start with "card-": the prefix below swallowed them
       and handed them to `Cards`, which has nothing for those ids, so both
       screens photographed an empty wall and the branch further down was
       dead. Caught by looking at the pictures. */
    which === "card-fleet" || which === "card-revoked" ? (
      <FleetCards which={which} />
    ) : which.startsWith("card-") ? (
      which === "card-undo" ? <UndoCard /> : <Cards which={which} />
    ) : which.startsWith("sharing-") ? (
      <SharingScreen
        tab={which
          .slice("sharing-".length)
          .replace("empty", "incoming")
          .replace("admin-all", "all")}
      />
    ) : which === "rail" ? (
      <div className="flex h-full w-full bg-ink">
        <IconRail active="admin" sites admin />
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-[420px] px-[24px] text-center text-[0.8125rem] leading-[20px] text-muted">
            Shares and Administration appear only when the server has sites.
            Administration is the lower glyph: one node above two, joined. One
            gear in the rail, not two.
          </p>
        </div>
      </div>
    ) : which.startsWith("add-") ? (
      <AddScreen which={which} />
    ) : which === "admin-people" ? (
      <AdministrationView />
    ) : which === "ptz-yielded" ? (
      <PtzYielded />
    ) : which === "ptz-refused" ? (
      <PtzRefused />
    ) : which.startsWith("settings-") ? (
      <SettingsScreen which={which} />
    ) : which.startsWith("tile-") ? (
      <TileState which={which} />
    ) : which.startsWith("shares") ? (
      <SharesView />
    ) : (
      <AdministrationView />
    );

  return (
    <AuthContextForHarness.Provider
      value={
        (which.startsWith("sharing-admin") || !which.startsWith("sharing-")
          ? SESSION
          : SESSION_SITE_USER) as never
      }
    >
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink">
        {/* The picker is the harness, not the product. Deliberately plain, so
            nothing here can be mistaken for a screen under review. */}
        <div
          data-harness-chrome
          className="flex shrink-0 flex-wrap gap-[6px] border-b border-line bg-panel px-[12px] py-[8px]"
        >
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setWhich(s.id);
                history.replaceState(null, "", `?screen=${s.id}`);
              }}
              className={
                "rounded-[6px] border px-[8px] py-[3px] text-[0.75rem] " +
                (s.id === which
                  ? "border-action bg-action text-action-ink"
                  : "border-stroke text-muted")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1" data-screen={which}>
          {body}
        </div>
      </div>
    </AuthContextForHarness.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
