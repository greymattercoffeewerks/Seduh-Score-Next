// "My Seduh ID" (/id/me/), T-ID2.D-b: where a person who has claimed a Seduh ID signs in again (emailed code) and manages their
// own record: their entries, their team links and their privacy settings. Phone first, on the Petrol tokens and the claim
// page's form styling (claim.css) plus the person page's year groups (profile.css).
//
//   signed out -> email -> code -> signed in: header, then "My record" | "My teams" | "Privacy"
//
// The calls are behind `api` (meApi.js) so tests drive every state with a fake. The page decides nothing: the database
// refuses or allows, and every refusal is a hint that meFlow.js turns into words (never the server's text). Text goes in
// through textContent only (el()). One persistent live region (`#me-status`) announces every save and every failure; a
// refused form also says so beside the field. Deleting or removing asks within the page, never with a browser dialog.
//
// SEAMS, on purpose: C2 a profile photo, C3 "Share to story", C5 discovery (nothing public links here yet).
import { countryOptions, HOME_COUNTRY, countryName } from '../core/country.js';
import { el } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { CONTACT_EMAIL } from './trustContent.js';
import {
  COUNTRY_LISTING,
  SEARCH_LISTING,
  ENTRY_LIMIT,
  KIND_CHOICES,
  LIMITS,
  ORGANISERS_EXPLAINED,
  COURSE_LIMIT,
  SETTINGS,
  TEAM_LINK_LIMIT,
  TEAM_ROLE_CHOICES,
  describeMeHint,
  fieldForHint,
  groupEntriesByYear,
  isSignedOutHint,
  normaliseCode,
  normaliseEmail,
  teamResultWords,
  teamRoleWord,
  validateCourseForm,
  validateEntryForm,
} from './meFlow.js';
import { formatFoundingNumber } from './claimFlow.js';
import { photoSrc } from '../core/seduhProfile.js';
import { PHOTO, prepareAvatar } from './photoPipeline.js';
import { initialsOf } from './profileFormat.js';

const KIND_WORD = Object.fromEntries(KIND_CHOICES);
const TABS = [
  ['record', 'My record'],
  ['courses', 'Courses'],
  ['teams', 'My teams'],
  ['photo', 'Photo'],
  ['privacy', 'Privacy'],
];

