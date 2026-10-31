import { test, expect } from '@playwright/test';
import { createTenant } from './support/tenants.js';
import { rest, signInPassword } from './support/api.js';

// T-ID.B3 follow-up (migration 20261031120000_affiliations_column_grants): the row-id existence oracle on
// public.org_person_affiliations is closed, and a client can no longer choose `id`, `created_at` or `created_by`.
// BUG CLASS: "a tenant table lets a client choose its primary key, and the conflict answer distinguishes another
// tenant's row". Over the REAL local PostgREST with real JWTs, no browser. Every case that claims "refused" reads
// the row back as its owner.
//
// The oracle: a member of organisation B names a row id that belongs to organisation A, and a freshly invented id,
// on every route a member has. The two answers must be IDENTICAL (status, code, message) and the row of A must be
// untouched. Before the migration the upsert answered 403 "(USING expression)" for A's id and 201 for an unused one.
//
// Local stack only (tenants.js refuses any other host).

const REP = { prefer: 'return=representation' };
const TABLE = 'org_person_affiliations';
const answer = (r) => ({ status: r.status, code: r.body?.code, message: r.body?.message });

const w = {};
const phone = () =>
  `+673963${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}${Math.floor(Math.random() * 10)}`;

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

async function rowAsOwner(id) {
  const r = await rest(`${TABLE}?id=eq.${id}&select=*`, { token: w.tokenA });
  expect(r.status).toBe(200);
  return r.body[0] ?? null;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const a = await createTenant({ label: 'idoa', live: false, grant: false });
  const b = await createTenant({ label: 'idob', live: false, grant: false });
  Object.assign(w, { a, b });
  w.tokenA = (await signInPassword(a)).token;
  w.tokenB = (await signInPassword(b)).token;
  w.personA1 = await addPerson(w.tokenA, a.orgId, 'IDO A one');
  w.personA2 = await addPerson(w.tokenA, a.orgId, 'IDO A two');
  w.personB1 = await addPerson(w.tokenB, b.orgId, 'IDO B one');
  const r = await rest(TABLE, {
    method: 'POST',
    token: w.tokenA,
    body: { org_id: a.orgId, person_id: w.personA1, relationship: 'staff' },
    headers: REP,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  w.target = r.body[0]; // a row of organisation A, whose id a member of B tries to probe
});

// the same body for an id that exists in A and one nobody has: B writes into B with B's own person
const probeBody = (id, extra = {}) => ({
  id,
  org_id: w.b.orgId,
  person_id: w.personB1,
  relationship: 'probe',
  ...extra,
});

test('naming an id on insert is refused with the SAME answer for another organisation’s row id and an unused one, on every route', async () => {
  const routes = {
    'plain insert': (id) =>
      rest(TABLE, { method: 'POST', token: w.tokenB, body: probeBody(id), headers: REP }),
    'on_conflict=id merge-duplicates': (id) =>
      rest(`${TABLE}?on_conflict=id`, {
        method: 'POST',
        token: w.tokenB,
        body: probeBody(id),
        headers: { prefer: 'return=representation,resolution=merge-duplicates' },
      }),
    'on_conflict=id ignore-duplicates': (id) =>
      rest(`${TABLE}?on_conflict=id`, {
        method: 'POST',
        token: w.tokenB,
        body: probeBody(id),
        headers: { prefer: 'return=representation,resolution=ignore-duplicates' },
      }),
    'bulk insert': (id) =>
      rest(TABLE, { method: 'POST', token: w.tokenB, body: [probeBody(id)], headers: REP }),
    'missing=default bulk': (id) =>
      rest(`${TABLE}?columns=id,org_id,person_id,relationship`, {
        method: 'POST',
        token: w.tokenB,
        body: [probeBody(id)],
        headers: { prefer: 'return=representation,missing=default' },
      }),
  };
  const seen = [];
  for (const [route, call] of Object.entries(routes)) {
    const existing = answer(await call(w.target.id));
    const unused = answer(await call(crypto.randomUUID()));
    seen.push({ route, existing, unused });
    expect(unused, `${route}: unused id`).toEqual(existing); // THE ORACLE: the answers must not differ
    expect(existing, route).toEqual({
      status: 403,
      code: '42501',
      message: `permission denied for table ${TABLE}`,
    });
  }
  console.log(
    'ID ORACLE\n' +
      seen
        .map((s) => `${s.existing.status} ${s.existing.code} ${s.existing.message} <- ${s.route}`)
        .join('\n'),
  );
  // A's row was never touched, and no probe row exists in either organisation
  expect(await rowAsOwner(w.target.id)).toEqual(w.target);
  for (const token of [w.tokenA, w.tokenB]) {
    const stray = await rest(`${TABLE}?relationship=eq.probe&select=id`, { token });
    expect(stray.body).toEqual([]);
  }
});

test('a body naming created_by or created_at is refused on insert, in the member’s own organisation, and writes nothing', async () => {
  const forged = [
    ['created_by', { created_by: w.b.userId }],
    ['created_at', { created_at: '2001-01-01T00:00:00Z' }],
    ['both', { created_by: w.a.userId, created_at: '2001-01-01T00:00:00Z' }],
  ];
  for (const [label, extra] of forged) {
    const r = await rest(TABLE, {
      method: 'POST',
      token: w.tokenB,
      body: { org_id: w.b.orgId, person_id: w.personB1, relationship: 'forged', ...extra },
      headers: REP,
    });
    expect(answer(r), label).toMatchObject({ status: 403, code: '42501' });
    expect(r.body.message, label).toBe(`permission denied for table ${TABLE}`);
  }
  const stray = await rest(`${TABLE}?relationship=eq.forged&select=id`, { token: w.tokenB });
  expect(stray.body).toEqual([]);
});

test('a PATCH of id, created_by or created_at on the member’s own row is refused; relationship, started_on and ended_at still patch', async () => {
  const mine = (
    await rest(TABLE, {
      method: 'POST',
      token: w.tokenB,
      body: { org_id: w.b.orgId, person_id: w.personB1, relationship: 'patchme' },
      headers: REP,
    })
  ).body[0];
  expect(mine.created_by).toBe(w.b.userId);
  for (const body of [
    { id: crypto.randomUUID() },
    { created_by: w.a.userId },
    { created_at: '2001-01-01T00:00:00Z' },
  ]) {
    const r = await rest(`${TABLE}?id=eq.${mine.id}`, {
      method: 'PATCH',
      token: w.tokenB,
      body,
      headers: REP,
    });
    expect(answer(r), JSON.stringify(body)).toEqual({
      status: 403,
      code: '42501',
      message: `permission denied for table ${TABLE}`,
    });
  }
  const readBack = (await rest(`${TABLE}?id=eq.${mine.id}&select=*`, { token: w.tokenB })).body[0];
  expect(readBack).toEqual(mine);

  const ok = await rest(`${TABLE}?id=eq.${mine.id}`, {
    method: 'PATCH',
    token: w.tokenB,
    body: { relationship: 'patched', started_on: '2026-10-01', ended_at: '2026-10-31T00:00:00Z' },
    headers: REP,
  });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body[0]).toMatchObject({
    id: mine.id,
    relationship: 'patched',
    started_on: '2026-10-01',
    created_by: mine.created_by,
    created_at: mine.created_at,
  });
});

