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

  test("every failure path offers a way forward", async () => {
    /* The product's rule: absence is diagnostic. Each of these is a sentence
       that says what to DO, not just what went wrong.

       ⚠ AND THEY MOVED, DELIBERATELY. The drawer used to hold its own
       `switch` over these codes, Settings held a chain of `instanceof`, every
       loader held a fallback, and none of them knew about the others -- so one
       failure had four wordings and one of those was wrong on the screen it
       appeared on. `lib/said.ts` is the one table now, so the codes are looked
       for in whichever of the two files is entitled to hold them. */
    const central = await read("lib/said.ts");
    const both = [source, stripComments(central)].join(" ");
    for (const code_ of ["cell_full", "hub_offline", "claim_conflict",
                         "cell_unknown", "site_unknown"]) {
      assert.match(both, new RegExp(`\\b${code_}\\b`),
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
  let code;
  before(async () => {
    admin = await read("components/AdministrationView.tsx");
    code = stripComments(admin);
  });

  test("the people list draws the NAME, with the login quiet beside it", () => {
    /* `personLabel` is the one place that decides: the person's name, and the
       login only for an organization's own account, which has no name. */
    assert.match(code, /function personLabel/);
    assert.match(code, /return p\.name \?\? p\.login/);
    assert.match(code, /<CopyableLogin login=\{person\.login\}/);
  });

  test("a renamed person reads `dele (was chi)`", () => {
    /* The ledger holds account ids, so an old entry still resolves to this
       person. This is how a READER connects the two. */
    assert.match(code, /\(was \{person\.was\}\)/);
  });

  test("the login is spelled out exactly once, when somebody is added", () => {
    assert.match(code, /justAdded/);
    assert.match(admin, /can sign in now/);
    assert.match(admin, /the login never changes/i);
  });

  test("the add form asks for a NAME and says what the login will be", () => {
    assert.match(admin, /label="Name"/);
    assert.match(admin, /They will sign in as/);
    /* And it says why a dot is refused, where somebody is about to type one. */
    assert.match(admin, /No dots: the dot is what separates/);
  });

  test("THE STATUS IS SHOWN, which is the bug this round fixed", () => {
    /* owner1 and guest1 are DISABLED on the production DC and this page
       offered them both a "Disable" button and no badge, because it never read
       `status`. The one fact that explains why somebody cannot sign in was the
       one fact missing. */
    assert.match(code, /person\.status !== "active"/);
    assert.match(code, /<StatusPill status=\{disabled \? "disabled" : "active"\}/);
    /* And a disabled row is visibly muted rather than looking ordinary. */
    assert.match(code, /line-through/);
  });

  test("a disabled person is offered Enable, not Disable", () => {
    assert.match(code, /disabled\s*\n?\s*\?\s*\{\s*\n?\s*label: "Enable"/);
    assert.match(code, /label: "Disable"/);
  });

  test("every action is in one menu, not a row of buttons", () => {
    assert.match(code, /<OverflowMenu/);
    assert.match(code, /label=\{`Actions for \$\{personLabel\(person\)\}`\}/);
    for (const item of [
      "Edit sites",
      "Reset password",
      "Fix a typo in the name",
      "Remove",
    ]) {
      assert.match(code, new RegExp(`label: "${item}"`));
    }
  });

  test("nothing it cannot do is offered, and each refusal says why", () => {
    /* `may_manage_person` refuses the caller's own id -- which is what stops
       an administrator removing the only administrator -- and the server
       refuses the organization's own login outright. A menu item that cannot
       work is a 404 waiting for somebody to press it, so both are disabled
       with the reason as the title. */
    assert.match(code, /disabled: isMe \|\| isOrganization/);
    assert.match(admin, /Ask another administrator to remove you\./);
    assert.match(admin, /Nobody renames themselves/);
  });

  test("removing somebody names them, and says what it does", () => {
    assert.match(admin, /Remove \$\{personLabel\(confirm\.person\)\}\?/);
    assert.match(admin, /taken out of every site/);
    assert.match(admin, /audit log keeps their name/);
  });

  test("site membership is a searchable multi-select, not a row of chips", () => {
    assert.match(code, /<MultiSelect/);
    assert.match(code, /Which sites they can see/);
  });

  test("the rename panel says the login changes", () => {
    assert.match(admin, /Their LOGIN changes with the name/);
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
  test("each kind is ONE strip colour", async () => {
    /* ⚠ IT USED TO BE FOUR TOKENS -- accent, wash, line, solid -- and that is
       what made a card a coloured panel with a coloured heading and a coloured
       button. The card is the app's card now and the kind is a 2px strip
       along its top. `sharing.test.mjs` holds the whole rule; this checks the
       two kinds this screen raises. */
    const source = await readFile(join(SRC, "lib", "notifications.tsx"), "utf8");
    for (const kind of ["fleet", "revoked"]) {
      const at = source.indexOf(`  ${kind}: {`);
      assert.ok(at > 0, `${kind} is not declared`);
      const line = source.slice(at, source.indexOf("\n", at));
      assert.match(line, /strip: "bg-notify-/, `${kind} has no strip`);
      for (const gone of ["accent", "wash", "line:", "solid"]) {
        assert.doesNotMatch(line, new RegExp(gone), `${kind} still carries ${gone}`);
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
    /* Their own lines only. The table below them now declares an `alert` kind
       whose strip IS the alarm red, which is correct for an alert and would
       otherwise be read as these two borrowing it. */
    for (const kind of ["fleet", "revoked"]) {
      const at = source.indexOf(`  ${kind}: {`);
      const line = source.slice(at, source.indexOf("\n", at));
      assert.doesNotMatch(line, /terra/, kind);
      assert.doesNotMatch(line, /alert-banner/, kind);
      assert.doesNotMatch(line, /critical/, kind);
    }
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
