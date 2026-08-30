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
});
