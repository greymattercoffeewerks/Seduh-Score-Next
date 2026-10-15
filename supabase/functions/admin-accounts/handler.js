// admin-accounts — the one place the admin console can create a brand-new owner login.
//
// Why an Edge Function: only the Auth admin API (service role) can create a login, and the browser must never
// hold that key. WHO may do this is decided in SQL (migrations 20261014100000 and 20261014150000:
// app.require_platform_admin, reached through public.admin_can_provision); the audit row is written by
// public.admin_record_account_create (migration 20261014140000, service role only). This file only checks the caller
// with the database, then talks to Auth, then asks the database to record it. Spec:
// Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A3, D-A12, section 4.
//
// Plain ES module with injected dependencies (index.ts wires the real Supabase clients), so vitest can drive
// every branch without Deno or a network.
//
// Contract (POST, JSON body, the caller's session JWT in Authorization):
//   { action: 'create_owner', email } -> 201 { userId, email, password }
// `password` is a one-time password, returned exactly once, never logged and never stored by us; the account is
// flagged must_change_password so the person must choose their own at first sign-in. The console then attaches
// the new login to an organisation with the audited admin_create_org / admin_add_member RPCs (the account has no
// membership and no removal marker, so no attestation is needed).
// Errors are { error: <message for the admin>, hint?: <stable code>, userId?: <the stranded login> } with:
//   400 request not understood / unknown action / bad email (only ever sent to a verified platform admin)
//   401 no token, a token Auth does not accept, or a session that has ended (hint admin_session_ended)
//   403 not a platform admin (hint admin_required) or no fresh second factor (hint admin_mfa_required)
//   405 not POST
//   409 that email already has an account (hint email_taken)
//   500 anything else, never with the underlying error text:
//         hint account_state_unknown  the call to Auth did not answer or answered without an account: the login MAY exist;
//                                     look the email up before retrying (a retry gives 409 if it does);
//         hint account_record_failed  the login was made, could not be recorded, and was removed again;
//         hint account_stranded       it could not be recorded AND could not be removed: `userId` names the
//                                     login, which nobody can sign in to (its password was never shown), and the
//                                     platform operator must remove it; the same email is refused (409) meanwhile.
//
// Order, and why: (1) the bearer token is required; (2) Auth says who the caller is (getUser, not a decode of the
// token); (3) the DATABASE decides, with the caller's own JWT, through admin_can_provision(): admin, aal2, a TOTP
// verification in the last hour, a live session, all in the same code path as every other admin call; (4) ONLY THEN
// is the request body read and validated (a caller who is not an admin never gets a validation answer, and the
// body of an unauthenticated request is never parsed); (5) the service-role client is created; (6) the login is
// created; (7) the database records it; (8) if recording fails the login is deleted again (it is brand new,
// nothing references it).
//
// Logging: deps.log(level, event, fields) is optional and receives ids and codes only, never the password, the
// email, the token or an error message from Auth or the database. The tests assert that.

