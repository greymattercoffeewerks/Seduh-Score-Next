import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderStageCard, mountEventDashboardScreen } from './eventDashboardScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

describe('renderStageCard', () => {
  const prelims = { id: 's1', ordinal: 1, kind: 'prelims', cutoff: 8, status: 'pending' };
  const finals = { id: 's2', ordinal: 2, kind: 'finals', cutoff: null, status: 'complete' };

  it('labels a stage without heats yet as "Generate heats"', () => {
    const card = renderStageCard('ev1', prelims, false);
    const link = [...card.querySelectorAll('a')].find((a) => a.textContent.includes('heats'));
    expect(link.textContent).toBe('Generate heats');
    expect(link.getAttribute('href')).toBe('#/events/ev1/stages/s1/heats');
  });

  it('labels a stage with heats already generated as "Heats"', () => {
    const card = renderStageCard('ev1', prelims, true);
    const link = [...card.querySelectorAll('a')].find((a) => a.textContent === 'Heats');
    expect(link).not.toBeUndefined();
    expect(link.getAttribute('href')).toBe('#/events/ev1/stages/s1/heats');
  });

  it('always links to Standings for the stage', () => {
    const card = renderStageCard('ev1', prelims, false);
    const link = [...card.querySelectorAll('a')].find((a) => a.textContent === 'Standings');
    expect(link.getAttribute('href')).toBe('#/events/ev1/stages/s1/standings');
  });

  it('shows a cutoff for a non-terminal stage, "Terminal — champion stage" for the one with no cutoff', () => {
    expect(renderStageCard('ev1', prelims, false).textContent).toContain('Cutoff: top 8');
    expect(renderStageCard('ev1', finals, false).textContent).toContain(
      'Terminal — champion stage',
    );
  });

  it('the ordinal renders as a real ordinal label ("1st", not "1")', () => {
    expect(renderStageCard('ev1', prelims, false).querySelector('h3').textContent).toContain('1st');
  });
});

function fakeClient({ tables = {} } = {}) {
  const queues = {};
  for (const [table, response] of Object.entries(tables)) {
    queues[table] = Array.isArray(response) ? [...response] : [response];
  }
  return {
    from(table) {
      const queue = queues[table] ?? [{ data: null, error: null }];
      const resolve = () => (queue.length > 1 ? queue.shift() : queue[0]);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
        then: (onResolve, onReject) => Promise.resolve(resolve()).then(onResolve, onReject),
      };
      return builder;
    },
  };
}

const nonTestEvent = { id: 'ev1', name: 'October Cup', is_test: false };
const testEvent = { ...nonTestEvent, is_test: true };

