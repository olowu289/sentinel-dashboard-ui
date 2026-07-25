import type { Alert, CameraFeed } from "./types";

const CLIP_THUMB = "/media/clip-thumb.jpg";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Alerts are seeded relative to page load rather than pinned to fixed strings,
   so the feed reads as live and the date filter has a real spread to work on —
   the tail deliberately crosses midnight and the 7-day boundary. */
const NOW = Date.now();
const ago = (ms: number) => NOW - ms;

export const TOWER = {
  id: "TWR-1042",
  online: true,
  camerasOnline: 2,
  camerasTotal: 2,
};

export const FEEDS: CameraFeed[] = [
  {
    id: "cam-gas-yard",
    name: "GAS YARD",
    state: "recording",
    latencyMs: 10,
    elapsedSec: 34,
    poster: "/media/cam-gas-yard.jpg",
    ptz: true,
  },
  {
    id: "cam-east-corridor",
    name: "EAST CORRIDOR",
    state: "live",
    latencyMs: 112,
    poster: "/media/cam-east-corridor.jpg",
    ptz: true,
  },
];

export const ALERTS: Alert[] = [
  {
    id: "ALT-8841",
    kind: "alert",
    title: "Alert raised by Motion Sensor on Gas Yard",
    at: ago(18 * SECOND),
    status: "triggered",
    source: "Motion Sensor",
    zone: "Gas Yard",
  },
  {
    id: "ALT-8840",
    kind: "vehicle",
    title: "Vehicle detected by Gas Yard camera",
    at: ago(4 * MINUTE),
    status: "triggered",
    source: "Gas Yard camera",
    zone: "Gas Yard",
    attachment: {
      kind: "clip",
      title: "15s Clip Recording",
      thumbnail: CLIP_THUMB,
    },
  },
  {
    id: "ALT-8839",
    kind: "person",
    title: "Person detected by Camera 1",
    at: ago(12 * MINUTE),
    status: "triggered",
    source: "Camera 1",
    zone: "Gas Yard",
    attachment: {
      kind: "clip",
      title: "30s Clip Recording",
      thumbnail: CLIP_THUMB,
    },
  },
  {
    id: "ALT-8838",
    kind: "speaker",
    title: "Speaker Talk Down",
    at: ago(47 * MINUTE),
    status: "acknowledged",
    acknowledgedBy: "A. Okafor",
    source: "Operator console",
    zone: "Gas Yard",
    attachment: {
      kind: "audio",
      title: "Audio Message",
      thumbnail: CLIP_THUMB,
    },
  },
  {
    id: "ALT-8837",
    kind: "alert",
    title: "Alert raised by Line-crossing on Oil Storage",
    at: ago(2 * HOUR + 10 * MINUTE),
    status: "triggered",
    source: "Line-crossing",
    zone: "Oil Storage",
  },
  {
    id: "ALT-8836",
    kind: "alert",
    title: "Alert raised by Thermal Sensor on East Corridor",
    at: ago(5 * HOUR + 32 * MINUTE),
    status: "triggered",
    source: "Thermal Sensor",
    zone: "East Corridor",
  },
  {
    id: "ALT-8835",
    kind: "alert",
    title: "Sub-alert: Person in Oil Storage",
    at: ago(26 * HOUR),
    status: "triggered",
    source: "Oil Storage camera",
    zone: "Oil Storage",
    attachment: {
      kind: "clip",
      title: "30s Clip Recording",
      thumbnail: CLIP_THUMB,
    },
  },
  {
    id: "ALT-8834",
    kind: "fault",
    title: "Oil Depot camera stopped working",
    at: ago(3 * DAY + 4 * HOUR),
    status: "triggered",
    source: "Oil Depot camera",
    zone: "Oil Depot",
  },
];

/** Icon file per alert kind — each is the exported Figma badge asset. */
export const ALERT_BADGE: Record<Alert["kind"], string> = {
  alert: "/icons/badge-alert.svg",
  vehicle: "/icons/badge-vehicle.svg",
  person: "/icons/badge-person.svg",
  speaker: "/icons/badge-speaker.svg",
  fault: "/icons/badge-fault.svg",
};
