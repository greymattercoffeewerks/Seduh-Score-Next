import { describe, it, expect } from 'vitest';
import { mountProjectorSurface } from './projectorSurface.js';

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

describe('mountProjectorSurface', () => {
  it('mounts a chrome-LESS viewer-shell wired to viewerBody, with data-surface="stage" on the root', async () => {
    const root = document.createElement('div');
    await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    // showChrome: false — the projector's own defining choice, opposite of
    // T5.4's phone surface (which shows the identity band).
    expect(root.querySelector('.viewer-chrome')).toBeNull();
    expect(root.getAttribute('data-surface')).toBe('stage');
    expect(root.classList.contains('projector-surface')).toBe(true);
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
    await mountProjectorSurface(root, { orgId: 'org1', client });
    expect(root.querySelector('.standings-table')).not.toBeNull();
    expect(root.textContent).toContain('Alex');
  });

  it('falls back to the shell\'s own "waiting for the organiser" holding state when nothing is published', async () => {
    const root = document.createElement('div');
    await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    expect(root.textContent).toContain('Waiting for the organiser');
  });

  it('still renders is_test unmistakably, exactly like the phone surface (owned entirely by viewer-shell.js)', async () => {
    const root = document.createElement('div');
    const client = fakeClient([
      {
        id: 's1',
        org_id: 'org1',
        event_id: 'ev1',
        format: 'cup_taster',
        active: true,
        is_test: true,
        payload: { standings: [{ position: 1, displayName: 'Alex' }] },
      },
    ]);
    await mountProjectorSurface(root, { orgId: 'org1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.getAttribute('role')).toBe('alert');
  });
});
