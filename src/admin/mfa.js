// Second-factor steps for the admin console (spec section 5): enrol an authenticator app (TOTP), and answer
// a challenge. Pure of any DOM; the screens in mfaScreens.js draw the results.
//
// Enrolling first removes UNVERIFIED factors left behind by an abandoned attempt: they count against
// `max_enrolled_factors` (4, supabase/config.toml) and each one is a QR code nobody is using. This only ever
// runs when the login has NO verified factor (the gate sends a login that has one to the challenge instead),
// because with a verified factor present an aal1 session may not unenrol anything (GoTrue `insufficient_aal`),
// and nothing here should try.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

export const CODE_PROMPT = 'Enter the 6-digit code from your authenticator app.';
export const BAD_CODE_MESSAGE =
  'That code did not work. Check the code in your app and try again. Codes change every 30 seconds.';
const EXPIRED_MESSAGE = 'That code expired. Wait for a new one in your app and try again.';
export const RATE_LIMIT_MESSAGE = 'Too many attempts. Wait a minute, then try again.';
const TOO_MANY_FACTORS_MESSAGE =
  'This login already has too many authenticator setups. Remove the old ones in the Supabase dashboard, then try again.';
const SLOW = 'This is taking longer than expected. Check your connection and try again.';
const FAILED = 'Something went wrong. Nothing was changed. Try again.';

export function normaliseCode(raw) {
  return String(raw ?? '').replace(/[\s-]/g, '');
}

// Null when the code could be one; a message when it cannot (so no request is spent on it).
export function validateCode(raw) {
  return /^\d{6}$/.test(normaliseCode(raw)) ? null : CODE_PROMPT;
}

// `error.code` is GoTrue's stable machine code; the message is only a fallback for older servers.
export function describeMfaError(error) {
  if (error?.timedOut) return SLOW;
  const code = error?.code;
  if (
    code === 'mfa_verification_failed' ||
    /invalid .*code|invalid totp/i.test(error?.message ?? '')
  ) {
    return BAD_CODE_MESSAGE;
  }
  if (code === 'mfa_challenge_expired') return EXPIRED_MESSAGE;
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return RATE_LIMIT_MESSAGE;
  }
  if (code === 'too_many_enrolled_mfa_factors') return TOO_MANY_FACTORS_MESSAGE;
  return FAILED;
}

// Returns { ok: true, factorId, qrCode, secret } or { ok: false, message }.
export async function beginEnrol(client, { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  try {
    const { data: listed, error: listError } = await raceTimeout(
      client.auth.mfa.listFactors(),
      timeoutMs,
    );
    if (listError) throw listError;
    // Enrolling is only for a login with NO verified factor. The gate sends everyone else to the challenge; this
    // stops a second path from ever clearing or adding factors beside one that already works.
    if ((listed?.totp ?? []).length > 0) throw new Error('a verified factor already exists');
    const stale = (listed?.all ?? []).filter(
      (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
    );
    for (const factor of stale) {
      const { error } = await raceTimeout(
        client.auth.mfa.unenroll({ factorId: factor.id }),
        timeoutMs,
      );
      if (error) throw error;
    }
    const { data, error } = await raceTimeout(
      client.auth.mfa.enroll({
        factorType: 'totp',
        // GoTrue refuses a repeated friendly name, so each attempt gets its own.
        friendlyName: `Authenticator ${Date.now().toString(36)}`,
        issuer: 'Seduh Score Admin',
      }),
      timeoutMs,
    );
    if (error) throw error;
    // What the screen is about to draw must be what GoTrue documents: an SVG data URI and a base32 key.
    if (
      typeof data?.totp?.qr_code !== 'string' ||
      !data.totp.qr_code.startsWith('data:image/svg+xml')
    ) {
      throw new Error('unexpected QR code');
    }
    if (typeof data.totp.secret !== 'string' || !/^[A-Z2-7]+=*$/.test(data.totp.secret)) {
      throw new Error('unexpected secret');
    }
    return {
      ok: true,
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    };
  } catch (error) {
    return { ok: false, message: describeMfaError(error) };
  }
}

// Challenges the factor and verifies the code in one step; on success the client holds an aal2 session.
// Returns { ok: true } or { ok: false, message }.
export async function verifyCode(
  client,
  factorId,
  rawCode,
  { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {},
) {
  const invalid = validateCode(rawCode);
  if (invalid) return { ok: false, message: invalid };
  try {
    const { error } = await raceTimeout(
      client.auth.mfa.challengeAndVerify({ factorId, code: normaliseCode(rawCode) }),
      timeoutMs,
    );
    if (error) return { ok: false, message: describeMfaError(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describeMfaError(error) };
  }
}