test('a PATCH naming id, filtered by another organisation’s row id or an unused one, and an array upsert, answer identically', async () => {
  const refused = { status: 403, code: '42501', message: `permission denied for table ${TABLE}` };
  for (const filterId of [w.target.id, crypto.randomUUID()]) {
    const r = await rest(`${TABLE}?id=eq.${filterId}`, {
      method: 'PATCH',
      token: w.tokenB,
      body: { id: crypto.randomUUID() },
      headers: REP,
    });
    expect(answer(r), `PATCH filter ${filterId}`).toEqual(refused);
  }
  for (const id of [w.target.id, crypto.randomUUID()]) {
    const r = await rest(`${TABLE}?on_conflict=id`, {
      method: 'POST',
      token: w.tokenB,
      body: [probeBody(id)],
      headers: { prefer: 'return=representation,resolution=merge-duplicates' },
    });
    expect(answer(r), `array upsert ${id}`).toEqual(refused);
  }
  // merge-duplicates with no on_conflict (PostgREST defaults to the primary key)
  for (const id of [w.target.id, crypto.randomUUID()]) {
    const r = await rest(TABLE, {
      method: 'POST',
      token: w.tokenB,
      body: probeBody(id),
      headers: { prefer: 'return=representation,resolution=merge-duplicates' },
    });
    expect(answer(r), `merge-duplicates without on_conflict ${id}`).toEqual(refused);
  }
  expect(await rowAsOwner(w.target.id)).toEqual(w.target);
});

test('PATCH and DELETE by another organisation’s row id are indistinguishable from a missing id: 200 with zero rows', async () => {
  const outcomes = [];
  for (const [label, id] of [
    ['A row id', w.target.id],
    ['unused id', crypto.randomUUID()],
  ]) {
    const patch = await rest(`${TABLE}?id=eq.${id}`, {
      method: 'PATCH',
      token: w.tokenB,
      body: { ended_at: new Date().toISOString() },
      headers: REP,
    });
    const del = await rest(`${TABLE}?id=eq.${id}`, {
      method: 'DELETE',
      token: w.tokenB,
      headers: REP,
    });
    outcomes.push({ label, patch: [patch.status, patch.body], del: [del.status, del.body] });
  }
  expect(outcomes[0].patch).toEqual([200, []]);
  expect(outcomes[0].del).toEqual([200, []]);
  expect(outcomes[1].patch).toEqual(outcomes[0].patch);
  expect(outcomes[1].del).toEqual(outcomes[0].del);
  expect(await rowAsOwner(w.target.id)).toEqual(w.target);
});

test('the legitimate shapes still work: insert without id, an upsert body without id, the database stamps id, created_at and created_by', async () => {
  const plain = await rest(TABLE, {
    method: 'POST',
    token: w.tokenA,
    body: {
      org_id: w.a.orgId,
      person_id: w.personA2,
      relationship: 'judge',
      started_on: '2026-01-01',
    },
    headers: REP,
  });
  expect(plain.status, JSON.stringify(plain.body)).toBe(201);
  expect(plain.body[0]).toMatchObject({ created_by: w.a.userId, started_on: '2026-01-01' });
  expect(plain.body[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Date(plain.body[0].created_at).getTime()).toBeGreaterThan(Date.now() - 60_000);

  // on_conflict=id with no id in the body is just an insert (the default fills the id)
  const upsert = await rest(`${TABLE}?on_conflict=id`, {
    method: 'POST',
    token: w.tokenA,
    body: { org_id: w.a.orgId, person_id: w.personA2, relationship: 'steward' },
    headers: { prefer: 'return=representation,resolution=merge-duplicates' },
  });
  expect(upsert.status, JSON.stringify(upsert.body)).toBe(201);
  expect(upsert.body[0].id).not.toBe(plain.body[0].id);
});
