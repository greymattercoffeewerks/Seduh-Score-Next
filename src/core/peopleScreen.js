// People - the organisation's own people, with who is staff or an affiliate and whether each is linked
// to a Seduh ID (T-ID.C1). Lives in core/: nothing here is format-specific.
//
// What it does: lists the active organisation's people (name, cafe), shows "Linked to a Seduh ID" as TEXT
// on a person whose phone has been matched (never the id itself), and lets any member mark a person as
// staff or affiliate and end that role. Ending a role keeps the history (the row gets an end date); it is
// not a delete. Everything here is private to the organisation: the roster is not visible to any other
// organisation or the public.
//
// Rebuild-then-refocus, like every screen here: each action re-renders from state and names the element
// that should end up focused. The filter text survives re-renders because it is kept in closure state.
import { getSupabase } from './supabaseClient.js';
import { el } from './dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { listOrgPeople, LINKED_LABEL, PEOPLE_LIST_LIMIT } from './identity.js';
import {
  AFFILIATION_RELATIONSHIPS,
  listOpenAffiliations,
  addAffiliation,
  endAffiliation,
  relationshipLabel,
  describeAffiliationError,
} from './affiliations.js';
import { describeError } from './errors.js';

export function peopleHeading(orgName) {
  return orgName ? `People in ${orgName}` : 'People';
}

export const PEOPLE_INTRO =
  'Mark the people who work for or are connected to your organisation as staff or affiliates. ' +
  'Only your organisation can see this. "Linked" means the phone number on file has been matched ' +
  'to a private Seduh ID record; it is not shown to other organisations or the public.';

// Pure. Joins people with their open roles and applies the name filter.
// Returns [{ id, displayName, cafe, linked, roles: [{ id, relationship }] }], in the order given.
export function buildPeopleView(people, affiliations, filter = '') {
  const rolesByPerson = new Map();
  for (const a of affiliations) {
    const list = rolesByPerson.get(a.personId) ?? [];
    list.push({ id: a.id, relationship: a.relationship });
    rolesByPerson.set(a.personId, list);
  }
  const needle = filter.trim().toLowerCase();
  return people
    .filter((p) => !needle || p.displayName.toLowerCase().includes(needle))
    .map((p) => ({
      ...p,
      roles: (rolesByPerson.get(p.id) ?? []).sort((x, y) =>
        x.relationship.localeCompare(y.relationship),
      ),
    }));
}

// Pure. The count line under the heading.
export function summarisePeople(people, affiliations) {
  const count = (rel) => affiliations.filter((a) => a.relationship === rel).length;
  const noun = people.length === 1 ? 'person' : 'people';
  return `${people.length} ${noun}, ${count('staff')} staff, ${count('affiliate')} affiliates`;
}

