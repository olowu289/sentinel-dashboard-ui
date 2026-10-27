/**
 * The rules behind the cards: what goes on the wire, and what a tile says.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THESE FOUR AND NOT A RENDER TEST
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every one of these is a sentence somebody could get backwards, and every one
 * of them is wrong in a way that looks fine on screen:
 *
 *   · A REQUEST THAT SENDS A SCOPE is refused by the server with a message
 *     about cameras the asking site has never seen. The form cannot name them
 *     because it cannot see them; if a refactor ever makes it send `scope: []`
 *     for an offer instead, an offer silently becomes an empty one.
 *   · A PLAYBACK WINDOW WITHOUT PLAYBACK is a claim about footage nobody
 *     granted, and playback WITHOUT a window is refused outright. The pairing
 *     is the rule.
 *   · A SCOPE ENTRY WITH NO CAMERAS covers the whole mast. Read the other way,
 *     lending a tower lends nothing, and the share looks ignored.
 *   · BADGING MY OWN CAMERA AS BORROWED is the one that is actively
 *     misleading: it would tell an operator that the mast they own belongs to
 *     somebody else, which changes what they do with what they see.
 *
 * None of that is visible in a screenshot, and all of it is one line of logic.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let r;
let n;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sharing-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as rules from "@/lib/shareRules";
     export * as notes from "@/lib/notifications";`,
    "utf8",
  );
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": join(ROOT, "src") },
    define: {
      "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }),
    },
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(out).href);
  r = mod.rules;
  n = mod.notes;
});

const SHARE = (over = {}) => ({
  share_id: "shr_1",
  direction: "request",
  status: "active",
  owner_site_id: "site_north",
  owner_site_name: "North Gate",
  viewer_site_id: "site_west",
  viewer_site_name: "West Yard",
  scope: [{ device_id: "kln_north_1", cameras: [1] }],
  live: true,
  ptz: false,
  playback: false,
  playback_from: null,
  playback_to: null,
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-10-20T10:00:00Z",
  decided_at: null,
  message: null,
  incoming: false,
  outgoing: true,
  ...over,
});

describe("what goes on the wire", () => {
  const compose = (over = {}) => ({
    otherSiteId: "site_north",
    message: "  Our truck is at your gate.  ",
    scope: [{ device_id: "kln_mine_1" }],
    ptz: true,
    playback: true,
    from: "2026-10-20T09:00",
    to: "2026-10-20T10:00",
    durationSec: 900,
    ...over,
  });

  test("a REQUEST names no cameras and asserts no permissions", () => {
    const body = r.composeToRequest(compose(), "site_west", "request");
    assert.equal("scope" in body, false, "the asking site cannot name cameras");
    // ⚠ ABSENT, NOT `false`. It used to send `ptz: false, playback: false`,
    // which is a request asserting something about what it will be granted --
    // and what it is granted is the answering site's decision. The two
    // directions are different shapes now and the SDK type says so.
    assert.equal("ptz" in body, false, "it asserts no permissions at all");
    assert.equal("playback" in body, false);
    assert.equal("playbackFrom" in body, false);
    assert.equal(body.message, "Our truck is at your gate.", "trimmed");
    assert.equal(body.direction, "request");
    assert.equal(body.durationSec, 900, "but it does say how long it wants");
  });

  test("a REQUEST always says how long, because the server requires one", () => {
    // It used to be optional on the wire, and the two tiers disagreed about
    // the fallback: fifteen minutes in the SDK, two hours on the server. What
    // a share lasted depended on which side had forgotten to send it.
    const body = r.composeToRequest(compose(), "site_west", "request");
    assert.equal(typeof body.durationSec, "number");
  });

  test("an offer accepts as sent, so accepting one carries nothing", () => {
    assert.deepEqual(r.acceptOffer(), {});
  });

  test("only a request leaves the person answering anything to decide", () => {
    assert.equal(r.answeringMeansChoosing({ direction: "request" }), true);
    assert.equal(r.answeringMeansChoosing({ direction: "offer" }), false);
  });

  describe("nothing is sent without a length", () => {
    const ready = (over, site, dir) =>
      r.composeIsReady(compose(over), site, dir);

    test("a request needs a site, a message and a length", () => {
      assert.equal(ready({}, "site_west", "request"), true);
      assert.equal(ready({ durationSec: 0 }, "site_west", "request"), false,
        "zero means nothing chosen, and that is the state the form opens in");
      assert.equal(ready({ message: "   " }, "site_west", "request"), false);
      assert.equal(ready({ otherSiteId: "" }, "site_west", "request"), false);
      assert.equal(ready({}, "", "request"), false);
    });

    test("an offer needs a site, cameras and a length, but no message", () => {
      assert.equal(ready({ message: "" }, "site_north", "offer"), true);
      assert.equal(ready({ scope: [] }, "site_north", "offer"), false);
      assert.equal(ready({ durationSec: 0 }, "site_north", "offer"), false);
    });
  });

  describe("answering a request opens on what was asked for", () => {
    const share = (over = {}) => ({
      direction: "request",
      scope: [],
      ptz: false,
      playback: false,
      asked_duration_sec: 4 * 3600,
      ...over,
    });

    test("the picker starts at the asked length, not at a default", () => {
      // It started at SHARE_DEFAULT_SEC, so the owner's untouched answer
      // silently replaced a four-hour question with fifteen minutes.
      assert.equal(r.initialDecision(share()).durationSec, 4 * 3600);
    });

    test("and falls back to the default when the server recorded none", () => {
      const d = r.initialDecision(share({ asked_duration_sec: null }));
      assert.equal(typeof d.durationSec, "number");
      assert.ok(d.durationSec > 0, "never zero: there is always something to answer with");
    });
  });

  test("an OFFER names its cameras and carries what it grants", () => {
    const body = r.composeToRequest(compose(), "site_north", "offer");
    assert.deepEqual(body.scope, [{ device_id: "kln_mine_1" }]);
    assert.equal(body.ptz, true);
    assert.equal(body.playback, true);
    assert.equal(typeof body.playbackFrom, "string", "a window travels with it");
    assert.equal(typeof body.playbackTo, "string");
  });

  test("an empty message is left out rather than sent as empty", () => {
    const body = r.composeToRequest(compose({ message: "   " }), "s", "offer");
    assert.equal("message" in body, false);
  });

  test("the playback window travels ONLY when playback is on", () => {
    const on = r.decisionToChoices({
      scope: [], ptz: false, playback: true,
      from: "2026-10-20T09:00", to: "2026-10-20T10:00", durationSec: 900,
    });
    assert.equal(typeof on.playbackFrom, "string");
    assert.equal(typeof on.playbackTo, "string");

    const off = r.decisionToChoices({
      scope: [], ptz: false, playback: false,
      from: "2026-10-20T09:00", to: "2026-10-20T10:00", durationSec: 900,
    });
    assert.equal("playbackFrom" in off, false, "a window with no grant is a claim");
    assert.equal(off.live, true, "live is what a share is for");
  });

  test("an offer's answer starts from what was offered, not from nothing", () => {
    /* The site accepting may NARROW an offer. Starting the form empty would
       make narrowing look like the only option and lose the offer's own
       choices on the way through. */
    const d = r.initialDecision(SHARE({ scope: [{ device_id: "a" }], ptz: true }));
    assert.deepEqual(d.scope, [{ device_id: "a" }]);
    assert.equal(d.ptz, true);
    assert.equal(d.durationSec, 900, "fifteen minutes is the default length");
  });
});

