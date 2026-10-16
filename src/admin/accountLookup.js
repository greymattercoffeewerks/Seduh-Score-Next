// "Which existing account?": an email, a lookup by EXACT address (admin_find_user), what was found, and, when the
// database would require it, the box the operator ticks to say the person set their own password (spec D-A9). Used
// by the Add member form on an organisation's detail.
//
// What it guarantees:
// - A lookup answers for the address it was asked about. Typing another address, `discard()`, or `lock()` (a request
//   is being sent) throws a pending answer away and anything it had already set.
// - Nothing is attached from a lookup that is not for the address now typed, for an account that is disabled or
//   deleted, or (when `needs_attestation`) without the box ticked. The DATABASE still decides: a stale or missing
//   answer here is refused there with a hint, and `refresh()` looks again so the box appears.
// - Every id it hands back was checked to be an id.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError, ADMIN_ERROR_COPY } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { plural } from './format.js';
import { UUID } from './ids.js';
import { ask } from './panelRequest.js';
import { field, textInput, showFieldError } from './formParts.js';
import { isEmailShaped } from './orgRules.js';

const EMAIL_PROBLEM = 'Enter a valid email address.';
const NO_ACCOUNT = 'No active account matches that. Check the email.';
const LOOKUP_FIRST = 'Look up the account first.';
const CONFIRM_PASSWORD = 'Tick the box to confirm that this person set their own password.';

