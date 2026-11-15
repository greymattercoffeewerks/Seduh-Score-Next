// seduh-claim: step one of claiming a Seduh ID for a person who has NO login yet (T-ID2.B3a).
//
// The person opens the claim link an organiser sent them (it carries a one-time token) and types an email. This function:
//   (1) checks the TOKEN with the database FIRST (public.seduh_claim_begin, service role only): a token that is unknown,
//       used, revoked or expired, or whose identity can no longer be claimed, gets an answer and NO email is sent, so this
//       endpoint cannot be used to mail strangers or to burn the project's hourly email limit; each link may have six codes
//       emailed at most (counted by the same call);
//   (2) finds or creates the login for that email with the service role (the person has none yet; public email signup stays
//       OFF, so Auth's own signInWithOtp is told shouldCreateUser: false and could not create one);
//   (3) asks Auth to email a 6-digit one-time code.
// The page then verifies the code in the browser (supabase-js verifyOtp, type 'email') and, signed in, calls
// public.claim_seduh_id(token, handle, adult). Nothing here proves WHO the person is beyond "holds the link and reads that
// mailbox": the link is the bearer secret (single use, 72 hours, issued by an organiser who has the person on their roster).
//
// Contract (POST, JSON body, anyone holding the project's anon key; the gateway verifies the JWT):
//   { token, email } -> 200 { ok: true, display_name }       a code was emailed
// Errors are { error, hint } with:
//   400 bad_request | bad_email
//   404 link_invalid (also for a token that cannot be one)   410 link_used | link_revoked | link_expired | identity_unavailable
//   405 not POST         429 too_many_codes (six per link) | email_rate_limited (Auth's own limit)
//   500 server_error     502 email_send_failed
// The response is the same whether or not the email already had a login. Logging: ids never; codes only, never the token, the
// email or an Auth error message (the tests assert that).
//
// Plain ES module with injected dependencies (index.ts wires the real Supabase clients), so vitest drives every branch.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REFUSALS = {
  invalid: [404, 'This claim link is not valid.', 'link_invalid'],
  used: [410, 'This claim link has already been used.', 'link_used'],
  revoked: [410, 'This claim link was cancelled.', 'link_revoked'],
  expired: [410, 'This claim link has expired. Ask the organiser for a new one.', 'link_expired'],
  unavailable: [410, 'This Seduh ID cannot be claimed.', 'identity_unavailable'],
  too_many: [
    429,
    'Too many codes were requested for this link. Try again later or ask for a new link.',
    'too_many_codes',
  ],
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (text.length > 2048) return null;
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const codeOf = (error) =>
  typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(error.code) ? error.code : null;

function isEmailTaken(error) {
  return (
    error?.code === 'email_exists' ||
    error?.code === 'user_already_exists' ||
    /already (been )?registered/i.test(error?.message ?? '')
  );
}

function isRateLimited(error) {
  return (
    error?.status === 429 ||
    error?.code === 'over_email_send_rate_limit' ||
    error?.code === 'over_request_rate_limit'
  );
}

const SERVER_ERROR = { error: 'Something went wrong. Try again.', hint: 'server_error' };

export async function handleRequest(request, deps) {
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });

  const body = await readBody(request);
  if (!body) return json(400, { error: 'The request was not understood.', hint: 'bad_request' });

  const token = typeof body.token === 'string' ? body.token : '';
  if (!TOKEN_RE.test(token)) {
    return json(404, { error: REFUSALS.invalid[1], hint: 'link_invalid' });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { error: 'Enter a valid email address.', hint: 'bad_email' });
  }

  const admin = deps.createAdminClient();

  // (1) the token, with the database
  let begin;
  try {
    const { data, error } = await admin.rpc('seduh_claim_begin', { p_token: token });
    if (error) {
      log('error', 'seduh_claim_begin_failed', { code: codeOf(error) });
      return json(500, SERVER_ERROR);
    }
    begin = data;
  } catch {
    log('error', 'seduh_claim_begin_failed', { code: 'threw' });
    return json(500, SERVER_ERROR);
  }
  const status = begin?.status;
  if (status !== 'ok') {
    const refusal = REFUSALS[status];
    if (!refusal) {
      log('error', 'seduh_claim_begin_unexpected', { code: 'unknown_status' });
      return json(500, SERVER_ERROR);
    }
    log('info', 'seduh_claim_refused', { hint: refusal[2] });
    return json(refusal[0], { error: refusal[1], hint: refusal[2] });
  }

  // (2) the login: found, or created without a password (the person signs in by emailed code only)
  try {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error && !isEmailTaken(error)) {
      log('error', 'seduh_claim_create_user_failed', { code: codeOf(error) });
      return json(500, SERVER_ERROR);
    }
  } catch {
    log('error', 'seduh_claim_create_user_failed', { code: 'threw' });
    return json(500, SERVER_ERROR);
  }

  // (3) the emailed code. An anon-key client with shouldCreateUser false: it can only email an existing login.
  try {
    const otp = deps.createOtpClient();
    const { error } = await otp.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) {
      if (isRateLimited(error)) {
        log('info', 'seduh_claim_email_rate_limited', { code: codeOf(error) });
        return json(429, {
          error: 'Too many emails were sent just now. Wait a minute and try again.',
          hint: 'email_rate_limited',
        });
      }
      log('error', 'seduh_claim_email_failed', { code: codeOf(error) });
      return json(502, {
        error: 'We could not send the email. Try again.',
        hint: 'email_send_failed',
      });
    }
  } catch {
    log('error', 'seduh_claim_email_failed', { code: 'threw' });
    return json(502, {
      error: 'We could not send the email. Try again.',
      hint: 'email_send_failed',
    });
  }

  log('info', 'seduh_claim_code_sent', {});
  return json(200, { ok: true, display_name: begin.display_name ?? null });
}
