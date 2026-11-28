// The Seduh ID queue on the admin screen: names and places drawn from the function's answer, Reject after a confirmation,
// no Approve button anywhere (it is built and switched off), and a gate refusal drawing nothing of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../core/feedback.js', async (orig) => ({ ...(await orig()), confirmDialog }));

import {
  approveQueued,
  mountFeedQueue,
  readQueue,
  QUEUE_EMPTY,
  QUEUE_READ_FAILED,
} from './feedQueue.js';
import { flush } from './consoleHarness.js';

const ROW = {
  result_id: '11111111-1111-4111-8111-111111111111',
  org_name: 'BSRC',
  event_name: 'Latte Art Throwdown Vol 3',
  event_date: '2026-11-27',
  enqueued_at: '2026-11-27T15:00:00Z',
  podium: [
    { position: 1, name: 'Ana Putri' },
    { position: 2, name: 'Budi Hassan' },
  ],
  console_actions: false,
};
const ok = (data) => ({ data, error: null });
const refused = (hint) => ({ data: null, error: { hint } });

let queue;
let host;
function mount(answers) {
  const callAdmin = vi.fn(async (name) => {
    const next = answers[name];
    return typeof next === 'function' ? next() : next;
  });
  queue = mountFeedQueue({ callAdmin });
  host = document.createElement('div');
  host.appendChild(queue.element);
  document.body.appendChild(host);
  return callAdmin;
}
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);

beforeEach(() => confirmDialog.mockReset());
afterEach(() => {
  queue?.unmount();
  host?.remove();
});

describe('readQueue', () => {
  it('accepts rows of places and names, and refuses anything else whole', () => {
    expect(readQueue([ROW])).toHaveLength(1);
    expect(readQueue([])).toEqual([]);
    expect(readQueue(null)).toBeNull();
    expect(readQueue([{ ...ROW, podium: 'x' }])).toBeNull();
    expect(readQueue([{ ...ROW, podium: [{ position: 'one', name: 'A' }] }])).toBeNull();
  });
  it('keeps only names and places: a phone or cafe in the answer is never carried', () => {
    const rows = readQueue([
      { ...ROW, podium: [{ position: 1, name: 'Ana Putri', phone: '+6737000000', cafe: 'X' }] },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/6737000000|"cafe"/);
  });
});

describe('the queue section', () => {
  it('draws the event, the organisation and the names in order, with a Reject button and no Approve', async () => {
    const callAdmin = mount({ admin_seduh_feed_queue: ok([ROW]) });
    await queue.load();
    expect(callAdmin).toHaveBeenCalledWith('admin_seduh_feed_queue', {});
    expect(host.textContent).toContain('Latte Art Throwdown Vol 3');
    expect(host.textContent).toContain('BSRC');
    const names = [...host.querySelectorAll('.adm-feed-podium li')].map((li) => li.textContent);
    expect(names).toEqual(['Ana Putri', 'Budi Hassan']);
    expect(button('Reject')).toBeTruthy();
    expect([...host.querySelectorAll('button')].some((b) => /approve/i.test(b.textContent))).toBe(
      false,
    );
  });

  it('says so when nothing waits', async () => {
    mount({ admin_seduh_feed_queue: ok([]) });
    await queue.load();
    expect(host.textContent).toContain(QUEUE_EMPTY);
  });

  it('an answer that is not the documented shape draws none of it', async () => {
    mount({ admin_seduh_feed_queue: ok([{ result_id: 5 }]) });
    expect(await queue.load()).toBe('failed');
    expect(host.textContent).toContain(QUEUE_READ_FAILED);
    expect(host.querySelector('.adm-feed-list')).toBeNull();
  });

  it('a gate refusal draws nothing of its own and says so to the caller', async () => {
    mount({ admin_seduh_feed_queue: refused('admin_mfa_required') });
    expect(await queue.load()).toBe('gate');
    expect(host.querySelector('[data-tone="error"]')).toBeNull();
  });

  it('Reject asks first, sends only the result id, then draws the queue again', async () => {
    confirmDialog.mockResolvedValue(true);
    let rows = [ROW];
    const callAdmin = mount({
      admin_seduh_feed_queue: () => ok(rows),
      admin_seduh_feed_reject: () => {
        rows = [];
        return ok(null);
      },
    });
    await queue.load();
    button('Reject').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(callAdmin).toHaveBeenCalledWith('admin_seduh_feed_reject', {
      p_result_id: ROW.result_id,
    });
    expect(host.textContent).toContain(QUEUE_EMPTY);
    expect(host.textContent).toContain('Podium rejected.');
  });

  it('cancelling the confirmation rejects nothing', async () => {
    confirmDialog.mockResolvedValue(false);
    const callAdmin = mount({ admin_seduh_feed_queue: ok([ROW]) });
    await queue.load();
    button('Reject').click();
    await flush();
    expect(callAdmin.mock.calls.some(([name]) => name === 'admin_seduh_feed_reject')).toBe(false);
    expect(host.textContent).toContain('Ana Putri');
  });

  it('a refusal from Reject is worded from its hint and the row stays', async () => {
    confirmDialog.mockResolvedValue(true);
    mount({
      admin_seduh_feed_queue: ok([ROW]),
      admin_seduh_feed_reject: refused('feed_not_queued'),
    });
    await queue.load();
    button('Reject').click();
    await flush();
    expect(host.querySelector('[data-tone="error"]').textContent).toBe(
      'That podium is no longer waiting. Refresh the list.',
    );
    expect(host.textContent).toContain('Ana Putri');
  });
});

describe('Approve, built and not shown', () => {
  it('the helper calls the approve function with the result id and nothing else', async () => {
    const callAdmin = vi.fn(async () => ok({ identities_created: 1, people_linked: 1 }));
    const answer = await approveQueued({ callAdmin }, ROW.result_id);
    expect(callAdmin).toHaveBeenCalledWith('admin_seduh_feed_approve', {
      p_result_id: ROW.result_id,
    });
    expect(answer.data.identities_created).toBe(1);
  });
});