describe("narrowing a tower to some of its cameras", () => {
  // ⚠ "ALL CAMERAS" IS AN EMPTY LIST, and every chip is drawn pressed to
  // say so. Clicking a pressed chip has to take that camera AWAY. It used to
  // start from an empty list and ADD it, so clicking "Cam 2" on a mast
  // showing "all cameras" shared camera 2 alone: the opposite of what was
  // pressed. A browser test narrowing to camera 1 got camera 2.
  //
  // The rule lives in `TowerPicker`, so this exercises the same arithmetic
  // rather than the component: given what is chosen and what the mast has,
  // what does clicking one chip leave?
  const after = (chosenCameras, clicked, every) => {
    const list =
      chosenCameras && chosenCameras.length > 0 ? [...chosenCameras] : [...every];
    const at = list.indexOf(clicked);
    if (at >= 0) list.splice(at, 1);
    else list.push(clicked);
    return list.sort((a, b) => a - b);
  };

  test("clicking one chip on a whole mast leaves the others", () => {
    assert.deepEqual(after(undefined, 2, [1, 2]), [1]);
    assert.deepEqual(after([], 1, [1, 2, 3]), [2, 3]);
  });

  test("clicking a chosen one removes it", () => {
    assert.deepEqual(after([1, 2], 2, [1, 2]), [1]);
  });

  test("and clicking an unchosen one adds it back", () => {
    assert.deepEqual(after([1], 2, [1, 2]), [1, 2]);
  });

  test("emptying the list is 'no cameras', which the caller turns into the mast", () => {
    // TowerPicker writes `{device_id}` with no list when this comes back
    // empty, which is "the whole mast" and what the chips then show.
    assert.deepEqual(after([2], 2, [1, 2]), []);
  });
});

