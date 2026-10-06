// "Edit time" through the three real screens that offer it — the timing screen,
// the manual-timing screen's completed view, and the scoring screen — against
// a small STATEFUL fake that mirrors what the real RPCs do to a heat (status
// rules, compare-and-set on the shown time, the updated_at bump, and
// confirm_heat rewriting each time from the payload it is sent). The real
// RPC's own rules are proven in supabase/tests/023_correct_heat_time.sql; this
// file proves the screens use them correctly and, above all, that a
// correction survives the Confirm that follows it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountTimingScreen } from './timingScreen.js';
import { mountManualTimingScreen } from './timingManualScreen.js';
import { mountScoringScreen } from './scoringScreen.js';
import { _clearAllForTests } from '../../core/db.js';
import { countPendingOperations, enqueueOperation, flushOutbox } from '../../core/outbox.js';
import { cupTasterOutboxHandlers } from './outboxHandlers.js';

beforeEach(async () => {
  await _clearAllForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function matches(row, filters) {
  return filters.every(([type, col, val]) =>
    type === 'in' ? val.includes(row[col]) : row[col] === val,
  );
}

function tableBuilder(rows) {
  const filters = [];
  const copy = (list) => list.map((row) => ({ ...row }));
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: (col, val) => (filters.push(['eq', col, val]), builder),
    is: (col, val) => (filters.push(['is', col, val]), builder),
    in: (col, val) => (filters.push(['in', col, val]), builder),
    single: () => {
      const hit = rows.find((row) => matches(row, filters));
      return Promise.resolve({ data: hit ? { ...hit } : null, error: null });
    },
    maybeSingle: () => builder.single(),
    then: (onResolve, onReject) =>
      Promise.resolve({
        data: copy(rows.filter((row) => matches(row, filters))),
        error: null,
      }).then(onResolve, onReject),
  };
  return builder;
}

const refusal = (code, message, detail) =>
  Promise.resolve({
    data: null,
    error: { code, message, details: detail ? JSON.stringify(detail) : undefined },
    status: 500,
  });

function buildClient({ heat, entries, sets = [] }) {
  const db = {
    events: [{ id: 'ev1', org_id: 'org1', is_test: false }],
    ct_heats: [
      { updated_at: '2026-10-06T10:00:00.000Z', stage_id: 'st1', heat_number: 1, ...heat },
    ],
    ct_heat_entries: entries.map((entry) => ({ ...entry })),
    event_entries: entries.map((entry) => ({ id: entry.entry_id, display_name: entry.name })),
    ct_sets: sets,
    ct_results: [],
  };
  for (const row of db.ct_heat_entries) delete row.name;
  const calls = [];
  const processed = new Set();
  let tick = 0;
  const theHeat = () => db.ct_heats[0];

  const client = {
    db,
    calls,
    // Switches a test can flip: `offline` makes the correction RPC fail the way a lost
    // connection does (status 0, not a server refusal); `breakReads` makes the NEXT
    // screen reload throw, as it would with no connection.
    offline: false,
    breakReads: false,
    from(table) {
      if (client.breakReads) throw new Error('Failed to fetch');
      return tableBuilder(db[table] ?? []);
    },
    rpc(name, payload) {
      calls.push([name, payload]);
      if (name === 'correct_heat_time') {
        if (client.offline) {
          return Promise.resolve({ data: null, error: { message: 'Failed to fetch' }, status: 0 });
        }
        // The real RPC refuses an org that is not the entry's own, and treats a repeated
        // operation id as already done.
        if (payload.p_org_id !== 'org1') {
          return refusal('P0001', 'correct_heat_time: heat entry not found');
        }
        if (processed.has(payload.p_operation_id)) {
          return Promise.resolve({ data: null, error: null });
        }
        const entry = db.ct_heat_entries.find((e) => e.id === payload.p_heat_entry_id);
        if (!['timing', 'scoring'].includes(theHeat().status)) {
          return refusal(
            'P0002',
            `CONFLICT: heat h1 is ${theHeat().status}, its times can no longer be corrected`,
            { heat_id: 'h1', current_status: theHeat().status },
          );
        }
        if (entry.elapsed_secs == null) return refusal('P0001', 'no recorded time to correct');
        if (entry.elapsed_secs !== payload.p_expected_elapsed_secs) {
          return refusal('P0002', 'CONFLICT: heat entry time has changed', {
            heat_entry_id: entry.id,
            current_elapsed_secs: entry.elapsed_secs,
            expected_elapsed_secs: payload.p_expected_elapsed_secs,
          });
        }
        if (payload.p_elapsed_secs === entry.elapsed_secs) return refusal('P0001', 'same time');
        processed.add(payload.p_operation_id); // only a SUCCESSFUL correction is recorded
        Object.assign(entry, {
          elapsed_secs: payload.p_elapsed_secs,
          elapsed_secs_raw: payload.p_elapsed_secs_raw,
          maxed: payload.p_maxed,
          time_source: 'manual',
          time_note: payload.p_reason,
          time_edited_at: payload.p_time_edited_at,
        });
        // The real RPC bumps the heat's updated_at (that is what makes a stale
        // confirm conflict).
        tick += 1;
        theHeat().updated_at = `2026-10-06T10:01:${String(tick).padStart(2, '0')}.000Z`;
        if (client.breakAfterCorrection) client.breakReads = true;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === 'confirm_heat') {
        if (theHeat().updated_at !== payload.p_expected_updated_at) {
          return refusal('P0002', 'CONFLICT: heat has been modified since it was read', {
            heat_id: payload.p_heat_id,
            current_updated_at: theHeat().updated_at,
            expected_updated_at: payload.p_expected_updated_at,
          });
        }
        // Like the real RPC: every time is rewritten from the payload.
        for (const sent of payload.p_entries) {
          const entry = db.ct_heat_entries.find((e) => e.id === sent.entry_id);
          entry.elapsed_secs = sent.elapsed_secs;
          entry.elapsed_secs_raw = sent.elapsed_secs_raw;
          entry.maxed = sent.maxed;
          entry.time_source = sent.time_source;
          for (const result of sent.results) {
            db.ct_results.push({
              heat_entry_id: entry.id,
              set_id: result.set_id,
              correct: result.correct,
            });
          }
        }
        theHeat().status = 'confirmed';
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return client;
}

const stopped = {
  id: 'he1',
  heat_id: 'h1',
  entry_id: 'e1',
  name: 'Cupper One',
  station: 'A',
  elapsed_secs: 200,
  elapsed_secs_raw: 200,
  maxed: false,
  time_source: 'tapped',
};
const running = {
  id: 'he2',
  heat_id: 'h1',
  entry_id: 'e2',
  name: 'Cupper Two',
  station: 'B',
  elapsed_secs: null,
  elapsed_secs_raw: null,
  maxed: false,
  time_source: 'tapped',
};
const stopped2 = { ...running, elapsed_secs: 300, elapsed_secs_raw: 300 };

const appHeat = (status) => ({
  id: 'h1',
  timing_mode: 'app',
  status,
  duration_secs: 480,
  started_at: new Date().toISOString(),
});
const manualHeat = (status) => ({ id: 'h1', timing_mode: 'manual', status, duration_secs: 480 });

let root;
let screen;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  screen = null;
});
afterEach(() => {
  screen?.unmount?.();
  root.remove();
});

const toggleOf = (entryId) => root.querySelector(`#time-correction-toggle-${entryId}`);
const panelOf = (entryId) => root.querySelector(`#time-correction-panel-${entryId}`);
const rowOf = (name) =>
  [...root.querySelectorAll('.timing-row')].find((row) => row.textContent.includes(name));
const feedback = () => root.querySelector('.screen-feedback');

// Drives the real editor: open, type the time, pick a reason, Save.
function correct(entryId, name, { minutes, seconds, reason }) {
  toggleOf(entryId).click();
  const panel = panelOf(entryId);
  panel.querySelector(`[aria-label="${name}: corrected minutes"]`).value = minutes;
  panel.querySelector(`[aria-label="${name}: corrected seconds"]`).value = seconds;
  [...panel.querySelectorAll('label.time-correction-reason')]
    .find((l) => l.textContent === reason)
    .querySelector('input')
    .click();
  panel.querySelector(`[aria-label="Save correction, ${name}"]`).click();
}

describe('timing screen — heat still timing', () => {
  it('offers Edit time on a stopped row and not on one still running', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(toggleOf('e1')).not.toBeNull();
    expect(toggleOf('e2')).toBeNull();
    expect(rowOf('Cupper Two').querySelector('.btn-stop')).not.toBeNull();
  });

  it('corrects the stopped cupper, shows the new time with its reason, and leaves the heat and the other cupper alone', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));

    expect(feedback().textContent).toBe("Cupper One's time corrected to 3:12.");
    const [name, payload] = client.calls.find(([n]) => n === 'correct_heat_time');
    expect(name).toBe('correct_heat_time');
    expect(payload).toMatchObject({
      p_org_id: 'org1',
      p_heat_entry_id: 'he1',
      p_expected_elapsed_secs: 200,
      p_elapsed_secs: 192,
      p_reason: 'Missed the stop',
    });
    expect(rowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:12');
    expect(rowOf('Cupper One').querySelector('.timing-row-note').textContent).toBe(
      'Corrected — Missed the stop',
    );
    expect(client.db.ct_heats[0].status).toBe('timing');
    expect(client.db.ct_heat_entries[1].elapsed_secs).toBeNull();
    // Focus goes to the feedback region, like every other action on these screens, so the
    // result is read out — and the finished editor is not reopened.
    expect(document.activeElement).toBe(feedback());
    expect(panelOf('e1').hidden).toBe(true);
    expect(toggleOf('e1').hidden).toBe(false);
  });

  it('a second correction chains from the first: it is checked against the corrected time', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().textContent).toContain('corrected to 3:12'));
    correct('e1', 'Cupper One', { minutes: '3', seconds: '5', reason: 'Wrong cupper' });
    await vi.waitFor(() => expect(feedback().textContent).toContain('corrected to 3:05'));

    const sent = client.calls
      .filter(([n]) => n === 'correct_heat_time')
      .map(([, p]) => p.p_expected_elapsed_secs);
    expect(sent).toEqual([200, 192]);
    expect(rowOf('Cupper One').querySelector('.timing-row-note').textContent).toBe(
      'Corrected — Wrong cupper',
    );
  });

  it('a screen that is out of date says what the time is now, and keeps the newer one', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    // Another device corrects the same cupper behind this screen's back.
    client.db.ct_heat_entries[0].elapsed_secs = 185;

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));

    expect(feedback().textContent).toContain('changed elsewhere');
    expect(feedback().textContent).toContain('3:05');
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(185);
  });

  it('a heat that was confirmed behind the screen says so — the time is locked, not silently lost', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    client.db.ct_heats[0].status = 'confirmed';

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));

    expect(feedback().textContent).toBe(
      'This heat has already been confirmed, so its times are locked.',
    );
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(200);
  });

  it('a missing reason or a bad time is reported in the editor and never reaches the server', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    toggleOf('e1').click();
    panelOf('e1').querySelector('[aria-label="Save correction, Cupper One"]').click();
    expect(panelOf('e1').querySelector('[role="alert"]').textContent).toContain('reason');
    panelOf('e1').querySelector('label.time-correction-reason input').click();
    panelOf('e1').querySelector('[aria-label="Cupper One: corrected seconds"]').value = '75';
    panelOf('e1').querySelector('[aria-label="Save correction, Cupper One"]').click();
    expect(panelOf('e1').querySelector('[role="alert"]').textContent).toContain('0 to 59');
    expect(client.calls.filter(([n]) => n === 'correct_heat_time')).toHaveLength(0);
  });

  it('typing the time that is already recorded is a local error: the editor stays open, the reason stays chosen, nothing is queued or re-rendered', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const rowBefore = rowOf('Cupper One');
    toggleOf('e1').click();
    const panel = panelOf('e1');
    panel.querySelector('label.time-correction-reason input').click(); // 'Missed the stop'
    // The prefilled 3:20 IS the recorded time — save it as is.
    panel.querySelector('[aria-label="Save correction, Cupper One"]').click();

    await vi.waitFor(() =>
      expect(panel.querySelector('[role="alert"]').textContent).toContain(
        'already the recorded time (3:20)',
      ),
    );
    expect(rowOf('Cupper One')).toBe(rowBefore); // no render() happened
    expect(panelOf('e1')).toBe(panel);
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('label.time-correction-reason input').checked).toBe(true);
    expect(
      panel
        .querySelector('[aria-label="Save correction, Cupper One"]')
        .hasAttribute('aria-disabled'),
    ).toBe(false);
    expect(feedback().textContent).toBe('');
    expect(client.calls.filter(([n]) => n === 'correct_heat_time')).toHaveLength(0);
    expect(await countPendingOperations()).toBe(0);
  });

  it('a time past the heat duration is stored as the max and the message says so', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    correct('e1', 'Cupper One', { minutes: '9', seconds: '0', reason: 'Wrong cupper' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));
    expect(feedback().textContent).toContain('corrected to 8:00');
    expect(feedback().textContent).toContain("heat's maximum time");
    expect(rowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe(
      'Max time (8:00)',
    );
    expect(client.calls.find(([n]) => n === 'correct_heat_time')[1]).toMatchObject({
      p_elapsed_secs: 480,
      p_elapsed_secs_raw: 540,
      p_maxed: true,
    });
  });

  it('a correction made offline is saved, not lost: it says so, parks Edit, leaves the old time showing — and lands when the connection returns', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    client.offline = true;
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const rowBefore = rowOf('Cupper One');

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('pending'));

    expect(feedback().textContent).toContain('saved on this device');
    expect(feedback().textContent).not.toContain('try again');
    expect(document.activeElement).toBe(feedback());
    expect(toggleOf('e1').getAttribute('aria-disabled')).toBe('true');
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    expect(panelOf('e1').hidden).toBe(true);
    // No reload was attempted (it would need the same connection): the old time stays up.
    expect(rowOf('Cupper One')).toBe(rowBefore);
    expect(rowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:20');
    expect(await countPendingOperations()).toBe(1);
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(200);

    // The connection returns; the queue drains and the correction lands, exactly once.
    client.offline = false;
    await flushOutbox(cupTasterOutboxHandlers(client));
    expect(await countPendingOperations()).toBe(0);
    expect(client.db.ct_heat_entries[0]).toMatchObject({
      elapsed_secs: 192,
      time_source: 'manual',
      time_note: 'Missed the stop',
    });
    expect(client.calls.filter(([n]) => n === 'correct_heat_time')).toHaveLength(2);
  });

  it('if the reload after a landed correction fails, Save is given back — not left stuck on "Saving…"', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    client.breakAfterCorrection = true;

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));

    const save = panelOf('e1').querySelector('[aria-label="Save correction, Cupper One"]');
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(save.textContent).toBe('Save correction');
  });

  it('another cupper’s Stop re-renders the screen but an open Edit time form, with what was typed, comes back', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    toggleOf('e1').click();
    const first = panelOf('e1');
    first.querySelector('[aria-label="Cupper One: corrected minutes"]').value = '3';
    first.querySelector('[aria-label="Cupper One: corrected seconds"]').value = '12';
    [...first.querySelectorAll('label.time-correction-reason')]
      .find((l) => l.textContent === 'Other')
      .querySelector('input')
      .click();
    first.querySelector('.time-correction-other').value = 'Judge started the clock late';

    rowOf('Cupper Two').querySelector('.btn-stop').click();
    await vi.waitFor(() => expect(feedback().dataset.tone).toBeTruthy());

    const again = panelOf('e1');
    expect(again).not.toBe(first); // the screen really was rebuilt
    expect(again.hidden).toBe(false);
    expect(toggleOf('e1').hidden).toBe(true);
    expect(again.querySelector('[aria-label="Cupper One: corrected minutes"]').value).toBe('3');
    expect(again.querySelector('[aria-label="Cupper One: corrected seconds"]').value).toBe('12');
    expect(again.querySelector('.time-correction-other').value).toBe(
      'Judge started the clock late',
    );
    expect(again.querySelector('.time-correction-other').hidden).toBe(false);
  });
});

