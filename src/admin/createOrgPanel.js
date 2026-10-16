// The "New organisation" panel (spec section 5, D3): a name, a link name and an owner, where the owner is a NEW
// login (made by the admin-accounts Edge Function, its one-time password shown once) or an EXISTING account (found
// by exact email, confirmed before it is attached). It then calls admin_create_org.
//
// What it guarantees:
// - The database is the authority. orgRules.js says what a name and link name look like while a person types, but
//   every refusal is shown by the database's stable hint (adminErrors.js), never by a message, and a value this page
//   called fine can still be refused.
// - A login the console has made is never made twice. If the organisation step fails after it, the login (and its
//   password, still on screen) stays: the form stays editable and the next try attaches THAT login.
// - The one-time password exists only in this screen's memory and DOM: not in storage, a URL, a label or a log, and
//   not after the screen is left. It is not shown a second time (a reload shows an empty form).
// - A submit is taken once: the controls are marked busy and a second click while a request is out does nothing.
// - Nothing here reads or draws more than the fields it names.
import { el, setBusyDisabled } from '../core/dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { ADMIN_ERROR_COPY, describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { plural } from './format.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { oneTimePasswordCard } from './passwordCard.js';
import { nameMessage, slugMessage, normalisedSlug, isEmailShaped } from './orgRules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ORG_STATE_UNKNOWN =
  'We could not confirm whether the organisation was created. Check the Organisations list before trying again.';
const CHECK_FIELDS = 'Check the highlighted fields and try again.';
const LOOKUP_FIRST = 'Look up the account first.';
const NO_ACCOUNT = 'No active account matches that. Check the email.';
const EMAIL_PROBLEM = 'Enter a valid email address.';
const CONFIRM_PASSWORD = 'Tick the box to confirm that this person set their own password.';
const CANNOT_OWN = 'This account is disabled or deleted, so it cannot own an organisation.';
const PASSWORD_HELP =
  'Send this to them now. They choose their own password when they first sign in. It cannot be looked up again.';

// What a refusal from the Edge Function says. A timeout or a dropped connection leaves it unknown whether the
// login was made, which is its own sentence.
function loginFailureMessage(error) {
  if (error?.timedOut || error?.offline) return ADMIN_ERROR_COPY.account_state_unknown;
  return describeAdminError(error);
}

