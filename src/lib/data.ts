import type {
  Alert,
  AlertAttachment,
  AlertKind,
  CameraFeed,
  TimelineEvent,
  Tower,
} from "./types";

const CLIP_THUMB = "/media/clip-thumb.jpg";

const clip = (title: string, durationSec: number): AlertAttachment => ({
  kind: "clip",
  title,
  thumbnail: CLIP_THUMB,
  durationSec,
});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Alerts are seeded relative to page load rather than pinned to fixed strings,
   so the feed reads as live and the date filter has a real spread to work on —
   the tail deliberately crosses midnight and the 7-day boundary. */
const NOW = Date.now();
const ago = (ms: number) => NOW - ms;

/**
 * Builds an alert's sequence from offsets in seconds around its own trigger
 * time, so every step keeps its real spacing no matter when the page loads.
 *
 * Negative offsets are the detections that *caused* the alert. They belong
 * above it: a motion sensor firing is the reason the threshold was crossed, and
 * a timeline that opens with its own conclusion tells the operator nothing.
 */
function sequence(
  at: number,
  rows: [
    offsetSec: number,
    icon: AlertKind,
    title: string,
    attachment?: AlertAttachment,
  ][],
): TimelineEvent[] {
  return rows.map(([offsetSec, icon, title, attachment]) => ({
    at: at + offsetSec * SECOND,
    icon,
    title,
    ...(attachment ? { attachment } : {}),
  }));
}

/**
 * The fleet. Two towers rather than one because a dashboard whose every card
 * reads ONLINE proves nothing — the second site is deliberately degraded (a
 * dead camera and a poor uplink) so the health grammar is visible at rest.
 */
export const TOWERS: Tower[] = [
  {
    id: "TWR-1042",
    site: "WAREHOUSE: PARKING LOT",
    status: "online",
    solar: "charging",
    batteryPct: 87,
    tempC: 34,
    link: "good",
  },
  {
    id: "TWR-2071",
    site: "OIL DEPOT: NORTH GATE",
    status: "online",
    /* On charge at 34%, which is the case the gauge is built to show: the
       cell climbs the whole way from red through amber into green, where
       TWR-1042 at 87% only tops off. Two towers charging from different depths
       is the readable demonstration that the gauge is a reading and not a
       decoration. */
    solar: "charging",
    batteryPct: 5,
    tempC: 41,
    link: "warn",
  },
];

export function findTower(id: string) {
  return TOWERS.find((t) => t.id === id) ?? TOWERS[0];
}

export const FEEDS: CameraFeed[] = [
  {
    id: "cam-gas-yard",
    towerId: "TWR-1042",
    name: "GAS YARD",
    state: "recording",
    latencyMs: 10,
    elapsedSec: 34,
    poster: "/media/cam-gas-yard.jpg",
    ptz: true,
  },
  {
    id: "cam-east-corridor",
    towerId: "TWR-1042",
    name: "EAST CORRIDOR",
    state: "live",
    latencyMs: 112,
    poster: "/media/cam-east-corridor.jpg",
    ptz: true,
  },
  {
    id: "cam-north-gate",
    towerId: "TWR-2071",
    name: "NORTH GATE",
    state: "live",
    latencyMs: 143,
    poster: "/media/cam-parking-lot.jpg",
    ptz: true,
  },
  {
    /* Dark on purpose. The fleet wall's job is to make a blind camera obvious
       from across the room, and a wall of four healthy tiles never shows it. */
    id: "cam-oil-storage",
    towerId: "TWR-2071",
    name: "OIL STORAGE",
    state: "offline",
    poster: "/media/cam-east-corridor.jpg",
  },
];

/** Cameras belonging to one tower, in seed order. */
export function feedsForTower(feeds: CameraFeed[], towerId: string) {
  return feeds.filter((f) => f.towerId === towerId);
}

