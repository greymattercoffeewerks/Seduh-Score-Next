import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createMomentPlayer } from './momentPlayer.js';
import { createScreenDirector } from './screenDirector.js';

afterEach(() => {
  vi.useRealTimers();
});

// Screens that log what the director does with them, driven by the real director on fake timers.
function setUp({ detect, maxQueued } = {}) {
  vi.useFakeTimers();
  const log = [];
  const host = document.createElement('div');
  const screen = (key, extra = {}) => ({
    key,
    mount(_host, payload) {
      log.push(`mount:${key}:${payload.label}`);
      _host.textContent = `${key}:${payload.label}`;
      return {
        update: (next) => {
          _host.textContent = `${key}:${next.label}`;
        },
        destroy: () => log.push(`destroy:${key}`),
      };
    },
    ...extra,
  });
  const screens = {
    idle: screen('idle'),
    scoring: screen('scoring', { minDwellMs: 8_000 }),
    heat: screen('heat', { urgent: true }),
    champion: screen('champion', { minDwellMs: 60_000 }),
  };
  const selectScreen = (payload) => screens[payload.screen] ?? null;
  const director = createScreenDirector({ host });
  const player = createMomentPlayer({
    director,
    selectScreen,
    detectMoments: detect ?? (() => []),
    maxQueued,
  });
  const moment = (key, label, holdMs = 5_000) => ({
    screen: screen(key, { minDwellMs: holdMs }),
    payload: { label },
  });
  return { player, director, host, log, moment, screen };
}
const snap = (screen = 'idle', label = 'x') => ({ screen, label });
const shown = (host) => host.textContent;