export function mountCreateOrgPanel(host, ctx) {
  let disposed = false;
  let busy = false;
  let mode = 'new'; // 'new' | 'existing'
  const draft = { name: '', slug: '', email: '', attest: false };
  let created = null; // { userId, email, password }: a login made here and not yet attached
  let found = null; // the account looked up for the existing path
  let done = null; // { orgId, name, slug, login: { email, password } | null, passwordShown }
  let lookupSeq = 0;
  let unloadGuard = null;

  // ---- the password must not be lost to a page unload without a warning ----

  function guardUnload(on) {
    if (on && !unloadGuard) {
      unloadGuard = (event) => {
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', unloadGuard);
    } else if (!on && unloadGuard) {
      window.removeEventListener('beforeunload', unloadGuard);
      unloadGuard = null;
    }
  }
  const syncGuard = () =>
    guardUnload(Boolean(created) || Boolean(done?.login && done.passwordShown));

  // An error is announced by moving focus to it, but only while focus is on the panel or nowhere: an answer
  // that arrives seconds later must not take focus from where the person has since moved.
  const mayTakeFocus = () => {
    const active = document.activeElement;
    return !active || active === document.body || host.contains(active);
  };

  // A refusal that means the gate is closed: the console is re-checking access and will replace the panel, so
  // nothing of this form (or of a password) stays on screen meanwhile.
  function stepAside() {
    created = null;
    guardUnload(false);
    host.replaceChildren();
  }

  // ---- requests ----

  async function ask(name, args) {
    try {
      const { data, error } = await raceTimeout(ctx.callAdmin(name, args), DEFAULT_LOAD_TIMEOUT_MS);
      return error ? { error } : { data };
    } catch (thrown) {
      return { error: { timedOut: Boolean(thrown?.timedOut) } };
    }
  }

  // ---- small builders ----

  function field({ id, label, hint, input }) {
    const errorLine = el('p', {
      className: 'adm-field-error',
      id: `${id}-error`,
      attrs: { 'data-for': id },
    });
    const describedBy = [hint ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(' ');
    input.setAttribute('aria-describedby', describedBy);
    const wrapper = el(
      'div',
      { className: 'form-field' },
      [
        el('label', { className: 'form-field-label', text: label, attrs: { for: id } }),
        hint ? el('p', { className: 'form-field-hint', id: `${id}-hint`, text: hint }) : null,
        input,
        errorLine,
      ].filter(Boolean),
    );
    return { wrapper, errorLine };
  }

  function textInput(id, extra = {}) {
    return el('input', {
      className: 'field-input',
      id,
      attrs: {
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
        ...extra,
      },
    });
  }

  function showFieldError(input, errorLine, message) {
    errorLine.textContent = message ?? '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  // ---- the form ----

  function renderForm({ focusHeading = false } = {}) {
    host.replaceChildren();
    const title = el('h1', {
      text: 'New organisation',
      attrs: { tabindex: '-1', 'data-heading': 'true' },
    });
    const feedback = feedbackRegion();
    // Said to a screen reader and never shown: what step a long request is on.
    const progress = el('div', {
      className: 'sr-only',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const nameInput = textInput('adm-org-name-input', {
      autocapitalize: 'words',
      spellcheck: 'true',
    });
    nameInput.value = draft.name;
    const nameField = field({
      id: 'adm-org-name-input',
      label: 'Organisation name',
      hint: '1 to 80 characters. Shown to the organisation’s members.',
      input: nameInput,
    });

    const slugInput = textInput('adm-org-slug-input');
    slugInput.value = draft.slug;
    const slugPreview = el('p', { className: 'adm-muted', id: 'adm-org-slug-input-preview' });
    const slugField = field({
      id: 'adm-org-slug-input',
      label: 'Link name',
      hint: '3 to 40 letters and digits, with single hyphens between them. It is part of the organisation’s audience links and can never be changed.',
      input: slugInput,
    });
    slugInput.setAttribute(
      'aria-describedby',
      `${slugInput.getAttribute('aria-describedby')} ${slugPreview.id}`,
    );

    const updatePreview = () => {
      const raw = slugInput.value;
      const folded = normalisedSlug(raw);
      slugPreview.textContent =
        folded && !slugMessage(raw) && folded !== raw ? `It will be saved as ${folded}.` : '';
    };
    updatePreview();

    // Live validation: a field is judged when it is left and when the form is sent; once it shows a problem it is
    // judged again on every keystroke, so the message goes the moment it is fixed.
    const touched = { name: false, slug: false, email: false };
    const checkName = () =>
      showFieldError(nameInput, nameField.errorLine, nameMessage(nameInput.value));
    const checkSlug = () =>
      showFieldError(slugInput, slugField.errorLine, slugMessage(slugInput.value));
    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value;
      if (touched.name) checkName();
    });
    nameInput.addEventListener('blur', () => {
      touched.name = true;
      checkName();
    });
    slugInput.addEventListener('input', () => {
      draft.slug = slugInput.value;
      updatePreview();
      if (touched.slug) checkSlug();
    });
    slugInput.addEventListener('blur', () => {
      touched.slug = true;
      checkSlug();
    });

    // ---- the owner ----
    const ownerHost = el('div', { className: 'adm-owner' });
    const emailInput = textInput('adm-owner-email-input', {
      type: 'email',
      autocomplete: 'off',
      inputmode: 'email',
    });
    emailInput.value = draft.email;
    const emailField = field({
      id: 'adm-owner-email-input',
      label: 'Owner’s email',
      input: emailInput,
    });
    const checkEmail = () =>
      showFieldError(
        emailInput,
        emailField.errorLine,
        isEmailShaped(emailInput.value) || !emailInput.value.trim() ? null : EMAIL_PROBLEM,
      );
    const lookupResult = el('div', {
      className: 'adm-lookup',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    function drawLookup() {
      lookupResult.replaceChildren();
      if (mode !== 'existing' || !found) return;
      const lines = [el('p', { text: `Found: ${found.email}` })];
      if (found.deleted || found.banned) {
        lines.push(el('p', { className: 'adm-field-error', text: CANNOT_OWN }));
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
          const box = el('input', {
            id: 'adm-attest',
            attrs: { type: 'checkbox' },
          });
          box.checked = draft.attest;
          box.addEventListener('change', () => {
            if (busy) {
              box.checked = draft.attest;
              return;
            }
            draft.attest = box.checked;
          });
          lines.push(
            el('p', { className: 'adm-muted', text: ADMIN_ERROR_COPY.member_password_unset }),
            el('div', { className: 'adm-check' }, [
              box,
              el('label', {
                text: 'I have confirmed that this person set their own password.',
                attrs: { for: 'adm-attest' },
              }),
            ]),
          );
        }
      }
      lookupResult.append(...lines);
    }

    const lookupButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Look up account',
      attrs: { type: 'button' },
    });

    // What a lookup is answering for (null when none is out): an answer for an address that is no longer the one
    // typed, or for an owner kind no longer chosen, is thrown away, and so is anything it had already set.
    let askedFor = null;
    function discardLookup() {
      lookupSeq += 1;
      askedFor = null;
      found = null;
      draft.attest = false;
      setBusyDisabled(lookupButton, false);
      lookupButton.textContent = 'Look up account';
    }

    async function lookUp({ quiet = false } = {}) {
      if (busy && !quiet) return;
      if (!isEmailShaped(emailInput.value)) {
        showFieldError(emailInput, emailField.errorLine, EMAIL_PROBLEM);
        emailInput.focus();
        return;
      }
      showFieldError(emailInput, emailField.errorLine, null);
      const mine = (lookupSeq += 1);
      const asked = emailInput.value.trim().toLowerCase();
      askedFor = asked;
      if (!quiet) {
        setBusyDisabled(lookupButton, true);
        lookupButton.textContent = 'Looking up…';
      }
      const result = await ask('admin_find_user', { p_email: emailInput.value.trim() });
      if (disposed || mine !== lookupSeq) return;
      askedFor = null;
      setBusyDisabled(lookupButton, false);
      lookupButton.textContent = 'Look up account';
      found = null;
      if (result.error) {
        if (isGateRefusal(result.error)) return stepAside();
        const message = result.error.timedOut ? SLOW_MESSAGE : describeAdminError(result.error);
        drawLookup();
        setFeedback(feedback, message, 'error', { focus: mayTakeFocus() });
        return;
      }
      const row = Array.isArray(result.data) ? result.data[0] : null;
      if (!row) {
        drawLookup();
        setFeedback(feedback, NO_ACCOUNT, 'error', { focus: mayTakeFocus() });
        return;
      }
      // (a quiet look, after a refusal, keeps the refusal on screen)
      if (!quiet) setFeedback(feedback, '');
      found = {
        userId: String(row.user_id ?? ''),
        email: String(row.email ?? ''),
        banned: Boolean(row.banned),
        deleted: Boolean(row.deleted),
        orgCount: Number.isInteger(row.org_count) ? row.org_count : 0,
        needsAttestation: Boolean(row.needs_attestation),
        forEmail: asked,
      };
      draft.attest = false;
      drawLookup();
    }
    lookupButton.addEventListener('click', () => lookUp());

    emailInput.addEventListener('input', () => {
      draft.email = emailInput.value;
      const now = emailInput.value.trim().toLowerCase();
      // A lookup answers for the address it was asked about, not for whatever is typed afterwards.
      if ((found && now !== found.forEmail) || (askedFor !== null && now !== askedFor)) {
        discardLookup();
        drawLookup();
      }
      if (touched.email) checkEmail();
    });
    emailInput.addEventListener('blur', () => {
      touched.email = true;
      checkEmail();
    });

    // The owner section is built ONCE and shown or hidden, never rebuilt: choosing between the two radios must not
    // replace the radio that has focus, or a keyboard user loses their place.
    const radios = {};
    const radio = (value, label) => {
      const id = `adm-owner-${value}`;
      const input = el('input', { id, attrs: { type: 'radio', name: 'adm-owner-kind', value } });
      radios[value] = input;
      input.addEventListener('change', () => {
        if (busy) {
          input.checked = mode === value;
          return;
        }
        mode = value;
        discardLookup();
        drawOwner();
      });
      return el('div', { className: 'adm-check' }, [
        input,
        el('label', { text: label, attrs: { for: id } }),
      ]);
    };
    const pickers = el('div', { className: 'adm-owner-pickers' }, [
      el('fieldset', { className: 'adm-fieldset' }, [
        el('legend', { text: 'Owner' }),
        radio('new', 'New login. The console creates it and shows a one-time password.'),
        radio('existing', 'Use an existing account'),
      ]),
      emailField.wrapper,
    ]);
    const existingBlock = el('div', { className: 'adm-existing' }, [lookupButton, lookupResult]);
    const createdBlock = el('div', { className: 'adm-created' });
    ownerHost.append(pickers, existingBlock, createdBlock);

    function drawOwner() {
      if (created) {
        // A login made here and not yet attached: it is the owner now, and the password is on screen.
        pickers.hidden = true;
        existingBlock.hidden = true;
        createdBlock.hidden = false;
        createdBlock.replaceChildren(
          el('p', {
            text: `The login for ${created.email} was created. The organisation was not. Fix whatever it says above and press Create organisation again: this login will be attached, not made twice.`,
          }),
          oneTimePasswordCard({
            idPrefix: 'adm-created',
            heading: `Login created for ${created.email}`,
            password: created.password,
            help: PASSWORD_HELP,
          }),
        );
        return;
      }
      createdBlock.replaceChildren();
      createdBlock.hidden = true;
      pickers.hidden = false;
      existingBlock.hidden = mode !== 'existing';
      radios.new.checked = mode === 'new';
      radios.existing.checked = mode === 'existing';
      drawLookup();
    }
    drawOwner();

    // ---- the submit ----
    const submit = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Create organisation',
      attrs: { type: 'submit' },
    });
    const form = el('form', { className: 'adm-form', attrs: { novalidate: 'novalidate' } }, [
      nameField.wrapper,
      slugField.wrapper,
      slugPreview,
      ownerHost,
      submit,
    ]);

    function setBusy(isBusy, message = '') {
      busy = isBusy;
      for (const control of form.querySelectorAll('input, button'))
        setBusyDisabled(control, isBusy);
      lookupButton.textContent = 'Look up account';
      submit.textContent = isBusy ? 'Creating…' : 'Create organisation';
      progress.textContent = isBusy ? message : '';
    }

    // The values as the form shows them now (autofill can fill a field without telling us).
    function readDraft() {
      draft.name = nameInput.value;
      draft.slug = slugInput.value;
      draft.email = emailInput.value;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      readDraft();

      const nameProblem = nameMessage(draft.name);
      const slugProblem = slugMessage(draft.slug);
      touched.name = touched.slug = true;
      showFieldError(nameInput, nameField.errorLine, nameProblem);
      showFieldError(slugInput, slugField.errorLine, slugProblem);
      let ownerProblem = null;
      let ownerFocus = null;
      if (!created) {
        if (!isEmailShaped(draft.email)) {
          touched.email = true;
          showFieldError(emailInput, emailField.errorLine, EMAIL_PROBLEM);
          ownerProblem = EMAIL_PROBLEM;
          ownerFocus = emailInput;
        } else if (mode === 'existing') {
          const asked = draft.email.trim().toLowerCase();
          if (!found || found.forEmail !== asked) {
            ownerProblem = LOOKUP_FIRST;
            ownerFocus = lookupButton;
          } else if (found.deleted || found.banned) {
            ownerProblem = CANNOT_OWN;
            ownerFocus = emailInput;
          } else if (found.needsAttestation && !draft.attest) {
            ownerProblem = CONFIRM_PASSWORD;
            ownerFocus = lookupResult.querySelector('#adm-attest');
          }
        }
      }
      if (nameProblem || slugProblem || ownerProblem) {
        const first = nameProblem ? nameInput : slugProblem ? slugInput : ownerFocus;
        setFeedback(
          feedback,
          ownerProblem && !nameProblem && !slugProblem ? ownerProblem : CHECK_FIELDS,
          'error',
          {
            focus: false,
          },
        );
        first?.focus();
        return;
      }

      setFeedback(feedback, '');
      await create();
    });

    async function create() {
      const name = draft.name.trim();
      const slug = normalisedSlug(draft.slug);
      const email = draft.email.trim();
      const attest = mode === 'existing' ? draft.attest : false;

      if (!created && mode === 'new') {
        setBusy(true, 'Creating the login…');
        const login = await ctx.callFunction('admin-accounts', { action: 'create_owner', email });
        if (disposed) return;
        if (login.error) {
          if (isGateRefusal(login.error) || login.error.status === 401) return stepAside();
          setBusy(false);
          setFeedback(feedback, loginFailureMessage(login.error), 'error', {
            focus: mayTakeFocus(),
          });
          if (login.error.hint === 'email_taken') offerExistingAccount();
          return;
        }
        const data = login.data;
        if (
          !UUID.test(String(data?.userId ?? '')) ||
          typeof data?.password !== 'string' ||
          data.password === ''
        ) {
          // An answer that is not what the function documents: the login may exist, so say that.
          setBusy(false);
          setFeedback(feedback, ADMIN_ERROR_COPY.account_state_unknown, 'error', {
            focus: mayTakeFocus(),
          });
          return;
        }
        created = {
          userId: data.userId,
          email: String(data.email ?? email),
          password: data.password,
        };
        syncGuard();
      }

      setBusy(true, 'Creating the organisation…');
      const ownerId = created ? created.userId : found.userId;
      const result = await ask('admin_create_org', {
        p_name: name,
        p_slug: slug,
        p_owner_user_id: ownerId,
        p_attest_own_password: attest,
      });
      if (disposed) return;
      if (result.error) {
        if (isGateRefusal(result.error)) return stepAside();
        setBusy(false);
        // A login made a moment ago stays, with its password, so the next try attaches it.
        if (created) drawOwner();
        const message = result.error.timedOut
          ? ORG_STATE_UNKNOWN
          : describeAdminError(result.error);
        setFeedback(feedback, message, 'error', { focus: mayTakeFocus() });
        // The account gained a membership since it was looked up: look again, so the box to tick appears.
        if (result.error.hint === 'member_password_unset' && mode === 'existing' && !created) {
          await lookUp({ quiet: true });
        }
        return;
      }
      const orgId = typeof result.data === 'string' && UUID.test(result.data) ? result.data : null;
      done = {
        orgId,
        name,
        slug,
        login: created ? { email: created.email, password: created.password } : null,
        passwordShown: Boolean(created),
      };
      created = null;
      found = null;
      syncGuard();
      renderDone();
    }

    // The email already has an account: the usual next step is to attach it instead.
    function offerExistingAccount() {
      const button = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Use an existing account instead',
        attrs: { type: 'button' },
      });
      button.addEventListener('click', () => {
        mode = 'existing';
        drawOwner();
        lookupButton.focus();
      });
      feedback.appendChild(button);
    }

    host.append(title, feedback, progress, form);
    if (focusHeading) title.focus();
  }

  // ---- the result ----

  function renderDone() {
    host.replaceChildren();
    const title = el('h1', {
      text: 'Organisation created',
      attrs: { tabindex: '-1', 'data-heading': 'true' },
    });
    const children = [
      title,
      el('p', {
        className: 'adm-created-line',
        text: `${done.name} was created. Its link name is ${done.slug}.`,
      }),
    ];
    const actions = el('div', { className: 'adm-actions' });
    const showActions = () => {
      if (done.orgId) {
        actions.appendChild(
          el('a', {
            className: 'btn btn-primary tap-target adm-link-button',
            text: 'View organisation',
            attrs: { href: `#/orgs/${done.orgId}` },
          }),
        );
      }
      const another = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Create another',
        attrs: { type: 'button' },
      });
      another.addEventListener('click', () => {
        done = null;
        draft.name = '';
        draft.slug = '';
        draft.email = '';
        draft.attest = false;
        mode = 'new';
        syncGuard();
        renderForm({ focusHeading: true });
      });
      actions.appendChild(another);
    };
    if (done.login && done.passwordShown) {
      children.push(
        el('p', { text: `${done.login.email} is its owner.` }),
        oneTimePasswordCard({
          idPrefix: 'adm-issued',
          heading: `One-time password for ${done.login.email}`,
          password: done.login.password,
          help: `${PASSWORD_HELP} Press Done when you have passed it on.`,
          onDone: () => {
            // The password goes with the card: nothing keeps it.
            done.login = null;
            done.passwordShown = false;
            syncGuard();
            renderDone();
          },
        }),
      );
    } else {
      showActions();
      children.push(actions);
    }
    host.append(...children);
    title.focus();
  }

  // ---- mounting ----

  renderForm();

  return {
    unmount() {
      disposed = true;
      lookupSeq += 1;
      // A one-time password must not outlive the screen it was shown on.
      created = null;
      if (done) done.login = null;
      done = null;
      guardUnload(false);
    },
  };
}