const CORS_HEADERS = {
  // No cookies are involved — the caller's bearer token is the only credential — so any origin may ask; the
  // platform-admin check below is what decides. (Also covers local development and the workers.dev host.)
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Deliberately loose: a real check is the Auth server's. This only stops obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Copied from ../team-accounts/handler.js, not imported: the functions here are deployed one at a time through the
// MCP, which cannot resolve a sibling import. handler.test.js asserts both give the same password for the same bytes,
// so they cannot drift apart unnoticed.
//
// 31 symbols: lowercase letters and digits with the look-alikes (i, l, o, 0, 1) left out, so a password read off a
// screen and typed on an iPad survives.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// 12 random symbols in three groups of four, e.g. "k7mx-p3qa-9wdn" (~59 bits). Rejection sampling keeps every
// symbol equally likely (a plain `byte % 31` would favour the first few).
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

// An Auth "that email is taken" failure. Modern GoTrue sends a code; the message fallback is for older ones
// ("User already registered", "A user with this email address has already been registered") and deliberately does
// NOT match a bare "already exists", which any unrelated database error can say.
function isEmailTaken(error) {
  return (
    error?.code === 'email_exists' ||
    error?.code === 'user_already_exists' ||
    /already (been )?registered/i.test(error?.message ?? '')
  );
}

// A code is logged only if it looks like one (letters, digits, underscore): an error whose "code" carried text
// would otherwise put that text in the log.
const codeOf = (error) =>
  typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(error.code) ? error.code : null;

// A database hint (account_not_new, already_recorded, ...) is a short snake_case word: logged so the operator can tell
// the refusals of the audit writer apart, and dropped if it is anything else.
const hintOf = (error) =>
  typeof error?.hint === 'string' && /^[a-z_]{1,40}$/.test(error.hint) ? error.hint : null;

export async function handleRequest(request, deps) {
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });

  const credentials = bearerToken(request);
  if (!credentials) return json(401, { error: 'Sign in first.' });

  // Who is asking: the Auth server's answer for this token, not a decode of it.
  const userClient = deps.createUserClient(credentials.header);
  let caller;
  let callerError;
  try {
    ({ data: caller, error: callerError } = await userClient.auth.getUser(credentials.token));
  } catch {
    log('error', 'admin_accounts_check_failed', { actorId: null, code: 'threw' });
    return json(500, { error: 'Something went wrong. Nothing was changed. Try again.' });
  }
  if (callerError || !caller?.user?.id) return json(401, { error: 'Sign in again.' });
  const actorId = caller.user.id;

  // May they: the database decides, as the caller (their JWT carries aal, amr and session_id).
  let allowed;
  let allowedError;
  try {
    ({ data: allowed, error: allowedError } = await userClient.rpc('admin_can_provision'));
  } catch {
    log('error', 'admin_accounts_check_failed', { actorId, code: 'threw' });
    return json(500, { error: 'Something went wrong. Nothing was changed. Try again.' });
  }
  if (allowedError) {
    if (allowedError.hint === 'admin_session_ended') {
      log('info', 'admin_accounts_refused', { actorId, hint: 'admin_session_ended' });
      return json(401, { error: 'Sign in again.', hint: 'admin_session_ended' });
    }
    if (allowedError.hint === 'admin_mfa_required') {
      log('info', 'admin_accounts_refused', { actorId, hint: 'admin_mfa_required' });
      return json(403, {
        error: 'Verify with your authenticator app to continue.',
        hint: 'admin_mfa_required',
      });
    }
    if (allowedError.hint === 'admin_required') {
      log('info', 'admin_accounts_refused', { actorId, hint: 'admin_required' });
      return json(403, {
        error: 'This account does not have access to the admin console.',
        hint: 'admin_required',
      });
    }
    log('error', 'admin_accounts_check_failed', { actorId, code: codeOf(allowedError) });
    return json(500, { error: 'Something went wrong. Nothing was changed. Try again.' });
  }
  if (allowed !== true) {
    log('info', 'admin_accounts_refused', { actorId, hint: 'admin_required' });
    return json(403, {
      error: 'This account does not have access to the admin console.',
      hint: 'admin_required',
    });
  }

  // From here on the caller is a verified platform admin, so the request itself may be read.
  const body = await readBody(request);
  if (!body) return json(400, { error: 'The request was not understood.' });
  if (body.action !== 'create_owner') return json(400, { error: 'Unknown action.' });

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { error: 'Enter a valid email address.' });
  }

  // Only now does the service-role key come out.
  const admin = deps.createAdminClient();
  const password = generatePassword(deps.randomBytes);

  let created;
  let createError;
  try {
    ({ data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    }));
  } catch {
    // the call may have reached Auth and committed before the connection failed: the outcome is UNKNOWN
    log('error', 'admin_accounts_create_unknown', { actorId });
    return json(500, {
      error:
        'We could not confirm whether the login was created. Look the email up before trying again.',
      hint: 'account_state_unknown',
    });
  }
  if (createError) {
    if (isEmailTaken(createError)) {
      log('info', 'admin_accounts_email_taken', { actorId });
      return json(409, {
        error: 'That email already has an account. Choose "Use an existing account" instead.',
        hint: 'email_taken',
      });
    }
    log('error', 'admin_accounts_create_failed', { actorId, code: codeOf(createError) });
    return json(500, { error: 'Could not create that account. Nothing was changed. Try again.' });
  }

  const newUserId = created?.user?.id;
  if (!newUserId) {
    // Auth said it succeeded but named no account: it may exist
    log('error', 'admin_accounts_no_user_id', { actorId });
    return json(500, {
      error:
        'We could not confirm whether the login was created. Look the email up before trying again.',
      hint: 'account_state_unknown',
    });
  }

  // The database records it. If that fails (it answers with an error, or the call itself throws) the login is
  // removed again: it is brand new, so nothing references it.
  let recordCode = null;
  let recordHint = null;
  try {
    const { error } = await admin.rpc('admin_record_account_create', {
      p_actor_id: actorId,
      p_user_id: newUserId,
    });
    if (error) {
      recordCode = codeOf(error) ?? 'unknown';
      recordHint = hintOf(error);
    }
  } catch (thrown) {
    recordCode = codeOf(thrown) ?? 'threw';
  }
  if (recordCode !== null) {
    log('error', 'admin_accounts_audit_failed', {
      actorId,
      userId: newUserId,
      code: recordCode,
      hint: recordHint,
    });
    let removed = false;
    let removeCode = null;
    try {
      const { error } = await admin.auth.admin.deleteUser(newUserId);
      removed = !error;
      removeCode = codeOf(error);
    } catch (thrown) {
      removeCode = codeOf(thrown) ?? 'threw';
    }
    if (!removed) {
      log('error', 'admin_accounts_cleanup_failed', {
        actorId,
        userId: newUserId,
        code: removeCode,
      });
      return json(500, {
        error:
          'The login was created but could not be recorded or removed. Ask the platform operator to remove it.',
        hint: 'account_stranded',
        userId: newUserId,
      });
    }
    return json(500, {
      error: 'The login could not be recorded, so it was removed. Try again.',
      hint: 'account_record_failed',
    });
  }

  log('info', 'admin_accounts_created', { actorId, userId: newUserId });
  return json(201, { userId: newUserId, email, password });
}
