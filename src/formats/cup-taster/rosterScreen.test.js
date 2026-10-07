import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCupperFromDraft,
  validateDraft,
  initialEditDraft,
  validateEditDraft,
  buildEditFields,
  describeRosterEditError,
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
    return filters.every(([col, val]) =>
      Array.isArray(val) ? val.includes(row[col]) : row[col] === val,
    );
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
      in(col, vals) {
        filters.push([col, vals]);
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
        // PostgREST casts every element of .in() to the column type: a null is a uuid-cast error.
        if (filters.some(([, val]) => Array.isArray(val) && val.includes(null))) {
          return Promise.resolve({
            data: null,
            error: new Error('invalid input syntax for type uuid: "null"'),
          }).then(resolve, reject);
        }
        if (fails(table, 'select')) {
          return Promise.resolve({ data: null, error: new Error('select failed') }).then(
            resolve,
            reject,
          );
        }
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  // A faithful stand-in for update_roster_entry (migration 20261007100000): the person's profile AND
  // this event's entry change together, other events' entries are left alone, phone/email are unique
  // within the org (a clash is a P0002 whose details name the field and the other person), and a
  // walk-up entry takes name/cafe/bib only. Every call is recorded in `rpcCalls`.
  const rpcCalls = [];
  function rpc(name, args) {
    rpcCalls.push([name, args]);
    if (name !== 'update_roster_entry') return Promise.resolve({ data: null, error: null });
    if (fails('rpc', 'update_roster_entry')) {
      return Promise.resolve({ data: null, error: new Error('rpc failed') });
    }
    const entry = (db.event_entries ?? []).find((row) => row.id === args.p_entry_id);
    if (!entry) return Promise.resolve({ data: null, error: new Error('entry not found') });
    const clean = (value) =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    const person = entry.person_id ? db.people.find((row) => row.id === entry.person_id) : null;
    const refuse = (message) => Promise.resolve({ data: null, error: new Error(message) });
    if (!clean(args.p_display_name)) return refuse('update_roster_entry: a name is required');
    if (person && !clean(args.p_phone))
      return refuse('update_roster_entry: a phone number is required');
    if (!person && (clean(args.p_phone) || clean(args.p_email))) {
      return refuse(
        'update_roster_entry: this entry has no profile, so a phone or email cannot be set',
      );
    }
    const snapshotName = entry.display_name;
    const snapshotCafe = entry.cafe ?? null;
    if (person) {
      for (const [field, value] of [
        ['phone', clean(args.p_phone)],
        ['email', clean(args.p_email)],
      ]) {
        const other =
          value &&
          db.people.find(
            (row) =>
              row.id !== person.id &&
              row.org_id === person.org_id &&
              String(row[field] ?? '').toLowerCase() === value.toLowerCase(),
          );
        if (other) {
          return Promise.resolve({
            data: null,
            error: Object.assign(new Error(`CONFLICT: ${field}`), {
              code: 'P0002',
              details: JSON.stringify({
                field,
                existing_person_id: other.id,
                existing_display_name: other.display_name,
              }),
            }),
          });
        }
      }
      // Name and cafe reach the profile only when changed from THIS entry's snapshot (the form is
      // prefilled from the snapshot, so an untouched one must not revert a profile renamed since).
      Object.assign(person, {
        display_name:
          clean(args.p_display_name) !== snapshotName
            ? clean(args.p_display_name)
            : person.display_name,
        phone: clean(args.p_phone),
        email: clean(args.p_email),
        cafe: clean(args.p_cafe) !== snapshotCafe ? clean(args.p_cafe) : person.cafe,
      });
    }
    Object.assign(entry, {
      display_name: clean(args.p_display_name),
      cafe: clean(args.p_cafe),
      bib: clean(args.p_bib),
    });
    return Promise.resolve({ data: null, error: null });
  }

  return { db, rpcCalls, from: (table) => makeBuilder(table), rpc };
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
  it('trims every field and normalizes phone to E.164', () => {
    const draft = {
      displayName: '  Cupper One  ',
      phone: ' 7123456 ',
      email: '',
      cafe: '',
      bib: '',
    };
    expect(buildCupperFromDraft(draft)).toEqual({
      displayName: 'Cupper One',
      phone: '+6737123456',
      email: null,
      cafe: null,
      bib: null,
    });
  });

  it('keeps an already-international phone number as typed', () => {
    const draft = { displayName: 'A', phone: '+65 8123 4567', email: '', cafe: '', bib: '' };
    expect(buildCupperFromDraft(draft).phone).toBe('+6581234567');
  });

  it('collapses a blank optional field to null rather than an empty string', () => {
    const draft = { displayName: 'A', phone: '7123456', email: '  ', cafe: '  ', bib: '  ' };
    const result = buildCupperFromDraft(draft);
    expect(result.email).toBeNull();
    expect(result.cafe).toBeNull();
    expect(result.bib).toBeNull();
  });

  it('keeps a real optional value', () => {
    const draft = {
      displayName: 'A',
      phone: '7123456',
      email: 'a@example.com',
      cafe: 'Cafe',
      bib: '9',
    };
    const result = buildCupperFromDraft(draft);
    expect(result.email).toBe('a@example.com');
    expect(result.cafe).toBe('Cafe');
    expect(result.bib).toBe('9');
  });
});

