// Seduh ID claiming, the ORGANISER side (T-ID2.B3b): what the People screen asks the database about each person and the
// three things an organiser can do: send a claim link, see that one is open, cancel it. Format-agnostic, no business logic:
// the database (migration 20261118100000, CONVENTIONS.md "Seduh ID claim") decides every answer; this reduces it to words.
//
// The raw token is a bearer secret. `issueClaimLink` returns it ONCE; nothing here stores, logs or caches it, and the link
// puts it after the `#`, which a browser never sends to a server (so it is in no access log). A caller shows it once and lets
// it go.
import { getSupabase } from './supabaseClient.js';

// seduh_claim_statuses refuses more than 500 ids in one call.
export const STATUS_CHUNK = 500;

export const CLAIM_STATES = ['no_identity', 'unavailable', 'can_issue', 'link_open', 'claimed'];

const HANDLE_SHAPE = /^[a-z0-9](-?[a-z0-9])*$/;

// Pure. Rebuilds one status row from known keys; an unknown state is treated as the cautious one (no controls).
export function normaliseStatus(row) {
  const state = CLAIM_STATES.includes(row?.state) ? row.state : 'unavailable';
  const expiresAt = typeof row?.expires_at === 'string' ? Date.parse(row.expires_at) : NaN;
  const handle =
    typeof row?.handle === 'string' && row.handle.length <= 30 && HANDLE_SHAPE.test(row.handle)
      ? row.handle
      : null;
  return {
    state,
    expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt) : null,
    handle: state === 'claimed' ? handle : null,
  };
}

// Reads the claim state of the organisation's people, in chunks, as a Map personId -> { state, expiresAt, handle }.
// Throws on any failure: a screen shows "could not check", never a guess.
export async function fetchClaimStatuses(orgId, personIds, client = getSupabase()) {
  const statuses = new Map();
  for (let i = 0; i < personIds.length; i += STATUS_CHUNK) {
    const { data, error } = await client.rpc('seduh_claim_statuses', {
      p_org_id: orgId,
      p_person_ids: personIds.slice(i, i + STATUS_CHUNK),
    });
    if (error) throw error;
    for (const row of Array.isArray(data) ? data : []) {
      if (typeof row?.person_id === 'string') statuses.set(row.person_id, normaliseStatus(row));
    }
  }
  return statuses;
}

// Makes a link for one person and returns the raw token. It replaces any open link of that person (the old one stops).
export async function issueClaimLink(personId, client = getSupabase()) {
  const { data, error } = await client.rpc('issue_seduh_claim_link', { p_person_id: personId });
  if (error) throw error;
  if (typeof data !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data)) {
    throw new Error('The claim link was not in the expected form.');
  }
  return data;
}

export async function revokeClaimLink(personId, client = getSupabase()) {
  const { error } = await client.rpc('revoke_seduh_claim_link', { p_person_id: personId });
  if (error) throw error;
}

// Where the person opens it. The token goes in the fragment (after `#`) so it never reaches a server log.
export function claimLinkUrl(token, origin) {
  return `${origin}/id/claim/#${token}`;
}

// A share to WhatsApp (works with or without the app installed). The message names no one but the link.
export function whatsappShareUrl(url, firstName) {
  const hello = firstName ? `Hi ${firstName}, ` : '';
  return `https://wa.me/?text=${encodeURIComponent(
    `${hello}here is your link to claim your Seduh ID: ${url}`,
  )}`;
}

// Plain words for the People screen's row, one per state. `no_identity` says WHY (decision B3b): an identity is made when
// a published result is reviewed, never by adding a person to a roster.
export const CLAIM_STATE_TEXT = {
  no_identity:
    'No Seduh ID yet. One is made after this person’s results are published and reviewed.',
  unavailable: 'This Seduh ID cannot be claimed.',
  can_issue: 'Not claimed yet.',
  link_open: 'Claim link sent.',
  claimed: 'Claimed',
};

// The words for an organiser's refusal. The database's hints are stable snake_case; anything else is generic.
const CLAIM_ERROR_TEXT = {
  no_identity: 'This person has no Seduh ID yet, so there is nothing to claim.',
  identity_unavailable: 'This Seduh ID cannot be claimed.',
  identity_claimed: 'This Seduh ID has already been claimed.',
  no_open_link: 'There is no open claim link for this person.',
  bad_input: 'That could not be done. Reload the page and try again.',
};

export function describeClaimError(error) {
  if (error?.code === '42501') {
    return 'You cannot do that for this person. Reload the page, or ask the organisation’s owner.';
  }
  const hint = typeof error?.hint === 'string' ? error.hint : null;
  if (hint && CLAIM_ERROR_TEXT[hint]) return CLAIM_ERROR_TEXT[hint];
  return 'Something went wrong. Check your connection and try again.';
}

export const CLAIM_LINK_WARNING =
  'This link works once, for one person, and lets whoever holds it claim this Seduh ID. ' +
  'Send it only to that person. It stops working after 72 hours, and it cannot be shown again.';