const AT_8841 = ago(18 * SECOND);
const AT_8840 = ago(4 * MINUTE);
const AT_8839 = ago(12 * MINUTE);
const AT_8838 = ago(47 * MINUTE);
const AT_8837 = ago(2 * HOUR + 10 * MINUTE);
const AT_8836 = ago(5 * HOUR + 32 * MINUTE);
const AT_8835 = ago(26 * HOUR);
const AT_8834 = ago(3 * DAY + 4 * HOUR);

const AT_9002 = ago(9 * MINUTE);
const AT_9001 = ago(1 * HOUR + 38 * MINUTE);

/** Written without `towerId` and stamped below, so a whole site's feed cannot
 *  drift one row at a time the way a hand-repeated field does. */
type SiteAlert = Omit<Alert, "towerId">;

const ALERTS_1042: SiteAlert[] = [
  {
    id: "ALT-8841",
    kind: "alert",
    title: "Alert raised by Motion Sensor on Gas Yard",
    at: AT_8841,
    status: "triggered",
    source: "Motion Sensor",
    zone: "Gas Yard",
    cameras: ["Outpost 16"],
    confidence: 94,
    timeline: sequence(AT_8841, [
      [-3, "alert", "Motion detected in Gas Yard"],
      [0, "alert", "Alert raised"],
      [4, "vehicle", "Vehicle detected by Gas Yard camera", clip("15s Clip Recording", 15)],
      [11, "person", "Person detected by Camera 1", clip("30s Clip Recording", 30)],
    ]),
  },
  {
    id: "ALT-8840",
    kind: "vehicle",
    title: "Vehicle detected by Gas Yard camera",
    at: AT_8840,
    status: "triggered",
    source: "Gas Yard camera",
    zone: "Gas Yard",
    cameras: ["Outpost 16"],
    confidence: 97,
    attachment: clip("15s Clip Recording", 15),
    timeline: sequence(AT_8840, [
      [-6, "alert", "Motion detected in Gas Yard"],
      [0, "vehicle", "Vehicle detected by Gas Yard camera", clip("15s Clip Recording", 15)],
      [10, "alert", "Alert raised"],
    ]),
  },
  {
    id: "ALT-8839",
    kind: "person",
    title: "Person detected by Camera 1",
    at: AT_8839,
    status: "triggered",
    source: "Camera 1",
    zone: "Gas Yard",
    cameras: ["Camera 1"],
    confidence: 88,
    attachment: clip("30s Clip Recording", 30),
    timeline: sequence(AT_8839, [
      [-4, "alert", "Motion detected in Gas Yard"],
      [0, "person", "Person detected by Camera 1", clip("30s Clip Recording", 30)],
      [8, "alert", "Alert raised"],
    ]),
  },
  {
    id: "ALT-8838",
    kind: "speaker",
    title: "Speaker Talk Down",
    at: AT_8838,
    status: "acknowledged",
    acknowledgedBy: "A. Okafor",
    source: "Operator console",
    zone: "Gas Yard",
    /* No confidence: an operator pressing talk-down is a decision, not a
       prediction. Showing a percentage here would invent a machine judgement
       that never happened. */
    cameras: ["Outpost 16"],
    attachment: {
      kind: "audio",
      title: "Audio Message",
      thumbnail: CLIP_THUMB,
      durationSec: 12,
    },
    timeline: sequence(AT_8838, [
      [
        0,
        "speaker",
        "Talk-down opened by A. Okafor",
        {
          kind: "audio",
          title: "Audio Message",
          thumbnail: CLIP_THUMB,
          durationSec: 12,
        },
      ],
      [26, "alert", "Acknowledged by A. Okafor"],
    ]),
  },
  {
    id: "ALT-8837",
    kind: "alert",
    title: "Alert raised by Line-crossing on Oil Storage",
    at: AT_8837,
    status: "triggered",
    source: "Line-crossing",
    zone: "Oil Storage",
    cameras: ["Oil Storage camera"],
    confidence: 76,
    timeline: sequence(AT_8837, [
      [-2, "alert", "Boundary crossed on Oil Storage west line"],
      [0, "alert", "Alert raised"],
    ]),
  },
  {
    id: "ALT-8836",
    kind: "alert",
    title: "Alert raised by Thermal Sensor on East Corridor",
    at: AT_8836,
    status: "triggered",
    source: "Thermal Sensor",
    zone: "East Corridor",
    cameras: ["East Corridor camera"],
    confidence: 91,
    timeline: sequence(AT_8836, [
      [-5, "alert", "Heat signature detected in East Corridor"],
      [0, "alert", "Alert raised"],
    ]),
  },
  {
    id: "ALT-8835",
    kind: "alert",
    title: "Sub-alert: Person in Oil Storage",
    at: AT_8835,
    status: "triggered",
    source: "Oil Storage camera",
    zone: "Oil Storage",
    cameras: ["Oil Storage camera"],
    confidence: 82,
    attachment: clip("30s Clip Recording", 30),
    timeline: sequence(AT_8835, [
      [-9, "alert", "Motion detected in Oil Storage"],
      [0, "person", "Person detected in Oil Storage", clip("30s Clip Recording", 30)],
      [12, "alert", "Alert raised"],
    ]),
  },
  {
    id: "ALT-8834",
    kind: "fault",
    title: "Oil Depot camera stopped working",
    at: AT_8834,
    status: "triggered",
    source: "Oil Depot camera",
    zone: "Oil Depot",
    cameras: ["Oil Depot camera"],
    /* No confidence: the link either dropped or it did not. */
    timeline: sequence(AT_8834, [
      [-45, "fault", "Frames stopped arriving from Oil Depot camera"],
      [0, "fault", "Feed marked offline"],
      [30, "alert", "Escalated to maintenance · MNT-2291"],
    ]),
  },
];

