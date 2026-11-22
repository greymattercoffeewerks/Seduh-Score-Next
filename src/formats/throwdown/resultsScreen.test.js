// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { buildResultsView, correctionLines } from './resultsScreen.js';

const entries = ['Ana', 'Bima', 'Citra', 'Dani'].map((n) => ({ id: n, display_name: n }));
const rows = {
  rounds: [
    { id: 'r1', position: 1, kind: 'pair', phase: 'main' },
    { id: 'r2', position: 2, kind: 'pair', phase: 'main' },
  ],
  matches: [
    { id: 'm1', round_id: 'r1', position: 1, result_kind: 'votes', confirmed_at: 't' },
    {
      id: 'm2',
      round_id: 'r1',
      position: 2,
      result_kind: 'walkover',
      confirmed_at: 't',
      walkover_winner_position: 1,
    },
    { id: 'm3', round_id: 'r2', position: 1, result_kind: 'votes', confirmed_at: 't' },
  ],
  slots: [
    { id: 'a', match_id: 'm1', position: 1, entry_id: 'Ana' },
    { id: 'b', match_id: 'm1', position: 2, entry_id: 'Bima' },
    { id: 'c', match_id: 'm2', position: 1, entry_id: 'Citra' },
    { id: 'd', match_id: 'm2', position: 2, entry_id: 'Dani' },
    { id: 'e', match_id: 'm3', position: 1, entry_id: 'Ana' },
    { id: 'f', match_id: 'm3', position: 2, entry_id: 'Citra' },
  ],
  votes: [
    { match_id: 'm1', slot_id: 'a' },
    { match_id: 'm1', slot_id: 'a' },
    { match_id: 'm1', slot_id: 'b' },
    { match_id: 'm3', slot_id: 'f' },
  ],
  entries,
};

describe('the results page', () => {
  it('names the podium and writes every result in words, with a Test banner on a test event', () => {
    const view = buildResultsView({ name: 'Night', is_test: true }, deriveBracket(rows));
    const text = view.textContent;
    expect(view.querySelector('.is-test-banner')).not.toBeNull();
    expect(text).toContain('Champion: Citra');
    expect(text).toContain('Runner-up: Ana');
    expect(text).toContain('2 to 1');
    expect(text).toContain('Walkover');
    expect([...view.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Podium',
      'Semi-finals',
      'Final',
    ]);
  });
  it('says so when the event is not finished, and shows no podium', () => {
    const view = buildResultsView(
      { name: 'Night', is_test: false },
      deriveBracket({
        ...rows,
        rounds: [rows.rounds[0]],
        matches: [rows.matches[0], { id: 'm2', round_id: 'r1', position: 2, result_kind: null }],
        slots: rows.slots.slice(0, 4),
      }),
    );
    expect(view.textContent).toContain('not finished yet');
    expect(view.querySelector('.td-podium')).toBeNull();
    expect(view.querySelector('.is-test-banner')).toBeNull();
  });
});

describe('corrections in the match log', () => {
  const bracket = deriveBracket(rows);
  const at = new Date(2026, 10, 27, 14, 32).toISOString();
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const reopen = (over) => ({
    round_position: 1,
    round_phase: 'main',
    match_position: 1,
    previous_result_kind: 'votes',
    previous_winner_entry_id: 'Bima',
    rounds_removed: 0,
    reopened_at: at,
    ...over,
  });

  it('writes each undone result in words: where, whose win, how decided, when, and what was removed', () => {
    expect(
      correctionLines(
        [
          reopen(),
          reopen({
            previous_result_kind: 'walkover',
            match_position: 2,
            previous_winner_entry_id: 'Dani',
            rounds_removed: 2,
          }),
        ],
        bracket,
        entries,
      ),
    ).toEqual([
      `Semi-finals, match 1: Bima’s win by votes was undone at ${time}.`,
      `Semi-finals, match 2: Dani’s win by walkover was undone at ${time}. The 2 rounds after it were removed and made again.`,
    ]);
  });

  it('names a round that no longer exists by its stored place', () => {
    expect(
      correctionLines(
        [reopen({ round_position: 7, previous_result_kind: 'scores', rounds_removed: 1 })],
        bracket,
        entries,
      ),
    ).toEqual([
      `Round 7, match 1: Bima’s win by scoresheets was undone at ${time}. The round after it was removed and made again.`,
    ]);
    expect(
      correctionLines(
        [reopen({ round_position: 9, round_phase: 'third_place' })],
        bracket,
        entries,
      )[0],
    ).toMatch(/^3rd place match, match 1:/);
  });

  it('shows a Corrections card only when something was undone', () => {
    const heads = (v) => [...v.querySelectorAll('h2')].map((h) => h.textContent);
    expect(heads(buildResultsView({ name: 'N' }, bracket))).not.toContain('Corrections');
    const view = buildResultsView(
      { name: 'N' },
      bracket,
      null,
      correctionLines([reopen()], bracket, entries),
    );
    expect(heads(view)).toContain('Corrections');
    expect(view.querySelector('.td-corrections li').textContent).toContain('Bima’s win by votes');
  });
});