describe('timing screen — timing complete (heat in scoring)', () => {
  it('still offers Edit time on every row', async () => {
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Timing complete');
    expect(toggleOf('e1')).not.toBeNull();
    expect(toggleOf('e2')).not.toBeNull();
  });

  it('corrects a time and stays on the completed view, focus back on that row', async () => {
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    correct('e2', 'Cupper Two', {
      minutes: '4',
      seconds: '50',
      reason: "Manual timekeeper's time",
    });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));

    expect(feedback().textContent).toBe("Cupper Two's time corrected to 4:50.");
    expect(root.textContent).toContain('Timing complete');
    expect(rowOf('Cupper Two').querySelector('.timing-row-result').textContent).toBe('4:50');
    expect(document.activeElement).toBe(feedback());
  });

  it('a confirmed heat offers no Edit time at all — and still shows why a time was corrected', async () => {
    const corrected = {
      ...stopped,
      elapsed_secs: 192,
      time_source: 'manual',
      time_note: 'Missed the stop',
    };
    const client = buildClient({ heat: appHeat('confirmed'), entries: [corrected, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(toggleOf('e1')).toBeNull();
    expect(toggleOf('e2')).toBeNull();
    expect(root.querySelector('.time-correction-panel')).toBeNull();
    expect(rowOf('Cupper One').querySelector('.timing-row-note').textContent).toBe(
      'Corrected — Missed the stop',
    );
    expect(rowOf('Cupper Two').querySelector('.timing-row-note')).toBeNull();
  });
});

describe('manual-timing screen', () => {
  it('offers Edit time once the heat is complete and corrects a time', async () => {
    const client = buildClient({ heat: manualHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Timing complete');

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));

    expect(feedback().textContent).toBe("Cupper One's time corrected to 3:12.");
    expect(rowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:12');
    expect(document.activeElement).toBe(feedback());
  });

  it('correcting one cupper leaves another cupper’s open Edit time form, and what was typed in it, as it was', async () => {
    const client = buildClient({ heat: manualHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    toggleOf('e2').click();
    const second = panelOf('e2');
    second.querySelector('[aria-label="Cupper Two: corrected minutes"]').value = '4';
    second.querySelector('[aria-label="Cupper Two: corrected seconds"]').value = '40';
    second.querySelector('label.time-correction-reason input').click();

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Wrong cupper' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));

    const again = panelOf('e2');
    expect(again).not.toBe(second); // rebuilt…
    expect(again.hidden).toBe(false); // …and reopened
    expect(again.querySelector('[aria-label="Cupper Two: corrected minutes"]').value).toBe('4');
    expect(again.querySelector('[aria-label="Cupper Two: corrected seconds"]').value).toBe('40');
    expect(again.querySelector('label.time-correction-reason input').checked).toBe(true);
    // …while the one just corrected is finished and stays closed.
    expect(panelOf('e1').hidden).toBe(true);
    expect(toggleOf('e1').hidden).toBe(false);
  });

  it('does not add Edit time to the entry rows of a heat still pending — those are already editable', async () => {
    const client = buildClient({ heat: manualHeat('pending'), entries: [stopped, running] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.time-correction-panel')).toBeNull();
    expect(root.querySelector('.manual-time-fields')).not.toBeNull();
  });

  it('a confirmed manual heat offers no Edit time', async () => {
    const client = buildClient({ heat: manualHeat('confirmed'), entries: [stopped, stopped2] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.time-correction-panel')).toBeNull();
  });
});

describe('scoring screen', () => {
  const sets = [{ id: 's1', stage_id: 'st1', position: 1, label: null }];
  const mountScoring = async (heat, entries) => {
    const client = buildClient({ heat, entries, sets });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    return client;
  };
  // The Times card's row — scoring rows share the .timing-row class but carry no time.
  const timeRowOf = (name) =>
    [...root.querySelectorAll('.timing-row:not(.scoring-row)')].find((row) =>
      row.textContent.includes(name),
    );
  const confirmButton = () =>
    [...root.querySelectorAll('button')].find((b) =>
      ['Confirm heat', 'Confirming…'].includes(b.textContent),
    );
  const scoreEveryone = async () => {
    for (const button of [...root.querySelectorAll('.scoring-toggle')]) {
      button.click();
      await vi.waitFor(() => expect(confirmButton()).toBeTruthy());
    }
  };

  it('lists each cupper’s time above Confirm, with Edit time, and says confirming locks them', async () => {
    await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [stopped, stopped2]);
    const timesCard = [...root.querySelectorAll('.card')].find(
      (card) => card.querySelector('h2')?.textContent === 'Times',
    );
    expect(timesCard).toBeTruthy();
    expect(timesCard.textContent).toContain('Confirming the heat locks them');
    expect(timesCard.querySelectorAll('.timing-row')).toHaveLength(2);
    expect(timeCardOrder()).toBe(true);
    expect(toggleOf('e1')).not.toBeNull();
    expect(root.querySelector('.btn-stop')).toBeNull();

    function timeCardOrder() {
      const cards = [...root.querySelectorAll('.card')];
      return cards.indexOf(timesCard) < cards.indexOf(confirmButton().closest('.card'));
    }
  });

  it('corrects a time, keeps the scores already tapped, and refreshes the Confirm that follows', async () => {
    const client = await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [
      stopped,
      stopped2,
    ]);
    root.querySelector('.scoring-toggle').click(); // Cupper One, set 1 — a score worth keeping
    await vi.waitFor(() =>
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct'),
    );

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));

    expect(feedback().textContent).toBe("Cupper One's time corrected to 3:12.");
    expect(timeRowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:12');
    expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct');
    expect(document.activeElement).toBe(feedback());
    // The finished editor is not reopened by the draft restore.
    expect(panelOf('e1').hidden).toBe(true);
    expect(toggleOf('e1').hidden).toBe(false);
    expect(client.db.ct_heats[0].status).toBe('scoring');
  });

  it('the corrected time is what Confirm locks in — the old tapped time does not come back', async () => {
    const client = await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [
      stopped,
      stopped2,
    ]);
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('success'));

    await scoreEveryone();
    await vi.waitFor(() => expect(confirmButton().disabled).toBe(false));
    confirmButton().click();
    await vi.waitFor(() => expect(root.textContent).toContain('Heat confirmed'));

    const sent = client.calls.find(([n]) => n === 'confirm_heat')[1];
    expect(sent.p_entries.find((e) => e.entry_id === 'he1')).toMatchObject({
      elapsed_secs: 192,
      time_source: 'manual',
    });
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(192);
  });

  it('a confirm from a screen loaded BEFORE a correction conflicts instead of putting the old time back', async () => {
    const client = await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [
      stopped,
      stopped2,
    ]);
    await scoreEveryone();
    await vi.waitFor(() => expect(confirmButton().disabled).toBe(false));

    // Someone else corrects Cupper One from another device.
    const other = await client.rpc('correct_heat_time', {
      p_operation_id: crypto.randomUUID(),
      p_org_id: 'org1',
      p_heat_entry_id: 'he1',
      p_expected_elapsed_secs: 200,
      p_elapsed_secs: 192,
      p_elapsed_secs_raw: 192,
      p_maxed: false,
      p_reason: 'Missed the stop',
      p_time_edited_at: new Date().toISOString(),
    });
    expect(other.error).toBeNull();

    confirmButton().click();
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));

    expect(feedback().textContent).toContain('changed elsewhere');
    expect(client.db.ct_heats[0].status).toBe('scoring');
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(192);
    expect(client.db.ct_heat_entries[0].time_source).toBe('manual');

    // Reloading is the way out: Confirm again, now from the corrected heat, and it
    // locks the corrected time.
    await vi.waitFor(() => expect(confirmButton().disabled).toBe(false));
    confirmButton().click();
    await vi.waitFor(() => expect(root.textContent).toContain('Heat confirmed'));
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(192);
    expect(client.db.ct_heats[0].status).toBe('confirmed');
  });

  it('a confirmed heat shows its times as locked, with no Edit time', async () => {
    const corrected = {
      ...stopped,
      elapsed_secs: 192,
      time_source: 'manual',
      time_note: 'Missed the stop',
    };
    await mountScoring({ id: 'h1', status: 'confirmed', duration_secs: 480 }, [
      corrected,
      stopped2,
    ]);
    const timesCard = [...root.querySelectorAll('.card')].find(
      (card) => card.querySelector('h2')?.textContent === 'Times',
    );
    expect(timesCard.textContent).toContain('Times are locked once a heat is confirmed.');
    expect(timesCard.textContent).toContain('3:12');
    expect(timesCard.textContent).toContain('Corrected — Missed the stop');
    expect(root.querySelector('.time-correction-panel')).toBeNull();
  });

  it('a heat that was confirmed behind the screen says the times are locked', async () => {
    const client = await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [
      stopped,
      stopped2,
    ]);
    client.db.ct_heats[0].status = 'confirmed';
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));
    expect(feedback().textContent).toBe(
      'This heat has already been confirmed, so its times are locked.',
    );
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(200);
  });

  it('does not offer a Stop button for a cupper with no time, even in a fixture that has one', async () => {
    await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [stopped, running]);
    expect(root.querySelector('.btn-stop')).toBeNull();
    expect(toggleOf('e2')).toBeNull();
  });
  it('a correction made offline on the scoring screen says it is saved — Save is not stuck on "Saving…" and nothing says "try again"', async () => {
    const client = await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [
      stopped,
      stopped2,
    ]);
    client.offline = true;
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('pending'));
    expect(feedback().textContent).toContain('saved on this device');
    expect(feedback().textContent).not.toContain('try again');
    expect(toggleOf('e1').getAttribute('aria-disabled')).toBe('true');
    expect(timeRowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:20');
    expect(await countPendingOperations()).toBe(1);
    const save = panelOf('e1').querySelector('[aria-label="Save correction, Cupper One"]');
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(save.textContent).toBe('Save correction');
  });

  it('if the reload after a landed correction fails, the scoring screen gives Save back — it used to leave it stuck on "Saving…"', async () => {
    const client = await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [
      stopped,
      stopped2,
    ]);
    client.breakAfterCorrection = true;
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));
    const save = panelOf('e1').querySelector('[aria-label="Save correction, Cupper One"]');
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(save.textContent).toBe('Save correction');
  });

  it('a score tap re-renders the screen, but an open Edit time form — and what was typed in it — comes back', async () => {
    await mountScoring({ id: 'h1', status: 'scoring', duration_secs: 480 }, [stopped, stopped2]);
    toggleOf('e1').click();
    const first = panelOf('e1');
    first.querySelector('[aria-label="Cupper One: corrected minutes"]').value = '3';
    first.querySelector('[aria-label="Cupper One: corrected seconds"]').value = '12';
    first.querySelector('label.time-correction-reason:nth-of-type(2) input').click();

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() =>
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct'),
    );

    const again = panelOf('e1');
    expect(again).not.toBe(first);
    expect(again.hidden).toBe(false);
    expect(again.querySelector('[aria-label="Cupper One: corrected minutes"]').value).toBe('3');
    expect(again.querySelector('[aria-label="Cupper One: corrected seconds"]').value).toBe('12');
    expect(again.querySelector('label.time-correction-reason:nth-of-type(2) input').checked).toBe(
      true,
    );
    // An editor nobody opened stays shut.
    expect(panelOf('e2').hidden).toBe(true);
  });
});

