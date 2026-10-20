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
import { describeControl } from "@/lib/api/ptz";
import { DEFAULT_FEATURES, type Feature } from "@/lib/features";
import { resetCapabilities } from "@/lib/api/sites";
import { resetClient } from "@/lib/api/client";

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

const PEOPLE = [
  {
    account_id: "acct_admin",
    login: "kaduna-mine",
    role: "owner",
    status: "active",
    sites: [],
  },
  {
    account_id: "acct_abu",
    login: "abu.north",
    role: "site_user",
    status: "active",
    sites: ["site_north"],
  },
  {
    account_id: "acct_grace",
    login: "grace.pit",
    role: "site_user",
    status: "active",
    sites: ["site_pit", "site_north"],
  },
  {
    account_id: "acct_new",
    login: "sam.newstarter",
    role: "site_user",
    status: "active",
    sites: [],
  },
  {
    account_id: "acct_gone",
    login: "former.contractor",
    role: "site_user",
    status: "disabled",
    sites: ["site_pit"],
  },
];

const AUDIT = [
  ["share.revoke", "acct_admin", null, hourAgo(0.2)],
  ["share.accept", "acct_abu", null, hourAgo(3)],
  ["session.opened", "acct_grace", "kln_northgate_000001", hourAgo(3.1)],
  ["ptz.command", "acct_grace", "kln_northgate_000001", hourAgo(3.2)],
  ["recording.segment_url", "acct_abu", "kln_southpit_000003", hourAgo(5)],
  ["person.create", "acct_admin", null, hourAgo(26)],
  ["site.hub_assign", "acct_admin", "kln_hub_pit", hourAgo(27)],
  ["login.success", "acct_abu", null, hourAgo(27.5)],
  ["login.failure", null, null, hourAgo(30)],
].map(([action, account_id, device_id, ts], i) => ({
  seq: 900 - i,
  ts,
  action,
  account_id,
  device_id,
  detail: { note: "fixture" },
}));

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

  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === "string" ? input : (input as Request).url);
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
    if (url.includes("/v1/admin/audit"))
      return body({ entries: empty ? [] : AUDIT, limit: 200, offset: 0 });
    if (url.includes("/v1/admin/shares"))
      return body({ shares: empty ? [] : SHARES });
    if (url.includes("/v1/shares")) return body({ shares: empty ? [] : SHARES });
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
          <AcceptedCard share={active} onWatch={() => {}} onDone={dismiss} />
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

function Harness() {
  const [which, setWhich] = useState<string>(
    new URLSearchParams(location.search).get("screen") ?? "admin-sites",
  );
  const screen = SCREENS.find((s) => s.id === which) ?? SCREENS[0];
  install(screen.mode as Mode);

  const body =
    which.startsWith("card-") ? (
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
    ) : which === "ptz-yielded" ? (
      <PtzYielded />
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
