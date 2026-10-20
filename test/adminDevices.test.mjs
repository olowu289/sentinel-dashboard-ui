/**
 * The Administration area's new rules, and the two the UI can break on its own.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT A SERVER TEST CANNOT COVER
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every permission here is enforced on the DC, and `test_device_rules.py`
 * proves it for seven personas. What is left is the half that is only ever
 * wrong on screen:
 *
 *   * a destructive action that does not say what it will do. "Remove" on a
 *     tower is the only deletion in this product that LEAVES DATA BEHIND, and
 *     the sentence about evidence has to be in front of the click rather than
 *     in the response nobody reads.
 *   * the pairing code, which must never be rendered back. The server omits it
 *     and the SDK drops it; a screen that echoed what was typed into a
 *     "pending" row would put a live secret in a screenshot.
 *   * the LOGIN, which belongs on screen exactly once — when somebody is added
 *     — and nowhere else. A list of credentials is a worse list than a list of
 *     names, and `name.organization` reconstructed by hand is how a person is
 *     given the wrong login on their first day.
 *   * `dele (was chi)`, which is the only way a reader connects a renamed
 *     person to a log entry written under their old name.
 *   * the drawer, which must not be a <form>: this app has never had one, and
 *     passwordHints.test.mjs is the rule. It caught the first version.
 *
 * These are asserted against the SHIPPED SOURCE, like navVisible's second half,
 * because each is a property of the code rather than of a value it computes.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** Comments blanked, so a note ABOUT a rule cannot satisfy or fail a scan. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "));
}

async function read(rel) {
  return readFile(join(SRC, rel), "utf8");
}

describe("the add drawer", () => {
  let source;
  let code;
  before(async () => {
    source = await read("components/AddDeviceDrawer.tsx");
    code = stripComments(source);
  });

  test("it is NOT a <form>, which is the app-wide rule it broke once", () => {
    /* Chrome's save-password prompt hangs off a form submission. This app has
       never had one, and the first version of this drawer did — caught by
       test/passwordHints.test.mjs, which is the authority. Asserted here too
       so the reason lives next to the component. */
    assert.doesNotMatch(code, /<form[\s/>]/);
    /* And Enter still works, because a drawer you can only submit with the
       mouse is worse than the prompt. */
    assert.match(code, /onKeyDown/);
    assert.match(code, /"Enter"/);
  });

  test("it never renders the pairing code back", () => {
    /* It is a live secret until it is consumed. The server omits it and the
       SDK drops it; the UI must not put the one the user typed into a
       "pending" row either, where it would survive in a screenshot. */
    const pendingUses = [...code.matchAll(/pending\.\w+/g)].map((m) => m[0]);
    assert.ok(pendingUses.length > 0, "the drawer stopped reading the pending row");
    assert.ok(
      !pendingUses.includes("pending.pairing_code"),
      `the drawer renders ${pendingUses.filter((u) => u.includes("pairing"))}`,
    );
  });

  test("it says the radio is not configured here", () => {
    /* ⚠ UNPROMPTED, and it has to be: without it somebody adds a tower, sees
       "waiting", and waits for a radio link nobody configured. */
    assert.match(source, /does not configure a radio/i);
  });

  test("the queued answer is its own state, not an error", () => {
    /* 202 means the cell is OFFLINE and nothing was sent. A drawer that drew
       that as a failure would have somebody re-enter a code that is still
       perfectly good; one that drew it as success would have them wait for a
       tower that was never asked for. */
    assert.match(code, /pending\.queued/);
    assert.match(code, /"queued"/);
    assert.match(source, /nothing to redo/i);
  });

  test("every failure path offers a way forward", () => {
    /* The product's rule: absence is diagnostic. Each of these is a sentence
       that says what to DO, not just what went wrong. */
    for (const code_ of ["cell_full", "hub_offline", "claim_conflict",
                         "cell_unknown", "site_unknown"]) {
      assert.match(source, new RegExp(`"${code_}"`),
        `${code_} has no message of its own`);
    }
  });
});

describe("destructive actions say what they will do", () => {
  let cells;
  before(async () => {
    cells = await read("components/SiteCells.tsx");
  });

  test("removing a tower says the recordings stay", () => {
    /* THE ONLY DELETION IN THIS PRODUCT THAT LEAVES DATA BEHIND. They may be
       evidence, and the sentence belongs in front of the click. */
    const confirm = cells.slice(cells.indexOf("Remove ${t.name}?"));
    assert.match(confirm, /recordings stay until normal retention/i);
    assert.match(confirm, /evidence/i);
    assert.match(confirm, /keys are revoked/i);
  });

  test("removing a cell says why a cell with towers is refused", () => {
    const confirm = cells.slice(cells.indexOf("Remove ${cell.name}?"));
    assert.match(confirm, /revokes its/i);
    /* MATCHED INSIDE ONE STRING LITERAL. The sentence is built by
       concatenation across three lines, so a regex spanning the join fails on
       source that reads perfectly well — which is what the first run did. */
    assert.match(confirm, /no key cannot be/i);
  });

  test("moving a cell warns about the shares BEFORE, and names them after", () => {
    /* A feed that simply stops is the thing this product does not do. */
    assert.match(cells, /Every active share involving this cell/i);
    assert.match(cells, /shares? ended because the cameras left the site/i);
  });

  test("renaming a tower treats an offline cell as NOT DONE", () => {
    /* It goes through the hub, which owns the label. `hub_offline` means it
       has not happened — not that it is pending. */
    assert.match(cells, /has NOT happened/);
  });

  test("a sector letter is never the only thing identifying a mast", () => {
    /* The device id is present and quiet on every tower row: it is what an
       engineer needs in a log and what nobody at a site says out loud. */
    assert.match(cells, /\{t\.device_id\}/);
    assert.match(cells, /\{t\.name\}/);
  });
});

