import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScoringRecord } from './scoringRecord.js';

function recordClient(...responses) {
  const rpc = vi.fn();
  for (const r of responses) rpc.mockResolvedValueOnce(r);
  return { rpc };
}

function record(overrides = {}) {
  return {
    corrections: [],
    correction_count: 0,
    truncated: false,
    overflow: false,
    logged_changes: 0,
    by_area: null,
    placings: [],
    rehearsal_flag_changes: 0,
    rehearsal_flag_changes_after_publish: 0,
    ...overrides,
  };
}

function correction(overrides = {}) {
  return {
    at: '2026-09-14T10:30:00+00:00',
    by: 'Organiser',
    area: 'results',
    label: 'Prelims · heat 2',
    changes: 1,
    reason: null,
    reasoned: 0,
    ...overrides,
  };
}

const text = (node) => node.textContent.replace(/\s+/g, ' ');
const statusOf = (details) => details.querySelector('[role="status"]');

// Setting `open` makes jsdom fire the same `toggle` event a browser does (asynchronously), so
// this must NOT also dispatch one by hand — a second event would be a second, spurious load.
// Waits on observable state, not a fixed delay.
async function open(details, client) {
  details.open = true;
  await vi.waitFor(() => expect(client.rpc).toHaveBeenCalled());
  await vi.waitFor(() => expect(text(statusOf(details))).not.toContain('Loading'));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('buildScoringRecord', () => {
  it('fetches nothing until the reader opens the disclosure, and only once', async () => {
    const client = recordClient({ data: record(), error: null });
    const details = buildScoringRecord('ev1', { client });

    expect(client.rpc).not.toHaveBeenCalled();
    expect(details.querySelector('summary').textContent).toBe('How this was scored');

    await open(details, client);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('get_scoring_record', { p_event_id: 'ev1' });

    details.open = false;
    await vi.waitFor(() => expect(details.open).toBe(false));
    details.open = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('opening again while it is still loading does not start a second request', async () => {
    let release;
    const client = {
      rpc: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    };
    const details = buildScoringRecord('ev1', { client });

    details.open = true;
    await vi.waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(1));
    details.open = false;
    await new Promise((resolve) => setTimeout(resolve, 20));
    details.open = true;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.rpc).toHaveBeenCalledTimes(1);
    release({ data: record(), error: null });
  });

  it('names each disclosure after its event so several on one page are distinguishable', () => {
    const client = recordClient();
    const named = buildScoringRecord('ev1', { client, title: 'Jakarta Cup #09' });
    expect(named.querySelector('summary').textContent).toBe('How “Jakarta Cup #09” was scored');
  });

  it('says plainly when nothing was changed after confirmation', async () => {
    const client = recordClient({ data: record(), error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain(
      'No scores were changed after a heat, match or stage was confirmed.',
    );
    expect(details.querySelector('.results-record-list')).toBeNull();
  });

  it('lists each change with its area, label, count, role and reason', async () => {
    const data = record({
      corrections: [
        correction({
          area: 'results',
          label: 'Prelims · heat 2',
          changes: 2,
          reason: 'judge recount',
          reasoned: 2,
        }),
        correction({ area: 'times', label: 'Prelims · heat 2', changes: 1 }),
      ],
      correction_count: 2,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    const items = [...details.querySelectorAll('.results-record-item')].map(text);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Results · Prelims · heat 2');
    expect(items[0]).toContain('2 records changed by the Organiser.');
    expect(items[0]).toContain('Reason given by the Organiser: “judge recount”');
    expect(items[1]).toContain('Times · Prelims · heat 2');
    expect(items[1]).toContain('1 record changed by the Organiser.');
    expect(items[1]).toContain('No reason given.');
  });

  it('shows nothing but the documented fields: a stray raw-value field in the record is never rendered', async () => {
    const data = record({
      corrections: [
        correction({
          old_value: { correct: false },
          new_value: { correct: true },
          row_id: 'SECRET-ROW',
        }),
      ],
      correction_count: 1,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).not.toContain('SECRET-ROW');
    expect(text(details)).not.toContain('old_value');
  });

  it('renders an organiser-typed reason as inert text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.__pwned = 1"><script>window.__pwned = 2</script>';
    const data = record({
      corrections: [correction({ reason: hostile, reasoned: 1 })],
      correction_count: 1,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(details.querySelector('img')).toBeNull();
    expect(details.querySelector('script')).toBeNull();
    expect(text(details)).toContain(hostile);
    expect(window.__pwned).toBeUndefined();
  });

  it('is honest when only some of the changed records carried a reason', async () => {
    const data = record({
      corrections: [correction({ changes: 3, reason: 'recount', reasoned: 1 })],
      correction_count: 1,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain('“recount” (given for 1 of 3 records)');
  });

  it('treats a blank or whitespace-only reason as no reason, and a missing role as the Organiser', async () => {
    const data = record({
      corrections: [
        correction({ reason: '   ', reasoned: 1 }),
        correction({ reason: null, reasoned: 2 }),
        correction({ by: null, changes: 1 }),
      ],
      correction_count: 3,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    const items = [...details.querySelectorAll('.results-record-item')].map(text);
    expect(items[0]).toContain('No reason given.');
    expect(items[1]).toContain('No reason given.');
    expect(items[2]).toContain('changed by the Organiser.');
    expect(text(details)).not.toContain('undefined');
    expect(text(details)).not.toContain('null');
  });

  it('shows a too-large log as a visible flag with the true count and breakdown, and lists no changes', async () => {
    const data = record({
      overflow: true,
      truncated: true,
      correction_count: null,
      logged_changes: 500001,
      by_area: { times: 250001, results: 250000 },
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain(
      '500,001 changes were recorded after results were confirmed — too many to list here.',
    );
    expect(text(details)).toContain('Times: 250,001');
    expect(text(details)).toContain('Results: 250,000');
    expect(text(details)).toContain('Ask the organiser for the full record.');
    expect(details.querySelector('.results-record-item')).toBeNull();
    // the list is not shown, so it must not claim a re-open "is listed above"
    expect(text(details)).not.toContain('listed above');
  });

  it('says when the list is truncated, and does not claim a re-open is listed above', async () => {
    const data = record({ corrections: [correction()], correction_count: 250, truncated: true });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain('Showing the first 1 of 250 changes.');
    expect(text(details)).not.toContain('listed above');
  });

  it('says a re-open is listed above only when the list is complete', async () => {
    const client = recordClient({
      data: record({ corrections: [correction()], correction_count: 1 }),
      error: null,
    });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain('the re-opening is listed above');
  });

  it('never promises the exact scores: it says they can be requested from the organiser', async () => {
    const client = recordClient({ data: record(), error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain('can be requested from the organiser');
    expect(text(details)).not.toContain('available on request');
  });

  it('describes tiebreak and coin-toss placings by category only', async () => {
    const data = record({
      placings: [
        { stage: 'Prelims', decided_by: 'coin toss', count: 2 },
        { stage: 'Semis', decided_by: 'tiebreak', count: 1 },
      ],
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    const items = [...details.querySelectorAll('.results-record-item')].map(text);
    expect(items).toEqual(['Prelims: 2 by coin toss', 'Semis: 1 by tiebreak']);
  });

  it('shows an unknown area as its raw name and omits the time for an invalid date', async () => {
    const data = record({
      corrections: [correction({ area: 'mystery area', at: 'not-a-date' })],
      correction_count: 1,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain('mystery area · Prelims · heat 2');
    expect(details.querySelector('.results-record-when')).toBeNull();
  });

  it('shows the time with its zone so two readers cannot see different unlabelled times', async () => {
    const data = record({
      corrections: [correction({ at: '2026-09-14T10:30:00+00:00' })],
      correction_count: 1,
    });
    const client = recordClient({ data, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(details.querySelector('.results-record-when').textContent).toMatch(/2026/);
    expect(details.querySelector('.results-record-when').textContent).toMatch(
      /[A-Z]{2,5}|GMT|UTC|[+-]\d/,
    );
  });

  it('mentions rehearsal-status changes, the ones after publication, and stays quiet when there are none', async () => {
    const some = record({ rehearsal_flag_changes: 3, rehearsal_flag_changes_after_publish: 1 });
    const c1 = recordClient({ data: some, error: null });
    const d1 = buildScoringRecord('ev1', { client: c1 });
    await open(d1, c1);
    expect(text(d1)).toContain(
      'rehearsal (test) status was changed 3 times, 1 of them after results were published.',
    );

    const one = record({ rehearsal_flag_changes: 1, rehearsal_flag_changes_after_publish: 0 });
    const c2 = recordClient({ data: one, error: null });
    const d2 = buildScoringRecord('ev1', { client: c2 });
    await open(d2, c2);
    expect(text(d2)).toContain('was changed 1 time.');

    const c3 = recordClient({ data: record(), error: null });
    const none = buildScoringRecord('ev1', { client: c3 });
    await open(none, c3);
    expect(text(none)).not.toContain('rehearsal');
  });

  it('says a record is not available when the server returns nothing', async () => {
    const client = recordClient({ data: null, error: null });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(details)).toContain('A scoring record is not available for this event.');
  });

  it('announces loading, then the error, in one persistent polite live region', async () => {
    let release;
    const client = {
      rpc: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    };
    const details = buildScoringRecord('ev1', { client });
    const region = statusOf(details);

    // the live region exists before anything is announced (a region inserted already
    // populated is often not read out) and is empty until there is something to say
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    expect(region.getAttribute('aria-live')).toBe('polite');

    details.open = true;
    await vi.waitFor(() => expect(region.textContent).toContain('Loading'));
    release({ data: null, error: new Error('boom') });
    await vi.waitFor(() => expect(region.textContent).toContain('Something went wrong'));
    expect(statusOf(details)).toBe(region);
  });

  it('shows an error with a retry that loads again and succeeds, keeping keyboard focus', async () => {
    const client = recordClient(
      { data: null, error: new Error('boom') },
      { data: record(), error: null },
    );
    const details = buildScoringRecord('ev1', { client });
    document.body.append(details);
    await open(details, client);

    expect(text(details)).toContain('Something went wrong loading the scoring record.');
    const retry = details.querySelector('.results-record-retry');
    expect(retry).not.toBeNull();

    retry.focus();
    expect(document.activeElement).toBe(retry);
    retry.click();
    expect(retry.disabled).toBe(true);
    await vi.waitFor(() => expect(client.rpc).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(text(details)).toContain(
        'No scores were changed after a heat, match or stage was confirmed.',
      ),
    );

    expect(details.querySelector('.results-record-retry')).toBeNull();
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });

  it('reports a timeout distinctly from a failure', async () => {
    vi.useFakeTimers();
    const client = { rpc: vi.fn(() => new Promise(() => {})) };
    const details = buildScoringRecord('ev1', { client });
    details.open = true;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(text(statusOf(details))).toContain('This is taking longer than expected.');
    expect(details.querySelector('.results-record-retry')).not.toBeNull();
  });

  it('shows a rendering bug as its own message with no retry, and logs it', async () => {
    // a corrections entry that makes the renderer throw
    const bad = correction();
    Object.defineProperty(bad, 'changes', {
      get() {
        throw new Error('render bug');
      },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = recordClient({
      data: record({ corrections: [bad], correction_count: 1 }),
      error: null,
    });
    const details = buildScoringRecord('ev1', { client });
    await open(details, client);

    expect(text(statusOf(details))).toContain('The scoring record could not be displayed.');
    expect(text(details)).not.toContain('Loading');
    expect(text(details)).not.toContain('Something went wrong loading');
    expect(details.querySelector('.results-record-retry')).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
