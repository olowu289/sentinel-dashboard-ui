import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import { ENTER, FADE } from "@/lib/motion";
import { isExpired } from "@/lib/data";
import { formatClockShort, formatEventTime } from "@/lib/time";
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

export function PeopleView({
  people,
  alerts,
  operator,
  enrolFrom,
  onNavigate,
  onBack,
  onEnrol,
  onExtend,
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
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    people[0]?.id ?? null,
  );
  const [enrolling, setEnrolling] = useState(Boolean(enrolFrom));

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

      <aside
        aria-label="People of interest"
        className="flex w-full min-w-0 flex-col bg-ink lg:w-[417px] lg:shrink-0 lg:border-r lg:border-line-panel"
      >
        <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line pl-[16px] pr-[14px]">
          {/* A breadcrumb, like every other way up in this app. A bare word in
              the corner is a second navigation grammar for one product. */}
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
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[15px] pb-[20px] pt-[12px]">
          <button
            type="button"
            onClick={() => setEnrolling(true)}
            className="flex h-[44px] shrink-0 items-center justify-center gap-[8px] rounded-[12px] border border-dashed border-stroke text-[0.875rem] text-white transition-colors hover:bg-card"
          >
            <span aria-hidden className="text-[1.125rem] leading-none">
              +
            </span>
            Add a person
          </button>

          {active.map((person) => (
            <RosterCard
              key={person.id}
              person={person}
              sightings={sightingsFor(person.id).length}
              lastSeen={sightingsFor(person.id)[0]?.at}
              selected={person.id === selectedId}
              onSelect={() => {
                setSelectedId(person.id);
                setEnrolling(false);
              }}
            />
          ))}

          {/* Expired entries stay readable. A watchlist that quietly forgets
              who was on it, and why, is a watchlist nobody can audit. */}
          {expired.length > 0 && (
            <>
              <p className="mt-[8px] font-display text-[0.75rem] tracking-[0.12px] text-muted">
                EXPIRED · NO LONGER MATCHING
              </p>
              {expired.map((person) => (
                <RosterCard
                  key={person.id}
                  person={person}
                  sightings={sightingsFor(person.id).length}
                  lastSeen={sightingsFor(person.id)[0]?.at}
                  selected={person.id === selectedId}
                  expired
                  onSelect={() => {
                    setSelectedId(person.id);
                    setEnrolling(false);
                  }}
                />
              ))}
            </>
          )}
        </div>
      </aside>

      <main className="hidden min-w-0 flex-1 flex-col lg:flex">
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
            person={selected}
            sightings={sightingsFor(selected.id)}
            onExtend={(days) => onExtend(selected.id, days)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-[24px] text-center">
            <p className="max-w-[360px] text-[0.875rem] leading-[20px] text-muted">
              Nobody is on the list yet. Add a person and the fleet raises an
              alert when a camera sees a possible match.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- roster */

function RosterCard({
  person,
  sightings,
  lastSeen,
  selected,
  expired = false,
  onSelect,
}: {
  person: Person;
  sightings: number;
  lastSeen?: number;
  selected: boolean;
  expired?: boolean;
  onSelect: () => void;
}) {
  const daysLeft = Math.ceil((person.expiresAt - Date.now()) / 86_400_000);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full shrink-0 items-center gap-[12px] rounded-[12px] p-[12px] text-left transition-colors ${
        selected ? "bg-card-hover" : "bg-card hover:bg-card-hover"
      } ${expired ? "opacity-55" : ""}`}
    >
      <img
        src={person.photo}
        alt=""
        width={48}
        height={48}
        className="block size-[48px] shrink-0 rounded-[8px] object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-white">
          {person.name}
        </span>
        {/* Absence is diagnostic: never seen is a reading, not a zero. */}
        <span className="truncate text-[0.75rem] leading-[15px] tracking-[0.12px] text-sub">
          {sightings === 0
            ? "Never seen"
            : `${sightings} sighting${sightings === 1 ? "" : "s"} · last ${formatClockShort(lastSeen!)}`}
        </span>
      </span>
      {!expired && daysLeft <= 7 && (
        <span className="shrink-0 font-display text-[0.6875rem] tracking-[0.11px] text-warn">
          {daysLeft} DAY{daysLeft === 1 ? "" : "S"} LEFT
        </span>
      )}
    </button>
  );
}

/* ---------------------------------------------------------------- detail */

function PersonDetail({
  person,
  sightings,
  onExtend,
}: {
  person: Person;
  sightings: Alert[];
  onExtend: (days: number) => void;
}) {
  const expired = isExpired(person);

  return (
    <motion.div
      key={person.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-[46px] shrink-0 items-center border-b border-line px-[16px]">
        <h1 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
          {person.name}
        </h1>
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
          </dl>
        </div>

        {/* Extending is the deliberate act. Nothing renews on its own, which is
            the whole point of having an expiry at all. */}
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
        </div>

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
