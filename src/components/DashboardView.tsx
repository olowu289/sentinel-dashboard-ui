import { useMemo, useState } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { MonitorTile } from "@/components/MonitorTile";
import type { PlaybackPhase } from "@/lib/usePlayback";
import type { ViewerSession } from "@kallon/sentry-sdk";
import { SiteClock } from "@/components/SiteClock";
import { TowersPanel } from "@/components/TowersPanel";
import { wallBands } from "@/lib/fleetOrder";
import { deviceName } from "@/lib/deviceName";
import type { Alert, CameraFeed, Tower } from "@/lib/types";
import type { Claim } from "@/lib/api/claim";

/**
 * The fleet view: every tower on the left, every camera on the right.
 *
 * This is the parent of the tower view — the breadcrumb there has always read
 * `TOWERS › TWR-1042` and pointed at nothing. Opening a card drills in; the
 * breadcrumb comes back here.
 *
 * The wall is banded by tower rather than laid out flat. Four tiles in an
 * anonymous grid made "whose north gate?" a question every tile had to answer
 * for itself, which is what the old per-tile tower label was for; a band header
 * answers it once for the row beneath it and gives the picture back its corner.
 *
 * ⚠ THE BANDS ARE IN THE ORDER THE LIST BESIDE THEM IS IN, and the wall has no
 * order of its own to be in instead. Both panels read `lib/fleetOrder.ts`; the
 * note at the top of that file is why. It used to be arrangeable, by dragging a
 * band header, and that is what is gone: an arrangement only one of the two
 * panels could hold is exactly the disagreement this screen was reported for.
 */