const BASE_DRAFT = { displayName: '', phone: '', email: '', cafe: '', bib: '' };

describe('validateDraft', () => {
  it('requires a name', () => {
    expect(validateDraft({ displayName: '', phone: '7123456' })).toBe('Name is required.');
    expect(validateDraft({ displayName: '   ', phone: '7123456' })).toBe('Name is required.');
  });

  it('requires a phone', () => {
    expect(validateDraft({ displayName: 'A', phone: '' })).toBe('Phone is required.');
    expect(validateDraft({ displayName: 'A', phone: '   ' })).toBe('Phone is required.');
  });

  it('rejects a phone that is too short to be a real number', () => {
    expect(validateDraft({ ...BASE_DRAFT, displayName: 'A', phone: '+1' })).toBe(
      'Phone must be a valid international number, starting with your country code — e.g. +673 7123456 for Brunei.',
    );
  });

  it('refuses a value longer than the database accepts, naming the field', () => {
    const phone = '7123456';
    const tooLong = (key, length) =>
      validateDraft({ ...BASE_DRAFT, displayName: 'A', phone, [key]: 'x'.repeat(length) });
    expect(tooLong('displayName', 201)).toBe('Name is too long (200 characters at most).');
    expect(tooLong('email', 255)).toBe('Email is too long (254 characters at most).');
    expect(tooLong('cafe', 201)).toBe('Cafe is too long (200 characters at most).');
    expect(tooLong('bib', 51)).toBe('Bib is too long (50 characters at most).');
    // exactly at the cap is fine
    expect(tooLong('displayName', 200)).toBeNull();
    expect(tooLong('email', 254)).toBeNull();
    expect(tooLong('cafe', 200)).toBeNull();
    expect(tooLong('bib', 50)).toBeNull();
  });

  it('passes a draft with both required fields present and a valid phone shape', () => {
    expect(validateDraft({ ...BASE_DRAFT, displayName: 'A', phone: '7123456' })).toBeNull();
    expect(validateDraft({ ...BASE_DRAFT, displayName: 'A', phone: '+6737123456' })).toBeNull();
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

  it('rejects a submit with a malformed phone number, through the same accessible error path as other validation failures', async () => {
    const client = fakeClient({ events: [baseEvent], people: [], event_entries: [] });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountRosterScreen(root, { eventId: 'ev1', client });

    root.querySelector('[aria-label="Name"]').value = 'Cupper One';
    root.querySelector('[aria-label="Name"]').dispatchEvent(new Event('input'));
    root.querySelector('[aria-label="Phone"]').value = '1';
    root.querySelector('[aria-label="Phone"]').dispatchEvent(new Event('input'));

    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toContain('valid international number');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(feedback);
    expect(client.db.event_entries ?? []).toHaveLength(0);
    document.body.removeChild(root);
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

// ===================== Edit (live-event finding #4) =====================

const person = (overrides = {}) => ({
  id: 'p1',
  org_id: 'org1',
  display_name: 'Cupper One',
  phone: '+6737000001',
  email: 'one@example.com',
  cafe: 'Grey Matter',
  ...overrides,
});

describe('initialEditDraft', () => {
  it('takes name/cafe/bib from the event entry and phone/email from the person', () => {
    expect(initialEditDraft(entry(), person())).toEqual({
      displayName: 'Cupper One',
      phone: '+6737000001',
      email: 'one@example.com',
      cafe: 'Grey Matter',
      bib: '7',
    });
  });

  it('uses empty strings, never null, for what is missing — and for a walk-up with no person at all', () => {
    expect(
      initialEditDraft(entry({ cafe: null, bib: null }), person({ email: null })),
    ).toMatchObject({
      email: '',
      cafe: '',
      bib: '',
    });
    expect(initialEditDraft(entry({ person_id: null }), null)).toMatchObject({
      phone: '',
      email: '',
    });
  });
});

describe('validateEditDraft', () => {
  const draft = { displayName: 'Cupper One', phone: '7000001', email: '', cafe: '', bib: '' };

  it('requires a name', () => {
    expect(validateEditDraft({ ...draft, displayName: '  ' }, { linked: true })).toEqual({
      field: 'displayName',
      message: 'Name is required.',
    });
  });

  it('requires a phone, and a well-formed one, for an entry with a profile', () => {
    expect(validateEditDraft({ ...draft, phone: ' ' }, { linked: true })).toEqual({
      field: 'phone',
      message: 'Phone is required.',
    });
    expect(validateEditDraft({ ...draft, phone: '12' }, { linked: true })).toMatchObject({
      field: 'phone',
    });
    expect(validateEditDraft(draft, { linked: true })).toBeNull();
  });

  it('refuses a value longer than the database accepts, naming the field — the same caps as registration', () => {
    const tooLong = (key, length) =>
      validateEditDraft({ ...draft, [key]: 'x'.repeat(length) }, { linked: true });
    expect(tooLong('displayName', 201)).toEqual({
      field: 'displayName',
      message: 'Name is too long (200 characters at most).',
    });
    expect(tooLong('email', 255)).toMatchObject({ field: 'email' });
    expect(tooLong('cafe', 201)).toMatchObject({ field: 'cafe' });
    expect(tooLong('bib', 51)).toMatchObject({ field: 'bib' });
    expect(tooLong('bib', 50)).toBeNull();
  });

  it('measures a value after trimming, as the RPC does: 200 characters plus padding is fine', () => {
    expect(
      validateEditDraft({ ...draft, displayName: `${'x'.repeat(200)}   ` }, { linked: true }),
    ).toBeNull();
  });

  it('does not ask a walk-up entry for a phone it cannot have', () => {
    expect(validateEditDraft({ ...draft, phone: '' }, { linked: false })).toBeNull();
  });
});

describe('buildEditFields — blanks', () => {
  it('sends a blank cafe or bib as null, not as an empty string', () => {
    const fields = buildEditFields(
      { displayName: 'A', phone: '7000001', email: ' ', cafe: '  ', bib: '  ' },
      { linked: true },
    );
    expect(fields.cafe).toBeNull();
    expect(fields.bib).toBeNull();
    expect(fields.email).toBeNull();
  });
});

describe('buildEditFields', () => {
  const draft = {
    displayName: '  Alicia  ',
    phone: ' 7000009 ',
    email: '  a@example.com ',
    cafe: ' ',
    bib: ' 9 ',
  };

  it('trims, normalizes the phone to E.164 and turns blanks into null', () => {
    expect(buildEditFields(draft, { linked: true })).toEqual({
      displayName: 'Alicia',
      phone: '+6737000009',
      email: 'a@example.com',
      cafe: null,
      bib: '9',
    });
  });

  it('sends no phone or email for a walk-up entry, whatever the draft holds', () => {
    expect(buildEditFields(draft, { linked: false })).toMatchObject({ phone: null, email: null });
  });
});

describe('describeRosterEditError', () => {
  const conflict = (detail) => ({
    code: 'P0002',
    message: 'CONFLICT',
    details: JSON.stringify(detail),
  });

  it('names the field and the person who already has a clashing phone number', () => {
    expect(
      describeRosterEditError(conflict({ field: 'phone', existing_display_name: 'Bob Lim' })),
    ).toEqual({
      field: 'phone',
      message: 'That phone number already belongs to Bob Lim. Check the number.',
    });
  });

  it('…and for an email', () => {
    expect(
      describeRosterEditError(conflict({ field: 'email', existing_display_name: 'Bob Lim' })),
    ).toEqual({
      field: 'email',
      message: 'That email already belongs to Bob Lim. Check the address.',
    });
  });

  it('says "another person" when the name is not in the details, and points at no field for a race', () => {
    expect(describeRosterEditError(conflict({ field: 'phone' })).message).toContain(
      'another person',
    );
    expect(describeRosterEditError(conflict({ field: null }))).toMatchObject({ field: null });
    expect(describeRosterEditError({ code: 'P0002', details: '{not json' }).field).toBeNull();
  });

  it('describes anything that is not a conflict generically, pointing at no field', () => {
    const result = describeRosterEditError(new Error('network unreachable'));
    expect(result.field).toBeNull();
    expect(result.message).not.toBe('');
  });
});

describe('renderRosterEntries — contact details and Edit', () => {
  const peopleById = new Map([['p1', person()]]);

  it('shows the phone and email on file under the name, so they can be checked', () => {
    const list = renderRosterEntries([entry()], {
      onToggleWithdrawn() {},
      disabled: false,
      peopleById,
    });
    expect(list.querySelector('.roster-contact').textContent).toBe('+6737000001 · one@example.com');
  });

  it('shows just the phone when there is no email, and nothing for a walk-up with no profile', () => {
    const noEmail = new Map([['p1', person({ email: null })]]);
    expect(
      renderRosterEntries([entry()], {
        onToggleWithdrawn() {},
        disabled: false,
        peopleById: noEmail,
      }).querySelector('.roster-contact').textContent,
    ).toBe('+6737000001');
    expect(
      renderRosterEntries([entry({ person_id: null })], {
        onToggleWithdrawn() {},
        disabled: false,
        peopleById,
      }).querySelector('.roster-contact'),
    ).toBeNull();
  });

  it('offers an Edit button only when the caller can handle one', () => {
    const without = renderRosterEntries([entry()], {
      onToggleWithdrawn() {},
      disabled: false,
      peopleById,
    });
    expect(without.querySelector('[id^="roster-edit-btn-"]')).toBeNull();
    const withEdit = renderRosterEntries([entry()], {
      onToggleWithdrawn() {},
      disabled: false,
      peopleById,
      onEdit() {},
    });
    const button = withEdit.querySelector('#roster-edit-btn-e1');
    expect(button.textContent).toBe('Edit');
    expect(button.getAttribute('aria-label')).toBe('Edit Cupper One');
  });

  it('parks the other rows’ Edit buttons while one form is open: aria-disabled, and a click calls nothing', () => {
    const onEdit = vi.fn();
    const two = [entry(), entry({ id: 'e2', person_id: 'p2', display_name: 'Cupper Two' })];
    const list = renderRosterEntries(two, {
      onToggleWithdrawn() {},
      disabled: false,
      peopleById: new Map([['p1', person()]]),
      editing: {
        entryId: 'e1',
        linked: true,
        draft: initialEditDraft(entry(), person()),
        error: null,
        errorField: null,
      },
      onEdit,
      onEditInput() {},
      onSaveEdit() {},
      onCancelEdit() {},
    });
    const parked = list.querySelector('#roster-edit-btn-e2');
    expect(parked.getAttribute('aria-disabled')).toBe('true');
    expect(parked.disabled).toBe(false); // still focusable, still announced
    parked.click();
    expect(onEdit).not.toHaveBeenCalled();
    // The row that IS open has no Edit button of its own — its form is there instead.
    expect(list.querySelector('#roster-edit-btn-e1')).toBeNull();
    expect(list.querySelector('form[aria-label="Edit Cupper One"]')).not.toBeNull();
  });

  it('routes an Edit click to onEdit with the entry, and ignores it while disabled', () => {
    const onEdit = vi.fn();
    const list = renderRosterEntries([entry()], {
      onToggleWithdrawn() {},
      disabled: false,
      peopleById,
      onEdit,
    });
    list.querySelector('#roster-edit-btn-e1').click();
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
    const disabledList = renderRosterEntries([entry()], {
      onToggleWithdrawn() {},
      disabled: true,
      peopleById,
      onEdit,
    });
    expect(disabledList.querySelector('#roster-edit-btn-e1').disabled).toBe(true);
  });
});

describe('mountRosterScreen — editing a cupper', () => {
  const eventRow = baseEvent;
  const twoCuppers = () =>
    fakeClient({
      events: [eventRow],
      people: [
        person(),
        person({
          id: 'p2',
          display_name: 'Cupper Two',
          phone: '+6737000002',
          email: null,
          cafe: null,
        }),
      ],
      event_entries: [
        entry(),
        entry({ id: 'e2', person_id: 'p2', display_name: 'Cupper Two', cafe: null, bib: null }),
      ],
    });
  const walkUp = () =>
    fakeClient({
      events: [eventRow],
      people: [],
      event_entries: [
        entry({ id: 'e3', person_id: null, display_name: 'Walk Up', withdrawn: true }),
      ],
    });

  async function mount(client) {
    const root = document.createElement('div');
    document.body.appendChild(root); // focus() only works on attached nodes
    const screen = await mountRosterScreen(root, { eventId: 'ev1', client });
    return { root, screen };
  }

  const q = (root, selector) => root.querySelector(selector);
  const field = (root, id, key) => q(root, `#roster-edit-${id}-${key}`);
  const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const save = (root) => q(root, '.roster-edit-form button[type="submit"]');

  it('shows each cupper’s phone and email on file in the list', async () => {
    const { root } = await mount(twoCuppers());
    const text = (id) => q(root, `#roster-row-${id}`).textContent;
    expect(text('e1')).toContain('+6737000001 · one@example.com');
    expect(text('e2')).toContain('+6737000002');
    expect(text('e2')).not.toContain('·  ·');
  });

  it('Edit opens a form pre-filled from the entry and the profile, with focus on the name', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    expect(field(root, 'e1', 'displayName').value).toBe('Cupper One');
    expect(field(root, 'e1', 'phone').value).toBe('+6737000001');
    expect(field(root, 'e1', 'email').value).toBe('one@example.com');
    expect(field(root, 'e1', 'cafe').value).toBe('Grey Matter');
    expect(field(root, 'e1', 'bib').value).toBe('7');
    expect(document.activeElement).toBe(field(root, 'e1', 'displayName'));
    // The form is named for the cupper, and its own Edit button gives way to it.
    expect(q(root, 'form[aria-label="Edit Cupper One"]')).not.toBeNull();
    expect(q(root, '#roster-edit-btn-e1')).toBeNull();
  });

  it('only one form is open at a time: another row’s Edit is parked and a tap on it opens nothing', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Half Typed');
    const other = q(root, '#roster-edit-btn-e2');
    expect(other.getAttribute('aria-disabled')).toBe('true');
    other.click();
    expect(q(root, 'form[aria-label="Edit Cupper Two"]')).toBeNull();
    expect(field(root, 'e1', 'displayName').value).toBe('Half Typed');
  });

  it('Cancel closes the form, discards the draft and returns focus to that row’s Edit button', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Changed Mind');
    q(root, '.roster-edit-form button[type="button"]').click();
    expect(q(root, '.roster-edit-form')).toBeNull();
    expect(document.activeElement).toBe(q(root, '#roster-edit-btn-e1'));
    expect(root.textContent).toContain('Cupper One');
    q(root, '#roster-edit-btn-e1').click();
    expect(field(root, 'e1', 'displayName').value).toBe('Cupper One'); // not the discarded text
  });

  it('Escape closes the form like Cancel', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    field(root, 'e1', 'displayName').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(q(root, '.roster-edit-form')).toBeNull();
    expect(document.activeElement).toBe(q(root, '#roster-edit-btn-e1'));
  });

  it('a blank name or a bad phone is reported beside the field, with focus there, and nothing is sent', async () => {
    const client = twoCuppers();
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();

    type(field(root, 'e1', 'displayName'), '   ');
    save(root).click();
    expect(q(root, '.roster-edit-error').textContent).toBe('Name is required.');
    expect(document.activeElement).toBe(field(root, 'e1', 'displayName'));
    const nameInput = field(root, 'e1', 'displayName');
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    expect(nameInput.getAttribute('aria-describedby')).toBe(q(root, '.roster-edit-error').id);

    type(field(root, 'e1', 'displayName'), 'Cupper One');
    type(field(root, 'e1', 'phone'), '12');
    save(root).click();
    expect(q(root, '.roster-edit-error').textContent).toContain('valid international number');
    expect(document.activeElement).toBe(field(root, 'e1', 'phone'));

    expect(client.rpcCalls).toHaveLength(0);
  });

  it('typing clears the complaint — the message and the aria attributes — without re-rendering the form', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), '');
    save(root).click();
    const form = q(root, '.roster-edit-form');
    type(field(root, 'e1', 'displayName'), 'Cupper One Again');
    expect(q(root, '.roster-edit-error').textContent).toBe('');
    expect(field(root, 'e1', 'displayName').hasAttribute('aria-invalid')).toBe(false);
    expect(q(root, '.roster-edit-form')).toBe(form);
  });

  it('keeps its error line in the document while empty, as a live region', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    const line = q(root, '.roster-edit-error');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.textContent).toBe('');
  });

  it('saves with one RPC: trimmed values, the phone normalized, blanks as null — then shows the corrected row', async () => {
    const client = twoCuppers();
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), '  Alicia Tan ');
    type(field(root, 'e1', 'phone'), ' 7000009 ');
    type(field(root, 'e1', 'email'), '');
    type(field(root, 'e1', 'cafe'), 'New Cafe');
    type(field(root, 'e1', 'bib'), ' 12 ');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '.roster-edit-form')).toBeNull());

    expect(client.rpcCalls).toEqual([
      [
        'update_roster_entry',
        {
          p_org_id: 'org1',
          p_entry_id: 'e1',
          p_display_name: 'Alicia Tan',
          p_phone: '+6737000009',
          p_email: null,
          p_cafe: 'New Cafe',
          p_bib: '12',
        },
      ],
    ]);
    const row = q(root, '#roster-row-e1').textContent;
    expect(row).toContain('Alicia Tan');
    expect(row).toContain('+6737000009');
    expect(row).toContain('New Cafe');
    expect(row).toContain('Bib 12');
    expect(row).not.toContain('one@example.com'); // the cleared email is gone from the list
    expect(q(root, '#roster-row-e2').textContent).toContain('Cupper Two'); // untouched
  });

  it('says the audience view and published results update on the next publish when the name or cafe changed — and focuses the row’s Edit button', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Alicia Tan');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '#roster-saved-e1')).not.toBeNull());
    // The confirmation sits in the edited cupper's own row and takes focus there — not in the
    // feedback line below the list, which on a long roster is off-screen.
    expect(q(root, '#roster-saved-e1').textContent).toBe(
      'Alicia Tan updated. The audience view and any published results show the new details the next time they are published.',
    );
    expect(q(root, '#roster-row-e1').contains(q(root, '#roster-saved-e1'))).toBe(true);
    expect(q(root, '#roster-saved-e1').getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(q(root, '#roster-saved-e1'));
  });

  it('does not mention publishing when only the bib changed — nothing public shows a bib', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'bib'), '99');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '#roster-saved-e1')).not.toBeNull());
    expect(q(root, '#roster-saved-e1').textContent).toBe('Cupper One updated.');
  });

  it('a phone number another cupper already has stays inside the form: names who has it, keeps what was typed, focuses the phone field', async () => {
    const client = twoCuppers();
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Alicia Tan');
    type(field(root, 'e1', 'phone'), '+6737000002'); // Cupper Two's
    save(root).click();
    await vi.waitFor(() =>
      expect(q(root, '.roster-edit-error').textContent).toBe(
        'That phone number already belongs to Cupper Two. Check the number.',
      ),
    );
    expect(document.activeElement).toBe(field(root, 'e1', 'phone'));
    expect(field(root, 'e1', 'phone').getAttribute('aria-invalid')).toBe('true');
    expect(field(root, 'e1', 'displayName').value).toBe('Alicia Tan'); // nothing typed is lost
    expect(q(root, '#roster-feedback').textContent).toBe(''); // no false success
    expect(client.db.people.find((p) => p.id === 'p1').display_name).toBe('Cupper One'); // nothing changed
  });

  it('an email clash is reported the same way, case-insensitively, on the email field', async () => {
    const client = twoCuppers();
    client.db.people.find((p) => p.id === 'p2').email = 'Two@Example.com';
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'email'), 'two@example.COM');
    save(root).click();
    await vi.waitFor(() =>
      expect(q(root, '.roster-edit-error').textContent).toContain(
        'That email already belongs to Cupper Two',
      ),
    );
    expect(document.activeElement).toBe(field(root, 'e1', 'email'));
  });

  it('any other failure is shown in the form too, with the typed values kept and focus on the error', async () => {
    const client = fakeClient(
      {
        events: [eventRow],
        people: [person()],
        event_entries: [entry()],
      },
      { errorOn: 'rpc.update_roster_entry' },
    );
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Alicia Tan');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '.roster-edit-error').textContent).not.toBe(''));
    expect(field(root, 'e1', 'displayName').value).toBe('Alicia Tan');
    expect(document.activeElement).toBe(q(root, '.roster-edit-error'));
    expect(save(root).disabled).toBe(false); // can try again
  });

  it('a walk-up entry with no profile edits name, cafe and bib only — no phone or email fields, and none sent', async () => {
    const client = walkUp();
    const { root } = await mount(client);
    expect(q(root, '#roster-row-e3').querySelector('.roster-contact')).toBeNull();
    q(root, '#roster-edit-btn-e3').click();
    expect(field(root, 'e3', 'phone')).toBeNull();
    expect(field(root, 'e3', 'email')).toBeNull();
    expect(q(root, '.roster-edit-form').textContent).toContain(
      'A walk-up entry has no phone or email on file.',
    );
    type(field(root, 'e3', 'displayName'), 'Walk-Up Winner');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '.roster-edit-form')).toBeNull());
    expect(client.rpcCalls[0][1]).toMatchObject({
      p_phone: null,
      p_email: null,
      p_display_name: 'Walk-Up Winner',
    });
    // Editing never changes whether they are withdrawn.
    expect(q(root, '#roster-row-e3').dataset.withdrawn).toBe('true');
  });

  it('what is typed in the open form survives a re-render caused by withdrawing someone else', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Still Typing');
    type(field(root, 'e1', 'phone'), '+6737000042');

    q(root, '#roster-toggle-e2').click();
    await vi.waitFor(() => expect(q(root, '#roster-feedback').dataset.tone).toBe('success'));

    expect(field(root, 'e1', 'displayName').value).toBe('Still Typing');
    expect(field(root, 'e1', 'phone').value).toBe('+6737000042');
    expect(q(root, '#roster-row-e2').dataset.withdrawn).toBe('true'); // the withdraw really happened
  });

  it('what is typed in the open form survives registering a new cupper', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Still Typing');
    type(q(root, '[aria-label="Name"]'), 'New Person');
    type(q(root, '[aria-label="Phone"]'), '7000055');
    q(root, '.roster-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(q(root, '#roster-feedback').textContent).toContain('New Person registered'),
    );
    expect(field(root, 'e1', 'displayName').value).toBe('Still Typing');
  });

  it('disables the form while the save is in flight, and shows it is saving', async () => {
    const client = twoCuppers();
    let release;
    let rpcCallCount = 0; // counted HERE, at the wrapper: a second send would otherwise be invisible
    const originalRpc = client.rpc;
    client.rpc = (...args) => {
      rpcCallCount += 1;
      return new Promise((resolve) => {
        release = () => resolve(originalRpc(...args));
      });
    };
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Alicia Tan');
    save(root).click();
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    expect(save(root).disabled).toBe(true);
    expect(save(root).textContent).toBe('Saving…');
    // The accessible name follows the visible label (WCAG 2.5.3) while it says Saving.
    expect(save(root).getAttribute('aria-label')).toBe('Saving changes to Cupper One');
    expect(field(root, 'e1', 'displayName').disabled).toBe(true);
    // Escape must not close the form while the save is in flight either.
    q(root, '.roster-edit-form').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(q(root, '.roster-edit-form')).not.toBeNull();
    // A second submit while busy must not send a second RPC.
    q(root, '.roster-edit-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    release();
    await vi.waitFor(() => expect(q(root, '.roster-edit-form')).toBeNull());
    expect(rpcCallCount).toBe(1);
    expect(client.rpcCalls).toHaveLength(1);
  });

  it('if the save lands but the refresh fails, it says so rather than reporting a failure', async () => {
    const client = twoCuppers();
    const originalRpc = client.rpc;
    let broken = false;
    const failingReads = {
      ...client,
      rpc: (...args) => {
        broken = true; // from here on, reads fail
        return originalRpc(...args);
      },
      from: (table) => (broken ? throwingClient().from(table) : client.from(table)),
    };
    const { root } = await mount(failingReads);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Alicia Tan');
    save(root).click();
    await vi.waitFor(() =>
      expect(q(root, '#roster-feedback').textContent).toBe(
        'Saved, but the screen could not refresh — reload to see the roster.',
      ),
    );
    expect(q(root, '#roster-feedback').dataset.tone).toBe('success');
    expect(client.db.people.find((p) => p.id === 'p1').display_name).toBe('Alicia Tan');
  });
  it('stops the browser accepting more than the database will: maxlength on every capped field, in the edit form and the registration form', async () => {
    const { root } = await mount(twoCuppers());
    const caps = { displayName: '200', email: '254', cafe: '200', bib: '50' };
    for (const [key, max] of Object.entries(caps)) {
      expect(q(root, `.roster-form [data-field="${key}"]`).getAttribute('maxlength')).toBe(max);
    }
    q(root, '#roster-edit-btn-e1').click();
    for (const [key, max] of Object.entries(caps)) {
      expect(field(root, 'e1', key).getAttribute('maxlength')).toBe(max);
    }
  });

  it('says a too-long value is too long, in the form, instead of sending it', async () => {
    const client = twoCuppers();
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'cafe'), 'x'.repeat(201));
    save(root).click();
    expect(q(root, '.roster-edit-error').textContent).toBe(
      'Cafe is too long (200 characters at most).',
    );
    expect(document.activeElement).toBe(field(root, 'e1', 'cafe'));
    expect(client.rpcCalls).toHaveLength(0);
  });

  it('puts the title and the error line above the fields, so a problem is seen beside where the organiser is looking', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    const form = q(root, '.roster-edit-form');
    const order = [...form.children].map((child) => child.className);
    expect(order.slice(0, 3)).toEqual([
      'roster-edit-title',
      'roster-edit-error',
      'roster-form-fields',
    ]);
    expect(q(root, '.roster-edit-title').textContent).toBe('Editing Cupper One');
  });

  it('drops the saved confirmation as soon as the organiser does anything else', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'bib'), '99');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '#roster-saved-e1')).not.toBeNull());
    q(root, '#roster-toggle-e2').click();
    await vi.waitFor(() => expect(q(root, '#roster-feedback').dataset.tone).toBe('success'));
    expect(q(root, '#roster-saved-e1')).toBeNull();
  });

  it('drops the saved confirmation when a new cupper is registered', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'bib'), '99');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '#roster-saved-e1')).not.toBeNull());
    type(q(root, '[aria-label="Name"]'), 'New Person');
    type(q(root, '[aria-label="Phone"]'), '7000055');
    q(root, '.roster-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(q(root, '#roster-feedback').textContent).toContain('New Person registered'),
    );
    expect(q(root, '#roster-saved-e1')).toBeNull();
  });

  it('keeps the roster when the contact details cannot be read: contact lines vanish, and Edit says why it cannot open', async () => {
    const client = fakeClient(
      {
        events: [eventRow],
        people: [person()],
        event_entries: [entry()],
      },
      { errorOn: 'people.select' },
    );
    const { root } = await mount(client);
    expect(q(root, '#roster-row-e1')).not.toBeNull(); // the roster itself loaded
    expect(q(root, '.roster-contact')).toBeNull();
    q(root, '#roster-edit-btn-e1').click();
    expect(q(root, '.roster-edit-form')).toBeNull();
    expect(q(root, '#roster-feedback').dataset.tone).toBe('error');
    expect(q(root, '#roster-feedback').textContent).toContain('could not be loaded');
    // Withdraw still works: the contact read is a convenience, not a dependency.
    q(root, '#roster-toggle-e1').click();
    await vi.waitFor(() => expect(client.db.event_entries[0].withdrawn).toBe(true));
  });
  it('only Escape closes the form: other keys leave it open with what was typed', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'displayName'), 'Typed');
    for (const key of ['a', 'Tab', 'Enter']) {
      field(root, 'e1', 'displayName').dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
    }
    expect(q(root, '.roster-edit-form')).not.toBeNull();
    expect(field(root, 'e1', 'displayName').value).toBe('Typed');
  });

  it('shows contact details and opens Edit on a roster that mixes a walk-up with a linked cupper', async () => {
    // The contact read must be asked only for real person ids: a null in the list is a uuid-cast
    // error in PostgREST, which the screen swallows — every contact line and Edit would vanish.
    const client = fakeClient({
      events: [eventRow],
      people: [person()],
      event_entries: [
        entry(),
        entry({ id: 'e3', person_id: null, display_name: 'Walk Up', cafe: null, bib: null }),
      ],
    });
    const { root } = await mount(client);
    expect(q(root, '#roster-row-e1 .roster-contact').textContent).toBe(
      '+6737000001 · one@example.com',
    );
    q(root, '#roster-edit-btn-e1').click();
    expect(field(root, 'e1', 'phone').value).toBe('+6737000001');
  });

  it('typing in one field clears a complaint about another, and a stale complaint does not come back on a re-render', async () => {
    const { root } = await mount(twoCuppers());
    q(root, '#roster-edit-btn-e1').click();
    type(field(root, 'e1', 'phone'), '12');
    save(root).click();
    expect(field(root, 'e1', 'phone').getAttribute('aria-invalid')).toBe('true');
    type(field(root, 'e1', 'displayName'), 'Cupper One Again');
    expect(field(root, 'e1', 'phone').hasAttribute('aria-invalid')).toBe(false);
    expect(field(root, 'e1', 'phone').hasAttribute('aria-describedby')).toBe(false);
    expect(q(root, '.roster-edit-error').textContent).toBe('');
    // Withdrawing another cupper re-renders the whole screen: the cleared complaint stays cleared.
    q(root, '#roster-toggle-e2').click();
    await vi.waitFor(() => expect(q(root, '#roster-feedback').dataset.tone).toBe('success'));
    expect(q(root, '.roster-edit-error').textContent).toBe('');
    expect(field(root, 'e1', 'phone').hasAttribute('aria-invalid')).toBe(false);
  });

  it('mentions publishing for a cafe-only change, and not for a phone-only change', async () => {
    const first = await mount(twoCuppers());
    q(first.root, '#roster-edit-btn-e1').click();
    type(field(first.root, 'e1', 'cafe'), 'Another Cafe');
    save(first.root).click();
    await vi.waitFor(() => expect(q(first.root, '#roster-saved-e1')).not.toBeNull());
    expect(q(first.root, '#roster-saved-e1').textContent).toContain('audience view');

    const second = await mount(twoCuppers());
    q(second.root, '#roster-edit-btn-e1').click();
    type(field(second.root, 'e1', 'phone'), '7000099');
    save(second.root).click();
    await vi.waitFor(() => expect(q(second.root, '#roster-saved-e1')).not.toBeNull());
    expect(q(second.root, '#roster-saved-e1').textContent).toBe('Cupper One updated.');
  });

  it('editing an older entry whose snapshot is stale leaves the person’s current name and cafe alone', async () => {
    // The person has been renamed and moved since this entry was created; the form is prefilled
    // from the entry's snapshot, so fixing only the bib must not send the old values back to the
    // profile (the RPC compares against the snapshot).
    const client = fakeClient({
      events: [eventRow],
      people: [person({ display_name: 'Renamed One', cafe: 'Newer Cafe' })],
      event_entries: [entry()],
    });
    const { root } = await mount(client);
    q(root, '#roster-edit-btn-e1').click();
    expect(field(root, 'e1', 'displayName').value).toBe('Cupper One'); // the snapshot
    type(field(root, 'e1', 'bib'), '8');
    save(root).click();
    await vi.waitFor(() => expect(q(root, '#roster-saved-e1')).not.toBeNull());
    expect(client.db.event_entries[0].bib).toBe('8');
    expect(client.db.people[0]).toMatchObject({ display_name: 'Renamed One', cafe: 'Newer Cafe' });
  });
});
