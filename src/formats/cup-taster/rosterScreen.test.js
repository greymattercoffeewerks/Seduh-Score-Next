import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCupperFromDraft,
  validateDraft,
  renderRegistrationForm,
  renderRosterEntries,
  mountRosterScreen,
} from './rosterScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

// Table-based in-memory fake client, mirroring setupScreen.test.js's own
// (registerEntry's control flow varies by whether a phone match exists, so
// a hand-ordered call queue can't express it cleanly for a whole-screen
// integration test). `errorOn` injects a write failure for one specific
// `table.method` combination, for the write-time-error test.
function fakeClient(initialDb, { errorOn } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function fails(table, method) {
    return errorOn === `${table}.${method}`;
  }

  function makeBuilder(table) {
    const filters = [];

    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      ilike(col, val) {
        filters.push([col, val]);
        return builder;
      },
      insert(payload) {
        if (fails(table, 'insert')) {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: null, error: new Error('insert failed') }),
            }),
          };
        }
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((row) => {
          idCounter += 1;
          return { id: `${table}-${idCounter}`, ...row };
        });
        db[table] = [...(db[table] ?? []), ...inserted];
        return {
          select: () => ({ single: () => Promise.resolve({ data: inserted[0], error: null }) }),
        };
      },
      update(patch) {
        return {
          eq(col, val) {
            if (fails(table, 'update')) {
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: null, error: new Error('update failed') }),
                }),
              };
            }
            let updated = null;
            for (const row of db[table] ?? []) {
              if (row[col] === val) {
                Object.assign(row, patch);
                updated = row;
              }
            }
            return {
              select: () => ({ single: () => Promise.resolve({ data: updated, error: null }) }),
            };
          },
        };
      },
      single() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      maybeSingle() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve, reject) {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { db, from: (table) => makeBuilder(table) };
}

function throwingClient() {
  return {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve({ data: null, error: new Error('network unreachable') }),
        maybeSingle: () => Promise.resolve({ data: null, error: new Error('network unreachable') }),
        then: (resolve, reject) =>
          Promise.resolve({ data: null, error: new Error('network unreachable') }).then(
            resolve,
            reject,
          ),
      };
      return builder;
    },
  };
}

const baseEvent = { id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false };

function entry(overrides = {}) {
  return {
    id: 'e1',
    event_id: 'ev1',
    person_id: 'p1',
    display_name: 'Cupper One',
    cafe: 'Grey Matter',
    bib: '7',
    withdrawn: false,
    ...overrides,
  };
}

describe('buildCupperFromDraft', () => {
  it('trims every field', () => {
    const draft = { displayName: '  Cupper One  ', phone: ' +123 ', email: '', cafe: '', bib: '' };
    expect(buildCupperFromDraft(draft)).toEqual({
      displayName: 'Cupper One',
      phone: '+123',
      email: null,
      cafe: null,
      bib: null,
    });
  });

  it('collapses a blank optional field to null rather than an empty string', () => {
    const draft = { displayName: 'A', phone: '+1', email: '  ', cafe: '  ', bib: '  ' };
    const result = buildCupperFromDraft(draft);
    expect(result.email).toBeNull();
    expect(result.cafe).toBeNull();
    expect(result.bib).toBeNull();
  });

  it('keeps a real optional value', () => {
    const draft = { displayName: 'A', phone: '+1', email: 'a@example.com', cafe: 'Cafe', bib: '9' };
    const result = buildCupperFromDraft(draft);
    expect(result.email).toBe('a@example.com');
    expect(result.cafe).toBe('Cafe');
    expect(result.bib).toBe('9');
  });
});

describe('validateDraft', () => {
  it('requires a name', () => {
    expect(validateDraft({ displayName: '', phone: '+1' })).toBe('Name is required.');
    expect(validateDraft({ displayName: '   ', phone: '+1' })).toBe('Name is required.');
  });

  it('requires a phone', () => {
    expect(validateDraft({ displayName: 'A', phone: '' })).toBe('Phone is required.');
    expect(validateDraft({ displayName: 'A', phone: '   ' })).toBe('Phone is required.');
  });

  it('passes a draft with both required fields present', () => {
    expect(validateDraft({ displayName: 'A', phone: '+1' })).toBeNull();
  });
});

