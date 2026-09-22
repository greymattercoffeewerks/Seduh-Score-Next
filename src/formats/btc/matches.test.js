import { describe, it, expect } from 'vitest';
import {
  validateMatchDraft,
  createMatch,
  listMatches,
  listJudgeIdsForMatch,
  findMatchById,
  removeMatch,
} from './matches.js';

// Table-based fake client (rosterScreen.test.js's own shape) extended with
// .rpc() — createMatch's only call, so a single queued response is enough;
// listMatches/listJudgeIdsForMatch/removeMatch use the table path.
function fakeClient({ tables = {}, rpc, errorOn } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(tables)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  const rpcCalls = [];

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function fails(table, method) {
    return errorOn === `${table}.${method}`;
  }

  function makeBuilder(table) {
    const filters = [];
    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        if (fails(table, 'single')) {
          return Promise.resolve({ data: null, error: { code: '42501' } });
        }
        const row = (db[table] ?? []).find((r) => matchesFilters(r, filters));
        return Promise.resolve(
          row
            ? { data: { ...row }, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } },
        );
      },
      delete() {
        if (fails(table, 'delete')) {
          return { eq: () => Promise.resolve({ data: null, error: { code: '42501' } }) };
        }
        return {
          eq: (col, val) => {
            db[table] = (db[table] ?? []).filter((row) => row[col] !== val);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      then(resolve, reject) {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
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

describe('validateMatchDraft', () => {
  it('requires both teams', () => {
    expect(validateMatchDraft({ team1Id: null, team2Id: 't2', judgeIds: [] })).toBe(
      'Both teams are required.',
    );
  });

  it('rejects a team playing itself', () => {
    expect(validateMatchDraft({ team1Id: 't1', team2Id: 't1', judgeIds: ['j1', 'j2', 'j3'] })).toBe(
      'A team cannot play itself.',
    );
  });

  it('requires exactly 3 judges', () => {
    expect(validateMatchDraft({ team1Id: 't1', team2Id: 't2', judgeIds: ['j1', 'j2'] })).toBe(
      'Exactly 3 distinct judges must be selected.',
    );
  });

  it('rejects 3 judges with a duplicate', () => {
    expect(validateMatchDraft({ team1Id: 't1', team2Id: 't2', judgeIds: ['j1', 'j1', 'j2'] })).toBe(
      'Exactly 3 distinct judges must be selected.',
    );
  });

  it('accepts a valid draft', () => {
    expect(
      validateMatchDraft({ team1Id: 't1', team2Id: 't2', judgeIds: ['j1', 'j2', 'j3'] }),
    ).toBeNull();
  });
});

describe('createMatch', () => {
  it('calls create_btc_match with the expected RPC args and returns the created match', async () => {
    const createdMatch = { id: 'm1', round: 'preliminary', team1_id: 't1', team2_id: 't2' };
    const client = fakeClient({ rpc: { data: createdMatch, error: null } });

    const result = await createMatch(
      'ev1',
      { round: 'preliminary', team1Id: 't1', team2Id: 't2', judgeIds: ['j1', 'j2', 'j3'] },
      client,
    );

    expect(result).toEqual(createdMatch);
    expect(client.rpcCalls).toEqual([
      [
        'create_btc_match',
        {
          p_event_id: 'ev1',
          p_round: 'preliminary',
          p_team1_id: 't1',
          p_team2_id: 't2',
          p_judge_ids: ['j1', 'j2', 'j3'],
        },
      ],
    ]);
  });

  it('throws the raw RPC error (e.g. a validation rejection) rather than swallowing it', async () => {
    const client = fakeClient({
      rpc: { data: null, error: { code: 'P0001', message: 'a team cannot play itself' } },
    });
    await expect(
      createMatch(
        'ev1',
        { round: 'preliminary', team1Id: 't1', team2Id: 't1', judgeIds: ['j1', 'j2', 'j3'] },
        client,
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('listMatches', () => {
  it('lists matches for a round with their assigned judge ids attached', async () => {
    const client = fakeClient({
      tables: {
        btc_matches: [
          { id: 'm1', event_id: 'ev1', round: 'preliminary', team1_id: 't1', team2_id: 't2' },
          { id: 'm2', event_id: 'ev1', round: 'quarterfinal', team1_id: 't3', team2_id: 't4' },
        ],
        btc_match_judges: [
          { match_id: 'm1', judge_id: 'j1' },
          { match_id: 'm1', judge_id: 'j2' },
          { match_id: 'm1', judge_id: 'j3' },
        ],
      },
    });

    const result = await listMatches('ev1', 'preliminary', client);
    expect(result).toEqual([
      {
        match: { id: 'm1', event_id: 'ev1', round: 'preliminary', team1_id: 't1', team2_id: 't2' },
        judgeIds: ['j1', 'j2', 'j3'],
      },
    ]);
  });

  it('returns an empty array when no matches exist for that round', async () => {
    const client = fakeClient({ tables: { btc_matches: [], btc_match_judges: [] } });
    expect(await listMatches('ev1', 'preliminary', client)).toEqual([]);
  });
});

describe('listJudgeIdsForMatch', () => {
  it('returns just the judge ids for a match', async () => {
    const client = fakeClient({
      tables: {
        btc_match_judges: [
          { match_id: 'm1', judge_id: 'j1' },
          { match_id: 'm1', judge_id: 'j2' },
          { match_id: 'm2', judge_id: 'j9' },
        ],
      },
    });
    expect(await listJudgeIdsForMatch('m1', client)).toEqual(['j1', 'j2']);
  });
});

describe('removeMatch', () => {
  it('deletes the match by id', async () => {
    const client = fakeClient({
      tables: { btc_matches: [{ id: 'm1', event_id: 'ev1', round: 'preliminary' }] },
    });
    await removeMatch('m1', client);
    expect(await listMatches('ev1', 'preliminary', client)).toEqual([]);
  });

  it('throws the raw error on a failed delete rather than swallowing it', async () => {
    const client = fakeClient({
      tables: { btc_matches: [{ id: 'm1', event_id: 'ev1', round: 'preliminary' }] },
      errorOn: 'btc_matches.delete',
    });
    await expect(removeMatch('m1', client)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('findMatchById', () => {
  it('returns exactly the requested match', async () => {
    const client = fakeClient({
      tables: {
        btc_matches: [
          { id: 'm1', event_id: 'ev1', round: 'preliminary' },
          { id: 'm2', event_id: 'ev1', round: 'final' },
        ],
      },
    });
    expect(await findMatchById('m2', client)).toEqual({
      id: 'm2',
      event_id: 'ev1',
      round: 'final',
    });
  });

  it('throws when there is no such match (or it is not visible), never returning null', async () => {
    const client = fakeClient({ tables: { btc_matches: [] } });
    await expect(findMatchById('nope', client)).rejects.toMatchObject({ code: 'PGRST116' });
  });

  it('throws the raw error on a failed read rather than swallowing it', async () => {
    const client = fakeClient({
      tables: { btc_matches: [{ id: 'm1' }] },
      errorOn: 'btc_matches.single',
    });
    await expect(findMatchById('m1', client)).rejects.toMatchObject({ code: '42501' });
  });
});