describe("an administrator's share", () => {
  // ⚠ IT WAS NOT SENT BY EITHER SITE. "You offered yours" and "is offering
  // theirs" are both false of it: the owning site offered nothing and the
  // viewing site was not offered anything BY THEM.
  const adminShare = (over = {}) =>
    ({ by_admin: true, direction: "offer", status: "pending", ...over });

  test("neither site is said to have sent it", () => {
    assert.equal(r.otherSiteRole(adminShare({ incoming: true })),
      "being shared with them");
    assert.equal(r.otherSiteRole(adminShare({ incoming: false })),
      "being shared with you");
  });

  test("and once it is live it says so without crediting a site", () => {
    assert.equal(r.otherSiteRole(adminShare({ incoming: true, status: "active" })),
      "shared with them");
    assert.equal(r.otherSiteRole(adminShare({ incoming: false, status: "active" })),
      "shared with you");
  });

  test("the OWNING site gets a notice, and nobody else does", () => {
    // `incoming` is true when one of MY sites owns the cameras, which for an
    // admin share is the site being TOLD.
    assert.equal(r.isAdminNotice(adminShare({ incoming: true })), true);
    assert.equal(r.isAdminNotice(adminShare({ incoming: false })), false,
      "the viewing site gets a card it can answer, not a notice");
  });

  test("and a site-to-site share is never a notice", () => {
    for (const direction of ["request", "offer"]) {
      for (const incoming of [true, false]) {
        assert.equal(
          r.isAdminNotice({ direction, incoming, status: "pending" }),
          false,
        );
      }
    }
  });

  test("a site-to-site share still reads the way it did", () => {
    assert.equal(r.otherSiteRole({ direction: "offer", incoming: false,
      status: "pending" }), "is offering theirs");
    assert.equal(r.otherSiteRole({ direction: "request", incoming: true,
      status: "pending" }), "is asking for yours");
  });
});

describe("what a scope covers", () => {
  test("no camera list means the whole mast, now and later", () => {
    const whole = { device_id: "kln_1" };
    assert.equal(r.scopeCovers(whole, "kln_1", 1), true);
    assert.equal(r.scopeCovers(whole, "kln_1", 9), true, "including one added later");
    assert.equal(r.scopeCovers(whole, "kln_1", undefined), true);
    assert.equal(r.scopeCovers(whole, "kln_2", 1), false, "but not another mast");
  });

  test("a camera list is exactly those cameras", () => {
    const one = { device_id: "kln_1", cameras: [2] };
    assert.equal(r.scopeCovers(one, "kln_1", 2), true);
    assert.equal(r.scopeCovers(one, "kln_1", 1), false);
    assert.equal(r.scopeCovers(one, "kln_1", undefined), false);
  });

  test("the summary counts cameras and towers, and says when there are none", () => {
    assert.equal(r.scopeSummary([]), "no cameras yet");
    assert.equal(r.scopeSummary([{ device_id: "a" }]), "1 camera on 1 tower");
    assert.equal(
      r.scopeSummary([{ device_id: "a", cameras: [1, 2] }, { device_id: "b" }]),
      "3 cameras on 2 towers",
    );
  });
});

