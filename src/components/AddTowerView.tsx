import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { MutationError } from "@/components/MutationFeedback";
import { ENTER, FADE } from "@/lib/motion";
import { useMutation } from "@/lib/useMutation";
import { deviceName } from "@/lib/deviceName";
import { useCapitalName } from "@/lib/useCapitalName";
import {
  CODE_CHARS,
  createClaim,
  formatCountdown,
  isCompleteCode,
  msUntilExpiry,
  normalisePairingCode,
  PairingCodeError,
  type Claim,
} from "@/lib/api/claim";

/**
 * Adding a tower is a *claim*, not a create.
 *
 * The unit is already bolted to the ground and powered on by the time anyone
 * opens this screen. So nothing here asks the operator to describe their
 * hardware — the tower reports itself the moment it enrols. The flow asks for
 * exactly two things, because those are exactly the two the real API takes:
 * the pairing code printed on the tower's console, and what to call the site.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT CHANGED FROM THE PROTOTYPE, AND WHY
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE SERIAL IS GONE. There is no serial anywhere in this system. The pairing
 * code IS the identifier — it is derived from the tower's own public key and is
 * the thing the tower proves possession of. A serial box would have been a
 * field that looks like it matters and does not, on the one screen where
 * getting the identifier wrong is the whole failure mode.
 *
 * THE NAME IS ASKED FOR BEFORE THE WAIT, NOT AFTER. The design put "NAME THIS
 * SITE" after the tower reported itself, which reads better — but
 * `create_pending_claim` takes the label alongside the code and carries it into
 * the tower record at enrolment, and coordination serves no route to change a
 * label afterwards. Asking after would mean either inventing an endpoint or
 * showing a name field that quietly does nothing. So both real inputs are
 * collected together, and the confirmation screen shows the name the tower came
 * up under.
 *
 * THE WAIT IS REAL AND LIVES ON THE SERVER. It used to be
 * `setTimeout(4500) → onClaimed(unit)`, which fabricated a tower unconditionally
 * — it could not fail, could not be refused, and vanished on a reload. The
 * pending state is now a real claim, polled from `GET /v1/viewer/claims`, and it
 * survives closing the browser because it was never ours to hold.
 *
 * THE QR PATH CANNOT COMPLETE. Its screens stay, because it is a real intended
 * feature and the design is worth keeping — but there is no phone-claim backend,
 * so it says so and adds nothing. A walk-through that ends in a tower would be
 * the same lie the timer was.
 */

type Step = "intro" | "handoff" | "code" | "waiting";