describe('what the outbox still holds survives a re-render', () => {
  it('a row whose correction is queued comes back parked after another cupper’s Stop re-renders the screen', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    client.offline = true;
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('pending'));
    const rowBefore = rowOf('Cupper One');

    rowOf('Cupper Two').querySelector('.btn-stop').click();
    await vi.waitFor(() => expect(rowOf('Cupper One')).not.toBe(rowBefore)); // really rebuilt

    // Server state still says 3:20 — but the outbox knows better, so Edit is not offered again.
    const rebuilt = toggleOf('e1');
    expect(rowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:20');
    expect(rebuilt.textContent).toBe('Waiting to sync');
    expect(rebuilt.getAttribute('aria-disabled')).toBe('true');
    rebuilt.click();
    expect(panelOf('e1').hidden).toBe(true);

    // Once it lands, nothing is parked any more.
    client.offline = false;
    await flushOutbox(cupTasterOutboxHandlers(client));
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(192);
  });

  it('Edit is not offered on the scoring screen while a confirm for that heat is queued — it would be refused once the confirm lands', async () => {
    await enqueueOperation('confirm_heat', { p_heat_id: 'h1' });
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets: [{ id: 's1', stage_id: 'st1', position: 1, label: null }],
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Cupper One');
    expect(toggleOf('e1')).toBeNull();
    expect(root.querySelector('.time-correction-panel')).toBeNull();
  });

  it('…nor on the timing screen’s completed view', async () => {
    await enqueueOperation('confirm_heat', { p_heat_id: 'h1' });
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Timing complete');
    expect(toggleOf('e1')).toBeNull();
  });

  it('a confirm queued for ANOTHER heat does not take Edit away', async () => {
    await enqueueOperation('confirm_heat', { p_heat_id: 'some-other-heat' });
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(toggleOf('e1')).not.toBeNull();
  });
});

