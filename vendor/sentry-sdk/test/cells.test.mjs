/**
 * Cells, towers and people: the request on the wire, and the shapes coming back.
 *
 * WHAT THESE COVER that a type cannot. Every assertion below is about a
 * DISTINCTION the server is careful to make and a client can collapse by
 * accident:
 *
 *   * a pairing code never comes back, and is dropped if one ever does;
 *   * `capacity` ABSENT is not `capacity: 0` -- one means "this hub has not
 *     told us its ceiling", the other reads as "this cell holds nothing";
 *   * adding a tower has two success shapes, 201 (asked) and 202 (queued
 *     because the cell is offline), and a client that treats them alike tells
 *     somebody at a mast that a tower is coming when nothing has been sent;
 *   * `shares_ended` is a fact to act on, not a warning to ignore;
 *   * `recordings_kept` is the sentence a UI must say BEFORE the click.
 *
 * And the one about names: a person is created from a NAME, their login is
 * `name.organization`, and the login comes back because an admin has to be
 * able to tell them what to type.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SentryClient, ValidationError } from "../dist/esm/index.js";

/** Records what the SDK put on the wire; replays what the test scripted. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const r = (await handler(url, init)) ?? {};
    const status = r.status ?? 200;
    const body = JSON.stringify(r.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map([["content-type", "application/json"]]),
      async json() {
        return JSON.parse(body);
      },
      async text() {
        return body;
      },
    };
  };
  fn.calls = calls;
  return fn;
}

function client(handler) {
  const fetchImpl = fakeFetch(handler);
  const c = new SentryClient({
    baseUrl: "https://dc.example.com",
    viewerToken: "tok",
    fetch: fetchImpl,
  });
  return { c, calls: fetchImpl.calls };
}

const CELL = {
  hub_id: "hub_north",
  name: "North Camp cell",
  site_id: "site_1",
  site_name: "North Camp",
  status: "active",
  towers: 2,
  online: true,
  capacity: 4,
  full: false,
  filling: false,
};

/* ================================================================== *
 * Reading
 * ================================================================== */

test("listCells asks /v1/cells and returns the named cells", async () => {
  const { c, calls } = client(() => ({ body: { cells: [CELL] } }));
  const got = await c.listCells();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/cells$/);
  assert.equal(calls[0].method, "GET");
  assert.equal(got.cells[0].name, "North Camp cell");
  assert.equal(got.cells[0].site_name, "North Camp");
  assert.equal(got.cells[0].capacity, 4);
});

test("a cell with no reported ceiling has NO capacity key", async () => {
  /* An older hub. A client that read `capacity ?? 0` would refuse every add to
     it; one that checks for the key leaves capacity unenforced, which is what
     the server does. */
  const { hub_id, name, site_id, site_name, status, towers, online } = CELL;
  const { c } = client(() => ({
    body: {
      cells: [{ hub_id, name, site_id, site_name, status, towers, online,
                full: false, filling: false }],
    },
  }));
  const got = await c.listCells();
  assert.equal("capacity" in got.cells[0], false);
  assert.equal(got.cells[0].full, false);
});

test("a cell in no site reads site_id null, not an empty string", async () => {
  const { c } = client(() => ({
    body: { cells: [{ ...CELL, site_id: null, site_name: "" }] },
  }));
  const got = await c.listCells();
  assert.equal(got.cells[0].site_id, null);
});

test("getCell returns the towers, named, with the id as a fallback", async () => {
  const { c, calls } = client(() => ({
    body: {
      cell: CELL,
      towers: [
        { device_id: "kln_a", name: "North Gate", last_seen: "2026-10-20T00:00:00Z" },
        { device_id: "kln_b", name: "" },
      ],
    },
  }));
  const got = await c.getCell("hub_north");
  assert.match(calls[0].url, /\/v1\/cells\/hub_north$/);
  assert.equal(got.towers[0].name, "North Gate");
  /* A blank name becomes the id: a row nobody can identify is worse than a
     row with an ugly label. */
  assert.equal(got.towers[1].name, "kln_b");
});

test("a cell list of the wrong shape is a ValidationError, not a crash later", async () => {
  const { c } = client(() => ({ body: { cells: [{ hub_id: 7 }] } }));
  await assert.rejects(() => c.listCells(), ValidationError);
});

/* ================================================================== *
 * Adding
 * ================================================================== */

test("addCell sends the site, the name and the code", async () => {
  const { c, calls } = client(() => ({
    status: 201,
    body: {
      pending: { claim_id: "clm_1", name: "North Camp", site_id: "site_1",
                 expires_at: "2026-10-20T00:15:00Z", status: "open",
                 what: "cell" },
    },
  }));
  const got = await c.addCell({
    siteId: "site_1", name: "North Camp", pairingCode: "7q2k-4m9x-abcd",
  });
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/v1\/cells$/);
  assert.deepEqual(JSON.parse(calls[0].body), {
    site_id: "site_1", name: "North Camp", pairing_code: "7q2k-4m9x-abcd",
  });
  assert.equal(got.pending.status, "open");
  assert.equal(got.pending.expires_at, "2026-10-20T00:15:00Z");
});

