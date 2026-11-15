import { test, expect } from '@playwright/test';
import { createLoneUser, createTenant, localStack, serviceRoleKey } from './support/tenants.js';
import { createPlatformAdmin, removePlatformAdmin, sqlAsOwner } from './support/admins.js';
import { rest, rpc, send, signInPassword } from './support/api.js';

// T-ID2.B3a: claiming a Seduh ID over the REAL local stack: PostgREST, Auth, the Edge Function `seduh-claim` and the mail
// catcher (Mailpit), with real JWTs and no browser (B3b builds the screens on this contract). The pgTAP file 082 proves the
// same rules inside the database; this proves what travels over HTTP and that the pieces fit:
//   an organiser issues a link, a person with NO login redeems it with an email, receives a 6-digit code, verifies it,
//   claims a handle, and the profile door then answers has_profile; every hostile shape is refused with its hint; a bad
//   token sends NO email; two parallel claims of one link make exactly one account.
// Local stack only (tenants.js refuses any other host). The Edge Function must be served (the stack's edge runtime does it).

const { api, anonKey } = localStack();
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const tag = Date.now().toString(36);
const digits = (n) => String(Math.floor(Math.random() * 1e5)).padStart(5, '0') + n;

// PostgREST answers a missing privilege for anon as 401 and for a signed-in role as 403 (both SQLSTATE 42501)
const DENIED = [401, 403];

const w = {};
let seq = 0;

async function addPerson(token, orgId, name) {
  const phone = `+673962${digits(seq++)}`;
  const { status, body } = await rest('people?select=id', {
    method: 'POST',
    token,
    body: { org_id: orgId, display_name: name, phone },
    headers: { prefer: 'return=representation' },
  });
  expect(status, JSON.stringify(body)).toBe(201);
  // the identity the feed would have made, linked the way link_person_identity does (owner SQL: no API door creates one)
  sqlAsOwner(
    `insert into app.seduh_identities (phone_e164, display_name, source) values ('${phone}', '${name}', 'archive');` +
      `select set_config('app.seduh_link_write', 'on', false);` +
      `update public.people p set global_person_id = i.id from app.seduh_identities i where p.id = '${body[0].id}' and i.phone_e164 = p.phone;` +
      `select set_config('app.seduh_link_write', '', false);`,
  );
  return body[0].id;
}

async function issue(token, personId) {
  const r = await rpc('issue_seduh_claim_link', { p_person_id: personId }, { token });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return r.body;
}

