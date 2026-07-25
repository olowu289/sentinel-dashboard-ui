import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AlertAttachment } from "@/lib/types";
import { FADE } from "@/lib/motion";
import { formatClock } from "@/lib/time";
import { MaskIcon } from "./Icon";

type Phase = "idle" | "working" | "done";

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className="animate-spin [animation-duration:800ms]"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <path
        d="M18 10a8 8 0 0 0-8-8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="m3 8.5 3.5 3.5L13 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClipCard({
  attachment,
  at,
  alertId,
}: {
  attachment: AlertAttachment;
  at: number;
  alertId: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  /* Prototype: the export is simulated. The states are the real deliverable —
     evidence export is slow enough that a button which does nothing visible
     gets clicked repeatedly, producing duplicate exports. */
  const download = () => {
    if (phase !== "idle") return;
    setPhase("working");
    timers.current.push(
      setTimeout(() => setPhase("done"), 1200),
      setTimeout(() => setPhase("idle"), 3400),
    );
  };

  const label =
    phase === "working"
      ? `Preparing ${attachment.title} for download`
      : phase === "done"
        ? `${attachment.title} downloaded`
        : `Download ${attachment.title} from ${alertId}`;

  return (
    <div className="flex min-h-[67px] w-[346px] max-w-full items-center gap-[11px] rounded-[8px] bg-panel px-[6px]">
      <div className="relative h-[57px] w-[64px] shrink-0 lg:w-[85px] overflow-hidden rounded-[8px] bg-white">
        <img
          src={attachment.thumbnail}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        {attachment.kind === "clip" && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <circle cx="9" cy="9" r="9" fill="rgba(0,0,0,0.45)" />
              <path d="M7 5.5l5 3.5-5 3.5V5.5Z" fill="white" />
            </svg>
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-[4px]">
        <p className="line-clamp-2 text-[0.8125rem] tracking-[0.13px] text-white lg:truncate">
          {attachment.title}
        </p>
        <p className="truncate text-[0.75rem] lg:text-[0.6875rem] tracking-[0.11px] text-muted tabular-nums">
          {formatClock(at)}
        </p>
      </div>

      <div className="ml-auto mr-[4px] flex shrink-0 lg:mr-[13px] items-center gap-[7px]">
        <button
          type="button"
          aria-label={label}
          aria-busy={phase === "working"}
          title={label}
          onClick={download}
          className={`flex size-[24px] items-center justify-center rounded-[4px] transition-colors ${
            phase === "done"
              ? "text-terra"
              : "text-muted hover:bg-white/8 hover:text-white"
          }`}
        >
          {/* Scale, not just opacity: at 24px a crossfade is invisible, and
              `mode="wait"` because two icons dissolving through each other in
              a box this small is mush. The done → idle step animates too, so
              the check retracts rather than blinking out — a success state
              that vanishes reads as a failure. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={phase}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={FADE}
              className="flex items-center justify-center"
            >
              {phase === "working" ? (
                <Spinner />
              ) : phase === "done" ? (
                <Check />
              ) : (
                <MaskIcon src="/icons/clip-download.svg" size={24} />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
        {/* A clip plays, a voice message sounds — the glyph has to say which,
            because the two rows are otherwise identical and the operator is
            deciding whether this needs headphones or a screen. */}
        <button
          type="button"
          aria-label={`Play ${attachment.title}`}
          title={attachment.kind === "clip" ? "Play clip" : "Play audio"}
          className="flex size-[24px] items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-white/8 hover:text-white"
        >
          <MaskIcon
            src={
              attachment.kind === "clip"
                ? "/icons/clip-play.svg"
                : "/icons/clip-audio.svg"
            }
            size={24}
          />
        </button>
      </div>

      {/* Screen-reader confirmation: the icon swap is invisible to AT. */}
      <span role="status" className="sr-only">
        {phase === "done" ? `${attachment.title} downloaded` : ""}
      </span>
    </div>
  );
}
