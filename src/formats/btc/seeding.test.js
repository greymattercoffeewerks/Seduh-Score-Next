import { describe, it, expect } from 'vitest';
import {
  SEEDING_REASON_MAX,
  fetchSeedingOrder,
  isMissingSeedingView,
  isCutoffTieRefusal,
  CUTOFF_TIE_MESSAGE,
  blockingGroups,
  seedingTieGroups,
  validateSeedingOrder,
  recordSeedingTiebreak,
  seedingRefusal,
  describeSeedingError,
} from './seeding.js';

// A view row as PostgREST returns it (counts may be strings, ranks null).
const viewRow = (teamId, seed, points, wins, extra = {}) => ({
  event_id: 'ev1',
  team_id: teamId,
  seed,
  played: 3,
  wins,
  total_points: points,
  tied_count: 1,
  tiebreak_rank: null,
  reason: null,
  group_resolved: true,
  ...extra,
});

function fakeClient({ order = [], orderError = null, rpcError = null } = {}) {
  const rpcCalls = [];
  const filters = [];
  const tables = [];
  return {
    rpcCalls,
    filters,
    tables,
    from(table) {
      tables.push(table);
      const builder = {
        select: () => builder,
        eq(column, value) {
          filters.push([table, column, value]);
          return builder;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: orderError ? null : order, error: orderError }).then(
            resolve,
            reject,
          );
        },
      };
      return builder;
    },
    rpc(name, args) {
      rpcCalls.push([name, args]);
      return Promise.resolve({ data: null, error: rpcError });
    },
  };
}

