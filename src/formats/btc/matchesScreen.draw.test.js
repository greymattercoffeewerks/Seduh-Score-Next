import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountMatchesScreen } from './matchesScreen.js';
import { publishBtcLive } from './liveSession.js';

vi.mock('./liveSession.js', () => ({ publishBtcLive: vi.fn(async () => {}) }));

// The Draw a round panel on the matches screen (Build B part 2). The draw itself is draw.js's (tested there); these
// tests hold what the SCREEN does with it: preview, warnings, the gate on Create, focus, and the one RPC call.

function fakeClient(initialDb, { roundError } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) db[table] = rows.map((r) => ({ ...r }));
  const rpcCalls = [];
  let idCounter = 0;
  const matchesFilters = (row, filters) => filters.every(([c, v]) => row[c] === v);
  function makeBuilder(table) {
    const filters = [];
    const builder = {
      select: () => builder,
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      single() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
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
    rpc(name, args) {
      rpcCalls.push([name, args]);
      if (roundError) return Promise.resolve({ data: null, error: roundError });
      if (name === 'create_btc_round') {
        const made = args.p_matches.map((m) => {
          idCounter += 1;
          const row = {
            id: `new${idCounter}`,
            event_id: args.p_event_id,
            round: 'preliminary',
            prelim_round: args.p_prelim_round,
            status: 'pending',
            team1_id: m.team1_id,
            team2_id: m.team2_id,
          };
          db.btc_matches.push(row);
          for (const judge_id of m.judge_ids)
            db.btc_match_judges.push({ match_id: row.id, judge_id });
          return row;
        });
        return Promise.resolve({ data: made, error: null });
      }
      idCounter += 1;
      const row = {
        id: `m${idCounter}`,
        event_id: args.p_event_id,
        round: args.p_round,
        prelim_round: args.p_prelim_round ?? null,
        status: 'pending',
        team1_id: args.p_team1_id,
        team2_id: args.p_team2_id,
      };
      db.btc_matches.push(row);
      for (const judge_id of args.p_judge_ids)
        db.btc_match_judges.push({ match_id: row.id, judge_id });
      return Promise.resolve({ data: row, error: null });
    },
    rpcCalls,
    db,
  };
}

const COUNTRIES = ['BN', 'MY', 'SG', 'ID', 'TH', 'PH', 'VN'];

