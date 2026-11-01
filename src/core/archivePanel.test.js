import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createArchiveController } from './archivePanel.js';

const ENDED = '2026-11-02T10:00:00Z';
const NOW = new Date('2026-11-02T12:00:00Z').getTime();
const ev = (over = {}) => ({
  id: 'e1',
  name: 'October Cup',
  format: 'cup_taster',
  is_test: false,
  ended_at: ENDED,
  ...over,
});

// A client that answers my_entitlements, the public_results read and the two RPCs, recording every call.
function fakeClient({ entry, results = [], rpc = {} } = {}) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (name === 'my_entitlements') {
        return Promise.resolve({
          data: entry === undefined ? null : { keys: { results_archive_optional: entry } },
          error: null,
        });
      }
      return Promise.resolve(rpc[name] ?? { data: {}, error: null });
    },
    from(table) {
      calls.push(['from', table]);
      const builder = {
        select: () => builder,
        in: () => builder,
        then: (resolve, reject) =>
          Promise.resolve({ data: results, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

function make(client, over = {}) {
  const store = new Map();
  const onChange = vi.fn();
  const controller = createArchiveController({
    orgId: 'org1',
    client,
    onChange,
    now: () => NOW,
    publishHrefFor: (event) => `#/events/${event.id}/report`,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    ...over,
  });
  return { controller, onChange, store };
}

describe('archive controller: dark', () => {
  it('draws nothing and reads nothing but the plan snapshot while the key is not enforced', async () => {
    const client = fakeClient({ entry: { allowed: true } });
    const { controller } = make(client);
    await controller.load([ev()]);
    expect(controller.mode()).toBe('off');
    expect(controller.renderFor(ev())).toBeNull();
    expect(controller.finishNote()).toBeNull();
    expect(client.calls.map((c) => c[1])).toEqual(['my_entitlements']);
  });

  it('stays off when the snapshot cannot be read (fail-open for the screen)', async () => {
    const { controller } = make(fakeClient());
    await controller.load([ev()]);
    expect(controller.renderFor(ev())).toBeNull();
  });

  it('stays off when the results read fails', async () => {
    const client = fakeClient({ entry: { allowed: false, enforced: true } });
    client.from = () => {
      throw new Error('network');
    };
    const { controller } = make(client);
    await controller.load([ev()]);
    expect(controller.mode()).toBe('off');
  });
});

describe('archive controller: Community (compulsory)', () => {
  let client;
  beforeEach(() => {
    client = fakeClient({ entry: { allowed: false, enforced: true } });
  });

  it('shows the scheduled podium with a Publish now link and no tick box', async () => {
    const { controller } = make(client);
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('scheduled');
    expect(panel.textContent).toContain('3 Nov 2026, 18:00 (Brunei time)');
    expect(panel.querySelector('input[type=checkbox]')).toBeNull();
    const publish = panel.querySelector('#archive-publish-now-e1');
    expect(publish.getAttribute('href')).toBe('#/events/e1/report');
    expect(publish.getAttribute('aria-label')).toContain('Publish');
    expect(panel.querySelector('#archive-unpublish-e1')).toBeNull();
    expect(controller.finishNote()).toContain('podium is published');
  });

  it('shows nothing for a running event, and the test line for a test event', async () => {
    const { controller } = make(client);
    await controller.load([ev({ ended_at: null })]);
    expect(controller.renderFor(ev({ ended_at: null }))).toBeNull();
    expect(controller.renderFor(ev({ is_test: true })).dataset.archiveState).toBe('test');
    expect(controller.renderFor(ev({ is_test: true })).querySelector('a, button')).toBeNull();
  });

  it('says overdue honestly when nothing is published after the due time', async () => {
    const { controller } = make(client, { now: () => new Date('2026-11-05T00:00:00Z').getTime() });
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('overdue');
    expect(panel.textContent).toContain('may still be on its way');
  });

  it('offers a two-step take-down of a published podium, then reads taken down and never republishes', async () => {
    client = fakeClient({
      entry: { allowed: false, enforced: true },
      results: [{ event_id: 'e1', payload: { podium: [{ name: 'A' }] }, published_at: ENDED }],
    });
    const { controller, onChange } = make(client);
    await controller.load([ev()]);
    let panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('published');
    panel.querySelector('#archive-unpublish-e1').click();
    expect(onChange).toHaveBeenLastCalledWith('#archive-confirm-unpublish-e1');
    panel = controller.renderFor(ev());
    expect(panel.textContent).toContain('recorded and counted');
    expect(panel.textContent).toContain('will not be published again automatically');
    // nothing was sent yet
    expect(client.calls.some((c) => c[1] === 'unpublish_event_results')).toBe(false);
    panel.querySelector('#archive-cancel-unpublish-e1').click();
    expect(controller.renderFor(ev()).querySelector('#archive-unpublish-e1')).not.toBeNull();

    controller.renderFor(ev()).querySelector('#archive-unpublish-e1').click();
    controller.renderFor(ev()).querySelector('#archive-confirm-unpublish-e1').click();
    await vi.waitFor(() =>
      expect(controller.renderFor(ev()).dataset.archiveState).toBe('taken_down'),
    );
    expect(client.calls).toContainEqual([
      'rpc',
      'unpublish_event_results',
      { p_org_id: 'org1', p_event_id: 'e1' },
    ]);
    expect(controller.renderFor(ev()).textContent).toContain(
      'will not be published again automatically',
    );
  });

  it('a failed take-down keeps the result and says so', async () => {
    client = fakeClient({
      entry: { allowed: false, enforced: true },
      results: [{ event_id: 'e1', payload: { podium: [{ name: 'A' }] }, published_at: ENDED }],
      rpc: { unpublish_event_results: { data: null, error: { message: 'x' } } },
    });
    const { controller } = make(client);
    await controller.load([ev()]);
    controller.renderFor(ev()).querySelector('#archive-unpublish-e1').click();
    controller.renderFor(ev()).querySelector('#archive-confirm-unpublish-e1').click();
    await vi.waitFor(() =>
      expect(controller.renderFor(ev()).querySelector('[role=alert]')).not.toBeNull(),
    );
    expect(controller.renderFor(ev()).dataset.archiveState).toBe('published');
  });
});

describe('archive controller: Per-event / Annual (choice)', () => {
  let client;
  beforeEach(() => {
    client = fakeClient({ entry: { allowed: true, enforced: true } });
  });

  it('shows the tick box UNTICKED by default, with a visible label and the lost-if-unticked copy', async () => {
    const { controller } = make(client);
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    const box = panel.querySelector('#archive-listing-e1');
    expect(box.checked).toBe(false);
    expect(panel.querySelector('label[for="archive-listing-e1"]').textContent).toContain(
      'List the podium',
    );
    expect(box.getAttribute('aria-describedby')).toBe('archive-listing-help-e1');
    expect(panel.querySelector('#archive-listing-help-e1').textContent).toContain('no results');
    expect(panel.dataset.archiveState).toBe('scheduled_named_only');
  });

  it('is available before the event ends (the choice can be made early)', async () => {
    const { controller } = make(client);
    const running = ev({ ended_at: null });
    await controller.load([running]);
    const panel = controller.renderFor(running);
    expect(panel.dataset.archiveState).toBe('open');
    expect(panel.querySelector('#archive-listing-e1')).not.toBeNull();
  });

  it('ticking calls set_archive_listing with true, remembers it, and flips the scheduled state', async () => {
    const { controller, store } = make(client);
    await controller.load([ev()]);
    const box = controller.renderFor(ev()).querySelector('#archive-listing-e1');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(controller.renderFor(ev()).dataset.archiveState).toBe('scheduled'),
    );
    expect(client.calls).toContainEqual([
      'rpc',
      'set_archive_listing',
      { p_org_id: 'org1', p_event_id: 'e1', p_list: true },
    ]);
    expect(store.get('seduh.archiveListing.e1')).toBe('list');
    expect(controller.renderFor(ev()).querySelector('#archive-listing-e1').checked).toBe(true);
  });

  it('a refused choice leaves the box as it was and shows the reason from the hint', async () => {
    client = fakeClient({
      entry: { allowed: true, enforced: true },
      rpc: {
        set_archive_listing: {
          data: null,
          error: { code: 'P0001', hint: 'archive_listing_closed' },
        },
      },
    });
    const { controller, store } = make(client);
    await controller.load([ev()]);
    const box = controller.renderFor(ev()).querySelector('#archive-listing-e1');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(controller.renderFor(ev()).querySelector('[role=alert]')?.textContent).toContain(
        'already been decided',
      ),
    );
    expect(controller.renderFor(ev()).querySelector('#archive-listing-e1').checked).toBe(false);
    expect(store.size).toBe(0);
  });

  it('starts from the last choice saved on this device', async () => {
    const { controller, store } = make(client);
    store.set('seduh.archiveListing.e1', 'list');
    await controller.load([ev()]);
    expect(controller.renderFor(ev()).querySelector('#archive-listing-e1').checked).toBe(true);
  });

  it('has no tick box and no take-down once an entry exists; a stub offers Publish now', async () => {
    client = fakeClient({
      entry: { allowed: true, enforced: true },
      results: [{ event_id: 'e1', payload: { listing: 'named_only' }, published_at: ENDED }],
    });
    const { controller } = make(client);
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('listed_named_only');
    expect(panel.querySelector('input')).toBeNull();
    expect(panel.querySelector('#archive-publish-now-e1')).not.toBeNull();
    expect(panel.querySelector('#archive-unpublish-e1')).toBeNull();
  });

  it('a format without a manual publish gets no Publish now link', async () => {
    const { controller } = make(client, { publishHrefFor: () => null });
    await controller.load([ev({ format: 'btc' })]);
    expect(controller.renderFor(ev({ format: 'btc' })).querySelector('a')).toBeNull();
  });
});
