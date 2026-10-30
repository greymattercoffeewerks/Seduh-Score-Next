import { test, expect } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rest, rpc, send, signInPassword } from './support/api.js';

// T-ID.B2: the Seduh ID link over the REAL local PostgREST, with real JWTs, the way a hostile client would call it (no
// browser). The pgTAP file 062 proves the same refusals inside the database; this proves what travels over HTTP:
// the status, the SQLSTATE and the message are ONE answer for every way of being refused, nothing is linked by a
// refused call, an API caller cannot write global_person_id by any route (insert, update, a random uuid), the identity
// tables are not reachable by name, and the happy path (a member links their own person) works.
//
// Callers (real sign-ins): an owner of organisation A, an owner of organisation B, a person who belongs to NOBODY, a
// person who belongs to BOTH, and the anonymous caller. Identities are made as the database owner (no API door creates one).
//
// Local stack only (tenants.js refuses any other host). The statuses are what the PostgREST bundled with Supabase CLI
// 2.115.0 answers (observed 2026-10-30): 42501 is a 403.

const REFUSED = {
  code: '42501',
  message: 'new row violates row-level security policy for table "people"',
};
const GUARD = { code: '42501', message: 'people.global_person_id is written by the database only' };

const tag = Date.now().toString(36);
// valid E.164 numbers, unique per run (a persistent local stack keeps earlier runs' identities)
const digits = (n) => String(Number.parseInt(tag, 36) % 100000).padStart(5, '0') + n;
const PHONE_LINK = `+673961${digits(1)}`;
const PHONE_OPTED_OUT = `+673961${digits(2)}`;
const PHONE_NONE = `+673961${digits(3)}`;
const PHONE_CHANGED = `+673961${digits(4)}`;

const w = {};

async function addPerson(token, orgId, name, phone) {
  const { status, body } = await rest('people?select=id,global_person_id', {
    method: 'POST',
    token,
    body: { org_id: orgId, display_name: name, phone },
    headers: { prefer: 'return=representation' },
  });
  expect(status, JSON.stringify(body)).toBe(201);
  return body[0].id;
}
async function linkOf(token, personId) {
  const { status, body } = await rest(`people?id=eq.${personId}&select=global_person_id`, {
    token,
  });
  expect(status).toBe(200);
  return body[0]?.global_person_id ?? null;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const a = await createTenant({ label: 'idla', live: false, grant: false });
  const b = await createTenant({ label: 'idlb', live: false, grant: false });
  const nobody = await createLoneUser('idl-nobody');
  const both = await createLoneUser('idl-both');
  await addMember(a, both, 'organiser');
  await addMember(b, both, 'organiser');
  w.a = a;
  w.b = b;
  w.tokenA = (await signInPassword(a)).token;
  w.tokenB = (await signInPassword(b)).token;
  w.tokenNobody = (await signInPassword(nobody)).token;
  w.tokenBoth = (await signInPassword(both)).token;

  w.personA = await addPerson(w.tokenA, a.orgId, 'A active', PHONE_LINK);
  w.personAOptedOut = await addPerson(w.tokenA, a.orgId, 'A opted out', PHONE_OPTED_OUT);
  w.personANone = await addPerson(w.tokenA, a.orgId, 'A no identity', PHONE_NONE);
  w.personAChange = await addPerson(w.tokenA, a.orgId, 'A changes number', PHONE_CHANGED);
  w.personB = await addPerson(w.tokenB, b.orgId, 'B same phone', PHONE_LINK);

  w.identity = '00000000-0000-4000-8000-' + String(Date.now()).slice(-12).padStart(12, '0');
  w.identityOptedOut = '00000000-0000-4000-8001-' + String(Date.now()).slice(-12).padStart(12, '0');
  sqlAsOwner(
    `insert into app.seduh_identities (id, phone_e164, display_name, source) values ('${w.identity}', '${PHONE_LINK}', 'e2e ${tag}', 'archive')`,
  );
  sqlAsOwner(
    `insert into app.seduh_identities (id, phone_e164, display_name, source, status) values ('${w.identityOptedOut}', '${PHONE_OPTED_OUT}', null, 'archive', 'opted_out')`,
  );
});