// Matches setupScreen.test.js/rosterScreen.test.js's own identical
// throwingClient() helper — every `.from()` call fails, regardless of
// table or chain shape (select/eq/order/single/maybeSingle/then all
// resolve to the same error).
function throwingClient() {
  return {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
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

describe('mountEventDashboardScreen', () => {
  it('renders the event name and top-level Setup/Roster/Report links', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: { events: { data: nonTestEvent, error: null }, ct_stages: { data: [], error: null } },
    });
    await mountEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('h1').textContent).toBe('October Cup');
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#/events/ev1/setup');
    expect(hrefs).toContain('#/events/ev1/roster');
    expect(hrefs).toContain('#/events/ev1/report');
  });

  it('shows the is_test banner only for a test event', async () => {
    const rootTest = document.createElement('div');
    await mountEventDashboardScreen(rootTest, {
      eventId: 'ev1',
      client: fakeClient({
        tables: { events: { data: testEvent, error: null }, ct_stages: { data: [], error: null } },
      }),
    });
    expect(rootTest.querySelector('.is-test-banner')).not.toBeNull();

    const rootReal = document.createElement('div');
    await mountEventDashboardScreen(rootReal, {
      eventId: 'ev1',
      client: fakeClient({
        tables: {
          events: { data: nonTestEvent, error: null },
          ct_stages: { data: [], error: null },
        },
      }),
    });
    expect(rootReal.querySelector('.is-test-banner')).toBeNull();
  });

  // live_sessions enforces at most one active row per org (see
  // eventDashboardScreen.js's own findActiveLiveEventId comment) — these
  // three cases are the only ones that query can produce: this event is the
  // active one, a DIFFERENT event is, or none is (no row at all).
  it('shows "Live now" (with the pulsing status dot) when this event is the org\'s currently active live_sessions row', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: [], error: null },
        live_sessions: { data: { event_id: 'ev1' }, error: null },
      },
    });
    await mountEventDashboardScreen(root, { eventId: 'ev1', orgId: 'org1', client });
    const badge = root.querySelector('.event-live-status');
    expect(badge.textContent).toContain('Live now');
    expect(badge.querySelector('.status-live-dot')).not.toBeNull();
    expect(badge.classList.contains('event-live-status-live')).toBe(true);
  });

  it('names the other event when a DIFFERENT event is the org\'s active live_sessions row — the exact confusion this feature exists to close (a bare "Not currently live" doesn\'t tell the organiser where to look)', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        // Sequential findEvent() calls: this event first (loadState's own
        // first read), the other, actually-live event second (only reached
        // because it's a different id than eventId) — fakeClient's queue
        // shifts through an array in call order, same technique the
        // existing "renders one card per stage" test already uses for
        // stageHasHeats.
        events: [
          { data: nonTestEvent, error: null },
          { data: { id: 'ev2', name: 'Second Harvest Cup', is_test: false }, error: null },
        ],
        ct_stages: { data: [], error: null },
        live_sessions: { data: { event_id: 'ev2' }, error: null },
      },
    });
    await mountEventDashboardScreen(root, { eventId: 'ev1', orgId: 'org1', client });
    const badge = root.querySelector('.event-live-status');
    expect(badge.textContent).toBe('Not currently live — "Second Harvest Cup" is live instead');
    expect(badge.querySelector('.status-live-dot')).toBeNull();
    expect(badge.classList.contains('event-live-status-live')).toBe(false);
  });

  it('shows a bare "Not currently live" (no other event named) when the org has no active live_sessions row at all', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: [], error: null },
        live_sessions: { data: null, error: null },
      },
    });
    await mountEventDashboardScreen(root, { eventId: 'ev1', orgId: 'org1', client });
    const badge = root.querySelector('.event-live-status');
    expect(badge.textContent).toBe('Not currently live');
    expect(badge.querySelector('.status-live-dot')).toBeNull();
  });

  it('shows a "no stage plan yet" empty state pointing at Setup when there are no stages', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: { events: { data: nonTestEvent, error: null }, ct_stages: { data: [], error: null } },
    });
    await mountEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(root.textContent).toContain('No stage plan yet');
    expect(root.querySelector('.stage-card')).toBeNull();
  });

  it('renders one card per stage, ordered as returned, each reflecting its own hasHeats state', async () => {
    const stages = [
      { id: 's1', ordinal: 1, kind: 'prelims', cutoff: 8, status: 'pending' },
      { id: 's2', ordinal: 2, kind: 'finals', cutoff: null, status: 'pending' },
    ];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stages, error: null },
        // stageHasHeats(stageId) -> listHeatsForStage-style query per stage,
        // called sequentially (Promise.all preserves array order): s1 has
        // heats, s2 doesn't.
        ct_heats: [
          { data: [{ id: 'h1' }], error: null },
          { data: [], error: null },
        ],
      },
    });
    const root = document.createElement('div');
    await mountEventDashboardScreen(root, { eventId: 'ev1', client });

    const cards = [...root.querySelectorAll('.stage-card')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('1st');
    expect([...cards[0].querySelectorAll('a')].some((a) => a.textContent === 'Heats')).toBe(true);
    expect(cards[1].textContent).toContain('2nd');
    expect(
      [...cards[1].querySelectorAll('a')].some((a) => a.textContent === 'Generate heats'),
    ).toBe(true);
  });

  it('renders a Retry-capable error state when the initial load fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = { from: () => ({ from: () => {} }) };
    await mountEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    expect(root.querySelector('button').textContent).toBe('Retry');
  });

  it("a successful Retry moves focus to the event heading, not silently dropping it to <body> — matches rosterScreen.js/setupScreen.js's own identical fix", async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    // Deterministic, not call-count-based — flipped by the test itself the
    // moment Retry is clicked, matching setupScreen.test.js/rosterScreen.test.js's
    // own approach.
    let shouldFail = true;
    const succeeding = fakeClient({
      tables: { events: { data: nonTestEvent, error: null }, ct_stages: { data: [], error: null } },
    });
    const client = {
      from(table) {
        return shouldFail ? throwingClient().from(table) : succeeding.from(table);
      },
    };
    await mountEventDashboardScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');

    shouldFail = false;
    root.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('October Cup');
    expect(root.querySelector('.screen-feedback[data-tone="error"]')).toBeNull();
    // Found in review (ui-accessibility-reviewer, Phase 6 cross-screen a11y
    // pass): this screen never explicitly moved focus after a successful
    // load — the very first mount happened to be covered by router.js's
    // own generic "focus the new screen's own heading" fallback (nothing
    // here focused anything itself), but a Retry click doesn't go through
    // the router again, so a successful Retry silently dropped focus to
    // <body> until this fix.
    expect(document.activeElement.id).toBe('event-dashboard-heading');
  });

  it('resolves to an object with a callable unmount()', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: { events: { data: nonTestEvent, error: null }, ct_stages: { data: [], error: null } },
    });
    const handle = await mountEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(typeof handle.unmount).toBe('function');
    expect(() => handle.unmount()).not.toThrow();
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
          single: () => new Promise(() => {}),
          maybeSingle: () => new Promise(() => {}),
          then: () => new Promise(() => {}),
        };
        return b;
      }
      const hungClient = { from: () => hungBuilder() };
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mountPromise = mountEventDashboardScreen(root, { eventId: 'ev1', client: hungClient });

      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Loading event');

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
    // attemptLoad() promise gets a chance to resolve.
    let resolveEvent;
    const client = {
      from(table) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          single: () =>
            table === 'events'
              ? new Promise((resolve) => {
                  resolveEvent = () => resolve({ data: nonTestEvent, error: null });
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

    const mountPromise = mountEventDashboardScreen(root, {
      eventId: 'ev1',
      client,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveEvent).toBeDefined());
    expect(root.textContent).toContain('Loading event');

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-loading screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    controller.abort();
    resolveEvent();
    await mountPromise;

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own dashboard.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('October Cup');
  });
});