describe("a login is shown once and a name everywhere else", () => {
  let admin;
  before(async () => {
    admin = await read("components/AdministrationView.tsx");
  });

  test("the people list draws the NAME, with the login quiet beside it", () => {
    assert.match(admin, /\{p\.name \?\? p\.login\}/);
  });

  test("a renamed person reads `dele (was chi)`", () => {
    /* The ledger holds account ids, so an old entry still resolves to this
       person. This is how a READER connects the two. */
    assert.match(admin, /\(was \{p\.was\}\)/);
  });

  test("the login is spelled out exactly once, when somebody is added", () => {
    assert.match(admin, /justAdded/);
    assert.match(admin, /can sign in now/);
    assert.match(admin, /the login never changes/i);
  });

  test("the add form asks for a NAME and says what the login will be", () => {
    assert.match(admin, /label="Name"/);
    assert.match(admin, /They will sign in as/);
    /* And it says why a dot is refused, where somebody is about to type one. */
    assert.match(admin, /No dots: the dot is what separates/);
  });

  test("only a PERSON gets a rename button", () => {
    /* An organization's own login is not somebody's name, and the slug behind
       it is in every person's login in the organization. */
    assert.match(admin, /\{p\.name \? \(/);
    assert.match(admin, /Fix a typo/);
  });

  test("the rename box says the login changes", () => {
    assert.match(admin, /This changes their login to/);
  });
});

describe("the fleet feed", () => {
  let feed;
  let code;
  before(async () => {
    feed = await read("lib/useFleetFeed.tsx");
    code = stripComments(feed);
  });

  test("the first poll raises nothing", () => {
    /* Signing in after a week of changes must not throw nine cards over the
       video. They are in the audit log, where somebody went looking. */
    assert.match(code, /seen\.current < 0/);
  });

  test("an admin is never told about their own action", () => {
    /* The same rule the sharing work arrived at the hard way. The ledger
       records the actor. */
    assert.match(code, /e\.account_id !== meAccountId/);
  });

  test("taking something away is a different colour from adding", () => {
    /* One is "there is more than there was", which can wait. One is "somebody
       has lost access", which is the sentence an admin re-reads. */
    assert.match(code, /"device\.removed": "revoked"/);
    assert.match(code, /"person\.disable": "revoked"/);
    assert.match(code, /"device\.added": "fleet"/);
  });

  test("the cards are transient, not persistent", () => {
    /* They report; they do not ask. A persistent card would pile up while a
       site installs eight towers in an afternoon. */
    assert.match(code, /ttlMs/);
    assert.doesNotMatch(code, /persistent:\s*true/);
  });
});

describe("the new notification kinds are declared properly", () => {
  test("each kind has all four token classes", async () => {
    const source = await readFile(join(SRC, "lib", "notifications.tsx"), "utf8");
    for (const kind of ["fleet", "revoked"]) {
      const block = source.slice(source.indexOf(`  ${kind}: {`));
      for (const slot of ["accent", "wash", "line", "solid"]) {
        assert.match(block.slice(0, 400), new RegExp(`${slot}:`),
          `${kind} has no ${slot}`);
      }
    }
  });

  test("every token they name exists in BOTH themes", async () => {
    /* A token defined only in the dark block is a card that disappears on a
       light screen, which is the one place nobody tests by eye. */
    const css = await readFile(join(SRC, "index.css"), "utf8");
    const light = css.slice(css.indexOf('[data-theme="light"]') >= 0
      ? css.indexOf('[data-theme="light"]')
      : css.length);
    for (const token of [
      "--color-notify-fleet", "--color-notify-fleet-wash",
      "--color-notify-fleet-line", "--color-notify-fleet-ink",
      "--color-notify-revoked", "--color-notify-revoked-wash",
      "--color-notify-revoked-line", "--color-notify-revoked-ink",
    ]) {
      const uses = css.split(token + ":").length - 1;
      assert.ok(uses >= 2, `${token} is defined ${uses} time(s); needs dark and light`);
    }
  });

  test("neither kind borrows terra or the alarm red", async () => {
    /* ⚠ GREEN MEANS LIVE AND NOTHING ELSE, and the alarm red is held for
       detections. A card that borrowed either would put "live" or "somebody is
       in the yard" on a statement about a mast being renamed. */
    const source = await readFile(join(SRC, "lib", "notifications.tsx"), "utf8");
    const block = source.slice(source.indexOf("  fleet: {"));
    assert.doesNotMatch(block, /terra/);
    assert.doesNotMatch(block, /alert-banner/);
    assert.doesNotMatch(block, /critical/);
  });
});

describe("no screen hands the Administration area a hardcoded permission", () => {
  test("nothing decides admin-ness for itself", async () => {
    /* Same rule as IconRail's: the server decides, and 403 is the boundary.
       A component that computed its own answer is a second source of truth. */
    const dir = join(SRC, "components");
    const offenders = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".tsx")) continue;
      if (name === "IconRail.tsx" || name === "AdministrationView.tsx") continue;
      const text = stripComments(await readFile(join(dir, name), "utf8"));
      if (/role\s*===\s*"admin"/.test(text) && !/isAdminRole/.test(text)) {
        offenders.push(name);
      }
    }
    assert.deepEqual(offenders, [],
      "these compare a role to \"admin\" by hand; use isAdminRole");
  });
});