describe('fetchSeedingOrder', () => {
  it('coerces the numbers and returns best seed first, by team id (names are the screen\u2019s)', async () => {
    const client = fakeClient({
      order: [
        viewRow('b', '2', '40', '1', {
          tied_count: '2',
          tiebreak_rank: '2',
          reason: 'Cup-off',
          group_resolved: true,
        }),
        viewRow('a', '1', '45', '1'),
        viewRow('c', '3', '40', '1', { tied_count: '2', tiebreak_rank: '1', reason: 'Cup-off' }),
      ],
    });
    const rows = await fetchSeedingOrder('ev1', client);
    expect(rows.map((r) => [r.teamId, r.seed])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    expect(rows[1]).toEqual({
      teamId: 'b',
      seed: 2,
      wins: 1,
      totalPoints: 40,
      tiedCount: 2,
      tiebreakRank: 2,
      reason: 'Cup-off',
      groupResolved: true,
    });
    expect(rows[0].tiebreakRank).toBeNull();
    expect(rows[0].reason).toBeNull();
  });

  it('reads only this event, and only the one view', async () => {
    const client = fakeClient();
    await fetchSeedingOrder('ev1', client);
    expect(client.filters).toEqual([['btc_seeding_order', 'event_id', 'ev1']]);
    expect(client.tables).toEqual(['btc_seeding_order']);
  });

  it('treats anything but true as unresolved', async () => {
    const [row] = await fetchSeedingOrder(
      'ev1',
      fakeClient({ order: [viewRow('x', 1, 10, 0, { group_resolved: 'yes' })] }),
    );
    expect(row.groupResolved).toBe(false);
  });

  it('throws a failed read', async () => {
    await expect(
      fetchSeedingOrder('ev1', fakeClient({ orderError: new Error('view') })),
    ).rejects.toThrow('view');
  });
});

describe('isMissingSeedingView', () => {
  it('is only a relation that does not exist (PostgREST PGRST205, Postgres 42P01)', () => {
    expect(isMissingSeedingView({ code: 'PGRST205' })).toBe(true);
    expect(isMissingSeedingView({ code: '42P01' })).toBe(true);
    expect(isMissingSeedingView({ code: '42501' })).toBe(false);
    expect(isMissingSeedingView(new Error('Failed to fetch'))).toBe(false);
    expect(isMissingSeedingView(null)).toBe(false);
  });
});

describe('isCutoffTieRefusal', () => {
  it('recognises the database refusal for teams level across the cut-off, by its wording (it carries no hint)', () => {
    expect(
      isCutoffTieRefusal({
        message:
          'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie',
      }),
    ).toBe(true);
    expect(isCutoffTieRefusal({ message: 'a bracket already exists for this event' })).toBe(false);
    expect(isCutoffTieRefusal(null)).toBe(false);
    expect(CUTOFF_TIE_MESSAGE).toMatch(/8th and 9th/);
  });
});

describe('seedingTieGroups', () => {
  const row = (teamId, seed, points, wins, extra = {}) => ({
    teamId,
    seed,
    wins,
    totalPoints: points,
    tiedCount: 1,
    tiebreakRank: null,
    reason: null,
    groupResolved: true,
    ...extra,
  });
  const tied = (teamId, seed, points, wins, extra = {}) =>
    row(teamId, seed, points, wins, { tiedCount: 2, groupResolved: false, ...extra });

  it('finds no groups when nobody is level', () => {
    expect(seedingTieGroups([row('a', 1, 50, 2), row('b', 2, 40, 1)])).toEqual([]);
    expect(seedingTieGroups([])).toEqual([]);
  });

  it('groups teams level on points AND wins, in seed order, with the group in seed order too', () => {
    const groups = seedingTieGroups([
      row('a', 1, 50, 2),
      tied('c', 3, 40, 1),
      tied('b', 2, 40, 1),
      tied('e', 5, 30, 1),
      tied('d', 4, 30, 1),
      // same points, different wins: NOT level
      row('f', 6, 30, 0),
    ]);
    expect(groups.map((g) => [g.firstSeed, g.lastSeed, g.teams.map((t) => t.teamId)])).toEqual([
      [2, 3, ['b', 'c']],
      [4, 5, ['d', 'e']],
    ]);
    expect(groups[0]).toMatchObject({ points: 40, wins: 1, resolved: false, reason: null });
  });

  it('marks only the group across the cut-off as deciding who qualifies', () => {
    const groups = seedingTieGroups([
      tied('a', 7, 20, 1),
      tied('b', 8, 20, 1),
      tied('c', 9, 10, 0),
      tied('d', 10, 10, 0),
      tied('e', 1, 90, 3),
      tied('f', 2, 90, 3),
    ]);
    expect(groups.map((g) => [g.firstSeed, g.decidesQualifying])).toEqual([
      [1, false],
      [7, false],
      [9, false],
    ]);
    const across = seedingTieGroups([tied('a', 8, 20, 1), tied('b', 9, 20, 1)]);
    expect(across[0].decidesQualifying).toBe(true);
    // a group wholly inside the top eight, or wholly outside it, does not block
    expect(seedingTieGroups([tied('a', 7, 20, 1), tied('b', 8, 20, 1)])[0].decidesQualifying).toBe(
      false,
    );
    expect(seedingTieGroups([tied('a', 9, 20, 1), tied('b', 10, 20, 1)])[0].decidesQualifying).toBe(
      false,
    );
  });

  it('is resolved only when every team in the group says so, and carries the recorded reason', () => {
    const resolved = seedingTieGroups([
      tied('a', 2, 40, 1, { groupResolved: true, tiebreakRank: 1, reason: 'Head to head' }),
      tied('b', 3, 40, 1, { groupResolved: true, tiebreakRank: 2, reason: 'Head to head' }),
    ]);
    expect(resolved[0]).toMatchObject({ resolved: true, reason: 'Head to head' });
    const partly = seedingTieGroups([
      tied('a', 2, 40, 1, { groupResolved: true }),
      tied('b', 3, 40, 1, { groupResolved: false }),
    ]);
    expect(partly[0].resolved).toBe(false);
  });
});

describe('validateSeedingOrder', () => {
  const group = ['a', 'b', 'c'];
  const ok = { orderedTeamIds: ['b', 'a', 'c'], groupTeamIds: group, reason: 'Won the cup-off' };

  it('accepts a full order with a reason', () => {
    expect(validateSeedingOrder(ok)).toBeNull();
  });

  it('refuses an order that is not exactly the group', () => {
    const message = 'The order must list every team in the group once.';
    expect(validateSeedingOrder({ ...ok, orderedTeamIds: ['a', 'b'] })).toEqual({
      field: 'form',
      message,
    });
    expect(validateSeedingOrder({ ...ok, orderedTeamIds: ['a', 'a', 'b'] })).toEqual({
      field: 'form',
      message,
    });
    expect(validateSeedingOrder({ ...ok, orderedTeamIds: ['a', 'b', 'x'] })).toEqual({
      field: 'form',
      message,
    });
    expect(validateSeedingOrder({ ...ok, orderedTeamIds: ['a', 'b', 'c', 'd'] })).toEqual({
      field: 'form',
      message,
    });
  });

  it('requires a reason, trimmed, within the limit', () => {
    expect(validateSeedingOrder({ ...ok, reason: '   ' })).toEqual({
      field: 'reason',
      message: 'Give a reason, so the decision can be explained later.',
    });
    expect(validateSeedingOrder({ ...ok, reason: 'x'.repeat(SEEDING_REASON_MAX) })).toBeNull();
    expect(
      validateSeedingOrder({ ...ok, reason: `  ${'x'.repeat(SEEDING_REASON_MAX)}  ` }),
    ).toBeNull();
    expect(validateSeedingOrder({ ...ok, reason: 'x'.repeat(SEEDING_REASON_MAX + 1) })).toEqual({
      field: 'reason',
      message: 'Keep the reason to 120 characters or fewer.',
    });
  });
});

describe('recordSeedingTiebreak', () => {
  it('sends the order best first with a trimmed reason', async () => {
    const client = fakeClient();
    await recordSeedingTiebreak('org1', 'ev1', ['b', 'a'], '  Cup-off  ', client);
    expect(client.rpcCalls).toEqual([
      [
        'record_btc_seeding_tiebreak',
        { p_org_id: 'org1', p_event_id: 'ev1', p_team_ids: ['b', 'a'], p_reason: 'Cup-off' },
      ],
    ]);
  });

  it('throws the RPC error, hint and all', async () => {
    const error = Object.assign(new Error('refused'), { hint: 'seeding_not_tied' });
    await expect(
      recordSeedingTiebreak('org1', 'ev1', ['a', 'b'], 'x', fakeClient({ rpcError: error })),
    ).rejects.toBe(error);
  });
});

describe('refusals', () => {
  it.each([
    ['seeding_bracket_exists', true],
    ['seeding_preliminary_open', true],
    ['seeding_not_tied', true],
    ['seeding_group_incomplete', true],
    ['seeding_group_invalid', true],
    ['seeding_event_not_found', false],
    ['seeding_reason_required', false],
    ['seeding_reason_too_long', false],
  ])('knows %s, and whether the screen is out of date (%s)', (hint, reload) => {
    const refusal = seedingRefusal({ hint });
    expect(refusal.reload).toBe(reload);
    expect(refusal.message.length).toBeGreaterThan(10);
    expect(describeSeedingError({ hint })).toBe(refusal.message);
  });

  it('keys on the hint, never on the wording, and falls back to the generic message', () => {
    expect(seedingRefusal({ message: 'the bracket already exists' })).toBeNull();
    expect(seedingRefusal(null)).toBeNull();
    expect(seedingRefusal({ hint: 'something_else' })).toBeNull();
    expect(describeSeedingError(Object.assign(new Error('boom'), { code: 'XX000' }))).toBe(
      'Something went wrong saving that — try again.',
    );
    expect(describeSeedingError(new Error('Offline'))).toBe('Offline');
  });
});

describe('seedingTieGroups: keys and reasons', () => {
  const row = (teamId, seed, points, wins, extra = {}) => ({
    teamId,
    seed,
    wins,
    totalPoints: points,
    tiedCount: 2,
    tiebreakRank: null,
    reason: null,
    groupResolved: false,
    ...extra,
  });

  it('keys a group by its points and wins: digits and a hyphen only', () => {
    const [group] = seedingTieGroups([row('a', 2, 40, 1), row('b', 3, 40, 1)]);
    expect(group.key).toBe('40-1');
    expect(group.key).toMatch(/^[0-9-]+$/);
    // 40 pts 1 win and 4 pts 01... can never collide: the numbers are integers
    const keys = seedingTieGroups([
      row('a', 2, 40, 1),
      row('b', 3, 40, 1),
      row('c', 4, 4, 1),
      row('d', 5, 4, 1),
    ]).map((g) => g.key);
    expect(keys).toEqual(['40-1', '4-1']);
  });

  it('quotes a reason only for a group that is fully ordered, never for a partly ordered one', () => {
    const partly = seedingTieGroups([
      row('a', 2, 40, 1, { groupResolved: false, tiebreakRank: 1, reason: 'Head to head' }),
      row('b', 3, 40, 1),
      row('c', 4, 40, 1),
    ]);
    expect(partly[0].resolved).toBe(false);
    expect(partly[0].reason).toBeNull();
    const done = seedingTieGroups([
      row('a', 2, 40, 1, { groupResolved: true, tiebreakRank: 1, reason: 'Head to head' }),
      row('b', 3, 40, 1, { groupResolved: true, tiebreakRank: 2, reason: 'Head to head' }),
    ]);
    expect(done[0].reason).toBe('Head to head');
  });
});

describe('blockingGroups', () => {
  const row = (teamId, seed, points, wins, extra = {}) => ({
    teamId,
    seed,
    wins,
    totalPoints: points,
    tiedCount: 2,
    tiebreakRank: null,
    reason: null,
    groupResolved: false,
    ...extra,
  });

  it('is the groups level across the cut-off that nobody has ordered, and nothing else', () => {
    const across = [row('a', 8, 20, 1), row('b', 9, 20, 1)];
    const inside = [row('c', 2, 90, 3), row('d', 3, 90, 3)];
    expect(
      blockingGroups(seedingTieGroups([...across, ...inside])).map((g) => g.firstSeed),
    ).toEqual([8]);
    const ordered = across.map((r, i) => ({
      ...r,
      groupResolved: true,
      tiebreakRank: i + 1,
      reason: 'x',
    }));
    expect(blockingGroups(seedingTieGroups([...ordered, ...inside]))).toEqual([]);
    expect(blockingGroups([])).toEqual([]);
  });
});

describe('seeding.js: boundaries the first tests did not pin', () => {
  const grouped = (rows) => seedingTieGroups(rows);
  const row = (teamId, seed, points, wins, extra = {}) => ({
    teamId,
    seed,
    wins,
    totalPoints: points,
    tiedCount: 2,
    tiebreakRank: null,
    reason: null,
    groupResolved: false,
    ...extra,
  });

  it('the same points with different wins are two groups, not one', () => {
    const groups = grouped([
      row('a', 2, 40, 2),
      row('b', 3, 40, 2),
      row('c', 4, 40, 1),
      row('d', 5, 40, 1),
    ]);
    expect(groups.map((g) => [g.key, g.teams.map((t) => t.teamId)])).toEqual([
      ['40-2', ['a', 'b']],
      ['40-1', ['c', 'd']],
    ]);
  });

  it('only the full refusal is the cut-off refusal, not any message that mentions a tie', () => {
    expect(isCutoffTieRefusal({ message: 'a knockout match is tied' })).toBe(false);
    expect(isCutoffTieRefusal({ message: 'tied' })).toBe(false);
  });

  it('a row with no reason at all reads as null', async () => {
    const client = {
      from: () => {
        const b = {
          select: () => b,
          eq: () => b,
          then: (resolve) =>
            Promise.resolve({
              data: [{ ...viewRow('x', 1, 10, 0), reason: undefined }],
              error: null,
            }).then(resolve),
        };
        return b;
      },
    };
    const [r] = await fetchSeedingOrder('ev1', client);
    expect(r.reason).toBeNull();
  });
});
