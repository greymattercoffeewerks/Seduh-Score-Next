import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBtcEventDashboardScreen } from './eventDashboardScreen.js';

function fakeClient(tables = {}) {
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
        single: () => Promise.resolve(resolve()),
        then: (onResolve, onReject) => Promise.resolve(resolve()).then(onResolve, onReject),
      };
      return builder;
    },
  };
}

describe('mountBtcEventDashboardScreen', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it('shows the event name as the heading', async () => {
    const client = fakeClient({
      events: { data: { id: 'ev1', name: 'Regional Bracket', format: 'btc', is_test: false } },
    });
    await mountBtcEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('h1').textContent).toBe('Regional Bracket');
  });

  it('links to Setup, Matches, Standings, and Bracket, scoped to this event', async () => {
    const client = fakeClient({
      events: { data: { id: 'ev1', name: 'Regional Bracket', format: 'btc', is_test: false } },
    });
    await mountBtcEventDashboardScreen(root, { eventId: 'ev1', client });

    const links = [...root.querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Setup', '#/events/ev1/btc/setup'],
      ['Matches', '#/events/ev1/btc/matches'],
      ['Standings', '#/events/ev1/btc/standings'],
      ['Bracket', '#/events/ev1/btc/bracket'],
    ]);
  });

  it('shows the is-test banner for a test event, not for a real one', async () => {
    const client = fakeClient({
      events: { data: { id: 'ev1', name: 'Regional Bracket', format: 'btc', is_test: true } },
    });
    await mountBtcEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();

    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const client2 = fakeClient({
      events: { data: { id: 'ev1', name: 'Regional Bracket', format: 'btc', is_test: false } },
    });
    await mountBtcEventDashboardScreen(root2, { eventId: 'ev1', client: client2 });
    expect(root2.querySelector('.is-test-banner')).toBeNull();
    root2.remove();
  });

  it('moves focus to the heading once the initial load succeeds', async () => {
    const client = fakeClient({
      events: { data: { id: 'ev1', name: 'Regional Bracket', format: 'btc', is_test: false } },
    });
    await mountBtcEventDashboardScreen(root, { eventId: 'ev1', client });
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('shows a retry button and message when the initial load fails', async () => {
    const client = fakeClient({ events: { data: null, error: { code: '42501' } } });
    await mountBtcEventDashboardScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('button')?.textContent).toBe('Retry');
    expect(document.activeElement).not.toBeNull();
  });

  it('retries after a failed load and shows the event once it succeeds', async () => {
    const client = fakeClient({
      events: [
        { data: null, error: { code: '42501' } },
        { data: { id: 'ev1', name: 'Regional Bracket', format: 'btc', is_test: false } },
      ],
    });
    await mountBtcEventDashboardScreen(root, { eventId: 'ev1', client });

    root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('Regional Bracket');
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });
});
