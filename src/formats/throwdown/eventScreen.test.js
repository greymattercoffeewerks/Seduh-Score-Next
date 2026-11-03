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
