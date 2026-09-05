import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  blankDraft,
  validateDraft,
  renderEventsList,
  renderCreateForm,
  mountEventsScreen,
} from './eventsScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

describe('validateDraft', () => {
  it('requires a non-blank name', () => {
    expect(validateDraft(blankDraft())).toBe('Name is required.');
    expect(validateDraft({ ...blankDraft(), name: '  ' })).toBe('Name is required.');
  });

  it('is satisfied by a name alone — date/venue/isTest are all optional', () => {
    expect(validateDraft({ ...blankDraft(), name: 'October Cup' })).toBeNull();
  });
});

describe('renderEventsList', () => {
  it('shows an empty-state message, not a blank list, when there are no events', () => {
    const el = renderEventsList([]);
    expect(el.tagName).toBe('P');
    expect(el.textContent).toContain('No events yet');
  });

  it('renders one row per event, linking to #/events/{id}', () => {
    const events = [{ id: 'ev1', name: 'October Cup', is_test: false }];
    const list = renderEventsList(events);
    const link = list.querySelector('a');
    expect(link.textContent).toBe('October Cup');
    expect(link.getAttribute('href')).toBe('#/events/ev1');
  });

  it('marks a test event with a visible indicator; a non-test event has none', () => {
    const events = [
      { id: 'ev1', name: 'Test Run', is_test: true },
      { id: 'ev2', name: 'Real Event', is_test: false },
    ];
    const list = renderEventsList(events);
    const rows = [...list.querySelectorAll('li')];
    expect(rows[0].querySelector('.is-test-indicator')).not.toBeNull();
    expect(rows[1].querySelector('.is-test-indicator')).toBeNull();
  });

  it('shows date and venue as meta text when present', () => {
    const events = [
      { id: 'ev1', name: 'October Cup', event_date: '2026-10-04', venue: 'HQ', is_test: false },
    ];
    const list = renderEventsList(events);
    expect(list.querySelector('li').textContent).toContain('2026-10-04');
    expect(list.querySelector('li').textContent).toContain('HQ');
  });

  it("offers a Delete action on a test event, but not on a real one — matches delete_test_event's own server-side guard", () => {
    const events = [
      { id: 'ev1', name: 'Test Run', is_test: true },
      { id: 'ev2', name: 'Real Event', is_test: false },
    ];
    const list = renderEventsList(events);
    const rows = [...list.querySelectorAll('li')];
    expect(rows[0].querySelector('#delete-event-ev1')).not.toBeNull();
    expect(rows[1].querySelector('button')).toBeNull();
  });

  it('shows the two-step confirm, not the bare Delete button, once deleteStates marks that event as confirming', () => {
    const events = [{ id: 'ev1', name: 'Test Run', is_test: true }];
    const list = renderEventsList(events, { deleteStates: { ev1: 'confirming' } });
    expect(list.querySelector('#delete-event-ev1')).toBeNull();
    expect(list.querySelector('#confirm-delete-ev1')).not.toBeNull();
    expect(list.querySelector('#cancel-delete-ev1')).not.toBeNull();
  });

  it('shows a disabled "Deleting…" state, with no clickable controls, while deleteStates marks that event as deleting', () => {
    const events = [{ id: 'ev1', name: 'Test Run', is_test: true }];
    const list = renderEventsList(events, { deleteStates: { ev1: 'deleting' } });
    expect(list.querySelector('li').textContent).toContain('Deleting…');
    expect(list.querySelector('button')).toBeNull();
  });

  it("wires Delete/Confirm delete/Cancel to their own distinct handlers, each passed the clicked event's id", () => {
    const events = [{ id: 'ev1', name: 'Test Run', is_test: true }];
    const onDeleteClick = vi.fn();
    const list = renderEventsList(events, { deleteHandlers: { onDeleteClick } });
    list.querySelector('#delete-event-ev1').click();
    expect(onDeleteClick).toHaveBeenCalledWith('ev1');

    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    const confirming = renderEventsList(events, {
      deleteStates: { ev1: 'confirming' },
      deleteHandlers: { onConfirmDelete, onCancelDelete },
    });
    confirming.querySelector('#confirm-delete-ev1').click();
    confirming.querySelector('#cancel-delete-ev1').click();
    expect(onConfirmDelete).toHaveBeenCalledWith('ev1');
    expect(onCancelDelete).toHaveBeenCalledWith('ev1');
  });
});

