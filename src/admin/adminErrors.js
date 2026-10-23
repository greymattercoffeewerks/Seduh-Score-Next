// Hint -> words (spec section 5). The database is the authority on what went wrong; the console only
// translates its stable `hint` into a sentence. Nothing here matches on a message: messages can change, hints
// are the contract (CONVENTIONS.md).
export const GENERIC_ERROR = 'Something went wrong. Nothing was changed. Try again.';

export const ADMIN_ERROR_COPY = Object.freeze({
  admin_required: 'This account does not have access to the admin console.',
  admin_mfa_required: 'Verify with your authenticator app to continue.',
  admin_session_ended: 'Your session ended. Sign in again.',
  admin_self_target: 'You cannot change your own access here. Use SQL if you really need to.',
  org_name_invalid: 'The name must be 1 to 80 characters, with no hidden or control characters.',
  org_slug_invalid:
    'The link name must be 3 to 40 letters and digits, with single hyphens between them.',
  org_slug_reserved: 'That link name is reserved. Choose another.',
  org_slug_taken: 'That link name is already used by another organisation.',
  org_owner_not_found: 'No active account matches that. Check the email.',
  member_user_not_found: 'No active account matches that. Check the email.',
  email_ambiguous:
    'More than one account matches that email. Look it up in the Supabase dashboard.',
  member_exists: 'That account is already in this organisation.',
  member_not_found: 'That person is not a member of this organisation.',
  member_role_invalid: 'Choose owner or organiser.',
  org_not_found: 'That organisation no longer exists.',
  last_owner: 'An organisation must keep at least one owner. Promote another member first.',
  member_password_unset:
    'This account already belongs to an organisation, or was removed from one, so someone else may know its password. Only continue if you have confirmed that the person set their own password (tick the box), or create a fresh login instead.',
  email_taken: 'That email already has an account. Choose "Use an existing account" instead.',
  account_record_failed:
    'The login could not be recorded, so it was removed. Nothing was changed. Try again.',
  account_stranded:
    'The login was created but could not be recorded or removed. Note the email and ask the operator to look at it.',
  tier_invalid: 'Choose Per-event or Annual. The Community plan needs no grant.',
  source_invalid: 'That kind of grant is not allowed here.',
  note_invalid: 'The note is too long (500 characters at most).',
  window_invalid:
    'The dates do not work. A Per-event plan is five days in Brunei time that include the competition date, and an end must be in the future.',
  event_grant_tier_invalid: 'A plan for one event is always a Per-event plan.',
  event_not_found: 'That event is not in this organisation any more.',
  event_date_required:
    'This event has no date, so a five-day plan cannot be placed around it. Set its date first.',
  grant_exists: 'That event already has a plan that is still running.',
  reason_required: 'Give a reason. It is logged.',
  reason_too_long: 'The reason is too long (500 characters at most).',
  grant_not_found: 'That plan no longer exists.',
  grant_revoked: 'That plan was revoked, so it cannot be extended.',
  grant_open_ended: 'That plan has no end, so there is nothing to extend.',
  already_extended: 'That plan was already extended. Extend the latest one.',
  enforced_invalid: 'Say whether the key is on or off.',
  confirm_mismatch:
    'The number of affected organisations changed since the preview. Preview again before turning the key on.',
  entitlement_key_unknown: 'That key does not exist.',
  entitlement_key_not_cap: 'That key has no limit.',
  snapshot_absent: 'That event has not gone live yet, so it has no frozen plan to raise.',
  snapshot_downgrade:
    'A frozen plan only goes up. The event’s plan is already as high as it can be.',
  amount_required: 'Write the amount and reference of the payment.',
  amount_too_long: 'The payment note is too long (200 characters at most).',
  account_state_unknown:
    'We could not confirm whether the login was created. Look the email up before trying again.',
});

export function describeAdminError(error) {
  const hint = error?.hint;
  return typeof hint === 'string' && Object.hasOwn(ADMIN_ERROR_COPY, hint)
    ? ADMIN_ERROR_COPY[hint]
    : GENERIC_ERROR;
}
