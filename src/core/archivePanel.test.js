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

const noRow = (id) => ({
  event_id: id,
  state: 'none',
  due_at: null,
  published: false,
  listing_choice: null,
  removed: false,
  retrying: false,
  reason: null,
});

// A client that answers my_entitlements, archive_event_status (a small stateful ledger: set_archive_listing and
// unpublish_event_results change what it answers next, like the database), the public_results read and the RPCs,
// recording every call. `status` maps an event id to the ledger fields it should answer with.
function fakeClient({ entry, results = [], rpc = {}, status = {}, statusError = null } = {}) {
  const calls = [];
  const ledger = { ...status };
  let rows = results;
  return {
    calls,
    ledger,
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (name === 'my_entitlements') {
        return Promise.resolve({
          data: entry === undefined ? null : { keys: { results_archive_optional: entry } },
          error: null,
        });
      }
      if (name === 'archive_event_status') {
        if (statusError) return Promise.resolve({ data: null, error: statusError });
        return Promise.resolve({
          data: args.p_event_ids.map((id) => ({ ...noRow(id), ...ledger[id] })),
          error: null,
        });
      }
      const answer = rpc[name];
      if (!answer?.error) {
        if (name === 'set_archive_listing') {
          ledger[args.p_event_id] = {
            ...ledger[args.p_event_id],
            listing_choice: args.p_list ? 'list' : 'named_only',
          };
        }
        if (name === 'unpublish_event_results') {
          rows = rows.filter((r) => r.event_id !== args.p_event_id);
          ledger[args.p_event_id] = { ...ledger[args.p_event_id], state: 'removed', removed: true };
        }
      }
      return Promise.resolve(answer ?? { data: {}, error: null });
    },
    from(table) {
      calls.push(['from', table]);
      const builder = {
        select: () => builder,
        in: () => builder,
        then: (resolve, reject) =>
          Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

function make(client, over = {}) {
  const onChange = vi.fn();
  const controller = createArchiveController({
    orgId: 'org1',
    client,
    onChange,
    now: () => NOW,
    publishHrefFor: (event) => `#/events/${event.id}/report`,
    ...over,
  });
  return { controller, onChange };
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
    expect(client.calls.some((c) => c[1] === 'archive_event_status')).toBe(false);
  });

  it('stays off when there is no usable snapshot (fail-open for the screen)', async () => {
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

  it('stays off when the status read fails: the panel never guesses what the pipeline decided', async () => {
    const client = fakeClient({
      entry: { allowed: false, enforced: true },
      statusError: { code: '42501', message: 'no' },
    });
    const { controller } = make(client);
    await controller.load([ev()]);
    expect(controller.mode()).toBe('off');
    expect(controller.renderFor(ev())).toBeNull();
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
    expect(panel.textContent).toContain('You can publish it now');
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
    // after a reload the database says removed (not this device's memory): still taken down, never "will be published"
    const reloaded = make(client);
    await reloaded.controller.load([ev()]);
    expect(reloaded.controller.renderFor(ev()).dataset.archiveState).toBe('taken_down');
    // ...and so does another device: a fresh client with only the ledger's answer and no result row
    const otherDevice = make(
      fakeClient({
        entry: { allowed: false, enforced: true },
        status: { e1: { state: 'removed', removed: true } },
      }),
    );
    await otherDevice.controller.load([ev()]);
    expect(otherDevice.controller.renderFor(ev()).dataset.archiveState).toBe('taken_down');
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

describe('archive controller: what the database decided (archive_event_status)', () => {
  const load = async (status, over = {}, results = []) => {
    const client = fakeClient({ entry: { allowed: false, enforced: true }, status, results });
    const made = make(client, over);
    await made.controller.load([ev()]);
    return { client, ...made };
  };
  const LATE = { now: () => new Date('2026-11-05T00:00:00Z').getTime() };

  it('asks once for the listed events, never for a test event', async () => {
    const client = fakeClient({ entry: { allowed: false, enforced: true } });
    const { controller } = make(client);
    await controller.load([ev(), ev({ id: 't1', is_test: true })]);
    const asked = client.calls.filter((c) => c[1] === 'archive_event_status');
    expect(asked).toEqual([
      ['rpc', 'archive_event_status', { p_org_id: 'org1', p_event_ids: ['e1'] }],
    ]);
    expect(controller.renderFor(ev({ id: 't1', is_test: true })).dataset.archiveState).toBe('test');
  });

  it('asks for at most 200 events and shows no panel for the rest', async () => {
    const client = fakeClient({ entry: { allowed: false, enforced: true } });
    const { controller } = make(client);
    const many = Array.from({ length: 203 }, (_, i) => ev({ id: `m${i}` }));
    await controller.load(many);
    const asked = client.calls.find((c) => c[1] === 'archive_event_status');
    expect(asked[2].p_event_ids).toHaveLength(200);
    expect(controller.renderFor(many[0])).not.toBeNull();
    expect(controller.renderFor(many[202])).toBeNull();
  });

  it('retrying: a failed attempt that will be tried again (no claim it is published)', async () => {
    const { controller } = await load({
      e1: { state: 'pending', retrying: true, reason: 'processing_error' },
    });
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('retrying');
    expect(panel.textContent).toContain('will be tried again');
    expect(panel.querySelector('#archive-publish-now-e1')).not.toBeNull();
  });

  it('failed: gave up, nothing published, Publish now offered, no tick box', async () => {
    const client = fakeClient({
      entry: { allowed: true, enforced: true },
      status: { e1: { state: 'failed', reason: 'processing_error' } },
    });
    const { controller } = make(client);
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('failed');
    expect(panel.textContent).toContain('did not work');
    expect(panel.querySelector('#archive-publish-now-e1')).not.toBeNull();
    expect(panel.querySelector('input')).toBeNull();
    // the SQLSTATE or any raw text never reaches the screen
    expect(panel.textContent).not.toMatch(/processing_error|40P01|SQLSTATE/);
  });

  it.each([
    ['no_snapshot', 'were not opened'],
    ['invalid_snapshot', 'could not be used'],
    ['stale_snapshot', 'Scores changed'],
  ])('a stub published because of %s says why', async (reason, words) => {
    const { controller } = await load({ e1: { state: 'stubbed', published: true, reason } }, {}, [
      { event_id: 'e1', payload: { listing: 'named_only' }, published_at: ENDED },
    ]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('listed_named_only');
    expect(panel.textContent).toContain(words);
    expect(panel.textContent).not.toContain(reason);
  });

  it('a stub with no reason (the organiser chose names only) adds no explanation', async () => {
    const { controller } = await load({ e1: { state: 'stubbed', published: true } }, {}, [
      { event_id: 'e1', payload: { listing: 'named_only' }, published_at: ENDED },
    ]);
    expect(controller.renderFor(ev()).textContent).not.toContain('Scores changed');
  });

  it('removed: taken down after a reload, nothing is promised again', async () => {
    const { controller } = await load({ e1: { state: 'removed', removed: true } }, LATE);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('taken_down');
    expect(panel.textContent).toContain('will not be published again automatically');
  });

  it('removed and then published again by hand reads as published', async () => {
    const { controller } = await load(
      { e1: { state: 'removed', removed: true, published: true } },
      LATE,
      [{ event_id: 'e1', payload: { podium: [{ name: 'A' }] }, published_at: ENDED }],
    );
    expect(controller.renderFor(ev()).dataset.archiveState).toBe('published');
  });

  it('overdue only when nothing is recorded as wrong: the schedule is late', async () => {
    const { controller } = await load({ e1: { state: 'pending' } }, LATE);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('overdue');
    expect(panel.textContent).toContain('running late');
  });

  it("uses the database's due time, not a recomputed one", async () => {
    const { controller } = await load({
      e1: { state: 'pending', due_at: '2026-11-04T10:00:00Z' },
    });
    expect(controller.renderFor(ev()).textContent).toContain('4 Nov 2026, 18:00 (Brunei time)');
  });

  it('a row it cannot read is treated as no ledger state, never as a reason on screen', async () => {
    const { controller } = await load({
      e1: { state: 'something_new', reason: 'SELECT * FROM secrets' },
    });
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('scheduled');
    expect(panel.textContent).not.toContain('secrets');
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

  it('ticking calls set_archive_listing with true, asks the database again, and flips the scheduled state', async () => {
    const { controller } = make(client);
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
    expect(client.calls.filter((c) => c[1] === 'archive_event_status')).toHaveLength(2);
    expect(controller.renderFor(ev()).querySelector('#archive-listing-e1').checked).toBe(true);
    // a reload, even on another device, reads the saved choice from the database
    const reloaded = make(client);
    await reloaded.controller.load([ev()]);
    expect(reloaded.controller.renderFor(ev()).querySelector('#archive-listing-e1').checked).toBe(
      true,
    );
    expect(reloaded.controller.renderFor(ev()).dataset.archiveState).toBe('scheduled');
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
    const { controller } = make(client);
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
    // nothing was saved, so the database still answers no choice
    expect(client.ledger.e1).toBeUndefined();
  });

  it('starts from the choice the database holds, not from this device', async () => {
    client = fakeClient({
      entry: { allowed: true, enforced: true },
      status: { e1: { state: 'pending', listing_choice: 'list' } },
    });
    const { controller } = make(client);
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

  it('a test event gets the explanation line but never a tick box', async () => {
    const { controller } = make(client);
    const test = ev({ is_test: true });
    await controller.load([test]);
    const panel = controller.renderFor(test);
    expect(panel.dataset.archiveState).toBe('test');
    expect(panel.querySelector('input')).toBeNull();
    expect(panel.querySelector('a, button')).toBeNull();
  });

  it('keeps the saved choice per event', async () => {
    client = fakeClient({
      entry: { allowed: true, enforced: true },
      status: {
        e1: { state: 'pending', listing_choice: 'list' },
        e2: { listing_choice: 'named_only' },
      },
    });
    const { controller } = make(client);
    const other = ev({ id: 'e2', name: 'Other' });
    await controller.load([ev(), other]);
    expect(controller.renderFor(ev()).querySelector('#archive-listing-e1').checked).toBe(true);
    expect(controller.renderFor(other).querySelector('#archive-listing-e2').checked).toBe(false);
  });

  it('offers no take-down on a paid plan (the soft unpublish is the Community rule)', async () => {
    client = fakeClient({
      entry: { allowed: true, enforced: true },
      results: [{ event_id: 'e1', payload: { podium: [{ name: 'A' }] }, published_at: ENDED }],
    });
    const { controller } = make(client);
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('published');
    expect(panel.querySelector('#archive-unpublish-e1')).toBeNull();
  });

  it('gives up on a hung plan read and stays dark', async () => {
    const hung = fakeClient({ entry: { allowed: false, enforced: true } });
    hung.rpc = () => new Promise(() => {});
    const { controller } = make(hung, { timeoutMs: 10 });
    await controller.load([ev()]);
    expect(controller.renderFor(ev())).toBeNull();
  });

  it('does not offer the tick box once the due time has passed (the choice would be closed)', async () => {
    const { controller } = make(client, { now: () => new Date('2026-11-05T00:00:00Z').getTime() });
    await controller.load([ev()]);
    const panel = controller.renderFor(ev());
    expect(panel.dataset.archiveState).toBe('overdue');
    expect(panel.querySelector('input')).toBeNull();
  });
});

describe('archive controller: a per-event grant on a Community organisation', () => {
  it('asks per event and treats the granted event as a choice, not a compulsory podium', async () => {
    const client = fakeClient({ entry: { allowed: false, enforced: true } });
    const baseRpc = client.rpc;
    client.rpc = (name, args) =>
      name === 'my_entitlements' && args.p_event === 'e2'
        ? Promise.resolve({
            data: { keys: { results_archive_optional: { allowed: true, enforced: true } } },
            error: null,
          })
        : baseRpc(name, args);
    const { controller } = make(client);
    const granted = ev({ id: 'e2', name: 'Granted' });
    await controller.load([ev(), granted]);
    expect(controller.renderFor(ev()).dataset.archiveMode).toBe('compulsory');
    const panel = controller.renderFor(granted);
    expect(panel.dataset.archiveMode).toBe('choice');
    expect(panel.querySelector('#archive-listing-e2')).not.toBeNull();
    expect(controller.finishNote(granted)).toContain('List the podium');
    expect(controller.finishNote(ev())).toContain('podium is published');
  });

  it('every button and link has its visible text inside its accessible name (WCAG 2.5.3)', async () => {
    const client = fakeClient({
      entry: { allowed: false, enforced: true },
      results: [{ event_id: 'e1', payload: { podium: [{ name: 'A' }] }, published_at: ENDED }],
    });
    const { controller } = make(client);
    await controller.load([ev()]);
    const check = (panel) => {
      for (const node of panel.querySelectorAll('button, a')) {
        const label = node.getAttribute('aria-label');
        if (label) expect(label.toLowerCase()).toContain(node.textContent.trim().toLowerCase());
      }
    };
    check(controller.renderFor(ev()));
    controller.renderFor(ev()).querySelector('#archive-unpublish-e1').click();
    const confirming = controller.renderFor(ev());
    expect(confirming.querySelectorAll('button')).toHaveLength(2);
    check(confirming);
    const overdue = make(fakeClient({ entry: { allowed: false, enforced: true } }), {
      now: () => new Date('2026-11-05T00:00:00Z').getTime(),
    });
    await overdue.controller.load([ev()]);
    check(overdue.controller.renderFor(ev()));
  });
});
