// Giving a test organisation a plan, and switching a gating key, through the audited `admin_*` functions with a REAL
// platform-admin session. `admin_grant_create` and `admin_set_key_enforced` are revoked from service_role, so there is
// no shortcut and this file adds none: the admin is made by SQL as the local database owner (support/admins.js), a TOTP
// factor is enrolled on it, and the code is computed here (support/api.js) so the session is `aal2`.
// Local stack only: localStack() refuses a non-local API address and admins.js refuses a non-local database.
import { createPlatformAdmin, removePlatformAdmin } from './admins.js';
import { elevate, enrolTotp, rpc, signInPassword } from './api.js';
import { localStack } from './tenants.js';

let adminOnce;

// One admin per test process (Playwright runs each worker as its own process), made on first use.
function grantAdmin() {
  localStack();
  adminOnce ??= (async () => {
    const person = await createPlatformAdmin('grant-admin');
    const { token } = await signInPassword(person);
    const factor = await enrolTotp(token);
    // best effort: the row is removed when the process ends; a killed worker leaves one on the local stack, as
    // the other specs' logins are left
    process.once('exit', () => {
      try {
        removePlatformAdmin(person);
      } catch {
        // the stack may already be gone
      }
    });
    return { person, factor };
  })();
  return adminOnce;
}

/**
 * A fresh `aal2` admin token: signs in again and answers the second factor, so the TOTP verification the database
 * demands (the last 60 minutes) is always seconds old.
 */
async function adminToken() {
  const { person, factor } = await grantAdmin();
  const { token } = await signInPassword(person);
  return elevate(token, factor);
}

async function adminRpc(name, args) {
  const response = await rpc(name, args, { token: await adminToken() });
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(`${name} -> ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

/** Gives `orgId` a plan (an organisation-wide grant) through `admin_grant_create`. Returns the grant id. */
export function grantPlan(orgId, tier = 'annual', note = 'e2e fixture (local stack only)') {
  return adminRpc('admin_grant_create', { p_org_id: orgId, p_tier: tier, p_note: note });
}

/** Calls any `admin_*` function with a real `aal2` platform-admin session (the same session grantPlan uses). */
export function callAdminRpc(name, args = {}) {
  return adminRpc(name, args);
}

/**
 * Gives `orgId` a Per-event grant for `eventId` through `admin_grant_create` (five Brunei calendar days containing the
 * event's date, so the event's date must be today's for the grant to be live now). Returns the grant id.
 */
export function grantEventPlan(
  orgId,
  eventId,
  startOffsetDays = 0,
  note = 'e2e fixture (local stack only)',
) {
  return adminRpc('admin_grant_create', {
    p_org_id: orgId,
    p_tier: 'per_event',
    p_event_id: eventId,
    p_start_offset_days: startOffsetDays,
    p_note: note,
  });
}

/** Switches a gating key through the audited `admin_set_key_enforced`, confirming the preview count it asks for. */
export async function setKeyEnforced(key, enforced) {
  // The confirm number must equal the preview count at the moment of the switch. Other workers may create
  // organisations in between, so a mismatch re-reads and retries a few times.
  for (let attempt = 0; ; attempt += 1) {
    const preview = await adminRpc('admin_gating_preview', { p_key: key });
    try {
      await adminRpc('admin_set_key_enforced', {
        p_key: key,
        p_enforced: enforced,
        p_confirm: preview.would_lose,
      });
      return;
    } catch (error) {
      if (attempt >= 4 || !String(error.message).includes('confirm_mismatch')) throw error;
    }
  }
}

/** Runs `body` with `key` enforced and always puts the key back OFF afterwards (every key is off on a fresh stack). */
export async function withKeyEnforced(key, body) {
  try {
    await setKeyEnforced(key, true);
    return await body();
  } finally {
    // a failed restore must not hide the body's own failure
    await setKeyEnforced(key, false).catch(() => {});
  }
}