test('every way of being refused is one 403, one SQLSTATE, one message', async () => {
  const attempts = [
    ['anonymous (no token)', null, w.a.orgId, w.personA],
    ['a stranger from organisation B names A and A person', w.tokenB, w.a.orgId, w.personA],
    ['a person who belongs to nobody', w.tokenNobody, w.a.orgId, w.personA],
    ['a member of A names A and B person', w.tokenA, w.a.orgId, w.personB],
    ['a member of A names B and B person', w.tokenA, w.b.orgId, w.personB],
    ['a member of A names A and a missing person', w.tokenA, w.a.orgId, crypto.randomUUID()],
    ['a member of A names A and a NULL person', w.tokenA, w.a.orgId, null],
    ['a member of A names a NULL organisation', w.tokenA, null, w.personA],
    ['a member of A names a missing organisation', w.tokenA, crypto.randomUUID(), w.personA],
    ['a member of both names A and B person', w.tokenBoth, w.a.orgId, w.personB],
    ['a member of both names B and A person', w.tokenBoth, w.b.orgId, w.personA],
  ];
  const seen = [];
  for (const [who, token, org, person] of attempts) {
    const r = await rpc(
      'link_person_identity',
      { p_org_id: org, p_person_id: person },
      token === null ? { token: null } : { token },
    );
    seen.push({ who, status: r.status, code: r.body?.code, message: r.body?.message });
  }
  console.log(
    'REFUSALS\n' + seen.map((s) => `${s.status} ${s.code} ${s.message} <- ${s.who}`).join('\n'),
  );

  // the anonymous caller is stopped at the door (permission denied for the function: the API role has no EXECUTE)
  expect(seen[0].status).toBe(401);
  expect(seen[0].code).toBe('42501');
  expect(seen[0].message).toMatch(/permission denied for function link_person_identity/);
  // every signed-in refusal is the SAME answer
  const signedIn = seen.slice(1);
  expect(new Set(signedIn.map((s) => `${s.status}|${s.code}|${s.message}`)).size).toBe(1);
  expect(signedIn[0]).toMatchObject({ status: 403, code: REFUSED.code, message: REFUSED.message });

  // and none of them linked anything
  expect(await linkOf(w.tokenA, w.personA)).toBeNull();
  expect(await linkOf(w.tokenB, w.personB)).toBeNull();
});

test('a member links their own person; opted-out is linked too; no identity creates none and says nothing', async () => {
  for (const person of [w.personA, w.personAOptedOut, w.personANone]) {
    const r = await rpc(
      'link_person_identity',
      { p_org_id: w.a.orgId, p_person_id: person },
      { token: w.tokenA },
    );
    // a void function: PostgREST answers 200 with a null body, and it is the same for found and not found
    expect([200, 204]).toContain(r.status);
    expect(r.body === null || r.body === '' || r.body === undefined).toBe(true);
  }
  expect(await linkOf(w.tokenA, w.personA)).toBe(w.identity);
  expect(await linkOf(w.tokenA, w.personAOptedOut)).toBe(w.identityOptedOut);
  expect(await linkOf(w.tokenA, w.personANone)).toBeNull();
  // sqlAsOwner throws when the statement fails: it raises if the function had created an identity for that phone
  sqlAsOwner(
    `do $$ begin if exists (select 1 from app.seduh_identities where phone_e164 = '${PHONE_NONE}') then raise exception 'an identity was created'; end if; end $$`,
  );

  // idempotent
  const again = await rpc(
    'link_person_identity',
    { p_org_id: w.a.orgId, p_person_id: w.personA },
    { token: w.tokenA },
  );
  expect([200, 204]).toContain(again.status);
  expect(await linkOf(w.tokenA, w.personA)).toBe(w.identity);
});

test('ACCEPTED SIGNAL: a member of two organisations sees the same uuid in both', async () => {
  const r = await rpc(
    'link_person_identity',
    { p_org_id: w.b.orgId, p_person_id: w.personB },
    { token: w.tokenBoth },
  );
  expect([200, 204]).toContain(r.status);
  expect(await linkOf(w.tokenB, w.personB)).toBe(w.identity);
  expect(await linkOf(w.tokenA, w.personA)).toBe(await linkOf(w.tokenB, w.personB));
});