describe('createMomentPlayer', () => {
  it('shows the ordinary screen for a snapshot when nothing has happened', () => {
    const { player, host } = setUp();
    player.update(snap('idle', 'one'));
    expect(shown(host)).toBe('idle:one');
    player.destroy();
  });

  it('the FIRST snapshot only sets the baseline: no moment, even if the detector would have found one', () => {
    const detect = vi.fn(() => []);
    const { player } = setUp({ detect });
    player.update(snap());
    expect(detect).not.toHaveBeenCalled();
    player.update(snap());
    expect(detect).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it('hands the detector the snapshot before and the snapshot after', () => {
    const detect = vi.fn(() => []);
    const { player } = setUp({ detect });
    const first = snap('idle', 'a');
    const second = snap('idle', 'b');
    player.update(first);
    player.update(second);
    expect(detect).toHaveBeenCalledWith(first, second);
    player.destroy();
  });

  it('plays a moment at once, for its own hold, then returns to what the latest snapshot wants', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap('idle', 'before'));
    found = [moment('result', 'R1', 6_000)];
    player.update(snap('idle', 'after'));
    expect(shown(host)).toBe('result:R1');
    vi.advanceTimersByTime(5_999);
    expect(shown(host)).toContain('result');
    vi.advanceTimersByTime(1);
    expect(shown(host)).toBe('idle:after');
    player.destroy();
  });

  it('plays several moments one after another, in order, each for its own hold', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 6_000), moment('rank', 'K1', 8_000)];
    player.update(snap('idle', 'after'));
    expect(shown(host)).toContain('R1');
    vi.advanceTimersByTime(6_000);
    expect(shown(host)).toContain('K1');
    vi.advanceTimersByTime(7_999);
    expect(shown(host)).toContain('K1');
    vi.advanceTimersByTime(1);
    expect(shown(host)).toBe('idle:after');
    player.destroy();
  });

  it('the same kind of moment twice is mounted fresh each time, never updated in place', () => {
    let found = [];
    const { player, log, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 1_000), moment('result', 'R2', 1_000)];
    player.update(snap());
    vi.advanceTimersByTime(2_000);
    expect(log.filter((l) => l.startsWith('mount:result'))).toHaveLength(2);
    expect(log).toContain('destroy:result');
    player.destroy();
  });

  it('pre-empts a screen that is being held: the news does not wait for "being scored" to finish', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap('scoring', 'timeup'));
    found = [moment('result', 'R1', 6_000)];
    player.update(snap('idle', 'confirmed')); // scoring has only been up for 0s of its 8s
    expect(shown(host)).toContain('R1');
    player.destroy();
  });

  it('an urgent screen (a running heat) cuts a moment short and drops the rest of the queue', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 6_000), moment('rank', 'K1', 8_000)];
    player.update(snap('idle', 'after'));
    vi.advanceTimersByTime(1_000);
    found = [];
    player.update(snap('heat', 'running'));
    expect(shown(host)).toBe('heat:running');
    // the cut-short moment's timer is gone, and so is the queue behind it: nothing comes back later
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(shown(host)).toBe('heat:running');
    vi.advanceTimersByTime(60_000);
    expect(shown(host)).toBe('heat:running');
    // and when the heat ends, the room sees the new state, not a stale moment from before it
    player.update(snap('scoring', 'timeup'));
    expect(shown(host)).toBe('scoring:timeup');
    player.destroy();
  });

  it('no moment is detected for an urgent snapshot: the running heat is what the room needs', () => {
    const detect = vi.fn(() => []);
    const { player } = setUp({ detect });
    player.update(snap());
    player.update(snap('heat', 'running'));
    expect(detect).not.toHaveBeenCalled();
    player.destroy();
  });

  it('keeps the newest snapshot while a moment plays, and shows it afterwards', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 6_000)];
    player.update(snap('idle', 'first'));
    found = [];
    player.update(snap('idle', 'second'));
    player.update(snap('idle', 'third'));
    expect(shown(host)).toContain('R1');
    vi.advanceTimersByTime(6_000);
    expect(shown(host)).toBe('idle:third');
    player.destroy();
  });

  it('moments found while another plays join the queue behind it', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 6_000)];
    player.update(snap());
    found = [moment('result', 'R2', 6_000)];
    player.update(snap());
    expect(shown(host)).toContain('R1');
    vi.advanceTimersByTime(6_000);
    expect(shown(host)).toContain('R2');
    player.destroy();
  });

  it('when moments pile up, only the newest few wait: the display never runs far behind the room', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found, maxQueued: 2 });
    player.update(snap());
    found = [
      moment('m', 'one', 1_000),
      moment('m', 'two', 1_000),
      moment('m', 'three', 1_000),
      moment('m', 'four', 1_000),
    ];
    player.update(snap('idle', 'after'));
    // 'one' and 'two' were dropped from the queue before anything played: the newest two remain
    expect(shown(host)).toContain('three');
    vi.advanceTimersByTime(1_000);
    expect(shown(host)).toContain('four');
    vi.advanceTimersByTime(1_000);
    expect(shown(host)).toBe('idle:after');
    player.destroy();
  });

  it('after the moments, a screen with its own hold is shown as normal (the champion stays up)', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 2_000)];
    player.update(snap('champion', 'Wilky'));
    vi.advanceTimersByTime(2_000);
    expect(shown(host)).toBe('champion:Wilky');
    player.destroy();
  });

  it('copes with a detector that returns nothing at all', () => {
    const { player, host } = setUp({ detect: () => undefined });
    player.update(snap('idle', 'a'));
    player.update(snap('idle', 'b'));
    expect(shown(host)).toBe('idle:b');
    player.destroy();
  });

  it('destroy() ends the moment timer and ignores later updates', () => {
    let found = [];
    const { player, moment, host } = setUp({ detect: () => found });
    player.update(snap());
    found = [moment('result', 'R1', 6_000)];
    player.update(snap());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    player.destroy();
    expect(vi.getTimerCount()).toBe(0);
    const before = shown(host);
    // a later snapshot with a DIFFERENT moment in it: a player that kept listening would show it
    found = [moment('result', 'LATE', 6_000)];
    player.update(snap('idle', 'late'));
    expect(shown(host)).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a moment timer that still fires after destroy() changes nothing', () => {
    vi.useFakeTimers();
    const fire = [];
    const host = document.createElement('div');
    const director = createScreenDirector({ host });
    const screen = (key, extra = {}) => ({
      key,
      ...extra,
      mount(h, payload) {
        h.textContent = `${key}:${payload.label}`;
        return { destroy() {} };
      },
    });
    const player = createMomentPlayer({
      director,
      selectScreen: () => screen('idle'),
      detectMoments: () => [
        { screen: screen('m', { minDwellMs: 1_000 }), payload: { label: 'M' } },
        { screen: screen('m2', { minDwellMs: 1_000 }), payload: { label: 'M2' } },
      ],
      setTimer: (fn) => {
        fire.push(fn);
        return fire.length;
      },
      clearTimer: () => {},
    });
    player.update({ label: 'a' });
    player.update({ label: 'b' });
    expect(host.textContent).toBe('m:M');
    player.destroy();
    fire[0](); // the stale timer fires anyway
    expect(host.textContent).toBe('m:M'); // it did not go on to the queued moment or the ordinary screen
  });
});

