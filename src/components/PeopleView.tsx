import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { ENTER, FADE } from "@/lib/motion";
import { isExpired } from "@/lib/data";
import { formatEventTime } from "@/lib/time";
import { SiteClock } from "@/components/SiteClock";
import type { Alert, Person } from "@/lib/types";

/**
 * The watchlist: who the fleet is looking for, and where they have been seen.
 *
 * A sighting is not a new kind of event. It is a `person` detection that also
 * carries an identity and a match confidence, so it lands in the alert feed,
 * the fleet card counts and the new-alert banner without any of them being
 * taught anything. What lives here is the roster, the reason each person is on
 * it, and their own history — the fleet-wide feed stays where it is.
 *
 * Two rules run through every screen below. A match is a *possibility*, never
 * an identification: the confidence travels with the name everywhere, and the
 * copy says so. And a person being seen is a **detection**, so it takes the
 * detect amber the alert rail already uses — red is a fault or a live
 * transmission, and somebody walking past a camera is neither.
 */

const DEFAULT_DAYS = 30;

/* Why an operator stops watching somebody, as the four answers that actually
   come up, plus a way to say something else. Named endings rather than a free
   box for everyone: a required text field on a routine act gets "n/a" typed
   into it, and a set of four gets read back consistently three months later.
   `Added in error` is on the list deliberately — a watchlist that cannot admit
   a mistake is one where mistakes stay on it. */
/* The conditions that make a reference frame worth comparing against. Four,
   because a checklist nobody reads is a checklist that may as well be a
   sentence. */
const PHOTO_RULES = [
  "Face fills the frame and looks at the camera",
  "Even light, with no shadow across the face",
  "Nothing covering the face — no sunglasses or mask",
  "Taken recently, with nobody else in shot",
] as const;

const STOP_REASONS = [
  "Matter resolved",
  "No longer of interest",
  "Added in error",
  "Site withdrew the request",
  "Other",
] as const;