describe('an open Edit time form through a re-render', () => {
  it('keeps keyboard focus in the field being typed in — a Stop elsewhere does not pull it to the feedback region', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    toggleOf('e1').click();
    panelOf('e1').querySelector('[aria-label="Cupper One: corrected seconds"]').focus();

    rowOf('Cupper Two').querySelector('.btn-stop').click();
    await vi.waitFor(() => expect(feedback().dataset.tone).toBeTruthy());

    const seconds = panelOf('e1').querySelector('[aria-label="Cupper One: corrected seconds"]');
    expect(document.activeElement).toBe(seconds);
    expect(document.activeElement).not.toBe(feedback());
  });

  it('does not write an old time over another device’s correction when the screen re-renders', async () => {
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets: [{ id: 's1', stage_id: 'st1', position: 1, label: null }],
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    toggleOf('e1').click(); // opened, nothing typed: prefilled with the 3:20 it was built from
    const prefill = (name) =>
      panelOf('e1').querySelector(`[aria-label="Cupper One: corrected ${name}"]`).value;
    expect([prefill('minutes'), prefill('seconds')]).toEqual(['3', '20']);

    // Another device corrects Cupper One to 2:30 meanwhile; then a score tap re-renders.
    client.db.ct_heat_entries[0].elapsed_secs = 150;
    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() =>
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct'),
    );

    expect(panelOf('e1').hidden).toBe(false);
    expect([prefill('minutes'), prefill('seconds')]).toEqual(['2', '30']);
  });
});

