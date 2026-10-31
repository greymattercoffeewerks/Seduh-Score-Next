import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mountSeduhIdPanel,
  readCounts,
  COUNT_KEYS,
  READ_FAILED,
  EXPLANATION,
  NO_IDENTITIES,
} from './seduhIdPanel.js';
import { PANELS } from './panels.js';
import { ADMIN_ERROR_COPY, GENERIC_ERROR } from './adminErrors.js';
import { SLOW_MESSAGE } from './gate.js';
import { flush } from './consoleHarness.js';

const COUNTS = Object.freeze({
  identities_total: 17,
  identities_active: 15,
  identities_opted_out: 1,
  identities_merged: 1,
  identities_from_roster: 4,
  identities_from_archive: 13,
  identities_orphan: 2,
  people_total: 40,
  people_linked: 31,
  people_blocked: 3,
});
const ok = (data) => ({ data, error: null });
const refused = (hint, extra = {}) => ({ data: null, error: { hint, ...extra } });

let host;
let handle;
function mount(answer, { onGateRefused = vi.fn() } = {}) {
  const callAdmin = vi.fn(async (name, args) =>
    typeof answer === 'function' ? answer(args, name) : answer,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  handle = mountSeduhIdPanel(host, { callAdmin, onGateRefused });
  return { callAdmin, onGateRefused };
}
const text = () => host.textContent;
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);
const value = (label) =>
  [...host.querySelectorAll('.adm-fact')]
    .find((f) => f.querySelector('dt').textContent === label)
    ?.querySelector('dd').textContent;

afterEach(() => {
  handle?.unmount();
  host?.remove();
  handle = host = undefined;
});

describe('readCounts', () => {
  it('accepts exactly one row of ten whole non-negative numbers', () => {
    expect(readCounts([COUNTS])).toEqual(COUNTS);
    expect(readCounts([{ ...COUNTS, extra_name: 'Ana' }])).toEqual(COUNTS); // an extra key is never drawn
  });

  it.each([
    ['null', null],
    ['an object, not a list', COUNTS],
    ['an empty list', []],
    ['two rows', [COUNTS, COUNTS]],
    ['a string in a figure', [{ ...COUNTS, people_total: '40' }]],
    ['a negative figure', [{ ...COUNTS, people_total: -1 }]],
    ['a fraction', [{ ...COUNTS, people_total: 1.5 }]],
    ['a null figure', [{ ...COUNTS, identities_orphan: null }]],
    ['a missing figure', [Object.fromEntries(Object.entries(COUNTS).slice(1))]],
  ])('refuses %s', (_, data) => {
    expect(readCounts(data)).toBeNull();
  });

  it('knows exactly the ten documented figures', () => {
    expect(COUNT_KEYS.slice().sort()).toEqual(Object.keys(COUNTS).sort());
  });
});