export function PeopleView({
  people,
  alerts,
  operator,
  enrolFrom,
  onNavigate,
  onBack,
  onEnrol,
  onExtend,
  onStopWatching,
  onDelete,
}: {
  people: Person[];
  /** Every alert in the fleet. Sightings are found in here by
   *  `matchedPersonId` rather than kept in a second list that could disagree. */
  alerts: Alert[];
  /** Whose name goes on an enrolment. Adding somebody to a watchlist is an act
   *  with an author, and the roster shows it. */
  operator: string;
  /** A detection the operator chose to watch for. Arriving with one opens
   *  enrolment directly, with the frame and the zone already filled in — the
   *  face is what they were looking at, so re-finding it would be busywork. */
  enrolFrom?: Alert | null;
  /** Rail destinations, routed by the shell. */
  onNavigate: (id: string) => void;
  onBack: () => void;
  onEnrol: (person: Omit<Person, "id">) => void;
  onExtend: (personId: string, days: number) => void;
  /** Take somebody off the list. Matching ends now; the entry stays, expired,
   *  with the reason on it. */
  onStopWatching: (personId: string, reason: string) => void;
  /** Erase the entry. Only offered once it is already stopped. */
  onDelete: (personId: string) => void;
}) {
  /* Nothing selected on arrival. The roster used to be a 417px column with a
     detail pane beside it, where an empty pane was wasted screen and opening
     the first person cost nothing. The wall is the screen now — landing on it
     with somebody's record already over the top hides the thing the operator
     came to look at. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(Boolean(enrolFrom));

  /* Escape closes whichever panel is over the wall. Bound here rather than in
     either panel because they are alternatives — one listener that knows which
     is open cannot get out of step with a second one that does not. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      setSelectedId(null);
      setEnrolling(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = people.filter((p) => !isExpired(p));
  const expired = people.filter((p) => isExpired(p));
  const selected = people.find((p) => p.id === selectedId) ?? null;

  const sightingsFor = (id: string) =>
    alerts
      .filter((a) => a.matchedPersonId === id && !a.matchRejected)
      .sort((a, b) => b.at - a.at);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-ink">
      <IconRail
        active="poi"
        onSelect={onNavigate}
        className="hidden lg:block"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line px-[16px]">
          {/* A breadcrumb, like every other way up in this app. The frame's
              crumb reads TOWER, singular; every other one in the product says
              TOWERS and lands on the fleet, and a crumb naming one thing while
              going to a list of them is how a breadcrumb stops being trusted. */}
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-[4px]"
          >
            <button
              type="button"
              onClick={onBack}
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
              PEOPLE OF INTEREST
            </span>
          </nav>
          <SiteClock />
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[15px] pb-[24px]">
          {/* The frame floats this above the grid rather than in the bar. It
              is the only action on the screen, and putting it on the same
              line as the cards it produces is what makes it read as "add one
              of these". */}
          <div className="flex shrink-0 justify-end py-[24px] pr-[8px]">
            <button
              type="button"
              onClick={() => {
                setEnrolling(true);
                setSelectedId(null);
              }}
              className="flex items-center gap-[8px] rounded-[8px] bg-white px-[20px] py-[12px] text-[0.875rem] leading-[20px] font-bold tracking-[0.14px] text-black transition-colors hover:bg-white/90"
            >
              <MaskIcon src="/icons/nav-add.svg" size={24} />
              ADD NEW
            </button>
          </div>

          {people.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-[24px] text-center">
              <p className="max-w-[360px] text-[0.875rem] leading-[20px] text-muted">
                Nobody is on the list yet. Add a person and the fleet raises an
                alert when a camera sees a possible match.
              </p>
            </div>
          ) : (
            /* Five across at the frame's width. The card keeps its 356×447
               proportion rather than that width — a fixed px width from a
               desktop frame is what left the clip card a dead strip on a
               phone. Expired entries sit in the same grid, dimmed: the frame
               draws one wall of faces and a heading it does not have would be
               inventing a section. */
            <ul className="grid grid-cols-2 gap-[8px] md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {[...active, ...expired].map((person) => (
                <PoiCard
                  key={person.id}
                  person={person}
                  sightings={sightingsFor(person.id).length}
                  lastSeen={sightingsFor(person.id)[0]?.at}
                  expired={isExpired(person)}
                  onSelect={() => {
                    setSelectedId(person.id);
                    setEnrolling(false);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Over the grid rather than beside it. The wall is the screen now, so
          a person's record arrives on top of it at the panel width the rest of
          the app uses, and leaving puts the wall back untouched. */}
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full flex-col border-l border-line-panel bg-ink lg:w-[560px] ${
          enrolling || selected ? "flex" : "hidden"
        }`}
      >
        {enrolling ? (
          <Enrol
            operator={operator}
            presetPhoto={enrolFrom?.attachment?.thumbnail}
            presetReason={
              enrolFrom
                ? `Seen at ${enrolFrom.zone}, ${formatEventTime(enrolFrom.at)}.`
                : undefined
            }
            onCancel={() => setEnrolling(false)}
            onSave={(person) => {
              onEnrol(person);
              setEnrolling(false);
            }}
          />
        ) : selected ? (
          <PersonDetail
            /* Keyed so the confirm state below cannot survive a swap and
               appear against the next person — the same trap `AlertDetail`
               documents. */
            key={selected.id}
            person={selected}
            sightings={sightingsFor(selected.id)}
            onClose={() => setSelectedId(null)}
            onExtend={(days) => onExtend(selected.id, days)}
            onStopWatching={(reason) => onStopWatching(selected.id, reason)}
            onDelete={() => {
              /* Land on whoever is next rather than on nothing. Deleting one
                 entry is not a reason to be shown an empty panel. */
              const next = people.find((p) => p.id !== selected.id);
              onDelete(selected.id);
              setSelectedId(next?.id ?? null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- roster */

/**
 * One person, as a face.
 *
 * The roster used to be a 48px thumbnail on a 12px row, which is the shape of
 * a settings list — and the thing an operator is actually doing here is
 * *recognising somebody*. The frame makes the photograph the card, which is
 * the right call: a face at 356px is a face you could match against a feed,
 * and one at 48px is a swatch.
 *
 * Everything else sits on top of it. The scrim is what keeps the name legible
 * over a photo nobody chose for its contrast — it starts at a third of the way
 * down so the face itself is untouched.
 */
function PoiCard({
  person,
  sightings,
  lastSeen,
  expired = false,
  onSelect,
}: {
  person: Person;
  sightings: number;
  lastSeen?: number;
  expired?: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${person.name}, ${sightings} sighting${sightings === 1 ? "" : "s"}${expired ? ", expired" : ""}`}
        /* 356×447 as a ratio rather than a width. A fixed px width off a
           desktop frame is what left the clip card a dead strip on a phone. */
        className={`group relative block aspect-[356/447] w-full overflow-hidden rounded-[17.62px] border border-card-line bg-panel text-left transition-opacity ${
          expired ? "opacity-55 hover:opacity-80" : ""
        }`}
      >
        <img
          src={person.photo}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        {/* The design's own stop: transparent to a third of the way down, then
            into black. Anything higher and it starts eating the face. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-transparent from-[34.6%] to-black"
        />

        {/* How many times a camera has seen them. The count is the reading an
            operator scans this wall for — a face nobody has seen and a face
            seen nine times are different situations. */}
        <span className="absolute right-[12px] top-[7px] flex items-center gap-[6px] rounded-[32px] bg-white/10 px-[8px] py-[6px] backdrop-blur-[2px]">
          <MaskIcon src="/icons/poi-eye.svg" size={20} className="text-white" />
          <span className="text-[0.875rem] leading-none font-medium tracking-[0.14px] text-white tabular-nums">
            {sightings}
          </span>
        </span>

        <span className="absolute bottom-[16px] left-[23px] right-[16px] flex flex-col gap-[6px]">
          <span className="truncate text-[1.125rem] leading-[normal] font-medium tracking-[0.18px] text-white uppercase">
            {person.name}
          </span>
          <span className="flex min-w-0 items-center gap-[6px] text-[0.875rem] leading-[normal] tracking-[0.14px] text-sub">
            {/* Terra with a soft halo, the same dot the fleet card's status
                word carries. Green here is the entry doing its job: the fleet
                is matching against this face. An expired one has stopped, so
                it takes the muted dot rather than claiming otherwise. */}
            <span
              aria-hidden
              className={`size-[6px] shrink-0 rounded-full ${
                expired ? "bg-muted" : "bg-terra ring-[1.5px] ring-terra/25"
              }`}
            />
            {/* Absence is diagnostic: never seen is a reading, not a zero. */}
            <span className="truncate">
              {expired
                ? "EXPIRED · NO LONGER MATCHING"
                : sightings === 0
                  ? "NEVER SEEN"
                  : `LAST SEEN: ${formatEventTime(lastSeen!)}`}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

/* ---------------------------------------------------------------- detail */

function PersonDetail({
  person,
  sightings,
  onClose,
  onExtend,
  onStopWatching,
  onDelete,
}: {
  person: Person;
  sightings: Alert[];
  /** The panel sits over the wall now, so it has to be dismissable. When it
   *  was a pane beside a 417px list there was nothing to close — it was just
   *  the other half of the screen. */
  onClose: () => void;
  onExtend: (days: number) => void;
  onStopWatching: (reason: string) => void;
  onDelete: () => void;
}) {
  const expired = isExpired(person);
  /* An inline confirm rather than a dialog. This app has no dialog primitive,
     and inventing one for a two-line consequence would be a bigger decision
     than the action it guards — but the consequence still has to be read
     before the second press, so the step is not skippable. */
  const [confirming, setConfirming] = useState(false);
  /* Why watching is being stopped. Blank until picked, which is what holds the
     button — an unexplained removal is the half of the record this list was
     missing. Only asked when stopping: deleting erases the entry, so a reason
     captured there would have nowhere to live. */
  const [why, setWhy] = useState<string>("");
  const [note, setNote] = useState("");
  const reason = why === "Other" ? note.trim() : why;

  return (
    <motion.div
      key={person.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-[46px] shrink-0 items-center gap-[12px] border-b border-line px-[16px]">
        <h1 className="min-w-0 flex-1 truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
          {person.name}
        </h1>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${person.name}`}
          title="Close (Esc)"
          className="flex size-[20px] shrink-0 items-center justify-center text-white transition-colors hover:text-muted"
        >
          <MaskIcon src="/icons/clip-close.svg" size={20} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto p-[24px]">
        <div className="flex items-start gap-[20px]">
          <img
            src={person.photo}
            /* Decorative: the heading beside it already says whose face this
               is, and announcing the name twice is noise on a screen a screen
               reader user is scanning. */
            alt=""
            width={96}
            height={96}
            className="block size-[96px] shrink-0 rounded-[12px] object-cover"
          />
          <dl className="flex min-w-0 flex-1 flex-col gap-[10px]">
            <Field label="REASON" value={person.reason} />
            <Field
              label="ADDED"
              value={`${person.addedBy} · ${formatEventTime(person.addedAt)}`}
            />
            <Field
              label="EXPIRES"
              value={
                expired
                  ? `${formatEventTime(person.expiresAt)} — no longer matching`
                  : formatEventTime(person.expiresAt)
              }
              tone={expired ? "text-warn" : undefined}
            />
            {/* Only on an entry somebody stopped. One that simply ran its term
                has no decision to account for, and printing "Not recorded"
                there would invent a gap rather than report one. */}
            {person.stoppedReason && (
              <Field
                label="STOPPED"
                value={`${person.stoppedReason} · ${person.stoppedBy} · ${formatEventTime(person.stoppedAt!)}`}
              />
            )}
          </dl>
        </div>

        {/* Extending is the deliberate act. Nothing renews on its own, which is
            the whole point of having an expiry at all. */}
        {confirming ? (
          <div className="flex flex-col gap-[10px] rounded-[12px] bg-critical/12 p-[14px]">
            <p className="text-[0.875rem] leading-[20px] text-white">
              {expired
                ? `Delete ${person.name}'s entry? This cannot be undone. The alerts their matches raised are kept.`
                : `Stop watching ${person.name}? Cameras stop matching straight away. The entry stays on the list, marked expired.`}
            </p>

            {/* Asked here rather than left to a note nobody writes. The entry
                survives this act and is read later by somebody who was not in
                the room, and "why did we stop" is the question they will
                have. */}
            {!expired && (
              <fieldset className="flex flex-col gap-[8px]">
                <legend className="pb-[6px] font-display text-[0.6875rem] tracking-[0.11px] text-muted">
                  WHY
                </legend>
                <div className="flex flex-wrap gap-[6px]">
                  {STOP_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={why === r}
                      onClick={() => setWhy(r)}
                      className={`h-[30px] rounded-[6px] px-[10px] text-[0.8125rem] transition-colors ${
                        why === r
                          ? "bg-white text-black"
                          : "bg-black/25 text-white hover:bg-black/40"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {why === "Other" && (
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    autoFocus
                    aria-label="Why watching is being stopped"
                    placeholder="Briefly, what changed"
                    className="h-[36px] rounded-[8px] bg-black/25 px-[12px] text-[0.8125rem] text-white outline-none placeholder:text-white/30 focus-visible:outline-1 focus-visible:outline-terra"
                  />
                )}
              </fieldset>
            )}
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                /* Closing after the stop is load-bearing. The panel is keyed to
                   the person, not to the action, so leaving it open re-armed it
                   as `Delete entry` the instant watching stopped — the second
                   press of a two-press guard landing on a different, worse
                   action than the one it was aimed at. */
                onClick={() => {
                  setConfirming(false);
                  if (expired) onDelete();
                  else onStopWatching(reason);
                }}
                disabled={!expired && !reason}
                className="h-[36px] rounded-[8px] bg-critical px-[14px] text-[0.8125rem] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {expired ? "Delete entry" : "Stop watching"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-[36px] rounded-[8px] bg-panel px-[14px] text-[0.8125rem] font-medium text-white transition-colors hover:bg-[#2a2a2e]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={() => onExtend(DEFAULT_DAYS)}
              className="h-[36px] rounded-[8px] bg-panel px-[14px] text-[0.8125rem] font-medium text-white transition-colors hover:bg-[#2a2a2e]"
            >
              {expired
                ? `Watch again for ${DEFAULT_DAYS} days`
                : `Extend by ${DEFAULT_DAYS} days`}
            </button>
            {/* Deleting is only reachable once watching has stopped. You cannot
                erase the record of somebody the fleet is still looking for; by
                the time it is expired the entry is a record, not an
                instruction. */}
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="h-[36px] rounded-[8px] px-[14px] text-[0.8125rem] font-medium text-critical transition-colors hover:bg-critical/12"
            >
              {expired ? "Delete entry" : "Stop watching"}
            </button>
          </div>
        )}

        <section className="flex flex-col gap-[10px]">
          <h2 className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            SIGHTINGS
          </h2>
          {sightings.length === 0 ? (
            <p className="text-[0.875rem] leading-[20px] text-muted">
              Never seen. Every camera in the fleet is watching for this face.
            </p>
          ) : (
            <ul className="flex flex-col gap-[8px]">
              {sightings.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-[12px] rounded-[8px] bg-card px-[14px] py-[12px]"
                >
                  {/* Detect amber. A person being seen is a detection, not a
                      fault — red belongs to faults and live transmission. */}
                  <span
                    aria-hidden
                    className="size-[8px] shrink-0 rounded-full bg-detect"
                  />
                  <span className="font-display text-[0.8125rem] tracking-[0.13px] text-white tabular-nums">
                    {formatEventTime(s.at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-sub">
                    {s.zone} · {s.towerId}
                  </span>
                  <span className="shrink-0 font-display text-[0.8125rem] tracking-[0.13px] text-detect tabular-nums">
                    {s.confidence}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </motion.div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <dt className="font-display text-[0.6875rem] tracking-[0.11px] text-muted">
        {label}
      </dt>
      <dd className={`text-[0.875rem] leading-[20px] ${tone ?? "text-white"}`}>
        {value}
      </dd>
    </div>
  );
}

/* ----------------------------------------------------------------- enrol */

export function Enrol({
  operator,
  presetPhoto,
  presetReason,
  onCancel,
  onSave,
}: {
  operator: string;
  /** A frame carried in from an alert. The face is already on screen there,
   *  which is the path this feature is actually used through. */
  presetPhoto?: string;
  presetReason?: string;
  onCancel: () => void;
  onSave: (person: Omit<Person, "id">) => void;
}) {
  const [photo, setPhoto] = useState<string | null>(presetPhoto ?? null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState(presetReason ?? "");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (presetPhoto) nameRef.current?.focus();
  }, [presetPhoto]);

  const pick = (file?: File) => {
    if (!file) return;
    setPhoto(URL.createObjectURL(file));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!photo || !name.trim() || !reason.trim()) return;
    onSave({
      name: name.trim().toUpperCase(),
      photo,
      reason: reason.trim(),
      addedBy: operator,
      addedAt: Date.now(),
      expiresAt: Date.now() + days * 86_400_000,
    });
  };

  const ready = Boolean(photo) && name.trim() && reason.trim();

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-[46px] shrink-0 items-center border-b border-line px-[16px]">
        <h1 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
          ADD A PERSON
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[24px]">
        {/* Said before the act, not after it. This screen puts a named person
            under fleet-wide automated matching on one operator's say-so, and
            the only other place that consequence appeared was the empty state
            somebody sees when there is nobody to watch. */}
        <p className="max-w-[520px] text-[0.875rem] leading-[20px] text-sub">
          Every camera in the fleet will match against this face and raise an
          alert.
        </p>
        <div className="w-full max-w-[520px]">
          {/* Photo first, and the constraints live inside the drop zone rather
              than in an error after the fact. */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files[0]);
            }}
            className="flex h-[168px] w-full items-center justify-center gap-[16px] rounded-[12px] border border-dashed border-stroke bg-card transition-colors hover:bg-card-hover"
          >
            {photo ? (
              <img
                src={photo}
                alt=""
                className="size-[136px] rounded-[8px] object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-[6px] text-center">
                <MaskIcon
                  src="/icons/nav-team.svg"
                  size={24}
                  className="text-muted"
                />
                <span className="text-[0.875rem] text-white">
                  Drop a photo, or click to choose one
                </span>
                <span className="text-[0.75rem] text-muted">
                  One face, front-on. JPG or PNG.
                </span>
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />

          {/* What makes a frame usable, before it is chosen rather than after
              it fails. This photo is the thing every future match is compared
              against, so a poor one does not announce itself — it just quietly
              lowers the odds on every camera in the fleet for as long as the
              entry lives. The identity tools that depend on a reference frame
              all state the conditions up front; none of them let you find out
              from the results. */}
          <ul className="mt-[10px] flex flex-col gap-[4px] text-[0.75rem] leading-[16px] text-muted">
            {PHOTO_RULES.map((rule) => (
              <li key={rule} className="flex items-start gap-[8px]">
                <span aria-hidden className="pt-[5px] text-white/30">
                  &bull;
                </span>
                {rule}
              </li>
            ))}
          </ul>
        </div>

        <label className="flex w-full max-w-[520px] flex-col gap-[8px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            NAME OR ALIAS
          </span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="M. OKONKWO"
            autoComplete="off"
            className="h-[48px] rounded-[8px] bg-card px-[14px] text-[1rem] text-white uppercase outline-none placeholder:text-white/25 focus-visible:outline-1 focus-visible:outline-terra"
          />
          <span className="text-[0.75rem] leading-[16px] text-muted">
            If nobody knows who this is, use the case's alias.
          </span>
        </label>

        <label className="flex w-full max-w-[520px] flex-col gap-[8px]">
          <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            REASON FOR WATCHING
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Trespass at Gas Yard, 4 Aug. Case OP-114."
            className="resize-none rounded-[8px] bg-card px-[14px] py-[12px] text-[0.875rem] leading-[20px] text-white outline-none placeholder:text-white/25 focus-visible:outline-1 focus-visible:outline-terra"
          />
          <span className="text-[0.75rem] leading-[16px] text-muted">
            Shown with every match, so the next operator can judge it.
          </span>
        </label>

        <fieldset className="flex w-full max-w-[520px] flex-col gap-[8px]">
          <legend className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
            STOP WATCHING AFTER
          </legend>
          <div className="flex gap-[8px]">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`h-[40px] flex-1 rounded-[8px] text-[0.875rem] font-medium transition-colors ${
                  days === d
                    ? "bg-white text-black"
                    : "bg-card text-white hover:bg-card-hover"
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
          <span className="text-[0.75rem] leading-[16px] text-muted">
            You can extend it later.
          </span>
        </fieldset>

        {/* Said at the point of the act, and this is the one screen in the app
            that needs it. Everywhere else the operator is looking at their own
            equipment; here they are putting a named person under automated
            facial matching across every camera on the fleet, and that person
            is not in the room and cannot agree to it. The consumer products
            that do face matching all carry a disclosure like this, but theirs
            is addressed to the person in the photo. Ours cannot be — so it is
            addressed to the operator, and says what they are taking on. */}
        <section
          aria-label="How this photo is used"
          className="flex w-full max-w-[520px] flex-col gap-[6px] rounded-[8px] border border-line bg-card px-[14px] py-[12px]"
        >
          <h2 className="font-display text-[0.6875rem] tracking-[0.11px] text-muted">
            HOW THIS PHOTO IS USED
          </h2>
          <p className="text-[0.75rem] leading-[16px] text-sub">
            The cameras compare this photo against every face they detect.
            Matching stops when the entry expires. The photo is kept with the
            entry until you delete it, and your name stays on it.
          </p>
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-[8px] border-t border-line px-[24px] py-[16px]">
        <button
          type="submit"
          disabled={!ready}
          className="h-[44px] rounded-[8px] bg-white px-[20px] text-[0.875rem] font-medium text-black transition-colors hover:bg-white/90 disabled:bg-white/25 disabled:text-black/40"
        >
          Start watching
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-[44px] rounded-[8px] bg-panel px-[20px] text-[0.875rem] font-medium text-white transition-colors hover:bg-[#2a2a2e]"
        >
          Cancel
        </button>
        {!ready && (
          <p className="text-[0.8125rem] text-muted">
            A photo, a name and a reason are required.
          </p>
        )}
      </footer>
    </motion.form>
  );
}