describe('a mistyped time', () => {
  it('more than a day is refused in the editor — not sent to the server as an overflow', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    correct('e1', 'Cupper One', { minutes: '2000', seconds: '0', reason: 'Wrong cupper' });
    await vi.waitFor(() =>
      expect(panelOf('e1').querySelector('[role="alert"]').textContent).toContain(
        'longer than a day',
      ),
    );
    expect(panelOf('e1').hidden).toBe(false);
    expect(client.calls.filter(([n]) => n === 'correct_heat_time')).toHaveLength(0);
    expect(await countPendingOperations()).toBe(0);
  });
});

describe('the manual-timing screen and the scoring screen, behind a queued confirm and through a re-render', () => {
  it('manual timing: Edit is not offered on the completed view while a confirm for the heat is queued', async () => {
    await enqueueOperation('confirm_heat', { p_heat_id: 'h1' });
    const client = buildClient({ heat: manualHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Timing complete');
    expect(toggleOf('e1')).toBeNull();
  });

  it('scoring: a score tap does not pull focus out of an Edit time field that has it', async () => {
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets: [{ id: 's1', stage_id: 'st1', position: 1, label: null }],
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    toggleOf('e1').click();
    panelOf('e1').querySelector('[aria-label="Cupper One: corrected seconds"]').focus();

    root.querySelector('.scoring-toggle').click(); // re-renders; would normally refocus the score cell
    await vi.waitFor(() =>
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct'),
    );

    expect(document.activeElement).toBe(
      panelOf('e1').querySelector('[aria-label="Cupper One: corrected seconds"]'),
    );
  });
});

describe('Confirm waits for a correction that is still queued', () => {
  const sets = [{ id: 's1', stage_id: 'st1', position: 1, label: null }];
  const confirmBtn = () =>
    [...root.querySelectorAll('button')].find((b) =>
      ['Confirm heat', 'Confirming…'].includes(b.textContent),
    );

  it('disables Confirm with a reason while an entry in this heat has a queued correction', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets,
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    // Score everything so the ONLY thing holding Confirm back is the queued correction.
    for (const button of [...root.querySelectorAll('.scoring-toggle')]) {
      button.click();
      await vi.waitFor(() => expect(confirmBtn()).toBeTruthy());
    }
    await vi.waitFor(() =>
      expect(
        [...root.querySelectorAll('.scoring-toggle')].every((b) => b.dataset.tone === 'correct'),
      ).toBe(true),
    );
    expect(confirmBtn().disabled).toBe(true);
    // …and the row itself comes back parked, from the outbox alone (a fresh mount, no earlier DOM).
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    expect(toggleOf('e1').getAttribute('aria-disabled')).toBe('true');
    expect(toggleOf('e2').textContent).toBe('Edit time');
    const hint = root.querySelector(`#${confirmBtn().getAttribute('aria-describedby')}`);
    expect(hint.textContent).toBe(
      'A time correction is still waiting to sync — Confirm unlocks once it has.',
    );
  });

  it('a queued correction for some other heat leaves Confirm alone', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'not-in-this-heat' });
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets,
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    for (const button of [...root.querySelectorAll('.scoring-toggle')]) {
      button.click();
      await vi.waitFor(() => expect(confirmBtn()).toBeTruthy());
    }
    await vi.waitFor(() => expect(confirmBtn().disabled).toBe(false));
  });

  it('says why Edit is missing while a confirm is queued, instead of inviting an edit', async () => {
    await enqueueOperation('confirm_heat', { p_heat_id: 'h1' });
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets,
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain(
      "Times can't be changed while the confirm is waiting to sync.",
    );
    expect(root.textContent).not.toContain('Check each time against your manual timekeeper');
  });
});

