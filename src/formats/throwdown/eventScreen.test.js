// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { _clearAllForTests } from '../../core/db.js';
import { _resetOutboxOwnerForTests } from '../../core/outbox.js';
import { mountThrowdownEventScreen } from './eventScreen.js';
import { parsePhone, phoneErrorMessage } from '../../core/phone.js';

const EVENT = { id: 'ev', org_id: 'org', format: 'throwdown', name: 'Rehearsal', is_test: true };

// Waits until `check` holds (polled), so a test does not depend on how fast a busy machine runs a reload.
async function waitUntil(check, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}
const liveText = (root) =>
  [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');

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

  it('offers demo people on a test event before the draw, and never on a real event', async () => {
    const test = await mount({ event_entries: entries });
    expect(test.textContent).toContain('Add demo people');
    document.body.innerHTML = '';
    const real = await mount({ event_entries: entries }, { ...EVENT, is_test: false });
    expect(real.textContent).not.toContain('Add demo people');
    document.body.innerHTML = '';
    const drawn = await mount(started);
    expect(drawn.textContent).not.toContain('Add demo people');
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

  describe('undoing a confirmed result', () => {
    const decided = {
      ...started,
      td_matches: [
        { ...started.td_matches[0], result_kind: 'votes', confirmed_at: '2026-11-27T10:00:00Z' },
      ],
      td_votes: [
        { id: 'v1', match_id: 'm1', slot_id: 's1', created_at: '1' },
        { id: 'v2', match_id: 'm1', slot_id: 's1', created_at: '2' },
        { id: 'v3', match_id: 'm1', slot_id: 's2', created_at: '3' },
      ],
    };
    const byText = (root, text) =>
      [...root.querySelectorAll('button')].find((b) => b.textContent === text);

    // the flush really runs this handler for a queued undo, so `sent` is what reached the database
    async function mountRecording(tables) {
      const sent = [];
      const client = clientWith({ events: [EVENT], ...tables });
      const root = document.createElement('div');
      document.body.append(root);
      await mountThrowdownEventScreen(root, {
        eventId: 'ev',
        client,
        handlers: { td_reopen_match: async (payload) => sent.push(payload) },
      });
      return { root, sent };
    }
    const settle = () => new Promise((r) => setTimeout(r, 50));

    it('asks first, says what is kept, and sends the undo with the winner the organiser saw', async () => {
      const { root, sent } = await mountRecording(decided);
      byText(root, 'Undo result').click();
      await settle();
      const question = root.querySelector('.td-reopen-q');
      expect(question.textContent).toBe('Undo Ana’s win?');
      expect(document.activeElement).toBe(question);
      const yes = byText(root, 'Yes, undo');
      const detail = root.querySelector(`#${yes.getAttribute('aria-describedby')}`);
      expect(detail.textContent).toContain('votes kept');
      expect(detail.textContent).toContain('publish them again');
      expect(sent).toHaveLength(0);

      yes.click();
      await waitUntil(() => sent.length > 0);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        p_org_id: 'org',
        p_match_id: 'm1',
        p_expected_winner_slot_id: 's1',
      });
    });

    it('Keep result closes the question and sends nothing', async () => {
      const { root, sent } = await mountRecording(decided);
      byText(root, 'Undo result').click();
      byText(root, 'Keep result').click();
      await settle();
      expect(root.querySelector('.td-reopen')).toBeNull();
      expect(byText(root, 'Undo result')).toBeTruthy();
      expect(sent).toHaveLength(0);
      const { listAllOperations } = await import('../../core/outbox.js');
      expect((await listAllOperations()).some((op) => op.type === 'td_reopen_match')).toBe(false);
    });

    it('Keep result puts focus back on that match’s Undo result button', async () => {
      const root = await mount(decided);
      byText(root, 'Undo result').click();
      byText(root, 'Keep result').click();
      expect(document.activeElement).toBe(byText(root, 'Undo result'));
    });

    it('a refused undo whose button is gone (another device started the Final) leaves focus on the Bracket heading', async () => {
      const tables = {
        td_rounds: [
          { id: 'r1', position: 1, kind: 'pair', phase: 'main' },
          { id: 'r2', position: 2, kind: 'pair', phase: 'main' },
        ],
        td_matches: [
          {
            id: 'm1',
            round_id: 'r1',
            position: 1,
            result_kind: 'walkover',
            confirmed_at: 't',
            walkover_winner_position: 1,
          },
          {
            id: 'm2',
            round_id: 'r1',
            position: 2,
            result_kind: 'walkover',
            confirmed_at: 't',
            walkover_winner_position: 1,
          },
          {
            id: 'm3',
            round_id: 'r2',
            position: 1,
            result_kind: null,
            confirmed_at: null,
            walkover_winner_position: null,
          },
        ],
        td_slots: [
          { id: 'a', match_id: 'm1', position: 1, entry_id: 'eAna' },
          { id: 'b', match_id: 'm1', position: 2, entry_id: 'eBima' },
          { id: 'c', match_id: 'm2', position: 1, entry_id: 'eCitra' },
          { id: 'd', match_id: 'm2', position: 2, entry_id: 'eDani' },
          { id: 'e', match_id: 'm3', position: 1, entry_id: 'eAna' },
          { id: 'f', match_id: 'm3', position: 2, entry_id: 'eCitra' },
        ],
        td_votes: [],
        td_settings: [{ event_id: 'ev', judge_count: 3, third_place: false, modules: {} }],
        event_entries: ['Ana', 'Bima', 'Citra', 'Dani'].map((n) => ({
          id: `e${n}`,
          display_name: n,
          withdrawn: false,
        })),
      };
      const client = clientWith({ events: [EVENT], ...tables });
      client.rpc = async (name) => {
        if (name !== 'td_reopen_match') return { error: null, status: 200 };
        // meanwhile a judge on another device tapped in the Final: the database refuses, and the refresh shows that tap
        tables.td_votes.push({ id: 'v', match_id: 'm3', slot_id: 'e', created_at: '1' });
        return {
          error: { code: 'P0001', message: 'started', hint: 'td_next_round_started' },
          status: 400,
        };
      };
      const { dataHandlers } = await import('./data.js');
      const root = document.createElement('div');
      document.body.append(root);
      await mountThrowdownEventScreen(root, {
        eventId: 'ev',
        client,
        handlers: dataHandlers(client),
      });
      root.querySelector('[aria-label^="Undo result: Semi-finals, Ana"]').click();
      byText(root, 'Yes, undo').click();
      await waitUntil(() => document.activeElement?.id === 'td-bracket-h');
      await new Promise((r) => setTimeout(r, 200));
      expect(root.querySelector('#td-reopen-btn-m1')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('#td-bracket-h'));
      const live = [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');
      expect(live).toContain('The next round has already started');
    });

    it('...also when a reload was already running as the undo was refused', async () => {
      const tables = {
        td_rounds: [
          { id: 'r1', position: 1, kind: 'pair', phase: 'main' },
          { id: 'r2', position: 2, kind: 'pair', phase: 'main' },
        ],
        td_matches: [
          {
            id: 'm1',
            round_id: 'r1',
            position: 1,
            result_kind: 'walkover',
            confirmed_at: 't',
            walkover_winner_position: 1,
          },
          {
            id: 'm2',
            round_id: 'r1',
            position: 2,
            result_kind: 'walkover',
            confirmed_at: 't',
            walkover_winner_position: 1,
          },
          {
            id: 'm3',
            round_id: 'r2',
            position: 1,
            result_kind: null,
            confirmed_at: null,
            walkover_winner_position: null,
          },
        ],
        td_slots: [
          { id: 'a', match_id: 'm1', position: 1, entry_id: 'eAna' },
          { id: 'b', match_id: 'm1', position: 2, entry_id: 'eBima' },
          { id: 'c', match_id: 'm2', position: 1, entry_id: 'eCitra' },
          { id: 'd', match_id: 'm2', position: 2, entry_id: 'eDani' },
          { id: 'e', match_id: 'm3', position: 1, entry_id: 'eAna' },
          { id: 'f', match_id: 'm3', position: 2, entry_id: 'eCitra' },
        ],
        td_votes: [],
        td_settings: [{ event_id: 'ev', judge_count: 3, third_place: false, modules: {} }],
        event_entries: ['Ana', 'Bima', 'Citra', 'Dani'].map((n) => ({
          id: `e${n}`,
          display_name: n,
          withdrawn: false,
        })),
      };
      const base = clientWith({ events: [EVENT], ...tables });
      let slow = false;
      // while `slow`, every read waits a little: a reload started by 'online' is still running when Yes, undo is tapped
      const client = {
        from(name) {
          const q = base.from(name);
          if (!slow) return q;
          const then = q.then;
          q.then = (res, rej) => new Promise((r) => setTimeout(r, 300)).then(() => then(res, rej));
          return q;
        },
        rpc: null,
      };
      client.rpc = async (name) => {
        if (name !== 'td_reopen_match') return { error: null, status: 200 };
        // meanwhile a judge on another device tapped in the Final: the database refuses, and the refresh shows that tap
        tables.td_votes.push({ id: 'v', match_id: 'm3', slot_id: 'e', created_at: '1' });
        return {
          error: { code: 'P0001', message: 'started', hint: 'td_next_round_started' },
          status: 400,
        };
      };
      const { dataHandlers } = await import('./data.js');
      const root = document.createElement('div');
      document.body.append(root);
      await mountThrowdownEventScreen(root, {
        eventId: 'ev',
        client,
        handlers: dataHandlers(client),
      });
      root.querySelector('[aria-label^="Undo result: Semi-finals, Ana"]').click();
      slow = true;
      window.dispatchEvent(new Event('online'));
      byText(root, 'Yes, undo').click();
      // wait for the focus to land, then longer than one slow reload, so a later re-render cannot have taken it away
      await waitUntil(() => document.activeElement?.id === 'td-bracket-h', 8000);
      await new Promise((r) => setTimeout(r, 800));
      expect(root.querySelector('#td-reopen-btn-m1')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('#td-bracket-h'));
      const live = [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');
      expect(live).toContain('The next round has already started');
    }, 15000);

    it('while a semi-final’s undo waits to sync, the Final it will remove cannot be played', async () => {
      // two semi-finals decided, the Final made and open; then the organiser's undo of semi-final 1 is queued (offline)
      const semis = {
        td_rounds: [
          { id: 'r1', position: 1, kind: 'pair', phase: 'main' },
          { id: 'r2', position: 2, kind: 'pair', phase: 'main' },
        ],
        td_matches: [
          {
            id: 'm1',
            round_id: 'r1',
            position: 1,
            result_kind: 'walkover',
            confirmed_at: 't',
            walkover_winner_position: 1,
          },
          {
            id: 'm2',
            round_id: 'r1',
            position: 2,
            result_kind: 'walkover',
            confirmed_at: 't',
            walkover_winner_position: 1,
          },
          {
            id: 'm3',
            round_id: 'r2',
            position: 1,
            result_kind: null,
            confirmed_at: null,
            walkover_winner_position: null,
          },
        ],
        td_slots: [
          { id: 'a', match_id: 'm1', position: 1, entry_id: 'eAna' },
          { id: 'b', match_id: 'm1', position: 2, entry_id: 'eBima' },
          { id: 'c', match_id: 'm2', position: 1, entry_id: 'eCitra' },
          { id: 'd', match_id: 'm2', position: 2, entry_id: 'eDani' },
          { id: 'e', match_id: 'm3', position: 1, entry_id: 'eAna' },
          { id: 'f', match_id: 'm3', position: 2, entry_id: 'eCitra' },
        ],
        td_settings: [{ event_id: 'ev', judge_count: 3, third_place: false, modules: {} }],
        event_entries: ['Ana', 'Bima', 'Citra', 'Dani'].map((n) => ({
          id: `e${n}`,
          display_name: n,
          withdrawn: false,
        })),
      };
      let root = await mount(semis);
      expect(root.querySelectorAll('article.td-match')).toHaveLength(1);

      const { enqueueOperation } = await import('../../core/outbox.js');
      await enqueueOperation('td_reopen_match', {
        p_operation_id: 'r',
        p_org_id: 'org',
        p_match_id: 'm1',
      });
      document.body.innerHTML = '';
      root = await mount(semis);
      expect(root.querySelectorAll('article.td-match')).toHaveLength(0);
      expect(root.querySelectorAll('.td-vote')).toHaveLength(0);
      expect(root.textContent).toContain('Removed when the undo syncs');
      expect(root.textContent).toContain('Undo waiting to sync.');
    });

    it('offers no undo on an open match', async () => {
      const root = await mount(started);
      expect(byText(root, 'Undo result')).toBeUndefined();
    });

    it('says an undo is waiting to sync instead of offering it twice', async () => {
      const { enqueueOperation } = await import('../../core/outbox.js');
      await enqueueOperation('td_reopen_match', {
        p_operation_id: 'r',
        p_org_id: 'org',
        p_match_id: 'm1',
      });
      const root = await mount(decided);
      expect(byText(root, 'Undo result')).toBeUndefined();
      expect(root.textContent).toContain('Undo waiting to sync.');
    });
  });

  describe('losing the connection mid-event', () => {
    // The same read-only client, but every read and write fails while `net.down` is true (a venue's wifi dropping).
    function flakyClient(net) {
      const base = clientWith({ events: [EVENT], ...started });
      const offline = () => Promise.reject(new TypeError('Failed to fetch'));
      return {
        from(name) {
          if (!net.down) return base.from(name);
          const q = {
            select: () => q,
            eq: () => q,
            order: () => q,
            range: () => q,
            single: offline,
            maybeSingle: offline,
            then: (resolve, reject) => offline().then(resolve, reject),
          };
          return q;
        },
        rpc: (...args) => (net.down ? offline() : base.rpc(...args)),
      };
    }

    it('keeps the match on screen after a tap, counts the tap as waiting, and drops the No connection line when back online', async () => {
      const net = { down: false };
      const root = document.createElement('div');
      document.body.append(root);
      await mountThrowdownEventScreen(root, {
        eventId: 'ev',
        client: flakyClient(net),
        handlers: {},
      });
      expect(root.querySelectorAll('.td-vote')).toHaveLength(2);

      net.down = true;
      root.querySelector('.td-vote').click();
      await waitUntil(() => liveText(root).includes('No connection'));

      // not the full-screen load error with only Retry: the match, its Vote buttons and the waiting tap are all there
      expect(root.querySelectorAll('.td-vote')).toHaveLength(2);
      expect(root.textContent).toContain('1 waiting to sync');
      const live = [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');
      expect(live).toContain('No connection. Showing the last loaded screen.');

      net.down = false;
      window.dispatchEvent(new Event('online'));
      await waitUntil(() => !liveText(root).includes('No connection'));
      const after = [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');
      expect(after).not.toContain('No connection');
    });

    it('says a failure that is not the connection in its own words, keeping the screen', async () => {
      const base = clientWith({ events: [EVENT], ...started });
      let expired = false;
      const client = {
        from(name) {
          if (!expired) return base.from(name);
          const fail = () =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST303', message: 'JWT expired', hint: null },
            });
          const q = {
            select: () => q,
            eq: () => q,
            order: () => q,
            range: () => q,
            single: fail,
            maybeSingle: fail,
            then: (r) => fail().then(r),
          };
          return q;
        },
        rpc: base.rpc,
      };
      const root = document.createElement('div');
      document.body.append(root);
      await mountThrowdownEventScreen(root, { eventId: 'ev', client, handlers: {} });
      expired = true;
      window.dispatchEvent(new Event('online'));
      await waitUntil(() => liveText(root).trim() !== '');
      expect(root.querySelectorAll('.td-vote')).toHaveLength(2);
      const live = [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');
      expect(live).not.toContain('No connection');
      expect(live.trim()).not.toBe('');
    });

    it('still shows the load error with Retry when the very first load fails', async () => {
      const root = document.createElement('div');
      document.body.append(root);
      await mountThrowdownEventScreen(root, {
        eventId: 'ev',
        client: flakyClient({ down: true }),
        handlers: {},
      });
      expect(root.querySelectorAll('.td-vote')).toHaveLength(0);
      expect([...root.querySelectorAll('button')].map((b) => b.textContent)).toContain('Retry');
    });
  });

  it('before the draw offers competitors, setup and the draw, and no module controls', async () => {
    const root = await mount({ event_entries: entries });
    const headings = [...root.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Competitors (2)', 'Demo people', 'Setup', 'What will happen', 'Draw']);
    expect(root.textContent).toContain('Setup is locked as soon as Round 1 starts.');
    expect(root.textContent).not.toMatch(/module/i);
  });

  it('shows how the bracket will play out before the draw, and nothing once it has started', async () => {
    const before = await mount({ event_entries: entries });
    expect(before.querySelector('#td-preview-h')).not.toBeNull();
    expect(before.textContent).toContain('With 2 brewers: 1 round, 1 match, no byes.');
    const after = await mount(started);
    expect(after.querySelector('#td-preview-h')).toBeNull();
  });

  it('the card follows the setup: ticking 3rd place off is reflected at once', async () => {
    const root = await mount({ event_entries: entries });
    expect(root.textContent).toContain(
      'With 2 brewers: 1 round, 1 match, no byes. No 3rd place match.',
    );
    const box = root.querySelector('[data-focus-key="td-third"]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(root.textContent).toContain('3rd place is off.');
  });

  it('opens the plan from the card and plans for a different brewer count without saving it', async () => {
    const root = await mount({ event_entries: entries });
    const open = root.querySelector('[data-focus-key="td-plan-toggle"]');
    expect(open.getAttribute('aria-expanded')).toBe('false');
    open.click();
    const count = root.querySelector('[data-focus-key="td-plan-count"]');
    expect(count.value).toBe('2');
    count.value = '21';
    count.dispatchEvent(new Event('change'));
    expect(root.textContent).toContain('With 21 brewers: 5 rounds, 20 matches, 3 byes.');
    expect(root.textContent).toContain('No 3rd place match');
    // the roster and the setup are untouched
    expect(root.textContent).toContain('Competitors (2)');
    expect(root.querySelector('[data-focus-key="td-judges"]').value).toBe('3');
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

  describe('the judge cap on vote taps', () => {
    const vote = (id, slot) => ({ id, match_id: 'm1', slot_id: slot, created_at: id });
    const panel = (judges, slots) => ({
      ...started,
      td_settings: [{ event_id: 'ev', judge_count: judges, third_place: true, modules: {} }],
      td_votes: slots.map((slot, i) => vote(`v${i}`, slot)),
    });
    const voteOff = (root) =>
      [...root.querySelectorAll('.td-vote')].map((b) => b.getAttribute('aria-disabled') === 'true');
    const undoOn = (root) =>
      [...root.querySelectorAll('button')]
        .filter((b) => b.textContent === 'Undo')
        .map((b) => b.getAttribute('aria-disabled') !== 'true');

    it('keeps Vote open while judges are still voting', async () => {
      const root = await mount(panel(3, ['s1', 's2']));
      expect(voteOff(root)).toEqual([false, false]);
      expect(root.textContent).toContain('The votes are level. Take another vote');
    });

    it('keeps Confirm off until every judge has voted, even with a clear leader (1 of 3 was recorded 1-0)', async () => {
      const confirmOff = (root) =>
        [...root.querySelectorAll('button')]
          .filter((b) => /^Confirm/.test(b.textContent))
          .map((b) => b.getAttribute('aria-disabled') === 'true');
      let root = await mount(panel(3, ['s1']));
      expect(confirmOff(root)).toEqual([true]);
      expect(root.textContent).toContain(
        '1 of 3 votes in. Confirm opens when every judge has voted.',
      );
      root = await mount(panel(3, ['s1', 's1', 's2']));
      expect(confirmOff(root)).toEqual([false]);
    });

    it('stops Vote once every judge of an odd panel has voted, and says so; Undo stays on', async () => {
      const root = await mount(panel(3, ['s1', 's1', 's2']));
      expect(voteOff(root)).toEqual([true, true]);
      expect(root.textContent).toContain('3 of 3 votes in. Every judge has voted.');
      expect(undoOn(root)).toEqual([true, true]);
    });

    it('opens exactly one tie-break vote when an even panel is level', async () => {
      let root = await mount(panel(2, ['s1', 's2']));
      expect(voteOff(root)).toEqual([false, false]);
      expect(root.textContent).toContain('The tie-break judge casts one more vote.');

      document.body.innerHTML = '';
      root = await mount(panel(2, ['s1', 's2', 's1']));
      expect(voteOff(root)).toEqual([true, true]);
      expect(root.textContent).toContain('2 of 2 votes in, plus the tie-break vote.');
    });

    it('closes an even panel that is not level (2-0 takes no tie-break vote)', async () => {
      const root = await mount(panel(2, ['s1', 's1']));
      expect(voteOff(root)).toEqual([true, true]);
      expect(root.textContent).toContain('2 of 2 votes in. Every judge has voted.');
    });

    it('names more votes than judges as such, never as a tie-break or a call for another vote', async () => {
      let root = await mount(panel(2, ['s1', 's2', 's1', 's2']));
      expect(voteOff(root)).toEqual([true, true]);
      expect(root.textContent).toContain('More votes than judges (4 for 2)');
      expect(root.textContent).not.toContain('Take another vote');

      document.body.innerHTML = '';
      root = await mount(panel(3, ['s1', 's1', 's1', 's2']));
      expect(voteOff(root)).toEqual([true, true]);
      expect(root.textContent).toContain('More votes than judges (4 for 3)');
      expect(root.textContent).not.toMatch(/tie-break/);
    });

    it('points each Vote button at the note that says why it is off', async () => {
      const root = await mount(panel(3, ['s1', 's1', 's2']));
      const note = root.querySelector('.td-match .td-note');
      expect(note.id).toBeTruthy();
      for (const b of root.querySelectorAll('.td-vote')) {
        expect(b.getAttribute('aria-describedby')).toBe(note.id);
      }
      expect(note.textContent).toContain('Every judge has voted.');
    });

    it('says, with the tap that fills the panel, that every judge has voted', async () => {
      const root = await mount(panel(3, ['s1', 's2']));
      root.querySelector('.td-vote').click();
      await new Promise((r) => setTimeout(r, 50));
      const live = [...root.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ');
      expect(live).toContain('Ana: 2 votes. Every judge has voted.');
    });

    it('counts taps still waiting to sync toward the cap', async () => {
      const { enqueueOperation } = await import('../../core/outbox.js');
      await enqueueOperation('td_cast_vote', {
        p_operation_id: 'q1',
        p_org_id: 'org',
        p_match_id: 'm1',
        p_slot_id: 's1',
      });
      let root = await mount(panel(2, ['s1']));
      expect(root.textContent).toContain('1 waiting to sync');
      expect(voteOff(root)).toEqual([true, true]);

      // a queued tap past the cap (a quick double tap on a 3-judge panel at 2-0) is shown as a tap that will be
      // refused, never as the tie-break vote an odd panel cannot have
      await enqueueOperation('td_cast_vote', {
        p_operation_id: 'q2',
        p_org_id: 'org',
        p_match_id: 'm1',
        p_slot_id: 's2',
      });
      document.body.innerHTML = '';
      root = await mount(panel(3, ['s1', 's1']));
      expect(root.textContent).toContain('More taps than judges (4 for 3)');
      expect(root.textContent).toContain('will be refused when they sync');
      expect(root.textContent).not.toMatch(/tie-break/);
    });
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
    // each blank line is marked AND explained under its own box, not only by the sheet-level error
    for (const i of inputs) {
      expect(i.getAttribute('aria-invalid')).toBe('true');
      expect(i.closest('.td-sheet-line').querySelector('.td-points-problem').textContent).toMatch(
        /^Enter a whole number from 0 to \d+\.$/,
      );
    }
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

  it('shows each line\'s range inside its box as "/ max", never as a placeholder, and errors in Petrol\'s style', async () => {
    const root = await mount(scoring());
    root.querySelector('.td-grid-btn').click();
    const input = root.querySelector('.td-points');
    const suffix = input.parentElement.querySelector('.td-points-suffix');
    const max = Number(suffix.textContent.replace('/ ', ''));
    expect(suffix.textContent).toMatch(/^\/ \d+$/);
    expect(suffix.getAttribute('aria-hidden')).toBe('true');
    // the range still reaches a screen reader, through the input's own name
    expect(input.getAttribute('aria-label')).toContain(`0 to ${max}`);
    expect(input.hasAttribute('placeholder')).toBe(false);
    expect(root.querySelector('.td-points-max')).toBeNull();
    // an out-of-range value: the line under the box is Petrol's field error (its own "!" mark), not plain text
    input.value = String(max + 1);
    input.dispatchEvent(new Event('input'));
    const problem = input.closest('.td-sheet-line').querySelector('.td-points-problem');
    expect(problem.classList.contains('form-field-error')).toBe(true);
    expect(problem.textContent).toBe(`Enter a whole number from 0 to ${max}.`);
    expect(root.querySelector('.td-sheet-error').classList.contains('form-field-error')).toBe(true);
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
      const inFilters = {};
      let inserted = null;
      const rows = () =>
        (tables[name] ?? []).filter(
          (row) =>
            Object.entries(filters).every(([k, v]) => row[k] === v) &&
            Object.entries(inFilters).every(([k, v]) => v.includes(row[k])),
        );
      const q = {
        select: () => q,
        eq: (k, v) => {
          if (name === 'people' || name === 'event_entries') filters[k] = v;
          return q;
        },
        in: (k, values) => {
          inFilters[k] = values;
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
      // a save that never answers, or is refused, to look at the edit form while busy or refused
      if (tables.hangRpc?.includes(fn)) return new Promise(() => {});
      if (tables.rpcErrors?.[fn]) return { error: tables.rpcErrors[fn], status: 400 };
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

// ---------- editing a competitor ----------
const ANA_PERSON = {
  id: 'p1',
  org_id: 'org',
  phone: '+6737123456',
  email: 'ana@example.com',
  display_name: 'Ana Rahman',
};
const BIMA_PERSON = { id: 'p2', org_id: 'org', phone: '+6738123456', display_name: 'Bima' };
const roster = () => [
  {
    id: 'eA',
    event_id: 'ev',
    person_id: 'p1',
    display_name: 'Ana Rahman',
    cafe: 'BrewLab',
    bib: '7',
    withdrawn: false,
  },
  {
    id: 'eB',
    event_id: 'ev',
    person_id: 'p2',
    display_name: 'Bima',
    cafe: null,
    bib: null,
    withdrawn: false,
  },
];
const people = () => [{ ...ANA_PERSON }, { ...BIMA_PERSON }];
const settleAll = async () => {
  for (let i = 0; i < 12; i += 1) await settle();
};
async function openEdit(root, id) {
  root.querySelector(`#td-edit-btn-${id}`).click();
  await settleAll();
}
const submitEdit = (root) =>
  root.querySelector('form.td-edit').dispatchEvent(new Event('submit', { cancelable: true }));
const updateCalls = (log) => log.rpcs.filter((r) => r.fn === 'update_roster_entry');

describe('editing a Throwdown competitor', () => {
  it('opens a labelled form with the name, phone (with its country) and café or team', async () => {
    const { root } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    const labels = [...root.querySelectorAll('form.td-edit .form-field-label')].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(['Name', 'Phone', 'Café or team (optional)']);
    // each box's accessible name starts with its visible label (WCAG 2.5.3, voice control)
    expect(root.querySelector('#td-edit-eA-cafe').getAttribute('aria-label')).toBe(
      'Café or team (optional) for Ana Rahman',
    );
    expect(root.querySelector('#td-edit-eA-displayName').value).toBe('Ana Rahman');
    expect(root.querySelector('#td-edit-eA-phone').value).toBe('+6737123456');
    expect(root.querySelector('#td-edit-eA-cafe').value).toBe('BrewLab');
    expect(document.activeElement).toBe(root.querySelector('#td-edit-eA-displayName'));
    // its own Edit button is hidden while its form is open
    expect(root.querySelector('#td-edit-btn-eA')).toBeNull();
  });

  it('saves a corrected name and café through update_roster_entry, keeping email and bib', async () => {
    const { root, log } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-displayName', '  Ana R.  ');
    type(root, 'td-edit-eA-cafe', 'Brew Lab');
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)).toEqual([
      {
        fn: 'update_roster_entry',
        args: {
          p_org_id: 'org',
          p_entry_id: 'eA',
          p_display_name: 'Ana R.',
          p_phone: '+6737123456',
          // the RPC replaces these with what it is sent: the form shows neither, so the stored values ride along
          p_email: 'ana@example.com',
          p_cafe: 'Brew Lab',
          p_bib: '7',
        },
      },
    ]);
    // an unchanged phone does not ask for a new Seduh ID link
    expect(log.rpcs.some((r) => r.fn === 'link_person_identity')).toBe(false);
    const words = root.querySelector('.screen-feedback').textContent;
    expect(words).toContain('Ana R. updated.');
    expect(words).toContain('next time they are published');
    expect(root.querySelector('form.td-edit')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('#td-edit-btn-eA'));
  });

  it('saves a changed phone, read in its country, and asks for the Seduh ID link again', async () => {
    const { root, log } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-phone', '812 9999');
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)[0].args.p_phone).toBe('+6738129999');
    expect(log.rpcs).toContainEqual({
      fn: 'link_person_identity',
      args: { p_org_id: 'org', p_person_id: 'p1' },
    });
  });

  it('names the other person when the phone already belongs to them, under the phone box', async () => {
    const detail = JSON.stringify({ field: 'phone', existing_display_name: 'Bima' });
    const { root } = await mountRecording({
      event_entries: roster(),
      people: people(),
      rpcErrors: { update_roster_entry: { code: 'P0002', message: 'CONFLICT', details: detail } },
    });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-displayName', 'Ana R.');
    type(root, 'td-edit-eA-phone', '8123456');
    submitEdit(root);
    await settleAll();
    const error = root.querySelector('#td-edit-error-eA');
    expect(error.textContent).toBe('That phone number already belongs to Bima. Check the number.');
    const phone = root.querySelector('#td-edit-eA-phone');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-describedby')).toBe('td-edit-error-eA');
    expect(error.closest('.form-field').contains(phone)).toBe(true);
    // typed values kept, the form still open, focus on the box to fix, no success words
    expect(root.querySelector('#td-edit-eA-displayName').value).toBe('Ana R.');
    expect(phone.value).toBe('8123456');
    expect(document.activeElement).toBe(phone);
    expect(root.querySelector('.screen-feedback').textContent).toBe('');
  });

  it('checks an unchanged stored phone for shape only, so an old number never blocks a name fix', async () => {
    // Shaped like E.164 but not a number the phone library accepts today (no Brunei number starts with 9).
    const old = { ...ANA_PERSON, phone: '+6739999999' };
    const { root, log } = await mountRecording({
      event_entries: roster(),
      people: [old, BIMA_PERSON],
    });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-displayName', 'Ana R.');
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)[0].args).toMatchObject({
      p_display_name: 'Ana R.',
      p_phone: '+6739999999',
    });
    // ...but typing a DIFFERENT such number is refused with the ordinary phone words
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-phone', '+6739999998');
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)).toHaveLength(1);
    expect(root.querySelector('#td-edit-error-eA').textContent).toBe(
      phoneErrorMessage(parsePhone('+6739999998', { country: 'BN' }).code),
    );
  });

  it('refuses a blank name and a blank phone in the same words as the add form, writing nothing', async () => {
    const { root, log } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-displayName', '   ');
    submitEdit(root);
    await settleAll();
    expect(root.querySelector('#td-edit-error-eA').textContent).toBe(
      'Enter the competitor’s name.',
    );
    expect(document.activeElement).toBe(root.querySelector('#td-edit-eA-displayName'));
    type(root, 'td-edit-eA-displayName', 'Ana');
    type(root, 'td-edit-eA-phone', '');
    submitEdit(root);
    await settleAll();
    expect(root.querySelector('#td-edit-error-eA').textContent).toBe(
      'Enter the competitor’s phone number.',
    );
    expect(updateCalls(log)).toEqual([]);
  });

  it('refuses a café or team over the database cap', async () => {
    const { root, log } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-cafe', 'x'.repeat(201));
    submitEdit(root);
    await settleAll();
    expect(root.querySelector('#td-edit-error-eA').textContent).toBe(
      'Café or team is too long (200 characters at most).',
    );
    expect(updateCalls(log)).toEqual([]);
  });

  it('warns when the entry is named in the published results, and says to publish again after saving', async () => {
    const published = [
      { payload: { podium: [{ name: 'Ana Rahman', cafe: 'BrewLab' }], standings: [] } },
    ];
    const { root } = await mountRecording({
      event_entries: roster(),
      people: people(),
      public_results: published,
    });
    await openEdit(root, 'eA');
    const note = root.querySelector('form.td-edit [role="status"]');
    expect(note.textContent).toContain('is in the published results');
    // the note is read where the person types: both boxes the published results match on point to it
    for (const field of ['displayName', 'cafe']) {
      expect(root.querySelector(`#td-edit-eA-${field}`).getAttribute('aria-describedby')).toBe(
        'td-edit-note-eA',
      );
    }
    expect(root.querySelector('#td-edit-eA-phone').hasAttribute('aria-describedby')).toBe(false);
    type(root, 'td-edit-eA-displayName', 'Ana R.');
    expect(note.textContent).toContain('drops this person’s result');
    submitEdit(root);
    await settleAll();
    expect(root.querySelector('.screen-feedback').textContent).toContain(
      'not on their Seduh ID profile until you republish',
    );
  });

  it('says nothing about published results for an entry they do not name', async () => {
    const published = [{ payload: { podium: [{ name: 'Someone Else', cafe: null }] } }];
    const { root } = await mountRecording({
      event_entries: roster(),
      people: people(),
      public_results: published,
    });
    await openEdit(root, 'eA');
    expect(root.querySelector('form.td-edit [role="status"]')).toBeNull();
  });

  it('Cancel closes the form without writing and returns focus to that row’s Edit button', async () => {
    const { root, log } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-displayName', 'Changed');
    [...root.querySelectorAll('form.td-edit button')]
      .find((b) => b.textContent === 'Cancel')
      .click();
    expect(root.querySelector('form.td-edit')).toBeNull();
    expect(updateCalls(log)).toEqual([]);
    expect(document.activeElement).toBe(root.querySelector('#td-edit-btn-eA'));
    expect(root.textContent).toContain('Ana Rahman');
  });

  it('one row is in edit at a time: another row’s Edit is parked and does nothing', async () => {
    const { root } = await mountRecording({ event_entries: roster(), people: people() });
    await openEdit(root, 'eA');
    type(root, 'td-edit-eA-displayName', 'Half typed');
    const other = root.querySelector('#td-edit-btn-eB');
    expect(other.getAttribute('aria-disabled')).toBe('true');
    other.click();
    await settleAll();
    expect(root.querySelectorAll('form.td-edit')).toHaveLength(1);
    expect(root.querySelector('#td-edit-eA-displayName').value).toBe('Half typed');
  });

  it('while saving, the boxes stay focusable (read-only, aria-disabled) and keep focus', async () => {
    const { root, log } = await mountRecording({
      event_entries: roster(),
      people: people(),
      hangRpc: ['update_roster_entry'],
    });
    await openEdit(root, 'eA');
    root.querySelector('#td-edit-eA-displayName').focus();
    submitEdit(root);
    await settleAll();
    const busyName = root.querySelector('#td-edit-eA-displayName');
    expect(busyName.disabled).toBe(false);
    expect(busyName.readOnly).toBe(true);
    expect(busyName.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('#td-edit-eA-phoneCountry').disabled).toBe(false);
    expect(document.activeElement).toBe(busyName);
    // a second Save while one is in flight sends nothing more
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)).toHaveLength(1);
  });

  it('can edit after the draw too, so a typo is fixable mid-event', async () => {
    const { root, log } = await mountRecording({
      ...started,
      event_entries: roster(),
      td_slots: [
        { id: 's1', match_id: 'm1', position: 1, entry_id: 'eA' },
        { id: 's2', match_id: 'm1', position: 2, entry_id: 'eB' },
      ],
      people: people(),
    });
    expect(root.textContent).toContain('The draw has started');
    await openEdit(root, 'eB');
    type(root, 'td-edit-eB-displayName', 'Bima S');
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)[0].args).toMatchObject({ p_entry_id: 'eB', p_display_name: 'Bima S' });
  });

  it('an entry with no person edits name and café only, and sends no phone', async () => {
    const walkUp = [
      {
        id: 'eW',
        event_id: 'ev',
        person_id: null,
        display_name: 'Walk Up',
        cafe: null,
        withdrawn: false,
      },
    ];
    const { root, log } = await mountRecording({ event_entries: walkUp, people: [] });
    await openEdit(root, 'eW');
    expect(root.querySelector('#td-edit-eW-phone')).toBeNull();
    expect(root.querySelector('form.td-edit').textContent).toContain('no phone on file');
    type(root, 'td-edit-eW-displayName', 'Walk Up Two');
    submitEdit(root);
    await settleAll();
    expect(updateCalls(log)[0].args).toMatchObject({
      p_display_name: 'Walk Up Two',
      p_phone: null,
      p_email: null,
    });
  });

  it('will not open the editor for a person whose phone could not be read, and says why', async () => {
    const { root } = await mountRecording({ event_entries: roster(), people: [] });
    await openEdit(root, 'eA');
    expect(root.querySelector('form.td-edit')).toBeNull();
    expect(root.querySelector('.screen-feedback').textContent).toContain(
      'cannot be edited right now',
    );
  });
});
