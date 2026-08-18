import { motion } from "motion/react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { TowerCard } from "@/components/TowerCard";
import { ENTER, FADE } from "@/lib/motion";
import { findUnclaimed, UNCLAIMED } from "@/lib/data";
import type {
  CameraFeed,
  PendingTower,
  Tower,
  UnclaimedUnit,
} from "@/lib/types";

/**
 * Adding a tower is a *claim*, not a create.
 *
 * The unit is already bolted to the ground and powered on by the time anyone
 * opens this screen — the design's own copy says so. So nothing here asks the
 * operator to describe their hardware: charge, temperature, uplink and camera
 * count all come off the box at claim time. The flow asks for exactly the two
 * things the box cannot know, the site's name and each camera's zone, and then
 * shows the readings coming up so the operator can see it is actually live.
 *
 * The QR is printed inside the cabinet door, in a field, and this is a desktop
 * console — so "Scan QR Code" cannot mean "point this machine at it". It means
 * hand the job to a phone: the desktop shows a link, the phone does the
 * scanning, and this page advances by itself when the claim lands.
 */

type Step = "intro" | "handoff" | "manual" | "site" | "cameras" | "online";

/** How long the stubbed phone takes to scan. No backend; see `useClaimPoll`. */
const HANDOFF_MS = 4500;

const CHECKS = ["UPLINK", "SOLAR", "BATTERY", "FIRST FRAME"] as const;

