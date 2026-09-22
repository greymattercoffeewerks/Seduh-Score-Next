import { describe, it, expect } from 'vitest';
import {
  validateBracketMatchJudges,
  generateBracket,
  createBracketMatch,
  fetchBracket,
  BRACKET_ROUND_ORDER,
  BRACKET_ROUND_LABELS,
} from './bracket.js';

// Table-based fake client (matches.test.js's own shape) extended with `.in()` —
// fetchBracket's only new query shape (a `.select().eq().in()` for the matches lookup).
function fakeClient({ tables = {}, rpc } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(tables)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  const rpcCalls = [];

  function matchesFilters(row, filters, inFilters) {
    return (
      filters.every(([col, val]) => row[col] === val) &&
      inFilters.every(([col, vals]) => vals.includes(row[col]))
    );
  }

  function makeBuilder(table) {
    const filters = [];
    const inFilters = [];
    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      in(col, vals) {
        inFilters.push([col, vals]);
        return builder;
      },
      then(resolve, reject) {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters, inFilters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from: (table) => makeBuilder(table),
    rpc: (name, args) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpc ?? { data: null, error: null });
    },
    rpcCalls,
  };
}

describe('validateBracketMatchJudges', () => {
  it('requires exactly 3 judges', () => {
    expect(validateBracketMatchJudges(['j1', 'j2'])).toBe(
      'Exactly 3 distinct judges must be selected.',
    );
  });

  it('rejects a duplicate among 3', () => {
    expect(validateBracketMatchJudges(['j1', 'j1', 'j2'])).toBe(
      'Exactly 3 distinct judges must be selected.',
    );
  });

  it('accepts exactly 3 distinct judges', () => {
    expect(validateBracketMatchJudges(['j1', 'j2', 'j3'])).toBeNull();
  });

  it('rejects an empty/missing list rather than throwing', () => {
    expect(validateBracketMatchJudges(undefined)).toBe(
      'Exactly 3 distinct judges must be selected.',
    );
  });
});

describe('generateBracket', () => {
  it('calls generate_btc_bracket with the expected RPC args', async () => {
    const client = fakeClient({ rpc: { data: [], error: null } });
    await generateBracket('org1', 'ev1', client);
    expect(client.rpcCalls).toEqual([
      ['generate_btc_bracket', { p_org_id: 'org1', p_event_id: 'ev1' }],
    ]);
  });

  it('throws the raw RPC error (e.g. an unresolved seeding tie) rather than swallowing it', async () => {
    const client = fakeClient({
      rpc: { data: null, error: { code: 'P0001', message: 'teams are tied for the 8th spot' } },
    });
    await expect(generateBracket('org1', 'ev1', client)).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('createBracketMatch', () => {
  it('calls create_btc_bracket_match with the expected RPC args and returns the created match', async () => {
    const createdMatch = { id: 'm1', round: 'quarterfinal' };
    const client = fakeClient({ rpc: { data: createdMatch, error: null } });

    const result = await createBracketMatch('org1', 'slot1', ['j1', 'j2', 'j3'], client);

    expect(result).toEqual(createdMatch);
    expect(client.rpcCalls).toEqual([
      [
        'create_btc_bracket_match',
        { p_org_id: 'org1', p_slot_id: 'slot1', p_judge_ids: ['j1', 'j2', 'j3'] },
      ],
    ]);
  });

  it('throws the raw RPC error rather than swallowing it', async () => {
    const client = fakeClient({
      rpc: { data: null, error: { code: 'P0001', message: 'this slot already has a match' } },
    });
    await expect(
      createBracketMatch('org1', 'slot1', ['j1', 'j2', 'j3'], client),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('fetchBracket', () => {
  it('returns an empty array when no bracket has been generated yet', async () => {
    const client = fakeClient({ tables: { btc_bracket_slots: [] } });
    expect(await fetchBracket('ev1', client)).toEqual([]);
  });

  it('sorts into bracket display order (quarterfinal, semifinal, final, third_place), not alphabetical', async () => {
    const client = fakeClient({
      tables: {
        btc_bracket_slots: [
          { id: 's-final', event_id: 'ev1', round: 'final', slot_label: 'final', match_id: null },
          {
            id: 's-third',
            event_id: 'ev1',
            round: 'third_place',
            slot_label: 'third_place',
            match_id: null,
          },
          {
            id: 's-qf2',
            event_id: 'ev1',
            round: 'quarterfinal',
            slot_label: 'qf2',
            match_id: null,
          },
          {
            id: 's-qf1',
            event_id: 'ev1',
            round: 'quarterfinal',
            slot_label: 'qf1',
            match_id: null,
          },
          { id: 's-sf1', event_id: 'ev1', round: 'semifinal', slot_label: 'sf1', match_id: null },
        ],
        btc_matches: [],
      },
    });

    const result = await fetchBracket('ev1', client);
    expect(result.map(({ slot }) => slot.slot_label)).toEqual([
      'qf1',
      'qf2',
      'sf1',
      'final',
      'third_place',
    ]);
  });

  it('attaches each slot its own match status when a match has been created', async () => {
    const client = fakeClient({
      tables: {
        btc_bracket_slots: [
          {
            id: 's-qf1',
            event_id: 'ev1',
            round: 'quarterfinal',
            slot_label: 'qf1',
            match_id: 'm1',
          },
          {
            id: 's-qf2',
            event_id: 'ev1',
            round: 'quarterfinal',
            slot_label: 'qf2',
            match_id: null,
          },
        ],
        btc_matches: [{ id: 'm1', status: 'confirmed' }],
      },
    });

    const result = await fetchBracket('ev1', client);
    expect(result).toEqual([
      {
        slot: {
          id: 's-qf1',
          event_id: 'ev1',
          round: 'quarterfinal',
          slot_label: 'qf1',
          match_id: 'm1',
        },
        match: { id: 'm1', status: 'confirmed' },
      },
      {
        slot: {
          id: 's-qf2',
          event_id: 'ev1',
          round: 'quarterfinal',
          slot_label: 'qf2',
          match_id: null,
        },
        match: null,
      },
    ]);
  });
});

describe('BRACKET_ROUND_ORDER / BRACKET_ROUND_LABELS', () => {
  it('has a label for every round in the order list, and only those', () => {
    expect(Object.keys(BRACKET_ROUND_LABELS).sort()).toEqual([...BRACKET_ROUND_ORDER].sort());
  });
});
