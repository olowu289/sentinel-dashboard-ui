import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { MonitorTile } from "@/components/MonitorTile";
import { SiteClock } from "@/components/SiteClock";
import { TowersPanel } from "@/components/TowersPanel";
import type { Alert, CameraFeed, Tower } from "@/lib/types";

/** The wall is two across. Up and Down on a drag handle move a whole row, so
 *  the keyboard route needs the same number the grid is built from. */
const COLUMNS = 2;

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
 */
export function DashboardView({
  towers,
  feeds,
  alerts,
  order,
  onMove,
  onReorder,
  onOpenTower,
  onRetryFeed,
}: {
  towers: Tower[];
  feeds: CameraFeed[];
  alerts: Alert[];
  /** The wall's arrangement as feed ids. Owned by the shell, not here: this
   *  view unmounts every time an operator drills into a tower, and an
   *  arrangement that resets on the way back is worse than no arrangement —
   *  they would have to redo it, or learn not to bother. */
  order: string[];
  onMove: (from: number, to: number) => void;
  /** Commit a whole arrangement at once. Moving a band moves every tile in it,
   *  which `onMove`'s one-at-a-time contract cannot express without walking
   *  through arrangements the operator never asked for. */
  onReorder: (next: string[]) => void;
  onOpenTower: (towerId: string, showAlerts?: boolean) => void;
  onRetryFeed: (feedId: string) => void;
}) {
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingBand, setDraggingBand] = useState<string | null>(null);

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
    <div className="flex h-[100dvh] w-full overflow-hidden bg-ink">
      <IconRail
        active="dashboard"
        /* Both "Dashboard" and "Towers" land here, because here *is* the
           towers list — there is no second screen for them to disagree about.
           The other four remain decorative and are still not wired. */
        onSelect={(id) => {
          if (id === "dashboard" || id === "towers") setFullscreenId(null);
        }}
        className="hidden lg:block"
      />

      <TowersPanel
        towers={towers}
        alerts={alerts}
        onOpenTower={onOpenTower}
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
          <h1 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted">
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
              className="flex size-[20px] items-center justify-center text-white transition-colors hover:text-terra disabled:text-white/35"
            >
              <MaskIcon src="/icons/bell.svg" size={20} />
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
                setDraggingBand(null);
              }}
              /* Held bands fill blue rather than fading. A fade says "this is
                 not really here", which is wrong — it is the one thing the
                 operator is holding, and on a wall of live pictures the faded
                 copy reads as a stream fault. The fill shows through the 8px
                 seams and behind the header, which is exactly the band's own
                 outline, and it is gone the moment the band lands. */
              className={`flex min-h-0 flex-1 flex-col gap-[8px] ${
                draggingBand === band.towerId ? "bg-drag" : ""
              }`}
            >
              <header className="flex h-[24px] shrink-0 items-center justify-between">
                <h2 className="truncate text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-white">
                  {towerName(band.towerId)}
                </h2>

                {/* The 3×3 glyph is the band's handle, the same gesture the
                    tiles carry one level down: drag it to move the whole site,
                    arrows to step it. It is always visible because a band
                    header is chrome already — there is no picture underneath
                    for it to sit on top of. */}
                {bands.length > 1 && (
                  <button
                    type="button"
                    draggable
                    onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", band.towerId);
                      setDraggingBand(band.towerId);
                    }}
                    onDragEnd={() => setDraggingBand(null)}
                    onKeyDown={(e) => onBandKey(e, bandIndex)}
                    aria-label={`Rearrange ${towerName(band.towerId)}, band ${bandIndex + 1} of ${bands.length}. Use the arrow keys to move it.`}
                    title="Drag to rearrange, or use the arrow keys"
                    className="flex size-[24px] shrink-0 cursor-grab items-center justify-center rounded-[4px] text-muted transition-colors hover:text-white active:cursor-grabbing"
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
                {band.feeds.map((feed) => {
                  const i = order.indexOf(feed.id);
                  return (
                    <MonitorTile
                      key={feed.id}
                      feed={feed}
                      towerId={feed.towerId}
                      index={i}
                      count={tiles.length}
                      columns={COLUMNS}
                      fullscreen={fullscreenId === feed.id}
                      dragging={draggingId === feed.id}
                      dragActive={draggingId !== null}
                      /* The takeover reflows every sibling, and so does a
                         reorder of either kind, so the gate is shared rather
                         than per-tile — see the README. Anything else added
                         here that changes a tile's box belongs in this key, or
                         the wall snaps instead of animating. */
                      layoutKey={`${fullscreenId ?? ""}|${order.join(">")}`}
                      onToggleFullscreen={() =>
                        setFullscreenId((id) =>
                          id === feed.id ? null : feed.id,
                        )
                      }
                      onRetry={() => onRetryFeed(feed.id)}
                      onDragStart={() => setDraggingId(feed.id)}
                      onDragEnd={() => setDraggingId(null)}
                      /* Sort live rather than on drop, so the wall shows the
                         result before the operator commits to it. Moving to the
                         hovered index makes the dragged tile land there, which
                         means the next dragover on this same tile is a no-op —
                         that self-cancelling is what stops two tiles trading
                         places over and over while the pointer sits still and
                         the layout animation slides them. */
                      onDragOverTile={() => {
                        if (!draggingId || draggingId === feed.id) return;
                        onMove(order.indexOf(draggingId), i);
                      }}
                      onMove={(delta) => onMove(i, i + delta)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