test("a pairing code is never read back, even if a server sends one", async () => {
  /* ⚠ THE ONE THAT MATTERS MOST HERE. A code is a live secret until it is
     consumed. The server omits it; a client that carried one into its state
     would put it in a devtools tree and then in a bug report. */
  const { c } = client(() => ({
    status: 201,
    body: {
      pending: { claim_id: "clm_1", name: "North Camp", status: "open",
                 pairing_code: "7Q2K-4M9X-ABCD" },
    },
  }));
  const got = await c.addCell({
    siteId: "s", name: "n", pairingCode: "7Q2K-4M9X-ABCD",
  });
  assert.equal("pairing_code" in got.pending, false, JSON.stringify(got.pending));
  assert.equal(JSON.stringify(got).includes("7Q2K"), false);
});

test("addTower on a reachable cell comes back asked", async () => {
  const { c, calls } = client(() => ({
    status: 201,
    body: {
      pending: { claim_id: "clm_2", label: "South Ridge", status: "open",
                 what: "tower" },
      cell: { ...CELL, towers: 3 },
    },
  }));
  const got = await c.addTower({
    hubId: "hub_north", name: "South Ridge", pairingCode: "abcd-efgh-jkmn",
  });
  assert.deepEqual(JSON.parse(calls[0].body), {
    hub_id: "hub_north", name: "South Ridge", pairing_code: "abcd-efgh-jkmn",
  });
  assert.equal(got.pending.queued, undefined);
  assert.equal(got.cell.towers, 3);
});

test("addTower on an OFFLINE cell comes back queued, with a sentence", async () => {
  /* The two success shapes are different facts. A client that drew "waiting for
     the tower" here would be telling somebody at a mast that a code had been
     sent to a hub that never received it. */
  const { c } = client(() => ({
    status: 202,
    body: {
      pending: {
        queued: true, hub_id: "hub_north", name: "Queued Ridge",
        status: "waiting_for_cell",
        message: "That cell is offline. The tower will be added as soon as it reconnects.",
      },
    },
  }));
  const got = await c.addTower({
    hubId: "hub_north", name: "Queued Ridge", pairingCode: "x",
  });
  assert.equal(got.pending.queued, true);
  assert.equal(got.pending.status, "waiting_for_cell");
  assert.match(got.pending.message, /offline/);
  /* AND NO EXPIRY, because its window has not started: it begins when the cell
     receives it. A countdown drawn here would run out while the add was still
     perfectly good. */
  assert.equal(got.pending.expires_at, undefined);
});

/* ================================================================== *
 * Renaming, moving, removing
 * ================================================================== */

test("adminRenameCell patches the name and nothing else", async () => {
  const { c, calls } = client(() => ({
    body: { cell: { ...CELL, name: "North Camp (upper)" }, shares_ended: [] },
  }));
  const got = await c.adminRenameCell("hub_north", "North Camp (upper)");
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].body), { name: "North Camp (upper)" });
  assert.equal(got.cell.name, "North Camp (upper)");
  assert.deepEqual(got.shares_ended, []);
});

test("adminMoveCell reports the shares it ended", async () => {
  /* Not a warning -- a fact, and the ids are here so both sides can be told.
     A feed that simply stops is the thing this product does not do. */
  const { c, calls } = client(() => ({
    body: {
      cell: { ...CELL, site_id: "site_2", site_name: "West Yard" },
      shares_ended: ["shr_1", "shr_2"],
    },
  }));
  const got = await c.adminMoveCell("hub_north", "site_2");
  assert.deepEqual(JSON.parse(calls[0].body), { site_id: "site_2" });
  assert.deepEqual(got.shares_ended, ["shr_1", "shr_2"]);
  assert.equal(got.cell.site_name, "West Yard");
});

test("adminRemoveTower carries the sentence about recordings", async () => {
  const { c, calls } = client(() => ({
    body: {
      removed: "kln_a", keys_revoked: true, recordings_kept: true,
      note: "The tower is unpaired and its keys are revoked. Its recordings stay until normal retention: they may be evidence.",
    },
  }));
  const got = await c.adminRemoveTower("kln_a");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(got.keys_revoked, true);
  assert.equal(got.recordings_kept, true);
  assert.match(got.note, /evidence/);
});

test("adminRemoveSite reports that the row was archived", async () => {
  const { c } = client(() => ({
    body: { removed: "site_9", name: "Nothing Here", archived: true },
  }));
  const got = await c.adminRemoveSite("site_9");
  assert.equal(got.archived, true);
  assert.equal(got.name, "Nothing Here");
});

test("adminReplaceTower posts the new board's code to the replace route", async () => {
  const { c, calls } = client(() => ({
    body: {
      pending: { name: "North Gate", status: "waiting_for_tower",
                 old_keys_revoked: true, hub_id: "hub_north" },
    },
  }));
  const got = await c.adminReplaceTower("kln_a", "wxyz-1234-5678");
  assert.match(calls[0].url, /\/v1\/admin\/towers\/kln_a\/replace$/);
  assert.deepEqual(JSON.parse(calls[0].body), { pairing_code: "wxyz-1234-5678" });
  assert.equal(got.pending.old_keys_revoked, true);
  assert.equal(got.pending.name, "North Gate");
});

