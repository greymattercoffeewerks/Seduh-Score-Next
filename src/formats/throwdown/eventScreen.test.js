// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { _clearAllForTests } from '../../core/db.js';
import { _resetOutboxOwnerForTests } from '../../core/outbox.js';
import { mountThrowdownEventScreen } from './eventScreen.js';

const EVENT = { id: 'ev', org_id: 'org', format: 'throwdown', name: 'Rehearsal', is_test: true };

// A tiny read-only client: tables answer with the rows given, the events table answers the event.
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

const entries = ['Ana', 'Bima'].map((n) => ({ id: `e${n}`, display_name: n, withdrawn: false }));
const started = {
  td_rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
  td_matches: [
    {
      id: 'm1',
      round_id: 'r1',
      position: 1,
      result_kind: null,
      confirmed_at: null,
      walkover_winner_position: null,
    },
  ],
  td_slots: [
    { id: 's1', match_id: 'm1', position: 1, entry_id: 'eAna' },
    { id: 's2', match_id: 'm1', position: 2, entry_id: 'eBima' },
  ],
  event_entries: entries,
};

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

describe('the Throwdown organiser screen', () => {
  it('says TEST on a test event, from the first screen', async () => {
    const root = await mount({ event_entries: entries });
    expect(root.querySelector('.is-test-banner').textContent).toContain('Test Data');
  });

  it('shows no TEST banner on a real event', async () => {
    const root = await mount({ event_entries: entries }, { ...EVENT, is_test: false });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('closes voting on a match whose result is waiting to sync', async () => {
    const { enqueueOperation } = await import('../../core/outbox.js');
    await enqueueOperation('td_confirm_match', {
      p_operation_id: 'x',
      p_org_id: 'org',
      p_match_id: 'm1',
    });
    const root = await mount(started);
    expect(root.textContent).toContain('waiting to sync');
    expect(
      [...root.querySelectorAll('.td-vote')].every(
        (b) => b.getAttribute('aria-disabled') === 'true',
      ),
    ).toBe(true);
  });

  it('before the draw offers competitors, setup and the draw, and no module controls', async () => {
    const root = await mount({ event_entries: entries });
    const headings = [...root.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Competitors (2)', 'Setup', 'Draw']);
    expect(root.textContent).toContain('Setup is locked as soon as Round 1 starts.');
    expect(root.textContent).not.toMatch(/module/i);
  });

  it('after the draw shows the match with Confirm disabled while the votes are level, and no setup', async () => {
    const root = await mount(started);
    const confirm = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm result',
    );
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(root.textContent).toContain('Waiting for votes');
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Setup');
    expect(root.querySelectorAll('.td-vote')).toHaveLength(2);
  });

  it('shows the champion banner once the Final is decided', async () => {
    const root = await mount({
      ...started,
      td_matches: [
        {
          ...started.td_matches[0],
          result_kind: 'walkover',
          confirmed_at: 't',
          walkover_winner_position: 2,
        },
      ],
    });
    expect(root.querySelector('.td-champion-name').textContent).toBe('Bima');
    expect(root.textContent).toContain('Runner-up: Ana');
    expect(root.querySelectorAll('article.td-match')).toHaveLength(0);
  });
});

describe('scoresheet rounds on the organiser screen', () => {
  const lines = [
    { key: 'a', label: 'Line A', max: 6 },
    { key: 'b', label: 'Line B', max: 3 },
  ];
  const scoring = (extra = {}) => ({
    ...started,
    td_settings: [
      {
        judge_count: 3,
        third_place: true,
        seeding_mode: 'random',
        modules: { scoresheet: { preset: 'latte_art_v1', lines, cups: { final: 2 } } },
      },
    ],
    ...extra,
  });
  const byText = (root, text) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

  it('offers a Scoresheet toggle in setup, with the cups controls only when it is on', async () => {
    const root = await mount({ event_entries: entries });
    const toggle = root.querySelector('[data-focus-key="td-sheet-on"]');
    expect(toggle.checked).toBe(false);
    expect(root.querySelector('[data-focus-key="td-cups-final"]')).toBeNull();
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(root.querySelector('[data-focus-key="td-cups-final"]').value).toBe('2');
    expect(root.querySelector('[data-focus-key="td-cups-third_place"]').value).toBe('1');
    expect(root.querySelector('[data-focus-key="td-cups-semi_final"]').value).toBe('0');
  });

  it('draws no tap buttons on a scored match, and shows "Sheets in: 0 of 6"', async () => {
    const root = await mount(scoring());
    expect(root.querySelectorAll('.td-vote')).toHaveLength(0);
    expect(root.textContent).toContain('Sheets in: 0 of 6');
    expect(root.querySelectorAll('.td-grid-btn')).toHaveLength(6);
    expect(byText(root, 'Confirm result').getAttribute('aria-disabled')).toBe('true');
  });

  it('an event without the module draws no scoresheet control or text on a live match', async () => {
    const root = await mount(started);
    expect(root.textContent).not.toMatch(/sheet|cup/i);
    expect(root.querySelectorAll('.td-vote')).toHaveLength(2);
  });

  it('opens a paper sheet: numeric inputs, a live cup total, and Save only when complete', async () => {
    const root = await mount(scoring());
    root.querySelector('.td-grid-btn').click();
    const inputs = [...root.querySelectorAll('.td-points')];
    expect(inputs).toHaveLength(4);
    expect(inputs.every((i) => i.getAttribute('inputmode') === 'numeric')).toBe(true);
    const save = byText(root, 'Save sheet');
    // an empty sheet: Save says what is missing instead of doing nothing
    save.click();
    expect(root.querySelector('.td-sheet-error').textContent).toContain('4 lines are blank');
    const type = (i, v) => {
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    [4, 3, 5, 2].forEach((v, i) => type(inputs[i], String(v)));
    expect(root.textContent).toContain('Cup 1 total: 7 of 9');
    expect(root.textContent).toContain('Cup 2 total: 7 of 9');
    expect(root.querySelector('.td-sheet-error').textContent).toBe('');
    type(inputs[0], '7');
    expect(inputs[0].getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses to save an out-of-range line, and queues a complete sheet through the outbox', async () => {
    const { listAllOperations } = await import('../../core/outbox.js');
    const root = await mount(scoring());
    root.querySelector('.td-grid-btn').click();
    const inputs = [...root.querySelectorAll('.td-points')];
    const type = (i, v) => {
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    [7, 3, 5, 2].forEach((v, i) => type(inputs[i], String(v)));
    byText(root, 'Save sheet').click();
    expect(await listAllOperations()).toHaveLength(0);
    expect(root.querySelector('.td-sheet-error').textContent).toContain(
      '1 line is blank or out of range',
    );
    const again = [...root.querySelectorAll('.td-points')];
    [6, 3, 5, 2].forEach((v, i) => type(again[i], String(v)));
    byText(root, 'Save sheet').click();
    await new Promise((r) => setTimeout(r, 20));
    const ops = await listAllOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('td_save_score_sheet');
    expect(ops[0].payload).toMatchObject({
      p_match_id: 'm1',
      p_slot_id: 's1',
      p_judge_seat: 1,
      p_sheet: { 1: { a: 6, b: 3 }, 2: { a: 5, b: 2 } },
    });
    expect(typeof ops[0].payload.p_operation_id).toBe('string');
  });

  it('shows a decided scored match with its breakdown on the console', async () => {
    const sheets = [1, 2, 3].flatMap((seat) =>
      ['s1', 's2'].flatMap((slot) =>
        [1, 2].flatMap((cup) =>
          lines.map((l) => ({
            id: `${slot}${seat}${cup}${l.key}`,
            match_id: 'm1',
            slot_id: slot,
            judge_seat: seat,
            cup,
            line_key: l.key,
            points: slot === 's1' ? 2 : 3,
          })),
        ),
      ),
    );
    const root = await mount(
      scoring({
        td_matches: [{ ...started.td_matches[0], result_kind: 'scores', confirmed_at: 't' }],
        td_score_sheets: sheets,
        td_match_results: [{ match_id: 'm1', winner_slot_id: 's2' }],
      }),
    );
    // the database's winner is shown, not a re-tally: here it is the competitor with the LOWER total
    expect(root.querySelector('.td-champion-name').textContent).toBe('Bima');
    expect(root.textContent).toContain('Score breakdown');
    expect(root.textContent).toContain('Bima won on');
  });
});
