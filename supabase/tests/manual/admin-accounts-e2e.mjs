// Manual end-to-end check of the admin console's second factor and the admin-accounts Edge Function against the
// LOCAL Supabase stack: what pgTAP and the unit tests cannot prove (the real gateway, real GoTrue tokens, a real
// authenticator code). Not part of CI (it needs the Edge Runtime container and Docker). Run it by hand after changing
// the function, its migrations, config.toml's [auth.mfa] block, or anything about how the console signs in:
//
//   npm run supabase -- start                         # local stack, picks up config.toml (once, and after a config change)
//   npx supabase functions serve admin-accounts       # in another terminal; leave it running
//   node supabase/tests/manual/admin-accounts-e2e.mjs "<anon key>" "<service role key>"
//     (both keys are in `npx supabase status -o env`: ANON_KEY and SERVICE_ROLE_KEY)
//
// It makes throwaway accounts, makes one of them a platform admin by SQL through `docker exec ... psql` (there is no
// seed and no API for that, on purpose: spec D-A1), and checks:
//   A. the Edge Function: no token, a non-admin (even one with a verified second factor), an admin at aal1 (refused with
//      admin_mfa_required), an admin at aal2 with a fresh TOTP (201, one-time password, recorded, the new login signs in
//      and is flagged must_change_password), a duplicate email (409, nothing more recorded), and an audit failure (500
//      account_record_failed, the new login is removed).
//   B. THE BATCH 7 EXIT GATE: a password-only (aal1) session cannot enrol a SECOND factor once a verified one exists,
//      cannot remove the verified factor, and still gets aal2 only by passing a TOTP challenge. Each refusal must carry
//      GoTrue's insufficient_aal code: a refusal for any other reason (an earlier version passed because both factors had
//      the same empty name) proves nothing. (If it could, a stolen password would be enough to make a new factor and
//      become the admin: spec section 7, item 8.)
//   B2. removing the admin's authenticator from ANOTHER session downgrades their other sessions to aal1 in the database;
//      an old token that still claims aal2 is refused (admin_mfa_required): GoTrue does not delete those sessions.
//   C. "sign out everywhere" really ends admin access: the SAME, still unexpired access token is refused by the database
//      (admin_session_ended) and by the function once its session is gone (migration 20261014150000).
//   D. the factor cap (max_enrolled_factors = 4 in config.toml): abandoned, never-verified enrolments count against it,
//      the refusal is the cap's own error_code, and removing one stale factor makes room (spec section 5).
// It cleans up after itself except for the audit rows (the log is append-only) and the throwaway accounts' Auth
// history, which stay in the local database until the next `npm run db:reset`. The temporary trigger it uses to force
// an audit failure is dropped when the script ends or is interrupted (Ctrl-C), and is SCOPED to the throwaway admin's
// own audit rows, so even if the process is killed outright it cannot make anyone else's audited write fail.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54421';
const ANON = process.argv[2];
const SERVICE = process.argv[3];
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_seduh-score-next';
if (!ANON || !SERVICE) {
  console.error('usage: node admin-accounts-e2e.mjs <anon key> <service role key>');
  process.exit(2);
}
// The HOST must be local. (A regular expression on the whole string is fooled by http://127.0.0.1:80@evil.example/.)
let apiHost = '';
try {
  apiHost = new URL(API).hostname;
} catch {
  // falls through to the refusal below
}
if (!['127.0.0.1', 'localhost'].includes(apiHost)) {
  console.error('refusing to run against anything but a local stack:', API);
  process.exit(2);
}

const stamp = Date.now();
const PASSWORD = 'e2e-password-1';
const results = [];
function check(name, ok, detail = '') {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function sql(statement) {
  return execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-Atqc', statement],
    { encoding: 'utf8' },
  ).trim();
}

// --- a TOTP code from the secret GoTrue hands back at enrolment (RFC 6238: SHA-1, 30 s, 6 digits) ---
function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase())
    bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

