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
import { AVATAR_BUCKET, photoObjectName } from '../core/seduhProfile.js';
import { randomHex32 } from './photoPipeline.js';
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

    async addCourse(params) {
      return door('seduh_add_course', params);
    },
    async updateCourse(id, params) {
      return door('seduh_update_course', { p_course_id: id, ...params });
    },
    async deleteCourse(id) {
      return door('seduh_delete_course', { p_course_id: id });
    },
    /** The ONE certificate shown on the story card; null clears it. */
    async setCardCourse(id) {
      return door('seduh_set_card_course', { p_course_id: id });
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

    // The photo (T-ID2.C2). `prepared` is photoPipeline.prepareAvatar's answer ({ blob, type, ext }); `handle` is the caller's own (it
    // names their folder); `previousUrl` is the record's current photo_url. Order: upload the new file, remove the old one through the
    // Storage API (frees its bytes; best effort), then the door records the new path (and deletes any row still left in the folder).
    async setPhoto({ prepared, handle, previousUrl = null, random = randomHex32 }) {
      const path = `${handle}/${random()}.${prepared.ext}`;
      try {
        const bucket = getClient().storage.from(AVATAR_BUCKET);
        const { error } = await raceTimeout(
          bucket.upload(path, prepared.blob, {
            contentType: prepared.type,
            upsert: false,
            cacheControl: '31536000',
          }),
          CALL_TIMEOUT_MS * 3,
        );
        if (error) {
          const status = Number(error.statusCode ?? error.status);
          if (status === 413) return { ok: false, hint: 'photo_too_big' };
          if (status === 415) return { ok: false, hint: 'photo_bad_type' };
          if (status === 401) return { ok: false, hint: 'signed_out' };
          return { ok: false, hint: 'photo_upload_failed' };
        }
      } catch (thrown) {
        return { ok: false, hint: thrown?.timedOut ? 'timeout' : 'photo_upload_failed' };
      }
      // Remove the old file through the Storage API first (only the API frees the bytes; the door deletes a leftover ROW, which kills
      // the address but leaves the bytes). If the door then fails, the old address is dead until the person tries again: the page shows initials.
      const old = photoObjectName(previousUrl);
      if (old && old !== path) {
        try {
          await getClient().storage.from(AVATAR_BUCKET).remove([old]);
        } catch {
          // the door below deletes a leftover row, so the address is dead either way
        }
      }
      const answer = await door('seduh_set_my_photo', { p_path: path });
      if (!answer.ok) {
        // After a TIMEOUT the database may have committed: deleting the file then would break a saved photo, so leave it (the next save sweeps strays).
        if (answer.hint === 'timeout') return answer;
        // the new file is not recorded: take it back out so it does not sit in the folder (best effort; the next save sweeps it)
        try {
          await getClient().storage.from(AVATAR_BUCKET).remove([path]);
        } catch {
          // swept by the next successful save
        }
        return answer;
      }
      return { ok: true };
    },
    async removePhoto(previousUrl = null) {
      const old = photoObjectName(previousUrl);
      if (old) {
        try {
          await getClient().storage.from(AVATAR_BUCKET).remove([old]);
        } catch {
          // the door below deletes the row, so the address is dead either way
        }
      }
      return door('seduh_remove_my_photo');
    },

    async setSettings(settings) {
      const answer = await door('seduh_set_my_settings', { p_settings: settings });
      return answer;
    },
  };
}
