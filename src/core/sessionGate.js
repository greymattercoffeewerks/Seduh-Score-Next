// One definition of "this person must choose a password before anything else". An owner who creates or
// resets an account on the Team screen flags it `must_change_password` in the user's metadata, and
// until the person has chosen their own password they see nothing but the set-password screen: no
// console routes, no Team-link check, no organisation question.
//
// The flag lives in user_metadata, which the person can edit themselves, so it is a prompt, not a lock
// (see setPasswordScreen.js). Only the exact boolean `true` counts: the string "true" does not.
export function mustChangePassword(session) {
  return session?.user?.user_metadata?.must_change_password === true;
}