export function DashboardView({
  towers,
  feeds,
  alerts,
  pendingClaim,
  onNavigate,
  onResumeSetup,
  onOpenTower,
  onRetryFeed,
  onToggleRecord,
  playback,
  onScreenTiles,
  observeTile,
  sessionFor,
  dismissedNotices,
  onDismissNotice,
  fleetLoading = false,
  fleetProblem = null,
  seededFleet = false,
}: {
  towers: Tower[];
  feeds: CameraFeed[];
  alerts: Alert[];
  /** An open registration from the server, if there is one. */
  pendingClaim: Claim | null;
  /** Every rail destination, routed by the shell. Deliberately not wired here:
   *  four screens render this rail and each one wiring its own meant two of
   *  them shipped a nav bar that did not navigate. */
  onNavigate: (id: string) => void;
  onResumeSetup: () => void;
  onOpenTower: (towerId: string, showAlerts?: boolean) => void;
  onRetryFeed: (feedId: string) => void;
  /** The shell's, not this view's — both walls act on one set of feeds. */
  onToggleRecord: (feedId: string) => void;
  /** Live sessions by feed id, owned by the shell — the wall renders them, it
   *  does not hold them. */
  playback?: Record<string, PlaybackPhase>;
  /** Feed ids currently on screen. A tile in here that still has no stream is
   *  over the wall's ceiling, which is an idle state and never an error. */
  onScreenTiles?: ReadonlySet<string>;
  /** Registers a tile's grid cell with the visibility observer. */
  observeTile?: (id: string) => (el: HTMLElement | null) => void;
  /** The live session for a camera, for the zoom controls. */
  sessionFor?: (feedId: string) => ViewerSession | null;
  /** Towers whose notice this operator has read. Owned by the shell so it
   *  survives this view unmounting on every drill-in — see the note there. */
  dismissedNotices?: ReadonlySet<string>;
  onDismissNotice?: (towerId: string) => void;
  /** The real fleet has not answered yet. */
  fleetLoading?: boolean;
  /** Why the fleet could not be read, if it could not. */
  fleetProblem?: string | null;
  /** The list on screen is fixture data. Must be visible, never implied. */
  seededFleet?: boolean;
}) {
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  /* The wall, in the list's order. Derived on every render from the same two
     arrays the panel beside it reads, so there is no second arrangement to
     fall out of step and nothing to reconcile when a tower arrives or goes. */
  const bands = useMemo(() => wallBands(towers, feeds), [towers, feeds]);

  /* What the wall currently looks like, as one string. Tiles animate between
     arrangements rather than snapping, and `MonitorTile` gates that on this —
     so it has to change whenever a tile's box does: a band moving, a site
     appearing or leaving, a camera joining a row. See the note on `layoutKey`
     below and the one in `MonitorTile`. */
  const arrangement = bands
    .map((band) => band.feeds.map((f) => f.id).join(","))
    .join(">");

  /* ⚠ NEVER THE ID AS A FALLBACK. A tower the fleet does not have is still a
     tower, and "kln_lab_000002" on a band heading is a serial in front of a
     customer.

     In capitals, like every other place a tower is named — and in ONE place,
     so the band heading, its `title`, the section's `aria-label` and the name
     each tile carries cannot drift apart. */
  const towerName = (towerId: string) =>
    deviceName(towers.find((t) => t.id === towerId)?.site) || "This tower";

  /* The header bell goes to whatever is actually waiting — the newest alert
     nobody has claimed. A fleet screen has no alerts feed of its own; every
     alert belongs to a tower, and this is the shortest route to the one that
     matters most. */
  const newest = alerts.find((a) => a.status === "triggered");
  /* Its tower's NAME, with a word for the one case where there is nothing
     better to say: a tower the fleet does not have. Never its serial. */
  const newestTowerName = newest
    ? deviceName(towers.find((t) => t.id === newest.towerId)?.site) || "a tower"
    : "";

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      <IconRail
        active="dashboard"
        onSelect={(id) => {
          /* Leaving fullscreen is this screen's own business — the takeover is
             a state of the wall, not a destination. Everything else is the
             shell's. */
          if (id === "dashboard") setFullscreenId(null);
          onNavigate(id);
        }}
        className="hidden lg:block"
      />

      <TowersPanel
        towers={towers}
        alerts={alerts}
        pendingClaim={pendingClaim}
        onResumeSetup={onResumeSetup}
        onOpenTower={onOpenTower}
        dismissedNotices={dismissedNotices}
        onDismissNotice={onDismissNotice}
        loading={fleetLoading}
        problem={fleetProblem}
        seeded={seededFleet}
        className="flex"
      />

      {/* Wall is desktop-only, and that is a decision rather than a shortcut.
          Four tiles stacked on a phone is four screens of scrolling to check
          one site, and side by side gives each about 180px — too small to
          identify anyone, which is the entire job. On a phone the fleet *is*
          the list, and the wall you actually want belongs to one tower, which
          is a tap away and already lays itself out for the screen. Drag
          reordering goes with it: HTML5 drag never fires on touch. */}
      <div className="hidden min-w-0 flex-1 flex-col lg:flex">
        <header className="flex h-[46px] shrink-0 items-center border-b border-line pl-[16px] pr-[15px]">
          {/* --color-sub, matching the tower card's status word. Both are a
              standing label rather than a reading, and at --color-muted this
              one sat a step darker than the words it heads. */}
          <h1 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-sub">
            ACTIVE CAMERAS:
          </h1>
          <div className="ml-auto flex items-center gap-[8px]">
            <SiteClock />
            <span aria-hidden className="h-[14px] w-px bg-stroke" />
            <button
              type="button"
              disabled={!newest}
              onClick={() => newest && onOpenTower(newest.towerId, true)}
              /* THE TOWER'S NAME, not its serial: a screen reader would have
                 read out `kln_lab_000002` and the tooltip showed it. */
              aria-label={
                newest
                  ? `Newest unclaimed alert. Open ${newestTowerName} alerts`
                  : "No unclaimed alerts"
              }
              title={newest ? `${newest.title} · ${newestTowerName}` : "No unclaimed alerts"}
              /* No swing when there is nothing to open. A disabled control
                 that animates under the pointer is offering something it will
                 not do. */
              className={`flex size-[20px] items-center justify-center text-body-ink transition-colors hover:text-terra disabled:text-body-ink/35 ${
                newest ? "group/bell" : ""
              }`}
            >
              <MaskIcon src="/icons/bell.svg" size={20} className="bell-swing" />
            </button>
          </div>
        </header>

        {/* Bands share the height evenly rather than each taking the design's
            473px: that is its height in a 1024px frame, and pinning it would
            strand the wall short of the viewport on anything taller. Columns
            are capped at two because a wall that keeps subdividing stops being
            legible. */}
        <main className="flex min-h-0 flex-1 flex-col gap-[10px] pb-[11px] pl-[17px] pr-[16px] pt-[11px]">
          {bands.map((band) => (
            <section
              key={band.towerId}
              aria-label={towerName(band.towerId)}
              /* ⚠ KEYED ON THE TOWER, AND THE KEY IS WHY THE VIDEO SURVIVES.
                 When the fleet comes back in a different order — a site going
                 offline, a mast added — React matches these sections by key
                 and MOVES them, so the `<video>` elements inside carry on
                 playing where they are. Keying on the index instead would
                 re-point every band at a different tower's cameras and tear
                 down every stream on the wall to rebuild it. */
              className="flex min-h-0 flex-1 flex-col gap-[8px]"
            >
              <header className="flex h-[24px] shrink-0 items-center">
                {/* The band's name opens the band's tower. It has always been
                    the only label on this screen naming a place you can go and
                    not going there — the card in the panel beside it does, and
                    an operator reading the wall rather than the list had to
                    cross back to reach the same site. It answers with a step
                    down to --color-sub, the same tone the label beside it
                    stands in — a tonal shift rather than a hue, because the
                    hues on this screen are spoken for. */}
                <h2 className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenTower(band.towerId)}
                    title={`Open ${towerName(band.towerId)}`}
                    className="max-w-full truncate text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-body-ink transition-colors hover:text-sub"
                  >
                    {towerName(band.towerId)}
                  </button>
                </h2>
              </header>

              <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-[8px]">
                {band.feeds.map((feed) => (
                  <MonitorTile
                    key={feed.id}
                    feed={feed}
                    towerId={feed.towerId}
                    towerName={towerName(feed.towerId)}
                    playback={playback?.[feed.id]}
                    session={sessionFor?.(feed.id) ?? null}
                    onScreen={onScreenTiles?.has(feed.id) ?? false}
                    observeRef={observeTile?.(feed.id)}
                    fullscreen={fullscreenId === feed.id}
                    /* The takeover reflows every sibling, and so does the fleet
                       coming back in a different order, so the gate is shared
                       rather than per-tile — see the README. Anything else
                       added here that changes a tile's box belongs in this key,
                       or the wall snaps instead of animating. */
                    layoutKey={`${fullscreenId ?? ""}|${arrangement}`}
                    onToggleFullscreen={() =>
                      setFullscreenId((id) => (id === feed.id ? null : feed.id))
                    }
                    onRetry={() => onRetryFeed(feed.id)}
                    onToggleRecord={() => onToggleRecord(feed.id)}
                    onOpenTower={() => onOpenTower(feed.towerId)}
                  />
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