export function createAccountLookup({ ctx, idPrefix, cannotUse, mayTakeFocus, onGateRefused }) {
  let found = null;
  let attest = false;
  let askedFor = null;
  let seq = 0;
  let locked = false;
  let touched = false;

  const emailInput = textInput(`${idPrefix}-email`, { type: 'email', inputmode: 'email' });
  const emailField = field({
    id: `${idPrefix}-email`,
    label: 'Account email',
    input: emailInput,
    live: true,
  });
  const result = el('div', {
    className: 'adm-lookup',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const lookupButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Look up account',
    attrs: { type: 'button' },
  });
  const node = el('div', { className: 'adm-existing' }, [emailField.wrapper, lookupButton, result]);

  const typed = () => emailInput.value.trim().toLowerCase();

  function draw() {
    result.replaceChildren();
    if (!found) return;
    const lines = [el('p', { text: `Found: ${found.email}` })];
    if (found.deleted || found.banned) {
      lines.push(el('p', { className: 'adm-field-error', text: cannotUse }));
    } else {
      lines.push(
        el('p', {
          className: 'adm-muted',
          text:
            found.orgCount > 0
              ? `This account is already in ${plural(found.orgCount, 'organisation')}.`
              : 'This account is not in any organisation yet.',
        }),
      );
      if (found.needsAttestation) {
        const box = el('input', { id: `${idPrefix}-attest`, attrs: { type: 'checkbox' } });
        box.checked = attest;
        box.addEventListener('change', () => {
          if (locked) {
            box.checked = attest;
            return;
          }
          attest = box.checked;
        });
        lines.push(
          el('p', { className: 'adm-muted', text: ADMIN_ERROR_COPY.member_password_unset }),
          el('div', { className: 'adm-check' }, [
            box,
            el('label', {
              text: 'I have confirmed that this person set their own password.',
              attrs: { for: `${idPrefix}-attest` },
            }),
          ]),
        );
      }
    }
    result.append(...lines);
  }

  // A lookup that cannot say yes is said at the email field, with focus there while it is free to move.
  function problem(message) {
    showFieldError(emailInput, emailField.errorLine, message);
    if (mayTakeFocus()) emailInput.focus();
  }

  function discard() {
    seq += 1;
    askedFor = null;
    found = null;
    attest = false;
    setBusyDisabled(lookupButton, false);
    lookupButton.textContent = 'Look up account';
    draw();
  }

  async function lookUp({ quiet = false } = {}) {
    if (locked) return;
    if (!isEmailShaped(emailInput.value)) {
      showFieldError(emailInput, emailField.errorLine, EMAIL_PROBLEM);
      emailInput.focus();
      return;
    }
    showFieldError(emailInput, emailField.errorLine, null);
    const mine = (seq += 1);
    const asked = typed();
    askedFor = asked;
    if (!quiet) {
      setBusyDisabled(lookupButton, true);
      lookupButton.textContent = 'Looking up…';
    }
    const answer = await ask(ctx, 'admin_find_user', { p_email: emailInput.value.trim() });
    if (mine !== seq) return;
    askedFor = null;
    setBusyDisabled(lookupButton, false);
    lookupButton.textContent = 'Look up account';
    found = null;
    if (answer.error) {
      if (isGateRefusal(answer.error)) return onGateRefused();
      draw();
      problem(answer.error.timedOut ? SLOW_MESSAGE : describeAdminError(answer.error));
      return;
    }
    const row = Array.isArray(answer.data) ? answer.data[0] : null;
    if (!row) {
      draw();
      problem(NO_ACCOUNT);
      return;
    }
    // An id that is not one is never sent back to the database.
    if (!UUID.test(String(row.user_id ?? ''))) {
      draw();
      problem(describeAdminError({}));
      return;
    }
    found = {
      userId: row.user_id,
      email: String(row.email ?? ''),
      banned: Boolean(row.banned),
      deleted: Boolean(row.deleted),
      orgCount: Number.isInteger(row.org_count) ? row.org_count : 0,
      needsAttestation: Boolean(row.needs_attestation),
      forEmail: asked,
    };
    attest = false;
    draw();
  }
  lookupButton.addEventListener('click', () => lookUp());

  emailInput.addEventListener('input', () => {
    const now = typed();
    if ((found && now !== found.forEmail) || (askedFor !== null && now !== askedFor)) discard();
    if (touched) showFieldError(emailInput, emailField.errorLine, null);
  });
  emailInput.addEventListener('blur', () => {
    touched = true;
    if (emailInput.value.trim() && !isEmailShaped(emailInput.value)) {
      showFieldError(emailInput, emailField.errorLine, EMAIL_PROBLEM);
    }
  });

  return {
    node,
    emailInput,
    lookupButton,
    // What may be sent, or why not: { account: { userId, email, attest } } or { message, focus }.
    check() {
      if (!isEmailShaped(emailInput.value)) {
        showFieldError(emailInput, emailField.errorLine, EMAIL_PROBLEM);
        return { message: EMAIL_PROBLEM, focus: emailInput };
      }
      if (!found || found.forEmail !== typed()) {
        return { message: LOOKUP_FIRST, focus: lookupButton };
      }
      if (found.deleted || found.banned) return { message: cannotUse, focus: emailInput };
      if (found.needsAttestation && !attest) {
        return { message: CONFIRM_PASSWORD, focus: result.querySelector(`#${idPrefix}-attest`) };
      }
      return { account: { userId: found.userId, email: found.email, attest } };
    },
    // Look again, quietly: the database refused for want of the attestation the lookup did not show.
    refresh: () => lookUp({ quiet: true }),
    discard,
    // A request is being sent: a lookup still out must change nothing, and the controls stop.
    lock(isLocked) {
      locked = isLocked;
      if (isLocked) {
        seq += 1;
        askedFor = null;
      }
      emailInput.readOnly = isLocked;
      setBusyDisabled(emailInput, isLocked);
      setBusyDisabled(lookupButton, isLocked);
      for (const box of result.querySelectorAll('input')) setBusyDisabled(box, isLocked);
      lookupButton.textContent = 'Look up account';
    },
    // The screen is gone: an answer still out must draw nothing.
    dispose() {
      seq += 1;
    },
    reset() {
      emailInput.value = '';
      showFieldError(emailInput, emailField.errorLine, null);
      discard();
    },
  };
}
