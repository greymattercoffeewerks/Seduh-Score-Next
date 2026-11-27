// @vitest-environment jsdom
// The redemption module on the organiser screen: its setup (a toggle, the group size, the cap, the feeding rounds), the
// vote card of a GROUP (3 or 4 brewers: the tie-break vote can go only to a brewer in the tie), and the link to the
// Redemption page, which exists only once a redemption round does.
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { _clearAllForTests } from '../../core/db.js';
import { _resetOutboxOwnerForTests } from '../../core/outbox.js';
import { mountThrowdownEventScreen } from './eventScreen.js';

const EVENT = { id: 'ev', org_id: 'org', format: 'throwdown', name: 'Rehearsal', is_test: true };

function clientWith(tables, event = EVENT) {
  return {
    from(name) {
      const rows = tables[name] ?? [];
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: () => q,
        single: async () => ({ data: name === 'events' ? event : rows[0], error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return q;
    },
    rpc: async () => ({ error: null, status: 200 }),
  };
}

async function mount(tables, event = EVENT) {
  const root = document.createElement('div');
  document.body.append(root);
  await mountThrowdownEventScreen(root, {
    eventId: 'ev',
    client: clientWith({ events: [event], ...tables }, event),
    handlers: {},
  });
  return root;
}

beforeEach(async () => {
  await _clearAllForTests();
  _resetOutboxOwnerForTests();
  document.body.innerHTML = '';
});

const names = ['Ana', 'Bima', 'Citra', 'Dani'];
const entries = names.map((n) => ({ id: `e${n}`, display_name: n, withdrawn: false }));

describe('setting up redemption', () => {
  it('offers a Redemption toggle, with the group controls only when it is on', async () => {
    const root = await mount({ event_entries: entries });
    const toggle = root.querySelector('[data-focus-key="td-redemption-on"]');
    expect(toggle.checked).toBe(false);
    expect(root.querySelector('[data-focus-key="td-red-size"]')).toBeNull();
    expect(root.querySelector('[data-focus-key="td-red-cap"]')).toBeNull();
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    // 1 v 1 first (owner, 27 Nov): there is no group-size control yet
    expect(root.querySelector('[data-focus-key="td-red-size"]')).toBeNull();
    expect(root.textContent).toContain('into pairs (1 v 1');
    expect(root.querySelector('[data-focus-key="td-red-cap"]').value).toBe('0');
    expect(root.querySelector('[data-focus-key="td-red-feed-1"]').checked).toBe(true);
    expect(root.querySelector('[data-focus-key="td-red-feed-2"]').checked).toBe(false);
    expect(root.textContent).toContain('more than four winners');
  });

  it('shows a saved setup as it was saved', async () => {
    const root = await mount({
      event_entries: entries,
      td_settings: [
        {
          judge_count: 3,
          third_place: true,
          seeding_mode: 'random',
          modules: { redemption: { group_size: 4, cap: 2, feed: [1, 2] } },
        },
      ],
    });
    expect(root.querySelector('[data-focus-key="td-redemption-on"]').checked).toBe(true);
    expect(root.querySelector('[data-focus-key="td-red-cap"]').value).toBe('2');
    expect(root.querySelector('[data-focus-key="td-red-feed-2"]').checked).toBe(true);
  });
});

// a group of four brewers, 4 judges (an even panel, so a tie is possible), votes as given: [slot id]
function groupTables(votes, { judges = 4, round = 1 } = {}) {
  const rows = ['s1', 's2', 's3', 's4'];
  return {
    event_entries: entries,
    td_settings: [
      {
        event_id: 'ev',
        judge_count: judges,
        third_place: true,
        modules: { redemption: { group_size: 4, cap: 0, feed: [1] } },
      },
    ],
    td_rounds: [
      { id: 'r1', position: 1, kind: 'pair', phase: 'main' },
      { id: 'r2', position: 2, kind: 'pool', phase: 'redemption' },
    ],
    td_matches: [
      {
        id: 'm0',
        round_id: 'r1',
        position: 1,
        result_kind: 'votes',
        confirmed_at: 't',
        walkover_winner_position: null,
      },
      {
        id: 'm1',
        round_id: 'r2',
        position: round,
        result_kind: null,
        confirmed_at: null,
        walkover_winner_position: null,
      },
    ],
    td_slots: [
      { id: 'a1', match_id: 'm0', position: 1, entry_id: 'eAna' },
      { id: 'a2', match_id: 'm0', position: 2, entry_id: 'eBima' },
      ...rows.map((id, i) => ({ id, match_id: 'm1', position: i + 1, entry_id: `e${names[i]}` })),
    ],
    td_votes: [
      { id: 'va', match_id: 'm0', slot_id: 'a1', created_at: '0' },
      ...votes.map((slot, i) => ({
        id: `v${i}`,
        match_id: 'm1',
        slot_id: slot,
        created_at: `${i}`,
      })),
    ],
  };
}
const disabledVotes = (root) =>
  [...root.querySelectorAll('.td-vote')].map((b) => b.getAttribute('aria-disabled') === 'true');

describe('voting a group', () => {
  it('draws one Vote button per brewer and names the group', async () => {
    const root = await mount(groupTables([]));
    expect(root.querySelectorAll('.td-vote')).toHaveLength(4);
    expect(root.textContent).toContain('Group 1: Ana, Bima, Citra and Dani');
  });

  it('keeps every brewer open to votes while the judges are still voting', async () => {
    const root = await mount(groupTables(['s1', 's2']));
    expect(disabledVotes(root)).toEqual([false, false, false, false]);
  });

  it('when all judges are in and two brewers are tied, only those two can take the tie-break vote', async () => {
    const root = await mount(groupTables(['s1', 's1', 's2', 's2']));
    // 2-2-0-0, four judges: level
    expect(disabledVotes(root)).toEqual([false, false, true, true]);
    expect(root.textContent).toContain(
      'The tie-break judge casts one more vote, for Ana and Bima.',
    );
    const confirm = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm result',
    );
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
  });

  it('a three-way tie with an odd panel opens the tie-break vote too (1-1-1 of three judges)', async () => {
    const root = await mount(groupTables(['s1', 's2', 's3'], { judges: 3 }));
    expect(disabledVotes(root)).toEqual([false, false, false, true]);
    expect(root.textContent).toContain('for Ana, Bima and Citra');
  });

  it('after the tie-break vote nothing more is taken, and the winner can be confirmed', async () => {
    const root = await mount(groupTables(['s1', 's1', 's2', 's2', 's2']));
    expect(disabledVotes(root)).toEqual([true, true, true, true]);
    expect(root.textContent).toContain(
      '4 of 4 votes in, plus the tie-break vote. Every judge has voted.',
    );
    const confirm = [...root.querySelectorAll('button')].find((b) =>
      b.textContent.startsWith('Confirm: '),
    );
    expect(confirm.textContent).toBe('Confirm: Bima wins');
    expect(confirm.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('offers each brewer a walkover, not a duel', async () => {
    const root = await mount(groupTables([]));
    const summary = root.querySelector('.td-walkover summary');
    expect(summary).not.toBeNull();
    const advances = [...root.querySelectorAll('.td-walkover button')].map((b) => b.textContent);
    expect(advances).toEqual(['Ana advances', 'Bima advances', 'Citra advances', 'Dani advances']);
  });
});

describe('the link to the Redemption page', () => {
  it('shows once a redemption round exists, and not before', async () => {
    const withRound = await mount(groupTables([]));
    const link = [...withRound.querySelectorAll('a')].find((a) =>
      a.textContent.includes('Redemption round: who is in'),
    );
    expect(link.getAttribute('href')).toBe('#/events/ev/throwdown/redemption');
    document.body.innerHTML = '';
    const without = await mount({
      event_entries: entries,
      td_rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
      td_matches: [
        { id: 'm0', round_id: 'r1', position: 1, result_kind: null, confirmed_at: null },
      ],
      td_slots: [
        { id: 'a1', match_id: 'm0', position: 1, entry_id: 'eAna' },
        { id: 'a2', match_id: 'm0', position: 2, entry_id: 'eBima' },
      ],
    });
    expect(without.textContent).not.toMatch(/redemption/i);
  });
});
