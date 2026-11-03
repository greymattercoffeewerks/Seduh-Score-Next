// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { buildResultsView } from './resultsScreen.js';

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