describe('a save that is in flight when another action re-renders the screen', () => {
  it('the queued message lands on the feedback region that is on screen, and the row is not left editable', async () => {
    // The scoring screen: a score tap re-renders WITHOUT a flush, so it can land while the
    // correction's own RPC is still being held open (on the timing screens a Stop's flush
    // would queue up behind the in-flight one).
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets: [{ id: 's1', stage_id: 'st1', position: 1, label: null }],
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    client.offline = true;
    const originalRpc = client.rpc;
    let release;
    client.rpc = (name, payload) =>
      name === 'correct_heat_time'
        ? new Promise((resolve) => {
            release = () => resolve(originalRpc.call(client, name, payload));
          })
        : originalRpc.call(client, name, payload);

    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    const staleFeedback = feedback();

    root.querySelector('.scoring-toggle').click(); // re-renders the whole screen mid-save
    await vi.waitFor(() =>
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct'),
    );
    expect(feedback()).not.toBe(staleFeedback); // really rebuilt
    // The busy editor was NOT carried across: the row is not reopened with a fresh Save.
    expect(panelOf('e1').hidden).toBe(true);

    release();
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('pending'));
    expect(feedback().textContent).toContain('saved on this device');
    expect(feedback()).not.toBe(staleFeedback);
  });
});

