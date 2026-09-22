import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const cache = new Map();
let cacheSetFails = false;
let cacheClearFails = false; // only writes of null (clearDraft) fail
vi.mock('../../core/db.js', () => ({
  cacheGet: vi.fn(async (key) => cache.get(key)),
  cacheSet: vi.fn(async (key, value) => {
    if (cacheSetFails || (cacheClearFails && value === null)) {
      throw new Error('storage unavailable');
    }
    cache.set(key, value);
  }),
}));

// The mocked outbox stands in for the queue AND the server: a queued confirm is applied to
// the fake database the way confirm_btc_match would (match confirmed, ledger row written)
// unless a test overrides the flush outcome.
let db;
let queue = [];
let flushOutcome = 'success';
let failSingle = false;
let failLedger = false;
let beforeQueueRead = null; // a hook that lets a test act "between" the screen's reads
function applyQueuedOps() {
  for (const { payload } of queue) {
    db.btc_matches[0] = {
      ...db.btc_matches[0],
      status: 'confirmed',
      updated_at: `T${db.processed_operations.length + 1}`,
    };
    db.processed_operations.push({ id: payload.p_operation_id });
  }
  queue = [];
}
vi.mock('../../core/outbox.js', () => ({
  enqueueOperation: vi.fn(async (type, payload) => {
    queue.push({ type, payload });
  }),
  listPendingOperations: vi.fn(async () => {
    beforeQueueRead?.();
    return queue;
  }),
  flushOutbox: vi.fn(async () => {
    if (flushOutcome === 'success') {
      // Like the real RPC: a confirm built on an old match version is refused (P0002).
      if (queue.some((op) => op.payload.p_expected_updated_at !== db.btc_matches[0].updated_at)) {
        queue = [];
        return { processed: 0, stopped: false, permanentFailure: true, error: { code: 'P0002' } };
      }
      applyQueuedOps();
      return { processed: 1, stopped: false, permanentFailure: false };
    }
    if (flushOutcome === 'conflict') {
      queue = []; // a permanent rejection is dropped from the queue
      return { processed: 0, stopped: false, permanentFailure: true, error: { code: 'P0002' } };
    }
    if (flushOutcome === 'invalid') {
      queue = [];
      return {
        processed: 0,
        stopped: false,
        permanentFailure: true,
        error: { code: 'P0001', message: 'confirm_btc_match: 3 of 15 cups are missing a score' },
      };
    }
    return { processed: 0, stopped: true, permanentFailure: false }; // offline: stays queued
  }),
  buildRpcHandler: () => async () => {},
}));

const { mountScoringScreen } = await import('./scoringScreen.js');
const { DEFAULT_LOAD_TIMEOUT_MS } = await import('../../core/timeout.js');