export function AddTowerView({
  pending,
  onNavigate,
  onCancel,
  onAdd,
}: {
  /** A claim left unfinished on a previous visit. Setup resumes from it rather
   *  than starting over — the unit is already this operator's, and making them
   *  re-scan a tower they have already claimed is asking them to prove
   *  something they have proved. */
  pending?: PendingTower | null;
  /** Back to the fleet, carrying whatever has been claimed and typed so far.
   *  `null` only when nothing was claimed. */
  onCancel: (draft: PendingTower | null) => void;
  /** Rail destinations, routed by the shell. Leaving this way still saves the
   *  claim — a rail click is an exit like any other. */
  onNavigate: (id: string) => void;
  onAdd: (tower: Tower, feeds: CameraFeed[]) => void;
}) {
  const [step, setStep] = useState<Step>(pending ? "site" : "intro");
  const [claim, setClaim] = useState<UnclaimedUnit | null>(
    pending?.unit ?? null,
  );
  const [site, setSite] = useState(pending?.site ?? "");
  const [names, setNames] = useState<Record<string, string>>(
    pending?.names ?? {},
  );

  /* Every exit runs through here. A claim in hand becomes a draft in the panel;
     nothing claimed leaves nothing behind. */
  const leave = () =>
    onCancel(claim ? { unit: claim, site, names } : null);

  const claimed = (unit: UnclaimedUnit) => {
    setClaim(unit);
    setNames(Object.fromEntries(unit.cameras.map((c) => [c.id, ""])));
    setStep("site");
  };

  const finish = () => {
    if (!claim) return;
    const tower: Tower = {
      id: claim.towerId,
      site: site.trim().toUpperCase(),
      /* Status is read, not chosen. A tower with a poor uplink or a dead camera
         is degraded the moment it joins the fleet, and saying `online` here
         because it is new would be the one lie the dashboard exists to catch. */
      status:
        claim.link === "bad" || claim.cameras.some((c) => !c.poster)
          ? "degraded"
          : "online",
      solar: claim.solar,
      batteryPct: claim.batteryPct,
      tempC: claim.tempC,
      link: claim.link,
      serial: claim.serial,
    };
    const feeds: CameraFeed[] = claim.cameras.map((cam) => ({
      id: cam.id,
      towerId: claim.towerId,
      name: (names[cam.id] || "").trim().toUpperCase(),
      state: cam.poster ? "live" : "offline",
      latencyMs: cam.poster ? 24 : undefined,
      poster: cam.poster ?? "",
    }));
    onAdd(tower, feeds);
  };

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-ink">
      <IconRail
        active="add"
        onSelect={(id) => {
          leave();
          onNavigate(id);
        }}
        className="hidden lg:block"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line pl-[16px] pr-[16px]">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-[4px]"
          >
            <button
              type="button"
              onClick={leave}
              title="Back to all towers"
              className="rounded-[2px] font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span
              aria-current="page"
              className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white"
            >
              ADD TOWER
            </span>
          </nav>
          <MaskIcon src="/icons/bell.svg" size={20} className="text-white/70" />
        </header>

        {/* One column, 483px, centred — the frame's measurement, and every step
            keeps it so the page never reflows between them. Scrolls rather than
            centring below ~700px tall: the camera list is the one step that can
            outgrow a laptop screen. */}
        <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-[24px] py-[48px]">
          <div className="my-auto w-[483px] max-w-full">
            {step === "intro" && (
              <Intro
                onScan={() => setStep("handoff")}
                onManual={() => setStep("manual")}
              />
            )}
            {step === "handoff" && (
              <Handoff
                onClaimed={claimed}
                onManual={() => setStep("manual")}
              />
            )}
            {step === "manual" && (
              <Manual onClaimed={claimed} onBack={() => setStep("intro")} />
            )}
            {step === "site" && claim && (
              <NameSite
                claim={claim}
                value={site}
                onChange={setSite}
                onContinue={() => setStep("cameras")}
              />
            )}
            {step === "cameras" && claim && (
              <NameCameras
                claim={claim}
                names={names}
                onChange={(id, v) => setNames((p) => ({ ...p, [id]: v }))}
                onBack={() => setStep("site")}
                onContinue={() => setStep("online")}
              />
            )}
            {step === "online" && claim && (
              <BringingOnline claim={claim} onFinish={finish} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared */

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-[6px] text-center">
      <h1 className="font-display text-[1.125rem] leading-[20px] tracking-[0.18px] text-white">
        {title}
      </h1>
      <p className="text-[0.875rem] leading-[20px] text-sub/80">{body}</p>
    </div>
  );
}

/** 57px, radius 8 — the frame's button, in its two tones. */
function Action({
  children,
  tone = "secondary",
  type = "button",
  disabled,
  describedBy,
  onClick,
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary";
  type?: "button" | "submit";
  disabled?: boolean;
  /** Points a disabled control at whatever explains why it is disabled. */
  describedBy?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onClick}
      className={`h-[57px] w-full rounded-[8px] text-[1rem] leading-[20px] font-medium transition-colors disabled:cursor-not-allowed ${
        tone === "primary"
          ? "bg-white text-black hover:bg-white/90 disabled:bg-white/25 disabled:text-black/40"
          : "bg-line-panel text-white hover:bg-[#2a2a2e] disabled:text-white/30"
      }`}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- 1 */

function Intro({
  onScan,
  onManual,
}: {
  onScan: () => void;
  onManual: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-center gap-[45px]"
    >
      <img
        src="/icons/twr-mast-lg.svg"
        alt=""
        width={183}
        height={317}
        className="block"
      />
      <div className="flex w-full flex-col gap-[26px]">
        <Heading
          title="ADD A NEW TOWER"
          body="To add your tower after installation is complete and it’s turned on, scan the QR Code inside the cabinet door to begin setup."
        />
        <div className="flex flex-col gap-[12px]">
          <Action tone="primary" onClick={onScan}>
            Scan QR Code
          </Action>
          {/* Not the frame's "Manually Enter": verb-first, and the same words
              the hand-off uses for the same destination. Two labels for one
              place is the cheapest kind of confusion to remove. */}
          <Action onClick={onManual}>Enter serial instead</Action>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- 2a */

/**
 * A QR that encodes nothing.
 *
 * There is no backend to point it at, so drawing a real code would be a
 * more convincing lie than an obviously-fake one. The module grid is derived
 * from the pairing code so it is stable across renders rather than flickering,
 * and it carries the three finder squares so it reads as a QR at a glance.
 * Swap this for a real encoder the moment there is a link worth encoding.
 */
function FakeQr({ seed }: { seed: string }) {
  const n = 21;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;

  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);

  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (finder(x, y)) continue;
      h = (h * 1103515245 + 12345) >>> 0;
      if ((h >>> 16) % 100 < 46) cells.push({ x, y });
    }
  }

  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="size-[160px]" aria-hidden>
      <rect width={n} height={n} fill="#ffffff" />
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} fill="#000000" />
      ))}
      {[
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`} fill="#000000">
          <rect x={x} y={y} width={7} height={7} />
          <rect x={x + 1} y={y + 1} width={5} height={5} fill="#ffffff" />
          <rect x={x + 2} y={y + 2} width={3} height={3} />
        </g>
      ))}
    </svg>
  );
}

function Handoff({
  onClaimed,
  onManual,
}: {
  onClaimed: (unit: UnclaimedUnit) => void;
  onManual: () => void;
}) {
  const unit = UNCLAIMED[0];
  const [copied, setCopied] = useState(false);
  const link = `sentinel.app/p/${unit.pairingCode}`;

  /* Stands in for polling the claim. The real version is a subscription that
     fires when the phone posts the scan; what matters for the design is that
     the desktop advances on its own, because a page that needs a Continue
     click after the work has already happened on the phone reads as two
     flows rather than one. */
  const done = useRef(onClaimed);
  done.current = onClaimed;
  useEffect(() => {
    const t = setTimeout(() => done.current(unit), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [unit]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-center gap-[32px]"
    >
      <Heading
        title="SCAN FROM YOUR PHONE"
        body="Open this link on your phone, then scan the QR Code inside the cabinet door."
      />

      {/* White, because a QR has to be. It is the one light surface in the app
          and that is correct — it is a target, not a panel. */}
      <div className="rounded-[8px] bg-white p-[12px]">
        <FakeQr seed={unit.pairingCode} />
      </div>

      <div className="flex w-full items-center justify-between gap-[12px] rounded-[8px] bg-card px-[12px] py-[10px]">
        <span className="truncate font-display text-[0.875rem] tracking-[0.14px] text-white">
          {link}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(`https://${link}`);
            setCopied(true);
          }}
          aria-live="polite"
          className="shrink-0 font-display text-[0.8125rem] tracking-[0.13px] text-muted transition-colors hover:text-white"
        >
          {copied ? "COPIED" : "COPY LINK"}
        </button>
      </div>

      {/* The live bit. Same dot and same pulse as a recording feed, because it
          is the same claim — something is happening that you are not driving. */}
      <p
        aria-live="polite"
        className="flex items-center gap-[8px] font-display text-[0.875rem] tracking-[0.14px] text-muted"
      >
        <span aria-hidden className="pulse-dot size-[8px] rounded-full bg-terra" />
        WAITING FOR TOWER
      </p>

      <button
        type="button"
        onClick={onManual}
        className="text-[0.875rem] leading-[20px] text-muted underline underline-offset-4 transition-colors hover:text-white"
      >
        Enter serial instead
      </button>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- 2b */