describe('renderCreateForm', () => {
  it('the visible label text for date/venue matches their own aria-label — both say "(optional)", so a sighted user and a screen-reader user get the same information (found in the app-wiring holistic pass)', () => {
    const form = renderCreateForm(blankDraft(), { disabled: false });
    const labels = [...form.querySelectorAll('.form-field-label')].map((el) => el.textContent);
    expect(labels).toContain('Event date (optional)');
    expect(labels).toContain('Venue (optional)');
    expect(form.querySelector('[data-field="eventDate"]').getAttribute('aria-label')).toBe(
      'Event date (optional)',
    );
    expect(form.querySelector('[data-field="venue"]').getAttribute('aria-label')).toBe(
      'Venue (optional)',
    );
  });
});

function fakeClient({ events = [], insertResult, rpcResult } = {}) {
  const calls = [];
  const db = { events: [...events] };
  return {
    calls,
    db,
    rpc: (name, payload) => {
      calls.push(['rpc', name, payload]);
      if (name === 'delete_test_event' && !rpcResult?.error) {
        db.events = db.events.filter((event) => event.id !== payload.p_event_id);
      }
      return Promise.resolve(rpcResult ?? { data: null, error: null });
    },
    from(table) {
      const builder = {
        select: () => builder,
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          const inserted = { id: `ev-${db[table].length + 1}`, org_id: payload.org_id, ...payload };
          if (!insertResult?.error) db[table].push(inserted);
          return {
            select: () => ({
              single: () => Promise.resolve(insertResult ?? { data: inserted, error: null }),
            }),
          };
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
          return builder;
        },
        order: (...args) => {
          calls.push(['order', table, ...args]);
          return builder;
        },
        then: (resolve, reject) =>
          Promise.resolve({ data: db[table], error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

describe('mountEventsScreen', () => {
  it('loads and renders existing events for the org, and the create form', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    expect(root.textContent).toContain('October Cup');
    expect(root.querySelector('form.create-event-form')).not.toBeNull();
  });

  it('never hardcodes a format — the create call uses whatever defaultFormat was passed in', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({});
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'guess_the_bean' });

    root.querySelector('[data-field="name"]').value = 'Booth Night';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const insertCall = client.calls.find(([action]) => action === 'insert');
    expect(insertCall[2].format).toBe('guess_the_bean');
  });

  it('defaults the "This is test data" checkbox to unchecked (D9: opt in, never the reverse)', async () => {
    const root = document.createElement('div');
    const client = fakeClient({});
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    expect(root.querySelector('[data-field="isTest"]').checked).toBe(false);
  });

  it('creating an event clears the form, shows success, and re-lists the new event', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({});
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    const nameInput = root.querySelector('[data-field="name"]');
    nameInput.value = 'October Cup';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').textContent).toBe('Event created.');
    expect(root.textContent).toContain('October Cup');
    expect(root.querySelector('[data-field="name"]').value).toBe('');
  });

  it('rejects a blank name without ever calling the client', async () => {
    const root = document.createElement('div');
    const client = fakeClient({});
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls.some(([action]) => action === 'insert')).toBe(false);
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
  });

  it('renders a Retry-capable error state when the initial load fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = { from: () => ({ from: () => {} }) };
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    expect(root.querySelector('button').textContent).toBe('Retry');
  });

  describe('a genuinely hung load', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out rather than leaving the screen on "Loading…" forever', async () => {
      function hungBuilder() {
        const b = {
          select: () => b,
          eq: () => b,
          order: () => b,
          then: () => new Promise(() => {}),
        };
        return b;
      }
      const hungClient = { from: () => hungBuilder() };
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mountPromise = mountEventsScreen(root, {
        orgId: 'org1',
        client: hungClient,
        defaultFormat: 'cup_taster',
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Loading events');

      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS);
      await mountPromise;

      const feedback = root.querySelector('.screen-feedback');
      expect(feedback.dataset.tone).toBe('error');
      expect(feedback.textContent).toMatch(/taking longer than expected/i);
    });
  });

  it('never writes to root again once its own signal is aborted mid-load — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): this screen's own load is still in flight when the
    // router (in production) decides a newer navigation has superseded it
    // and aborts this mount's signal — well before this screen's own
    // attemptLoad() promise gets a chance to resolve. A discarded screen's
    // late render() must never clobber whatever's actually on screen now.
    let resolveQuery;
    const controllableClient = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          then: (resolve) => {
            resolveQuery = () => resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountEventsScreen(root, {
      orgId: 'org1',
      client: controllableClient,
      defaultFormat: 'cup_taster',
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveQuery).toBeDefined());
    expect(root.textContent).toContain('Loading events');

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-loading screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    // The router aborts a superseded mount's signal the instant a newer
    // navigation starts — simulated directly here, then the slow query
    // FINALLY resolves, same as a late network response arriving after
    // the user has already moved on.
    controller.abort();
    resolveQuery();
    await mountPromise;

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own event list.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('No events yet');
  });

  it('clicking Delete then Cancel returns to the plain Delete button, without ever calling the RPC', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    root.querySelector('#delete-event-ev1').click();
    expect(root.querySelector('#confirm-delete-ev1')).not.toBeNull();

    root.querySelector('#cancel-delete-ev1').click();
    expect(root.querySelector('#delete-event-ev1')).not.toBeNull();
    expect(client.calls.some(([action]) => action === 'rpc')).toBe(false);
  });

  it('confirming delete calls delete_test_event with orgId/eventId, removes only that row, and shows success', async () => {
    // Two test events, not one — found in review (test-auditor): a
    // single-event fixture can't tell "removed by id" apart from "removed
    // the only element regardless of id" (e.g. events = events.slice(1)
    // would pass just as well as the real events.filter(id !== eventId)).
    // ev2 surviving, untouched and still showing its own plain Delete
    // button throughout, is also the only coverage anywhere in this file
    // for deleteStates' own claimed per-id independence.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [
        { id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true },
        { id: 'ev2', org_id: 'org1', name: 'Other Test Run', is_test: true },
      ],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    root.querySelector('#delete-event-ev1').click();
    expect(root.querySelector('#delete-event-ev2')).not.toBeNull(); // untouched while ev1 confirms
    root.querySelector('#confirm-delete-ev1').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls).toContainEqual([
      'rpc',
      'delete_test_event',
      { p_org_id: 'org1', p_event_id: 'ev1' },
    ]);
    // Precise selectors, not a text-substring check — "Other Test Run"
    // itself contains "Test Run", so a bare toContain('Test Run') would
    // stay true even after ev1's own row is correctly gone.
    expect(root.querySelector('#delete-event-ev1')).toBeNull();
    expect(root.querySelector('#delete-event-ev2')).not.toBeNull();
    expect(root.textContent).toContain('Other Test Run');
    expect(root.querySelector('.screen-feedback').textContent).toBe('Event deleted.');
  });

  it('a rapid double-click on Confirm delete enqueues only one delete_test_event call', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    root.querySelector('#delete-event-ev1').click();
    const confirmButton = root.querySelector('#confirm-delete-ev1');
    // Both clicks dispatched before either handler's own await yields —
    // proves the guard itself (deleteStates[eventId] === 'deleting'), not
    // just that the button happened to already be gone by the second click.
    confirmButton.click();
    confirmButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls.filter(([action]) => action === 'rpc')).toHaveLength(1);
  });

  it('a delete_test_event failure (e.g. the server refusing a non-test event) shows the error and leaves the row in place', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev2', org_id: 'org1', name: 'Real Event', is_test: true }],
      rpcResult: {
        data: null,
        error: new Error('delete_test_event: refusing to delete a non-test event (ev2)'),
      },
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    root.querySelector('#delete-event-ev2').click();
    root.querySelector('#confirm-delete-ev2').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('Real Event');
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    // Back to the plain Delete button, not stuck showing "Deleting…" forever.
    expect(root.querySelector('#delete-event-ev2')).not.toBeNull();
  });
});