export function mountMeScreen(
  root,
  {
    api,
    thisYear = new Date().getUTCFullYear(),
    prepare = prepareAvatar,
    supabaseUrl = import.meta.env?.VITE_SUPABASE_URL,
  } = {},
) {
  let destroyed = false;
  let email = '';

  const main = el('main', { attrs: { id: 'me-main' } });
  root.replaceChildren(
    el('div', { className: 'me-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({}),
      main,
      buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
    ]),
  );

  // ---- small pieces ----

  const hero = ({ title, intro, kicker = 'Seduh ID', extra = [] }) =>
    el(
      'section',
      { className: 'me-hero page-hero', attrs: { 'aria-labelledby': 'me-title' } },
      [
        el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
        el('p', { className: 'page-hero-kicker', text: kicker }),
        el('h1', { id: 'me-title', text: title, attrs: { tabindex: '-1' } }),
        intro ? el('p', { className: 'page-hero-intro', text: intro }) : null,
        ...extra,
      ].filter(Boolean),
    );

  const card = (children, className = '') =>
    el('section', { className: 'me-body' }, [
      el('div', { className: `claim-card panel ${className}`.trim() }, children),
    ]);

  const statusLine = (id) =>
    el('p', { className: 'claim-feedback', attrs: { id, role: 'status' } });
  function setStatus(node, message, tone) {
    node.textContent = message ?? '';
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  function button(
    text,
    { primary = false, onClick, id, type = 'button', label, className = '' } = {},
  ) {
    const b = el('button', {
      className:
        `action ${primary ? 'action-primary' : 'action-outline'} claim-button ${className}`.trim(),
      text,
      attrs: { type, ...(id ? { id } : {}), ...(label ? { 'aria-label': label } : {}) },
    });
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  // Disabling the control that holds focus drops focus to the page, so the one that had it gets it back when it is enabled again.
  function busy(buttons, isBusy) {
    for (const b of buttons) {
      if (isBusy) {
        b.dataset.hadFocus = document.activeElement === b ? 'yes' : '';
        b.setAttribute('aria-busy', 'true');
      } else b.removeAttribute('aria-busy');
      b.disabled = isBusy;
      if (!isBusy && b.dataset.hadFocus) {
        delete b.dataset.hadFocus;
        // only when focus was dropped to the page; if the person has moved on, leave it where they put it
        if (b.isConnected && (!document.activeElement || document.activeElement === document.body))
          b.focus();
      }
    }
  }

  function field({ id, label, input, hint, status }) {
    input.id = id;
    const described = [hint ? `${id}-hint` : null, status ? status.id : null].filter(Boolean);
    if (described.length) input.setAttribute('aria-describedby', described.join(' '));
    return el(
      'div',
      { className: 'claim-field' },
      [
        el('label', { className: 'claim-label', text: label, attrs: { for: id } }),
        hint ? el('p', { className: 'claim-hint', id: `${id}-hint`, text: hint }) : null,
        input,
        status ?? null,
      ].filter(Boolean),
    );
  }

  function show(children, focus = '#me-title') {
    if (destroyed) return;
    main.replaceChildren(...children);
    main.querySelector(focus)?.focus();
  }

  // ---- loading, failure ----

  function showLoading() {
    show([
      hero({ title: 'My Seduh ID' }),
      card([el('p', { className: 'claim-message', text: 'Loading…', attrs: { role: 'status' } })]),
    ]);
  }

  function showFailure(hint) {
    show([
      hero({ title: 'My Seduh ID' }),
      card([
        el('p', {
          className: 'claim-message',
          text: describeMeHint(hint),
          attrs: { role: 'alert' },
        }),
        el('div', { className: 'claim-actions' }, [
          button('Try again', { primary: true, onClick: () => start() }),
        ]),
      ]),
    ]);
  }

  // The session is gone, or it has no Seduh ID: forget it in this tab and start at the email step.
  async function signedOut(hint) {
    await api.signOut();
    showEmail(hint ? describeMeHint(hint) : '');
  }

  // ---- 1. email ----

  function showEmail(message = '') {
    const input = el('input', {
      className: 'claim-input',
      attrs: {
        type: 'email',
        name: 'email',
        autocomplete: 'email',
        inputmode: 'email',
        autocapitalize: 'none',
        spellcheck: 'false',
        maxlength: '254',
        required: '',
      },
    });
    input.value = email;
    const status = statusLine('me-email-status');
    if (message) setStatus(status, message, 'error');
    const submit = button('Send me a code', { primary: true, type: 'submit', id: 'me-send' });
    const form = el('form', { className: 'claim-form', attrs: { novalidate: '' } }, [
      field({
        id: 'me-email',
        label: 'Your email address',
        hint: 'Use the email address you claimed your Seduh ID with. We send a 6-digit code to it.',
        input,
        status,
      }),
      el('div', { className: 'claim-actions' }, [submit]),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const typed = normaliseEmail(input.value);
      if (!typed) {
        setStatus(status, describeMeHint('bad_email'), 'error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      setStatus(status, 'Sending…');
      busy([submit], true);
      const result = await api.requestCode(typed);
      if (destroyed) return;
      if (result.ok) {
        email = typed;
        showCode();
        return;
      }
      busy([submit], false);
      setStatus(status, describeMeHint(result.hint), 'error');
      input.focus();
    });
    show(
      [
        hero({
          title: 'My Seduh ID',
          intro:
            'Sign in to manage your record and your privacy. You need to have claimed your Seduh ID first.',
        }),
        card([form]),
      ],
      message ? '#me-email' : '#me-title',
    );
  }

  // ---- 2. code ----

  function showCode() {
    const input = el('input', {
      className: 'claim-input claim-input-code',
      attrs: {
        type: 'text',
        name: 'code',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        maxlength: '14',
        required: '',
        spellcheck: 'false',
      },
    });
    const status = statusLine('me-code-status');
    const submit = button('Sign in', { primary: true, type: 'submit', id: 'me-verify' });
    const back = button('Use a different email', { onClick: () => showEmail() });
    const form = el('form', { className: 'claim-form', attrs: { novalidate: '' } }, [
      // Neutral on purpose: it must not say whether this address has a Seduh ID.
      el('p', {
        className: 'claim-message',
        id: 'me-code-sent',
        text: `If that email has a Seduh ID, we sent a code to ${email}. It can take a minute to arrive. Check your spam folder, or try again in a few minutes.`,
      }),
      field({ id: 'me-code', label: '6-digit code', input, status }),
      el('div', { className: 'claim-actions' }, [submit, back]),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = normaliseCode(input.value);
      if (!code) {
        setStatus(status, describeMeHint('bad_code'), 'error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      setStatus(status, 'Checking…');
      busy([submit, back], true);
      const verified = await api.verifyCode(email, code);
      if (destroyed) return;
      if (!verified.ok) {
        busy([submit, back], false);
        setStatus(status, describeMeHint(verified.hint), 'error');
        input.focus();
        return;
      }
      const loaded = await api.loadRecord();
      if (destroyed) return;
      if (!loaded.ok) {
        if (isSignedOutHint(loaded.hint)) return signedOut(loaded.hint);
        return showFailure(loaded.hint);
      }
      showApp(loaded.record);
    });
    show([hero({ title: 'Check your email' }), card([form])], '#me-code');
  }

  // ---- 3. signed in ----

  function showApp(initial) {
    let record = initial;
    let tab = 'record';
    let teamCountry = HOME_COUNTRY;
    // Privacy saves run one after another for the life of the screen (not per redraw), the last choice winning.
    let settingsQueue = Promise.resolve();
    const pendingByKey = new Map();
    // What the person last asked for, per setting, while a save is waiting: a panel rebuilt meanwhile shows THIS, not the older record.
    const requested = new Map();
    const shownValue = (key) => (requested.has(key) ? requested.get(key) : record.settings[key]);
    let pendingTotal = 0;

    const live = el('p', { className: 'me-live', attrs: { id: 'me-status', role: 'status' } });
    const say = (message, tone) => setStatus(live, message, tone);
    const panel = el('div', { className: 'me-panel' });
    let panelCleanup = null;
    const tabButtons = TABS.map(([key, label]) => {
      const b = el('button', {
        className: 'me-tab',
        text: label,
        attrs: { type: 'button', id: `me-tab-${key}`, 'aria-current': String(key === tab) },
      });
      b.addEventListener('click', () => go(key));
      return b;
    });

    function go(key) {
      tab = key;
      for (const [i, [k]] of TABS.entries())
        tabButtons[i].setAttribute('aria-current', String(k === tab));
      say('');
      draw();
    }

    // Shows what the record holds for one privacy setting, in place (no redraw, no focus move). Only while Privacy is shown.
    function syncControl(key) {
      if (tab !== 'privacy') return;
      const value = shownValue(key);
      if (key === COUNTRY_LISTING.key || key === SEARCH_LISTING.key) {
        const box = panel.querySelector(
          key === SEARCH_LISTING.key ? '#me-set-search' : '#me-set-listed',
        );
        if (box) box.checked = value === true;
      } else {
        const radio = panel.querySelector(`input[name="${key}"][value="${value}"]`);
        if (radio) radio.checked = true;
      }
    }

    function draw() {
      panelCleanup?.();
      panelCleanup = null;
      panel.replaceChildren(
        tab === 'record'
          ? recordPanel()
          : tab === 'courses'
            ? coursesPanel()
            : tab === 'teams'
              ? teamsPanel()
              : tab === 'photo'
                ? photoPanel()
                : privacyPanel(),
      );
    }

    // Reload the record from the database (the one source of truth) and redraw. False when the session ended.
    async function refresh() {
      const loaded = await api.loadRecord();
      if (destroyed) return false;
      if (!loaded.ok) {
        if (isSignedOutHint(loaded.hint)) await signedOut(loaded.hint);
        else say(describeMeHint(loaded.hint), 'error');
        return false;
      }
      record = loaded.record;
      draw();
      return true;
    }

    // A failed write: the session ended, or a refusal in words. Returns the words, or null when the page moved on.
    function failed(result) {
      if (isSignedOutHint(result.hint)) {
        signedOut(result.hint);
        return null;
      }
      const words = describeMeHint(result.hint);
      say(words, 'error');
      return words;
    }

    // ---- My record ----

    function entryForm(entry, { onDone }) {
      const f = entry ?? {
        year: '',
        competition_name: '',
        kind: 'competed',
        location: '',
        role: '',
        result_text: '',
        placement: '',
        note: '',
      };
      const uid = entry ? `e${entry.id}` : 'new';
      const mk = (key, label, attrs, { hint, tag = 'input' } = {}) => {
        const input = el(tag, { className: 'claim-input', attrs: { name: key, ...attrs } });
        input.value = f[key] ?? '';
        const status = statusLine(`me-${uid}-${key}-status`);
        return {
          key,
          input,
          status,
          node: field({ id: `me-${uid}-${key}`, label, input, hint, status }),
        };
      };
      const kindSelect = el(
        'select',
        { className: 'claim-input', attrs: { name: 'kind' } },
        KIND_CHOICES.map(([value, label]) => el('option', { text: label, attrs: { value } })),
      );
      kindSelect.value = f.kind;
      const kindStatus = statusLine(`me-${uid}-kind-status`);
      const kindField = {
        key: 'kind',
        input: kindSelect,
        status: kindStatus,
        node: field({
          id: `me-${uid}-kind`,
          label: 'What you did',
          input: kindSelect,
          status: kindStatus,
        }),
      };
      const fields = [
        mk(
          'year',
          'Year',
          { type: 'text', inputmode: 'numeric', maxlength: '4', required: '' },
          { hint: `From 1980 to this year.` },
        ),
        kindField,
        mk('competition_name', 'Competition', {
          type: 'text',
          maxlength: String(LIMITS.competition_name),
          required: '',
        }),
        mk('location', 'Where (optional)', { type: 'text', maxlength: String(LIMITS.location) }),
        mk(
          'role',
          'Your role (optional)',
          { type: 'text', maxlength: String(LIMITS.role) },
          { hint: 'For example competitor, head judge, organiser.' },
        ),
        mk(
          'result_text',
          'Result (optional)',
          { type: 'text', maxlength: String(LIMITS.result_text) },
          { hint: 'In your own words, for example 2nd or Finalist.' },
        ),
        mk(
          'placement',
          'Place as a number (optional)',
          { type: 'text', inputmode: 'numeric', maxlength: '3' },
          { hint: 'Used to find your best result. Leave it empty if you have no placing.' },
        ),
        mk(
          'note',
          'Note (optional)',
          { maxlength: String(LIMITS.note), rows: '3' },
          { tag: 'textarea' },
        ),
      ];
      const formStatus = statusLine(`me-${uid}-status`);
      const submit = button(entry ? 'Save changes' : 'Add entry', {
        primary: true,
        type: 'submit',
      });
      const cancel = button('Cancel', { onClick: () => onDone(false) });
      const form = el(
        'form',
        {
          className: 'claim-form me-entry-form',
          attrs: {
            novalidate: '',
            'aria-label': entry ? `Edit ${entry.competition_name}` : 'Add an entry',
          },
        },
        [
          el(
            'div',
            { className: 'me-form-grid' },
            fields.map((x) => x.node),
          ),
          formStatus,
          el('div', { className: 'claim-actions' }, [submit, cancel]),
        ],
      );
      const mark = (errors) => {
        let first = null;
        for (const x of fields) {
          const hint = errors[x.key];
          setStatus(x.status, hint ? describeMeHint(hint) : '', hint ? 'error' : null);
          if (hint) {
            x.input.setAttribute('aria-invalid', 'true');
            first ??= x.input;
          } else x.input.removeAttribute('aria-invalid');
        }
        return first;
      };
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(fields.map((x) => [x.key, x.input.value]));
        const checked = validateEntryForm(values, { thisYear });
        if (!checked.ok) {
          setStatus(
            formStatus,
            'Some details need a change. Check the fields marked Problem.',
            'error',
          );
          mark(checked.errors)?.focus();
          return;
        }
        mark({});
        setStatus(formStatus, 'Saving…');
        busy([submit, cancel], true);
        const result = entry
          ? await api.updateEntry(entry.id, checked.params)
          : await api.addEntry(checked.params);
        if (destroyed) return;
        if (!result.ok) {
          busy([submit, cancel], false);
          if (isSignedOutHint(result.hint)) return void signedOut(result.hint);
          const words = describeMeHint(result.hint);
          const key = fieldForHint(result.hint);
          const target = fields.find((x) => x.key === key);
          if (target) {
            mark({ [key]: result.hint })?.focus();
            setStatus(formStatus, 'That could not be saved.', 'error');
          } else {
            setStatus(formStatus, words, 'error');
          }
          say(words, 'error');
          return;
        }
        say(entry ? 'Entry saved.' : 'Entry added.');
        busy([submit, cancel], false);
        onDone(true);
      });
      return form;
    }

    function entryRow(entry) {
      const row = el('li', { className: 'me-entry' });
      const showView = () => {
        const detail = [
          entry.role,
          entry.result_text,
          entry.placement ? `place ${entry.placement}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const meta = [KIND_WORD[entry.kind], entry.location].filter(Boolean).join(' · ');
        const edit = button('Edit', { label: `Edit ${entry.competition_name}`, onClick: showEdit });
        const del = button('Delete', {
          label: `Delete ${entry.competition_name}`,
          onClick: showDelete,
        });
        row.replaceChildren(
          el(
            'div',
            { className: 'me-entry-main' },
            [
              el('span', { className: 'me-entry-title', text: entry.competition_name }),
              el('span', { className: 'me-entry-meta', text: meta }),
              detail ? el('span', { className: 'me-entry-detail', text: detail }) : null,
              entry.note ? el('span', { className: 'me-entry-note', text: entry.note }) : null,
            ].filter(Boolean),
          ),
          el('div', { className: 'me-entry-actions' }, [edit, del]),
        );
        return { edit, del };
      };
      function showEdit() {
        const form = entryForm(entry, {
          onDone: async (saved) => {
            if (saved) {
              if (await refresh()) document.getElementById('me-record-title')?.focus();
            } else {
              const { edit } = showView();
              edit.focus();
            }
          },
        });
        row.replaceChildren(form);
        form.querySelector('input')?.focus();
      }
      function showDelete() {
        const confirmButton = button('Yes, delete it', {
          primary: true,
          id: `me-delete-${entry.id}`,
          className: 'me-danger',
        });
        const keep = button('Keep it', {
          onClick: () => {
            const { del } = showView();
            del.focus();
          },
        });
        const note = el('p', {
          className: 'claim-message',
          text: `Delete “${entry.competition_name}” (${entry.year})? This cannot be undone.`,
          attrs: { id: `me-delete-q-${entry.id}`, role: 'alert' },
        });
        confirmButton.setAttribute('aria-describedby', note.id);
        confirmButton.addEventListener('click', async () => {
          busy([confirmButton, keep], true);
          const result = await api.deleteEntry(entry.id);
          if (destroyed) return;
          if (!result.ok) {
            busy([confirmButton, keep], false);
            failed(result);
            return;
          }
          say('Entry deleted.');
          if (await refresh()) document.getElementById('me-record-title')?.focus();
        });
        row.replaceChildren(note, el('div', { className: 'claim-actions' }, [confirmButton, keep]));
        keep.focus();
      }
      showView();
      return row;
    }

    function recordPanel() {
      const count = record.entries.length;
      const formHost = el('div', { className: 'me-form-host' });
      const addButton = button('Add an entry', { primary: true, id: 'me-add-entry' });
      if (count >= ENTRY_LIMIT) addButton.disabled = true;
      addButton.addEventListener('click', () => {
        const form = entryForm(null, {
          onDone: async (saved) => {
            if (saved) {
              if (await refresh()) document.getElementById('me-add-entry')?.focus();
            } else {
              formHost.replaceChildren();
              addButton.focus();
            }
          },
        });
        formHost.replaceChildren(form);
        form.querySelector('input')?.focus();
      });
      const groups = groupEntriesByYear(record.entries);
      return el(
        'section',
        { className: 'me-section', attrs: { 'aria-labelledby': 'me-record-title' } },
        [
          el('h2', {
            id: 'me-record-title',
            className: 'claim-h2',
            text: 'My record',
            attrs: { tabindex: '-1' },
          }),
          el('p', {
            className: 'claim-hint',
            text: 'Entries you add here show on your page, labelled “Self-reported, not verified by Seduh”. Only you can change them. Results recorded by Seduh Score and team results from organisers are not listed here: they are not yours to edit.',
          }),
          el('p', { className: 'me-count', text: `${count} of ${ENTRY_LIMIT} entries` }),
          count >= ENTRY_LIMIT
            ? el('p', {
                className: 'claim-feedback',
                attrs: { 'data-tone': 'error' },
                text: describeMeHint('too_many_entries'),
              })
            : null,
          el('div', { className: 'claim-actions' }, [addButton]),
          formHost,
          count === 0
            ? el('p', { className: 'claim-hint', text: 'You have not added any entries yet.' })
            : el(
                'div',
                { className: 'me-years' },
                groups.map((g, i) =>
                  el('details', { className: 'profile-year', attrs: i === 0 ? { open: '' } : {} }, [
                    el('summary', { className: 'profile-year-head' }, [
                      el('h3', { className: 'profile-year-label', text: String(g.year) }),
                      el('span', {
                        className: 'profile-year-count',
                        text: `${g.entries.length} ${g.entries.length === 1 ? 'entry' : 'entries'}`,
                      }),
                      el('span', {
                        className: 'profile-year-cue',
                        attrs: { 'aria-hidden': 'true' },
                      }),
                    ]),
                    el(
                      'ul',
                      { className: 'me-entry-list', attrs: { role: 'list' } },
                      g.entries.map(entryRow),
                    ),
                  ]),
                ),
              ),
        ].filter(Boolean),
      );
    }

    // ---- My teams ----

    function linkRow(link) {
      const row = el('li', { className: 'me-entry' });
      const view = () => {
        const result = teamResultWords(link);
        const rm = button('Remove', {
          label: `Remove ${link.team_name}, ${link.edition_year ?? ''}`.trim(),
          onClick: ask,
        });
        row.replaceChildren(
          el(
            'div',
            { className: 'me-entry-main' },
            [
              el('span', {
                className: 'me-entry-title',
                text: `${link.team_name}${link.country_code ? ` (${link.country_code})` : ''}`,
              }),
              el('span', {
                className: 'me-entry-meta',
                text: [link.competition_name, link.edition_year].filter(Boolean).join(' '),
              }),
              el('span', {
                className: 'me-entry-detail',
                text: [teamRoleWord(link.role), result].filter(Boolean).join(' · '),
              }),
              el('span', {
                className: 'me-link-state tag',
                text:
                  link.membership === 'confirmed'
                    ? 'Membership confirmed'
                    : 'Membership self-reported',
              }),
              link.listed
                ? null
                : el('span', {
                    className: 'me-entry-note',
                    text: 'This team result is no longer listed, so it is not on your public page. You can remove the link.',
                  }),
            ].filter(Boolean),
          ),
          el('div', { className: 'me-entry-actions' }, [rm]),
        );
        return rm;
      };
      function ask() {
        const yes = button('Yes, remove it', { primary: true, className: 'me-danger' });
        const keep = button('Keep it', { onClick: () => view().focus() });
        const note = el('p', {
          className: 'claim-message',
          text: `Remove your link to ${link.team_name}${link.edition_year ? ` (${link.edition_year})` : ''}? You can link it again later, but a confirmation would be lost.`,
          attrs: { id: `me-remove-q-${link.id}`, role: 'alert' },
        });
        yes.setAttribute('aria-describedby', note.id);
        yes.addEventListener('click', async () => {
          busy([yes, keep], true);
          const result = await api.removeTeamLink(link.id);
          if (destroyed) return;
          if (!result.ok) {
            busy([yes, keep], false);
            failed(result);
            return;
          }
          say('Team link removed.');
          if (await refresh()) document.getElementById('me-teams-title')?.focus();
        });
        row.replaceChildren(note, el('div', { className: 'claim-actions' }, [yes, keep]));
        keep.focus();
      }
      view();
      return row;
    }

    function teamsPanel() {
      const links = record.teamLinks;
      const picker = el('div', { className: 'me-picker' });
      const countrySelect = el('select', { className: 'claim-input', attrs: { name: 'country' } }, [
        el('option', { text: 'Any country', attrs: { value: '' } }),
        ...countryOptions().map((c) =>
          el('option', { text: `${c.name} (${c.iso})`, attrs: { value: c.iso } }),
        ),
      ]);
      countrySelect.value = teamCountry;
      let seq = 0;
      async function loadOptions() {
        const mine = ++seq;
        picker.replaceChildren(
          el('p', {
            className: 'claim-hint',
            text: 'Looking for teams…',
            attrs: { role: 'status' },
          }),
        );
        const result = await api.teamOptions(countrySelect.value);
        if (destroyed || mine !== seq) return;
        if (!result.ok) {
          picker.replaceChildren(
            el('p', {
              className: 'claim-feedback',
              attrs: { 'data-tone': 'error', role: 'alert' },
              text: describeMeHint(result.hint),
            }),
          );
          if (isSignedOutHint(result.hint)) signedOut(result.hint);
          return;
        }
        const { teams, truncated } = result.options;
        if (teams.length === 0) {
          const where = countrySelect.value ? ` for ${countryName(countrySelect.value)}` : '';
          picker.replaceChildren(
            el('p', {
              className: 'claim-hint',
              text: `No team results${where} are available to link yet.`,
            }),
          );
          return;
        }
        picker.replaceChildren(
          el(
            'ul',
            { className: 'me-entry-list', attrs: { role: 'list' } },
            teams.map((t) => teamOption(t)),
          ),
          truncated
            ? el('p', {
                className: 'claim-hint',
                text: 'There are more teams than we can show. Choose a country to narrow the list.',
              })
            : null,
        );
      }
      function teamOption(t) {
        const roleSelect = el(
          'select',
          {
            className: 'claim-input me-role-select',
            attrs: {
              name: 'role',
              'aria-label': `Your role in ${t.team_name} ${t.edition_year ?? ''}`,
            },
          },
          TEAM_ROLE_CHOICES.map(([value, label]) =>
            el('option', { text: label, attrs: { value } }),
          ),
        );
        const add = button('Link me', {
          primary: true,
          label: `Link me to ${t.team_name}, ${t.edition_year ?? ''}`.trim(),
        });
        const li = el('li', { className: 'me-entry' }, [
          el('div', { className: 'me-entry-main' }, [
            el('span', {
              className: 'me-entry-title',
              text: `${t.team_name}${t.country_code ? ` (${t.country_code})` : ''}`,
            }),
            el('span', {
              className: 'me-entry-meta',
              text: [t.competition_name, t.edition_year].filter(Boolean).join(' '),
            }),
            el('span', { className: 'me-entry-detail', text: teamResultWords(t) }),
          ]),
          t.linked
            ? el('div', { className: 'me-entry-actions' }, [
                el('span', { className: 'me-link-state tag', text: 'Already linked' }),
              ])
            : el('div', { className: 'me-entry-actions' }, [roleSelect, add]),
        ]);
        add.addEventListener('click', async () => {
          busy([add, roleSelect], true);
          const result = await api.addTeamLink(t.team_key, roleSelect.value);
          if (destroyed) return;
          if (!result.ok) {
            busy([add, roleSelect], false);
            failed(result);
            return;
          }
          say('Team linked. It shows as self-reported until it is confirmed.');
          if (await refresh()) document.getElementById('me-teams-title')?.focus();
        });
        return li;
      }
      countrySelect.addEventListener('change', () => {
        teamCountry = countrySelect.value;
        loadOptions();
      });
      loadOptions();
      return el(
        'section',
        { className: 'me-section', attrs: { 'aria-labelledby': 'me-teams-title' } },
        [
          el('h2', {
            id: 'me-teams-title',
            className: 'claim-h2',
            text: 'My teams',
            attrs: { tabindex: '-1' },
          }),
          el('p', {
            className: 'claim-hint',
            text: 'A team link says you were part of a team in a given year, from the organisers’ records of championships. It shows on your page as “Self-reported” until it is confirmed. Only a teammate or Seduh Score can confirm it, not you; for now Seduh Score confirms it after checking with a teammate or the organiser. Only you can link yourself to a team: nobody else can add you.',
          }),
          el('p', {
            className: 'me-count',
            text: `${links.length} of ${TEAM_LINK_LIMIT} team links`,
          }),
          links.length === 0
            ? el('p', { className: 'claim-hint', text: 'You have not linked a team yet.' })
            : el('ul', { className: 'me-entry-list', attrs: { role: 'list' } }, links.map(linkRow)),
          el('h3', { className: 'me-h3', text: 'Link a team' }),
          field({ id: 'me-country', label: 'Country of the team', input: countrySelect }),
          picker,
        ],
      );
    }

    // ---- Photo (T-ID2.C2) ----
    // Choose, crop square, resize to 512, re-encode, check 200 KB (photoPipeline.js), upload with this person's own session, record.
    // The picture is shown as a preview before anything is sent; the original file never leaves the browser.
    function photoPanel() {
      let prepared = null;
      let previewUrl = null;
      let left = false; // set when the tab is left
      let choice = 0; // the latest choice wins: an earlier, slower prepare() must not overwrite it
      const currentSrc = photoSrc(record.account.photoUrl, supabaseUrl);
      const name = record.account.displayName ?? record.account.handle;
      const status = statusLine('me-photo-status');

      const frame = el('div', { className: 'me-photo-frame' });
      function showInitials(label = 'No photo yet: your initials show instead') {
        frame.replaceChildren(
          el('span', {
            className: 'me-photo-initials',
            text: initialsOf(name),
            attrs: { role: 'img', 'aria-label': label },
          }),
        );
      }
      // what the frame shows when nothing is being previewed: the saved photo, or the initials
      function showCurrent() {
        if (currentSrc) showImage(currentSrc, `Photo of ${name}`);
        else showInitials();
      }
      function showImage(src, alt) {
        const img = el('img', {
          className: 'me-photo-img',
          attrs: { src, alt, width: String(PHOTO.size), height: String(PHOTO.size) },
        });
        img.addEventListener(
          'error',
          () => showInitials('Your photo could not be loaded: your initials show instead'),
          {
            once: true,
          },
        );
        frame.replaceChildren(img);
      }
      showCurrent();

      const input = el('input', {
        className: 'me-photo-file',
        attrs: {
          type: 'file',
          id: 'me-photo-file',
          accept: PHOTO.inputTypes.join(','),
          'aria-describedby': 'me-photo-help me-photo-status',
        },
      });
      const save = button('Save photo', { primary: true, id: 'me-photo-save' });
      save.hidden = true;
      const removeBtn = button('Remove my photo', { id: 'me-photo-remove' });
      removeBtn.hidden = !currentSrc;
      const actions = el('div', { className: 'claim-actions' }, [save, removeBtn]);
      const ask = el('div', { className: 'me-photo-ask' });

      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        const mine = ++choice;
        prepared = null;
        save.hidden = true;
        setStatus(status, '');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        if (!file) {
          showCurrent(); // a cancelled dialog: back to the saved photo, not a preview nobody can save
          return;
        }
        setStatus(status, 'Preparing your photo…');
        const result = await prepare(file);
        if (destroyed || left || mine !== choice) return;
        if (!result.ok) {
          input.value = '';
          setStatus(status, describeMeHint(result.hint), 'error');
          return;
        }
        prepared = result;
        previewUrl = URL.createObjectURL(result.blob);
        showImage(previewUrl, 'Preview of your new photo');
        setStatus(
          status,
          `Ready: ${Math.round(result.size / 1024)} KB, ${PHOTO.size} × ${PHOTO.size}. Press the button to use it.`,
        );
        save.hidden = false;
        save.textContent = currentSrc ? 'Replace my photo' : 'Save photo';
      });

      // leaving the tab (the panel is rebuilt) must not leak the preview's object URL
      const release = () => {
        left = true;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      };
      panelCleanup = release;

      save.addEventListener('click', async () => {
        if (!prepared) return;
        busy([save, removeBtn, input], true);
        setStatus(status, 'Uploading…');
        const result = await api.setPhoto({
          prepared,
          handle: record.account.handle,
          previousUrl: record.account.photoUrl,
        });
        if (destroyed) return;
        if (!result.ok) {
          busy([save, removeBtn, input], false);
          if (isSignedOutHint(result.hint)) failed(result);
          else setStatus(status, describeMeHint(result.hint), 'error');
          return;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        say('Photo saved.');
        if (await refresh()) document.getElementById('me-photo-file')?.focus();
        else {
          // the reload failed: the controls must not stay dead, and the status must not stay at "Uploading…"
          busy([save, removeBtn, input], false);
          setStatus(
            status,
            'Your photo was saved, but we could not refresh this page. Reload it to see it.',
          );
          save.hidden = true;
          prepared = null;
        } // the reload failed: the controls must not stay dead
      });

      removeBtn.addEventListener('click', () => {
        const yes = button('Yes, remove it', {
          primary: true,
          id: 'me-photo-remove-yes',
          className: 'me-danger',
        });
        const keep = button('Keep it', {
          onClick: () => {
            ask.replaceChildren();
            removeBtn.focus();
          },
        });
        const note = el('p', {
          className: 'claim-message',
          text: 'Remove your photo? Your page will show your initials again.',
          attrs: { id: 'me-photo-remove-q', role: 'alert' },
        });
        yes.setAttribute('aria-describedby', note.id);
        yes.addEventListener('click', async () => {
          busy([yes, keep], true);
          const result = await api.removePhoto(record.account.photoUrl);
          if (destroyed) return;
          if (!result.ok) {
            busy([yes, keep], false);
            if (isSignedOutHint(result.hint)) failed(result);
            else setStatus(status, describeMeHint(result.hint), 'error');
            return;
          }
          say('Photo removed.');
          ask.replaceChildren();
          removeBtn.hidden = true;
          showInitials();
          if (await refresh()) document.getElementById('me-photo-file')?.focus();
        });
        ask.replaceChildren(note, el('div', { className: 'claim-actions' }, [yes, keep]));
        keep.focus();
      });

      return el(
        'div',
        { className: 'me-photo' },
        [
          el('h2', {
            id: 'me-photo-title',
            className: 'claim-h2',
            text: 'My photo',
            attrs: { tabindex: '-1' },
          }),
          el('p', {
            className: 'claim-hint',
            id: 'me-photo-help',
            text: 'Your photo shows on your public page while your name is public. We crop it to a square, shrink it and remove any location data before it is uploaded. Anyone can report a photo, and you can remove yours at any time.',
          }),
          frame,
          el('div', { className: 'claim-field' }, [
            el('label', {
              className: 'claim-label',
              text: 'Choose a photo (JPEG, PNG or WebP, up to 10 MB)',
              attrs: { for: 'me-photo-file' },
            }),
            input,
            status,
          ]),
          actions,
          ask,
          record.settings.vis_identity !== 'public'
            ? el('p', {
                className: 'claim-hint',
                text: 'Your name is hidden on your public page, so your photo is hidden there too. The picture stays stored until you remove it. Change your name setting under Privacy.',
              })
            : null,
        ].filter(Boolean),
      );
    }

    // ---- Courses and certificates (T-ID2.C6a, C6b) ----

    function courseForm(course, { onDone }) {
      const f = course
        ? {
            ...course,
            year: String(course.completed_year),
            valid_until_year: course.valid_until_year ?? '',
          }
        : { title: '', provider: '', year: '', valid_until_year: '', level: '', note: '' };
      const uid = course ? `c${course.id}` : 'cnew';
      const mk = (key, label, attrs, { hint, tag = 'input' } = {}) => {
        const input = el(tag, { className: 'claim-input', attrs: { name: key, ...attrs } });
        input.value = f[key] ?? '';
        const status = statusLine(`me-${uid}-${key}-status`);
        return {
          key,
          input,
          status,
          node: field({ id: `me-${uid}-${key}`, label, input, hint, status }),
        };
      };
      const fields = [
        mk('title', 'Course or certificate', {
          type: 'text',
          maxlength: String(LIMITS.course_title),
          required: '',
        }),
        mk('provider', 'Who ran it', {
          type: 'text',
          maxlength: String(LIMITS.course_provider),
          required: '',
        }),
        mk(
          'year',
          'Year completed',
          { type: 'text', inputmode: 'numeric', maxlength: '4', required: '' },
          { hint: 'From 1980 to this year.' },
        ),
        mk(
          'valid_until_year',
          'Valid until (optional)',
          { type: 'text', inputmode: 'numeric', maxlength: '4' },
          { hint: 'The year it runs out, if it does. Leave empty if it does not expire.' },
        ),
        mk(
          'level',
          'Level (optional)',
          { type: 'text', maxlength: String(LIMITS.course_level) },
          { hint: 'For example Intermediate.' },
        ),
        mk(
          'note',
          'Note (optional)',
          { maxlength: String(LIMITS.course_note), rows: '3' },
          { tag: 'textarea' },
        ),
      ];
      const formStatus = statusLine(`me-${uid}-status`);
      const submit = button(course ? 'Save changes' : 'Add course', {
        primary: true,
        type: 'submit',
      });
      const cancel = button('Cancel', { onClick: () => onDone(false) });
      const form = el(
        'form',
        {
          className: 'claim-form me-entry-form',
          attrs: {
            novalidate: '',
            'aria-label': course ? `Edit ${course.title}` : 'Add a course or certificate',
          },
        },
        [
          el(
            'div',
            { className: 'me-form-grid' },
            fields.map((x) => x.node),
          ),
          formStatus,
          el('div', { className: 'claim-actions' }, [submit, cancel]),
        ],
      );
      const mark = (errors) => {
        let first = null;
        for (const x of fields) {
          const hint = errors[x.key];
          setStatus(x.status, hint ? describeMeHint(hint) : '', hint ? 'error' : null);
          if (hint) {
            x.input.setAttribute('aria-invalid', 'true');
            first ??= x.input;
          } else x.input.removeAttribute('aria-invalid');
        }
        return first;
      };
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(fields.map((x) => [x.key, x.input.value]));
        const checked = validateCourseForm(values, { thisYear });
        if (!checked.ok) {
          setStatus(
            formStatus,
            'Some details need a change. Check the fields marked Problem.',
            'error',
          );
          mark(checked.errors)?.focus();
          return;
        }
        mark({});
        setStatus(formStatus, 'Saving…');
        busy([submit, cancel], true);
        const result = course
          ? await api.updateCourse(course.id, checked.params)
          : await api.addCourse(checked.params);
        if (destroyed) return;
        if (!result.ok) {
          busy([submit, cancel], false);
          if (isSignedOutHint(result.hint)) return void signedOut(result.hint);
          const words = describeMeHint(result.hint);
          const key = fieldForHint(result.hint);
          if (fields.some((x) => x.key === key)) {
            mark({ [key]: result.hint })?.focus();
            setStatus(formStatus, 'That could not be saved.', 'error');
          } else {
            setStatus(formStatus, words, 'error');
          }
          say(words, 'error');
          return;
        }
        say(course ? 'Course saved.' : 'Course added.');
        busy([submit, cancel], false);
        onDone(true);
      });
      return form;
    }

    function courseRow(course) {
      const row = el('li', { className: 'me-entry' });
      const showView = () => {
        const when = [
          `Completed ${course.completed_year}`,
          course.valid_until_year === null
            ? null
            : course.current
              ? `valid until ${course.valid_until_year}`
              : `expired ${course.valid_until_year}`,
        ]
          .filter(Boolean)
          .join(' · ');
        const meta = [course.provider, course.level].filter(Boolean).join(' · ');
        const edit = button('Edit', { label: `Edit ${course.title}`, onClick: showEdit });
        const del = button('Delete', { label: `Delete ${course.title}`, onClick: showDelete });
        // C6b: ONE current certificate may be shown on the story card; off unless chosen
        const cardWord = course.on_card ? 'Remove from my card' : 'Show on my card';
        const card = course.current
          ? button(cardWord, {
              id: `me-card-course-${course.id}`,
              label: `${cardWord}: ${course.title}`,
              onClick: async () => {
                busy([card, edit, del], true);
                const result = await api.setCardCourse(course.on_card ? null : course.id);
                if (destroyed) return;
                if (!result.ok) {
                  busy([card, edit, del], false);
                  failed(result);
                  return;
                }
                say(
                  course.on_card
                    ? 'Removed from your card.'
                    : 'This certificate will show on your card.',
                );
                if (await refresh())
                  document.getElementById(`me-card-course-${course.id}`)?.focus();
                else busy([card, edit, del], false);
              },
            })
          : null;
        row.replaceChildren(
          el(
            'div',
            { className: 'me-entry-main' },
            [
              el('span', { className: 'me-entry-title', text: course.title }),
              el('span', { className: 'me-entry-meta', text: meta }),
              el('span', {
                className: `me-entry-detail${course.current ? '' : ' me-course-expired'}`,
                text: when,
              }),
              course.on_card
                ? el('span', { className: 'me-card-badge tag', text: 'Shown on your card' })
                : null,
              course.note ? el('span', { className: 'me-entry-note', text: course.note }) : null,
            ].filter(Boolean),
          ),
          el('div', { className: 'me-entry-actions' }, [edit, del, card].filter(Boolean)),
        );
        return { edit, del };
      };
      function showEdit() {
        const form = courseForm(course, {
          onDone: async (saved) => {
            if (saved) {
              if (await refresh()) document.getElementById('me-courses-title')?.focus();
            } else {
              const { edit } = showView();
              edit.focus();
            }
          },
        });
        row.replaceChildren(form);
        form.querySelector('input')?.focus();
      }
      function showDelete() {
        const confirmButton = button('Yes, delete it', {
          primary: true,
          id: `me-delete-course-${course.id}`,
          className: 'me-danger',
        });
        const keep = button('Keep it', {
          onClick: () => {
            const { del } = showView();
            del.focus();
          },
        });
        const note = el('p', {
          className: 'claim-message',
          text: `Delete “${course.title}” (${course.completed_year})? This cannot be undone.`,
          attrs: { id: `me-delete-course-q-${course.id}`, role: 'alert' },
        });
        confirmButton.setAttribute('aria-describedby', note.id);
        confirmButton.addEventListener('click', async () => {
          busy([confirmButton, keep], true);
          const result = await api.deleteCourse(course.id);
          if (destroyed) return;
          if (!result.ok) {
            busy([confirmButton, keep], false);
            failed(result);
            return;
          }
          say('Course deleted.');
          if (await refresh()) document.getElementById('me-courses-title')?.focus();
          else busy([confirmButton, keep], false);
        });
        row.replaceChildren(note, el('div', { className: 'claim-actions' }, [confirmButton, keep]));
        keep.focus();
      }
      showView();
      return row;
    }

    function coursesPanel() {
      const count = record.courses.length;
      const formHost = el('div', { className: 'me-form-host' });
      const addButton = button('Add a course', { primary: true, id: 'me-add-course' });
      if (count >= COURSE_LIMIT) addButton.disabled = true;
      addButton.addEventListener('click', () => {
        const form = courseForm(null, {
          onDone: async (saved) => {
            if (saved) {
              if (await refresh()) {
                // at the limit the add button is disabled and cannot take focus
                const add = document.getElementById('me-add-course');
                (add && !add.disabled ? add : document.getElementById('me-courses-title'))?.focus();
              }
            } else {
              formHost.replaceChildren();
              addButton.focus();
            }
          },
        });
        formHost.replaceChildren(form);
        form.querySelector('input')?.focus();
      });
      const hidden = shownValue('vis_courses') === 'hidden';
      return el(
        'section',
        { className: 'me-section', attrs: { 'aria-labelledby': 'me-courses-title' } },
        [
          el('h2', {
            id: 'me-courses-title',
            className: 'claim-h2',
            text: 'Courses and certificates',
            attrs: { tabindex: '-1' },
          }),
          el('p', {
            className: 'claim-hint',
            text: 'Training you have completed, such as a barista or grading course. It shows in your record on your page, labelled “Self-reported, not verified by Seduh”, and does not count towards your entries or podiums. Only you can change it. No certificate numbers, pictures or links.',
          }),
          hidden
            ? el('p', {
                className: 'claim-hint',
                text: 'Your courses are hidden: nobody sees them on your page. Change this under Privacy.',
              })
            : null,
          el('p', { className: 'me-count', text: `${count} of ${COURSE_LIMIT} courses` }),
          count >= COURSE_LIMIT
            ? el('p', {
                className: 'claim-feedback',
                attrs: { 'data-tone': 'error' },
                text: describeMeHint('too_many_courses'),
              })
            : null,
          el('div', { className: 'claim-actions' }, [addButton]),
          formHost,
          count === 0
            ? el('p', { className: 'claim-hint', text: 'You have not added any courses yet.' })
            : el(
                'ul',
                { className: 'me-entry-list', attrs: { role: 'list' } },
                record.courses.map(courseRow),
              ),
          count > 0
            ? el('p', {
                className: 'claim-hint',
                text: 'You can show one current certificate as “Certified: …” under your name on your story card. It is off unless you choose it.',
              })
            : null,
        ].filter(Boolean),
      );
    }

    // ---- Privacy ----

    function privacyPanel() {
      const rows = SETTINGS.map((s) => {
        const legendId = `me-set-${s.key}-legend`;
        const radios = s.choices.map(([value, label]) => {
          const input = el('input', {
            className: 'me-radio',
            attrs: { type: 'radio', name: s.key, value },
          });
          input.checked = shownValue(s.key) === value;
          input.addEventListener('change', () => save(s.key, value, label));
          return el('label', { className: 'me-choice' }, [input, el('span', { text: label })]);
        });
        return el('fieldset', { className: 'me-setting' }, [
          el('legend', { id: legendId, className: 'claim-label', text: s.label }),
          el('p', { className: 'claim-hint', text: s.help }),
          el('div', { className: 'me-choices' }, radios),
        ]);
      });
      const listed = el('input', {
        className: 'claim-checkbox',
        attrs: {
          type: 'checkbox',
          id: 'me-set-listed',
          name: COUNTRY_LISTING.key,
          'aria-describedby': 'me-set-listed-help',
        },
      });
      listed.checked = shownValue(COUNTRY_LISTING.key) === true;
      listed.addEventListener('change', () =>
        save(COUNTRY_LISTING.key, listed.checked, listed.checked ? 'on' : 'off'),
      );

      const searchBox = el('input', {
        className: 'claim-checkbox',
        attrs: {
          type: 'checkbox',
          id: 'me-set-search',
          name: SEARCH_LISTING.key,
          'aria-describedby': 'me-set-search-help',
        },
      });
      searchBox.checked = shownValue(SEARCH_LISTING.key) !== false;
      searchBox.addEventListener('change', () =>
        save(SEARCH_LISTING.key, searchBox.checked, searchBox.checked ? 'on' : 'off'),
      );

      // Each change is saved at once and announced. The controls are never disabled and the panel is never redrawn by a save,
      // so keyboard focus and whatever else the person is doing stay where they are; a refusal puts the control back to what
      // the record holds (syncControl), once no later change to the same setting is waiting.
      function save(key, value, word) {
        if (pendingTotal === 0) say('Saving…');
        pendingTotal += 1;
        pendingByKey.set(key, (pendingByKey.get(key) ?? 0) + 1);
        requested.set(key, value);
        settingsQueue = settingsQueue.then(() => persist(key, value, word)).catch(() => {});
      }
      async function persist(key, value, word) {
        try {
          if (destroyed) return;
          const result = await api.setSettings({ [key]: value });
          if (destroyed) return;
          if (!result.ok) {
            failed(result);
            return;
          }
          const label =
            SETTINGS.find((x) => x.key === key)?.label ??
            (key === SEARCH_LISTING.key ? SEARCH_LISTING.label : COUNTRY_LISTING.label);
          const next = result.data && typeof result.data === 'object' ? result.data : {};
          record = {
            ...record,
            settings: { ...record.settings, [key]: key in next ? next[key] : value },
          };
          say(
            key === COUNTRY_LISTING.key || key === SEARCH_LISTING.key
              ? `${label}: ${value ? 'on' : 'off'}. Saved.`
              : `${label}: ${word}. Saved.`,
          );
        } finally {
          pendingTotal -= 1;
          const left = (pendingByKey.get(key) ?? 1) - 1;
          pendingByKey.set(key, left);
          if (left === 0) {
            requested.delete(key);
            syncControl(key);
          }
        }
      }
      return el(
        'section',
        { className: 'me-section', attrs: { 'aria-labelledby': 'me-privacy-title' } },
        [
          el('h2', {
            id: 'me-privacy-title',
            className: 'claim-h2',
            text: 'Privacy',
            attrs: { tabindex: '-1' },
          }),
          el('p', {
            className: 'claim-hint',
            text: 'Choose what is public on your Seduh ID page. Each change is saved the moment you make it and takes effect at once. Your phone number and email address are never shown, and cannot be.',
          }),
          el('p', { className: 'claim-hint', text: ORGANISERS_EXPLAINED }),
          el('div', { className: 'me-settings' }, rows),
          el('div', { className: 'me-setting' }, [
            el('label', { className: 'claim-check', attrs: { for: 'me-set-listed' } }, [
              listed,
              el('span', { text: COUNTRY_LISTING.label }),
            ]),
            el('p', {
              className: 'claim-hint',
              id: 'me-set-listed-help',
              text: COUNTRY_LISTING.help,
            }),
          ]),
          el('div', { className: 'me-setting' }, [
            el('label', { className: 'claim-check', attrs: { for: 'me-set-search' } }, [
              searchBox,
              el('span', { text: SEARCH_LISTING.label }),
            ]),
            el('p', {
              className: 'claim-hint',
              id: 'me-set-search-help',
              text: SEARCH_LISTING.help,
            }),
          ]),
          el('p', { className: 'claim-hint' }, [
            document.createTextNode(
              'To have your Seduh ID closed, or something removed or corrected, write to ',
            ),
            el('a', {
              className: 'claim-link',
              text: CONTACT_EMAIL,
              attrs: {
                href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Seduh ID: ${record.account.handle}`)}`,
              },
            }),
            document.createTextNode('.'),
          ]),
        ],
      );
    }

    // ---- the page ----

    const founding = formatFoundingNumber(record.account.foundingNumber);
    const signOut = button('Sign out', {
      id: 'me-signout',
      onClick: async () => {
        await api.signOut();
        if (!destroyed) {
          email = '';
          showEmail();
        }
      },
    });
    show([
      hero({
        title: record.account.displayName ?? record.account.handle,
        kicker: founding ? `My Seduh ID · ${founding}` : 'My Seduh ID',
        extra: [
          el('p', { className: 'page-hero-intro me-hero-links' }, [
            el('a', {
              className: 'claim-link',
              id: 'me-public-link',
              text: `seduhscore.com/id/${record.account.handle}`,
              attrs: { href: `/id/${record.account.handle}/` },
            }),
          ]),
          el('div', { className: 'me-hero-actions' }, [signOut]),
        ],
      }),
      el('section', { className: 'me-body' }, [
        el('nav', { className: 'me-tabs', attrs: { 'aria-label': 'My Seduh ID' } }, tabButtons),
        live,
        el('div', { className: 'claim-card panel' }, [panel]),
      ]),
    ]);
    draw();
  }

  // ---- start ----

  async function start() {
    showLoading();
    if (!(await api.hasSession())) {
      if (!destroyed) showEmail();
      return;
    }
    const loaded = await api.loadRecord();
    if (destroyed) return;
    if (loaded.ok) return showApp(loaded.record);
    if (isSignedOutHint(loaded.hint))
      return signedOut(loaded.hint === 'no_account' ? 'no_account' : '');
    showFailure(loaded.hint);
  }

  start();
  return {
    unmount() {
      destroyed = true;
    },
    ready: Promise.resolve(),
  };
}
