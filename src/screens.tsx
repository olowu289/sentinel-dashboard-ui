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

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthContextForHarness } from "@/components/AuthProvider";
import { AdministrationView } from "@/components/AdministrationView";
import { SharesView } from "@/components/SharesView";
import { ShareRequestBanner } from "@/components/ShareRequestBanner";
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
    if (url.includes("/v1/capabilities"))
      return body({ role: "datacenter", features: { sites: true } });
    if (url.includes("/v1/admin/people"))
      return body({ people: empty ? [] : PEOPLE });
    if (url.includes("/v1/admin/audit"))
      return body({ entries: empty ? [] : AUDIT, limit: 200, offset: 0 });
    if (url.includes("/v1/admin/shares"))
      return body({ shares: empty ? [] : SHARES });
    if (url.includes("/v1/shares")) return body({ shares: empty ? [] : SHARES });
    if (url.includes("/v1/sites"))
      return body({
        sites: empty ? [] : SITES,
        unassigned_hubs: empty ? [] : ["kln_hub_spare", "kln_hub_eastridge"],
      });
    return body({});
  }) as typeof window.fetch;
}

const SESSION = {
  status: "signed-in" as const,
  account: {
    account_id: "acct_admin",
    login: "kaduna-mine",
    role: "owner",
    status: "active",
  },
  features: new Set<Feature>(DEFAULT_FEATURES),
  endedReason: null,
  pending: false,
  signIn: async () => {},
  signOut: async () => {},
};

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
  { id: "banner", label: "Incoming request banner", mode: "full" },
] as const;

function Harness() {
  const [which, setWhich] = useState<string>(
    new URLSearchParams(location.search).get("screen") ?? "admin-sites",
  );
  const screen = SCREENS.find((s) => s.id === which) ?? SCREENS[0];
  install(screen.mode as Mode);

  const body =
    which === "banner" ? (
      <div className="flex h-full w-full flex-col bg-ink">
        <ShareRequestBanner
          shares={SHARES.filter((s) => s.status === "pending" && s.incoming) as never}
          onReview={() => {}}
          onAnswered={() => {}}
        />
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-[420px] px-[24px] text-center text-[0.8125rem] leading-[20px] text-muted">
            The banner sits above whatever is on screen and pushes it down. It
            is not a modal, it does not take focus, and it never covers a
            camera.
          </p>
        </div>
      </div>
    ) : which.startsWith("shares") ? (
      <SharesView hasSites admin={false} />
    ) : (
      <AdministrationView sites admin />
    );

  return (
    <AuthContextForHarness.Provider value={SESSION as never}>
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
