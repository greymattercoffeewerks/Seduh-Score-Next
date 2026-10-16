import { test, expect } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';
import { createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import {
  signInPassword,
  enrolTotp,
  elevate,
  rpc,
  rest,
  signOutEverywhere,
  decodeToken,
  withPayload,
  signedWithWrongSecret,
  unsigned,
} from './support/api.js';

// T-ADM.E1: the adversarial pass. A written attack list, run over HTTP against the real local stack the way a
// hostile client would (no browser, no console page): with no token, an ordinary organiser's token, an admin who has
// not answered the second factor, tokens edited or forged, the admin tables and the `app` schema asked for by name,
// the inner service-role functions called directly, the operator pointing the functions at themselves, hostile
// inputs, a token replayed after "sign out everywhere", an admin revoked mid-session, and an account whose password
// someone else may know. Every attempt is pinned to the refusal the database gives (status, SQLSTATE, hint), so a
// change that opens a door fails here by name. The admin-accounts Edge Function is not served by `supabase start`
// (the only thing CI runs), so ITS attack list lives in supabase/tests/manual/admin-accounts-e2e.mjs.

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
  admin_add_member: (w) => ({ p_org_id: w.a.orgId, p_user_id: w.lone.userId, p_role: 'organiser' }),
  admin_set_role: (w) => ({ p_org_id: w.a.orgId, p_user_id: w.a.userId, p_role: 'organiser' }),
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

const NO_FUNCTION_RIGHT = /permission denied for function/;

function refused(result, { status = 403, code = '42501', hint, message } = {}) {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(result.body.code).toBe(code);
  if (hint) expect(result.body.hint).toBe(hint);
  if (message) expect(result.body.message).toMatch(message);
}

test.describe('the admin surface under attack (HTTP, real local stack)', () => {
  test.describe.configure({ mode: 'serial' });

  const w = { tag: Date.now().toString(36).slice(-6) };
  let adminAal1;
  let adminAal2;
  let organiserAal1;
  let auditRowsBefore;

  const adminRows = async () => {
    const result = await rpc('admin_list_audit', { p_limit: 200 }, { token: adminAal2 });
    expect(result.status).toBe(200);
    return result.body.filter((row) => row.actor_id === w.admin.userId);
  };

  test.beforeAll(async () => {
    test.setTimeout(120000);
    w.admin = await createPlatformAdmin('adv-admin');
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
    if (w.admin) removePlatformAdmin(w.admin);
    await w.a?.cleanUp();
    await w.b?.cleanUp();
  });

  test('the tokens are what the attacks assume: an admin at aal1, an admin at aal2, an organiser', async () => {
    expect(decodeToken(adminAal1).payload.aal).toBe('aal1');
    expect(decodeToken(adminAal2).payload.aal).toBe('aal2');
    expect(decodeToken(organiserAal1).payload.aal).toBe('aal1');
    expect((await rpc('am_i_platform_admin', {}, { token: adminAal2 })).body).toEqual({
      aal: 'aal2',
      is_admin: true,
    });
    auditRowsBefore = (await adminRows()).length;
  });

  test('ANONYMOUS (no token, or only the public key): every admin and inner function is refused before it runs', async () => {
    for (const [name, make] of Object.entries({
      am_i_platform_admin: () => ({}),
      ...ADMIN_FUNCTIONS,
      ...SERVICE_ONLY,
    })) {
      for (const token of [null, undefined]) {
        const result = await rpc(name, make(w), { token });
        refused(result, { status: 401, message: NO_FUNCTION_RIGHT });
      }
    }
  });

  test('AN ORGANISER (signed in, not an admin): admin_required for every admin function, no right at all to the inner ones', async () => {
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: organiserAal1 }), { hint: 'admin_required' });
    }
    for (const [name, make] of Object.entries(SERVICE_ONLY)) {
      refused(await rpc(name, make(w), { token: organiserAal1 }), { message: NO_FUNCTION_RIGHT });
    }
    // and asking "am I an admin" tells them only that they are not
    expect((await rpc('am_i_platform_admin', {}, { token: organiserAal1 })).body).toEqual({
      aal: 'aal1',
      is_admin: false,
    });
  });

  test('AN ORGANISER WHO ENROLS AN AUTHENTICATOR APP (aal2): still not an admin: the second factor proves nothing about who they are', async () => {
    const session = await enrolTotp((await signInPassword(w.a)).token);
    expect(decodeToken(session.token).payload.aal).toBe('aal2');
    expect((await rpc('am_i_platform_admin', {}, { token: session.token })).body).toEqual({
      aal: 'aal2',
      is_admin: false,
    });
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: session.token }), { hint: 'admin_required' });
    }
  });

  test('AN ADMIN WHO HAS NOT ANSWERED THE SECOND FACTOR (aal1): admin_mfa_required for every admin function', async () => {
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: adminAal1 }), { hint: 'admin_mfa_required' });
    }
    for (const [name, make] of Object.entries(SERVICE_ONLY)) {
      refused(await rpc(name, make(w), { token: adminAal1 }), { message: NO_FUNCTION_RIGHT });
    }
    // they may ask who they are (the console needs it to show the code box), and nothing else
    expect((await rpc('am_i_platform_admin', {}, { token: adminAal1 })).body).toEqual({
      aal: 'aal1',
      is_admin: true,
    });
  });

  test('FORGED TOKENS: editing the aal claim, signing with another secret, an unsigned token, or swapping the user are all stopped at the gateway', async () => {
    const now = Math.floor(Date.now() / 1000);
    const raised = { aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] };
    const forgeries = {
      'aal edited, signature kept': withPayload(adminAal1, raised),
      'another secret': signedWithWrongSecret(adminAal1, raised),
      'alg none': unsigned(adminAal1, raised),
      // the organiser's token with the ADMIN's identity written in
      'sub swapped, signature kept': withPayload(organiserAal1, { sub: w.admin.userId, ...raised }),
      'exp pushed out, signature kept': withPayload(adminAal1, { exp: now + 10 * 365 * 86400 }),
    };
    for (const [what, token] of Object.entries(forgeries)) {
      const result = await rpc('admin_list_orgs', {}, { token });
      expect(result.status, what).toBe(401);
      expect(result.body.code, what).toBe('PGRST301');
    }
  });

  test('THE ADMIN TABLES AND THE app SCHEMA are not reachable through the API, for anyone, including an aal2 admin', async () => {
    for (const [who, token] of [
      ['anonymous', null],
      ['organiser', organiserAal1],
      ['admin at aal2', adminAal2],
    ]) {
      for (const table of ['platform_admins', 'admin_audit_log']) {
        const read = await rest(table, { token });
        expect(read.status, `${who} GET ${table}`).toBe(404);
        expect(read.body.code).toBe('PGRST205');
        // asking for the `app` schema by name: only public and graphql_public are exposed
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
          expect(result.body.code).toBe('PGRST106');
        }
      }
      const gate = await rpc(
        'require_platform_admin',
        {},
        { token, headers: { 'content-profile': 'app' } },
      );
      expect(gate.status, `${who} app.require_platform_admin`).toBe(406);
    }
  });

  test('THE INNER SERVICE-ROLE FUNCTIONS cannot be called directly by an admin at aal2 either', async () => {
    for (const [name, make] of Object.entries(SERVICE_ONLY)) {
      refused(await rpc(name, make(w), { token: adminAal2 }), { message: NO_FUNCTION_RIGHT });
    }
  });

  test('SELF-PROMOTION: an admin cannot add, promote or make themselves an owner; an organiser cannot write membership at all', async () => {
    refused(
      await rpc(
        'admin_add_member',
        { p_org_id: w.a.orgId, p_user_id: w.admin.userId, p_role: 'owner' },
        { token: adminAal2 },
      ),
      { hint: 'admin_self_target' },
    );
    refused(
      await rpc(
        'admin_set_role',
        { p_org_id: w.a.orgId, p_user_id: w.admin.userId, p_role: 'owner' },
        { token: adminAal2 },
      ),
      { hint: 'admin_self_target' },
    );
    refused(
      await rpc(
        'admin_create_org',
        { p_name: 'Mine', p_slug: `adv-${w.tag}-s`, p_owner_user_id: w.admin.userId },
        { token: adminAal2 },
      ),
      { hint: 'admin_self_target' },
    );
    // an organiser at the tables: no privilege on org_members for the API roles
    const promote = await rest(`org_members?user_id=eq.${w.a.userId}`, {
      method: 'PATCH',
      token: organiserAal1,
      body: { role: 'owner' },
    });
    refused(promote, { message: /permission denied for table org_members/ });
    const attach = await rest('org_members', {
      method: 'POST',
      token: organiserAal1,
      body: { org_id: w.b.orgId, user_id: w.a.userId, role: 'owner' },
    });
    refused(attach, { message: /permission denied for table org_members/ });
    // and an organiser of A cannot reach B's detail through the admin function either
    refused(await rpc('admin_org_detail', { p_org_id: w.b.orgId }, { token: organiserAal1 }), {
      hint: 'admin_required',
    });
  });

  test('HOSTILE INPUTS to the admin functions: exact matching only, limits clamped, bad roles and unknown ids refused with hints', async () => {
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
    expect(
      (await rpc('admin_list_audit', { p_limit: 1000000 }, { token: adminAal2 })).body.length,
    ).toBeLessThanOrEqual(200);
    expect((await rpc('admin_list_audit', { p_limit: -5 }, { token: adminAal2 })).body.length).toBe(
      1,
    );
    const base = { p_org_id: w.a.orgId, p_user_id: w.lone.userId };
    refused(await rpc('admin_add_member', { ...base, p_role: 'superuser' }, { token: adminAal2 }), {
      status: 400,
      code: '22023',
      hint: 'member_role_invalid',
    });
    refused(
      await rpc(
        'admin_set_role',
        { ...base, p_user_id: w.a.userId, p_role: 'admin' },
        { token: adminAal2 },
      ),
      {
        status: 400,
        code: '22023',
        hint: 'member_role_invalid',
      },
    );
    refused(await rpc('admin_org_detail', { p_org_id: unknown }, { token: adminAal2 }), {
      status: 400,
      code: '22023',
      hint: 'org_not_found',
    });
    refused(
      await rpc(
        'admin_add_member',
        { ...base, p_org_id: unknown, p_role: 'organiser' },
        { token: adminAal2 },
      ),
      {
        status: 400,
        code: '22023',
        hint: 'org_not_found',
      },
    );
    refused(
      await rpc(
        'admin_add_member',
        { ...base, p_user_id: unknown, p_role: 'organiser' },
        { token: adminAal2 },
      ),
      {
        status: 400,
        code: '22023',
        hint: 'member_user_not_found',
      },
    );
    for (const [what, args] of Object.entries({
      'a name of control characters': { p_name: 'a\u0007b', p_slug: `adv-${w.tag}-n` },
      'a reserved link name': { p_name: 'Reserved', p_slug: 'admin' },
      'a link name with a slash': { p_name: 'Slash', p_slug: 'a/b/c' },
    })) {
      const result = await rpc(
        'admin_create_org',
        { ...args, p_owner_user_id: w.lone.userId },
        { token: adminAal2 },
      );
      expect(result.status, what).toBe(400);
      expect(result.body.code, what).toBe('22023');
    }
    // the last owner of an organisation cannot be demoted through the admin function either
    refused(
      await rpc(
        'admin_set_role',
        { p_org_id: w.a.orgId, p_user_id: w.a.userId, p_role: 'organiser' },
        { token: adminAal2 },
      ),
      {
        status: 400,
        code: 'P0001',
        hint: 'last_owner',
      },
    );
  });

  test('NONE OF THE REFUSED CALLS WROTE AN AUDIT ROW: the admin has no audit entries after the whole battery above', async () => {
    expect((await adminRows()).length).toBe(auditRowsBefore);
  });

  test('A STOLEN TOKEN IS DEAD AFTER "SIGN OUT EVERYWHERE": admin_session_ended, with the token itself still validly signed', async () => {
    const stolen = await elevate((await signInPassword(w.admin)).token, w.factor);
    expect((await rpc('admin_list_orgs', {}, { token: stolen })).status).toBe(200);
    expect((await signOutEverywhere(stolen)).status).toBe(204);
    for (const [name, make] of Object.entries(ADMIN_FUNCTIONS)) {
      refused(await rpc(name, make(w), { token: stolen }), { hint: 'admin_session_ended' });
    }
    // "everywhere" means every session of this admin, ours included: the tests after this one sign in again
    expect((await rpc('admin_list_orgs', {}, { token: adminAal2 })).body.hint).toBe(
      'admin_session_ended',
    );
    adminAal2 = await elevate((await signInPassword(w.admin)).token, w.factor);
    expect((await rpc('admin_list_orgs', {}, { token: adminAal2 })).status).toBe(200);
  });

  test('AN ADMIN REVOKED MID-SESSION loses the console on the very next call, aal2 or not', async () => {
    const other = await createPlatformAdmin('adv-revoked');
    const session = await enrolTotp((await signInPassword(other)).token);
    expect((await rpc('admin_list_orgs', {}, { token: session.token })).status).toBe(200);
    removePlatformAdmin(other);
    refused(await rpc('admin_list_orgs', {}, { token: session.token }), { hint: 'admin_required' });
    expect((await rpc('am_i_platform_admin', {}, { token: session.token })).body.is_admin).toBe(
      false,
    );
  });

  test('AN ACCOUNT WHOSE PASSWORD SOMEONE ELSE MAY KNOW (D-A9): refused without the attestation, the flag alone decides nothing, and the attestation is recorded', async () => {
    // already in organisation A: its owner may know the one-time password
    const member = await createLoneUser('adv-member');
    await addMember(w.a, member, 'organiser');
    const found = await rpc('admin_find_user', { p_email: member.email }, { token: adminAal2 });
    expect(found.body[0]).toMatchObject({ org_count: 1, needs_attestation: true });
    const toB = { p_org_id: w.b.orgId, p_user_id: member.userId, p_role: 'organiser' };
    refused(await rpc('admin_add_member', toB, { token: adminAal2 }), {
      status: 400,
      code: '22023',
      hint: 'member_password_unset',
    });
    // the same refusal for an explicit "false", and as the OWNER of a new organisation
    refused(
      await rpc('admin_add_member', { ...toB, p_attest_own_password: false }, { token: adminAal2 }),
      {
        status: 400,
        code: '22023',
        hint: 'member_password_unset',
      },
    );
    refused(
      await rpc(
        'admin_create_org',
        { p_name: 'Needs attest', p_slug: `adv-${w.tag}-m`, p_owner_user_id: member.userId },
        { token: adminAal2 },
      ),
      { status: 400, code: '22023', hint: 'member_password_unset' },
    );
    expect(
      (await rpc('admin_org_detail', { p_org_id: w.b.orgId }, { token: adminAal2 })).body.members,
    ).toHaveLength(1);

    // must_change_password is advisory: a fresh login carrying the flag needs no attestation...
    const flagged = await createLoneUser('adv-flagged', {
      userMetadata: { must_change_password: true },
    });
    const flaggedFound = await rpc(
      'admin_find_user',
      { p_email: flagged.email },
      { token: adminAal2 },
    );
    expect(flaggedFound.body[0]).toMatchObject({
      must_change_password: true,
      needs_attestation: false,
    });
    expect(
      (
        await rpc(
          'admin_add_member',
          { p_org_id: w.b.orgId, p_user_id: flagged.userId, p_role: 'organiser' },
          { token: adminAal2 },
        )
      ).status,
    ).toBe(204);

    // ...and the attestation lets the first one through, once, with a row that says it was given
    const attested = await rpc(
      'admin_add_member',
      { ...toB, p_attest_own_password: true },
      { token: adminAal2 },
    );
    expect(attested.status).toBe(204);
    refused(
      await rpc('admin_add_member', { ...toB, p_attest_own_password: true }, { token: adminAal2 }),
      {
        status: 409,
        code: '23505',
        hint: 'member_exists',
      },
    );
    const rows = await adminRows();
    const added = rows.filter(
      (row) => row.action === 'member.add' && row.target_org_id === w.b.orgId,
    );
    expect(added.map((row) => [row.target_user_id, row.detail.attested]).sort()).toEqual(
      [
        [flagged.userId, false],
        [member.userId, true],
      ].sort(),
    );
    // only those two successes and nothing else wrote a row
    expect(rows.length).toBe(auditRowsBefore + 2);
  });
});