// n fictional teams, a few per country
function teamRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${String(i + 1).padStart(2, '0')}`,
    event_id: 'ev1',
    name: `Team ${i + 1}`,
    country_code: COUNTRIES[i % COUNTRIES.length],
  }));
}

function judgeRows(specs) {
  return specs.map(([id, country]) => ({
    id,
    event_id: 'ev1',
    name: `Judge ${id}`,
    country_code: country,
  }));
}

function dbWith({ teams, judges, matches = [], standings = [] }) {
  return {
    events: [{ id: 'ev1', org_id: 'org1', name: 'BTC', is_test: true }],
    btc_teams: teams,
    btc_judges: judges,
    btc_matches: matches,
    btc_match_judges: matches.flatMap((m) =>
      ['j1', 'j2', 'j3'].map((judge_id) => ({ match_id: m.id, judge_id })),
    ),
    btc_standings: standings,
  };
}

const SIX_JUDGES = judgeRows([
  ['j1', 'BN'],
  ['j2', 'MY'],
  ['j3', 'SG'],
  ['j4', null],
  ['j5', null],
  ['j6', null],
]);

// no judge has a country, so a hand swap can never create a judge conflict
const NEUTRAL_JUDGES = judgeRows([
  ['j1', null],
  ['j2', null],
  ['j3', null],
  ['j4', null],
]);

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function match(id, round, status, t1, t2) {
  return {
    id,
    event_id: 'ev1',
    round: 'preliminary',
    prelim_round: round,
    status,
    team1_id: t1,
    team2_id: t2,
  };
}

describe('Draw a round panel', () => {
  let root;
  let screen;

  beforeEach(() => {
    publishBtcLive.mockClear();
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    screen?.unmount();
    root.remove();
    vi.restoreAllMocks();
  });

  async function mount(db, opts = {}, handlers = { composed: true }) {
    const client = fakeClient(db, opts);
    screen = await mountMatchesScreen(root, { eventId: 'ev1', client, handlers });
    return client;
  }
  const q = (sel) => root.querySelector(sel);
  const cards = () => [...root.querySelectorAll('.btc-draw-match')];
  const cardTeams = (card) =>
    [...card.querySelectorAll('.btc-draw-team .btc-match-teams')].map((n) => n.textContent);
  const preview = () => cards().map(cardTeams);
  const createButton = () => q('[data-focus-key="draw-create"]');
  const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  function useSeed(text) {
    q('[data-field="draw-seed"]').value = text;
    click(q('[data-focus-key="draw-use-seed"]'));
  }
  const choose = (field) => {
    const radio = q(`[data-field="${field}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('opens on round 1 with a preview of every team, once each, as "Country · Name"', async () => {
    await mount(dbWith({ teams: teamRows(20), judges: SIX_JUDGES }));
    expect(q('.btc-draw-panel h2').textContent).toBe('Draw a round');
    expect(cards()).toHaveLength(10);
    const names = preview().flat();
    expect(new Set(names).size).toBe(20);
    expect(names).toContain('Brunei · Team 1');
    expect(cards()[0].querySelectorAll('select')).toHaveLength(3);
    expect(createButton().textContent).toBe('Create 10 matches');
    expect(createButton().disabled).toBe(false);
  });

  it('gives the same preview for the same seed, and shows the seed it used', async () => {
    await mount(dbWith({ teams: teamRows(20), judges: SIX_JUDGES }));
    useSeed('board-2027');
    const first = preview();
    expect(q('[data-field="draw-seed"]').value).toBe('board-2027');
    useSeed('another-seed');
    expect(preview()).not.toEqual(first);
    useSeed('board-2027');
    expect(preview()).toEqual(first);

    // a fresh mount (a different order of loading) reproduces it too
    screen.unmount();
    root.innerHTML = '';
    await mount(dbWith({ teams: [...teamRows(20)].reverse(), judges: SIX_JUDGES }));
    useSeed('board-2027');
    expect(preview()).toEqual(first);
  });

  it('refuses 19 teams in words and offers no Create', async () => {
    await mount(dbWith({ teams: teamRows(19), judges: SIX_JUDGES }));
    expect(root.textContent).toContain('There are 19 teams, an odd number.');
    expect(cards()).toHaveLength(0);
    expect(createButton()).toBeNull();
  });

  it('makes a new seed on New seed, and keeps focus on that button', async () => {
    await mount(dbWith({ teams: teamRows(20), judges: SIX_JUDGES }));
    useSeed('keep-me');
    const before = preview();
    const button = q('[data-focus-key="draw-new-seed"]');
    button.focus();
    click(button);
    expect(q('[data-field="draw-seed"]').value).not.toBe('keep-me');
    expect(preview()).not.toEqual(before);
    expect(document.activeElement.getAttribute('data-focus-key')).toBe('draw-new-seed');
    expect(q('.btc-draw-status').textContent).toContain('New seed');
  });

  describe('round 2', () => {
    const fourTeams = () => teamRows(4);
    const round1 = (status) => [
      match('r1a', 1, status, 't01', 't02'),
      match('r1b', null, status, 't03', 't04'), // an unnumbered match reads as round 1
    ];

    it('is unavailable until round 1 is fully confirmed, and says why', async () => {
      await mount(
        dbWith({
          teams: fourTeams(),
          judges: SIX_JUDGES,
          matches: [round1('confirmed')[0], match('r1b', null, 'pending', 't03', 't04')],
        }),
      );
      expect(q('[data-field="draw-round-1"]').checked).toBe(false); // round 1 is drawn, so the panel opens on round 2
      expect(q('[data-field="draw-round-2"]').checked).toBe(true);
      expect(root.textContent).toContain(
        'Round 2 can be drawn once every round 1 match is confirmed. 1 of 2 is still open.',
      );
      expect(cards()).toHaveLength(0);
      expect(createButton()).toBeNull();
    });

    it('says to draw round 1 first when nothing is drawn', async () => {
      await mount(dbWith({ teams: fourTeams(), judges: SIX_JUDGES }));
      choose('draw-round-2');
      expect(root.textContent).toContain('once round 1 has been drawn');
      expect(createButton()).toBeNull();
    });

    it('draws without repeat opponents when the round is confirmed', async () => {
      await mount(dbWith({ teams: fourTeams(), judges: SIX_JUDGES, matches: round1('confirmed') }));
      expect(q('[data-field="draw-avoid"]').checked).toBe(true);
      const played = new Set([
        'Brunei · Team 1|Malaysia · Team 2',
        'Singapore · Team 3|Indonesia · Team 4',
      ]);
      for (const [a, b] of preview()) {
        expect(played.has(`${a}|${b}`) || played.has(`${b}|${a}`)).toBe(false);
      }
      expect(root.textContent).not.toContain('rematch');
    });

    it('says how many rematches could not be avoided', async () => {
      const two = teamRows(2);
      await mount(
        dbWith({
          teams: two,
          judges: SIX_JUDGES,
          matches: [match('r1a', 1, 'confirmed', 't01', 't02')],
        }),
      );
      expect(root.textContent).toContain('1 rematch could not be avoided.');
      expect(createButton().disabled).toBe(false); // a rematch is a warning, not a block
    });

    it('pairs strongest against weakest by results and records the mode, seed and round', async () => {
      const standings = [
        { event_id: 'ev1', team_id: 't01', total_points: 50, wins: 1, played: 1 },
        { event_id: 'ev1', team_id: 't02', total_points: 40, wins: 1, played: 1 },
        { event_id: 'ev1', team_id: 't03', total_points: 30, wins: 0, played: 1 },
        { event_id: 'ev1', team_id: 't04', total_points: 20, wins: 0, played: 1 },
      ];
      const client = await mount(
        dbWith({ teams: fourTeams(), judges: SIX_JUDGES, matches: round1('confirmed'), standings }),
      );
      choose('draw-mode-by-results');
      expect(preview()).toEqual([
        ['Brunei · Team 1', 'Indonesia · Team 4'],
        ['Malaysia · Team 2', 'Singapore · Team 3'],
      ]);
      click(createButton());
      await flush();
      const [name, args] = client.rpcCalls[0];
      expect(name).toBe('create_btc_round');
      expect(args).toMatchObject({
        p_org_id: 'org1',
        p_event_id: 'ev1',
        p_prelim_round: 2,
        p_mode: 'by_results',
        p_avoid_rematches: true,
      });
      expect(typeof args.p_seed).toBe('string');
      expect(args.p_matches).toHaveLength(2);
    });

    it('says so when the results could not be read', async () => {
      const db = dbWith({ teams: fourTeams(), judges: SIX_JUDGES, matches: round1('confirmed') });
      const client = fakeClient(db);
      const real = client.from;
      client.from = (table) => {
        if (table === 'btc_standings') throw new Error('offline');
        return real(table);
      };
      screen = await mountMatchesScreen(root, { eventId: 'ev1', client });
      choose('draw-mode-by-results');
      expect(root.textContent).toContain('round 1 results could not be read');
      expect(createButton()).toBeNull();
    });
  });

  describe('judges from a team’s own country', () => {
    // two Brunei teams and three judges, one from Brunei: the one match cannot avoid j1
    const conflictDb = () =>
      dbWith({
        teams: [
          { id: 'a', event_id: 'ev1', name: 'Alpha', country_code: 'BN' },
          { id: 'b', event_id: 'ev1', name: 'Beta', country_code: 'SG' },
        ],
        judges: judgeRows([
          ['j1', 'BN'],
          ['j2', 'MY'],
          ['j3', null],
        ]),
      });

    it('turns the match card to danger, names the judge, and disables Create until ticked', async () => {
      await mount(conflictDb());
      const card = cards()[0];
      expect(card.getAttribute('data-state')).toBe('danger');
      expect(card.textContent).toContain('Judge j1 is from Brunei, the same country as Alpha.');
      expect(root.textContent).toContain("1 match has a judge from a team's own country");
      expect(createButton().disabled).toBe(true);

      const tick = q('[data-field="tick-0"]');
      tick.focus();
      tick.checked = true;
      tick.dispatchEvent(new Event('change', { bubbles: true }));
      expect(createButton().disabled).toBe(false);
      expect(cards()[0].getAttribute('data-state')).toBe('ok');
      expect(document.activeElement.getAttribute('data-field')).toBe('tick-0');

      // un-ticking blocks it again
      q('[data-field="tick-0"]').checked = false;
      q('[data-field="tick-0"]').dispatchEvent(new Event('change', { bubbles: true }));
      expect(createButton().disabled).toBe(true);
    });

    it('is cleared by changing the judge instead, and a changed judge drops an earlier tick', async () => {
      const db = conflictDb();
      db.btc_judges.push({ id: 'j4', event_id: 'ev1', name: 'Judge j4', country_code: null });
      await mount(db);
      // with a 4th judge the draw avoids the conflict, so make one by hand
      expect(cards()[0].getAttribute('data-state')).toBe('ok');
      expect(createButton().disabled).toBe(false);
      const slot = q('[data-field="judge-0-0"]');
      const original = slot.value;
      slot.value = 'j1';
      slot.dispatchEvent(new Event('change', { bubbles: true }));
      expect(cards()[0].getAttribute('data-state')).toBe('danger');
      expect(createButton().disabled).toBe(true);

      // accept it, then change another judge: the acceptance was for the arrangement the organiser looked at
      const tick = q('[data-field="tick-0"]');
      tick.checked = true;
      tick.dispatchEvent(new Event('change', { bubbles: true }));
      expect(createButton().disabled).toBe(false);
      const other = q('[data-field="judge-0-1"]');
      const otherWas = other.value;
      other.value = original; // the judge that j1 replaced is free again
      other.dispatchEvent(new Event('change', { bubbles: true }));
      expect(q('[data-field="tick-0"]').checked).toBe(false);
      expect(createButton().disabled).toBe(true);

      // changing the judge away from the conflict is the other way out
      const back = q('[data-field="judge-0-0"]');
      back.value = otherWas;
      back.dispatchEvent(new Event('change', { bubbles: true }));
      expect(cards()[0].getAttribute('data-state')).toBe('ok');
      expect(createButton().disabled).toBe(false);
    });

    it('blocks Create when a match repeats a judge', async () => {
      await mount(dbWith({ teams: teamRows(4), judges: SIX_JUDGES }));
      const first = q('[data-field="judge-0-0"]');
      const second = q('[data-field="judge-0-1"]');
      second.value = first.value;
      second.dispatchEvent(new Event('change', { bubbles: true }));
      expect(cards()[0].textContent).toContain('Choose three different judges.');
      expect(createButton().disabled).toBe(true);
    });

    it('creates the round with the conflict accepted, sending the three judges as shown', async () => {
      const client = await mount(conflictDb());
      const tick = q('[data-field="tick-0"]');
      tick.checked = true;
      tick.dispatchEvent(new Event('change', { bubbles: true }));
      click(createButton());
      await flush();
      expect(client.rpcCalls).toHaveLength(1);
      expect(client.rpcCalls[0][1].p_matches[0].judge_ids.sort()).toEqual(['j1', 'j2', 'j3']);
    });
  });

  describe('changing a pairing by hand', () => {
    it('marks the draw manual, drops the seed, and keeps focus on the pressed Swap', async () => {
      const client = await mount(dbWith({ teams: teamRows(4), judges: NEUTRAL_JUDGES }));
      useSeed('swap-me');
      const before = preview();
      const first = q('[data-focus-key="swap-0-1"]');
      first.focus();
      click(first);
      expect(q('[data-focus-key="swap-0-1"]').getAttribute('aria-pressed')).toBe('true');
      expect(root.textContent).toContain('Choose the team to swap with');
      const second = q('[data-focus-key="swap-1-2"]');
      second.focus();
      click(second);
      expect(document.activeElement.getAttribute('data-focus-key')).toBe('swap-1-2');
      const after = preview();
      expect(after[0][0]).toBe(before[1][1]);
      expect(after[1][1]).toBe(before[0][0]);
      expect(root.textContent).toContain('changed by hand');
      expect(q('.btc-draw-status').textContent).toContain('Swapped');

      click(createButton());
      await flush();
      const args = client.rpcCalls[0][1];
      expect(args.p_mode).toBe('manual');
      expect(args.p_seed).toBeNull();
    });

    it('cancels a swap when the same team is chosen twice', async () => {
      await mount(dbWith({ teams: teamRows(4), judges: SIX_JUDGES }));
      const before = preview();
      click(q('[data-focus-key="swap-0-1"]'));
      click(q('[data-focus-key="swap-0-1"]'));
      expect(preview()).toEqual(before);
      expect(q('.btc-draw-status').textContent).toBe('Swap cancelled.');
      expect(root.textContent).not.toContain('changed by hand');
    });

    it('recounts the warnings for the new pairs (a swap that makes a rematch says so)', async () => {
      const db = dbWith({
        teams: teamRows(4),
        judges: SIX_JUDGES,
        matches: [
          match('r1a', 1, 'confirmed', 't01', 't02'),
          match('r1b', 1, 'confirmed', 't03', 't04'),
        ],
      });
      await mount(db);
      expect(root.textContent).not.toContain('rematch');
      // move t02 next to t01 (and so t03 next to t04): both pairs are then repeats of round 1
      const spot = (name) => {
        for (let m = 0; m < 2; m += 1)
          for (const slot of [1, 2]) if (cardTeams(cards()[m])[slot - 1] === name) return [m, slot];
        return null;
      };
      const [m1, s1] = spot('Brunei · Team 1');
      const partner = cardTeams(cards()[m1])[s1 === 1 ? 1 : 0];
      const [m2, s2] = spot('Malaysia · Team 2');
      click(q(`[data-focus-key="swap-${m2}-${s2}"]`));
      click(q(`[data-focus-key="swap-${m1}-${s1 === 1 ? 2 : 1}"]`));
      expect(partner).not.toBe('Malaysia · Team 2');
      expect(root.textContent).toContain('2 rematches could not be avoided.');
    });
  });

  describe('creating the round', () => {
    it('calls create_btc_round once with the seed and shows the matches grouped by round', async () => {
      const client = await mount(dbWith({ teams: teamRows(20), judges: SIX_JUDGES }));
      useSeed('go-live');
      const expected = preview();
      createButton().focus();
      click(createButton());
      expect(createButton().textContent).toBe('Creating…');
      await flush();
      expect(client.rpcCalls.filter(([n]) => n === 'create_btc_round')).toHaveLength(1);
      const args = client.rpcCalls[0][1];
      expect(args).toMatchObject({ p_prelim_round: 1, p_mode: 'random', p_seed: 'go-live' });
      expect(args.p_matches).toHaveLength(10);
      expect(args.p_matches.map((m) => [m.team1_id, m.team2_id].length)).toEqual(Array(10).fill(2));
      expect(expected).toHaveLength(10);
      // the list now has the round, the panel has moved on to round 2 (not yet confirmed)
      expect(root.querySelector('.btc-round-group h3').textContent).toBe('Round 1');
      expect(root.querySelectorAll('.btc-round-group li')).toHaveLength(10);
      expect(root.textContent).toContain(
        'Round 2 can be drawn once every round 1 match is confirmed',
      );
      // focus goes to the confirmation, not to a button that no longer exists
      expect(document.activeElement.textContent).toBe('Round 1 created: 10 matches.');
      // the display refreshes only if the event is already live
      expect(publishBtcLive).toHaveBeenCalledTimes(1);
      expect(publishBtcLive.mock.calls[0][0].takeOver).toBe(false);
    });

    it('shows each database refusal in words, keyed on its hint, and keeps Create focusable', async () => {
      const cases = [
        ['btc_round_incomplete', 'Every team must play exactly once'],
        ['btc_round_matches_invalid', 'not valid: check the teams'],
        ['btc_round_bracket_exists', 'bracket has been generated'],
        ['btc_prior_round_open', 'earlier round has to be drawn and fully confirmed'],
        ['btc_round_exists', 'already been drawn'],
      ];
      for (const [hint, words] of cases) {
        root.innerHTML = '';
        await mount(dbWith({ teams: teamRows(4), judges: SIX_JUDGES }), {
          roundError: { code: 'P0001', message: 'RAWDBTEXT', hint },
        });
        createButton().focus();
        click(createButton());
        await flush();
        const alert = q('[role="alert"]');
        expect(alert.textContent).toContain(words);
        expect(alert.textContent).not.toContain('RAWDBTEXT');
        screen.unmount();
      }
    });

    it('describes an unrecognised failure with the generic message and associates it with Create', async () => {
      await mount(dbWith({ teams: teamRows(4), judges: SIX_JUDGES }), {
        roundError: { code: 'XX000', message: 'boom' },
      });
      click(createButton());
      await flush();
      const alert = q('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(createButton().getAttribute('aria-describedby')).toBe(alert.id);
      expect(alert.textContent).not.toContain('boom');
    });
  });

  describe('the hand-entry form beside it', () => {
    it('has a round choice and sends p_prelim_round', async () => {
      const client = await mount(dbWith({ teams: teamRows(4), judges: SIX_JUDGES }));
      const round = q('select[data-field="prelimRound"]');
      expect([...round.options].map((o) => o.textContent)).toEqual(['Round 1', 'Round 2']);
      round.value = '2';
      round.dispatchEvent(new Event('change', { bubbles: true }));
      q('select[data-field="team1Id"]').value = 't01';
      q('select[data-field="team1Id"]').dispatchEvent(new Event('change'));
      q('select[data-field="team2Id"]').value = 't02';
      q('select[data-field="team2Id"]').dispatchEvent(new Event('change'));
      for (const box of root.querySelectorAll('.btc-judge-checkbox-label input')) {
        box.checked = true;
        box.dispatchEvent(new Event('change'));
      }
      q('form.btc-match-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flush();
      const call = client.rpcCalls.find(([n]) => n === 'create_btc_match');
      expect(call[1].p_prelim_round).toBe(2);
    });

    it('groups the list by round and reads an unnumbered match as round 1', async () => {
      await mount(
        dbWith({
          teams: teamRows(4),
          judges: SIX_JUDGES,
          matches: [
            match('x2', 2, 'pending', 't01', 't03'),
            match('x1', null, 'confirmed', 't01', 't02'),
          ],
        }),
      );
      const groups = [...root.querySelectorAll('.btc-round-group')];
      expect(groups.map((g) => g.querySelector('h3').textContent)).toEqual(['Round 1', 'Round 2']);
      expect(groups[0].querySelectorAll('li')).toHaveLength(1);
      expect(groups[1].querySelectorAll('li')).toHaveLength(1);
    });
  });
});
