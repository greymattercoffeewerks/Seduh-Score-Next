// team-accounts — the one place an owner can create or reset a team member's login.
//
// Why an Edge Function: only the Auth admin API (service role) can create a login or set another
// person's password; the browser must never hold that key. Everything about WHO may do this, and the
// membership row itself, lives in SQL (migration 20261007120000_team_accounts.sql) where it is
// tested — this file only checks the caller with the database, then talks to Auth.
//
// Plain ES module with injected dependencies (index.ts wires the real Supabase clients), so vitest
// can drive every branch without Deno or a network.
//
// Contract (POST, JSON body, caller's session JWT in Authorization):
//   { action: 'add',   orgId, email }    -> 201 { userId, email, password }
//   { action: 'reset', orgId, userId }   -> 200 { userId, password }
// `password` is a one-time password, returned exactly once, never logged and never stored by us; the
// account is flagged must_change_password so the person has to choose their own at first sign-in.
// Errors are { error: <message for the owner> } with 400 / 401 / 403 / 405 / 409 / 500.

const CORS_HEADERS = {
  // No cookies are involved — the caller's bearer token is the only credential — so any origin may
  // ask; the owner check below is what decides. (Also covers local dev and the workers.dev host.)
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately loose: a real check is the Auth server's. This only stops obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 31 symbols: lowercase letters and digits with the look-alikes (i, l, o, 0, 1) left out, so a
// password read off a screen and typed on an iPad survives.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// 12 random symbols in three groups of four, e.g. "k7mx-p3qa-9wdn" (~59 bits). Rejection sampling
// keeps every symbol equally likely (a plain `byte % 31` would favour the first few).
export function generatePassword(randomBytes) {
  const limit = 256 - (256 % ALPHABET.length);
  const symbols = [];
  while (symbols.length < 12) {
    for (const byte of randomBytes(24)) {
      if (byte < limit && symbols.length < 12) symbols.push(ALPHABET[byte % ALPHABET.length]);
    }
  }
  const text = symbols.join('');
  return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}`;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? { header, token: match[1] } : null;
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

// An Auth "that email is taken" failure, whichever way this version words it.
function isEmailTaken(error) {
  return (
    error?.code === 'email_exists' ||
    error?.code === 'user_already_exists' ||
    /already (been )?registered|already exists/i.test(error?.message ?? '')
  );
}

export async function handleRequest(request, deps) {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });

  const credentials = bearerToken(request);
  if (!credentials) return json(401, { error: 'Sign in first.' });

  const body = await readBody(request);
  if (!body) return json(400, { error: 'The request was not understood.' });
  const { action, orgId } = body;
  if (action !== 'add' && action !== 'reset') return json(400, { error: 'Unknown action.' });
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
    return json(400, { error: 'The request was not understood.' });
  }

  let email = null;
  let userId = null;
  if (action === 'add') {
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return json(400, { error: 'Enter a valid email address.' });
    }
  } else {
    userId = body.userId;
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return json(400, { error: 'The request was not understood.' });
    }
  }

  // Who is asking: the Auth server's answer for this token, not a decode of it.
  const userClient = deps.createUserClient(credentials.header);
  const { data: caller, error: callerError } = await userClient.auth.getUser(credentials.token);
  if (callerError || !caller?.user) return json(401, { error: 'Sign in again.' });

  // May they: the database decides (owner of THIS org; for a reset, the target is a non-owner member).
  const { data: allowed, error: allowedError } = await userClient.rpc('team_can_manage', {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (allowedError) return json(500, { error: 'Something went wrong. Try again.' });
  if (allowed !== true) return json(403, { error: 'Only the owner can manage the team.' });

  const admin = deps.createAdminClient();
  const password = generatePassword(deps.randomBytes);

  if (action === 'reset') {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { must_change_password: true },
    });
    if (error) return json(500, { error: 'Could not reset that password. Try again.' });
    return json(200, { userId, password });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });
  if (createError) {
    if (isEmailTaken(createError)) {
      return json(409, {
        error:
          'That email already has an account, so it cannot be added here. Use a different address.',
      });
    }
    return json(500, { error: 'Could not create that account. Try again.' });
  }

  const newUserId = created?.user?.id;
  const { error: addError } = newUserId
    ? await admin.rpc('team_add_member', { p_org_id: orgId, p_user_id: newUserId })
    : { error: new Error('no user id') };
  if (addError) {
    // The account exists but is on no team. It is brand new (nothing references it), so remove it
    // rather than leave a login that belongs to nobody.
    if (newUserId) await admin.auth.admin.deleteUser(newUserId);
    return json(500, { error: 'Could not add that person to the team. Try again.' });
  }

  return json(201, { userId: newUserId, email, password });
}