export async function mountPeopleScreen(
  root,
  { orgId, orgName = null, client = getSupabase(), signal } = {},
) {
  let people = [];
  let truncated = false;
  let affiliations = [];
  let filter = '';
  let busy = false;
  let loading = false;
  let loadFailedMessage = null;
  let pendingError = null;
  let pendingSuccess = null;
  let focusAfterRender = null;

  async function loadPersisted() {
    const [list, open] = await Promise.all([
      listOrgPeople(orgId, client),
      listOpenAffiliations(orgId, client),
    ]);
    people = list.people;
    truncated = list.truncated;
    affiliations = open;
  }

  function frame() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container people-screen' });
    container.appendChild(
      el('h1', { id: 'people-heading', text: peopleHeading(orgName), attrs: { tabindex: '-1' } }),
    );
    return container;
  }

  function renderLoading() {
    if (signal?.aborted) return;
    const container = frame();
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading people…',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.focus();
  }

  function renderLoadError() {
    const container = frame();
    const feedback = el('div', {
      className: 'screen-feedback',
      text: loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    const retry = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retry.addEventListener('click', () => {
      attemptLoad();
    });
    container.appendChild(retry);
    root.appendChild(container);
    feedback.focus();
  }

  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
      focusAfterRender = '#people-heading';
    } catch (err) {
      loadFailedMessage = err?.timedOut
        ? 'This is taking longer than expected - check your connection and try Retry.'
        : describeError(err);
    }
    loading = false;
    render();
  }

  function roleButton(person, relationship) {
    const word = relationshipLabel(relationship).toLowerCase();
    const button = el('button', {
      className: 'btn btn-outline tap-target',
      text: `Mark as ${word}`,
      attrs: {
        type: 'button',
        id: `people-add-${person.id}-${relationship}`,
        'aria-label': `Mark ${person.displayName} as ${word}`,
      },
    });
    button.disabled = busy;
    button.addEventListener('click', () => handleAdd(person, relationship));
    return button;
  }

  function endButton(person, role) {
    const word = relationshipLabel(role.relationship).toLowerCase();
    const button = el('button', {
      className: 'btn btn-outline tap-target',
      text: `End ${word} role`,
      attrs: {
        type: 'button',
        id: `people-end-${role.id}`,
        'aria-label': `End ${word} role for ${person.displayName}`,
      },
    });
    button.disabled = busy;
    button.addEventListener('click', () => handleEnd(person, role));
    return button;
  }

  function renderRow(person) {
    const held = new Set(person.roles.map((r) => r.relationship));
    const tags = [
      ...person.roles.map((r) =>
        el('span', {
          className: 'people-tag people-tag-role',
          text: relationshipLabel(r.relationship),
        }),
      ),
      person.linked
        ? el('span', { className: 'people-tag people-tag-linked', text: LINKED_LABEL })
        : null,
    ].filter(Boolean);
    return el('li', { attrs: { id: `people-row-${person.id}` } }, [
      el(
        'div',
        { className: 'people-info' },
        [
          el('span', { className: 'people-name', text: person.displayName }),
          person.cafe ? el('span', { className: 'stage-meta', text: person.cafe }) : null,
          tags.length ? el('span', { className: 'people-tags' }, tags) : null,
        ].filter(Boolean),
      ),
      el('div', { className: 'people-actions' }, [
        ...person.roles.map((r) => endButton(person, r)),
        ...AFFILIATION_RELATIONSHIPS.filter((rel) => !held.has(rel)).map((rel) =>
          roleButton(person, rel),
        ),
      ]),
    ]);
  }

  function render() {
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }
    const container = frame();
    container.appendChild(
      el('p', { className: 'stage-meta', text: summarisePeople(people, affiliations) }),
    );
    container.appendChild(el('p', { text: PEOPLE_INTRO }));

    const feedback = el('div', {
      id: 'people-feedback',
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      feedback.textContent = pendingError;
      feedback.dataset.tone = 'error';
      pendingError = null;
    } else if (pendingSuccess) {
      feedback.textContent = pendingSuccess;
      feedback.dataset.tone = 'success';
      pendingSuccess = null;
    }

    const listHost = el('div', { id: 'people-list-host' });

    function renderList() {
      listHost.innerHTML = '';
      if (people.length === 0) {
        listHost.appendChild(
          el('p', {
            className: 'stage-meta',
            text: 'No people yet. People appear here once they are registered for an event.',
          }),
        );
        return;
      }
      const view = buildPeopleView(people, affiliations, filter);
      if (view.length === 0) {
        listHost.appendChild(
          el('p', { className: 'stage-meta', text: 'No one matches that name.' }),
        );
        return;
      }
      listHost.appendChild(
        el(
          'ul',
          { className: 'people-list', attrs: { 'aria-label': 'People' } },
          view.map(renderRow),
        ),
      );
      if (truncated) {
        listHost.appendChild(
          el('p', {
            className: 'stage-meta',
            text: `Showing the first ${PEOPLE_LIST_LIMIT} people. Use the name box to find someone else.`,
          }),
        );
      }
    }

    if (people.length > 0) {
      const filterInput = el('input', {
        className: 'field-input',
        id: 'people-filter',
        attrs: { type: 'search', 'aria-label': 'Find a person by name', autocomplete: 'off' },
      });
      filterInput.value = filter;
      filterInput.addEventListener('input', () => {
        filter = filterInput.value;
        renderList();
      });
      container.appendChild(filterInput);
    }
    renderList();
    container.appendChild(listHost);
    container.appendChild(feedback);
    root.appendChild(container);

    if (focusAfterRender) {
      root.querySelector(focusAfterRender)?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone) {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  // One write, then a fresh read. Focus lands on the status line so the outcome is spoken: the button
  // that was pressed is gone after the rebuild (it becomes the opposite action).
  async function act(write, successText) {
    if (busy) return;
    busy = true;
    render();
    try {
      await write();
      try {
        await loadPersisted();
        pendingSuccess = successText;
      } catch {
        pendingSuccess = 'Saved, but the screen could not refresh - reload to see the list.';
      }
    } catch (err) {
      pendingError = describeAffiliationError(err);
    }
    busy = false;
    render();
  }

  function handleAdd(person, relationship) {
    const word = relationshipLabel(relationship).toLowerCase();
    return act(
      () => addAffiliation(orgId, person.id, relationship, client),
      `${person.displayName} marked as ${word}.`,
    );
  }

  function handleEnd(person, role) {
    const word = relationshipLabel(role.relationship).toLowerCase();
    return act(
      () => endAffiliation(role.id, client),
      `${person.displayName} is no longer ${word}.`,
    );
  }

  await attemptLoad();

  return {
    unmount() {},
  };
}
