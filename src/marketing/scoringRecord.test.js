import { describe, expect, it, vi } from 'vitest';
import { buildScoringRecord } from './scoringRecord.js';

function recordClient(...responses) {
  const rpc = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) rpc.mockRejectedValueOnce(r);
    else rpc.mockResolvedValueOnce(r);
  }
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

// Setting `open` makes jsdom fire the same `toggle` event a browser does (asynchronously), so
// this must NOT also dispatch one by hand — a second event would be a second, spurious load.
async function open(details) {
  details.open = true;
  // let jsdom's toggle event, the awaited rpc and raceTimeout all settle
  await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const text = (node) => node.textContent.replace(/\s+/g, ' ');

describe('buildScoringRecord', () => {
  it('fetches nothing until the reader opens the disclosure, and only once', async () => {
    const client = recordClient({ data: record(), error: null });
    const details = buildScoringRecord('ev1', { client });

    expect(client.rpc).not.toHaveBeenCalled();
    expect(details.querySelector('summary').textContent).toBe('How this was scored');

    await open(details);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('get_scoring_record', { p_event_id: 'ev1' });

    details.open = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await open(details);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('says plainly when nothing was changed after confirmation', async () => {
    const details = buildScoringRecord('ev1', {
      client: recordClient({ data: record(), error: null }),
    });
    await open(details);

    expect(text(details)).toContain(
      'No scores were changed after a heat, match or stage was confirmed.',
    );
    expect(details.querySelector('.results-record-list')).toBeNull();
  });

  it('lists each change with its area, label, count, role and reason, never an individual score', async () => {
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
    const details = buildScoringRecord('ev1', { client: recordClient({ data, error: null }) });
    await open(details);

    const items = [...details.querySelectorAll('.results-record-item')].map(text);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Results · Prelims · heat 2');
    expect(items[0]).toContain('2 records changed by the Organiser.');
    expect(items[0]).toContain('Reason given by the Organiser: “judge recount”');
    expect(items[1]).toContain('Times · Prelims · heat 2');
    expect(items[1]).toContain('1 record changed by the Organiser.');
    expect(items[1]).toContain('No reason given.');
    // shape-only: the record carries no scores, and the component never asks for them
    expect(text(details)).not.toMatch(/elapsed|correct|old_value|new_value/);
  });

  it('renders an organiser-typed reason as inert text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.__pwned = 1"><script>window.__pwned = 2</script>';
    const data = record({
      corrections: [correction({ reason: hostile, reasoned: 1 })],
      correction_count: 1,
    });
    const details = buildScoringRecord('ev1', { client: recordClient({ data, error: null }) });
    await open(details);

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
    const details = buildScoringRecord('ev1', { client: recordClient({ data, error: null }) });
    await open(details);

    expect(text(details)).toContain('“recount” (given for 1 of 3 records)');
  });

  it('shows a too-large log as a visible flag with the true count and breakdown, and lists no changes', async () => {
    const data = record({
      overflow: true,
      truncated: true,
      correction_count: null,
      logged_changes: 500001,
      by_area: { times: 250001, results: 250000 },
    });
    const details = buildScoringRecord('ev1', { client: recordClient({ data, error: null }) });
    await open(details);

    expect(text(details)).toContain(
      '500001 changes were recorded after results were confirmed — too many to list here.',
    );
    expect(text(details)).toContain('Times: 250001');
    expect(text(details)).toContain('Results: 250000');
    expect(text(details)).toContain('Ask the organiser for the full record.');
    expect(details.querySelector('.results-record-item')).toBeNull();
  });

  it('says when the list is truncated and how many there really are', async () => {
    const data = record({
      corrections: [correction()],
      correction_count: 250,
      truncated: true,
    });
    const details = buildScoringRecord('ev1', { client: recordClient({ data, error: null }) });
    await open(details);

    expect(text(details)).toContain('Showing the first 1 of 250 changes.');
  });

  it('describes tiebreak and coin-toss placings by category only', async () => {
    const data = record({
      placings: [
        { stage: 'Prelims', decided_by: 'coin toss', count: 2 },
        { stage: 'Semis', decided_by: 'tiebreak', count: 1 },
      ],
    });
    const details = buildScoringRecord('ev1', { client: recordClient({ data, error: null }) });
    await open(details);

    const items = [...details.querySelectorAll('.results-record-item')].map(text);
    expect(items).toEqual(['Prelims: 2 by coin toss', 'Semis: 1 by tiebreak']);
  });

  it('mentions rehearsal-status changes, and the ones after publication, and stays quiet when there are none', async () => {
    const some = record({ rehearsal_flag_changes: 3, rehearsal_flag_changes_after_publish: 1 });
    const d1 = buildScoringRecord('ev1', { client: recordClient({ data: some, error: null }) });
    await open(d1);
    expect(text(d1)).toContain(
      'rehearsal (test) status was changed 3 times, 1 of them after results were published.',
    );

    const one = record({ rehearsal_flag_changes: 1, rehearsal_flag_changes_after_publish: 0 });
    const d2 = buildScoringRecord('ev1', { client: recordClient({ data: one, error: null }) });
    await open(d2);
    expect(text(d2)).toContain('was changed 1 time.');

    const none = buildScoringRecord('ev1', {
      client: recordClient({ data: record(), error: null }),
    });
    await open(none);
    expect(text(none)).not.toContain('rehearsal');
  });

  it('says a record is not available when the server returns nothing', async () => {
    const details = buildScoringRecord('ev1', {
      client: recordClient({ data: null, error: null }),
    });
    await open(details);

    expect(text(details)).toContain('A scoring record is not available for this event.');
  });

  it('shows an error with a retry that loads again and succeeds', async () => {
    const client = recordClient(
      { data: null, error: new Error('boom') },
      { data: record(), error: null },
    );
    const details = buildScoringRecord('ev1', { client });
    await open(details);

    expect(text(details)).toContain('Something went wrong loading the scoring record.');
    const retry = details.querySelector('.results-record-retry');
    expect(retry).not.toBeNull();

    retry.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(text(details)).toContain(
      'No scores were changed after a heat, match or stage was confirmed.',
    );
    expect(details.querySelector('.results-record-retry')).toBeNull();
  });

  it('announces its loading and error states politely', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 10));

    const status = details.querySelector('[role="status"]');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Loading');

    release({ data: record(), error: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