describe('renderRegistrationForm', () => {
  it('renders a labeled field for name/phone/email/cafe/bib', () => {
    const draft = { displayName: 'A', phone: '+1', email: 'a@x.com', cafe: 'C', bib: '9' };
    const form = renderRegistrationForm(draft, { disabled: false });
    for (const label of [
      'Name',
      'Phone',
      'Email (optional)',
      'Cafe (optional)',
      'Bib (optional)',
    ]) {
      expect(form.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it('hydrates each input from the draft', () => {
    const draft = {
      displayName: 'Cupper One',
      phone: '+123',
      email: 'x@y.com',
      cafe: 'C',
      bib: '9',
    };
    const form = renderRegistrationForm(draft, { disabled: false });
    expect(form.querySelector('[aria-label="Name"]').value).toBe('Cupper One');
    expect(form.querySelector('[aria-label="Phone"]').value).toBe('+123');
  });

  it('disables every field and the submit button when disabled is true', () => {
    const draft = { displayName: '', phone: '', email: '', cafe: '', bib: '' };
    const form = renderRegistrationForm(draft, { disabled: true });
    for (const input of form.querySelectorAll('input')) {
      expect(input.disabled).toBe(true);
    }
    expect(form.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Registering…');
  });

  it('routes a field edit to the draft object directly, synchronously', () => {
    const draft = { displayName: '', phone: '', email: '', cafe: '', bib: '' };
    const form = renderRegistrationForm(draft, { disabled: false });
    const nameInput = form.querySelector('[aria-label="Name"]');
    nameInput.value = 'New Name';
    nameInput.dispatchEvent(new Event('input'));
    expect(draft.displayName).toBe('New Name');
  });
});

describe('renderRosterEntries', () => {
  it('renders a defined empty state rather than an empty list', () => {
    const node = renderRosterEntries([], { onToggleWithdrawn: () => {}, disabled: false });
    expect(node.textContent).toContain('No cuppers registered yet.');
  });

  it('sorts entries alphabetically by display name', () => {
    const entries = [
      entry({ id: 'e1', display_name: 'Zed' }),
      entry({ id: 'e2', display_name: 'Amy' }),
    ];
    const list = renderRosterEntries(entries, { onToggleWithdrawn: () => {}, disabled: false });
    const names = [...list.querySelectorAll('li')].map(
      (li) => li.querySelector('span').textContent,
    );
    expect(names).toEqual(['Amy', 'Zed']);
  });

  it('shows cafe and bib joined in the meta line', () => {
    const entries = [entry({ cafe: 'Grey Matter', bib: '7' })];
    const list = renderRosterEntries(entries, { onToggleWithdrawn: () => {}, disabled: false });
    expect(list.textContent).toContain('Grey Matter · Bib 7');
  });

  it('shows a Withdrawn tag and a Reinstate button for a withdrawn entry', () => {
    const entries = [entry({ withdrawn: true })];
    const list = renderRosterEntries(entries, { onToggleWithdrawn: () => {}, disabled: false });
    expect(list.textContent).toContain('Withdrawn');
    const button = list.querySelector('button');
    expect(button.textContent).toBe('Reinstate');
    expect(button.getAttribute('aria-label')).toBe('Reinstate Cupper One');
  });

  it('shows a Withdraw button for an active entry, with no Withdrawn tag', () => {
    const entries = [entry({ withdrawn: false })];
    const list = renderRosterEntries(entries, { onToggleWithdrawn: () => {}, disabled: false });
    expect(list.textContent).not.toContain('Withdrawn');
    const button = list.querySelector('button');
    expect(button.textContent).toBe('Withdraw');
  });

  it('routes a toggle click to onToggleWithdrawn with the entry', () => {
    const entries = [entry()];
    const seen = [];
    const list = renderRosterEntries(entries, {
      onToggleWithdrawn: (e) => seen.push(e),
      disabled: false,
    });
    list.querySelector('button').click();
    expect(seen).toEqual([entries[0]]);
  });

  it('disables every toggle button when disabled is true', () => {
    const entries = [entry({ id: 'e1' }), entry({ id: 'e2' })];
    const list = renderRosterEntries(entries, { onToggleWithdrawn: () => {}, disabled: true });
    for (const button of list.querySelectorAll('button')) {
      expect(button.disabled).toBe(true);
    }
  });
});

describe('mountRosterScreen', () => {
  it('renders the is_test banner when the event is test data, and omits it otherwise', async () => {
    const client = fakeClient({ events: [{ ...baseEvent, is_test: true }], event_entries: [] });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('.is-test-banner')?.textContent).toBe('Test Data — Not a Live Event');

    const client2 = fakeClient({ events: [baseEvent], event_entries: [] });
    const root2 = document.createElement('div');
    await mountRosterScreen(root2, { eventId: 'ev1', client: client2 });
    expect(root2.querySelector('.is-test-banner')).toBeNull();
  });

  it('shows a defined loading state while the initial load is still in flight, not a blank screen', () => {
    let resolveFind;
    const client = {
      from(table) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () =>
            table === 'events'
              ? new Promise((resolve) => {
                  resolveFind = resolve;
                })
              : Promise.resolve({ data: null, error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    };
    const root = document.createElement('div');
    mountRosterScreen(root, { eventId: 'ev1', client });
    expect(root.textContent).toContain('Loading roster…');
    resolveFind({ data: baseEvent, error: null });
  });

  it('never writes to root again once its own signal is aborted mid-load — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): this screen's own load is still in flight when the
    // router (in production) decides a newer navigation has superseded it
    // and aborts this mount's signal — well before this screen's own
    // attemptLoad() promise gets a chance to resolve.
    let resolveFind;
    const client = {
      from(table) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () =>
            table === 'events'
              ? new Promise((resolve) => {
                  resolveFind = resolve;
                })
              : Promise.resolve({ data: null, error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountRosterScreen(root, {
      eventId: 'ev1',
      client,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveFind).toBeDefined());
    expect(root.textContent).toContain('Loading roster…');

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-loading screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    controller.abort();
    resolveFind({ data: baseEvent, error: null });
    await mountPromise;

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own roster.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('Roster');
  });

  it('renders a dedicated error screen, with no form or list but a working Retry, when the initial load fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountRosterScreen(root, { eventId: 'ev1', client: throwingClient() });
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Retry');
  });

  it('Retry re-attempts the load and shows real content once it succeeds, closing the "no retry affordance" gap', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // Deterministic, not call-count-based — flipped by the test itself the
    // moment Retry is clicked, matching setupScreen.test.js's own approach
    // (see its comment for why a call-count gate would be racy here).
    let shouldFail = true;
    // Seeded with one real entry specifically so this test can prove the
    // reload actually happened — found in review (test-auditor): asserting
    // only "h1 says Roster, no error tone" would still pass against a
    // broken Retry that just cleared the error state without reloading,
    // since both screens render that same shell on zero-entry state too.
    const succeeding = fakeClient({ events: [baseEvent], event_entries: [entry()] });
    const client = {
      from(table) {
        return shouldFail ? throwingClient().from(table) : succeeding.from(table);
      },
    };
    await mountRosterScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');

    shouldFail = false;
    root.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('Roster');
    expect(root.querySelector('.screen-feedback[data-tone="error"]')).toBeNull();
    expect(root.textContent).toContain('Cupper One');
    // Found in review (ui-accessibility-reviewer): a successful Retry used
    // to silently drop focus to <body> — see setupScreen.test.js's own
    // identical check for the full reasoning.
    expect(document.activeElement.id).toBe('roster-heading');
  });

  describe('a genuinely hung load (neither resolves nor rejects)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out rather than leaving the screen on "Loading…" forever, and shows a distinct message with a working Retry', async () => {
      function hungBuilder() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => new Promise(() => {}),
          maybeSingle: () => new Promise(() => {}),
          then: () => new Promise(() => {}), // never settles — the exact failure mode under test
        };
        return builder;
      }
      const hungClient = { from: () => hungBuilder() };
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mountPromise = mountRosterScreen(root, { eventId: 'ev1', client: hungClient });

      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Loading roster…');

      // Pins the actual shared constant, not just "a timeout eventually
      // fires" — see setupScreen.test.js's own identical check for the
      // full reasoning (test-auditor finding).
      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
      expect(root.textContent).toContain('Loading roster…');

      await vi.advanceTimersByTimeAsync(1);
      await mountPromise;

      const feedback = root.querySelector('.screen-feedback');
      expect(feedback.dataset.tone).toBe('error');
      expect(feedback.textContent).toMatch(/taking longer than expected/i);
      const retryButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Retry',
      );
      expect(retryButton).toBeTruthy();
    });
  });

  it('renders the current roster, sorted, with cafe/bib meta', async () => {
    const client = fakeClient({
      events: [baseEvent],
      event_entries: [
        entry({ id: 'e1', display_name: 'Zed' }),
        entry({ id: 'e2', display_name: 'Amy' }),
      ],
    });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });
    const names = [...root.querySelectorAll('.roster-list li span')].filter(
      (span) => span.textContent === 'Amy' || span.textContent === 'Zed',
    );
    expect(names.map((n) => n.textContent)).toEqual(['Amy', 'Zed']);
    expect(root.textContent).toContain('2 cuppers registered');
  });

  it('registers a new cupper, clears the form, and shows a success message', async () => {
    const client = fakeClient({ events: [baseEvent], people: [], event_entries: [] });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('[aria-label="Name"]').value = 'New Cupper';
    root.querySelector('[aria-label="Name"]').dispatchEvent(new Event('input'));
    root.querySelector('[aria-label="Phone"]').value = '+6738001111';
    root.querySelector('[aria-label="Phone"]').dispatchEvent(new Event('input'));

    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Pinned exactly, not `.toContain('registered')` — that substring also
    // matches the "already registered" branch's message, so a loose check
    // here wouldn't catch a regression that made the idempotency check
    // always report a false positive.
    expect(root.querySelector('.screen-feedback').textContent).toBe('New Cupper registered.');
    expect(root.querySelector('[aria-label="Name"]').value).toBe('');
    expect(root.textContent).toContain('1 cupper registered');
  });

  it('moves focus to the feedback region on a successful registration, so the message actually gets announced', async () => {
    // The feedback node is destroyed and rebuilt fresh every render, so an
    // aria-live region alone doesn't reliably announce it — found in
    // review. Only moving focus there guarantees a keyboard/AT user hears
    // the outcome, which matters most here since registration is a
    // repeat-many-times-in-a-row workflow, not a one-shot save.
    const client = fakeClient({ events: [baseEvent], people: [], event_entries: [] });
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('[aria-label="Name"]').value = 'New Cupper';
    root.querySelector('[aria-label="Name"]').dispatchEvent(new Event('input'));
    root.querySelector('[aria-label="Phone"]').value = '+6738001111';
    root.querySelector('[aria-label="Phone"]').dispatchEvent(new Event('input'));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(root.querySelector('.screen-feedback'));
    document.body.removeChild(root);
  });

  it('rejects a submit with no name/phone without writing anything', async () => {
    const client = fakeClient({ events: [baseEvent], people: [], event_entries: [] });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').textContent).toContain('Name is required');
    expect(client.db.event_entries ?? []).toHaveLength(0);
  });

  it('shows "already registered" rather than a false success when the person already has an entry for this event', async () => {
    const person = { id: 'p1', org_id: 'org1', display_name: 'Cupper One', phone: '+6738001111' };
    const existingEntry = entry({ id: 'e1', person_id: 'p1', display_name: 'Cupper One' });
    const client = fakeClient({
      events: [baseEvent],
      people: [person],
      event_entries: [existingEntry],
    });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('[aria-label="Name"]').value = 'Cupper One';
    root.querySelector('[aria-label="Name"]').dispatchEvent(new Event('input'));
    root.querySelector('[aria-label="Phone"]').value = '+6738001111';
    root.querySelector('[aria-label="Phone"]').dispatchEvent(new Event('input'));

    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').textContent).toContain('already registered');
    expect(client.db.event_entries).toHaveLength(1);
    expect(root.textContent).toContain('1 cupper registered');
  });

  it('withdraws an active entry and shows a success message', async () => {
    const client = fakeClient({
      events: [baseEvent],
      event_entries: [entry({ withdrawn: false })],
    });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('button[aria-label="Withdraw Cupper One"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').textContent).toContain('withdrawn');
    expect(client.db.event_entries[0].withdrawn).toBe(true);
    expect(root.querySelector('button[aria-label="Reinstate Cupper One"]')).not.toBeNull();
  });

  it('reinstates a withdrawn entry', async () => {
    const client = fakeClient({ events: [baseEvent], event_entries: [entry({ withdrawn: true })] });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('button[aria-label="Reinstate Cupper One"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').textContent).toContain('reinstated');
    expect(client.db.event_entries[0].withdrawn).toBe(false);
  });

  it('surfaces a write-time failure from the toggle without crashing', async () => {
    const client = fakeClient(
      { events: [baseEvent], event_entries: [entry()] },
      { errorOn: 'event_entries.update' },
    );
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('button[aria-label="Withdraw Cupper One"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    expect(client.db.event_entries[0].withdrawn).toBe(false);
  });

  it('preserves in-progress registration-form input across a toggle-triggered rerender', async () => {
    // The exact class of bug the rebuild-then-refocus rule exists to
    // prevent: an unrelated action (withdrawing a different cupper) must
    // not wipe out whatever the organiser is mid-typing in the add form.
    const client = fakeClient({
      events: [baseEvent],
      event_entries: [entry({ withdrawn: false })],
    });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('[aria-label="Name"]').value = 'Still Typing';
    root.querySelector('[aria-label="Name"]').dispatchEvent(new Event('input'));

    root.querySelector('button[aria-label="Withdraw Cupper One"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('[aria-label="Name"]').value).toBe('Still Typing');
  });

  it('disables the submit button and every toggle button while a write is in flight', async () => {
    // handleToggleWithdrawn runs synchronously up to its first `await`, so
    // the `busy = true; render()` pair has already landed in the DOM by the
    // time `.click()` returns — no timing control needed to observe it.
    const client = fakeClient({ events: [baseEvent], event_entries: [entry()] });
    const root = document.createElement('div');
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('button[aria-label="Withdraw Cupper One"]').click();

    expect(root.querySelector('form button[type="submit"]').disabled).toBe(true);
    expect(root.querySelector('button[aria-label="Withdraw Cupper One"]').disabled).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('form button[type="submit"]').disabled).toBe(false);
  });
});
