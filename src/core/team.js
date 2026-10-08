// Team accounts — the browser side of owner-managed logins (migration 20261007120000 and the
// `team-accounts` Edge Function). Format-agnostic: nothing here knows what an org does.
//
// Who may do what is decided by the database, not here: every call below is refused for anyone but
// the org's owner, and these wrappers only carry the answer back. Creating a login and resetting a
// password, or putting back someone removed earlier, go through the Edge Function (only the Auth admin
// API can); listing, removing and asking "may I" are plain RPCs.
import { getSupabase } from './supabaseClient.js';

// An error with a message the owner can be shown as it is.
export class TeamError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'TeamError';
    this.status = status;
  }
}

const GENERIC_MESSAGE = 'Something went wrong. Try again.';
const OFFLINE_MESSAGE = 'Could not reach the server — check your connection and try again.';
const NOT_OWNER_MESSAGE = 'Only the owner can manage the team.';

// Postgres 42501 (insufficient_privilege) is how the RPCs refuse a non-owner.
function isPermissionDenied(error) {
  return error?.code === '42501';
}

function rpcFailure(error) {
  if (isPermissionDenied(error)) return new TeamError(NOT_OWNER_MESSAGE, { status: 403 });
  // The messages the SQL raises for the owner's own mistakes are written to be shown.
  if (/^team_remove_member: /.test(error?.message ?? '')) {
    return new TeamError(error.message.replace(/^team_remove_member: /, ''));
  }
  return new TeamError(GENERIC_MESSAGE);
}

// True when the signed-in user is an owner of the org, false when they are not, and null when the
// check itself failed (the caller keeps whatever it believed before: a dropped connection at a token
// refresh must not make the Team link vanish). It only decides whether the link is shown; the
// database refuses a non-owner whatever the screen shows.
export async function canManageTeam(orgId, client = getSupabase()) {
  const { data, error } = await client.rpc('team_can_manage', { p_org_id: orgId });
  if (error) return null;
  return data === true;
}

// The members, owner first, as the screen uses them.
export async function listTeamMembers(orgId, client = getSupabase()) {
  const { data, error } = await client.rpc('team_list_members', { p_org_id: orgId });
  if (error) throw rpcFailure(error);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    role: row.role,
    lastSignInAt: row.last_sign_in_at,
    mustChangePassword: Boolean(row.must_change_password),
  }));
}

// The people the owner removed, newest first, as the screen uses them. Only accounts the database
// holds a "removed from this org" marker for can ever appear here or be restored.
export async function listRemovedTeamMembers(orgId, client = getSupabase()) {
  const { data, error } = await client.rpc('team_list_removed_members', { p_org_id: orgId });
  if (error) throw rpcFailure(error);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    removedAt: row.removed_at,
  }));
}

export async function removeTeamMember(orgId, userId, client = getSupabase()) {
  const { error } = await client.rpc('team_remove_member', { p_org_id: orgId, p_user_id: userId });
  if (error) throw rpcFailure(error);
}

// Calls the Edge Function. supabase-js reports a non-2xx answer as an error whose `context` is the
// Response; the function's own { error } text is what the owner should see.
async function callTeamFunction(client, body) {
  let result;
  try {
    result = await client.functions.invoke('team-accounts', { body });
  } catch {
    // supabase-js usually reports a failed fetch as { error } rather than throwing; this covers
    // anything it lets through.
    throw new TeamError(OFFLINE_MESSAGE);
  }
  const { data, error } = result;
  if (!error) return data;

  const response = error.context;
  if (response && typeof response.json === 'function') {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // not JSON — fall through to the generic message
    }
    if (payload && typeof payload.error === 'string') {
      throw new TeamError(payload.error, { status: response.status });
    }
    throw new TeamError(GENERIC_MESSAGE, { status: response.status });
  }
  throw new TeamError(OFFLINE_MESSAGE);
}

// Creates a login for `email` and puts it on the team. Resolves { userId, email, password }: the
// one-time password is shown to the owner once and is not kept anywhere.
export async function addTeamMember(orgId, email, client = getSupabase()) {
  const data = await callTeamFunction(client, { action: 'add', orgId, email });
  return { email: data.email, password: data.password };
}

// A new one-time password for an existing member. Resolves { password }.
export async function resetTeamMemberPassword(orgId, userId, client = getSupabase()) {
  const data = await callTeamFunction(client, { action: 'reset', orgId, userId });
  return { password: data.password };
}

// Puts a removed member back on the team with a new one-time password (their old one stops working).
// Resolves { password }: shown to the owner once, to pass on.
export async function restoreTeamMember(orgId, userId, client = getSupabase()) {
  const data = await callTeamFunction(client, { action: 'restore', orgId, userId });
  return { password: data.password };
}

export function describeTeamError(error) {
  return error instanceof TeamError ? error.message : GENERIC_MESSAGE;
}