async function statusOf(token, personId) {
  const r = await rpc(
    'seduh_claim_statuses',
    { p_org_id: w.a.orgId, p_person_ids: [personId] },
    { token },
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body[0];
}

async function messagesTo(email) {
  const response = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  return (await response.json()).messages ?? [];
}

async function codeFor(email) {
  await expect
    .poll(async () => (await messagesTo(email)).length, {
      timeout: 20000,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThan(0);
  const [newest] = await messagesTo(email);
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
  const match = `${message.Text ?? ''}\n${message.HTML ?? ''}`.match(/\b(\d{6})\b/);
  if (!match) throw new Error('no six-digit code in the email');
  return match[1];
}

// The Edge Function, as the browser calls it: the project's anon key, no session.
function seduhClaim(body) {
  return send('/functions/v1/seduh-claim', { method: 'POST', token: anonKey, body });
}

async function verifyCode(email, code) {
  const r = await send('/auth/v1/verify', {
    method: 'POST',
    token: null,
    body: { type: 'email', email, token: code },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.access_token;
}

function claim(token, tokenArg, handle, adult = true) {
  return rpc('claim_seduh_id', { p_token: tokenArg, p_handle: handle, p_adult: adult }, { token });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  w.a = await createTenant({ label: 'clma', live: false, grant: false });
  w.b = await createTenant({ label: 'clmb', live: false, grant: false });
  w.tokenA = (await signInPassword(w.a)).token;
  w.tokenB = (await signInPassword(w.b)).token;
  w.person = await addPerson(w.tokenA, w.a.orgId, `Claimant ${tag}`);
});

test('an organiser issues a link; a person with no login redeems it by emailed code and claims a handle', async () => {
  // the Edge Function must be there: this is the path that makes the login
  expect((await fetch(`${api}/functions/v1/seduh-claim`, { method: 'OPTIONS' })).status).toBe(204);

  expect((await statusOf(w.tokenA, w.person)).state).toBe('can_issue');
  const token = await issue(w.tokenA, w.person);
  const status = await statusOf(w.tokenA, w.person);
  expect(status.state).toBe('link_open');
  expect(JSON.stringify(status)).not.toContain(token);
  expect(Object.keys(status).sort()).toEqual(['expires_at', 'handle', 'person_id', 'state']);

  // the person has NO login: the function creates it and emails the code
  const email = `claim-${tag}-1@local.test`;
  const sent = await seduhClaim({ token, email });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body).toEqual({ ok: true, display_name: `Claimant ${tag}` });
  const code = await codeFor(email);
  const session = await verifyCode(email, code);

  const handle = `claimant-${tag}`;
  const available = await rpc('seduh_handle_available', { p_handle: handle }, { token: null });
  expect(available.body).toBe('available');
  const done = await claim(session, token, handle);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect(done.body.handle).toBe(handle);
  expect(done.body.founding_number).toBeGreaterThanOrEqual(2);
  expect(done.body.profile_path).toBe(`/id/${handle}/`);

  // the door the public page reads
  const profile = await rpc('public_seduh_profile', { p_handle: handle }, { token: null });
  expect(profile.status).toBe(200);
  expect(profile.body.has_profile).toBe(true);
  expect(profile.body.identity.display_name).toBe(`Claimant ${tag}`);
  expect(JSON.stringify(profile.body)).not.toMatch(/@local\.test|\+673/);

  // the handle is now taken; the organiser sees the person as claimed; the token is spent
  expect(
    (await rpc('seduh_handle_available', { p_handle: handle.toUpperCase() }, { token: null })).body,
  ).toBe('taken');
  const after = await statusOf(w.tokenA, w.person);
  expect(after.state).toBe('claimed');
  expect(after.handle).toBe(handle);
  const again = await claim(session, token, `other-${tag}`);
  expect(again.status).toBe(400);
  expect(again.body.hint).toBe('link_used');
  const replay = await seduhClaim({ token, email });
  expect(replay.status).toBe(410);
  expect(replay.body.hint).toBe('link_used');
  // the organiser cannot issue another link for a claimed identity
  const reissue = await rpc(
    'issue_seduh_claim_link',
    { p_person_id: w.person },
    { token: w.tokenA },
  );
  expect(reissue.body.hint).toBe('identity_claimed');

  // the claimant's login is NOT an organisation member: it reads none of A's data
  const people = await rest(`people?org_id=eq.${w.a.orgId}&select=id`, { token: session });
  expect(people.status).toBe(200);
  expect(people.body).toEqual([]);
  // ...and cannot call the organiser doors
  const issueAs = await rpc(
    'issue_seduh_claim_link',
    { p_person_id: w.person },
    { token: session },
  );
  expect(issueAs.status).toBe(403);
});

test('a token that cannot be redeemed sends NO email and creates NO login', async () => {
  const email = `claim-${tag}-nomail@local.test`;
  const person = await addPerson(w.tokenA, w.a.orgId, `Revoked ${tag}`);
  const revokedToken = await issue(w.tokenA, person);
  const revoke = await rpc('revoke_seduh_claim_link', { p_person_id: person }, { token: w.tokenA });
  expect(revoke.status, JSON.stringify(revoke.body)).toBe(204);
  expect((await statusOf(w.tokenA, person)).state).toBe('can_issue');

  const attempts = [
    ['a revoked token', revokedToken, 410, 'link_revoked'],
    ['a well-formed token that was never issued', 'z'.repeat(43), 404, 'link_invalid'],
    ['a malformed token', 'short', 404, 'link_invalid'],
  ];
  for (const [name, token, http, hint] of attempts) {
    const r = await seduhClaim({ token, email });
    expect(r.status, name).toBe(http);
    expect(r.body.hint, name).toBe(hint);
  }
  // nothing was mailed and no login exists for that address
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await messagesTo(email)).toHaveLength(0);
  const users = await send(`/auth/v1/admin/users?per_page=1000`, {
    token: serviceRoleKey(),
    headers: { apikey: serviceRoleKey() },
  });
  expect((users.body.users ?? []).some((u) => u.email === email)).toBe(false);
  // the revoked token cannot be claimed either, by a valid session
  const lone = await createLoneUser('claim-revoked');
  const session = (await signInPassword(lone)).token;
  const r = await claim(session, revokedToken, `revoked-${tag}`);
  expect(r.body.hint).toBe('link_revoked');
});

test('a bad email is refused before the database is asked; each link has a cap on emailed codes', async () => {
  const person = await addPerson(w.tokenA, w.a.orgId, `Capped ${tag}`);
  const token = await issue(w.tokenA, person);
  const bad = await seduhClaim({ token, email: 'not-an-email' });
  expect(bad.status).toBe(400);
  expect(bad.body.hint).toBe('bad_email');
  // the cap is the database's: six emailed codes per link, counted by seduh_claim_begin (service role only)
  const begin = (t) => rpc('seduh_claim_begin', { p_token: t }, { token: serviceRoleKey() });
  for (let i = 0; i < 6; i += 1) expect((await begin(token)).body.status).toBe('ok');
  expect((await begin(token)).body.status).toBe('too_many');
  const capped = await seduhClaim({ token, email: `claim-${tag}-capped@local.test` });
  expect(capped.status).toBe(429);
  expect(capped.body.hint).toBe('too_many_codes');
  expect(await messagesTo(`claim-${tag}-capped@local.test`)).toHaveLength(0);
});

test('seduh_claim_begin is for the service role only', async () => {
  for (const [who, token] of [
    ['anon', null],
    ['an organiser', w.tokenA],
  ]) {
    const r = await rpc('seduh_claim_begin', { p_token: 'z'.repeat(43) }, { token });
    expect(DENIED, who).toContain(r.status);
    expect(r.body.code, who).toBe('42501');
  }
});

test('the organiser doors refuse another organisation, a stranger and anon; the tables are not reachable', async () => {
  const person = await addPerson(w.tokenA, w.a.orgId, `Guarded ${tag}`);
  const refusals = [];
  for (const [who, token] of [
    ['organiser of B', w.tokenB],
    ['anon', null],
  ]) {
    for (const fn of ['issue_seduh_claim_link', 'revoke_seduh_claim_link']) {
      const r = await rpc(fn, { p_person_id: person }, { token });
      refusals.push(`${who} ${fn} ${r.status} ${r.body?.code}`);
      expect(DENIED, `${who} ${fn}`).toContain(r.status);
      expect(r.body.code).toBe('42501');
    }
    const st = await rpc(
      'seduh_claim_statuses',
      { p_org_id: w.a.orgId, p_person_ids: [person] },
      { token },
    );
    expect(DENIED, `${who} statuses`).toContain(st.status);
  }
  // an unknown person is the same answer as another organisation's
  const unknown = await rpc(
    'issue_seduh_claim_link',
    { p_person_id: crypto.randomUUID() },
    { token: w.tokenA },
  );
  expect(unknown.status).toBe(403);
  expect(unknown.body.code).toBe('42501');
  // the claim tables are not reachable by name
  for (const table of [
    'seduh_claim_links',
    'seduh_accounts',
    'seduh_claim_audit',
    'seduh_reserved_numbers',
  ]) {
    const r = await rest(`${table}?select=*`, { token: w.tokenA });
    expect([401, 403, 404, 406], table).toContain(r.status);
  }
  // no token ever appears in any answer the organiser can read
  const people = await rest(`people?id=eq.${person}&select=*`, { token: w.tokenA });
  expect(JSON.stringify(people.body)).not.toMatch(/token/i);
  // a person with no identity and a made-up one
  const none = await rest('people?select=id', {
    method: 'POST',
    token: w.tokenA,
    body: { org_id: w.a.orgId, display_name: 'No identity', phone: `+673963${digits(9)}` },
    headers: { prefer: 'return=representation' },
  });
  const noId = await rpc(
    'issue_seduh_claim_link',
    { p_person_id: none.body[0].id },
    { token: w.tokenA },
  );
  expect(noId.status).toBe(400);
  expect(noId.body.hint).toBe('no_identity');
});

test('two parallel claims of one link make exactly one account; a second account for one login is refused', async () => {
  const person = await addPerson(w.tokenA, w.a.orgId, `Parallel ${tag}`);
  const token = await issue(w.tokenA, person);
  const one = await createLoneUser('claim-par1');
  const two = await createLoneUser('claim-par2');
  const s1 = (await signInPassword(one)).token;
  const s2 = (await signInPassword(two)).token;
  const results = await Promise.all([
    claim(s1, token, `parallel-a-${tag}`),
    claim(s2, token, `parallel-b-${tag}`),
  ]);
  const ok = results.filter((r) => r.status === 200);
  const refused = results.filter((r) => r.status !== 200);
  expect(ok, JSON.stringify(results.map((r) => r.body))).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(refused[0].body.hint).toBe('link_used');
  expect((await statusOf(w.tokenA, person)).state).toBe('claimed');

  // the winner's login already holds an account: a link for ANOTHER person is refused with account_exists, and stays open
  const winner = results[0].status === 200 ? s1 : s2;
  const other = await addPerson(w.tokenA, w.a.orgId, `Second ${tag}`);
  const otherToken = await issue(w.tokenA, other);
  const second = await claim(winner, otherToken, `second-${tag}`);
  expect(second.status).toBe(400);
  expect(second.body.hint).toBe('account_exists');
  expect((await statusOf(w.tokenA, other)).state).toBe('link_open');
});

test('adult, handle and admin rules over HTTP', async () => {
  const person = await addPerson(w.tokenA, w.a.orgId, `Rules ${tag}`);
  const token = await issue(w.tokenA, person);
  const lone = await createLoneUser('claim-rules');
  const session = (await signInPassword(lone)).token;
  const expectHint = async (r, hint) => {
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.hint).toBe(hint);
  };
  await expectHint(await claim(session, token, `rules-${tag}`, false), 'adult_required');
  await expectHint(await claim(session, token, 'admin'), 'handle_reserved');
  await expectHint(await claim(session, token, 'country'), 'handle_reserved');
  await expectHint(await claim(session, token, 'x'), 'handle_invalid');
  await expectHint(await claim(session, token, `bad_${tag}`), 'handle_invalid');
  expect((await rpc('seduh_handle_available', { p_handle: 'admin' }, { token: null })).body).toBe(
    'reserved',
  );
  expect((await rpc('seduh_handle_available', { p_handle: 'x' }, { token: null })).body).toBe(
    'invalid',
  );

  // a platform admin's login never becomes a competitor account (the owner uses a separate competitor email)
  const admin = await createPlatformAdmin('claim-admin');
  try {
    const adminSession = (await signInPassword(admin)).token;
    await expectHint(await claim(adminSession, token, `adminclaim-${tag}`), 'admin_cannot_claim');
  } finally {
    removePlatformAdmin(admin);
  }
  // none of those changed the link: it is still open and the person can still claim
  expect((await statusOf(w.tokenA, person)).state).toBe('link_open');
  const good = await claim(session, token, `rules-${tag}`);
  expect(good.status, JSON.stringify(good.body)).toBe(200);

  // anon and a signed-out call cannot claim
  const anon = await rpc(
    'claim_seduh_id',
    { p_token: token, p_handle: `anon-${tag}`, p_adult: true },
    { token: null },
  );
  expect(DENIED).toContain(anon.status);
});
