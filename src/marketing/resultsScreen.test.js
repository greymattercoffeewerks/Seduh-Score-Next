import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountResultsScreen } from './resultsScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

function fakeClient(response) {
  return {
    from() {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
      };
      return builder;
    },
  };
}

function samplePayload(overrides = {}) {
  return {
    format: 'cup_taster',
    eventName: 'Jakarta Cup Tasters #09',
    city: 'Jakarta',
    venue: 'Ambang Coffee Lab',
    eventDate: '2026-09-14',
    competitors: 60,
    rounds: 3,
    winningTimeSecs: 102,
    podium: [
      { rank: 1, name: 'Raka Pradana', cafe: 'Kedai Runduk', correct: 7, total: 8 },
      { rank: 2, name: 'Nadine Putri', cafe: 'Ambang Coffee Lab', correct: 7, total: 8 },
    ],
    ...overrides,
  };
}

describe('mountResultsScreen', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    // revealOnScroll (core/scrollReveal.js) checks prefers-reduced-motion
    // before attaching an IntersectionObserver — jsdom implements neither by
    // default. Stubbing "reduced motion: true" takes its simpler
    // add-the-class-immediately path, which is all this test file needs
    // (it isn't testing scroll-reveal behavior itself).
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  it('renders the hero stats, the latest result, and the archive table from real published rows', async () => {
    // Three rows, deliberately varied so the derivation logic can't be
    // faked by a simpler formula that happens to agree with the fixture —
    // found in review (test-auditor): the original two-row fixture gave
    // every event the same `competitors` count and every event a distinct
    // city, so a bug that used `events.length * events[0].competitors`
    // instead of a real per-event sum, or `events.length` instead of a real
    // distinct-city count, would have passed identically.
    const rows = [
      {
        event_id: 'ev1',
        payload: samplePayload({ competitors: 60 }),
        published_at: '2026-09-16T00:00:00Z',
      },
      {
        event_id: 'ev2',
        payload: samplePayload({
          eventName: 'Bandung Coffee Week',
          city: 'Bandung',
          eventDate: '2026-08-31',
          competitors: 45,
          podium: [
            {
              rank: 1,
              name: 'Salsa Anindita',
              cafe: 'Serumpun Coffee House',
              correct: 6,
              total: 6,
            },
          ],
        }),
        published_at: '2026-08-30T00:00:00Z',
      },
      {
        event_id: 'ev3',
        payload: samplePayload({
          eventName: 'Jakarta Youth Cup',
          city: 'Jakarta', // same city as ev1 — proves dedup, not a raw count
          eventDate: null, // proves the archive date column falls back cleanly
          competitors: 20,
          podium: [{ rank: 1, name: 'Fajar Nugroho', cafe: null, correct: 5, total: 6 }],
        }),
        published_at: '2026-08-01T00:00:00Z',
      },
      {
        event_id: 'ev4',
        payload: samplePayload({
          eventName: 'Pop-Up Cupping',
          city: null, // proves the dedup's own filter(Boolean), not just its Set — found in review (test-auditor)
          competitors: 15,
          podium: [{ rank: 1, name: 'Wira Setiawan', cafe: null, correct: 4, total: 6 }],
        }),
        published_at: '2026-07-15T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });

    expect(root.querySelector('#results-title').textContent).toContain('Every table tells a');
    const stats = [...root.querySelectorAll('.results-stat b')].map((b) => b.textContent);
    // 4 events, 60+45+20+15 = 140 competitors (a real per-event sum, not
    // events.length * one event's count), still only 2 distinct cities
    // (Jakarta shared by ev1/ev3, ev4's null city excluded — not counted as
    // its own "city," and not inflating the count to 3).
    expect(stats).toEqual(['4', '140', '2']);

    expect(root.querySelector('#latest-title').textContent).toBe('Jakarta Cup Tasters #09');
    expect(root.querySelector('.results-eyebrow').textContent).toBe('Cup Taster');
    expect(root.textContent).toContain('Raka Pradana');
    expect(root.textContent).toContain('Kedai Runduk');

    // The latest event doesn't repeat as the first archive row, and the
    // archive's own row content (not just the name) is real.
    const archiveRows = [...root.querySelectorAll('.results-archive-row')];
    expect(
      archiveRows.map((row) => row.querySelector('.results-archive-name').textContent),
    ).toEqual(['Bandung Coffee Week', 'Jakarta Youth Cup', 'Pop-Up Cupping']);
    const bandungRow = archiveRows[0];
    expect(bandungRow.querySelector('.results-archive-winner').textContent).toBe('Salsa Anindita');
    expect(bandungRow.querySelector('.results-archive-result').textContent).toContain('6/6');
    expect(bandungRow.textContent).toContain('Bandung');

    // "How this was scored": the latest event's disclosure sits under its card; every archived
    // event's sits in a list BELOW the table (prose must reflow at 360px, and a full-width row
    // per event would break the table's semantics), each named after its own event. Each event
    // still has exactly one plain row in the table.
    expect(root.querySelector('.results-latest .results-record summary').textContent).toBe(
      'How “Jakarta Cup Tasters #09” was scored',
    );
    expect(root.querySelectorAll('.results-table td[colspan]')).toHaveLength(0);
    expect(root.querySelectorAll('.results-table tbody tr')).toHaveLength(3);
    expect(
      [...root.querySelectorAll('.results-archive-records .results-record summary')].map(
        (summary) => summary.textContent,
      ),
    ).toEqual([
      'How “Bandung Coffee Week” was scored',
      'How “Jakarta Youth Cup” was scored',
      'How “Pop-Up Cupping” was scored',
    ]);
    expect(root.querySelector('.results-table .results-record')).toBeNull();

    // ev3 has no eventDate — the archive date column falls back to an
    // em dash rather than throwing (formatDate(null) would crash).
    const jakartaYouthRow = archiveRows[1];
    expect(jakartaYouthRow.querySelector('.results-archive-date').textContent).toBe('—');

    // ev4 has no city — the archive location column falls back to an em
    // dash rather than showing a blank cell.
    const popUpRow = archiveRows[2];
    expect(popUpRow.querySelectorAll('td')[2].textContent).toBe('—');
  });

  it('does not crash when the latest event has no eventDate — formatDate(null) is never called unconditionally', async () => {
    const rows = [
      {
        event_id: 'ev1',
        payload: samplePayload({ eventDate: null }),
        published_at: '2026-09-16T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    expect(root.querySelector('#latest-title')).not.toBeNull();
    // No date segment, but the city is still shown — the meta line degrades
    // gracefully rather than showing "· Jakarta" with a leading separator.
    expect(root.querySelector('.results-latest-meta').textContent).toBe('Jakarta');
  });

  it('falls back to a generic label, not a crash, when a row has no format at all (e.g. published before this field existed)', async () => {
    const rows = [
      {
        event_id: 'ev1',
        payload: samplePayload({ format: undefined }),
        published_at: '2026-09-16T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    expect(root.querySelector('.results-eyebrow').textContent).toBe('Competition');
  });

  it('falls back to a readable label for a format this page has no explicit name for, rather than crashing or showing a raw snake_case string', async () => {
    const rows = [
      {
        event_id: 'ev1',
        payload: samplePayload({ format: 'liga_seduh' }),
        published_at: '2026-09-16T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    expect(root.querySelector('.results-eyebrow').textContent).toBe('Liga Seduh');
  });

  it('shows "BTC" for a published BTC result — regression coverage for a real bug where this key used to read "bbtc", which no real BTC event\'s format column has ever matched (BBTC is the Brunei-specific instance, not the format\'s own name)', async () => {
    const rows = [
      {
        event_id: 'ev1',
        payload: samplePayload({ format: 'btc' }),
        published_at: '2026-09-16T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    expect(root.querySelector('.results-eyebrow').textContent).toBe('BTC');
  });

  it('skips an archive row entirely (not a crash) for a published event with an empty podium', async () => {
    const rows = [
      { event_id: 'ev1', payload: samplePayload(), published_at: '2026-09-16T00:00:00Z' },
      {
        event_id: 'ev2',
        payload: samplePayload({ eventName: 'No Podium Event', podium: [] }),
        published_at: '2026-08-30T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    expect(root.querySelectorAll('.results-archive-row')).toHaveLength(0);
  });

  it('omits the archive section entirely when there is only one published event — nothing to list below the feature', async () => {
    const rows = [
      { event_id: 'ev1', payload: samplePayload(), published_at: '2026-09-16T00:00:00Z' },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    expect(root.querySelector('.results-archive')).toBeNull();
    expect(root.querySelector('#latest-title')).not.toBeNull();
  });

  it('shows a genuine empty state, not a crash or an empty table, when nothing has been published yet', async () => {
    const client = fakeClient({ data: [], error: null });
    await mountResultsScreen(root, { client });
    expect(root.textContent).toContain('No results published yet');
    expect(root.querySelector('#latest-title')).toBeNull();
  });

  it('shows an error state, not a crash, when the query fails', async () => {
    const client = fakeClient({ data: null, error: new Error('network error') });
    await mountResultsScreen(root, { client });
    expect(root.textContent).toContain('Something went wrong loading results');
  });

  it('omits cafe entirely for a podium finisher with none on record, rather than showing an empty label', async () => {
    const rows = [
      {
        event_id: 'ev1',
        payload: samplePayload({
          podium: [{ rank: 1, name: 'No Cafe', cafe: null, correct: 5, total: 6 }],
        }),
        published_at: '2026-09-16T00:00:00Z',
      },
    ];
    const client = fakeClient({ data: rows, error: null });
    await mountResultsScreen(root, { client });
    const podiumRow = root.querySelector('.results-podium-row');
    expect(podiumRow.querySelector('.results-podium-venue')).toBeNull();
    expect(podiumRow.textContent).toContain('No Cafe');
  });

  describe('a genuinely hung load', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('times out rather than leaving "Loading results…" as a permanent resting state', async () => {
      const hungClient = {
        from: () => ({
          select: () => hungClient.from(),
          order: () => new Promise(() => {}),
        }),
      };
      const mountPromise = mountResultsScreen(root, { client: hungClient });
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Loading results…');

      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
      expect(root.textContent).toContain('Loading results…');

      await vi.advanceTimersByTimeAsync(1);
      await mountPromise;
      expect(root.textContent).toContain('taking longer than expected');
    });
  });
  it('gives an archived event with no winner neither a table row nor a disclosure', async () => {
    const rows = [
      { event_id: 'ev1', payload: samplePayload(), published_at: '2026-09-16T00:00:00Z' },
      {
        event_id: 'ev2',
        payload: samplePayload({ eventName: 'No Podium Event', podium: [] }),
        published_at: '2026-08-30T00:00:00Z',
      },
      {
        event_id: 'ev3',
        payload: samplePayload({ eventName: 'Has Podium' }),
        published_at: '2026-08-01T00:00:00Z',
      },
    ];
    await mountResultsScreen(root, { client: fakeClient({ data: rows, error: null }) });

    expect(root.querySelectorAll('.results-table tbody tr')).toHaveLength(1);
    expect(
      [...root.querySelectorAll('.results-archive-records summary')].map((s) => s.textContent),
    ).toEqual(['How “Has Podium” was scored']);
  });
});
