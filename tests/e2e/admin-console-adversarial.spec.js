import { test, expect } from '@playwright/test';
import {
  addMember,
  createLoneUser,
  createTenant,
  signLocalToken,
  serviceRoleKey,
} from './support/tenants.js';
import { createPlatformAdmin, removePlatformAdmin, sqlAsOwner } from './support/admins.js';
import {
  send,
  signInPassword,
  enrolTotp,
  elevate,
  rpc,
  rest,
  graphql,
  authAdmin,
  refreshSession,
  signOutEverywhere,
  decodeToken,
  withPayload,
  signedWithWrongSecret,
  unsigned,
} from './support/api.js';

// T-ADM.E1: the adversarial pass. A written attack list, run over HTTP against the real local stack the way a
// hostile client would (no browser, no console page): with no token, an ordinary organiser's token, an admin who has
// not answered the second factor, tokens edited, forged, or VALIDLY signed with wrong claims, the admin tables and the
// `app` schema asked for by name, GraphQL, the inner service-role functions called directly, the operator pointing
// the functions at themselves, hostile inputs, a token replayed after "sign out everywhere", an admin revoked or
// banned mid-session, the second-factor compensators, two requests at once, and an account whose password someone
// else may know. Every attempt is pinned to the refusal the database gives (status, SQLSTATE, hint, and where the
// reason could be mistaken, the message), so a change that opens a door fails here by name.
//
// What it does not cover, and where that lives: the admin-accounts Edge Function is not served by `supabase start`
// (the only thing CI runs), so ITS attack list is supabase/tests/manual/admin-accounts-e2e.mjs. The tables' grants and
// row security are proved by pgTAP 050, not here: the `app` schema is not exposed to the API at all, so no HTTP call
// can tell a revoked privilege from a missing one. The cloud project's exposed schemas are a rollout check (spec
// section 8, step 2). The 401/403/404/406 statuses and the PGRST codes below are what the PostgREST bundled with
// Supabase CLI 2.115.0 answers (observed 2026-10-16); an upgrade that renames one is a message to read, not a hole.

const ADMIN_FUNCTIONS = {
  admin_can_provision: () => ({}),
  admin_list_orgs: () => ({}),
  admin_org_detail: (w) => ({ p_org_id: w.a.orgId }),
  admin_find_user: (w) => ({ p_email: w.lone.email }),
  admin_list_audit: () => ({}),
  admin_create_org: (w) => ({
    p_name: 'Attack',
    p_slug: `adv-${w.tag}-c`,
    p_owner_user_id: w.lone.userId,
  }),
  admin_add_member: (w) => ({
    p_org_id: w.a.orgId,
    p_user_id: w.lone.userId,
    p_role: 'organiser',
  }),
  admin_set_role: (w) => ({
    p_org_id: w.a.orgId,
    p_user_id: w.a.userId,
    p_role: 'organiser',
  }),
  // The entitlement grant functions (T-GATE.B2). The organiser's own organisation is the target on purpose: an
  // organiser granting their own organisation a plan is the self-grant the gating threat model names.
  admin_grant_create: (w) => ({ p_org_id: w.a.orgId, p_tier: 'annual' }),
  admin_grant_extend: (w) => ({
    p_grant_id: w.a.orgId,
    p_new_valid_until: '2099-01-01T00:00:00Z',
    p_reason: 'attack',
  }),
  admin_grant_revoke: (w) => ({ p_grant_id: w.a.orgId }),
  admin_list_grants: (w) => ({ p_org_id: w.a.orgId }),
  admin_list_keys: () => ({}),
  admin_plan_orgs: () => ({}),
  admin_plan_org: (w) => ({ p_org_id: w.a.orgId }),
  admin_payment_confirm: (w) => ({
    p_org_id: w.a.orgId,
    p_tier: 'annual',
    p_amount_note: 'attack',
  }),
  admin_event_release: (w) => ({ p_event_id: w.a.orgId, p_reason: 'attack' }),
  admin_event_resnapshot: (w) => ({ p_event_id: w.a.orgId, p_reason: 'attack' }),
  admin_gating_preview: () => ({ p_key: 'btc_format' }),
  admin_set_key_enforced: () => ({ p_key: 'btc_format', p_enforced: true, p_confirm: 0 }),
};
// Callable by the service role only: nobody holding a user token may run these, an admin at aal2 included.
const SERVICE_ONLY = {
  admin_record_account_create: (w) => ({ p_actor_id: w.admin.userId, p_user_id: w.lone.userId }),
  create_org: (w) => ({
    p_name: 'Inner',
    p_slug: `adv-${w.tag}-i`,
    p_owner_user_id: w.lone.userId,
  }),
  org_add_existing_member: (w) => ({
    p_org_id: w.a.orgId,
    p_user_id: w.lone.userId,
    p_role: 'owner',
  }),
  org_set_role: (w) => ({ p_org_id: w.a.orgId, p_user_id: w.a.userId, p_role: 'organiser' }),
};

// A refusal, by status, SQLSTATE and hint, with the name of what was attacked in the failure message.
function refused(result, { label = '', status = 403, code = '42501', hint, message } = {}) {
  const shown = `${label} ${JSON.stringify(result.body)}`.trim();
  expect(result.status, shown).toBe(status);
  expect(result.body.code, shown).toBe(code);
  if (hint) expect(result.body.hint, shown).toBe(hint);
  if (message) expect(result.body.message, shown).toMatch(message);
}
const noRightToFunction = (name) => new RegExp(`permission denied for function ${name}\\b`);
const invalid = (hint, label) => ({ label, status: 400, code: '22023', hint });