const ALERTS_2071: SiteAlert[] = [
  {
    id: "ALT-9002",
    kind: "fault",
    title: "Oil Storage camera stopped working",
    at: AT_9002,
    status: "triggered",
    source: "Oil Storage camera",
    zone: "Oil Storage",
    cameras: ["Oil Storage"],
    /* No confidence: the link either dropped or it did not. This is the fault
       behind TWR-2071's dark tile — the wall and the feed have to agree. */
    timeline: sequence(AT_9002, [
      [-38, "fault", "Frames stopped arriving from Oil Storage camera"],
      [0, "fault", "Feed marked offline"],
    ]),
  },
  {
    id: "ALT-9001",
    kind: "vehicle",
    title: "Vehicle detected by North Gate camera",
    at: AT_9001,
    status: "acknowledged",
    acknowledgedBy: "I. Bello",
    source: "North Gate camera",
    zone: "North Gate",
    cameras: ["North Gate"],
    confidence: 93,
    attachment: clip("15s Clip Recording", 15),
    timeline: sequence(AT_9001, [
      [-7, "alert", "Motion detected at North Gate"],
      [0, "vehicle", "Vehicle detected by North Gate camera", clip("15s Clip Recording", 15)],
      [9, "alert", "Acknowledged by I. Bello"],
    ]),
  },
];

/* One feed across the fleet, newest first. Sorted rather than hand-interleaved
   because the seeds are offsets from page load: any fixed order here would be
   a lie the moment the two sites' offsets crossed. */
export const ALERTS: Alert[] = [
  ...ALERTS_1042.map((a) => ({ ...a, towerId: "TWR-1042" })),
  ...ALERTS_2071.map((a) => ({ ...a, towerId: "TWR-2071" })),
].sort((a, b) => b.at - a.at);

/** Alerts raised by one tower — the count on its fleet card, and the feed its
 *  operator view shows. */
export function alertsForTower(alerts: Alert[], towerId: string) {
  return alerts.filter((a) => a.towerId === towerId);
}

/** Icon file per alert kind — each is the exported Figma badge asset. */
export const ALERT_BADGE: Record<Alert["kind"], string> = {
  alert: "/icons/badge-alert.svg",
  vehicle: "/icons/badge-vehicle.svg",
  person: "/icons/badge-person.svg",
  speaker: "/icons/badge-speaker.svg",
  fault: "/icons/badge-fault.svg",
};