describe('a queued correction is parked from the outbox alone, on every screen', () => {
  it('timing screen, completed view', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    expect(toggleOf('e2').textContent).toBe('Edit time');
  });

  it('manual-timing screen, completed view', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({ heat: manualHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    expect(toggleOf('e2').textContent).toBe('Edit time');
  });
});

describe('the screen looks again while something is queued, and lets go once it has synced', () => {
  const drain = () => flushOutbox({ correct_heat_time: () => Promise.resolve() });

  it('scoring: Confirm unlocks and the row returns to Edit time after the queued correction drains', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets: [{ id: 's1', stage_id: 'st1', position: 1, label: null }],
    });
    screen = await mountScoringScreen(root, {
      eventId: 'ev1',
      heatId: 'h1',
      client,
      recheckMs: 30,
    });
    const confirmBtn = () =>
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Confirm heat');
    for (const button of [...root.querySelectorAll('.scoring-toggle')]) {
      button.click();
      await vi.waitFor(() => expect(confirmBtn()).toBeTruthy());
    }
    // Every set scored, every tap's re-render finished — so the only thing that can still
    // change the screen after the drain below is the screen looking again on its own.
    await vi.waitFor(() =>
      expect(
        [...root.querySelectorAll('.scoring-toggle')].every((b) => b.dataset.tone === 'correct'),
      ).toBe(true),
    );
    expect(confirmBtn().disabled).toBe(true);
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    await new Promise((resolve) => setTimeout(resolve, 20));

    await drain(); // the correction reaches the server in the background
    await vi.waitFor(() => expect(confirmBtn().disabled).toBe(false));
    expect(toggleOf('e1').textContent).toBe('Edit time');
  });

  it('timing screen: the parked row returns to Edit time after the queued correction drains', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client, recheckMs: 30 });
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    await drain();
    await vi.waitFor(() => expect(toggleOf('e1').textContent).toBe('Edit time'));
  });

  it('stops looking after unmount', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({ heat: appHeat('scoring'), entries: [stopped, stopped2] });
    const mounted = await mountTimingScreen(root, {
      eventId: 'ev1',
      heatId: 'h1',
      client,
      recheckMs: 20,
    });
    mounted.unmount();
    root.innerHTML = 'torn down';
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(root.innerHTML).toBe('torn down'); // a look after unmount would have rebuilt it
  });
});

