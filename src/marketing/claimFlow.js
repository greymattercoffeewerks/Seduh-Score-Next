// The claim page's pure half (T-ID2.B3b): reading the token, checking what a person typed, and turning every refusal the
// database or the `seduh-claim` function can give into plain words. No DOM, no network, no clock: unit-tested directly.
//
// Every refusal reaches the page as a stable snake_case HINT (CONVENTIONS.md "Seduh ID claim"); the page translates the hint
// and never shows the server's own text. An unknown hint gets the generic sentence, never a raw message.

// The token is 43 URL-safe characters (256 bits). It arrives after the `#`, so it is in no server log.
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Pure. The token from a URL fragment ("#abc..." or "abc..."), or null when it cannot be one. */
export function readClaimToken(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  return TOKEN_SHAPE.test(raw) ? raw : null;
}

export const HANDLE_SHAPE = /^[a-z0-9](-?[a-z0-9])*$/;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/** Pure. How the database reads a handle: trimmed and lower-cased. */
export function normaliseHandle(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/** Pure. True when a (normalised) handle has the right shape. Reserved and taken words are the database's to say. */
export function isHandleShape(handle) {
  return HANDLE_SHAPE.test(handle) && handle.length >= HANDLE_MIN && handle.length <= HANDLE_MAX;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pure. The email as it will be sent (trimmed, lower-cased), or null when it is not an email. */
export function normaliseEmail(raw) {
  const email = String(raw ?? '')
    .trim()
    .toLowerCase();
  return email.length > 0 && email.length <= 254 && EMAIL_SHAPE.test(email) ? email : null;
}

/** Pure. The six digits of a code as typed or pasted (spaces and dashes allowed), or null. */
export function normaliseCode(raw) {
  const digits = String(raw ?? '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Pure. "#0042": the founding number as it is written on the person's page. */
export function formatFoundingNumber(n) {
  return Number.isInteger(n) && n >= 1 ? `#${String(n).padStart(4, '0')}` : null;
}

// What the handle check says, in words. `available` is the only one that is good news.
export const HANDLE_CHECK_TEXT = {
  available: 'Available.',
  taken: 'Already taken. Choose another.',
  // one neutral line for every kind of block (system word, impersonation, swear word): nobody can probe which one matched
  reserved: "That handle isn't available, try another.",
  invalid: 'Use 3 to 30 lowercase letters, numbers or single hyphens (not at the start or end).',
  failed: 'Could not check just now. You can still try to claim it.',
};

const GENERIC = 'Something went wrong. Check your connection and try again.';

// Hints that END the flow for this link: nothing the person types will help, so the page shows a card, not a form.
export const TERMINAL_HINTS = new Set([
  'link_invalid',
  'link_used',
  'link_revoked',
  'link_expired',
  'identity_unavailable',
  'identity_claimed',
]);

// Hints that mean "go back and use a different email address".
export const EMAIL_HINTS = new Set(['account_exists', 'admin_cannot_claim', 'signed_out']);

const TEXT = {
  // the link itself
  link_invalid:
    'This claim link is not valid. Check that you opened the whole link, or ask the organiser who sent it to send it again.',
  link_used:
    'This claim link has already been used. If that was you, your Seduh ID is already claimed. If not, ask the organiser who sent it.',
  link_revoked: 'The organiser cancelled this link. Ask them for a new one.',
  link_expired:
    'This claim link has expired. A link lasts 72 hours. Ask the organiser who sent it for a new one.',
  identity_unavailable: 'This Seduh ID cannot be claimed. Ask the organiser who sent you the link.',
  identity_claimed: 'This Seduh ID has already been claimed.',
  // the email and the code
  bad_email: 'Enter a valid email address.',
  too_many_codes:
    'Too many codes have been sent for this link. Wait a while, or ask the organiser for a new link.',
  email_rate_limited: 'Too many emails were sent just now. Wait a minute and try again.',
  email_send_failed: 'We could not send the email. Try again in a moment.',
  otp_invalid: 'That code is not right, or it has expired. Check it, or send a new code.',
  too_many_attempts: 'Too many attempts. Wait a minute and try again.',
  // the claim
  handle_invalid:
    'That handle is not allowed. Use 3 to 30 lowercase letters, numbers or single hyphens (not at the start or end).',
  handle_reserved: "That handle isn't available, try another.",
  handle_taken: 'That handle is already taken. Choose another.',
  adult_required: 'You need to confirm you are 18 or over to claim a Seduh ID.',
  account_exists:
    'The email address you signed in with already has a Seduh ID. Go back and use a different email address.',
  admin_cannot_claim:
    'That email address is an administrator sign-in for Seduh Score, so it cannot claim a Seduh ID. Go back and use a different email address.',
  signed_out: 'Your sign-in ended. Enter your email address and confirm the code again.',
  // no answer
  offline: 'We could not reach Seduh Score. Check your connection and try again.',
  timeout:
    'That is taking longer than expected. Check your connection and try again. If you already pressed the button, wait a moment before trying again.',
  bad_request: GENERIC,
  server_error: 'Something went wrong on our side. Try again in a moment.',
};

/** Pure. The words for a refusal hint; an unknown or missing hint gets the generic sentence. */
export function describeClaimHint(hint) {
  return Object.hasOwn(TEXT, hint) ? TEXT[hint] : GENERIC;
}

/** Pure. True when a hint ends the flow for this link. */
export function isTerminalHint(hint) {
  return TERMINAL_HINTS.has(hint);
}

/** Pure. True when the person should go back to the email step. */
export function isEmailHint(hint) {
  return EMAIL_HINTS.has(hint);
}

// The steps, in order, for "Step 2 of 4". Done is not a step: it is the end.
export const STEPS = ['welcome', 'email', 'code', 'handle'];

/** Pure. "Step 2 of 4", or null for the screens that are not steps. */
export function stepLabel(step) {
  const index = STEPS.indexOf(step);
  return index === -1 ? null : `Step ${index + 1} of ${STEPS.length}`;
}
