// Giving a test organisation a plan, and switching a gating key, the only way production can: through the audited
// `admin_*` functions, called over the API with a REAL platform-admin session. `admin_grant_create` and
// `admin_set_key_enforced` are revoked from service_role, so there is no shortcut (no local-only route, no direct
// insert into the grant tables) and this file adds none: it signs in as an admin made the way the runbook makes one
// (support/admins.js: an SQL insert as the local database owner), enrols a TOTP factor on that login, and answers
// the factor with a code computed here (support/api.js) so the session is `aal2` with a TOTP verified seconds ago.
//
// Local stack only, enforced twice: tenants.js refuses a non-local API address before anything is signed, and
// admins.js refuses a database container or Docker host that is not this machine's. Both run before the admin is
// made, and `assertLocalAdminPath` below runs them again so a future caller cannot skip them. No credential in this
// file is real: the admin's password is the local-dev one every helper here uses, and the TOTP secret is generated
// by the local GoTrue for this run and kept in memory.
import { createPlatformAdmin, removePlatformAdmin } from './admins.js';
import { elevate, enrolTotp, rpc, signInPassword } from './api.js';
import { localStack } from './tenants.js';

function assertLocalAdminPath() {
  // localStack() throws unless the API address is this machine's; the database guard lives in admins.js and runs
  // inside createPlatformAdmin/removePlatformAdmin, so the admin cannot be made against anything else.
  localStack();
}

let adminOnce;

// One admin per test process (Playwright runs each worker as its own process), made on first use.
function grantAdmin() {
  assertLocalAdminPath();
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
  await setKeyEnforced(key, true);
  try {
    return await body();
  } finally {
    await setKeyEnforced(key, false);
  }
}
