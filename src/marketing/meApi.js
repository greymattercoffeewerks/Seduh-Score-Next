// My Seduh ID's calls (T-ID2.D-b), behind one small object so the screen can be driven by a fake in tests. Every call
// reduces every way it can fail to a HINT (meFlow.js turns it into words) and never throws.
//
// The client is the COMPETITOR client (claimClient.js: storage key `seduh-competitor-auth`, sessionStorage, no session read
// from the URL), the same one the claim page uses, so signing in here can never replace an organiser's or the admin
// console's session, and an organiser's session is never used for these calls. The person's doors take no uuid: the
// database finds the caller's own account from the JWT (`app.seduh_my_account()`), so nothing here names whose record it is.
//
// Signing in is by an emailed code (`signInWithOtp` with `shouldCreateUser: false`, then `verifyOtp`). `requestCode` NEVER
// tells whether the address has a Seduh ID: Supabase refuses a send for an address with no login, and that refusal, like a
// success, becomes the same neutral answer. Only "we could not reach the service" differs (it does not depend on the address); a rate limit is NOT shown, because the
// per-address one would reveal a known address. A minimum answer time keeps this call from being the quicker oracle.
import { raceTimeout } from '../core/timeout.js';
import { getClaimClient } from './claimClient.js';
import { normaliseMyRecord, normaliseTeamOptions } from './meFlow.js';

const CALL_TIMEOUT_MS = 20000;
const MIN_REQUEST_CODE_MS = 1500;
const HINT = /^[a-z_]{1,40}$/;

function hintFromRpcError(error, status) {
  if (typeof error?.hint === 'string' && HINT.test(error.hint)) return error.hint;
  if (status === 401 || status === 403 || error?.code === '42501') return 'signed_out';
  if (status === 0 || error?.message === 'timeout') return 'offline';
  return 'server_error';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMeApi({ client, minRequestCodeMs = MIN_REQUEST_CODE_MS } = {}) {
  const getClient = () => client ?? getClaimClient();

  // One door call: { ok: true, data } or { ok: false, hint }. Never throws.
  async function door(name, args = {}) {
    try {
      const { data, error, status } = await raceTimeout(
        getClient().rpc(name, args),
        CALL_TIMEOUT_MS,
      );
      if (error) return { ok: false, hint: hintFromRpcError(error, status) };
      return { ok: true, data };
    } catch (thrown) {
      return { ok: false, hint: thrown?.timedOut ? 'timeout' : 'offline' };
    }
  }

  return {
    /** Is a competitor session in this tab? A boolean; never throws. */
    async hasSession() {
      try {
        const { data } = await raceTimeout(getClient().auth.getSession(), CALL_TIMEOUT_MS);
        return Boolean(data?.session);
      } catch {
        return false;
      }
    },

    async requestCode(email) {
      const started = Date.now();
      let result = { ok: true };
      try {
        const { error } = await raceTimeout(
          getClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
          CALL_TIMEOUT_MS,
        );
        if (error) {
          // NOT 429: GoTrue limits how often ONE address may be sent a code, so a 429 would appear for a known address
          // only, on a second request. It is the same neutral answer (the earlier code is still valid).
          if (error.status === 0 || error.status === undefined)
            result = { ok: false, hint: 'offline' };
          // any other refusal (no such login, a mail failure) is shown as the same neutral answer as a success
        }
      } catch (thrown) {
        result = { ok: false, hint: thrown?.timedOut ? 'timeout' : 'offline' };
      }
      const left = minRequestCodeMs - (Date.now() - started);
      if (left > 0) await wait(left);
      return result;
    },

    async verifyCode(email, code) {
      try {
        const { error } = await raceTimeout(
          getClient().auth.verifyOtp({ email, token: code, type: 'email' }),
          CALL_TIMEOUT_MS,
        );
        if (!error) return { ok: true };
        if (error.status === 429) return { ok: false, hint: 'too_many_attempts' };
        if (error.status === 0 || error.status === undefined) return { ok: false, hint: 'offline' };
        return { ok: false, hint: 'otp_invalid' };
      } catch (thrown) {
        return { ok: false, hint: thrown?.timedOut ? 'timeout' : 'offline' };
      }
    },

    async signOut() {
      try {
        await getClient().auth.signOut({ scope: 'local' });
      } catch {
        // the session lives in this tab's storage only
      }
    },

    async loadRecord() {
      const answer = await door('seduh_my_record');
      if (!answer.ok) return answer;
      const record = normaliseMyRecord(answer.data);
      return record ? { ok: true, record } : { ok: false, hint: 'server_error' };
    },

    async addEntry(params) {
      return door('seduh_add_entry', params);
    },
    async updateEntry(id, params) {
      return door('seduh_update_entry', { p_entry_id: id, ...params });
    },
    async deleteEntry(id) {
      return door('seduh_delete_entry', { p_entry_id: id });
    },

    async teamOptions(country) {
      const answer = await door('seduh_team_options', {
        p_country_code: country || null,
        p_competition: null,
      });
      return answer.ok ? { ok: true, options: normaliseTeamOptions(answer.data) } : answer;
    },
    async addTeamLink(teamKey, role) {
      return door('seduh_add_team_link', { p_team_key: teamKey, p_role: role });
    },
    async removeTeamLink(id) {
      return door('seduh_remove_team_link', { p_link_id: id });
    },

    async setSettings(settings) {
      const answer = await door('seduh_set_my_settings', { p_settings: settings });
      return answer;
    },
  };
}
