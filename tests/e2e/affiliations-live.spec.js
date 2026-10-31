import { test, expect } from '@playwright/test';
import { addMember, createLoneUser, createTenant, serviceRoleKey } from './support/tenants.js';
import { rest, send, signInPassword } from './support/api.js';

// T-ID.C2 (part 1): the staff/affiliate roster, public.org_person_affiliations (T-ID.B3), over the REAL local
// PostgREST with real JWTs, the way a hostile client would call it (no browser). B3's negative cases were only ever
// run in rolled-back SQL sessions; this is the first time they cross HTTP, so what is pinned here is the status, the
// SQLSTATE and the message the API really answers (observed 2026-10-31 against the PostgREST bundled with Supabase CLI
// 2.115.0), not what the migration's comments say.
//
// Callers (real sign-ins): the owner of organisation A, the owner of organisation B, a person who belongs to NOBODY,
// a person who belongs to BOTH, the anonymous caller and the service role. Each case that claims "refused" also
// reads the row back as its owner, so a refusal that still wrote (or an "affects zero rows" that touched one) fails.
//
// Local stack only (tenants.js refuses any other host).

const REP = { prefer: 'return=representation' };
const TABLE = 'org_person_affiliations';

const RLS_REFUSED = {
  status: 403,
  code: '42501',
  message: `new row violates row-level security policy for table "${TABLE}"`,
};
const PERSON_MISMATCH = {
  status: 400,
  code: 'P0001',
  message: `${TABLE}.person_id must belong to the same org as org_id`,
};
const FROZEN = (column) => ({
  status: 400,
  code: '23001',
  message: `${TABLE}.${column} is immutable`,
});

const answer = (r) => ({ status: r.status, code: r.body?.code, message: r.body?.message });

const w = {};
const phone = () =>
  `+673962${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}${Math.floor(Math.random() * 10)}`;