test.describe('the admin surface under attack (HTTP, real local stack)', () => {
  test.describe.configure({ mode: 'serial' });

  const w = { tag: Date.now().toString(36).slice(-6) };
  const admins = []; // every platform admin this spec makes, removed at the end whatever happened
  let adminAal1;
  let adminAal2;
  let organiserAal1;

  // this admin's audit rows about one organisation (the log is shared with other specs running at the same time)
  const rowsAbout = async (orgId, token = adminAal2) => {
    const result = await rpc('admin_list_audit', { p_limit: 200, p_org_id: orgId }, { token });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body.filter((row) => row.actor_id === w.admin.userId);
  };
  const makeAdmin = async (label) => {
    const person = await createPlatformAdmin(label);
    admins.push(person);
    return person;
  };
  // a fresh aal2 session of the main admin (the tests that end sessions put one back)
  const freshAal2 = async () => elevate((await signInPassword(w.admin)).token, w.factor);

  test.beforeAll(async () => {
    test.setTimeout(120000);
    w.admin = await makeAdmin('adv-admin');
    w.a = await createTenant({
      label: 'adv-a',
      format: 'cup_taster',
      payload: {},
      eventName: 'Adv A',
    });
    w.b = await createTenant({
      label: 'adv-b',
      format: 'cup_taster',
      payload: {},
      eventName: 'Adv B',
    });
    w.lone = await createLoneUser('adv-lone');
    const first = await signInPassword(w.admin);
    w.factor = await enrolTotp(first.token);
    adminAal2 = w.factor.token;
    adminAal1 = (await signInPassword(w.admin)).token;
    organiserAal1 = (await signInPassword(w.a)).token;
  });

  test.afterAll(async () => {
    for (const person of admins) {
      try {
        removePlatformAdmin(person);
      } catch {
        // already removed by the test that revoked it
      }
    }
    await w.a?.cleanUp();
    await w.b?.cleanUp();
    // (the accounts, their authenticator factors and memberships stay, as in the other specs: unique per run)
  });

  test('the tokens are what the attacks assume: an admin at aal1, an admin at aal2, an organiser', async () => {
    expect(decodeToken(adminAal1).payload.aal).toBe('aal1');
    expect(decodeToken(adminAal2).payload.aal).toBe('aal2');
    expect(decodeToken(organiserAal1).payload.aal).toBe('aal1');
    expect((await rpc('am_i_platform_admin', {}, { token: adminAal2 })).body).toEqual({
      aal: 'aal2',
      is_admin: true,
    });
    // and the gate says yes to a real admin at aal2: the "no" answers below are not a function that always refuses
    expect(await rpc('admin_can_provision', {}, { token: adminAal2 })).toMatchObject({
      status: 200,
      body: true,
    });
  });

  test('ANONYMOUS (no token, or only the public key): every admin and inner function is refused before it runs', async () => {
    for (const [name, make] of Object.entries({
      am_i_platform_admin: () => ({}),
      ...ADMIN_FUNCTIONS,
      ...SERVICE_ONLY,
    })) {
      for (const token of [null, undefined]) {
        refused(await rpc(name, make(w), { token }), {
          label: `${name} (${token === null ? 'no Authorization header' : 'public key'})`,
          status: 401,
          message: noRightToFunction(name),
        });
      }
    }
  });

  test('AN ORGANISER (signed in, not an admin): admin_required for every admin function, no right at all to the inner ones', async () => {
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: organiserAal1 }), {
        label: name,
        hint: 'admin_required',
      });
    }
    for (const [name, make] of Object.entries(SERVICE_ONLY)) {
      refused(await rpc(name, make(w), { token: organiserAal1 }), {
        label: name,
        message: noRightToFunction(name),
      });
    }
    // asking "am I an admin" tells them only that they are not
    expect((await rpc('am_i_platform_admin', {}, { token: organiserAal1 })).body).toEqual({
      aal: 'aal1',
      is_admin: false,
    });
  });

  test('THE ORGANISER SEES ONLY THEIR OWN ORGANISATION through the ordinary tables: no other organisation, no admin data', async () => {
    const members = await rest('org_members?select=org_id,user_id', { token: organiserAal1 });
    expect(members.status).toBe(200);
    expect(members.body.length).toBeGreaterThan(0);
    expect(new Set(members.body.map((row) => row.org_id))).toEqual(new Set([w.a.orgId]));
    const orgs = await rest('orgs?select=id', { token: organiserAal1 });
    expect(orgs.body.map((row) => row.id)).toEqual([w.a.orgId]);
    // and the anonymous caller has no right to either table: refused, not merely shown nothing (a grant given by
    // mistake would still leave row security, but the right itself is the first thing to keep closed)
    for (const [table, column] of [
      ['org_members', 'org_id'],
      ['orgs', 'id'],
      ['events', 'id'],
    ]) {
      const anonymous = await rest(`${table}?select=${column}`, { token: null });
      expect(anonymous.status, `anonymous GET ${table}`).toBe(401);
      expect(anonymous.body.code, `anonymous GET ${table}`).toBe('42501');
    }
  });

  test('AN ORGANISER WHO ENROLS AN AUTHENTICATOR APP (aal2): still not an admin: the second factor proves nothing about who they are', async () => {
    const session = await enrolTotp((await signInPassword(w.a)).token);
    expect(decodeToken(session.token).payload.aal).toBe('aal2');
    expect((await rpc('am_i_platform_admin', {}, { token: session.token })).body).toEqual({
      aal: 'aal2',
      is_admin: false,
    });
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: session.token }), {
        label: name,
        hint: 'admin_required',
      });
    }
  });

  test('AN ADMIN WHO HAS NOT ANSWERED THE SECOND FACTOR (aal1): admin_mfa_required for every admin function', async () => {
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: adminAal1 }), {
        label: name,
        hint: 'admin_mfa_required',
      });
    }
    for (const [name, make] of Object.entries(SERVICE_ONLY)) {
      refused(await rpc(name, make(w), { token: adminAal1 }), {
        label: name,
        message: noRightToFunction(name),
      });
    }
    // they may ask who they are (the console needs it to show the code box), and nothing else
    expect((await rpc('am_i_platform_admin', {}, { token: adminAal1 })).body).toEqual({
      aal: 'aal1',
      is_admin: true,
    });
  });

  test('FORGED TOKENS: editing a claim, signing with another secret, an unsigned token, or swapping the user are all stopped at the gateway, by the signature', async () => {
    const now = Math.floor(Date.now() / 1000);
    const raised = { aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] };
    const badKey = /No suitable key or wrong key type/;
    const forgeries = {
      'aal edited, signature kept': [withPayload(adminAal1, raised), badKey],
      'another secret': [signedWithWrongSecret(adminAal1, raised), badKey],
      'alg none': [unsigned(adminAal1, raised), /Wrong or unsupported encoding algorithm/],
      // the organiser's token with the ADMIN's identity written in
      'sub swapped, signature kept': [
        withPayload(organiserAal1, { sub: w.admin.userId, ...raised }),
        badKey,
      ],
      // (refused for its signature, like the others: that `exp` is ENFORCED is proved by the next test)
      'exp pushed out, signature kept': [
        withPayload(adminAal1, { exp: now + 10 * 365 * 86400 }),
        badKey,
      ],
    };
    for (const [what, [token, message]] of Object.entries(forgeries)) {
      refused(await rpc('admin_list_orgs', {}, { token }), {
        label: what,
        status: 401,
        code: 'PGRST301',
        message,
      });
    }
  });

  test('VALIDLY SIGNED TOKENS WITH WRONG CLAIMS (what a leaked signing secret or a bug would allow): the database gate decides, claim by claim', async () => {
    const now = Math.floor(Date.now() / 1000);
    const real = decodeToken(adminAal2).payload;
    const aal1Session = decodeToken(adminAal1).payload.session_id;
    const strangerSession = decodeToken(organiserAal1).payload.session_id;
    const list = (patch) =>
      rpc('admin_list_orgs', {}, { token: signLocalToken({ ...real, ...patch }) });

    // the signed copy of the real claims is accepted: every refusal below is for the claim that was changed
    expect((await list({})).status).toBe(200);
    // an expired token is refused by the gateway even though its signature is good
    refused(await list({ iat: now - 4000, exp: now - 100 }), {
      label: 'expired',
      status: 401,
      code: 'PGRST303',
      message: /JWT expired/,
    });
    // D-A14: the second factor must be recent: just inside the window is accepted, just outside is not
    expect((await list({ amr: [{ method: 'totp', timestamp: now - 3500 }] })).status).toBe(200);
    for (const [what, amr] of Object.entries({
      'a totp verification an hour and a minute old': [{ method: 'totp', timestamp: now - 3700 }],
      'a totp timestamp in the future': [{ method: 'totp', timestamp: now + 3600 }],
      'no totp entry at all': [{ method: 'password', timestamp: now }],
      'no amr claim': undefined,
    })) {
      refused(await list({ amr }), { label: what, hint: 'admin_mfa_required' });
    }
    // the session the token names must be a live session of THIS user, at aal2
    for (const [what, session_id] of Object.entries({
      'a session id that does not exist': '11111111-1111-4111-8111-111111111111',
      'no session id': undefined,
      "another user's live session": strangerSession,
    })) {
      refused(await list({ session_id }), { label: what, hint: 'admin_session_ended' });
    }
    // the admin's own session, but one that never answered the second factor
    refused(await list({ session_id: aal1Session }), {
      label: 'own aal1 session',
      hint: 'admin_mfa_required',
    });
    // a role claim of anon or service_role does not turn the function on
    refused(await list({ role: 'anon' }), {
      label: 'role anon',
      status: 401,
      message: noRightToFunction('admin_list_orgs'),
    });
    refused(await list({ role: 'service_role' }), {
      label: 'role service_role',
      message: noRightToFunction('admin_list_orgs'),
    });
  });

  test('THE app SCHEMA IS NOT EXPOSED: the platform tables and the gate function cannot be asked for by name, by anyone', async () => {
    // (This proves exposure, which is the first wall. The tables' privileges and row security, the second, are pgTAP 050's:
    // no HTTP call can tell a revoked privilege from an absent schema.)
    for (const [who, token] of [
      ['anonymous', null],
      ['organiser', organiserAal1],
      ['admin at aal2', adminAal2],
    ]) {
      for (const table of ['platform_admins', 'admin_audit_log']) {
        const read = await rest(table, { token });
        expect(read.status, `${who} GET public.${table}`).toBe(404);
        expect(read.body.code).toBe('PGRST205');
        for (const [method, extra] of [
          ['GET', {}],
          ['POST', { body: { user_id: w.lone.userId } }],
          ['PATCH', { body: { action: 'tampered' } }],
          ['DELETE', {}],
        ]) {
          const headers =
            method === 'GET' ? { 'accept-profile': 'app' } : { 'content-profile': 'app' };
          const result = await rest(method === 'POST' ? table : `${table}?id=gt.0`, {
            method,
            token,
            headers,
            ...extra,
          });
          expect(result.status, `${who} ${method} app.${table}`).toBe(406);
          expect(result.body.code, `${who} ${method} app.${table}`).toBe('PGRST106');
        }
      }
      for (const name of ['require_platform_admin', 'is_platform_admin', 'admin_audit']) {
        const result = await rpc(name, {}, { token, headers: { 'content-profile': 'app' } });
        expect(result.status, `${who} app.${name}`).toBe(406);
        expect(result.body.code, `${who} app.${name}`).toBe('PGRST106');
      }
    }
  });

  test('GRAPHQL IS NOT A SECOND DOOR: the extension is not enabled, so no admin or platform field exists to ask for', async () => {
    // If pg_graphql is ever enabled, every function executable by authenticated would become a field and this fails:
    // that is the moment to decide what the admin functions look like there.
    for (const [who, token] of [
      ['anonymous', null],
      ['organiser', organiserAal1],
      ['admin at aal2', adminAal2],
    ]) {
      for (const query of [
        '{ __schema { queryType { fields { name } } mutationType { fields { name } } } }',
        '{ adminListOrgs { __typename } }',
        'mutation { adminSetRole(pOrgId: "x") { __typename } }',
      ]) {
        const result = await graphql(query, { token });
        expect(result.body.data ?? null, `${who} ${query}`).toBeNull();
        expect(result.body.errors[0].message, `${who} ${query}`).toBe(
          'pg_graphql extension is not enabled.',
        );
      }
    }
  });

  test("THE INNER SERVICE-ROLE FUNCTIONS cannot be called directly by an admin at aal2, and the admin wrappers are not the service role's", async () => {
    for (const [name, make] of Object.entries(SERVICE_ONLY)) {
      refused(await rpc(name, make(w), { token: adminAal2 }), {
        label: name,
        message: noRightToFunction(name),
      });
    }
    // the service role is not an admin: the wrappers answer to a person at aal2, not to a key
    expect((await authAdmin('users?per_page=1')).status).toBe(200); // the key itself works
    for (const name of ['admin_list_orgs', 'admin_create_org']) {
      refused(await rpc(name, ADMIN_FUNCTIONS[name](w), { token: serviceRoleKey() }), {
        label: `service role ${name}`,
        message: noRightToFunction(name),
      });
    }
    // and a write function cannot be reached by a GET
    const get = await send(`/rest/v1/rpc/admin_add_member?p_org_id=${w.a.orgId}`, {
      token: adminAal2,
    });
    expect(get.status).toBe(404);
    expect(get.body.code).toBe('PGRST202');
  });

  test('SELF-PROMOTION: an admin cannot add, promote or make themselves an owner; an organiser cannot write membership at all', async () => {
    refused(
      await rpc(
        'admin_add_member',
        { p_org_id: w.a.orgId, p_user_id: w.admin.userId, p_role: 'owner' },
        { token: adminAal2 },
      ),
      { label: 'admin_add_member self', hint: 'admin_self_target' },
    );
    refused(
      await rpc(
        'admin_set_role',
        { p_org_id: w.a.orgId, p_user_id: w.admin.userId, p_role: 'owner' },
        { token: adminAal2 },
      ),
      { label: 'admin_set_role self', hint: 'admin_self_target' },
    );
    refused(
      await rpc(
        'admin_create_org',
        { p_name: 'Mine', p_slug: `adv-${w.tag}-s`, p_owner_user_id: w.admin.userId },
        { token: adminAal2 },
      ),
      { label: 'admin_create_org self', hint: 'admin_self_target' },
    );
    // A MEMBER AT THE TABLE, trying to make themselves an owner (and to attach themselves to another organisation).
    // There are two walls and this test does not care which one answers: the table privilege (the local stack and a
    // fresh database give the API roles SELECT only, so the answer is "permission denied", 403) and, behind it, row
    // security with no write policy (where a privilege exists, as on the stack CI starts, the answer is a silent
    // no-op, 204). What must hold on either is that NOTHING CHANGED, which is read back from the admin's own view.
    const staff = await createLoneUser('adv-staff');
    await addMember(w.b, staff, 'organiser');
    const staffToken = (await signInPassword(staff)).token;
    const roleOf = async () =>
      (
        await rpc('admin_org_detail', { p_org_id: w.b.orgId }, { token: adminAal2 })
      ).body.members.find((m) => m.user_id === staff.userId)?.role;
    expect(await roleOf()).toBe('organiser');

    const patch = await rest(`org_members?user_id=eq.${staff.userId}`, {
      method: 'PATCH',
      token: staffToken,
      body: { role: 'owner' },
    });
    expect([204, 403], `PATCH org_members ${JSON.stringify(patch.body)}`).toContain(patch.status);
    if (patch.status === 403) expect(patch.body.code).toBe('42501');
    expect(await roleOf()).toBe('organiser');

    const attach = await rest('org_members', {
      method: 'POST',
      token: organiserAal1,
      body: { org_id: w.b.orgId, user_id: w.a.userId, role: 'owner' },
    });
    expect(attach.status, `POST org_members ${JSON.stringify(attach.body)}`).toBe(403);
    expect(attach.body.code).toBe('42501');
    const members = (await rpc('admin_org_detail', { p_org_id: w.b.orgId }, { token: adminAal2 }))
      .body.members;
    expect(members.map((m) => m.user_id)).not.toContain(w.a.userId);

    // which wall answered, for the record (read from the database, not asserted: images differ in this)
    const privileges = String(
      sqlAsOwner(
        "select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'none') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'org_members' and grantee = 'authenticated'",
      ),
    ).replace(/\s+/g, ' ');
    console.log(
      `org_members privileges for authenticated: ${privileges} (PATCH answered ${patch.status})`,
    );
    test.info().annotations.push({
      type: 'org_members privileges for authenticated',
      description: privileges,
    });
  });

  test('HOSTILE INPUTS to the admin functions: exact matching only, bad roles and unknown ids and a bad name refused with their hints', async () => {
    const unknown = '00000000-0000-4000-8000-000000000001';
    for (const email of ['%@%', '_%', "' or 1=1 --", `${w.lone.email}%`, `%${w.lone.email}`]) {
      const result = await rpc('admin_find_user', { p_email: email }, { token: adminAal2 });
      expect(result.status).toBe(200);
      expect(result.body, email).toEqual([]);
    }
    const exact = await rpc(
      'admin_find_user',
      { p_email: w.lone.email.toUpperCase() },
      { token: adminAal2 },
    );
    expect(exact.body).toHaveLength(1);
    expect(exact.body[0].user_id).toBe(w.lone.userId);
    const base = { p_org_id: w.a.orgId, p_user_id: w.lone.userId };
    refused(
      await rpc('admin_add_member', { ...base, p_role: 'superuser' }, { token: adminAal2 }),
      invalid('member_role_invalid', 'add_member bad role'),
    );
    refused(
      await rpc(
        'admin_set_role',
        { ...base, p_user_id: w.a.userId, p_role: 'admin' },
        { token: adminAal2 },
      ),
      invalid('member_role_invalid', 'set_role bad role'),
    );
    refused(
      await rpc('admin_org_detail', { p_org_id: unknown }, { token: adminAal2 }),
      invalid('org_not_found', 'org_detail unknown org'),
    );
    refused(
      await rpc(
        'admin_add_member',
        { ...base, p_org_id: unknown, p_role: 'organiser' },
        { token: adminAal2 },
      ),
      invalid('org_not_found', 'add_member unknown org'),
    );
    refused(
      await rpc(
        'admin_add_member',
        { ...base, p_user_id: unknown, p_role: 'organiser' },
        { token: adminAal2 },
      ),
      invalid('member_user_not_found', 'add_member unknown user'),
    );
    for (const [what, hint, args] of [
      [
        'a name of control characters',
        'org_name_invalid',
        { p_name: 'a\u0007b', p_slug: `adv-${w.tag}-n` },
      ],
      ['a reserved link name', 'org_slug_reserved', { p_name: 'Reserved', p_slug: 'admin' }],
      ['a link name with a slash', 'org_slug_invalid', { p_name: 'Slash', p_slug: 'a/b/c' }],
    ]) {
      refused(
        await rpc(
          'admin_create_org',
          { ...args, p_owner_user_id: w.lone.userId },
          { token: adminAal2 },
        ),
        invalid(hint, what),
      );
    }
    // the last owner of an organisation cannot be demoted through the admin function either
    refused(
      await rpc(
        'admin_set_role',
        { p_org_id: w.a.orgId, p_user_id: w.a.userId, p_role: 'organiser' },
        { token: adminAal2 },
      ),
      { label: 'last owner', status: 400, code: 'P0001', hint: 'last_owner' },
    );
  });

  test('NONE OF THE REFUSED CALLS WROTE AN AUDIT ROW: nothing is on record about either organisation after the whole battery above', async () => {
    expect(await rowsAbout(w.a.orgId)).toEqual([]);
    expect(await rowsAbout(w.b.orgId)).toEqual([]);
    // and the refused create_org calls left no organisation behind
    const orgs = await rpc('admin_list_orgs', {}, { token: adminAal2 });
    expect(orgs.body.filter((org) => org.slug.startsWith(`adv-${w.tag}`))).toEqual([]);
  });

  test('TWO REQUESTS AT ONCE: two demotions of the last two owners leave exactly one owner (one refused with last_owner, no deadlock), and a double add makes one member and one row', async () => {
    const owner2 = await createLoneUser('adv-owner2');
    await addMember(w.b, owner2, 'owner');
    const demote = (userId) =>
      rpc(
        'admin_set_role',
        { p_org_id: w.b.orgId, p_user_id: userId, p_role: 'organiser' },
        { token: adminAal2 },
      );
    const results = await Promise.all([demote(w.b.userId), demote(owner2.userId)]);
    const outcomes = results.map((r) =>
      r.status === 204 ? 'done' : `${r.status} ${r.body.code} ${r.body.hint}`,
    );
    expect(outcomes.sort()).toEqual(['400 P0001 last_owner', 'done']);
    const detail = await rpc('admin_org_detail', { p_org_id: w.b.orgId }, { token: adminAal2 });
    expect(detail.body.members.filter((m) => m.role === 'owner')).toHaveLength(1);

    const fresh = await createLoneUser('adv-double');
    const add = () =>
      rpc(
        'admin_add_member',
        { p_org_id: w.b.orgId, p_user_id: fresh.userId, p_role: 'organiser' },
        { token: adminAal2 },
      );
    const adds = await Promise.all([add(), add(), add()]);
    expect(adds.map((r) => r.status).sort()).toEqual([204, 409, 409]);
    const added = (await rowsAbout(w.b.orgId)).filter(
      (row) => row.action === 'member.add' && row.target_user_id === fresh.userId,
    );
    expect(added).toHaveLength(1);
  });

  test('A STOLEN TOKEN IS DEAD AFTER "SIGN OUT EVERYWHERE": admin_session_ended, for the access token and for the refresh token', async () => {
    try {
      const login = await signInPassword(w.admin);
      const stolen = await elevate(login.token, w.factor);
      expect((await rpc('admin_list_orgs', {}, { token: stolen })).status).toBe(200);
      expect((await signOutEverywhere(stolen)).status).toBe(204);
      for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
        refused(await rpc(name, make(w), { token: stolen }), {
          label: name,
          hint: 'admin_session_ended',
        });
      }
      // the refresh token that came with it cannot bring the session back
      const refreshed = await refreshSession(login.refreshToken);
      expect(refreshed.status).toBe(400);
      expect(refreshed.body.error_code).toBe('refresh_token_not_found');
      // "everywhere" means every session of this admin, ours included
      expect((await rpc('admin_list_orgs', {}, { token: adminAal2 })).body.hint).toBe(
        'admin_session_ended',
      );
    } finally {
      adminAal2 = await freshAal2();
    }
    expect((await rpc('admin_list_orgs', {}, { token: adminAal2 })).status).toBe(200);
  });

  test('AN ADMIN REVOKED MID-SESSION loses the console on the very next call, at aal2 or at aal1', async () => {
    const other = await makeAdmin('adv-revoked');
    const aal1 = (await signInPassword(other)).token;
    const session = await enrolTotp((await signInPassword(other)).token);
    expect((await rpc('admin_list_orgs', {}, { token: session.token })).status).toBe(200);
    removePlatformAdmin(other);
    refused(await rpc('admin_list_orgs', {}, { token: session.token }), {
      label: 'revoked, aal2',
      hint: 'admin_required',
    });
    refused(await rpc('admin_list_orgs', {}, { token: aal1 }), {
      label: 'revoked, aal1',
      hint: 'admin_required',
    });
    expect((await rpc('am_i_platform_admin', {}, { token: session.token })).body.is_admin).toBe(
      false,
    );
  });

  test('A BANNED ADMIN (the documented incident response) is cut off on the next call, and the same session works again when the ban is lifted', async () => {
    const other = await makeAdmin('adv-banned');
    const session = await enrolTotp((await signInPassword(other)).token);
    expect((await rpc('admin_list_orgs', {}, { token: session.token })).status).toBe(200);
    try {
      expect(
        (await authAdmin(`users/${other.userId}`, { method: 'PUT', body: { ban_duration: '1h' } }))
          .status,
      ).toBe(200);
      refused(await rpc('admin_list_orgs', {}, { token: session.token }), {
        label: 'banned',
        hint: 'admin_required',
      });
    } finally {
      await authAdmin(`users/${other.userId}`, { method: 'PUT', body: { ban_duration: 'none' } });
    }
    expect((await rpc('admin_list_orgs', {}, { token: session.token })).status).toBe(200);
  });

  test('THE SECOND-FACTOR COMPENSATORS: a password-only session can neither add a second factor nor remove the verified one, and a factor planted before the owner enrols is gone once they verify', async () => {
    // an admin who already has a verified factor, in a new password-only session
    const password = (await signInPassword(w.admin)).token;
    const enrol = await send('/auth/v1/factors', {
      method: 'POST',
      token: password,
      body: { factor_type: 'totp', friendly_name: 'second' },
    });
    expect(enrol.status).toBe(403);
    expect(enrol.body.error_code).toBe('insufficient_aal');
    const remove = await send(`/auth/v1/factors/${w.factor.factorId}`, {
      method: 'DELETE',
      token: password,
    });
    expect(remove.status).toBe(422);
    expect(remove.body.error_code).toBe('insufficient_aal');

    // an account with no factor yet: someone who knows the password plants one before the owner enrols (threat 8)
    const victim = await createLoneUser('adv-planted');
    const attacker = (await signInPassword(victim)).token;
    const planted = await send('/auth/v1/factors', {
      method: 'POST',
      token: attacker,
      body: { factor_type: 'totp', friendly_name: 'planted' },
    });
    expect(planted.status).toBe(200);
    // the owner enrols their own and verifies it
    await enrolTotp((await signInPassword(victim)).token);
    // the planted one can no longer be used
    const challenge = await send(`/auth/v1/factors/${planted.body.id}/challenge`, {
      method: 'POST',
      token: attacker,
      body: {},
    });
    expect(challenge.status, JSON.stringify(challenge.body)).toBeGreaterThanOrEqual(400);
  });

  test('AN ACCOUNT WHOSE PASSWORD SOMEONE ELSE MAY KNOW (D-A9): refused without the attestation in every shape it can take, the flag alone decides nothing, and the audit row says what happened', async () => {
    const toB = (userId, extra = {}) => ({
      p_org_id: w.b.orgId,
      p_user_id: userId,
      p_role: 'organiser',
      ...extra,
    });
    const needs = { status: 400, code: '22023', hint: 'member_password_unset' };

    // 1. already in another organisation: its owner may know the one-time password
    const member = await createLoneUser('adv-member');
    await addMember(w.a, member, 'organiser');
    expect(
      (await rpc('admin_find_user', { p_email: member.email }, { token: adminAal2 })).body[0],
    ).toMatchObject({
      org_count: 1,
      needs_attestation: true,
    });
    refused(await rpc('admin_add_member', toB(member.userId), { token: adminAal2 }), {
      ...needs,
      label: 'member, no flag',
    });
    refused(
      await rpc('admin_add_member', toB(member.userId, { p_attest_own_password: false }), {
        token: adminAal2,
      }),
      { ...needs, label: 'member, false' },
    );
    refused(
      await rpc(
        'admin_create_org',
        { p_name: 'Needs attest', p_slug: `adv-${w.tag}-m`, p_owner_user_id: member.userId },
        { token: adminAal2 },
      ),
      { ...needs, label: 'member as the owner of a new organisation' },
    );

    // 2. removed from an organisation (a removed team login keeps its one-time password but holds no membership)
    const removed = await createLoneUser('adv-removed');
    // (psql runs with ON_ERROR_STOP: a failed insert throws here)
    sqlAsOwner(
      `insert into public.team_removed_members (org_id, user_id, removed_by) values ('${w.a.orgId}', '${removed.userId}', '${w.a.userId}')`,
    );
    expect(
      (await rpc('admin_find_user', { p_email: removed.email }, { token: adminAal2 })).body[0],
    ).toMatchObject({
      org_count: 0,
      needs_attestation: true,
    });
    refused(await rpc('admin_add_member', toB(removed.userId), { token: adminAal2 }), {
      ...needs,
      label: 'removed member',
    });
    refused(
      await rpc(
        'admin_create_org',
        { p_name: 'Removed owner', p_slug: `adv-${w.tag}-r`, p_owner_user_id: removed.userId },
        { token: adminAal2 },
      ),
      { ...needs, label: 'removed member as the owner of a new organisation' },
    );

    // the refusals changed nothing: no member, no organisation
    expect(
      (
        await rpc('admin_org_detail', { p_org_id: w.b.orgId }, { token: adminAal2 })
      ).body.members.map((m) => m.user_id),
    ).not.toContain(member.userId);
    const orgs = await rpc('admin_list_orgs', {}, { token: adminAal2 });
    expect(
      orgs.body.filter((org) => /^adv-.*-(m|r)$/.test(org.slug) && org.slug.includes(w.tag)),
    ).toEqual([]);

    // 3. must_change_password is advisory: a fresh login carrying the flag needs no attestation...
    const flagged = await createLoneUser('adv-flagged', {
      userMetadata: { must_change_password: true },
    });
    expect(
      (await rpc('admin_find_user', { p_email: flagged.email }, { token: adminAal2 })).body[0],
    ).toMatchObject({
      must_change_password: true,
      needs_attestation: false,
    });
    expect((await rpc('admin_add_member', toB(flagged.userId), { token: adminAal2 })).status).toBe(
      204,
    );
    // ...and one that is also a member of another organisation is refused whatever the flag says
    const both = await createLoneUser('adv-both', {
      userMetadata: { must_change_password: false },
    });
    await addMember(w.a, both, 'organiser');
    refused(await rpc('admin_add_member', toB(both.userId), { token: adminAal2 }), {
      ...needs,
      label: 'member whose flag is false',
    });

    // 4. the attestation lets them through, and the row records "required and given" (false for the fresh login)
    expect(
      (
        await rpc('admin_add_member', toB(member.userId, { p_attest_own_password: true }), {
          token: adminAal2,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await rpc('admin_add_member', toB(removed.userId, { p_attest_own_password: true }), {
          token: adminAal2,
        })
      ).status,
    ).toBe(204);
    const fresh = await createLoneUser('adv-fresh-attested');
    expect(
      (
        await rpc('admin_add_member', toB(fresh.userId, { p_attest_own_password: true }), {
          token: adminAal2,
        })
      ).status,
    ).toBe(204);
    refused(
      await rpc('admin_add_member', toB(member.userId, { p_attest_own_password: true }), {
        token: adminAal2,
      }),
      {
        label: 'the same member again',
        status: 409,
        code: '23505',
        hint: 'member_exists',
      },
    );
    const attestedOf = Object.fromEntries(
      (await rowsAbout(w.b.orgId))
        .filter((row) => row.action === 'member.add')
        .map((row) => [row.target_user_id, row.detail.attested]),
    );
    expect(attestedOf[member.userId]).toBe(true);
    expect(attestedOf[removed.userId]).toBe(true);
    expect(attestedOf[flagged.userId]).toBe(false);
    expect(attestedOf[fresh.userId]).toBe(false); // attested means "the database required it AND it was given"
  });

  // ---- Change password (ADMIN-PASSWORD-DESIGN section 9, X1 to X4). The change goes to GoTrue's `PUT /auth/v1/user`,
  // not to a database function, so these are attacks on the Auth API's own rules; none of them is an admin function.
  // A dedicated admin, so changing its password disturbs no other test.
  const PW_OLD = 'adversarial-password-0001';
  const PW_NEW = 'adversarial-password-0002';
  const putPassword = (token, password) =>
    send('/auth/v1/user', { method: 'PUT', token, body: { password } });

  test('X1 PASSWORD CHANGE FROM A PASSWORD-ONLY SESSION: an admin with a verified factor at aal1 is refused with insufficient_aal, and the password is unchanged', async () => {
    const pw = await makeAdmin('adv-pw-x1');
    const factor = await enrolTotp((await signInPassword(pw)).token);
    const aal1 = (await signInPassword(pw)).token;
    expect(decodeToken(aal1).payload.aal).toBe('aal1');
    const attempt = await putPassword(aal1, PW_NEW);
    // (401, not the 403 the design note guessed: this GoTrue answers insufficient_aal on a password change with 401)
    expect(attempt.status, JSON.stringify(attempt.body)).toBe(401);
    expect(attempt.body.error_code).toBe('insufficient_aal');
    // unchanged: the old password still signs in, the attempted one does not
    expect((await signInPassword(pw)).token).toBeTruthy();
    await expect(signInPassword({ email: pw.email, password: PW_NEW })).rejects.toThrow();
    // and the same login at aal2 is allowed (the rule is about the level, not the account)
    expect(factor.token).toBeTruthy();
  });

  test('X2 KNOWN GAP (documented behaviour, not a guarantee): a stale-TOTP aal2 session CAN change the password, because the 60-minute window lives in our database gate and GoTrue only asks for aal2; every admin function still refuses it', async () => {
    const pw = await makeAdmin('adv-pw-x2');
    const session = await enrolTotp((await signInPassword(pw)).token);
    const real = decodeToken(session.token).payload;
    const now = Math.floor(Date.now() / 1000);
    const stale = signLocalToken({ ...real, amr: [{ method: 'totp', timestamp: now - 7200 }] });
    // the admin gate refuses the stale token, claim by claim, on every admin function
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: stale }), {
        label: `${name} with a stale TOTP`,
        hint: 'admin_mfa_required',
      });
    }
    // ... but the Auth API does not know the window: this succeeds today. If it ever starts to answer 403, the gap
    // has closed: update ROADMAP.md ("Admin password change: stale-TOTP session") and this test.
    const attempt = await putPassword(stale, PW_NEW);
    expect(attempt.status, JSON.stringify(attempt.body)).toBe(200);
    await expect(signInPassword({ email: pw.email, password: PW_NEW })).resolves.toBeTruthy();
  });

  test('X3 WHO MAY CHANGE WHOSE PASSWORD: no token, the public key and a forged token are refused, and an organiser changing their own password does not touch an admin’s', async () => {
    const pw = await makeAdmin('adv-pw-x3');
    const { token: aal2 } = await enrolTotp((await signInPassword(pw)).token);
    for (const [what, token] of Object.entries({
      'no token': null,
      'only the public key': undefined,
      'a token signed with another secret': signedWithWrongSecret(aal2),
      'an unsigned token': unsigned(aal2),
    })) {
      const attempt = await putPassword(token, PW_NEW);
      expect(attempt.status, what).toBeGreaterThanOrEqual(400);
      expect(attempt.status, what).toBeLessThan(500);
    }
    await expect(signInPassword({ email: pw.email, password: PW_NEW })).rejects.toThrow();

    // an organiser (no factor, so a password-only session may change their own password) changes theirs
    const organiser = await createLoneUser('adv-pw-org');
    const organiserToken = (await signInPassword(organiser)).token;
    expect((await putPassword(organiserToken, PW_NEW)).status).toBe(200);
    await expect(
      signInPassword({ email: organiser.email, password: PW_NEW }),
    ).resolves.toBeTruthy();
    // the admin's password and session are untouched
    expect((await signInPassword(pw)).token).toBeTruthy();
    expect((await rpc('admin_can_provision', {}, { token: aal2 })).body).toBe(true);
  });

  test('X4 A TOKEN FROM BEFORE THE CHANGE, on another session, is dead once the changing session has ended the others (scope: others); the changing session stays ready', async () => {
    const pw = await makeAdmin('adv-pw-x4');
    const factor = await enrolTotp((await signInPassword(pw)).token);
    const changer = factor.token;
    const other = await elevate((await signInPassword(pw)).token, factor);
    expect((await rpc('admin_list_orgs', {}, { token: other })).status).toBe(200);

    expect((await putPassword(changer, PW_NEW)).status).toBe(200);
    // exactly what the console does next (core/passwordChange.js endOtherSessions)
    expect(
      (await send('/auth/v1/logout?scope=others', { method: 'POST', token: changer, body: {} }))
        .status,
    ).toBe(204);

    refused(await rpc('admin_list_orgs', {}, { token: other }), {
      label: 'the other session',
      hint: 'admin_session_ended',
    });
    expect((await putPassword(other, PW_OLD)).status).toBeGreaterThanOrEqual(400);
    // the changing session is untouched and the gate still says yes
    expect((await rpc('admin_list_orgs', {}, { token: changer })).status).toBe(200);
    expect((await rpc('admin_can_provision', {}, { token: changer })).body).toBe(true);
    await expect(signInPassword({ email: pw.email, password: pw.password })).rejects.toThrow();
    await expect(signInPassword({ email: pw.email, password: PW_NEW })).resolves.toBeTruthy();
  });
});