async function call(path, { method = 'POST', token, key = ANON, body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

async function makeUser(label) {
  const email = `e2e-${label}-${stamp}@example.com`;
  const r = await call('/auth/v1/admin/users', {
    key: SERVICE,
    token: SERVICE,
    body: { email, password: PASSWORD, email_confirm: true },
  });
  if (r.status !== 200)
    throw new Error(`could not create ${label}: ${r.status} ${JSON.stringify(r.json)}`);
  return { id: r.json.id, email };
}
async function signIn(email, password = PASSWORD) {
  const r = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
  return { status: r.status, token: r.json?.access_token, json: r.json };
}
// A distinct friendly name every time: GoTrue refuses a second factor with the same name (even an empty one) with
// mfa_factor_name_conflict, which would make a refusal look like the assurance-level rule when it is not.
let factorCounter = 0;
const enrol = (token) =>
  call('/auth/v1/factors', {
    token,
    body: { factor_type: 'totp', friendly_name: `e2e-${stamp}-${(factorCounter += 1)}` },
  });
async function verify(token, factorId, secret) {
  const ch = await call(`/auth/v1/factors/${factorId}/challenge`, { token, body: {} });
  if (ch.status !== 200) return { status: ch.status, json: ch.json };
  return call(`/auth/v1/factors/${factorId}/verify`, {
    token,
    body: { challenge_id: ch.json.id, code: totp(secret) },
  });
}
const fn = (token, body) => call('/functions/v1/admin-accounts', { token, body });
const callRpc = (token, name) => call(`/rest/v1/rpc/${name}`, { token, body: {} });
async function deleteUser(id) {
  await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE', key: SERVICE, token: SERVICE });
}
// a trigger that makes every insert into the audit log fail: ALWAYS removed again
// (also on Ctrl-C / termination; nothing can run on SIGKILL, which is why the trigger is scoped below)
const dropBoomOnSignal = () => {
  try {
    dropBoom();
  } catch {
    // best effort
  }
  process.exit(130);
};
process.on('SIGINT', dropBoomOnSignal);
process.on('SIGTERM', dropBoomOnSignal);
const dropBoom = () => {
  sql(`drop trigger if exists zz_e2e_boom on app.admin_audit_log`);
  sql(`drop function if exists public.zz_e2e_boom()`);
};

const made = [];
try {
  const admin = await makeUser('admin');
  const other = await makeUser('nonadmin');
  const capUser = await makeUser('cap');
  made.push(admin, other, capUser);
  // the API and the database container must be the SAME stack
  if (sql(`select count(*) from auth.users where id = '${admin.id}'`) !== '1') {
    throw new Error(
      `the database container ${DB_CONTAINER} does not hold the account the API just created: wrong SUPABASE_DB_CONTAINER?`,
    );
  }
  sql(`insert into app.platform_admins (user_id, note) values ('${admin.id}', 'e2e throwaway')`);

  // ============ A. the Edge Function ============
  console.log('\n-- A. admin-accounts');
  const noToken = await fn(undefined, { action: 'create_owner', email: `x-${stamp}@example.com` });
  check('no token is refused (401)', noToken.status === 401, `status ${noToken.status}`);

  const otherSession = await signIn(other.email);
  const otherAal1 = await fn(otherSession.token, {
    action: 'create_owner',
    email: `x-${stamp}@example.com`,
  });
  check(
    'a signed-in non-admin gets 403 admin_required',
    otherAal1.status === 403 && otherAal1.json?.hint === 'admin_required',
    JSON.stringify(otherAal1.json),
  );

  const otherFactor = await enrol(otherSession.token);
  const otherAal2 =
    otherFactor.status === 200
      ? await verify(otherSession.token, otherFactor.json.id, otherFactor.json.totp.secret)
      : otherFactor;
  const otherVerified = await fn(otherAal2.json?.access_token, {
    action: 'create_owner',
    email: `x-${stamp}@example.com`,
  });
  check(
    'a non-admin who passed a TOTP challenge is still 403 admin_required',
    otherAal2.status === 200 &&
      otherVerified.status === 403 &&
      otherVerified.json?.hint === 'admin_required',
    JSON.stringify(otherVerified.json),
  );

  const adminAal1 = await signIn(admin.email);
  check('the admin starts at aal1', claims(adminAal1.token).aal === 'aal1');
  const refused = await fn(adminAal1.token, {
    action: 'create_owner',
    email: `x-${stamp}@example.com`,
  });
  check(
    'an admin at aal1 gets 403 admin_mfa_required',
    refused.status === 403 && refused.json?.hint === 'admin_mfa_required',
    JSON.stringify(refused.json),
  );
  check(
    'and no login was created for it',
    sql(`select count(*) from auth.users where email = 'x-${stamp}@example.com'`) === '0',
  );

  const adminFactor = await enrol(adminAal1.token);
  check(
    'a password-only admin with NO factor yet can enrol the first one (the first-enrolment window, spec section 7 item 8)',
    adminFactor.status === 200,
    `status ${adminFactor.status}`,
  );
  const adminAal2 = await verify(
    adminAal1.token,
    adminFactor.json.id,
    adminFactor.json.totp.secret,
  );
  const adminToken = adminAal2.json?.access_token;
  check(
    'the TOTP challenge gives aal2 with a fresh totp entry',
    adminToken &&
      claims(adminToken).aal === 'aal2' &&
      claims(adminToken).amr?.some((m) => m.method === 'totp'),
  );

  const newEmail = `new-owner-${stamp}@example.com`;
  const ok = await fn(adminToken, { action: 'create_owner', email: newEmail });
  check(
    'an admin at aal2 with a fresh TOTP gets 201 and a one-time password',
    ok.status === 201 &&
      /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/.test(ok.json?.password ?? ''),
    `status ${ok.status}`,
  );
  if (ok.json?.userId) made.push({ id: ok.json.userId, email: newEmail });
  // an id that is not a uuid never reaches SQL (a failed call would otherwise crash the script instead of reporting FAIL)
  const newId = /^[0-9a-f-]{36}$/.test(ok.json?.userId ?? '')
    ? ok.json.userId
    : '00000000-0000-0000-0000-000000000000';
  check(
    'exactly one account.create row names the admin and the new login',
    sql(
      `select count(*) from app.admin_audit_log where action = 'account.create' and actor_id = '${admin.id}' and target_user_id = '${newId}' and detail = '{}'::jsonb`,
    ) === '1',
  );
  const newSession = await signIn(newEmail, ok.json?.password);
  check('the new login signs in with the one-time password', newSession.status === 200);
  const metadata = (await call('/auth/v1/user', { method: 'GET', token: newSession.token })).json
    ?.user_metadata;
  check(
    'and is flagged must_change_password',
    metadata?.must_change_password === true,
    JSON.stringify(metadata),
  );
  check(
    'and belongs to no organisation (the console attaches it with the audited RPCs)',
    sql(`select count(*) from org_members where user_id = '${newId}'`) === '0',
  );

  const dup = await fn(adminToken, { action: 'create_owner', email: newEmail });
  check(
    'the same email again is 409 email_taken',
    dup.status === 409 && dup.json?.hint === 'email_taken',
    JSON.stringify(dup.json),
  );
  check(
    'and wrote no second account.create row',
    sql(
      `select count(*) from app.admin_audit_log where action = 'account.create' and target_user_id = '${newId}'`,
    ) === '1',
  );

  // an audit failure removes the new login: force it with a temporary trigger (local database only)
  dropBoom();
  const boomEmail = `boom-${stamp}@example.com`;
  let boom;
  try {
    sql(
      `create function public.zz_e2e_boom() returns trigger language plpgsql as $$ begin raise exception 'forced'; end $$`,
    );
    sql(
      `create trigger zz_e2e_boom before insert on app.admin_audit_log for each row when (new.actor_id = '${admin.id}') execute function public.zz_e2e_boom()`,
    );
    boom = await fn(adminToken, { action: 'create_owner', email: boomEmail });
  } finally {
    dropBoom();
  }
  check(
    'when the audit insert fails the call is 500 account_record_failed and the new login is removed again',
    boom.status === 500 &&
      boom.json?.hint === 'account_record_failed' &&
      sql(`select count(*) from auth.users where email = '${boomEmail}'`) === '0',
    JSON.stringify(boom.json),
  );

  // ============ B. the exit gate ============
  console.log('\n-- B. exit gate: a password-only session and a verified factor');
  const again = await signIn(admin.email);
  check(
    'signing in again with the password alone is aal1 (the factor is not remembered)',
    claims(again.token).aal === 'aal1',
  );
  const second = await enrol(again.token);
  check(
    'an aal1 session CANNOT enrol a second factor while a verified one exists (refused for the ASSURANCE LEVEL, not a name clash)',
    second.status >= 400 && second.json?.error_code === 'insufficient_aal',
    `status ${second.status} ${JSON.stringify(second.json)?.slice(0, 160)}`,
  );
  const unenrol = await call(`/auth/v1/factors/${adminFactor.json.id}`, {
    method: 'DELETE',
    token: again.token,
  });
  check(
    'an aal1 session cannot remove the verified factor either',
    unenrol.status >= 400 && unenrol.json?.error_code === 'insufficient_aal',
    `status ${unenrol.status} ${JSON.stringify(unenrol.json)?.slice(0, 160)}`,
  );
  check(
    'and the verified factor is still there',
    sql(
      `select count(*) from auth.mfa_factors where user_id = '${admin.id}' and status = 'verified'`,
    ) === '1',
  );
  const challenged = await verify(again.token, adminFactor.json.id, adminFactor.json.totp.secret);
  check(
    'passing the TOTP challenge on that session gives aal2',
    challenged.status === 200 && claims(challenged.json.access_token).aal === 'aal2',
  );
  const secondAtAal2 = await enrol(challenged.json.access_token);
  check(
    'an aal2 session can enrol another factor (so the console can offer a spare)',
    secondAtAal2.status === 200,
    `status ${secondAtAal2.status}`,
  );

  // ============ B2. removing the factor downgrades the user's other sessions ============
  console.log('-- B2. factor removal');
  const admin2 = await makeUser('admin2');
  made.push(admin2);
  sql(`insert into app.platform_admins (user_id, note) values ('${admin2.id}', 'e2e throwaway')`);
  const a2s1 = await signIn(admin2.email);
  const a2f = await enrol(a2s1.token);
  const a2v = await verify(a2s1.token, a2f.json.id, a2f.json.totp.secret);
  const oldToken = a2v.json?.access_token;
  const oldSession = claims(oldToken).session_id;
  check(
    'before: this admin session passes the database gate',
    (await callRpc(oldToken, 'admin_can_provision')).json === true,
  );
  const a2s2 = await signIn(admin2.email);
  const a2c = await verify(a2s2.token, a2f.json.id, a2f.json.totp.secret);
  const removed = await call(`/auth/v1/factors/${a2f.json.id}`, {
    method: 'DELETE',
    token: a2c.json?.access_token,
  });
  check(
    'the factor is removed from a second, aal2 session',
    removed.status === 200,
    `status ${removed.status}`,
  );
  check(
    'GoTrue DOWNGRADES the first session row to aal1 (it does not delete it)',
    sql(`select aal from auth.sessions where id = '${oldSession}'`) === 'aal1',
    sql(`select coalesce(aal::text, 'null') from auth.sessions where id = '${oldSession}'`),
  );
  check('while the old token still claims aal2 (unexpired)', claims(oldToken).aal === 'aal2');
  const downgraded = await callRpc(oldToken, 'admin_can_provision');
  check(
    'and the database refuses that old aal2 token with admin_mfa_required',
    downgraded.status >= 400 && downgraded.json?.hint === 'admin_mfa_required',
    JSON.stringify(downgraded.json),
  );

  // ============ C. a revoked session stops working on the next admin call ============
  console.log('\n-- C. sign out everywhere');
  const live = challenged.json.access_token;
  const before = await callRpc(live, 'admin_can_provision');
  check(
    'before: an aal2 token with a live session passes the database gate',
    before.status === 200 && before.json === true,
    JSON.stringify(before.json),
  );
  check('and the token carries a session_id', typeof claims(live).session_id === 'string');
  const out = await call('/auth/v1/logout?scope=global', { token: live });
  check(
    'signing out everywhere succeeds',
    out.status === 204 || out.status === 200,
    `status ${out.status}`,
  );
  const afterGate = await callRpc(live, 'admin_can_provision');
  check(
    'after: the SAME token (still unexpired) is refused by the database with admin_session_ended',
    afterGate.status >= 400 && afterGate.json?.hint === 'admin_session_ended',
    JSON.stringify(afterGate.json),
  );
  const afterRead = await callRpc(live, 'admin_list_orgs');
  check(
    'and a read RPC refuses it too',
    afterRead.status >= 400 && afterRead.json?.hint === 'admin_session_ended',
    JSON.stringify(afterRead.json),
  );
  const afterFn = await fn(live, { action: 'create_owner', email: `after-${stamp}@example.com` });
  check(
    'and so does the Edge Function (401), creating nothing',
    afterFn.status === 401 &&
      sql(`select count(*) from auth.users where email = 'after-${stamp}@example.com'`) === '0',
    JSON.stringify(afterFn.json),
  );

  // ============ D. the factor cap ============
  console.log('\n-- D. factor cap (abandoned enrolments count)');
  const capSession = await signIn(capUser.email);
  const capFactors = [];
  let firstRefusal = null;
  for (let i = 0; i < 8; i += 1) {
    const r = await enrol(capSession.token);
    if (r.status === 200) capFactors.push(r.json.id);
    else {
      firstRefusal = r;
      break;
    }
  }
  check(
    'never-verified enrolments are refused beyond max_enrolled_factors (4), with the cap itself as the reason',
    capFactors.length === 4 && firstRefusal?.json?.error_code === 'too_many_enrolled_mfa_factors',
    `${capFactors.length} enrolled; then ${JSON.stringify(firstRefusal?.json)?.slice(0, 140)}`,
  );
  const clear = await call(`/auth/v1/factors/${capFactors[0]}`, {
    method: 'DELETE',
    token: capSession.token,
  });
  const enrolAgain = await enrol(capSession.token);
  check(
    'and removing one stale unverified factor makes room again (what the console does before enrolling)',
    clear.status === 200 && enrolAgain.status === 200,
    `delete ${clear.status}, enrol ${enrolAgain.status}`,
  );
} finally {
  try {
    dropBoom();
  } catch {
    // best effort
  }
  try {
    sql(`delete from app.platform_admins where note = 'e2e throwaway'`);
  } catch {
    // best effort
  }
  for (const u of made) await deleteUser(u.id).catch(() => {});
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