describe('the Seduh ID panel', () => {
  it('is registered as a console panel', () => {
    const entry = PANELS.find((p) => p.id === 'seduh-id');
    expect(entry).toMatchObject({ label: 'Seduh ID', route: 'seduh-id', mount: mountSeduhIdPanel });
  });

  it('asks the one counts function, with no argument, and draws the numbers in words', async () => {
    const { callAdmin } = mount(ok([COUNTS]));
    expect(text()).toContain('Loading…');
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(1);
    expect(callAdmin).toHaveBeenCalledWith('admin_seduh_id_counts', {});
    expect(host.querySelector('h1').textContent).toBe('Seduh ID');
    expect(text()).toContain(EXPLANATION);
    expect(value('Identities in total')).toBe('17');
    expect(value('Active')).toBe('15');
    expect(value('Opted out (name removed)')).toBe('1');
    expect(value('Merged into another identity')).toBe('1');
    expect(value('From organiser rosters')).toBe('4');
    expect(value('From published results (archive)')).toBe('13');
    expect(value('Identities with no linked person')).toBe('2');
    expect(value('People in all organisations')).toBe('40');
    expect(value('Linked to an identity')).toBe('31');
    expect(value('Not linked')).toBe('9');
    expect(value('Blocked from linking by the owner')).toBe('3');
    expect(text()).not.toContain('Loading…');
  });

  it('says in one line that it is numbers only and that merges and unlinks are SQL', () => {
    expect(EXPLANATION).toMatch(/numbers only/i);
    expect(EXPLANATION).toMatch(/merges and unlinks/i);
    expect(EXPLANATION).toMatch(/SQL/);
  });

  it('draws nothing but figures: no control other than Refresh, no input, no link', async () => {
    mount(ok([COUNTS]));
    await flush();
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Refresh numbers',
    ]);
    expect(host.querySelectorAll('input, a, textarea, select')).toHaveLength(0);
  });

  it('an empty directory says so instead of a wall of zeros, and still shows the people figures', async () => {
    mount(
      ok([
        {
          ...COUNTS,
          identities_total: 0,
          identities_active: 0,
          identities_opted_out: 0,
          identities_merged: 0,
          identities_from_roster: 0,
          identities_from_archive: 0,
          identities_orphan: 0,
          people_linked: 0,
          people_blocked: 0,
        },
      ]),
    );
    await flush();
    expect(text()).toContain(NO_IDENTITIES);
    expect(value('Identities in total')).toBeUndefined();
    expect(value('People in all organisations')).toBe('40');
    expect(value('Not linked')).toBe('40');
  });

  it('never draws a figure that is not one of the ten, even if the function started returning one', async () => {
    mount(ok([{ ...COUNTS, display_name: 'Ana Secret', phone: '+6737000000', org_id: 'x' }]));
    await flush();
    expect(text()).not.toMatch(/Ana Secret|\+6737000000/);
  });

  it('a malformed answer draws none of the figures, never half, and offers Retry', async () => {
    mount(ok([{ ...COUNTS, people_total: 'many' }]));
    await flush();
    expect(host.querySelector('[role="status"][data-tone="error"]').textContent).toBe(READ_FAILED);
    expect(host.querySelectorAll('dl')).toHaveLength(0);
    expect(button('Retry')).toBeTruthy();
    expect(document.activeElement).toBe(button('Retry'));
  });

  it('translates a refusal by its hint, never by its text, and Retry loads again', async () => {
    let calls = 0;
    mount(() => {
      calls += 1;
      return calls === 1
        ? refused('org_not_found', { message: 'RAW DATABASE TEXT', details: 'secret' })
        : ok([COUNTS]);
    });
    await flush();
    const message = host.querySelector('[data-tone="error"]').textContent;
    expect(message).toBe(ADMIN_ERROR_COPY.org_not_found);
    expect(text()).not.toMatch(/RAW DATABASE TEXT|secret/);
    button('Retry').click();
    await flush();
    expect(value('Identities in total')).toBe('17');
    expect(host.querySelector('[data-tone="error"]')).toBeNull();
    expect(button('Retry')).toBeUndefined();
  });

  it('an unknown or missing hint is the generic sentence, and a timeout is the slow sentence', async () => {
    mount(refused('something_new', { message: 'boom' }));
    await flush();
    expect(host.querySelector('[data-tone="error"]').textContent).toBe(GENERIC_ERROR);
    handle.unmount();
    host.remove();
    mount(refused(undefined, { timedOut: true }));
    await flush();
    expect(host.querySelector('[data-tone="error"]').textContent).toBe(SLOW_MESSAGE);
  });

  it('a call that throws is an error line, not a crash', async () => {
    mount(() => {
      throw new Error('network down: secret');
    });
    await flush();
    expect(host.querySelector('[data-tone="error"]').textContent).toBe(GENERIC_ERROR);
    expect(text()).not.toContain('secret');
  });

  it('a gate refusal draws nothing of its own (the console re-checks access and replaces the panel)', async () => {
    mount(refused('admin_mfa_required'));
    await flush();
    expect(host.children).toHaveLength(0);
  });

  it('Refresh asks again, shows the new figures and keeps focus on itself', async () => {
    let calls = 0;
    const { callAdmin } = mount(() => {
      calls += 1;
      return ok([{ ...COUNTS, identities_total: calls === 1 ? 17 : 18 }]);
    });
    await flush();
    expect(value('Identities in total')).toBe('17');
    button('Refresh numbers').click();
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(2);
    expect(value('Identities in total')).toBe('18');
    expect(document.activeElement).toBe(button('Refresh numbers'));
  });

  it('a failed refresh keeps no stale claim: the error shows with a Retry', async () => {
    let calls = 0;
    mount(() => {
      calls += 1;
      return calls === 1 ? ok([COUNTS]) : refused('boom');
    });
    await flush();
    button('Refresh numbers').click();
    await flush();
    expect(host.querySelector('[data-tone="error"]')).not.toBeNull();
    expect(button('Retry')).toBeTruthy();
  });

  it('a second press while loading does not send a second request', async () => {
    let release;
    const { callAdmin } = mount(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok([COUNTS]));
        }),
    );
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(1);
    release();
    await flush();
    const refresh = button('Refresh numbers');
    refresh.click();
    refresh.click();
    await flush();
    expect(callAdmin).toHaveBeenCalledTimes(2);
    release();
  });

  it('an answer that arrives after the panel was closed draws nothing', async () => {
    let release;
    mount(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok([COUNTS]));
        }),
    );
    handle.unmount();
    release();
    await flush();
    expect(host.children).toHaveLength(0);
  });

  it('draws text only: a hostile-looking number is still just a number, markup never becomes elements', async () => {
    mount(ok([COUNTS]));
    await flush();
    expect(host.querySelectorAll('script, img, svg')).toHaveLength(0);
    expect(host.innerHTML).not.toContain('&lt;');
  });
});