describe("whose camera is this", () => {
  test("a share coming TO me marks the tile", () => {
    const lent = SHARE({ incoming: false, scope: [{ device_id: "kln_1" }] });
    assert.equal(r.borrowedFrom([lent], "kln_1", 1)?.share_id, "shr_1");
  });

  test("MY OWN camera is never borrowed, however many sites watch it", () => {
    /* `incoming: true` means one of my sites owns these cameras and somebody
       else is watching. Badging that as borrowed would tell an operator the
       mast they own is somebody else's. */
    const lentOut = SHARE({ incoming: true, scope: [{ device_id: "kln_1" }] });
    assert.equal(r.borrowedFrom([lentOut], "kln_1", 1), null);
  });

  test("a camera outside the scope is not borrowed", () => {
    const lent = SHARE({ incoming: false, scope: [{ device_id: "kln_1", cameras: [1] }] });
    assert.equal(r.borrowedFrom([lent], "kln_1", 2), null);
    assert.equal(r.borrowedFrom([lent], "kln_2", 1), null);
    assert.equal(r.borrowedFrom([lent], undefined, 1), null);
  });

  test("the other site is named from whichever end I am on", () => {
    assert.equal(r.otherSiteName(SHARE({ incoming: true })), "West Yard");
    assert.equal(r.otherSiteName(SHARE({ incoming: false })), "North Gate");
  });
});

describe("what the other site IS to me", () => {
  // ⚠ THE TWO OFFER LINES WERE SWAPPED. A site RECEIVING an offer read
  // "you offered yours" and the site that SENT it read "is offering theirs",
  // because the row keyed on `incoming` -- which means one of my sites owns
  // the cameras, and that is a different question from who started it. The
  // party who owns the cameras RECEIVES a request and SENDS an offer.
  const row = (direction, incoming, status = "pending") =>
    r.otherSiteRole({ direction, incoming, status });

  test("a request: they asked me, or I asked them", () => {
    assert.equal(row("request", true), "is asking for yours");
    assert.equal(row("request", false), "you asked them");
  });

  test("an offer: I offered them, or they offered me", () => {
    assert.equal(row("offer", true), "you offered yours");
    assert.equal(row("offer", false), "is offering theirs");
  });

  test("and once it is live only the direction of the cameras matters", () => {
    for (const d of ["request", "offer"]) {
      assert.equal(row(d, true, "active"), "has yours");
      assert.equal(row(d, false, "active"), "lending to you");
    }
  });

  test("no two of the four pending lines are the same", () => {
    const said = [
      row("request", true), row("request", false),
      row("offer", true), row("offer", false),
    ];
    assert.equal(new Set(said).size, 4, said.join(" | "));
  });
});

describe("the labels on a card", () => {
  test("time left counts down and goes NULL rather than to zero", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    const at = (mins) =>
      n.timeLeftLabel(new Date(now + mins * 60_000).toISOString(), now);
    assert.equal(at(14.5), "14:30");
    assert.equal(at(90), "1:30");
    /* Past a day it stops being a clock: "167:59" is a number nobody can read
       at a glance, and the glance is the whole purpose of the label. */
    assert.equal(at(60 * 24 * 7), "7d");
    assert.equal(at(60 * 30), "1d 6h");
    /* A share at zero is not a share with no time left on it. It is over, and
       the card says so in words rather than showing 0:00 beside live video. */
    assert.equal(at(0), null);
    assert.equal(at(-5), null);
    assert.equal(n.timeLeftLabel("not a date"), null);
  });

  test("the age stamp says `now` before it says a number", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    const ago = (s) => n.sinceLabel(now - s * 1000, now);
    assert.equal(ago(0), "now");
    assert.equal(ago(44), "now", "a minute that has not happened is not 1m");
    assert.equal(ago(120), "2m");
    assert.equal(ago(3 * 3600), "3h");
    assert.equal(ago(50 * 3600), "2d");
  });
});