/* ================================================================== *
 * People
 * ================================================================== */

test("adminAddPerson sends a NAME and gets the whole login back", async () => {
  const { c, calls } = client(() => ({
    status: 201,
    body: {
      person: {
        account_id: "acct_1", name: "dave", login: "dave.kaduna-mine",
        role: "site_user", status: "active", sites: ["site_1"],
        created_at: "2026-10-20T00:00:00Z",
      },
    },
  }));
  const got = await c.adminAddPerson({
    name: "dave", password: "a-long-enough-password", sites: ["site_1"],
  });
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.name, "dave");
  /* ⚠ AND NO ORGANIZATION HALF ON THE WIRE. The server uses the caller's own,
     so there is nothing to type and nothing to get wrong. */
  assert.equal("org_slug" in sent, false);
  assert.equal("login" in sent, false);
  assert.equal(got.name, "dave");
  assert.equal(got.login, "dave.kaduna-mine");
});

test("a person who has been renamed carries both names", async () => {
  const { c } = client(() => ({
    body: {
      person: {
        account_id: "acct_1", name: "dele", was: "chi",
        login: "dele.kaduna-mine", role: "site_user", status: "active",
        sites: [],
      },
    },
  }));
  const got = await c.adminRenamePerson("acct_1", "dele");
  assert.equal(got.name, "dele");
  /* So a list can read `dele (was chi)` for as long as the old name still means
     something to whoever is reading it. */
  assert.equal(got.was, "chi");
});

test("an organization's own login has no name and no was", async () => {
  /* The administrator IS the organization. A people list that showed it with a
     blank name would offer `disable` on the only administrator. */
  const { c } = client(() => ({
    body: {
      people: [{
        account_id: "acct_org", login: "Kaduna Mine", role: "owner",
        status: "active", sites: [],
      }],
    },
  }));
  const got = await c.adminListPeople();
  assert.equal("name" in got.people[0], false);
  assert.equal("was" in got.people[0], false);
  assert.equal(got.people[0].login, "Kaduna Mine");
});

test("a person missing from the answer is a ValidationError, not undefined", async () => {
  /* The server always sends one on a 201. An absent person is a contract
     violation, and returning `undefined` would have a caller read a name off
     nothing three lines later. */
  const { c } = client(() => ({ status: 201, body: {} }));
  await assert.rejects(
    () => c.adminAddPerson({ name: "dave", password: "a-long-enough-password" }),
    ValidationError,
  );
});

/* ================================================================== *
 * WHAT THE BOX IS
 * ================================================================== */

test("a cell carries what the hub says it IS, when the hub says it", async () => {
  /* The About section for a cell. Before this the DC knew a hub's name, its
     tower count and whether it was up -- and nothing about the hardware, so
     "which hub is this, and is it still the same board" could not be answered
     from the dashboard at all. */
  const { c } = client(() => ({
    body: {
      cells: [{
        ...CELL,
        model: "HUB-3S",
        serial: "KLN-H-2610-0001",
        board_serial: "1422220012345",
        firmware: "v1.5.0-258-g1d80628",
        sectors: "A, B, C",
      }],
    },
  }));
  const cell = (await c.listCells()).cells[0];
  assert.equal(cell.model, "HUB-3S");
  assert.equal(cell.serial, "KLN-H-2610-0001");
  assert.equal(cell.board_serial, "1422220012345");
  assert.equal(cell.firmware, "v1.5.0-258-g1d80628");
  assert.equal(cell.sectors, "A, B, C");
});

test("and a hub that has not said carries NO such keys", async () => {
  /* ⚠ ABSENT, NOT "". Every hub that has not reconnected since this shipped is
     here, and a consumer that read `serial ?? ""` would print an empty line
     where "Not reported" belongs -- which reads as a hub with no serial rather
     than as a hub that has not been asked. */
  const { c } = client(() => ({ body: { cells: [CELL] } }));
  const cell = (await c.listCells()).cells[0];
  for (const key of ["model", "serial", "board_serial", "firmware", "sectors"]) {
    assert.equal(key in cell, false, key);
  }
});

test("a hub that reports only some of them keeps the rest absent", async () => {
  /* The ordinary state of a hub whose SERIAL_NUMBER is still blank in its
     device.env: it has a model and a firmware and no serial, and the one that
     is missing must not take the others down with it. */
  const { c } = client(() => ({
    body: { cells: [{ ...CELL, model: "HUB-1S", firmware: "v1.5.0" }] },
  }));
  const cell = (await c.listCells()).cells[0];
  assert.equal(cell.model, "HUB-1S");
  assert.equal(cell.firmware, "v1.5.0");
  assert.equal("serial" in cell, false);
  assert.equal("board_serial" in cell, false);
});
