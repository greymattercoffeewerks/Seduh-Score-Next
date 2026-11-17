import { describe, it, expect } from 'vitest';
import { FORMAT_OPTIONS, describeEventForHome } from './organiserHome.js';

const base = {
  entries: 0,
  entries_active: 0,
  stages: 0,
  stages_complete: 0,
  heats: 0,
  heats_confirmed: 0,
  heats_active: 0,
  teams: 0,
  judges: 0,
  matches: 0,
  matches_confirmed: 0,
  matches_active: 0,
  td_matches: 0,
  td_confirmed: 0,
};
const facts = (extra) => ({ ...base, ...extra });
const event = (format, extra = {}) => ({ id: 'e1', format, name: 'E', ended_at: null, ...extra });

describe('FORMAT_OPTIONS', () => {
  it('has the three formats an organiser can create, each with a label, a kind and a one-line description', () => {
    expect(FORMAT_OPTIONS.map((f) => f.value)).toEqual(['cup_taster', 'btc', 'throwdown']);
    for (const option of FORMAT_OPTIONS) {
      expect(option.label).toBeTruthy();
      expect(option.kind).toBeTruthy();
      expect(option.description).toBeTruthy();
      expect(option.description).not.toContain('\n');
    }
  });
});

describe('describeEventForHome', () => {
  it('says nothing without facts (the summary read failed) or for a format it has no words for', () => {
    expect(describeEventForHome(event('cup_taster'), null)).toBeNull();
    expect(describeEventForHome(event('guess_the_bean'), facts({}))).toBeNull();
    // a format name is not a property lookup
    expect(describeEventForHome(event('toString'), facts({}))).toBeNull();
    expect(describeEventForHome(event('constructor'), facts({}))).toBeNull();
  });

  describe('Cup Taster', () => {
    it('counts cuppers and heats, and is ready once both exist', () => {
      const info = describeEventForHome(
        event('cup_taster'),
        facts({ entries_active: 16, heats: 4, stages: 3, stages_complete: 1 }),
      );
      expect(info.summary).toBe('16 cuppers · 4 heats drawn');
      expect(info.ready).toBe(true);
      expect(info.phase).toBe('Stage 2 of 3');
      expect(info.next).toBe('next: run the next heat');
    });

    it('is in setup and warns when nobody is registered, and says so in the next step', () => {
      const info = describeEventForHome(event('cup_taster'), facts({}));
      expect(info.ready).toBe(false);
      expect(info.next).toBe('next: register the cuppers');
      expect(info.attention.map((a) => a.id)).toEqual(['no-cuppers']);
      expect(
        describeEventForHome(event('cup_taster', { ended_at: 'x' }), facts({})).attention,
      ).toEqual([]);
    });

    it('reports heat progress in words, with the heat in progress', () => {
      const info = describeEventForHome(
        event('cup_taster'),
        facts({ entries_active: 8, heats: 6, heats_confirmed: 2, heats_active: 1 }),
      );
      expect(info.progress).toEqual({
        done: 2,
        total: 6,
        active: 1,
        text: '2 of 6 heats confirmed · 1 in progress',
      });
      expect(info.next).toBe('next: finish the heat in progress');
    });

    it('singular wording for one cupper and one heat', () => {
      expect(
        describeEventForHome(event('cup_taster'), facts({ entries_active: 1, heats: 1 })).summary,
      ).toBe('1 cupper · 1 heat drawn');
    });
  });

  describe('BTC', () => {
    it('counts teams and matches done, and is ready with an even field and at least three judges', () => {
      const info = describeEventForHome(
        event('btc'),
        facts({ teams: 8, judges: 3, matches: 10, matches_confirmed: 6, matches_active: 2 }),
      );
      expect(info.summary).toBe('8 teams · 6 of 10 matches done');
      expect(info.ready).toBe(true);
      expect(info.progress.text).toBe('6 of 10 matches confirmed · 2 scoring');
      expect(info.next).toBe('next: finish the match being scored');
    });

    it('warns about no judges once there are teams, and walks the setup in order', () => {
      expect(
        describeEventForHome(event('btc'), facts({ teams: 4 })).attention.map((a) => a.id),
      ).toEqual(['no-judges']);
      expect(describeEventForHome(event('btc'), facts({})).attention).toEqual([]);
      expect(describeEventForHome(event('btc'), facts({ teams: 1 })).next).toBe(
        'next: add the teams',
      );
      expect(describeEventForHome(event('btc'), facts({ teams: 4, judges: 3 })).next).toBe(
        'next: draw the matches',
      );
      expect(describeEventForHome(event('btc'), facts({ teams: 4, judges: 3 })).summary).toBe(
        '4 teams · no matches yet',
      );
    });

    it('has no progress and no next step once every match is confirmed or when there are no matches', () => {
      const done = describeEventForHome(
        event('btc'),
        facts({ teams: 2, judges: 3, matches: 1, matches_confirmed: 1 }),
      );
      expect(done.next).toBeNull();
      expect(done.progress.done).toBe(1);
      expect(
        describeEventForHome(event('btc'), facts({ teams: 2, judges: 3 })).progress,
      ).toBeNull();
    });
  });

  it('Cup Taster is not ready with cuppers but no heats, or heats but no cuppers', () => {
    expect(
      describeEventForHome(event('cup_taster'), facts({ entries_active: 16, heats: 0 })).ready,
    ).toBe(false);
    expect(
      describeEventForHome(event('cup_taster'), facts({ entries_active: 0, heats: 4 })).ready,
    ).toBe(false);
  });

  it('BTC is not ready with fewer than three judges or an odd field, the same rule as its run sheet, and says so', () => {
    expect(describeEventForHome(event('btc'), facts({ teams: 2, judges: 1 })).ready).toBe(false);
    expect(
      describeEventForHome(event('btc'), facts({ teams: 2, judges: 1 })).attention[0].text,
    ).toBe('needs at least 3 judges.');
    expect(describeEventForHome(event('btc'), facts({ teams: 3, judges: 3 })).ready).toBe(false);
    expect(describeEventForHome(event('btc'), facts({ teams: 4, judges: 3 })).ready).toBe(true);
  });

  describe('Throwdown', () => {
    it('needs two competitors and a bracket to be ready', () => {
      expect(describeEventForHome(event('throwdown'), facts({ entries_active: 8 })).ready).toBe(
        false,
      );
      const info = describeEventForHome(
        event('throwdown'),
        facts({ entries_active: 8, td_matches: 7, td_confirmed: 3 }),
      );
      expect(info.ready).toBe(true);
      expect(info.summary).toBe('8 competitors · 3 of 7 matches done');
      expect(info.progress.total).toBe(7);
      expect(info.next).toBe('next: score the next match');
    });

    it('warns with fewer than two competitors', () => {
      expect(
        describeEventForHome(event('throwdown'), facts({ entries_active: 1 })).attention[0].id,
      ).toBe('few-competitors');
    });
  });

  it('never throws on a facts object with missing or odd values', () => {
    for (const format of ['cup_taster', 'btc', 'throwdown']) {
      expect(() => describeEventForHome(event(format), {})).not.toThrow();
      expect(() =>
        describeEventForHome(event(format), { teams: 'x', heats: null, matches: NaN }),
      ).not.toThrow();
    }
  });
});