function fakeClient({ hang = false } = {}) {
  function makeBuilder(table) {
    const filters = [];
    const rows = () => (db[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const builder = {
      select: () => builder,
      eq: (col, val) => {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      single: () => {
        if (hang) return new Promise(() => {});
        return failSingle
          ? Promise.resolve({ data: null, error: new Error('network down') })
          : Promise.resolve({ data: structuredClone(rows()[0] ?? null), error: null });
      },
      maybeSingle: () => {
        if (hang) return new Promise(() => {});
        if (table === 'processed_operations' && failLedger) {
          return Promise.resolve({ data: null, error: new Error('offline') });
        }
        return Promise.resolve({ data: structuredClone(rows()[0] ?? null), error: null });
      },
      then: (resolve, reject) =>
        Promise.resolve({ data: structuredClone(rows()), error: null }).then(resolve, reject),
    };
    return builder;
  }
  return { from: makeBuilder };
}

function baseDb(round = 'preliminary') {
  return {
    events: [{ id: 'ev1', org_id: 'org1', is_test: true }],
    btc_teams: [
      { id: 't1', event_id: 'ev1', name: 'Alpha' },
      { id: 't2', event_id: 'ev1', name: 'Beta' },
    ],
    btc_judges: [
      { id: 'j1', event_id: 'ev1', name: 'Jo' },
      { id: 'j2', event_id: 'ev1', name: 'Kim' },
      { id: 'j3', event_id: 'ev1', name: 'Lee' },
    ],
    btc_matches: [
      {
        id: 'm1',
        event_id: 'ev1',
        round,
        team1_id: 't1',
        team2_id: 't2',
        status: 'pending',
        updated_at: 'T0',
        team1_time_note: null,
        team2_time_note: null,
      },
    ],
    btc_match_judges: ['j1', 'j2', 'j3'].map((judge_id) => ({ match_id: 'm1', judge_id })),
    btc_cup_votes: [],
    btc_match_bonuses: [],
    processed_operations: [],
  };
}

const flush = async () => {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
};

// Every cup gets 3 tokens to team1 — the simplest "fully recorded, all to one side"
// fixture, matching the scoring.test.js 'all2'-style total (45 tokens, +5) but for team1.
function confirmedDb() {
  db.btc_matches[0] = { ...db.btc_matches[0], status: 'confirmed' };
  for (let cup = 1; cup <= 15; cup += 1) {
    db.btc_cup_votes.push({ match_id: 'm1', cup_number: cup, team1_tokens: 3 });
  }
}

describe('mountScoringScreen', () => {
  let root;

  beforeEach(() => {
    cache.clear();
    cacheSetFails = false;
    cacheClearFails = false;
    failLedger = false;
    beforeQueueRead = null;
    queue = [];
    flushOutcome = 'success';
    failSingle = false;
    db = baseDb();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mount = (extra = {}) =>
    mountScoringScreen(root, { matchId: 'm1', client: fakeClient(), ...extra });
  const cupRows = () => [...root.querySelectorAll('.btc-cup-row')];
  const tokenButtons = (cup) => [...cupRows()[cup - 1].querySelectorAll('.btc-token')];
  const tapCup = (cup, value) => tokenButtons(cup)[value].click();
  const pressedValue = (cup) => {
    const pressed = tokenButtons(cup).find((b) => b.getAttribute('aria-pressed') === 'true');
    return pressed ? Number(pressed.dataset.value) : null;
  };
  const team2Value = (cup) => cupRows()[cup - 1].querySelector('.btc-cup-team2-value').textContent;
  const feedback = () => root.querySelector('[data-region="feedback"]');
  const notice = () => root.querySelector('[data-region="notice"]');
  const saveNotice = () => root.querySelectorAll('.screen-feedback')[0];
  const confirmButton = () => root.querySelector('[data-focus-key="confirm-match"]');
  const byText = (text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  const setTime = (which, value) => {
    const input = root.querySelector(`[data-field="time-${which}"]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  // 2 tokens to team1, 1 to team2, for every cup of the round — the 'split' fixture
  // scoring.test.js and 014_btc_scoring.sql both pin (37/15 with fastest team1).
  async function fillAll(cups = 15) {
    for (let cup = 1; cup <= cups; cup += 1) tapCup(cup, 2);
    await flush();
  }

  it('renders the match, 15 cups for a preliminary round, and a 4-way token control per cup', async () => {
    await mount();
    expect(root.querySelector('h2').textContent).toBe('Alpha vs Beta');
    expect(root.textContent).toContain('Preliminary · 15 cups');
    expect(cupRows()).toHaveLength(15);
    expect(tokenButtons(1)).toHaveLength(4);
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
  });

  it('renders 20 cups for a knockout round', async () => {
    db = baseDb('final');
    await mount();
    expect(cupRows()).toHaveLength(20);
  });

  it('moves focus to the heading once loaded', async () => {
    await mount();
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('lists judges for the record, but nothing about them is interactive', async () => {
    await mount();
    expect(root.textContent).toContain('judges (record only): Jo, Kim, Lee');
    expect(root.querySelectorAll('button[data-judge]')).toHaveLength(0);
  });

  it('selecting a token value updates the pressed state, the auto team2 balance, and totals', async () => {
    await mount();
    expect(pressedValue(1)).toBeNull();
    expect(team2Value(1)).toBe('–');
    expect(tokenButtons(1)[0].getAttribute('aria-label')).toBe('Cup 1, 0 for Alpha');

    tapCup(1, 1);
    expect(pressedValue(1)).toBe(1);
    expect(team2Value(1)).toBe('2');
    // team2 has strictly more tokens on the only scored cup, so it gets the +5
    expect(root.textContent).toContain('Alpha: 1 points (1 tokens)');
    expect(root.textContent).toContain('Beta: 7 points (2 tokens)');

    tapCup(1, 3);
    expect(pressedValue(1)).toBe(3);
    expect(team2Value(1)).toBe('0');

    tapCup(1, 0);
    expect(pressedValue(1)).toBe(0);
    expect(team2Value(1)).toBe('3');
  });

  it('announces each tap in a live region that already exists, so a screen reader hears it', async () => {
    await mount();
    const announce = root.querySelector('.sr-only[aria-live]');
    expect(announce.textContent).toBe('');
    tapCup(1, 2);
    expect(announce.textContent).toBe('Cup 1: 2 for Alpha, 1 for Beta');
    tapCup(1, 0);
    expect(announce.textContent).toBe('Cup 1: 0 for Alpha, 3 for Beta');
  });

  it('updates in place: the tapped button is the SAME node afterwards, so scroll and focus never reset', async () => {
    await mount();
    const first = tokenButtons(1)[2];
    first.focus();
    first.click();
    expect(tokenButtons(1)[2]).toBe(first);
    expect(document.activeElement).toBe(first);
  });

  it('keeps Confirm disabled, with the missing count explained, until every cup has a score', async () => {
    await mount();
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('#btc-confirm-hint').textContent).toContain('15 cups still missing');
    expect(confirmButton().getAttribute('aria-describedby')).toBe('btc-confirm-hint');

    tapCup(1, 2);
    expect(root.querySelector('#btc-confirm-hint').textContent).toContain('14 cups still missing');

    await fillAll();
    expect(confirmButton().getAttribute('aria-disabled')).toBeNull();
    expect(root.querySelector('#btc-confirm-hint').hidden).toBe(true);
  });

  it('refuses an incomplete confirm, names the first missing cup, and can take the scorer there', async () => {
    await mount();
    tapCup(1, 2); // cup 1 scored, so the first gap is cup 2
    confirmButton().click();
    await flush();
    expect(queue).toHaveLength(0);
    expect(feedback().textContent).toBe('Every cup needs a score. First missing: cup 2.');
    const goto = byText('Go to first missing cup');
    expect(goto.hidden).toBe(false);
    goto.click();
    expect(document.activeElement).toBe(tokenButtons(2)[0]);
  });

  it('hides the go-to-missing button again once feedback changes', async () => {
    await mount();
    confirmButton().click();
    await flush();
    expect(byText('Go to first missing cup').hidden).toBe(false);
    await fillAll();
    confirmButton().click();
    await flush();
    expect(byText('Go to first missing cup').hidden).toBe(true);
  });

  it('only offers signature-beverage in knockout rounds', async () => {
    await mount();
    expect(root.querySelector('[data-field="signature-team1"]')).toBeNull();
    root.innerHTML = '';
    db = baseDb('semifinal');
    await mount();
    expect(root.querySelector('[data-field="signature-team1"]')).not.toBeNull();
    expect(root.querySelector('[data-field="signature-team2"]')).not.toBeNull();
  });

  it('applies fastest and per-team signature bonuses to the live totals', async () => {
    db = baseDb('final');
    await mount();
    root.querySelector('[data-field="fastest-team2"]').click();
    root.querySelector('[data-field="signature-team1"]').click();
    root.querySelector('[data-field="signature-team2"]').click();
    expect(root.textContent).toContain('Alpha: 2 points (0 tokens)');
    expect(root.textContent).toContain('Beta: 4 points (0 tokens)');
  });

  it('confirms: enqueues ONE operation carrying the full payload, then shows success and clears the draft', async () => {
    await mount();
    root.querySelector('[data-field="fastest-team1"]').click();
    setTime('team1', ' 8:42 ');
    await fillAll();

    confirmButton().click();
    await flush();

    expect(db.processed_operations).toHaveLength(1);
    const [{ id: operationId }] = db.processed_operations;
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(queue).toHaveLength(0);
    expect(root.querySelector('.screen-feedback[data-tone="success"]').textContent).toBe(
      'Match confirmed.',
    );
    expect(cache.get('btc-scoring-draft:m1')).toBeNull();
    expect(confirmButton().textContent).toBe('Re-confirm match');
    expect(document.activeElement).toBe(feedback());
    expect(notice().textContent).toBe('');
  });

  it('sends the full payload under the same operation id it saved into the draft beforehand', async () => {
    const { enqueueOperation } = await import('../../core/outbox.js');
    await mount();
    root.querySelector('[data-field="fastest-team1"]').click();
    setTime('team1', ' 8:42 ');
    await fillAll();
    flushOutcome = 'offline';
    confirmButton().click();
    await flush();

    const [type, payload] = enqueueOperation.mock.calls.at(-1);
    expect(type).toBe('confirm_btc_match');
    expect(payload.p_match_id).toBe('m1');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_expected_updated_at).toBe('T0');
    expect(payload.p_votes).toHaveLength(15);
    expect(payload.p_votes[0]).toEqual({ cup_number: 1, team1_tokens: 2 });
    expect(payload.p_fastest_team_id).toBe('t1');
    expect(payload.p_team1_time_note).toBe(' 8:42 ');
    // Saved BEFORE enqueuing: a reload can resolve exactly this operation.
    expect(cache.get('btc-scoring-draft:m1').confirmOpId).toBe(payload.p_operation_id);
    expect(cache.get('btc-scoring-draft:m1').baseUpdatedAt).toBe('T0');
  });

  it('never enqueues if the operation id cannot be saved on this device first', async () => {
    await mount();
    await fillAll();
    cacheSetFails = true;
    confirmButton().click();
    await flush();
    expect(queue).toHaveLength(0);
    expect(feedback().textContent).toMatch(/nothing was submitted/);
    expect(feedback().dataset.tone).toBe('error');
    expect(confirmButton().getAttribute('aria-disabled')).toBeNull();
    expect(saveNotice().textContent).toMatch(/could not be saved on this device/);
  });

  it('ignores a rapid double-click: only one operation is ever queued', async () => {
    await mount();
    await fillAll();
    flushOutcome = 'offline';
    confirmButton().click();
    confirmButton().click();
    await flush();
    expect(queue).toHaveLength(1);
  });

  it('still recognises success when the server double mutates the fetched row in place', async () => {
    // Regression for a bug found in a real browser: a fake that hands back live
    // references and mutates them produced a contradictory success/failure display.
    // Success is now decided by the ledger, not by comparing rows.
    const { flushOutbox } = await import('../../core/outbox.js');
    await mount();
    await fillAll();
    flushOutbox.mockImplementationOnce(async () => {
      applyQueuedOps();
      db.btc_matches[0].updated_at = 'T-mutated';
      return { processed: 1, stopped: false, permanentFailure: false };
    });
    confirmButton().click();
    await flush();
    expect(feedback().textContent).toBe('Match confirmed.');
    expect(feedback().dataset.tone).toBe('success');
  });

  it('decides success by the ledger for THIS operation, not by the match having changed', async () => {
    // Another writer confirms the match while this operation is still only queued: the
    // match row moves, but the ledger has no row for OUR operation id.
    flushOutcome = 'offline';
    await mount();
    await fillAll();
    beforeQueueRead = () => {
      db.btc_matches[0] = { ...db.btc_matches[0], status: 'confirmed', updated_at: 'T-other' };
    };
    confirmButton().click();
    await flush();
    expect(root.querySelector('.screen-feedback[data-tone="success"]')).toBeNull();
    expect(notice().textContent).toMatch(/waiting to sync/);
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('blocks cup taps while a confirm is in flight', async () => {
    await mount();
    await fillAll();
    const before = pressedValue(1);
    confirmButton().click();
    tapCup(1, 3);
    expect(pressedValue(1)).toBe(before);
    await flush();
  });

  describe('a confirmation the server refuses', () => {
    it('a version conflict locks editing to a discard-only state and keeps the draft', async () => {
      flushOutcome = 'conflict';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
      expect(notice().textContent).toMatch(/changed elsewhere/);
      expect(notice().textContent).not.toBe('');
      expect(byText('Discard my edits and reload').hidden).toBe(false);
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
      tapCup(1, 3); // locked: no change
      expect(pressedValue(1)).toBe(2);
      const saved = cache.get('btc-scoring-draft:m1');
      expect(saved).toBeTruthy();
      expect(saved.confirmOpId).toBeNull();
    });

    it('discarding clears the draft and reloads the latest, blank match', async () => {
      flushOutcome = 'conflict';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
      byText('Discard my edits and reload').click();
      await flush();
      expect(cache.get('btc-scoring-draft:m1')).toBeNull();
      expect(pressedValue(1)).toBeNull();
      expect(notice().textContent).toBe(
        'Your edits were discarded and the latest scores were loaded.',
      ); // says what happened
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true'); // blank: incomplete
    });

    it('a validation rejection shows its curated message and unlocks editing to fix it', async () => {
      flushOutcome = 'invalid';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
      expect(feedback().textContent).toBe('Could not confirm: 3 of 15 cups are missing a score.');
      expect(feedback().dataset.tone).toBe('error');
      expect(confirmButton().getAttribute('aria-disabled')).toBeNull();
      tapCup(1, 0);
      expect(pressedValue(1)).toBe(0);
      expect(cache.get('btc-scoring-draft:m1').confirmOpId).toBeNull();
    });
  });

  describe('a confirmation that is still waiting to sync', () => {
    async function submitOffline() {
      flushOutcome = 'offline';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
    }

    it('says so, locks every input, and offers to check the sync status', async () => {
      await submitOffline();
      expect(notice().textContent).toMatch(/saved on this device and waiting to sync/);
      expect(byText('Check sync status').hidden).toBe(false);
      expect(byText('Discard my edits and reload').hidden).toBe(true);
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
      expect(root.querySelector('.screen-feedback[data-tone="success"]')).toBeNull();
      tapCup(1, 3);
      expect(pressedValue(1)).toBe(2); // unchanged
      for (const control of root.querySelectorAll('[data-field]')) {
        expect(control.disabled).toBe(true);
      }
    });

    it('a locked bonus or time input reverts a change instead of accepting it', async () => {
      await submitOffline();
      const fastest = root.querySelector('[data-field="fastest-team2"]');
      fastest.disabled = false; // force the event past the native lock, as a script could
      fastest.checked = true;
      fastest.dispatchEvent(new Event('change'));
      expect(root.querySelector('[data-field="fastest-none"]').checked).toBe(true);
      expect(fastest.checked).toBe(false);
      const time = root.querySelector('[data-field="time-team1"]');
      time.value = 'sneaky';
      time.dispatchEvent(new Event('input'));
      expect(time.value).toBe('');
      expect(cache.get('btc-scoring-draft:m1').times.team1).toBe('');
    });

    it('a signature-beverage change is reverted while locked', async () => {
      db = baseDb('final');
      flushOutcome = 'offline';
      await mount();
      await fillAll(20);
      confirmButton().click();
      await flush();
      const box = root.querySelector('[data-field="signature-team1"]');
      box.disabled = false;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      expect(box.checked).toBe(false);
      expect(cache.get('btc-scoring-draft:m1').signature.team1).toBe(false);
    });

    it('Check sync status resolves it once the queue can flush, then unlocks', async () => {
      await submitOffline();
      flushOutcome = 'success';
      byText('Check sync status').click();
      await flush();
      expect(feedback().textContent).toBe('Match confirmed.');
      expect(notice().textContent).toBe('');
      expect(byText('Check sync status').hidden).toBe(true);
      expect(cache.get('btc-scoring-draft:m1')).toBeNull();
      expect(confirmButton().textContent).toBe('Re-confirm match');
    });

    it('Check sync status while still offline stays locked and says so', async () => {
      await submitOffline();
      byText('Check sync status').click();
      await flush();
      expect(notice().textContent).toMatch(/Still not synced/);
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
      expect(byText('Check sync status').getAttribute('aria-disabled')).toBeNull();
      // stays on the button that was pressed; the notice announces the result
      expect(document.activeElement).toBe(byText('Check sync status'));
    });

    it('Check sync status surfaces a conflict the queue meanwhile discovered', async () => {
      await submitOffline();
      flushOutcome = 'conflict';
      byText('Check sync status').click();
      await flush();
      expect(notice().textContent).toMatch(/changed elsewhere/);
      expect(byText('Discard my edits and reload').hidden).toBe(false);
    });

    it('a reload while it is still queued comes back locked, not editable', async () => {
      await submitOffline();
      root.innerHTML = '';
      await mount();
      expect(notice().textContent).toMatch(/waiting to sync/);
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
      expect(pressedValue(1)).toBe(2); // the saved scores are still there
    });

    it('a reload after it applied shows the confirmed record and drops the stale draft', async () => {
      await submitOffline();
      flushOutcome = 'success';
      applyQueuedOps(); // the outbox flushed in the background
      root.innerHTML = '';
      await mount();
      expect(cache.get('btc-scoring-draft:m1')).toBeNull();
      expect(notice().textContent).toBe('');
      expect(root.textContent).toContain('This match is confirmed');
    });

    it('a reload after it vanished from the queue unlocks with a "not applied" notice', async () => {
      await submitOffline();
      queue = []; // dropped by a permanent failure in another session
      root.innerHTML = '';
      await mount();
      expect(notice().textContent).toMatch(/was not applied/);
      expect(notice().textContent).not.toBe('');
      expect(pressedValue(1)).toBe(2); // scores kept
      expect(confirmButton().getAttribute('aria-disabled')).toBeNull();
      expect(cache.get('btc-scoring-draft:m1').confirmOpId).toBeNull();
    });
  });

  it('a draft built on an older version of the match is locked, never sent with the current one', async () => {
    cache.set('btc-scoring-draft:m1', {
      votes: { 1: 0 },
      fastest: null,
      signature: { team1: false, team2: false },
      times: { team1: '', team2: '' },
      baseUpdatedAt: 'T-OLD',
      confirmOpId: null,
    });
    await mount();
    expect(notice().textContent).toMatch(/changed elsewhere/);
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
    tapCup(2, 3);
    expect(pressedValue(2)).toBeNull();
    byText('Discard my edits and reload').click();
    await flush();
    expect(cache.get('btc-scoring-draft:m1')).toBeNull();
    expect(notice().textContent).toBe(
      'Your edits were discarded and the latest scores were loaded.',
    );
    expect(pressedValue(1)).toBeNull();
  });

  it('restores an in-progress edit saved on this device', async () => {
    cache.set('btc-scoring-draft:m1', {
      votes: { 1: 0 },
      fastest: null,
      signature: { team1: false, team2: false },
      times: { team1: '', team2: '' },
      baseUpdatedAt: 'T0',
    });
    await mount();
    expect(pressedValue(1)).toBe(0);
    expect(team2Value(1)).toBe('3');
    expect(notice().textContent).toBe('');
  });

  it('an in-progress edit wins over the recorded scores of a confirmed match', async () => {
    confirmedDb(); // every cup recorded as 3-0 for team1
    cache.set('btc-scoring-draft:m1', {
      votes: { 1: 0 },
      fastest: null,
      signature: { team1: false, team2: false },
      times: { team1: '', team2: '' },
      baseUpdatedAt: 'T0',
    });
    await mount();
    expect(pressedValue(1)).toBe(0); // the draft, not the recorded '3'
    expect(pressedValue(2)).toBeNull(); // and NOT merged with the recorded scores
  });

  it('persists the draft after each tap, starting from the match version it was built on', async () => {
    await mount();
    tapCup(1, 2);
    await flush();
    const saved = cache.get('btc-scoring-draft:m1');
    expect(saved.votes[1]).toBe(2);
    expect(saved.baseUpdatedAt).toBe('T0');
  });

  describe('when progress cannot be saved on this device', () => {
    it('warns in a live region that was there all along, and keeps warning', async () => {
      cacheSetFails = true;
      await mount();
      const live = saveNotice();
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.textContent).toBe('');
      tapCup(1, 2);
      await flush();
      expect(saveNotice()).toBe(live);
      expect(live.textContent).toMatch(/could not be saved on this device/);
      // A later success does not clear it: the earlier scores may still be unsaved.
      cacheSetFails = false;
      tapCup(2, 1);
      await flush();
      expect(live.textContent).toMatch(/could not be saved on this device/);
    });
  });

  it('starts a confirmed match from its recorded scores and offers Re-confirm', async () => {
    db.btc_matches[0] = { ...db.btc_matches[0], status: 'confirmed', team1_time_note: '8:42' };
    for (let cup = 1; cup <= 15; cup += 1) {
      db.btc_cup_votes.push({ match_id: 'm1', cup_number: cup, team1_tokens: 2 });
    }
    db.btc_match_bonuses = [
      {
        match_id: 'm1',
        fastest_team_id: 't1',
        team1_signature_beverage: false,
        team2_signature_beverage: false,
      },
    ];
    await mount();
    expect(root.textContent).toContain('This match is confirmed');
    expect(confirmButton().textContent).toBe('Re-confirm match');
    expect(confirmButton().getAttribute('aria-disabled')).toBeNull();
    expect(root.textContent).toContain('Alpha: 37 points (30 tokens)');
    expect(root.querySelector('[data-field="time-team1"]').value).toBe('8:42');
  });

  it('recognises a successful RE-confirm even though status was already confirmed', async () => {
    confirmedDb();
    await mount();
    tapCup(1, 2); // edit one cup
    await flush();
    confirmButton().click();
    await flush();
    expect(root.querySelector('.screen-feedback[data-tone="success"]').textContent).toBe(
      'Match confirmed.',
    );
    expect(db.processed_operations).toHaveLength(1);
  });

  it('does not report success for a re-confirm that never landed', async () => {
    confirmedDb();
    flushOutcome = 'offline';
    await mount();
    tapCup(1, 2);
    await flush();
    confirmButton().click();
    await flush();
    expect(root.querySelector('.screen-feedback[data-tone="success"]')).toBeNull();
    expect(notice().textContent).toMatch(/waiting to sync/);
  });

  it('confirmed, but the match cannot be re-read: says so and asks for a reload before more edits', async () => {
    await mount();
    await fillAll();
    const { flushOutbox } = await import('../../core/outbox.js');
    flushOutbox.mockImplementationOnce(async () => {
      applyQueuedOps();
      failSingle = true; // the follow-up read of the match fails
      return { processed: 1, stopped: false, permanentFailure: false };
    });
    confirmButton().click();
    await flush();
    expect(feedback().textContent).toBe('Match confirmed.');
    expect(notice().textContent).toMatch(/Reload this page before editing/);
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
    tapCup(1, 3);
    expect(pressedValue(1)).toBe(2);
  });

  describe('focus after a confirm attempt', () => {
    it('goes to the notice, not an empty region, when the confirmation is refused as stale', async () => {
      flushOutcome = 'conflict';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
      expect(document.activeElement).toBe(notice());
      expect(notice().textContent).not.toBe('');
    });

    it('goes to the notice when the confirmation is left waiting to sync', async () => {
      flushOutcome = 'offline';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
      expect(document.activeElement).toBe(notice());
    });
  });

  describe("a confirmation dropped by someone else's flush", () => {
    async function submitOffline() {
      flushOutcome = 'offline';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
    }

    it("is noticed by Check sync status even though this screen's own flush reported nothing", async () => {
      await submitOffline();
      queue = []; // the reconnect flush already dropped it
      byText('Check sync status').click();
      await flush();
      expect(feedback().textContent).toMatch(/was not applied/);
      expect(feedback().dataset.tone).toBe('error');
      expect(confirmButton().getAttribute('aria-disabled')).toBeNull(); // unlocked
      expect(cache.get('btc-scoring-draft:m1').confirmOpId).toBeNull();
    });

    it('and is treated as a conflict when the match version moved meanwhile', async () => {
      await submitOffline();
      queue = [];
      db.btc_matches[0] = { ...db.btc_matches[0], updated_at: 'T-elsewhere' };
      byText('Check sync status').click();
      await flush();
      expect(notice().textContent).toMatch(/changed elsewhere/);
      expect(byText('Discard my edits and reload').hidden).toBe(false);
    });

    it('is NOT treated as dropped when the ledger cannot be read: "cannot tell" stays pending', async () => {
      await submitOffline();
      queue = [];
      failLedger = true;
      byText('Check sync status').click();
      await flush();
      expect(notice().textContent).toMatch(/waiting to sync/);
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
      expect(feedback().textContent).toBe('');
    });

    it('is NOT treated as dropped when the queue cannot be read either', async () => {
      await submitOffline();
      const { listPendingOperations } = await import('../../core/outbox.js');
      listPendingOperations.mockRejectedValueOnce(new Error('idb down'));
      byText('Check sync status').click();
      await flush();
      expect(notice().textContent).toMatch(/waiting to sync/);
      expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
    });
  });

  it('a second confirm in the same session is built on the version the first one produced', async () => {
    await mount();
    await fillAll();
    confirmButton().click();
    await flush();
    expect(feedback().textContent).toBe('Match confirmed.');
    const { enqueueOperation } = await import('../../core/outbox.js');
    expect(enqueueOperation.mock.calls.at(-1)[1].p_expected_updated_at).toBe('T0');

    tapCup(1, 2); // edit one cup (clears the old success message too)
    expect(feedback().textContent).toBe('');
    await flush();
    confirmButton().click();
    await flush();
    // 'T1' is what the first confirm left on the match; the fake server refuses anything else.
    expect(enqueueOperation.mock.calls.at(-1)[1].p_expected_updated_at).toBe('T1');
    expect(feedback().textContent).toBe('Match confirmed.');
    expect(db.processed_operations).toHaveLength(2);
  });

  it('an out-of-date message is cleared as soon as the scorer edits a cup', async () => {
    await mount();
    confirmButton().click();
    await flush();
    expect(byText('Go to first missing cup').hidden).toBe(false);
    tapCup(1, 2);
    expect(feedback().textContent).toBe('');
    expect(byText('Go to first missing cup').hidden).toBe(true);
  });

  describe('local storage trouble while resolving or tidying', () => {
    it('confirmed, but the draft cannot be cleared: says so, and the confirmation still stands', async () => {
      await mount();
      await fillAll();
      cacheClearFails = true;
      confirmButton().click();
      await flush();
      expect(feedback().textContent).toBe('Match confirmed.');
      expect(saveNotice().textContent).toMatch(/could not be saved on this device/);
    });

    it('a reload that cannot tidy its draft still loads, and warns instead of showing Retry', async () => {
      flushOutcome = 'offline';
      await mount();
      await fillAll();
      confirmButton().click();
      await flush();
      queue = []; // dropped elsewhere; the reload will try to rewrite the draft
      root.innerHTML = '';
      cacheSetFails = true;
      await mount();
      expect(cupRows()).toHaveLength(15);
      expect(notice().textContent).toMatch(/was not applied/);
      expect(saveNotice().textContent).toMatch(/could not be saved on this device/);
    });

    it('discarding when the draft cannot be cleared still reloads, and warns', async () => {
      cache.set('btc-scoring-draft:m1', {
        votes: { 1: 0 },
        fastest: null,
        signature: { team1: false, team2: false },
        times: { team1: '', team2: '' },
        baseUpdatedAt: 'T-OLD',
        confirmOpId: null,
      });
      await mount();
      cacheClearFails = true;
      byText('Discard my edits and reload').click();
      await flush();
      expect(saveNotice().textContent).toMatch(/could not be saved on this device/);
    });
  });

  it('will not offer scoring for a match without exactly 3 judges', async () => {
    db.btc_match_judges = db.btc_match_judges.slice(0, 2);
    await mount();
    expect(root.textContent).toContain('needs exactly 3');
    expect(cupRows()).toHaveLength(0);
  });

  it('shows a load error with Retry, and Retry really reloads', async () => {
    failSingle = true;
    await mount();
    expect(root.textContent).toContain('network down');
    failSingle = false;
    byText('Retry').click();
    await flush();
    expect(cupRows()).toHaveLength(15);
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('gives a slow load its own message, not the raw error', async () => {
    vi.useFakeTimers();
    const mounting = mountScoringScreen(root, {
      matchId: 'm1',
      client: fakeClient({ hang: true }),
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
    await mounting;
    expect(root.textContent).toContain('taking longer than expected');
    expect(byText('Retry')).toBeTruthy();
  });

  it('writes nothing once its signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await mount({ signal: controller.signal });
    expect(root.children).toHaveLength(0);
  });
});