describe('the "Corrected —" note', () => {
  it('is not shown for a hand-entered manual time that was never corrected (manual source, no note)', async () => {
    const handEntered = { ...stopped, time_source: 'manual', time_note: null };
    const client = buildClient({ heat: manualHeat('scoring'), entries: [handEntered, stopped2] });
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.timing-row-note')).toBeNull();
    expect(root.textContent).not.toContain('Corrected —');
  });

  it('is not shown for a tapped time that happens to carry a note', async () => {
    const odd = { ...stopped, time_source: 'tapped', time_note: 'stray' };
    const client = buildClient({ heat: appHeat('scoring'), entries: [odd, stopped2] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.timing-row-note')).toBeNull();
  });
});

describe('a failed reload after a landed correction', () => {
  it('does not re-report that correction on a later, unrelated render', async () => {
    const client = buildClient({ heat: appHeat('timing'), entries: [stopped, running] });
    screen = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    client.breakAfterCorrection = true;
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));

    // The connection is back; some other action re-renders. The correction DID land — but its
    // pending check was dropped with the failed reload, so nothing reports on it out of context.
    client.breakAfterCorrection = false;
    client.breakReads = false;
    rowOf('Cupper Two').querySelector('.btn-stop').click();
    await vi.waitFor(() =>
      expect(rowOf('Cupper One').querySelector('.timing-row-result').textContent).toBe('3:12'),
    );
    expect(feedback().textContent).not.toContain('corrected to');
  });
});

describe('the manual-timing screen offline', () => {
  it('a correction made offline is saved, says so, and parks Edit', async () => {
    const client = buildClient({ heat: manualHeat('scoring'), entries: [stopped, stopped2] });
    client.offline = true;
    screen = await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('pending'));
    expect(feedback().textContent).toContain('saved on this device');
    expect(toggleOf('e1').getAttribute('aria-disabled')).toBe('true');
    expect(await countPendingOperations()).toBe(1);
  });
});

describe('looking again, on the manual-timing screen', () => {
  it('the parked row returns to Edit time after the queued correction drains', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const client = buildClient({ heat: manualHeat('scoring'), entries: [stopped, stopped2] });
    screen = await mountManualTimingScreen(root, {
      eventId: 'ev1',
      heatId: 'h1',
      client,
      recheckMs: 30,
    });
    expect(toggleOf('e1').textContent).toBe('Waiting to sync');
    await flushOutbox({ correct_heat_time: () => Promise.resolve() });
    await vi.waitFor(() => expect(toggleOf('e1').textContent).toBe('Edit time'));
  });
});

describe('a failed reload after a landed correction — scoring screen', () => {
  it('does not re-report that correction on a later render with nothing else to say', async () => {
    const client = buildClient({
      heat: { id: 'h1', status: 'scoring', duration_secs: 480 },
      entries: [stopped, stopped2],
      sets: [{ id: 's1', stage_id: 'st1', position: 1, label: null }],
    });
    screen = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    client.breakAfterCorrection = true;
    correct('e1', 'Cupper One', { minutes: '3', seconds: '12', reason: 'Missed the stop' });
    await vi.waitFor(() => expect(feedback().dataset.tone).toBe('error'));

    // Connection back; a score tap re-renders with no message of its own. The correction did land,
    // but its pending check went with the failed reload — nothing may report on it now.
    client.breakAfterCorrection = false;
    client.breakReads = false;
    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() =>
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct'),
    );
    expect(feedback().textContent).toBe('');
    expect(feedback().dataset.tone).toBeUndefined();
  });
});