export function AddTowerView({
  pendingClaim,
  claimById,
  onNavigate,
  onCancel,
  onClaimed,
  onDone,
}: {
  /** An open claim from a previous visit, loaded by the shell from the server. */
  pendingClaim?: Claim | null;
  /**
   * The shell's live reading of ONE claim, by id.
   *
   * ⚠ THIS EXISTS BECAUSE `pendingClaim` GOES AWAY AT THE MOMENT THAT MATTERS,
   * and that was the bug. The shell derives it as "the claim whose status is
   * `open`", which is right for the dashboard's pending card — a consumed
   * claim is a real tower and belongs in the fleet list, not in a card about
   * a registration. But this screen is watching one particular claim through
   * to the end, and the end is the status it stops being `open`. So the
   * moment the tower enrolled, `pendingClaim` became `null`, the effect below
   * bailed on it, and the local copy kept saying `open` for ever: the screen
   * sat on WAITING FOR THE TOWER with the pairing window ticking down, for a
   * tower that had already arrived.
   *
   * A claim this screen has never registered is none of its business, which
   * is why this is a lookup by id rather than a list.
   */
  claimById?: (id: string) => Claim | null;
  /** Rail destinations, routed by the shell. */
  onNavigate: (id: string) => void;
  onCancel: () => void;
  /** A claim was registered. The shell starts polling for it. */
  onClaimed: (claim: Claim) => void;
  /** The tower enrolled, and the operator is finished here. */
  onDone: (deviceLabel: string) => void;
}) {
  /* Resume straight into the wait if a claim is already open. The operator has
     already done the part that needed them. */
  const [step, setStep] = useState<Step>(pendingClaim ? "waiting" : "intro");
  /**
   * WHICH claim this screen is following. The row itself is only the fallback.
   *
   * Captured once and then kept: what is drawn comes from the shell's live
   * reading of that id, so a status change reaches this screen on the poll
   * that sees it rather than when something hands the row back down.
   */
  const [watching, setWatching] = useState<Claim | null>(pendingClaim ?? null);
  const claim = (watching ? claimById?.(watching.claim_id) : null) ?? watching;

  useEffect(() => {
    /* `prev ?? next`: the id is settled on the first claim this screen sees
       and does not move afterwards. The lookup above is what keeps it
       current, and it answers for a consumed claim as readily as an open
       one -- which is the whole point of it. */
    if (pendingClaim) setWatching((prev) => prev ?? pendingClaim);
  }, [pendingClaim]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      <IconRail
        active="add"
        onSelect={(id) => {
          onCancel();
          onNavigate(id);
        }}
        className="hidden lg:block"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line px-[16px]">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[4px]">
            <button
              type="button"
              onClick={onCancel}
              title="Back to all towers"
              className="rounded-[2px] font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-body-ink"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span
              aria-current="page"
              className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink"
            >
              ADD TOWER
            </span>
          </nav>
          <MaskIcon src="/icons/bell.svg" size={20} className="text-body-ink/70" />
        </header>

        {/* One column, 483px, centred — the frame's measurement, kept so the
            page never reflows between steps. */}
        <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-[24px] py-[48px]">
          <div className="my-auto w-[483px] max-w-full">
            {step === "intro" && (
              <Intro onScan={() => setStep("handoff")} onCode={() => setStep("code")} />
            )}
            {step === "handoff" && <Handoff onCode={() => setStep("code")} />}
            {step === "code" && (
              <EnterCode
                onRegistered={(c) => {
                  setWatching(c);
                  onClaimed(c);
                  setStep("waiting");
                }}
                onBack={() => setStep("intro")}
              />
            )}
            {step === "waiting" && claim && (
              <Waiting
                claim={claim}
                onDone={() => onDone(claim.label)}
                onReenter={() => setStep("code")}
              />
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
      <h1 className="font-display text-[1.125rem] leading-[20px] tracking-[0.18px] text-body-ink">
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
  onClick,
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`h-[57px] w-full rounded-[8px] text-[1rem] leading-[20px] font-medium transition-colors disabled:cursor-not-allowed ${
        tone === "primary"
          ? "bg-action text-action-ink hover:bg-overlay/90 disabled:bg-overlay/25 disabled:text-action-ink/40"
          : "bg-line-panel text-body-ink hover:bg-card-line disabled:text-body-ink/30"
      }`}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- 1 */

function Intro({ onScan, onCode }: { onScan: () => void; onCode: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-center gap-[45px]"
    >
      <img src="/icons/twr-mast-lg.svg" alt="" width={183} height={317} className="block" />
      <div className="flex w-full flex-col gap-[26px]">
        <Heading
          title="ADD A NEW TOWER"
          body="Once the tower is installed and powered on, register it with the pairing code on its console."
        />
        <div className="flex flex-col gap-[12px]">
          {/* Enter code is the PRIMARY action now, because it is the one that
              works. The QR path keeps its place in the flow and its screen, but
              promoting a route that cannot finish would be the wrong emphasis
              on the one screen where finishing is the point. */}
          <Action tone="primary" onClick={onCode}>
            Enter pairing code
          </Action>
          <Action onClick={onScan}>Scan QR Code</Action>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- 2a */

/**
 * A QR that encodes nothing, on a path that cannot finish.
 *
 * ⚠ THIS SCREEN USED TO FABRICATE A TOWER. It ran a 4.5-second timer and then
 * called `onClaimed` unconditionally — no server, no code, no possibility of
 * refusal — and an operator who walked it got a real-looking tower on their
 * fleet that had never existed. That timer is gone.
 *
 * The screen stays because phone hand-off is a real intended feature and the
 * design is worth keeping warm. The drawn code stays because it is obviously
 * decorative and a *convincing* fake QR would be the worse lie. What is not
 * here any more is any way for this path to end in a tower.
 */
function Handoff({ onCode }: { onCode: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-center gap-[32px]"
    >
      <Heading
        title="SCAN FROM YOUR PHONE"
        body="Scanning the QR code inside the cabinet door will register the tower from your phone."
      />

      <div className="relative overflow-hidden rounded-[8px] bg-overlay/12 p-[12px]">
        <DecorativeQr />
      </div>

      <div
        role="status"
        className="flex w-full flex-col gap-[6px] rounded-[8px] bg-warn/12 px-[14px] py-[12px]"
      >
        <p className="text-[0.875rem] leading-[20px] font-medium text-warn">
          Phone registration isn&rsquo;t available yet
        </p>
        <p className="text-[0.8125rem] leading-[20px] text-sub">
          This screen cannot add a tower yet. Use the pairing code instead.
        </p>
      </div>

      <Action tone="primary" onClick={onCode}>
        Enter pairing code instead
      </Action>
    </motion.div>
  );
}

/**
 * A drawn code, deliberately not a real one.
 *
 * There is nothing to encode — no claim URL, no token — so a scannable code
 * would either point nowhere or point somewhere fabricated. Greyed and inert,
 * behind copy that says it does not work yet, it reads as the placeholder it is.
 */
function DecorativeQr() {
  const n = 21;
  let h = 987654321;
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
    <svg viewBox={`0 0 ${n} ${n}`} className="size-[160px] opacity-40" aria-hidden>
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

/* ---------------------------------------------------------------- 2b */

/**
 * The real registration: a pairing code and THE TOWER'S NAME.
 *
 * Both, together, because both are what `POST /v1/viewer/claims` takes. The
 * name is not a nicety collected later — it is carried into the tower record at
 * enrolment and there is no route to change it afterwards.
 *
 * ⚠ IT NAMES THE TOWER, NOT THE SITE, AND THE FIELD USED TO SAY OTHERWISE.
 * The label read SITE NAME and the hint said "this is the name your team will
 * use on the radio", so the first release tower was registered as "BASE SITE":
 * somebody answered the question they were asked, truthfully, and the hub now
 * holds a mast called after the place it stands in. The site is already chosen
 * elsewhere (a tower is added to a cell, and a cell is in a site); what nothing
 * else can supply is what to call this mast.
 */
function EnterCode({
  onRegistered,
  onBack,
}: {
  onRegistered: (claim: Claim) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  /* Capitalised as it is typed, caret where the operator left it. The box
     used to carry an `uppercase` CLASS, which drew capitals over whatever was
     typed and sent the typing — so the one place in the app that NAMES a
     tower for the first time was the one place most likely to register it in
     lower case. */
  const capitals = useCapitalName(setLabel);
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const register = useMutation({ quiet: true });
  const phase = register.phase("claim");

  useEffect(() => codeRef.current?.focus(), []);

  const ready = isCompleteCode(code) && label.trim().length >= 3;

  const submit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (!ready || phase.kind === "pending") return;

      let normalised: string;
      try {
        normalised = normalisePairingCode(code);
      } catch (err) {
        setCodeProblem(err instanceof PairingCodeError ? err.message : "Invalid code");
        return;
      }
      setCodeProblem(null);

      void register.run("claim", async () => {
        const claim = await createClaim(normalised, deviceName(label).trim());
        /* The code leaves component state the moment it is no longer needed.
           It is a live secret until the tower consumes it. */
        setCode("");
        onRegistered(claim);
      });
    },
    [code, label, onRegistered, phase.kind, ready, register],
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  };

  const failed = phase.kind === "error" || codeProblem !== null;

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-center gap-[32px]"
    >
      <Heading
        title="REGISTER THIS TOWER"
        body="The pairing code is on the tower's console."
      />

      <div className="flex w-full flex-col gap-[20px]">
        <label className="flex flex-col gap-[8px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            PAIRING CODE
          </span>
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeProblem(null);
            }}
            onKeyDown={onKey}
            disabled={phase.kind === "pending"}
            placeholder="K7QM-4X8N-P2W3"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={failed || undefined}
            aria-describedby="code-help"
            className={`h-[52px] rounded-[8px] bg-card px-[14px] font-display text-[1.25rem] tracking-[0.2em] text-body-ink uppercase outline-none placeholder:text-body-ink/20 focus-visible:outline-1 focus-visible:outline-terra ${
              failed ? "ring-1 ring-critical" : ""
            }`}
          />
          <span id="code-help" className="text-[0.75rem] leading-[16px] text-muted">
            {CODE_CHARS} characters. Dashes and spaces are ignored, and the
            letters I, L, O and U are never used.
          </span>
          {codeProblem && (
            <span role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
              {codeProblem}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-[8px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            TOWER NAME
          </span>
          <input
            ref={capitals.ref}
            value={label}
            onChange={capitals.onChange}
            onKeyDown={onKey}
            disabled={phase.kind === "pending"}
            placeholder="NORTH GATE MAST"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-body-ink outline-none placeholder:text-body-ink/25 focus-visible:outline-1 focus-visible:outline-terra"
          />
          <span className="text-[0.75rem] leading-[16px] text-muted">
            What to call this tower, not the site it stands on.
          </span>
        </label>

        <MutationError phase={phase} onRetry={() => void register.retry("claim")} />
      </div>

      <div className="flex w-full flex-col gap-[12px]">
        <Action tone="primary" type="submit" disabled={!ready || phase.kind === "pending"}>
          {phase.kind === "pending" ? "REGISTERING…" : "Register tower"}
        </Action>
        <Action onClick={onBack}>Back</Action>
      </div>
    </motion.form>
  );
}

/* ----------------------------------------------------------------- 3 */

/**
 * How long the finished state is held before this screen takes the operator
 * to the dashboard.
 *
 * Long enough to read one heading and decide to press the button instead,
 * short enough that nobody waits on it. Exported so the test names the same
 * number the screen does.
 */
export const REGISTERED_DWELL_MS = 5000;

/**
 * Waiting for the tower to enrol, and then saying so.
 *
 * This is a REAL wait on a real deadline. The claim lives on the server, so
 * closing the browser and coming back finds it still here — which is the point,
 * and is what the old 4.5-second timer could never do.
 *
 * The countdown is the honest shape for the wait: the window is fifteen
 * minutes and then the claim lapses, so a spinner with no end would be lying
 * about what happens next.
 *
 * ⚠ AND IT IS THE WRONG SHAPE THE INSTANT THE TOWER ARRIVES. That clock is
 * the time left to TYPE THE CODE, nothing else, so a screen still running it
 * after enrolment is counting down to a deadline that cannot be missed any
 * more. It stopped and it is hidden, because a number that has stopped
 * meaning anything is worse than no number: it is still being read.
 */
function Waiting({
  claim,
  onDone,
  onReenter,
}: {
  claim: Claim;
  onDone: () => void;
  onReenter: () => void;
}) {
  const [left, setLeft] = useState(() => msUntilExpiry(claim));

  /* `enrolled` beats everything, including a window that lapsed in the same
     second the tower came up. A claim the tower consumed is spent, and the
     deadline it was racing stopped applying the moment it did. */
  const enrolled = claim.status === "consumed";
  const dead =
    !enrolled &&
    (claim.status === "expired" || claim.status === "superseded" || left <= 0);

  useEffect(() => {
    if (enrolled) return;
    setLeft(msUntilExpiry(claim));
    const t = setInterval(() => setLeft(msUntilExpiry(claim)), 1000);
    return () => clearInterval(t);
  }, [claim, enrolled]);

  /**
   * ⚠ THE CALLBACK IS READ THROUGH A REF, AND THE TIMER DOES NOT DEPEND ON IT.
   *
   * `onDone` is an inline arrow at the shell's call site, so it is a new
   * function on every render of the shell — and the shell re-renders about
   * once a second on its own, for the battery fill and the latency walk. A
   * `setTimeout` in an effect that listed it as a dependency would be torn
   * down and started again before it ever fired, and this screen would sit on
   * the finished state for ever while looking entirely correct. The effect
   * depends on the one thing that actually gates it.
   */
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!enrolled) return;
    const t = setTimeout(() => doneRef.current(), REGISTERED_DWELL_MS);
    /* ⚠ AND LEAVING THIS SCREEN CANCELS IT. An operator who presses Dashboard
       or a rail destination during these five seconds has chosen where to be,
       and a timer that fired afterwards would move them from a screen they
       asked for to one they did not. Unmounting is the cancel. */
    return () => clearTimeout(t);
  }, [enrolled]);

  const name = deviceName(claim.label);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex flex-col items-center gap-[32px]"
    >
      <img src="/icons/twr-mast-lg.svg" alt="" width={183} height={317} className="block max-h-[220px] w-auto" />

      <Heading
        title={
          enrolled
            ? `${name} is registered`
            : dead
              ? "REGISTRATION EXPIRED"
              : "WAITING FOR THE TOWER"
        }
        body={
          enrolled
            ? "It will show online once it connects."
            : dead
              ? "The tower did not connect in time. The code is still valid, so register it again."
              : "The tower will connect on its own. You can leave this page; the registration is saved."
        }
      />

      <dl className="flex w-full items-center gap-[24px] rounded-[12px] bg-card px-[16px] py-[14px]">
        <img src="/icons/twr-mast-lg.svg" alt="" width={30} height={52} className="block shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <dt className="sr-only">Site name</dt>
          <dd className="truncate font-display text-[0.875rem] tracking-[0.14px] text-body-ink">
            {name}
          </dd>
          <dt className="sr-only">Status</dt>
          {/* Three states, and the enrolled one deliberately does not repeat
              the heading. "Registered" is said above it now, so the line says
              the part that is still outstanding and nothing else. */}
          <dd className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-sub">
            {enrolled
              ? "Waiting to connect"
              : dead
                ? "Not registered"
                : "Registered, waiting to connect"}
          </dd>
        </div>
        {/* ⚠ GONE ONCE THE TOWER IS IN, not frozen at whatever it read. This
            is the pairing window and nothing else. */}
        {!dead && !enrolled && (
          <span
            data-claim-countdown
            className="flex shrink-0 items-center gap-[6px] font-display text-[0.75rem] tracking-[0.12px] text-detect tabular-nums"
          >
            <span aria-hidden className="pulse-dot size-[6px] rounded-full bg-detect" />
            {formatCountdown(left)}
          </span>
        )}
      </dl>

      {enrolled ? (
        <Action tone="primary" onClick={onDone}>
          Go to dashboard
        </Action>
      ) : dead ? (
        <Action tone="primary" onClick={onReenter}>
          Register again
        </Action>
      ) : (
        <p
          aria-live="polite"
          className="flex items-center gap-[8px] font-display text-[0.875rem] tracking-[0.14px] text-muted"
        >
          <span aria-hidden className="pulse-dot size-[8px] rounded-full bg-terra" />
          WAITING FOR TOWER
        </p>
      )}
    </motion.div>
  );
}
