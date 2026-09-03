import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { MonitorTile } from "@/components/MonitorTile";
import { SiteClock } from "@/components/SiteClock";
import { TowersPanel } from "@/components/TowersPanel";
import type { Alert, CameraFeed, PendingTower, Tower } from "@/lib/types";

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
 * Rearranging is a band gesture and only a band gesture. Tiles used to carry
 * their own handles too, which meant two grammars for one job and a handle in
 * the corner of every picture; the wall is arranged by site, and the cameras
 * under a site keep the order the site lists them in.
 */
export function DashboardView({
  towers,
  feeds,
  alerts,
  order,
  onReorder,
  pending,
  onNavigate,
  onResumeSetup,
  onOpenTower,
  onRetryFeed,
  onToggleRecord,
  fleetLoading = false,
  fleetProblem = null,
  seededFleet = false,
}: {
  towers: Tower[];
  feeds: CameraFeed[];
  alerts: Alert[];
  /** The wall's arrangement as feed ids. Owned by the shell, not here: this
   *  view unmounts every time an operator drills into a tower, and an
   *  arrangement that resets on the way back is worse than no arrangement —
   *  they would have to redo it, or learn not to bother. */
  order: string[];
  /** Commit a whole arrangement at once. A band move relocates every tile in
   *  it, and stepping through that one tile at a time would walk the wall
   *  through arrangements nobody asked for. */
  onReorder: (next: string[]) => void;
  /** A claim that has landed but not been finished, if there is one. */
  pending: PendingTower | null;
  /** Every rail destination, routed by the shell. Deliberately not wired here:
   *  four screens render this rail and each one wiring its own meant two of
   *  them shipped a nav bar that did not navigate. */
  onNavigate: (id: string) => void;
  onResumeSetup: () => void;
  onOpenTower: (towerId: string, showAlerts?: boolean) => void;
  onRetryFeed: (feedId: string) => void;
  /** The shell's, not this view's — both walls act on one set of feeds. */
  onToggleRecord: (feedId: string) => void;
  /** The real fleet has not answered yet. */
  fleetLoading?: boolean;
  /** Why the fleet could not be read, if it could not. */
  fleetProblem?: string | null;
  /** The list on screen is fixture data. Must be visible, never implied. */
  seededFleet?: boolean;
}) {
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [draggingBand, setDraggingBand] = useState<string | null>(null);
  /* Held under the pointer, not yet moving. The fill answers "have I got hold
     of it", so it lives exactly as long as the grip does: it appears the
     instant the handle is pressed and goes the instant the finger comes off.
     Not a toggle — a band that stayed lit after the release would be claiming
     a state the operator is no longer in, and on a wall of live pictures a
     standing blue block is a thing to explain rather than a thing to ignore. */
  const [heldBand, setHeldBand] = useState<string | null>(null);

  const byId = new Map(feeds.map((f) => [f.id, f]));
  const tiles = order
    .map((id) => byId.get(id))
    .filter((f): f is CameraFeed => Boolean(f));

  /* Bands are read out of the arrangement rather than kept beside it: a tower
     appears where its first camera does, and its cameras keep their relative
     order. One source of truth for both, so a tile drag and a band drag can
     never leave the wall describing two different arrangements. */
  const bands = useMemo(() => {
    const out: { towerId: string; feeds: CameraFeed[] }[] = [];
    for (const feed of tiles) {
      const band = out.find((b) => b.towerId === feed.towerId);
      if (band) band.feeds.push(feed);
      else out.push({ towerId: feed.towerId, feeds: [feed] });
    }
    return out;
  }, [order.join(">"), feeds]);

  const towerName = (towerId: string) =>
    towers.find((t) => t.id === towerId)?.site ?? towerId;

  const moveBand = (from: number, to: number) => {
    if (from === to || to < 0 || to >= bands.length) return;
    const next = bands.slice();
    const [band] = next.splice(from, 1);
    next.splice(to, 0, band);
    onReorder(next.flatMap((b) => b.feeds.map((f) => f.id)));
  };

  /* Landed, or let go of. Clears both sources of the fill together, because
     which of them was carrying it depends on how far the gesture got. */
  const release = () => {
    setDraggingBand(null);
    setHeldBand(null);
  };

  const onBandKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      e.key === "ArrowUp" || e.key === "ArrowLeft"
        ? -1
        : e.key === "ArrowDown" || e.key === "ArrowRight"
          ? 1
          : 0;
    if (!delta) return;
    e.preventDefault();
    moveBand(index, index + delta);
  };

  /* The header bell goes to whatever is actually waiting — the newest alert
     nobody has claimed. A fleet screen has no alerts feed of its own; every
     alert belongs to a tower, and this is the shortest route to the one that
     matters most. */
  const newest = alerts.find((a) => a.status === "triggered");

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
        pending={pending}
        onResumeSetup={onResumeSetup}
        onOpenTower={onOpenTower}
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
              aria-label={
                newest
                  ? `Newest unclaimed alert — open ${newest.towerId} alerts`
                  : "No unclaimed alerts"
              }
              title={newest ? `${newest.title} — ${newest.towerId}` : "No unclaimed alerts"}
              /* No swing when there is nothing to open. A disabled control
                 that animates under the pointer is offering something it will
                 not do. */
              className={`flex size-[20px] items-center justify-center text-white transition-colors hover:text-terra disabled:text-white/35 ${
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
          {bands.map((band, bandIndex) => (
            <section
              key={band.towerId}
              aria-label={towerName(band.towerId)}
              onDragOver={(e: DragEvent<HTMLElement>) => {
                if (!draggingBand || draggingBand === band.towerId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                moveBand(
                  bands.findIndex((b) => b.towerId === draggingBand),
                  bandIndex,
                );
              }}
              onDrop={(e: DragEvent<HTMLElement>) => {
                if (!draggingBand) return;
                e.preventDefault();
                release();
              }}
              /* Held bands fill blue rather than fading. A fade says "this is
                 not really here", which is wrong — it is the one thing the
                 operator is holding, and on a wall of live pictures the faded
                 copy reads as a stream fault. The fill shows through the 8px
                 seams and behind the header, which is exactly the band's own
                 outline, and it is gone the moment the band lands. */
              className={`flex min-h-0 flex-1 flex-col gap-[8px] ${
                heldBand === band.towerId || draggingBand === band.towerId
                  ? "bg-drag"
                  : ""
              }`}
            >
              <header className="flex h-[24px] shrink-0 items-center justify-between">
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
                    className="max-w-full truncate text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-white transition-colors hover:text-sub"
                  >
                    {towerName(band.towerId)}
                  </button>
                </h2>

                {/* The 3×3 glyph is the band's handle, the same gesture the
                    tiles carry one level down: press and drag to move the whole
                    site, arrows to step it. It is always visible because a band
                    header is chrome already — there is no picture underneath
                    for it to sit on top of. */}
                {bands.length > 1 && (
                  <button
                    type="button"
                    draggable
                    /* On press and only while pressed. Waiting for the click
                       would put the fill after the operator has already started
                       moving, which is exactly when it stops being useful; and
                       a click that latched it would leave a band lit with
                       nothing holding it. `pointercancel` is in here because it
                       is what fires when a press turns into a native drag —
                       `draggingBand` has the fill from that point on. */
                    onPointerDown={() => setHeldBand(band.towerId)}
                    onPointerUp={() => setHeldBand(null)}
                    onPointerLeave={() => setHeldBand(null)}
                    onPointerCancel={() => setHeldBand(null)}
                    onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", band.towerId);
                      setDraggingBand(band.towerId);
                    }}
                    onDragEnd={release}
                    onKeyDown={(e) => onBandKey(e, bandIndex)}
                    aria-label={`Rearrange ${towerName(band.towerId)}, band ${bandIndex + 1} of ${bands.length}. Use the arrow keys to move it.`}
                    title="Drag to rearrange, or use the arrow keys"
                    className={`flex size-[24px] shrink-0 cursor-grab items-center justify-center rounded-[4px] transition-colors active:cursor-grabbing ${
                      heldBand === band.towerId
                        ? "text-white"
                        : "text-muted hover:text-white"
                    }`}
                  >
                    {/* Rotated a quarter turn, as the frame draws it: the
                        glyph's own artwork is two columns of three dots. */}
                    <MaskIcon
                      src="/icons/group-grid.svg"
                      size={24}
                      className="-rotate-90"
                    />
                  </button>
                )}
              </header>

              <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-[8px]">
                {band.feeds.map((feed) => (
                  <MonitorTile
                    key={feed.id}
                    feed={feed}
                    towerId={feed.towerId}
                    fullscreen={fullscreenId === feed.id}
                    /* The takeover reflows every sibling, and so does a band
                       reorder, so the gate is shared rather than per-tile — see
                       the README. Anything else added here that changes a
                       tile's box belongs in this key, or the wall snaps instead
                       of animating. */
                    layoutKey={`${fullscreenId ?? ""}|${order.join(">")}`}
                    onToggleFullscreen={() =>
                      setFullscreenId((id) => (id === feed.id ? null : feed.id))
                    }
                    onRetry={() => onRetryFeed(feed.id)}
                    onToggleRecord={() => onToggleRecord(feed.id)}
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