describe("the notification kinds", () => {
  /* ══════════════════════════════════════════════════════════════════════
   *  ONE COLOURED PIXEL PER CARD, AND IT IS THE STRIP
   * ══════════════════════════════════════════════════════════════════════
   *
   * A share request arrived over the video wall as a blue-bordered card on a
   * blue-tinted panel with a blue heading and a blue filled button -- four
   * coloured elements on the one small surface in a product that is otherwise
   * black, white and a hairline. The card is the app's card now; the kind is a
   * 2px strip along the top.
   */
  test("a kind is ONE strip colour and nothing else", () => {
    for (const [kind, style] of Object.entries(n.KINDS)) {
      assert.deepEqual(
        Object.keys(style),
        ["strip"],
        `${kind} carries more than a strip: ${Object.keys(style).join(", ")}`,
      );
      assert.match(style.strip, /^bg-/, kind);
      assert.doesNotMatch(style.strip, /terra/, `${kind} must not spend the live colour`);
    }
  });

  test("sharing is blue, alerts are red, and the others keep their own", () => {
    assert.equal(n.KINDS.share.strip, "bg-notify-share");
    assert.equal(n.KINDS.alert.strip, "bg-critical");
    assert.equal(n.KINDS.fleet.strip, "bg-notify-fleet");
    assert.equal(n.KINDS.revoked.strip, "bg-notify-revoked");
    /* ⚠ RED IS THE FAULT COLOUR AND ONLY THE FAULT COLOUR. `revoked` is a
       person losing access, which is not a fault, so it is amber. */
    assert.notEqual(n.KINDS.revoked.strip, n.KINDS.alert.strip);
  });

  test("the card's own skin is the app's card, not a tinted one", () => {
    assert.match(n.CARD_SKIN, /bg-card/);
    assert.match(n.CARD_SKIN, /border-card-line/);
    assert.doesNotMatch(n.CARD_SKIN, /notify-/);
    assert.doesNotMatch(n.CARD_TITLE, /notify-/);
  });

  test("three cards are visible at once, and the rest wait", () => {
    /* These sit over live video. A stack that grows without limit is a modal
       with extra steps. */
    assert.equal(n.MAX_VISIBLE, 3);
  });
});