function Manual({
  onClaimed,
  onBack,
}: {
  onClaimed: (unit: UnclaimedUnit) => void;
  onBack: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const unit = findUnclaimed(serial, code);
    if (!unit) {
      /* On the fields, never as a page banner: the operator is reading a label
         off a cabinet door and the answer is "one of these two is wrong". */
      setError(
        "No tower matches that serial and code. Check the label inside the cabinet door.",
      );
      return;
    }
    onClaimed(unit);
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-center gap-[32px]"
    >
      <Heading
        title="ENTER THE SERIAL AND CODE"
        body="Both are on the label inside the cabinet door, beside the QR Code."
      />

      <div className="flex w-full flex-col gap-[20px]">
        <label className="flex flex-col gap-[8px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            SERIAL
          </span>
          <input
            value={serial}
            onChange={(e) => {
              setSerial(e.target.value);
              setError(null);
            }}
            placeholder="SN-0000-X"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            className={`h-[52px] rounded-[8px] bg-card px-[14px] font-display text-[1rem] tracking-[0.16px] text-white uppercase outline-none placeholder:text-white/25 focus-visible:outline-1 focus-visible:outline-terra ${
              error ? "ring-1 ring-critical" : ""
            }`}
          />
        </label>

        <label className="flex flex-col gap-[8px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            PAIRING CODE
          </span>
          {/* One input behind six boxes rather than six inputs. Six fields need
              focus-shuttling, break paste, and turn a backspace into a puzzle;
              the caret is faked with a ring on the active box instead. */}
          <div className="relative h-[52px]">
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Pairing code, six digits"
              aria-invalid={Boolean(error)}
              className="absolute inset-0 z-10 w-full bg-transparent tracking-[2.6em] text-transparent caret-transparent outline-none"
            />
            <div aria-hidden className="pointer-events-none flex h-full gap-[8px]">
              {Array.from({ length: 6 }, (_, i) => (
                <span
                  key={i}
                  className={`flex flex-1 items-center justify-center rounded-[8px] bg-card font-display text-[1.25rem] text-white ${
                    error
                      ? "ring-1 ring-critical"
                      : i === Math.min(code.length, 5)
                        ? "ring-1 ring-terra/70"
                        : ""
                  }`}
                >
                  {code[i] ?? ""}
                </span>
              ))}
            </div>
          </div>
        </label>

        {error && (
          <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
            {error}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col gap-[12px]">
        <Action
          tone="primary"
          type="submit"
          disabled={serial.trim().length < 4 || code.length < 6}
        >
          Continue
        </Action>
        <Action onClick={onBack}>Back</Action>
      </div>
    </motion.form>
  );
}

/* ----------------------------------------------------------------- 3 */

function NameSite({
  claim,
  value,
  onChange,
  onContinue,
}: {
  claim: UnclaimedUnit;
  value: string;
  onChange: (v: string) => void;
  onContinue: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  /* Rendered as the card it will become, live. `ZONE: PLACE` is a two-part
     convention nobody infers from a placeholder, and one keystroke against the
     real card teaches it in a way helper text cannot. */
  const preview: Tower = {
    id: claim.towerId,
    site: value.trim().toUpperCase() || "UNNAMED SITE",
    status: "online",
    solar: claim.solar,
    batteryPct: claim.batteryPct,
    tempC: claim.tempC,
    link: claim.link,
    serial: claim.serial,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex flex-col items-center gap-[32px]"
    >
      <Heading
        title="NAME THIS SITE"
        body="The tower reported everything else itself. This is the name your team will use on the radio."
      />

      {/* What was claimed, read-only. The point is not the metadata, it is
          confirming you have hold of the right box before naming it. */}
      <dl className="flex w-full items-center gap-[24px] rounded-[12px] bg-card px-[16px] py-[14px]">
        <img
          src="/icons/twr-mast-lg.svg"
          alt=""
          width={30}
          height={52}
          className="block shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <dt className="sr-only">Tower</dt>
          <dd className="font-display text-[0.875rem] tracking-[0.14px] text-white">
            {claim.towerId}
          </dd>
          <dt className="sr-only">Serial</dt>
          <dd className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-sub">
            {/* No "claimed just now" — it stops being true the moment setup
                is resumed, and the CONNECTED chip beside it already says the
                state. A time nobody can act on is not worth being wrong about. */}
            {claim.serial}
          </dd>
        </div>
        <span className="flex items-center gap-[6px] font-display text-[0.75rem] tracking-[0.12px] text-terra">
          <span aria-hidden className="size-[6px] rounded-full bg-terra" />
          CONNECTED
        </span>
      </dl>

      <label className="flex w-full flex-col gap-[8px]">
        <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
          SITE NAME
        </span>
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="WAREHOUSE: PARKING LOT"
          autoComplete="off"
          className="h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-white uppercase outline-none placeholder:text-white/25 focus-visible:outline-1 focus-visible:outline-terra"
        />
        <span className="text-[0.75rem] leading-[16px] text-muted">
          Place, then zone.
        </span>
      </label>

      <div className="w-full">
        <p className="mb-[10px] font-display text-[0.75rem] tracking-[0.12px] text-muted">
          ON THE FLEET
        </p>
        <div className="pointer-events-none w-[386px] max-w-full opacity-90">
          <TowerCard
            tower={preview}
            alerts={[]}
            onOpen={() => {}}
            onOpenAlerts={() => {}}
          />
        </div>
      </div>

      <Action
        tone="primary"
        disabled={value.trim().length < 3}
        onClick={onContinue}
      >
        Continue
      </Action>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- 4 */

function NameCameras({
  claim,
  names,
  onChange,
  onBack,
  onContinue,
}: {
  claim: UnclaimedUnit;
  names: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const complete = claim.cameras.every((c) => (names[c.id] || "").trim());
  /* 1-based, matching the `CAMERA n` labels on the rows — "one camera is not
     returning frames" makes the operator go and find out which. */
  const dark = claim.cameras
    .map((c, i) => (c.poster ? 0 : i + 1))
    .filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex flex-col items-center gap-[32px]"
    >
      {/* Always two — the count is stated rather than assumed because what the
          operator needs to confirm is that the tower reported *both* of them. */}
      <Heading
        title={`${claim.cameras.length} CAMERAS FOUND`}
        body="These names appear on every tile and in every alert. Name what you can see."
      />

      <ul className="flex w-full flex-col gap-[12px]">
        {claim.cameras.map((cam, i) => (
          <li
            key={cam.id}
            className="flex items-center gap-[14px] rounded-[12px] bg-card p-[12px]"
          >
            {/* You name what you can see — so the frame comes first, and a
                camera with no frame says so rather than showing a blank box. */}
            <span className="relative flex h-[54px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-tile-dead">
              {cam.poster ? (
                <img
                  src={cam.poster}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <span className="font-display text-[0.6875rem] tracking-[0.11px] text-muted">
                  NO SIGNAL
                </span>
              )}
            </span>

            <label className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <span className="font-display text-[0.6875rem] tracking-[0.11px] text-muted">
                CAMERA {i + 1}
              </span>
              <input
                value={names[cam.id] ?? ""}
                onChange={(e) => onChange(cam.id, e.target.value)}
                placeholder={cam.poster ? "GAS YARD" : "OIL STORAGE"}
                autoComplete="off"
                className="h-[38px] rounded-[6px] bg-panel px-[10px] text-[0.875rem] text-white uppercase outline-none placeholder:text-white/25 focus-visible:outline-1 focus-visible:outline-terra"
              />
            </label>
          </li>
        ))}
      </ul>

      {dark.length > 0 && (
        <p className="text-[0.8125rem] leading-[20px] text-warn">
          {dark.length === 1
            ? `Camera ${dark[0]} isn’t sending video.`
            : `Cameras ${dark.join(" and ")} aren’t sending video.`}{" "}
          Name {dark.length === 1 ? "it" : "them"} anyway — {dark.length === 1
            ? "it joins"
            : "they join"}{" "}
          the wall offline.
        </p>
      )}

      <div className="flex w-full flex-col gap-[12px]">
        {/* Why the button is off, said next to the work rather than hidden in a
            tooltip on the control the operator cannot press. */}
        {!complete && (
          <p className="text-[0.8125rem] leading-[20px] text-muted">
            Name both cameras to continue.
          </p>
        )}
        <Action tone="primary" disabled={!complete} onClick={onContinue}>
          Continue
        </Action>
        <Action onClick={onBack}>Back</Action>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- 5 */

function BringingOnline({
  claim,
  onFinish,
}: {
  claim: UnclaimedUnit;
  onFinish: () => void;
}) {
  const [done, setDone] = useState(0);
  const checksId = useId();

  useEffect(() => {
    if (done >= CHECKS.length) return;
    const t = setTimeout(() => setDone((d) => d + 1), 900);
    return () => clearTimeout(t);
  }, [done]);

  const dead = claim.cameras.filter((c) => !c.poster).length;
  const readings: { value: string; tone: string }[] = [
    {
      value: claim.link === "good" ? "GOOD" : claim.link === "warn" ? "FAIR" : "POOR",
      tone:
        claim.link === "good"
          ? "text-terra"
          : claim.link === "warn"
            ? "text-warn"
            : "text-critical",
    },
    {
      value: claim.solar === "fault" ? "FAULT" : claim.solar.toUpperCase(),
      tone: claim.solar === "fault" ? "text-critical" : "text-terra",
    },
    {
      value: `${claim.batteryPct}%`,
      tone:
        claim.batteryPct < 20
          ? "text-critical"
          : claim.batteryPct < 40
            ? "text-warn"
            : "text-terra",
    },
    {
      value: dead
        ? `${claim.cameras.length - dead} OF ${claim.cameras.length}`
        : "ALL CAMERAS",
      tone: dead ? "text-warn" : "text-terra",
    },
  ];

  const settled = done >= CHECKS.length;
  const nominal = readings.every((r) => r.tone === "text-terra");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex flex-col items-center gap-[32px]"
    >
      <Heading
        title="BRINGING IT ONLINE"
        body="The tower is reporting itself. This takes a few seconds."
      />

      <ul
        id={checksId}
        className="flex w-full flex-col gap-px overflow-hidden rounded-[12px]"
      >
        {CHECKS.map((label, i) => {
          const shown = i < done;
          return (
            <li
              key={label}
              className="flex h-[52px] items-center justify-between bg-card px-[16px]"
            >
              <span className="font-display text-[0.875rem] tracking-[0.14px] text-muted">
                {label}
              </span>
              {shown ? (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={FADE}
                  className={`flex items-center gap-[8px] font-display text-[0.875rem] tracking-[0.14px] tabular-nums ${readings[i].tone}`}
                >
                  {readings[i].value}
                  <span
                    aria-hidden
                    className={`size-[8px] rounded-full ${readings[i].tone.replace("text-", "bg-")}`}
                  />
                </motion.span>
              ) : (
                <span
                  aria-hidden
                  className="pulse-dot size-[8px] rounded-full bg-white/25"
                />
              )}
            </li>
          );
        })}
      </ul>

      {/* Amber does not block. The tower is real and already claimed; refusing
          to finish because a camera is down would leave the operator holding a
          site they cannot see, which is the opposite of the point. */}
      {settled && !nominal && (
        <p className="text-[0.8125rem] leading-[20px] text-warn">
          Not everything is nominal. The tower is added either way — watch it
          from the fleet.
        </p>
      )}

      {/* One label throughout. Swapping it for a status while the checks run
          puts a moving target under the pointer and states in a button what the
          list above already says. */}
      <Action
        tone="primary"
        disabled={!settled}
        describedBy={checksId}
        onClick={onFinish}
      >
        Open {claim.towerId}
      </Action>
    </motion.div>
  );
}
