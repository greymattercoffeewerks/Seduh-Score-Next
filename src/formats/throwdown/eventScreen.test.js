// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { _clearAllForTests } from '../../core/db.js';
import { _resetOutboxOwnerForTests } from '../../core/outbox.js';
import { mountThrowdownEventScreen } from './eventScreen.js';
import { parsePhone, phoneErrorMessage } from '../../core/phone.js';

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

  it('stops the Vote buttons once every judge has voted, and leaves Undo working', async () => {
    const vote = (id, slot) => ({ id, match_id: 'm1', slot_id: slot, created_at: id });
    const twoJudges = {
      ...started,
      td_settings: [{ event_id: 'ev', judge_count: 2, third_place: true, modules: {} }],
    };
    const votes = (off) => (b) => (b.getAttribute('aria-disabled') === 'true') === off;
    let root = await mount({ ...twoJudges, td_votes: [vote('v1', 's1')] });
    expect([...root.querySelectorAll('.td-vote')].every(votes(false))).toBe(true);
    expect(root.textContent).toContain('1 of 2 votes in.');

    document.body.innerHTML = '';
    root = await mount({ ...twoJudges, td_votes: [vote('v1', 's1'), vote('v2', 's2')] });
    expect([...root.querySelectorAll('.td-vote')].every(votes(true))).toBe(true);
    expect(root.textContent).toContain('every judge has voted. Undo a vote');
    const undos = [...root.querySelectorAll('button')].filter((b) => b.textContent === 'Undo');
    expect(undos.every((b) => b.getAttribute('aria-disabled') !== 'true')).toBe(true);
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

// A client that records writes: people and event_entries filter by their eq() calls, inserts are kept and answered,
// and rpc calls are logged. Enough for core/registry.registerEntry's find-or-create path.
function recordingClient(tables) {
  const log = { inserts: [], rpcs: [] };
  const client = {
    from(name) {
      const filters = {};
      let inserted = null;
      const rows = () =>
        (tables[name] ?? []).filter((row) =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        );
      const q = {
        select: () => q,
        eq: (k, v) => {
          if (name === 'people' || name === 'event_entries') filters[k] = v;
          return q;
        },
        ilike: () => q,
        order: () => q,
        range: () => q,
        insert: (row) => {
          // a save that never answers, to look at the form while it is busy
          if (tables.hangInsert) return { select: () => ({ single: () => new Promise(() => {}) }) };
          inserted = { id: `new-${name}`, ...row };
          log.inserts.push({ table: name, row });
          (tables[name] ??= []).push(inserted);
          return q;
        },
        single: async () => ({
          data: inserted ?? (name === 'events' ? EVENT : rows()[0]),
          error: null,
        }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows(), error: null }),
      };
      return q;
    },
    rpc: async (fn, args) => {
      log.rpcs.push({ fn, args });
      return { error: null, status: 200 };
    },
  };
  return { client, log };
}

async function mountRecording(tables) {
  const root = document.createElement('div');
  document.body.append(root);
  const { client, log } = recordingClient({ events: [EVENT], ...tables });
  await mountThrowdownEventScreen(root, { eventId: 'ev', client, handlers: {} });
  return { root, log };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function type(root, id, value) {
  const node = root.querySelector(`#${id}`);
  node.value = value;
  node.dispatchEvent(new Event('input'));
}
function submitAdd(root) {
  root.querySelector('form.td-add').dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('adding a Throwdown competitor', () => {
  it('shows a visible label over every box: name, phone with its country, café or team', async () => {
    const { root } = await mountRecording({ event_entries: [] });
    const labels = [...root.querySelectorAll('form.td-add .form-field-label')].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(['Name', 'Phone', 'Café or team (optional)']);
    expect(root.querySelector('#td-new-phone').type).toBe('tel');
    expect(root.querySelector('#td-new-phoneCountry').value).toBe('BN');
    expect(root.querySelector('form.td-add').textContent).toContain('Seduh ID');
  });

  it('refuses a competitor with no phone, writes nothing, and keeps the name typed', async () => {
    const { root, log } = await mountRecording({ event_entries: [] });
    type(root, 'td-new-displayName', 'Ana');
    submitAdd(root);
    await settle();
    expect(log.inserts).toEqual([]);
    expect(root.querySelector('#td-add-error').textContent).toBe(
      'Enter the competitor’s phone number.',
    );
    const phone = root.querySelector('#td-new-phone');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-describedby')).toContain('td-add-error');
    // the refusal sits in the phone's own field, not at the foot of the form
    expect(root.querySelector('#td-add-error').closest('.form-field').contains(phone)).toBe(true);
    expect(document.activeElement).toBe(phone);
    expect(root.querySelector('#td-new-displayName').value).toBe('Ana');
    expect(log.rpcs).toEqual([]);
  });

  it('refuses a phone it cannot read: nothing written, the error replaces the hint, all kept', async () => {
    const { root, log } = await mountRecording({ event_entries: [] });
    type(root, 'td-new-displayName', 'Ana');
    type(root, 'td-new-phone', '12');
    type(root, 'td-new-cafe', 'BrewLab');
    submitAdd(root);
    await settle();
    expect(log.inserts).toEqual([]);
    expect(log.rpcs).toEqual([]);
    expect(root.querySelector('#td-add-error').textContent).toBe(
      phoneErrorMessage(parsePhone('12', { country: 'BN' }).code),
    );
    expect(root.querySelector('#td-new-phone').getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('#td-new-phone-hint')).toBeNull();
    expect(root.querySelector('#td-new-phone').value).toBe('12');
    expect(root.querySelector('#td-new-cafe').value).toBe('BrewLab');
  });

  it('a refusal clears the previous success words', async () => {
    const { root } = await mountRecording({ event_entries: [], people: [] });
    type(root, 'td-new-displayName', 'Ana');
    type(root, 'td-new-phone', '7123456');
    submitAdd(root);
    for (let i = 0; i < 10; i += 1) await settle();
    expect(root.querySelector('.screen-feedback').textContent).toBe('Ana added.');
    type(root, 'td-new-displayName', 'Bima');
    submitAdd(root);
    await settle();
    expect(root.querySelector('.screen-feedback').textContent).toBe('');
  });

  it('while saving, the boxes stay focusable (read-only, aria-disabled), so focus is kept', async () => {
    const { root } = await mountRecording({ event_entries: [], people: [], hangInsert: true });
    type(root, 'td-new-displayName', 'Ana');
    type(root, 'td-new-phone', '7123456');
    root.querySelector('#td-new-phone').focus();
    submitAdd(root);
    for (let i = 0; i < 5; i += 1) await settle();
    const phone = root.querySelector('#td-new-phone');
    expect(phone.disabled).toBe(false);
    expect(phone.readOnly).toBe(true);
    expect(phone.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('#td-new-phoneCountry').disabled).toBe(false);
    expect(document.activeElement).toBe(phone);
  });

  it('registers a person by canonical phone, enters them, and asks for the Seduh ID link', async () => {
    const { root, log } = await mountRecording({ event_entries: [], people: [] });
    type(root, 'td-new-displayName', 'Ana');
    type(root, 'td-new-phone', '712 3456');
    type(root, 'td-new-cafe', 'BrewLab');
    submitAdd(root);
    for (let i = 0; i < 10; i += 1) await settle();
    const person = log.inserts.find((i) => i.table === 'people');
    expect(person.row).toMatchObject({ org_id: 'org', display_name: 'Ana', phone: '+6737123456' });
    const entry = log.inserts.find((i) => i.table === 'event_entries');
    expect(entry.row).toMatchObject({ event_id: 'ev', person_id: 'new-people' });
    expect(log.rpcs).toContainEqual({
      fn: 'link_person_identity',
      args: { p_org_id: 'org', p_person_id: 'new-people' },
    });
    expect(root.querySelector('.screen-feedback').textContent).toBe('Ana added.');
    expect(root.querySelector('#td-new-displayName').value).toBe('');
    expect(root.querySelector('#td-new-phone').value).toBe('');
  });

  it('a phone already on this event’s roster adds nobody new and says who it is', async () => {
    const people = [{ id: 'p1', org_id: 'org', phone: '+6737123456', display_name: 'Ana Rahman' }];
    const existing = [
      { id: 'eA', event_id: 'ev', person_id: 'p1', display_name: 'Ana Rahman', withdrawn: false },
    ];
    const { root, log } = await mountRecording({ event_entries: existing, people });
    type(root, 'td-new-displayName', 'Ana R');
    type(root, 'td-new-phone', '7123456');
    submitAdd(root);
    for (let i = 0; i < 10; i += 1) await settle();
    expect(log.inserts).toEqual([]);
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'Ana Rahman is already a competitor.',
    );
  });

  it('a person entered in ANOTHER event is added to this one, as the same person', async () => {
    const people = [{ id: 'p1', org_id: 'org', phone: '+6737123456', display_name: 'Ana Rahman' }];
    const elsewhere = [
      {
        id: 'eX',
        event_id: 'other',
        person_id: 'p1',
        display_name: 'Ana Rahman',
        withdrawn: false,
      },
    ];
    const { root, log } = await mountRecording({ event_entries: elsewhere, people });
    type(root, 'td-new-displayName', 'Ana');
    type(root, 'td-new-phone', '7123456');
    submitAdd(root);
    for (let i = 0; i < 10; i += 1) await settle();
    expect(log.inserts.map((i) => i.table)).toEqual(['event_entries']);
    expect(log.inserts[0].row).toMatchObject({ event_id: 'ev', person_id: 'p1' });
    expect(root.querySelector('.screen-feedback').textContent).toBe('Ana Rahman added.');
  });
});