test('no API route writes global_person_id, and the answer never depends on whether the uuid exists', async () => {
  const guard = (r) => ({ status: r.status, code: r.body?.code, message: r.body?.message });
  const real = w.identity;
  const random = crypto.randomUUID();
  const outcomes = [];
  // update NULL -> real, NULL -> random, uuid -> other, uuid -> NULL, by a member of one organisation
  outcomes.push(
    guard(
      await rest(`people?id=eq.${w.personANone}`, {
        method: 'PATCH',
        token: w.tokenA,
        body: { global_person_id: real },
      }),
    ),
    guard(
      await rest(`people?id=eq.${w.personANone}`, {
        method: 'PATCH',
        token: w.tokenA,
        body: { global_person_id: random },
      }),
    ),
    guard(
      await rest(`people?id=eq.${w.personA}`, {
        method: 'PATCH',
        token: w.tokenA,
        body: { global_person_id: w.identityOptedOut },
      }),
    ),
    guard(
      await rest(`people?id=eq.${w.personA}`, {
        method: 'PATCH',
        token: w.tokenA,
        body: { global_person_id: null },
      }),
    ),
    // a member of both organisations, onto either organisation's person
    guard(
      await rest(`people?id=eq.${w.personANone}`, {
        method: 'PATCH',
        token: w.tokenBoth,
        body: { global_person_id: real },
      }),
    ),
    guard(
      await rest(`people?id=eq.${w.personB}`, {
        method: 'PATCH',
        token: w.tokenBoth,
        body: { global_person_id: random },
      }),
    ),
    // an insert carrying one
    guard(
      await rest('people', {
        method: 'POST',
        token: w.tokenA,
        body: {
          org_id: w.a.orgId,
          display_name: 'x',
          phone: `+673961${digits(5)}`,
          global_person_id: real,
        },
      }),
    ),
    guard(
      await rest('people', {
        method: 'POST',
        token: w.tokenA,
        body: {
          org_id: w.a.orgId,
          display_name: 'x',
          phone: `+673961${digits(6)}`,
          global_person_id: random,
        },
      }),
    ),
  );
  console.log('GUARD\n' + outcomes.map((o) => `${o.status} ${o.code} ${o.message}`).join('\n'));
  for (const o of outcomes)
    expect(o).toMatchObject({ status: 403, code: GUARD.code, message: GUARD.message });
  expect(await linkOf(w.tokenA, w.personANone)).toBeNull();
  expect(await linkOf(w.tokenA, w.personA)).toBe(w.identity);
});

test('a phone change through the API nulls the link', async () => {
  await rpc(
    'link_person_identity',
    { p_org_id: w.a.orgId, p_person_id: w.personAChange },
    { token: w.tokenA },
  );
  expect(await linkOf(w.tokenA, w.personAChange)).toBeNull(); // no identity for PHONE_CHANGED yet
  sqlAsOwner(
    `insert into app.seduh_identities (phone_e164, display_name, source) values ('${PHONE_CHANGED}', 'e2e change ${tag}', 'archive')`,
  );
  await rpc(
    'link_person_identity',
    { p_org_id: w.a.orgId, p_person_id: w.personAChange },
    { token: w.tokenA },
  );
  expect(await linkOf(w.tokenA, w.personAChange)).not.toBeNull();
  const patch = await rest(`people?id=eq.${w.personAChange}`, {
    method: 'PATCH',
    token: w.tokenA,
    body: { phone: `+673961${digits(7)}` },
  });
  expect(patch.status).toBe(204);
  expect(await linkOf(w.tokenA, w.personAChange)).toBeNull();
});

test('the identity tables are not reachable by any name', async () => {
  const names = ['seduh_identities', 'seduh_identity_merges', 'person_link_blocks'];
  const out = [];
  for (const n of names) {
    const open = await rest(`${n}?select=*`, { token: w.tokenA });
    const app = await send(`/rest/v1/${n}?select=*`, {
      token: w.tokenA,
      headers: { 'accept-profile': 'app' },
    });
    out.push(
      `${n}: default schema ${open.status} ${open.body?.code}; app profile ${app.status} ${app.body?.code}`,
    );
    expect(open.status).toBe(404);
    expect([404, 406]).toContain(app.status);
  }
  console.log('TABLES\n' + out.join('\n'));
});