describe('createMomentPlayer: baselines, limits and failures', () => {
  it('an urgent snapshot is the baseline for the next one (and a first urgent snapshot sets it too)', () => {
    const detect = vi.fn(() => []);
    const { player } = setUp({ detect });
    const first = snap('heat', 'running');
    const second = snap('idle', 'after');
    player.update(first); // urgent AND first: no detection, but it is the baseline
    player.update(second);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith(first, second);
    player.destroy();
  });

  it('with no maxQueued given, only the newest four moments wait', () => {
    let found = [];
    const { player, host, moment } = setUp({ detect: () => found });
    player.update(snap());
    found = ['a', 'b', 'c', 'd', 'e'].map((label) => moment('m', label, 1_000));
    player.update(snap('idle', 'after'));
    // five found, four kept: the oldest ('a') never plays
    expect(shown(host)).toBe('m:b');
    player.destroy();
  });

  it('a snapshot no screen wants is not an error (the display shows nothing for it)', () => {
    const { player } = setUp();
    player.update(snap());
    expect(() => player.update(snap('nothing-wants-this', 'x'))).not.toThrow();
    player.destroy();
  });

  describe('when something throws', () => {
    let errors;
    beforeEach(() => {
      errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      errors.mockRestore();
    });

    it('a moment that cannot be drawn is skipped: the next moment plays, and the display is not left blank', () => {
      let found = [];
      const { player, host, moment, screen } = setUp({ detect: () => found });
      player.update(snap());
      const broken = {
        screen: screen('broken', {
          minDwellMs: 1_000,
          mount() {
            throw new Error('bad data');
          },
        }),
        payload: { label: 'x' },
      };
      found = [broken, moment('result', 'R2', 2_000)];
      player.update(snap('idle', 'after'));
      expect(shown(host)).toBe('result:R2');
      expect(errors).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000);
      expect(shown(host)).toBe('idle:after');
      player.destroy();
    });

    it('when the only moment cannot be drawn, the ordinary screen is shown at once and later updates still work', () => {
      let found = [];
      const { player, host, screen } = setUp({ detect: () => found });
      player.update(snap());
      found = [
        {
          screen: screen('broken', {
            minDwellMs: 1_000,
            mount() {
              throw new Error('bad data');
            },
          }),
          payload: { label: 'x' },
        },
      ];
      player.update(snap('idle', 'after'));
      expect(shown(host)).toBe('idle:after');
      found = [];
      player.update(snap('idle', 'later'));
      expect(shown(host)).toBe('idle:later');
      player.destroy();
    });

    it('a detector that throws on a snapshot costs its moments only: the ordinary screen is still shown', () => {
      const { player, host } = setUp({
        detect: () => {
          throw new Error('odd payload');
        },
      });
      player.update(snap('idle', 'a'));
      player.update(snap('idle', 'b'));
      expect(shown(host)).toBe('idle:b');
      expect(errors).toHaveBeenCalledTimes(1);
      player.update(snap('idle', 'c'));
      expect(shown(host)).toBe('idle:c');
      player.destroy();
    });
  });
});
