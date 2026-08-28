import { describe, it, expect } from 'vitest';
import { mountPhoneSummary } from './phoneSummary.js';

// `events` defaults to one row for org1 so viewer-shell.js's own
// noEvent/notStarted distinction (see viewer-shell.test.js) doesn't affect
// these tests, none of which are about that distinction.
function fakeClient(initialRows = [], { events = [{ id: 'ev1', org_id: 'org1' }] } = {}) {
  const db = { live_sessions: [...initialRows], events: [...events] };

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function makeBuilder(table) {
    const filters = [];
    const builder = {
      select: () => builder,
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle() {
        const rows = db[table].filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    return builder;
  }

  return {
    db,
    from: (table) => makeBuilder(table),
    channel: () => ({
      on() {
        return this;
      },
      subscribe(cb) {
        Promise.resolve().then(() => cb('SUBSCRIBED'));
        return this;
      },
    }),
    removeChannel: () => {},
  };
}

describe('mountPhoneSummary', () => {
  it('mounts a chrome-visible viewer-shell wired to viewerBody, with no data-surface override', async () => {
    const root = document.createElement('div');
    await mountPhoneSummary(root, { orgId: 'org1', client: fakeClient([]) });
    // showChrome: true — the phone surface's own defining choice, per this
    // task's scoping (matching the legacy reference app's phone-vs-
    // projector split).
    expect(root.querySelector('.viewer-chrome')).not.toBeNull();
    expect(root.getAttribute('data-surface')).toBeNull();
    // Whole subtree, not just root — a regression could stamp it onto
    // .viewer-chrome or .viewer-shell instead.
    expect(root.querySelectorAll('[data-surface]')).toHaveLength(0);
  });

  it('shows real standings content once the org has a published session', async () => {
    const root = document.createElement('div');
    const client = fakeClient([
      {
        id: 's1',
        org_id: 'org1',
        event_id: 'ev1',
        format: 'cup_taster',
        active: true,
        is_test: false,
        payload: {
          stage: { kind: 'prelims', setCount: 5 },
          standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
        },
      },
    ]);
    await mountPhoneSummary(root, { orgId: 'org1', client });
    expect(root.querySelector('.standings-table')).not.toBeNull();
    expect(root.textContent).toContain('Alex');
  });

  it('falls back to the shell\'s own "waiting for the organiser" holding state when nothing is published', async () => {
    const root = document.createElement('div');
    await mountPhoneSummary(root, { orgId: 'org1', client: fakeClient([]) });
    expect(root.textContent).toContain('Waiting for the organiser');
  });
});