async function addPerson(token, orgId, name) {
  const r = await rest('people?select=id', {
    method: 'POST',
    token,
    body: { org_id: orgId, display_name: name, phone: phone() },
    headers: REP,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body[0].id;
}

const insertRole = (token, orgId, personId, relationship = 'staff') =>
  rest(TABLE, {
    method: 'POST',
    token,
    body: { org_id: orgId, person_id: personId, relationship },
    headers: REP,
  });

// the row as its owning organisation sees it (null when it is not there)
async function rowAsOwner(id) {
  const r = await rest(`${TABLE}?id=eq.${id}&select=*`, { token: w.tokenA });
  expect(r.status).toBe(200);
  return r.body[0] ?? null;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const a = await createTenant({ label: 'afla', live: false, grant: false });
  const b = await createTenant({ label: 'aflb', live: false, grant: false });
  const nobody = await createLoneUser('afl-nobody');
  const both = await createLoneUser('afl-both');
  await addMember(a, both, 'organiser');
  await addMember(b, both, 'organiser');
  Object.assign(w, { a, b, both });
  w.tokenA = (await signInPassword(a)).token;
  w.tokenB = (await signInPassword(b)).token;
  w.tokenNobody = (await signInPassword(nobody)).token;
  w.tokenBoth = (await signInPassword(both)).token;

  w.personA1 = await addPerson(w.tokenA, a.orgId, 'AFL A one');
  w.personA2 = await addPerson(w.tokenA, a.orgId, 'AFL A two');
  w.personA3 = await addPerson(w.tokenA, a.orgId, 'AFL A three');
  w.personB = await addPerson(w.tokenB, b.orgId, 'AFL B one');
});

test('a member adds a role, lists it, ends it (history kept), re-adds it, and deletes', async () => {
  const added = await insertRole(w.tokenA, w.a.orgId, w.personA1, 'staff');
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  const first = added.body[0];
  expect(first).toMatchObject({
    org_id: w.a.orgId,
    person_id: w.personA1,
    relationship: 'staff',
    started_on: null,
    ended_at: null,
    created_by: w.a.userId, // the database stamps the caller; the client did not send it
  });

  const listed = await rest(`${TABLE}?person_id=eq.${w.personA1}&select=id,relationship,ended_at`, {
    token: w.tokenA,
  });
  expect(listed.status).toBe(200);
  expect(listed.body).toEqual([{ id: first.id, relationship: 'staff', ended_at: null }]);

  // ending is a PATCH of ended_at: the row stays (history), now closed
  const endedAt = new Date().toISOString();
  const ended = await rest(`${TABLE}?id=eq.${first.id}`, {
    method: 'PATCH',
    token: w.tokenA,
    body: { ended_at: endedAt },
    headers: REP,
  });
  expect(ended.status).toBe(200);
  expect(ended.body).toHaveLength(1);
  expect(new Date(ended.body[0].ended_at).toISOString()).toBe(endedAt);
  expect((await rowAsOwner(first.id)).ended_at).not.toBeNull();

  // the same relationship can be added again once the earlier one ended: a NEW row, the old one still there
  const again = await insertRole(w.tokenA, w.a.orgId, w.personA1, 'staff');
  expect(again.status, JSON.stringify(again.body)).toBe(201);
  expect(again.body[0].id).not.toBe(first.id);
  expect(again.body[0].ended_at).toBeNull();
  const history = await rest(
    `${TABLE}?person_id=eq.${w.personA1}&relationship=eq.staff&select=id,ended_at&order=created_at`,
    { token: w.tokenA },
  );
  expect(history.body.map((r) => r.id)).toEqual([first.id, again.body[0].id]);
  expect(history.body.map((r) => r.ended_at === null)).toEqual([false, true]);

  // delete: 200 with the removed row, then it is gone and the other row is untouched
  const deleted = await rest(`${TABLE}?id=eq.${again.body[0].id}`, {
    method: 'DELETE',
    token: w.tokenA,
    headers: REP,
  });
  expect(deleted.status).toBe(200);
  expect(deleted.body.map((r) => r.id)).toEqual([again.body[0].id]);
  expect(await rowAsOwner(again.body[0].id)).toBeNull();
  expect(await rowAsOwner(first.id)).not.toBeNull();
});

test('a second OPEN row of the same relationship is 409 / 23505; a different relationship is fine', async () => {
  const one = await insertRole(w.tokenA, w.a.orgId, w.personA2, 'affiliate');
  expect(one.status).toBe(201);
  const dup = await insertRole(w.tokenA, w.a.orgId, w.personA2, 'affiliate');
  expect(answer(dup)).toEqual({
    status: 409,
    code: '23505',
    message: 'duplicate key value violates unique constraint "org_person_affiliations_open_uq"',
  });
  const other = await insertRole(w.tokenA, w.a.orgId, w.personA2, 'staff');
  expect(other.status).toBe(201);
  const rows = await rest(`${TABLE}?person_id=eq.${w.personA2}&select=id`, { token: w.tokenA });
  expect(rows.body).toHaveLength(2); // the refused duplicate wrote nothing
});

test('a relationship that breaks the format is 400 / 23514 and writes nothing', async () => {
  const check = {
    status: 400,
    code: '23514',
    message: `new row for relation "${TABLE}" violates check constraint "org_person_affiliations_relationship_check"`,
  };
  for (const bad of ['Staff', 'x', 'staff member', '1staff', '', 'a'.repeat(41)]) {
    const r = await insertRole(w.tokenA, w.a.orgId, w.personA3, bad);
    expect(answer(r), `relationship ${JSON.stringify(bad)}`).toEqual(check);
  }
  const bad = await rest(`${TABLE}?person_id=eq.${w.personA3}&select=relationship`, {
    token: w.tokenA,
  });
  const badWords = ['Staff', 'x', 'staff member', '1staff', ''];
  expect(bad.body.filter((r) => badWords.includes(r.relationship))).toEqual([]);
  // the edge that IS allowed: 2 and 40 characters
  for (const good of ['ab', 'a'.repeat(40), 'head_judge']) {
    const r = await insertRole(w.tokenA, w.a.orgId, w.personA3, good);
    expect(r.status, `relationship ${good}`).toBe(201);
  }
  // an UPDATE cannot slip a bad word in either
  const row = (
    await rest(`${TABLE}?person_id=eq.${w.personA3}&relationship=eq.ab&select=id`, {
      token: w.tokenA,
    })
  ).body[0];
  const patch = await rest(`${TABLE}?id=eq.${row.id}`, {
    method: 'PATCH',
    token: w.tokenA,
    body: { relationship: 'NOT OK' },
  });
  expect(answer(patch)).toEqual(check);
  expect((await rowAsOwner(row.id)).relationship).toBe('ab');
});

test('a stranger and a member of organisation B read zero rows of A and cannot write: one 403 answer for an insert, zero rows for update and delete', async () => {
  const target = (await insertRole(w.tokenA, w.a.orgId, w.personA3, 'volunteer')).body[0];
  expect(target.ended_at).toBeNull();

  const strangers = { nobody: w.tokenNobody, 'a member of B': w.tokenB };
  const insertAnswers = [];
  for (const [who, token] of Object.entries(strangers)) {
    // SELECT: 200, never an error and never a row of A. Filtered to A's rows it is an empty list.
    for (const query of [
      `${TABLE}?org_id=eq.${w.a.orgId}&select=*`,
      `${TABLE}?id=eq.${target.id}&select=*`,
      `${TABLE}?person_id=eq.${w.personA1}&select=*`,
    ]) {
      const r = await rest(query, { token });
      expect({ who, query, status: r.status, body: r.body }).toEqual({
        who,
        query,
        status: 200,
        body: [],
      });
    }
    const everything = await rest(`${TABLE}?select=org_id`, { token });
    expect(everything.status).toBe(200);
    expect(everything.body.filter((row) => row.org_id === w.a.orgId)).toEqual([]);

    // INSERT naming A: the same 403 whether the person is real, missing or another organisation's, and whether the
    // organisation id is A's, a guess, or absent from the world
    const attempts = [
      ['real A person', insertRole(token, w.a.orgId, w.personA1, 'affiliate')],
      ['missing person', insertRole(token, w.a.orgId, crypto.randomUUID(), 'affiliate')],
      ['B person', insertRole(token, w.a.orgId, w.personB, 'affiliate')],
      ['guessed organisation', insertRole(token, crypto.randomUUID(), w.personA1, 'affiliate')],
    ];
    for (const [label, promise] of attempts) {
      const r = await promise;
      insertAnswers.push({ who, label, ...answer(r) });
    }

    // UPDATE and DELETE of A's row: 200 with an empty representation (RLS hides the row), not an error
    const patch = await rest(`${TABLE}?id=eq.${target.id}`, {
      method: 'PATCH',
      token,
      body: { ended_at: new Date().toISOString() },
      headers: REP,
    });
    expect({ who, status: patch.status, body: patch.body }).toEqual({ who, status: 200, body: [] });
    const del = await rest(`${TABLE}?id=eq.${target.id}`, {
      method: 'DELETE',
      token,
      headers: REP,
    });
    expect({ who, status: del.status, body: del.body }).toEqual({ who, status: 200, body: [] });
  }
  console.log(
    'STRANGER INSERTS\n' +
      insertAnswers
        .map((s) => `${s.status} ${s.code} ${s.message} <- ${s.who}: ${s.label}`)
        .join('\n'),
  );
  for (const s of insertAnswers) expect(s, `${s.who}: ${s.label}`).toMatchObject(RLS_REFUSED);
  expect(new Set(insertAnswers.map((s) => `${s.status}|${s.code}|${s.message}`)).size).toBe(1);

  // none of it changed anything
  const after = await rowAsOwner(target.id);
  expect(after).toEqual(target);
  // and none of the refused inserts left a row behind
  const strays = await rest(
    `${TABLE}?relationship=eq.affiliate&person_id=eq.${w.personA1}&select=id`,
    {
      token: w.tokenA,
    },
  );
  expect(strays.body).toEqual([]);
});

test('the other organisation sees its own rows and only its own', async () => {
  const mine = await insertRole(w.tokenB, w.b.orgId, w.personB, 'staff');
  expect(mine.status).toBe(201);
  const seenByB = await rest(`${TABLE}?select=org_id,person_id`, { token: w.tokenB });
  expect(seenByB.status).toBe(200);
  expect(seenByB.body.length).toBeGreaterThan(0);
  expect(new Set(seenByB.body.map((r) => r.org_id))).toEqual(new Set([w.b.orgId]));
  const seenByA = await rest(`${TABLE}?select=org_id`, { token: w.tokenA });
  expect(new Set(seenByA.body.map((r) => r.org_id))).toEqual(new Set([w.a.orgId]));
});

test('the anonymous caller is stopped at the grant: 401 / 42501 for every verb, with and without a bearer', async () => {
  const target = (await insertRole(w.tokenA, w.a.orgId, w.personA2, 'judge')).body[0];
  const denied = { status: 401, code: '42501', message: `permission denied for table ${TABLE}` };
  for (const token of [undefined, null]) {
    // undefined: the anon key as the bearer; null: no Authorization header at all
    const calls = {
      select: rest(`${TABLE}?select=*`, { token }),
      insert: rest(TABLE, {
        method: 'POST',
        token,
        body: { org_id: w.a.orgId, person_id: w.personA2, relationship: 'anon' },
      }),
      update: rest(`${TABLE}?id=eq.${target.id}`, {
        method: 'PATCH',
        token,
        body: { ended_at: new Date().toISOString() },
      }),
      delete: rest(`${TABLE}?id=eq.${target.id}`, { method: 'DELETE', token }),
    };
    for (const [verb, promise] of Object.entries(calls)) {
      expect(answer(await promise), `${verb} with token ${token}`).toEqual(denied);
    }
  }
  expect(await rowAsOwner(target.id)).toEqual(target);
});

test('the service role has no access to the table (the migration revokes it): 403 / 42501 for every verb', async () => {
  const key = serviceRoleKey();
  const target = (await insertRole(w.tokenA, w.a.orgId, w.personA2, 'sponsor')).body[0];
  const denied = { status: 403, code: '42501', message: `permission denied for table ${TABLE}` };
  const asService = (path, options = {}) =>
    send(`/rest/v1/${path}`, {
      ...options,
      token: key,
      headers: { apikey: key, ...options.headers },
    });
  const calls = {
    select: asService(`${TABLE}?select=*`),
    insert: asService(TABLE, {
      method: 'POST',
      body: { org_id: w.a.orgId, person_id: w.personA2, relationship: 'svc' },
    }),
    update: asService(`${TABLE}?id=eq.${target.id}`, {
      method: 'PATCH',
      body: { ended_at: new Date().toISOString() },
    }),
    delete: asService(`${TABLE}?id=eq.${target.id}`, { method: 'DELETE' }),
  };
  for (const [verb, promise] of Object.entries(calls)) {
    expect(answer(await promise), verb).toEqual(denied);
  }
  expect(await rowAsOwner(target.id)).toEqual(target);
});

test('a member of two organisations cannot move a row between them: 23001 for org_id, person_id or both', async () => {
  const row = (await insertRole(w.tokenBoth, w.a.orgId, w.personA1, 'mover')).body[0];
  const moves = [
    ['org_id', { org_id: w.b.orgId }, 'org_id'],
    ['person_id', { person_id: w.personB }, 'person_id'],
    ['both (org_id is checked first)', { org_id: w.b.orgId, person_id: w.personB }, 'org_id'],
    // to a different person of the SAME organisation: still a move
    ['person_id within A', { person_id: w.personA2 }, 'person_id'],
    // writing the same value is not a move; asserted below as the control
  ];
  for (const [label, patch, column] of moves) {
    const r = await rest(`${TABLE}?id=eq.${row.id}`, {
      method: 'PATCH',
      token: w.tokenBoth,
      body: patch,
      headers: REP,
    });
    expect(answer(r), label).toEqual(FROZEN(column));
  }
  expect(await rowAsOwner(row.id)).toEqual(row);
  expect(
    (
      await rest(`${TABLE}?org_id=eq.${w.b.orgId}&person_id=eq.${w.personB}&select=id`, {
        token: w.tokenB,
      })
    ).body.filter((r) => r.id === row.id),
  ).toEqual([]);

  // control: the freeze is about changing the parent, not about updating the row
  const same = await rest(`${TABLE}?id=eq.${row.id}`, {
    method: 'PATCH',
    token: w.tokenBoth,
    body: { org_id: w.a.orgId, person_id: w.personA1, started_on: '2026-10-01' },
    headers: REP,
  });
  expect(same.status).toBe(200);
  expect(same.body[0].started_on).toBe('2026-10-01');
});

test('a row cannot be created in A for B’s person, and a missing person is the same answer for a member', async () => {
  const callers = { 'a member of A': w.tokenA, 'a member of both': w.tokenBoth };
  const seen = [];
  for (const [who, token] of Object.entries(callers)) {
    for (const [label, person] of [
      ['B person', w.personB],
      ['missing person', crypto.randomUUID()],
    ]) {
      const r = await insertRole(token, w.a.orgId, person, 'crossed');
      seen.push({ who, label, ...answer(r) });
    }
  }
  console.log(
    'MEMBER CROSS-REFERENCE\n' +
      seen.map((s) => `${s.status} ${s.code} ${s.message} <- ${s.who}: ${s.label}`).join('\n'),
  );
  for (const s of seen) expect(s, `${s.who}: ${s.label}`).toMatchObject(PERSON_MISMATCH);
  expect(new Set(seen.map((s) => `${s.status}|${s.code}|${s.message}`)).size).toBe(1);

  // the same two ids, from B's side, wrote nothing in either organisation
  for (const token of [w.tokenA, w.tokenB]) {
    const r = await rest(`${TABLE}?relationship=eq.crossed&select=id`, { token });
    expect(r.body).toEqual([]);
  }

  // a member of both naming B's person under B is fine: the check is about agreement, not about being forbidden
  const ok = await insertRole(w.tokenBoth, w.b.orgId, w.personB, 'crossed_ok');
  expect(ok.status).toBe(201);

  // and a member of A naming B as the organisation is stopped by the policy first, before the cross-reference
  const notMember = await insertRole(w.tokenA, w.b.orgId, w.personB, 'crossed');
  expect(answer(notMember)).toEqual(RLS_REFUSED);
});

test('other hostile shapes: an upsert onto A’s row id, a mixed bulk insert, a missing org_id and an embed change nothing in A', async () => {
  const target = (await insertRole(w.tokenA, w.a.orgId, w.personA3, 'upsert_target')).body[0];

  // An upsert by a member of B naming A's row id: the existing row is never touched. KNOWN, accepted for now and
  // reported with this task: the ANSWER differs between an existing id (403, USING expression) and an unused id
  // (201), so a member of any organisation can tell whether a random uuid is a row id of some other organisation.
  // If that is ever closed, this is the assertion that should change.
  const upsert = (id, resolution) =>
    rest(`${TABLE}?on_conflict=id`, {
      method: 'POST',
      token: w.tokenB,
      body: { id, org_id: w.b.orgId, person_id: w.personB, relationship: 'upsert_probe' },
      headers: { prefer: `return=representation,resolution=${resolution}` },
    });
  const existing = await upsert(target.id, 'merge-duplicates');
  expect(answer(existing)).toEqual({
    status: 403,
    code: '42501',
    message: `new row violates row-level security policy (USING expression) for table "${TABLE}"`,
  });
  const fresh = await upsert(crypto.randomUUID(), 'merge-duplicates');
  expect(fresh.status).toBe(201);
  const ignored = await upsert(target.id, 'ignore-duplicates');
  expect({ status: ignored.status, body: ignored.body }).toEqual({ status: 201, body: [] });
  expect(await rowAsOwner(target.id)).toEqual(target);

  // a bulk insert with one good row and one row for another organisation is all-or-nothing
  const bulk = await rest(TABLE, {
    method: 'POST',
    token: w.tokenA,
    body: [
      { org_id: w.a.orgId, person_id: w.personA3, relationship: 'bulk_ok' },
      { org_id: w.b.orgId, person_id: w.personB, relationship: 'bulk_foreign' },
    ],
    headers: REP,
  });
  expect(answer(bulk)).toEqual(RLS_REFUSED);
  const left = await rest(`${TABLE}?relationship=like.bulk_*&select=id`, { token: w.tokenA });
  expect(left.body).toEqual([]);

  // no org_id, and a null one, are the standard refusal, not a distinguishable NOT NULL error
  for (const body of [
    { person_id: w.personA3, relationship: 'no_org' },
    { org_id: null, person_id: w.personA3, relationship: 'no_org' },
  ]) {
    expect(
      answer(await rest(TABLE, { method: 'POST', token: w.tokenA, body, headers: REP })),
    ).toEqual(RLS_REFUSED);
  }

  // embedding the roster in a people read: B sees nothing of A's people, A sees its own roles
  const asB = await rest(`people?id=eq.${w.personA3}&select=id,${TABLE}(id)`, { token: w.tokenB });
  expect({ status: asB.status, body: asB.body }).toEqual({ status: 200, body: [] });
  const asA = await rest(`people?id=eq.${w.personA3}&select=id,${TABLE}(id)`, { token: w.tokenA });
  expect(asA.body[0][TABLE].map((r) => r.id)).toContain(target.id);
  const strangerEmbed = await rest(`people?select=id,${TABLE}(org_id)`, { token: w.tokenNobody });
  expect(strangerEmbed.body).toEqual([]);

  // the trigger function is not callable as an RPC
  const rpcCall = await send('/rest/v1/rpc/check_affiliation_person_org', {
    method: 'POST',
    token: w.tokenA,
    body: {},
  });
  expect(rpcCall.status).toBe(404);
});
