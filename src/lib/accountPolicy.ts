/**
 * The password and organization-name rules, client-side.
 *
 * ⚠ THIS IS A MIRROR, NOT THE AUTHORITY. Coordination's
 * `registry/accounts.validate_new_password` and `_validate_login` decide. These
 * functions exist so the person finds out their new password is too short while
 * they are still typing it, instead of after a round trip that also threw away
 * the rest of the form.
 *
 * Because it is a mirror it can only ever be WEAKER, never stronger: every rule
 * here is also enforced on the server, so a client that was bypassed, stale, or
 * simply wrong changes nothing about what gets stored. The forms submit anyway
 * if the server disagrees — the server's message wins and is displayed verbatim.
 *
 * ── THE NUMBERS, AND WHERE THEY COME FROM ──────────────────────────────
 *
 *   PASSWORD_MIN_LEN  12   accounts.PASSWORD_MIN_LEN
 *   PASSWORD_MAX_LEN  1024 accounts.PASSWORD_MAX_LEN (an allocation bound)
 *   LOGIN_MAX_LEN     100  accounts._LOGIN_MAX
 *
 * They are duplicated constants in two languages and there is no shared schema
 * to derive them from, so they can drift. The mitigation is that drift is
 * HARMLESS in one direction and VISIBLE in the other: if the server tightens,
 * the client lets something through and the server refuses it with a clear
 * message; if the server loosens, the client is merely fussier than it needs to
 * be. Neither stores anything the server did not approve.
 *
 * ── NO CHARACTER-CLASS RULES ───────────────────────────────────────────
 *
 * Deliberately. "One upper, one digit, one symbol" pushes people towards
 * `Password1!` and away from length, which is the only property that costs an
 * attacker anything — NIST SP 800-63B advises against composition rules for
 * exactly this reason. The server does not enforce them either, and a client
 * that invented its own would be refusing passwords the system accepts.
 */

/** `accounts.PASSWORD_MIN_LEN`. */
export const PASSWORD_MIN_LEN = 12;

/** `accounts.PASSWORD_MAX_LEN` — a bound on an allocation, not an opinion. */
export const PASSWORD_MAX_LEN = 1024;

/** `accounts._LOGIN_MAX`. */
export const LOGIN_MAX_LEN = 100;

/**
 * What is wrong with this new password, or `null` when nothing is.
 *
 * `current` is compared when supplied, because a "change" that changes nothing
 * is the one failure worth catching before the round trip: the server refuses
 * it too, but only after the person has been told their password was rotated
 * and every other session signed out — neither of which happened.
 */
export function checkNewPassword(
  value: string,
  current?: string,
): string | null {
  if (value.length === 0) return null; // not yet an error; the button is disabled
  if (value.length < PASSWORD_MIN_LEN) {
    return `Use at least ${PASSWORD_MIN_LEN} characters.`;
  }
  if (value.length > PASSWORD_MAX_LEN) {
    return `Use at most ${PASSWORD_MAX_LEN} characters.`;
  }
  /* Twelve spaces satisfies a length check and is not a password. Note what is
     NOT done here: the value is never trimmed. A password with a trailing space
     is a password with a trailing space, and coordination stores it that way. */
  if (value.trim().length === 0) {
    return "A password cannot be only spaces.";
  }
  if (current !== undefined && current.length > 0 && value === current) {
    return "This is the password you are already using.";
  }
  return null;
}

/**
 * What is wrong with this organization name, or `null` when nothing is.
 *
 * ⚠ NOTHING IS TRIMMED, HERE OR ANYWHERE ON THIS PATH.
 * `accounts._normalise_login` is the identity function by deliberate decision:
 * the name is matched byte for byte, so `"Terra"` and `" Terra"` are two
 * different organizations. A client that trimmed would store a name other than
 * the one typed, and the person would then type what they see and be refused.
 *
 * Leading and trailing spaces are therefore ALLOWED and only WARNED about, by
 * the caller — they are legal, and they are also almost always a mistake, which
 * is a different thing from invalid.
 */
export function checkNewLogin(value: string): string | null {
  if (value.length === 0) return null; // not yet an error; the button is disabled
  if (value.trim().length === 0) {
    return "Enter your organization's name.";
  }
  if (value.length > LOGIN_MAX_LEN) {
    return `Use at most ${LOGIN_MAX_LEN} characters.`;
  }
  /* Control characters: ord < 32 or 127. The server rejects these, and its
     reason is the one worth repeating — an invisible character cannot be seen
     to retype, and this name is matched exactly. A pasted name with a stray
     newline is the realistic way one arrives. */
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      return "Remove the invisible characters (a line break, or a tab).";
    }
  }
  return null;
}

/**
 * True when this name would be stored with a leading or trailing space.
 *
 * Not an error. The caller shows it as a caution, because the name IS matched
 * exactly and `" Terra"` really will be a different sign-in name from `"Terra"`
 * — so somebody who pasted a name with a trailing space needs to know that
 * before they commit to typing it that way every morning.
 */
export function hasEdgeSpace(value: string): boolean {
  return value.length > 0 && value !== value.trim();
}