describe("no card in the family wears its colour anywhere but the strip", () => {
  /* Read as SOURCE, because what is asserted is that something is ABSENT.
     These five files are the whole family: the frame, the share bodies, the
     quick-share popover, the controls inside an expanded card, and the page
     that draws the same rows. */
  const FAMILY = [
    "src/components/NotificationStack.tsx",
    "src/components/sharing/ShareNotifications.tsx",
    "src/components/sharing/QuickShare.tsx",
    "src/components/sharing/ShareControls.tsx",
    "src/components/sharing/SharingPane.tsx",
  ];

  test("no tinted background, border, heading or button survives", async () => {
    const offenders = [];
    for (const rel of FAMILY) {
      const src = await readFile(join(ROOT, rel), "utf8");
      /* Comments blanked: a note ABOUT the old blue must not count as blue. */
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
      for (const m of code.matchAll(/(?:bg|border|text|outline)-notify-[a-z-]+/g)) {
        /* The one exception, and it is the badge's version of the strip: a
           5px dot that says a feed is borrowed. */
        const dot = code.slice(Math.max(0, m.index - 40), m.index + 40);
        if (/rounded-full bg-notify-share/.test(dot)) continue;
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    assert.deepEqual(offenders, [], offenders.join(" | "));
  });

  test("the primary button is the app's primary", async () => {
    for (const rel of [
      "src/components/sharing/ShareNotifications.tsx",
      "src/components/sharing/QuickShare.tsx",
    ]) {
      const src = await readFile(join(ROOT, rel), "utf8");
      assert.match(src, /bg-action px-\[12px\] py-\[6px\][^"]*text-action-ink/, rel);
    }
  });

  test("and the frame draws the strip from the kind", async () => {
    const src = await readFile(join(ROOT, "src/components/NotificationStack.tsx"), "utf8");
    assert.match(src, /h-\[2px\] w-full \$\{style\.strip\}/);
    assert.match(src, /\$\{CARD_SKIN\}/);
    assert.match(src, /\$\{CARD_TITLE\}/);
  });
});

describe("the Shares screen asks for names, never identifiers", () => {
  /* ══════════════════════════════════════════════════════════════════════
   *  THE FORM USED TO ASK FOR A DEVICE ID, BY HAND
   * ══════════════════════════════════════════════════════════════════════
   *
   * Three fields on this screen collected machinery: the site to share with,
   * typed as an id with "site id" for a placeholder; the towers, typed as
   * device ids separated by spaces, placeholder `kln_northgate_000001`; and
   * the length, as a number of hours. And the rows above them printed
   * `kln_lab_000002` whenever a share covered exactly one tower.
   *
   * Nobody outside this office knows a device id. The screen now uses the same
   * three pickers as the Sharing pane -- sites by name, towers by label,
   * duration from the same list -- so there is one sharing language and no
   * identifier in it.
   *
   * Read as SOURCE rather than rendered, because what is being asserted is
   * that a particular input does not exist. A render test can only check what
   * is there. */
  let src;
  let hook;
  let feed;
  before(async () => {
    src = await readFile(join(ROOT, "src/components/SharesView.tsx"), "utf8");
    hook = await readFile(join(ROOT, "src/lib/useSiteTowers.ts"), "utf8");
    feed = await readFile(join(ROOT, "src/lib/useShareFeed.tsx"), "utf8");
  });

  test("no field asks somebody to type an id", () => {
    /* The props are pulled out and asserted one by one: a failure then says
       which placeholder is wrong rather than printing the file. */
    const asked = [
      ...src.matchAll(/(?:placeholder|hint)="([^"]*)"/g),
    ].map((m) => m[1]);
    for (const text of asked) {
      assert.doesNotMatch(text, /ids?/, `a field asks for an id: ${text}`);
      assert.doesNotMatch(text, /kln_/, `a field shows a serial: ${text}`);
    }
  });

  test("the pickers are the shared ones, not a second set", () => {
    for (const picker of ["SitePicker", "TowerPicker", "DurationPicker"]) {
      assert.match(src, new RegExp(`<${picker}`), `${picker} is not used`);
    }
    assert.match(src, /from "@\/components\/sharing\/ShareControls"/);
  });

  test("a request offers the sites worth asking, an offer offers them all", () => {
    /* `othersToAsk` drops the sites with no cameras: asking an empty site
       cannot be answered, and offering one yours is an ordinary kindness. */
    assert.match(src, /acting\.othersToAsk : acting\.others/);
  });

  test("a row says HOW MUCH was shared, not which serial", () => {
    assert.match(src, /scopeSummary\(share\.scope\)/);
    assert.doesNotMatch(src, /towers\[0\]/);
  });

  test("the share feed has no error mapper of its own", () => {
    /* It had five rules and `e.message || "Something went wrong."` at the
       end, which is the line that puts a validator's output on a card. The
       three sentences it keeps are the ones that are better here than
       anywhere else, and they yield to a code the mapper has words for. */
    assert.match(feed, /return said\(err,/);
    assert.doesNotMatch(feed, /e\?\.message \|\| "/);
    assert.match(feed, /from "@\/lib\/said"/);
  });

  test("and a tower nothing can name is a word, not its serial", () => {
    /* The picker's own last resort. An offline mast is still lendable, and it
       used to be offered by device id. */
    /* The name in capitals, like every device name; the FALLBACK in sentence
       case, because it is a phrase standing in for a name and not a name. */
    assert.match(hook, /deviceName\(labels\.get\(id\)\) \|\| "An unnamed tower"/);
    assert.doesNotMatch(hook, /labels\.get\(id\) \?\? id/);
  });
});
