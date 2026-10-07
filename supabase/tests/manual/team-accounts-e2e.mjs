// Manual end-to-end check of the team-accounts Edge Function against the LOCAL Supabase stack — what
// pgTAP and the unit tests cannot prove: the real function, the real gateway, real Auth sign-ins.
// Not part of CI (it needs the Edge Runtime container). Run it by hand after changing the function,
// its migration or the Team / choose-a-password screens:
//
//   npm run supabase -- start            # local stack (once)
//   npx supabase functions serve team-accounts      # in another terminal; leave it running
//   node supabase/tests/manual/team-accounts-e2e.mjs "$(npx supabase status -o env | grep ^ANON_KEY= | cut -d'"' -f2)"
//
// It uses the project's own seed owner (organiser@local.test / local-dev-password, localhost only),
// adds a throwaway member, exercises add / duplicate / sign-in / non-owner refusals / the member
// choosing their own password / list / reset / remove, and checks a removed member reads nothing at
// once. The throwaway member's login (never its org membership) stays in the local Auth schema until
// the next `npm run db:reset`.
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54421';
const KEY = process.argv[2];
const ORG = '10c8c375-afe6-41c7-a54e-ffaa15429612';
const EMAIL = `team-e2e-${Date.now()}@example.com`;

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function signIn(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, body: await r.json() };
}
async function fn(token, body) {
  const r = await fetch(`${API}/functions/v1/team-accounts`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    // no body
  }
  return { status: r.status, json };
}
async function rpc(token, name, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function readEvents(token) {
  const r = await fetch(`${API}/rest/v1/events?select=id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  });
  return r.json();
}

const owner = await signIn('organiser@local.test', 'local-dev-password');
check('seed owner signs in', owner.status === 200);
const ownerToken = owner.body.access_token;

check(
  'owner is an owner of the org',
  (await rpc(ownerToken, 'team_can_manage', { p_org_id: ORG })).json === true,
);

// unauthenticated / garbage
const noAuth = await fn(null, { action: 'add', orgId: ORG, email: EMAIL });
check('no token is refused', noAuth.status === 401, String(noAuth.status));

// add
const added = await fn(ownerToken, { action: 'add', orgId: ORG, email: EMAIL.toUpperCase() });
check(
  'owner adds a member (201)',
  added.status === 201,
  JSON.stringify({ ...added.json, password: '<hidden>' }),
);
check(
  'one-time password has the expected shape',
  /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/.test(added.json?.password ?? ''),
);
check('email stored lower-case', added.json?.email === EMAIL.toLowerCase());
const temp = added.json.password;

// duplicate
const dup = await fn(ownerToken, { action: 'add', orgId: ORG, email: EMAIL });
check('adding the same email again is a 409', dup.status === 409, String(dup.json?.error));
const dupOwner = await fn(ownerToken, { action: 'add', orgId: ORG, email: 'organiser@local.test' });
check(
  "adding an existing account's email (the owner's) is a 409, not a takeover",
  dupOwner.status === 409,
);

// the new member signs in with the one-time password
const first = await signIn(EMAIL, temp);
check('new member signs in with the one-time password', first.status === 200);
check(
  'and is flagged must_change_password',
  first.body.user?.user_metadata?.must_change_password === true,
);
const memberToken = first.body.access_token;

// non-owner cannot manage
const asMember = await fn(memberToken, { action: 'add', orgId: ORG, email: `x-${EMAIL}` });
check('a non-owner cannot add (403)', asMember.status === 403, String(asMember.json?.error));
const memberResetsOwner = await fn(memberToken, {
  action: 'reset',
  orgId: ORG,
  userId: owner.body.user.id,
});
check('a non-owner cannot reset the owner (403)', memberResetsOwner.status === 403);
const ownerResetsOwner = await fn(ownerToken, {
  action: 'reset',
  orgId: ORG,
  userId: owner.body.user.id,
});
check(
  'the owner cannot reset an owner (themselves) through this path (403)',
  ownerResetsOwner.status === 403,
);
check(
  'a non-owner cannot list the team',
  (await rpc(memberToken, 'team_list_members', { p_org_id: ORG })).status !== 200,
);

// the member can use the org (RLS)
check("the member reads the org's events", Array.isArray(await readEvents(memberToken)));

// the member chooses their own password
const upd = await fetch(`${API}/auth/v1/user`, {
  method: 'PUT',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${memberToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ password: 'my-own-password-1', data: { must_change_password: false } }),
});
check('member sets their own password and clears the flag', upd.status === 200, String(upd.status));
check('the one-time password no longer works', (await signIn(EMAIL, temp)).status === 400);
const second = await signIn(EMAIL, 'my-own-password-1');
check(
  'their own password works, flag cleared',
  second.status === 200 && second.body.user?.user_metadata?.must_change_password === false,
);

// list
const list = await rpc(ownerToken, 'team_list_members', { p_org_id: ORG });
const row = (list.json ?? []).find((r) => r.email === EMAIL.toLowerCase());
check(
  'owner lists the team, new member present as organiser',
  list.status === 200 && row?.role === 'organiser',
  JSON.stringify(row),
);

// reset
const reset = await fn(ownerToken, { action: 'reset', orgId: ORG, userId: added.json.userId });
check('owner resets the member (200)', reset.status === 200);
check(
  'their own password stops working',
  (await signIn(EMAIL, 'my-own-password-1')).status === 400,
);
const afterReset = await signIn(EMAIL, reset.json.password);
check(
  'the new one-time password works and re-flags the account',
  afterReset.status === 200 && afterReset.body.user?.user_metadata?.must_change_password === true,
);

// remove
const removed = await rpc(ownerToken, 'team_remove_member', {
  p_org_id: ORG,
  p_user_id: added.json.userId,
});
check(
  'owner removes the member',
  removed.status === 204 || removed.status === 200,
  String(removed.status),
);
const eventsAfter = await readEvents(afterReset.body.access_token);
check(
  'a removed member reads zero events at once, with their old token',
  Array.isArray(eventsAfter) && eventsAfter.length === 0,
  JSON.stringify(eventsAfter).slice(0, 80),
);
const selfRemove = await rpc(ownerToken, 'team_remove_member', {
  p_org_id: ORG,
  p_user_id: owner.body.user.id,
});
check('the owner cannot remove themselves', selfRemove.status !== 204 && selfRemove.status !== 200);

// preflight
const pre = await fetch(`${API}/functions/v1/team-accounts`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://www.seduhscore.com', 'Access-Control-Request-Method': 'POST' },
});
// The local gateway answers the preflight itself (200); the function answers 204 where it is reached.
check(
  'CORS preflight is answered with allow-origin',
  (pre.status === 200 || pre.status === 204) &&
    pre.headers.get('access-control-allow-origin') === '*',
  String(pre.status),
);

console.log(results.every(Boolean) ? '\nALL PASS' : '\nSOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
