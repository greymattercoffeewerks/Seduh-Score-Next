import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderEventsList, renderFormatFilter, mountEventsScreen } from './eventsScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { _clearAllForTests } from './db.js';
import { enqueueOperation, setOutboxOwner, _resetOutboxOwnerForTests } from './outbox.js';

// Delete now reads this device's outbox before showing its confirm step, so
// the step appears after an await rather than synchronously.
async function openDeleteConfirm(root, eventId) {
  root.querySelector(`#delete-event-${eventId}`).click();
  await vi.waitFor(() => expect(root.querySelector(`#confirm-delete-${eventId}`)).not.toBeNull());
}

describe('renderEventsList', () => {
  it('shows an empty-state message, not a blank list, when there are no events', () => {
    const el = renderEventsList([]);
    expect(el.tagName).toBe('P');
    expect(el.textContent).toContain('No events yet');
  });

  it('renders one row per event, linking to #/events/{id}', () => {
    const events = [{ id: 'ev1', name: 'October Cup', is_test: false }];
    const list = renderEventsList(events);
    const link = list.querySelector('a');
    expect(link.textContent).toBe('October Cup');
    expect(link.getAttribute('href')).toBe('#/events/ev1');
  });

  it('marks a test event with a visible indicator; a non-test event has none', () => {
    const events = [
      { id: 'ev1', name: 'Test Run', is_test: true },
      { id: 'ev2', name: 'Real Event', is_test: false },
    ];
    const list = renderEventsList(events);
    const rows = [...list.querySelectorAll('li')];
    expect(rows[0].querySelector('.status[data-state="test"]').textContent).toBe('Test data');
    expect(rows[1].querySelector('.status[data-state="test"]')).toBeNull();
  });

  it('shows date, venue, and city as meta text when present', () => {
    const events = [
      {
        id: 'ev1',
        name: 'October Cup',
        event_date: '2026-10-04',
        venue: 'HQ',
        city: 'Bandar Seri Begawan',
        is_test: false,
      },
    ];
    const list = renderEventsList(events);
    expect(list.querySelector('li').textContent).toContain('4 Oct');
    expect(list.querySelector('li').textContent).toContain('HQ');
    expect(list.querySelector('li').textContent).toContain('Bandar Seri Begawan');
  });

  it("offers a Delete action on a test event, but not on a real one — matches delete_test_event's own server-side guard", () => {
    const events = [
      { id: 'ev1', name: 'Test Run', is_test: true },
      { id: 'ev2', name: 'Real Event', is_test: false },
    ];
    const list = renderEventsList(events);
    const rows = [...list.querySelectorAll('li')];
    expect(rows[0].querySelector('#delete-event-ev1')).not.toBeNull();
    expect(rows[1].querySelector('#delete-event-ev2')).toBeNull();
    expect(rows[1].querySelector('#finish-event-ev2')).not.toBeNull();
  });

  it('shows the two-step confirm, not the bare Delete button, once deleteStates marks that event as confirming', () => {
    const events = [{ id: 'ev1', name: 'Test Run', is_test: true }];
    const list = renderEventsList(events, { deleteStates: { ev1: 'confirming' } });
    expect(list.querySelector('#delete-event-ev1')).toBeNull();
    expect(list.querySelector('#confirm-delete-ev1')).not.toBeNull();
    expect(list.querySelector('#cancel-delete-ev1')).not.toBeNull();
    // No count passed: no unsynced-writes warning (never "undefined writes").
    expect(list.querySelector('#delete-warning-ev1')).toBeNull();
    expect(list.querySelector('#confirm-delete-ev1').hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows a disabled "Deleting…" state, with no clickable controls, while deleteStates marks that event as deleting', () => {
    const events = [{ id: 'ev1', name: 'Test Run', is_test: true }];
    const list = renderEventsList(events, { deleteStates: { ev1: 'deleting' } });
    expect(list.querySelector('li').textContent).toContain('Deleting…');
    expect(list.querySelector('#confirm-delete-ev1')).toBeNull();
    expect(list.querySelector('#finish-event-ev1')).not.toBeNull();
  });

  it("wires Delete/Confirm delete/Cancel to their own distinct handlers, each passed the clicked event's id", () => {
    const events = [{ id: 'ev1', name: 'Test Run', is_test: true }];
    const onDeleteClick = vi.fn();
    const list = renderEventsList(events, { deleteHandlers: { onDeleteClick } });
    list.querySelector('#delete-event-ev1').click();
    expect(onDeleteClick).toHaveBeenCalledWith('ev1');

    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    const confirming = renderEventsList(events, {
      deleteStates: { ev1: 'confirming' },
      deleteHandlers: { onConfirmDelete, onCancelDelete },
    });
    confirming.querySelector('#confirm-delete-ev1').click();
    confirming.querySelector('#cancel-delete-ev1').click();
    expect(onConfirmDelete).toHaveBeenCalledWith('ev1');
    expect(onCancelDelete).toHaveBeenCalledWith('ev1');
  });

  it('offers Finish only for an open event, with its required two-step copy', () => {
    const events = [
      { id: 'open', name: 'Open Cup', is_test: false, ended_at: null },
      { id: 'done', name: 'Done Cup', is_test: false, ended_at: '2026-10-27T00:00:00Z' },
    ];
    const list = renderEventsList(events, { finishStates: { open: 'confirming' } });
    expect(list.querySelector('#confirm-finish-open')).not.toBeNull();
    expect(list.textContent).toContain('stops counting as open');
    expect(list.textContent).toContain('Results and audience links stay available');
    expect(list.textContent).toContain('cannot reopen');
    expect(list.querySelector('#finish-event-done')).toBeNull();
    expect([...list.querySelectorAll('li')][1].textContent).toContain('Finished');
  });

  it('keeps the visible label inside every Finish control name (WCAG 2.5.3)', () => {
    const events = [{ id: 'e1', name: 'October Cup', is_test: false, ended_at: null }];
    for (const [state, visible] of [
      [undefined, 'Finish event'],
      ['confirming', 'Confirm finish'],
      ['confirming', 'Cancel'],
      ['finishing', 'Finishing'],
    ]) {
      const list = renderEventsList(events, { finishStates: state ? { e1: state } : {} });
      const button = [...list.querySelectorAll('button')].find((b) =>
        b.textContent.startsWith(visible),
      );
      expect(button, state ?? 'idle').toBeTruthy();
      expect(button.getAttribute('aria-label'), state ?? 'idle').toContain(visible);
    }
  });

  it('links the irreversible consequence to the Confirm finish button', () => {
    const events = [{ id: 'e1', name: 'October Cup', is_test: false, ended_at: null }];
    const list = renderEventsList(events, { finishStates: { e1: 'confirming' } });
    const confirm = list.querySelector('#confirm-finish-e1');
    const copy = list.querySelector(`#${confirm.getAttribute('aria-describedby')}`);
    expect(copy).not.toBeNull();
    expect(copy.textContent).toContain('cannot reopen');
  });

  it('shows the in-flight Finishing state as a disabled, named button', () => {
    const events = [{ id: 'e1', name: 'October Cup', is_test: false, ended_at: null }];
    const list = renderEventsList(events, { finishStates: { e1: 'finishing' } });
    const button = list.querySelector('#finish-event-e1');
    expect(button.textContent).toBe('Finishing…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});

function fakeClient({
  events = [],
  insertResult,
  rpcResult,
  summaries = [],
  summariesError = null,
} = {}) {
  const calls = [];
  const summaryReads = [];
  const db = { events: [...events] };
  return {
    calls,
    summaryReads,
    db,
    rpc: (name, payload) => {
      // The organiser home's one per-organisation summary read (org_event_summaries): a read, not a write.
      if (name === 'org_event_summaries') {
        summaryReads.push(payload);
        return Promise.resolve(
          summariesError ? { data: null, error: summariesError } : { data: summaries, error: null },
        );
      }
      // T-ARC.4: the screen asks for the plan snapshot after the list is on screen (the archive panel, dark here). It is a
      // read, not one of the writes these tests count, and archivePanel.test.js covers it.
      if (name === 'my_entitlements') return Promise.resolve({ data: null, error: null });
      calls.push(['rpc', name, payload]);
      if (name === 'delete_test_event' && !rpcResult?.error) {
        db.events = db.events.filter((event) => event.id !== payload.p_event_id);
      }
      return Promise.resolve(rpcResult ?? { data: null, error: null });
    },
    from(table) {
      const builder = {
        select: () => builder,
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          const inserted = { id: `ev-${db[table].length + 1}`, org_id: payload.org_id, ...payload };
          if (!insertResult?.error) db[table].push(inserted);
          return {
            select: () => ({
              single: () => Promise.resolve(insertResult ?? { data: inserted, error: null }),
            }),
          };
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
          return builder;
        },
        order: (...args) => {
          calls.push(['order', table, ...args]);
          return builder;
        },
        then: (resolve, reject) =>
          Promise.resolve({ data: db[table], error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

describe('mountEventsScreen', () => {
  it('loads and renders existing events for the org, with the way to a new one and no create form on the home', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    expect(root.textContent).toContain('October Cup');
    expect(root.querySelector('form')).toBeNull();
    const create = root.querySelector('a.events-new--header');
    expect(create.getAttribute('href')).toBe('#/events/new');
    expect(create.classList.contains('btn-primary')).toBe(true);
  });

  it('requires a confirmation before finishing, then calls the scoped RPC and preserves an announced focus target', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false, ended_at: null }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    root.querySelector('#finish-event-ev1').click();
    expect(client.calls.some(([action]) => action === 'rpc')).toBe(false);
    const confirm = root.querySelector('#confirm-finish-ev1');
    expect(document.activeElement).toBe(confirm);
    confirm.click();
    await vi.waitFor(() =>
      expect(client.calls).toContainEqual([
        'rpc',
        'finish_event',
        { p_org_id: 'org1', p_event_id: 'ev1' },
      ]),
    );
    await vi.waitFor(() => expect(root.textContent).toContain('Finished'));
    expect(document.activeElement).toBe(root.querySelector('#events-heading'));
    root.remove();
  });

  describe('the public-archive panel (T-ARC.4)', () => {
    const ENDED = new Date(Date.now() - 3600 * 1000).toISOString();
    function archiveClient(entry) {
      const client = fakeClient({
        events: [
          { id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false, ended_at: ENDED },
          { id: 'ev2', org_id: 'org1', name: 'Running Cup', is_test: false, ended_at: null },
        ],
      });
      client.db.public_results = [];
      const baseFrom = client.from;
      client.from = (table) => {
        const builder = baseFrom(table);
        builder.in = () => builder;
        return builder;
      };
      const baseRpc = client.rpc;
      client.rpc = (name, payload) => {
        if (name === 'my_entitlements') {
          return Promise.resolve({
            data: { keys: { results_archive_optional: entry } },
            error: null,
          });
        }
        if (name === 'archive_event_status') {
          // the member-readable ledger door (T-ARC.4c): no row for any event yet
          return Promise.resolve({
            data: payload.p_event_ids.map((id) => ({
              event_id: id,
              state: 'none',
              due_at: null,
              published: false,
              listing_choice: null,
              removed: false,
              retrying: false,
              reason: null,
            })),
            error: null,
          });
        }
        return baseRpc(name, payload);
      };
      return client;
    }
    async function mount(client) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      await mountEventsScreen(root, {
        orgId: 'org1',
        client,
        archivePublishHrefFor: (event) => `#/events/${event.id}/report`,
      });
      return root;
    }

    it('draws nothing while the key is not enforced, and the Finish copy is unchanged', async () => {
      const root = await mount(archiveClient({ allowed: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(root.querySelector('.archive-panel')).toBeNull();
      root.querySelector('#finish-event-ev2').click();
      expect(root.querySelector('#finish-copy-ev2').textContent).not.toContain('archive');
      root.remove();
    });

    it('keeps keyboard focus on the same control when the panel arrives and the list is redrawn', async () => {
      const client = archiveClient({ allowed: false, enforced: true });
      const gate = new Promise((resolve) => setTimeout(resolve, 30));
      const baseRpc = client.rpc;
      client.rpc = (name, payload) =>
        name === 'my_entitlements'
          ? gate.then(() => baseRpc(name, payload))
          : baseRpc(name, payload);
      const root = await mount(client);
      root.querySelector('#finish-event-ev2').focus();
      await vi.waitFor(() => expect(root.querySelector('#archive-panel-ev1')).not.toBeNull());
      expect(document.activeElement.id).toBe('finish-event-ev2');
      root.remove();
    });

    it('a test event never gets the archive sentence in its Finish step or its success line', async () => {
      const client = archiveClient({ allowed: true, enforced: true });
      client.db.events.push({
        id: 'ev3',
        org_id: 'org1',
        name: 'Test Cup',
        is_test: true,
        ended_at: null,
      });
      const root = await mount(client);
      await vi.waitFor(() => expect(root.querySelector('#archive-panel-ev1')).not.toBeNull());
      root.querySelector('#finish-event-ev3').click();
      expect(root.querySelector('#finish-copy-ev3').textContent).not.toContain('archive');
      root.querySelector('#confirm-finish-ev3').click();
      await vi.waitFor(() => expect(root.textContent).toContain('Event finished.'));
      expect(root.querySelector('.screen-feedback').textContent).toBe('Event finished.');
      root.remove();
    });

    it('once enforced, shows the panel under the ended event only, and the archive sentence in the Finish step', async () => {
      const root = await mount(archiveClient({ allowed: false, enforced: true }));
      await vi.waitFor(() => expect(root.querySelector('#archive-panel-ev1')).not.toBeNull());
      expect(root.querySelector('#archive-panel-ev1').dataset.archiveState).toBe('scheduled');
      expect(root.querySelector('#archive-panel-ev2')).toBeNull();
      expect(root.querySelector('#archive-publish-now-ev1').getAttribute('href')).toBe(
        '#/events/ev1/report',
      );
      root.querySelector('#finish-event-ev2').click();
      expect(root.querySelector('#finish-copy-ev2').textContent).toContain('podium is published');
      root.remove();
    });
  });

  it('Cancel sends no finish call and returns to a focused Finish button', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false, ended_at: null }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    root.querySelector('#finish-event-ev1').click();
    root.querySelector('#cancel-finish-ev1').click();
    expect(client.calls.some(([action]) => action === 'rpc')).toBe(false);
    expect(root.querySelector('#confirm-finish-ev1')).toBeNull();
    const finish = root.querySelector('#finish-event-ev1');
    expect(finish).not.toBeNull();
    expect(document.activeElement).toBe(finish);
    root.remove();
  });

  it('clicking the in-flight Finishing button does not reopen Confirm or send a second call', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false, ended_at: null }],
    });
    // never settles, so the in-flight window is real and not timing-dependent
    client.rpc = (name, payload) => {
      client.calls.push(['rpc', name, payload]);
      return new Promise(() => {});
    };
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    root.querySelector('#finish-event-ev1').click();
    root.querySelector('#confirm-finish-ev1').click();
    root.querySelector('#finish-event-ev1').click();
    expect(root.querySelector('#confirm-finish-ev1')).toBeNull();
    expect(root.querySelector('#finish-event-ev1').textContent).toBe('Finishing…');
    expect(
      client.calls.filter(([action, name]) => action === 'rpc' && name === 'finish_event'),
    ).toHaveLength(1);
    root.remove();
  });

  it('a second click on a stale Confirm button sends only one finish call', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false, ended_at: null }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    root.querySelector('#finish-event-ev1').click();
    const confirm = root.querySelector('#confirm-finish-ev1');
    confirm.click();
    confirm.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Finished'));
    expect(
      client.calls.filter(([action, name]) => action === 'rpc' && name === 'finish_event'),
    ).toHaveLength(1);
    root.remove();
  });

  it('keeps a generic refused-finish error in an alert and restores focus to Finish', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false, ended_at: null }],
      rpcResult: { data: null, error: new Error('finish_event: event not found') },
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    root.querySelector('#finish-event-ev1').click();
    root.querySelector('#confirm-finish-ev1').click();
    await vi.waitFor(() =>
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(
        "Couldn't finish this event. Please try again.",
      ),
    );
    expect(root.textContent).not.toContain('event not found');
    expect(document.activeElement).toBe(root.querySelector('#finish-event-ev1'));
    root.remove();
  });

  describe('the organiser home (2026-11-17)', () => {
    const NOW = () => new Date('2026-11-17T10:00:00');
    const FORMATS = [
      { value: 'cup_taster', label: 'Cup Taster' },
      { value: 'btc', label: 'BTC' },
      { value: 'throwdown', label: 'Throwdown' },
    ];
    const EVENTS = [
      {
        id: 'live',
        format: 'btc',
        name: 'Borneo Team Brew-Off',
        event_date: '2026-11-21',
        venue: 'The Roastery',
        city: 'Gadong',
        is_test: false,
        ended_at: null,
      },
      {
        id: 'cup',
        format: 'cup_taster',
        name: 'Brunei Cup Tasters Open',
        event_date: '2026-12-05',
        venue: 'Kopi Kaki HQ',
        city: null,
        is_test: false,
        ended_at: null,
      },
      {
        id: 'latte',
        format: 'throwdown',
        name: 'Latte Art Throwdown',
        event_date: null,
        venue: null,
        city: null,
        is_test: false,
        ended_at: null,
      },
      {
        id: 'rehearsal',
        format: 'btc',
        name: 'Rehearsal run',
        event_date: '2026-11-19',
        venue: 'The Roastery',
        city: null,
        is_test: true,
        ended_at: null,
      },
      {
        id: 'old1',
        format: 'cup_taster',
        name: 'Cup Tasters Open, Oct',
        event_date: '2026-10-04',
        venue: 'HQ',
        city: null,
        is_test: false,
        ended_at: '2026-10-05T00:00:00Z',
      },
      {
        id: 'old2',
        format: 'btc',
        name: 'Old test bracket',
        event_date: '2026-09-04',
        venue: 'HQ',
        city: null,
        is_test: true,
        ended_at: '2026-09-05T00:00:00Z',
      },
    ];
    const SUMMARIES = [
      { event_id: 'live', is_live: true, facts: { matches: 10, matches_confirmed: 6 } },
      { event_id: 'cup', is_live: false, facts: { entries_active: 16 } },
      { event_id: 'latte', is_live: false, facts: { entries_active: 0 } },
    ];
    // What a composition root's describeEvent returns, by event id: this file never names a format's words.
    const describeEvent = (event, facts, { isLive }) => {
      if (!facts) return null;
      if (event.id === 'live') {
        return {
          summary: '6 of 10 matches done',
          phase: 'Round 2',
          next: 'next: score match 17',
          progress: { done: 6, total: 10, active: 2, text: '6 of 10 confirmed · 2 scoring' },
          action: { label: 'Score match 17', href: '#/events/live/matches/m17/scoring' },
          attention: [],
          ready: true,
        };
      }
      if (event.id === 'cup') return { summary: '16 cuppers · 4 heats drawn', ready: true };
      if (event.id === 'latte') {
        return {
          summary: 'no judges yet',
          ready: false,
          attention: [{ id: 'no-judges', severity: 'warning', text: 'has no judges yet.' }],
        };
      }
      return { summary: isLive ? 'live' : 'old', ready: null };
    };
    function mountHome(extra = {}) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      homeRoots.push(root);
      const client = extra.client ?? fakeClient({ events: EVENTS, summaries: SUMMARIES });
      const screen = mountEventsScreen(root, {
        orgId: 'org1',
        orgName: 'Kopi Kaki Collective',
        client,
        formatOptions: FORMATS,
        describeEvent,
        now: NOW,
        ...extra,
      });
      return { root, client, screen };
    }
    const homeRoots = [];
    afterEach(() => {
      for (const root of homeRoots.splice(0)) root.remove();
    });
    const rowNames = (container) =>
      [...container.querySelectorAll('.events-row .events-row-title a')].map((a) => a.textContent);

    it('asks for what each event has in ONE read for the organisation, not one per event', async () => {
      const { client, screen } = mountHome();
      await screen;
      expect(client.summaryReads).toEqual([{ p_org_id: 'org1' }]);
    });

    it('shows a Live now card: format, date and venue, phase, next step, a progress meter in words, and Open event', async () => {
      const { root, screen } = mountHome();
      await screen;
      const card = root.querySelector('.events-featured--live');
      expect(card.querySelector('.status[data-state="live"]').textContent).toBe('Live now');
      expect(card.querySelector('.events-format-tag').textContent).toBe('BTC');
      expect(card.textContent).toContain('Sat 21 Nov · The Roastery · Gadong');
      expect(card.querySelector('h2').textContent).toBe('Borneo Team Brew-Off');
      expect(card.querySelector('.events-featured-state').textContent).toBe(
        'Round 2 · next: score match 17',
      );
      const meter = card.querySelector('[role="meter"]');
      expect(meter.getAttribute('aria-valuenow')).toBe('6');
      expect(meter.getAttribute('aria-valuemax')).toBe('10');
      expect(meter.getAttribute('aria-valuetext')).toBe('6 of 10 confirmed · 2 scoring');
      expect(card.querySelector('.events-featured-figures').textContent).toContain('2 scoring');
      const open = [...card.querySelectorAll('a')].find((a) => a.textContent === 'Open event');
      expect(open.getAttribute('href')).toBe('#/events/live');
      const next = [...card.querySelectorAll('a')].find((a) => a.textContent === 'Score match 17');
      expect(next.getAttribute('href')).toBe('#/events/live/matches/m17/scoring');
    });

    it('does not repeat the live event in the list below it', async () => {
      const { root, screen } = mountHome();
      await screen;
      expect(rowNames(root)).not.toContain('Borneo Team Brew-Off');
    });

    it('with nothing live, features the soonest dated open event as Coming up next, and leaves it out of the list', async () => {
      const client = fakeClient({ events: EVENTS, summaries: [] });
      const { root, screen } = mountHome({ client });
      await screen;
      expect(root.querySelector('.events-featured--live')).toBeNull();
      const card = root.querySelector('.events-featured');
      // 19 Nov (the rehearsal) is the soonest dated open event from the 17th.
      expect(card.querySelector('.events-featured-eyebrow').textContent).toBe('Coming up next');
      expect(card.querySelector('h2').textContent).toBe('Rehearsal run');
      expect(rowNames(root)).not.toContain('Rehearsal run');
      expect(rowNames(root)).toContain('Borneo Team Brew-Off');
    });

    it('groups the rest as "Coming up and in setup" and a collapsed "Finished", each with its count, in the order the list came', async () => {
      const { root, screen } = mountHome();
      await screen;
      const headings = [...root.querySelectorAll('.events-group-heading')].map(
        (h) => h.textContent,
      );
      // live is featured, so three open events remain
      expect(headings).toEqual(['Coming up and in setup · 3']);
      expect(rowNames(root.querySelector('.events-list'))).toEqual([
        'Brunei Cup Tasters Open',
        'Latte Art Throwdown',
        'Rehearsal run',
      ]);
      const toggle = root.querySelector('#events-finished-toggle');
      expect(toggle.textContent).toContain('Finished · 2');
      expect(toggle.textContent).toContain('Latest: Cup Tasters Open, Oct');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(root.querySelector('#events-finished-list').hidden).toBe(true);
    });

    it('opens and closes the Finished group from its toggle, keeping focus on the toggle', async () => {
      const { root, screen } = mountHome();
      await screen;
      root.querySelector('#events-finished-toggle').click();
      const toggle = root.querySelector('#events-finished-toggle');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(root.querySelector('#events-finished-list').hidden).toBe(false);
      expect(document.activeElement).toBe(toggle);
      expect(rowNames(root.querySelector('#events-finished-list'))).toEqual([
        'Cup Tasters Open, Oct',
        'Old test bracket',
      ]);
      toggle.click();
      expect(root.querySelector('#events-finished-toggle').getAttribute('aria-expanded')).toBe(
        'false',
      );
    });

    it('says the counts under the heading, and names the organisation above it as text', async () => {
      const { root, screen } = mountHome({ orgName: '<b>Kopi</b>' });
      await screen;
      expect(root.querySelector('.events-counts').textContent).toBe(
        '1 live · 3 coming up · 2 finished',
      );
      expect(root.querySelector('.events-org-eyebrow').textContent).toBe('<b>Kopi</b>');
      expect(root.querySelector('h1').textContent).toBe('Events');
    });

    it('each row shows format, name, date · venue · city, the format words and a status tag', async () => {
      const { root, screen } = mountHome();
      await screen;
      const rows = [...root.querySelectorAll('.events-row')];
      const cup = rows.find((r) => r.dataset.eventId === 'cup');
      expect(cup.querySelector('.events-format-tag').textContent).toBe('Cup Taster');
      expect(cup.textContent).toContain('Sat 5 Dec · Kopi Kaki HQ');
      expect(cup.querySelector('.events-row-summary').textContent).toBe(
        '16 cuppers · 4 heats drawn',
      );
      expect(cup.querySelector('.events-row-tags .status').textContent).toBe('Ready');
      const latte = rows.find((r) => r.dataset.eventId === 'latte');
      expect(latte.querySelector('.events-row-tags .status').textContent).toBe('In setup');
    });

    it('a row for an event that has no summary shows no invented state line, and is still listed', async () => {
      const { root, screen } = mountHome({ describeEvent: null });
      await screen;
      expect(rowNames(root.querySelector('.events-list'))).toContain('Latte Art Throwdown');
      expect(root.querySelector('.events-row-summary')).toBeNull();
    });

    it('a failed summary read never fails the screen: every event is still listed, with no state lines', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = fakeClient({
        events: EVENTS,
        summariesError: { code: 'XX000', message: 'boom' },
      });
      const { root, screen } = mountHome({ client });
      await screen;
      expect(root.querySelector('[data-tone="error"]')).toBeNull();
      expect(rowNames(root)).toContain('Brunei Cup Tasters Open');
      expect(root.querySelector('.events-row-summary')).toBeNull();
      spy.mockRestore();
    });

    it('a describeEvent that throws costs that row its words, not the page', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { root, screen } = mountHome({
        describeEvent: () => {
          throw new Error('format bug');
        },
      });
      await screen;
      expect(rowNames(root)).toContain('Brunei Cup Tasters Open');
      spy.mockRestore();
    });

    it('test data is tagged on its row (violet state) and on the featured card (D9), whatever else is true', async () => {
      const { root, screen } = mountHome({ client: fakeClient({ events: EVENTS, summaries: [] }) });
      await screen;
      const featured = root.querySelector('.events-featured');
      expect(featured.querySelector('.status[data-state="test"]').textContent).toBe('Test data');
      await screen;
      root.querySelector('#events-finished-toggle').click();
      const old = root.querySelector('[data-event-id="old2"]');
      expect(old.querySelector('.status[data-state="test"]').textContent).toBe('Test data');
      expect(old.querySelector('.status[data-state="done"]').textContent).toBe('Finished');
    });

    it('a LIVE test event wears the test tag on the Live now card too (D9)', async () => {
      const events = EVENTS.map((e) => (e.id === 'live' ? { ...e, is_test: true } : e));
      const { root, screen } = mountHome({ client: fakeClient({ events, summaries: SUMMARIES }) });
      await screen;
      expect(
        root.querySelector('.events-featured--live .status[data-state="test"]').textContent,
      ).toBe('Test data');
    });

    describe('the format filter', () => {
      it('is drawn only when more than one format is configured', async () => {
        for (const formatOptions of [undefined, [FORMATS[0]]]) {
          const { root, screen } = mountHome({ formatOptions });
          await screen;
          expect(root.querySelector('.events-filter')).toBeNull();
        }
        const { root, screen } = mountHome();
        await screen;
        expect(root.querySelector('.events-filter')).not.toBeNull();
      });

      it('offers chips (wide) and a select (phone) with the same choices, All first', async () => {
        const { root, screen } = mountHome();
        await screen;
        expect(
          [...root.querySelectorAll('.events-choice')].map((chip) => [
            chip.textContent,
            chip.getAttribute('aria-pressed'),
          ]),
        ).toEqual([
          ['All', 'true'],
          ['Cup Taster', 'false'],
          ['BTC', 'false'],
          ['Throwdown', 'false'],
        ]);
        expect(
          [...root.querySelectorAll('#events-filter-select option')].map((o) => o.textContent),
        ).toEqual(['All formats', 'Cup Taster', 'BTC', 'Throwdown']);
        expect(root.querySelector('label[for="events-filter-select"]')).not.toBeNull();
      });

      it('a chip narrows the list to that format, says which is pressed, and keeps focus on it', async () => {
        const { root, screen } = mountHome();
        await screen;
        root.querySelector('#events-filter-chip-throwdown').click();
        expect(rowNames(root.querySelector('.events-list'))).toEqual(['Latte Art Throwdown']);
        const chip = root.querySelector('#events-filter-chip-throwdown');
        expect(chip.getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('#events-filter-chip-all').getAttribute('aria-pressed')).toBe(
          'false',
        );
        expect(document.activeElement).toBe(chip);
        expect(root.querySelector('#events-filter-select').value).toBe('throwdown');
        expect(root.querySelector('.events-group-heading').textContent).toBe(
          'Coming up and in setup · 1',
        );
      });

      it('the select does the same, and a format with no events says so in words', async () => {
        const events = EVENTS.filter((event) => event.format !== 'throwdown');
        const { root, screen } = mountHome({
          client: fakeClient({ events, summaries: SUMMARIES }),
        });
        await screen;
        const select = root.querySelector('#events-filter-select');
        select.value = 'throwdown';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(root.querySelector('.events-group-none').textContent).toBe(
          'No Throwdown events coming up.',
        );
        expect(document.activeElement).toBe(root.querySelector('#events-filter-select'));
        // back to all
        const again = root.querySelector('#events-filter-select');
        again.value = 'all';
        again.dispatchEvent(new Event('change', { bubbles: true }));
        expect(rowNames(root.querySelector('.events-list')).length).toBeGreaterThan(1);
      });

      it('narrows the list only: the live card, the counts and Needs attention still cover every format', async () => {
        const { root, screen } = mountHome();
        await screen;
        root.querySelector('#events-filter-chip-cup_taster').click();
        expect(root.querySelector('.events-featured--live h2').textContent).toBe(
          'Borneo Team Brew-Off',
        );
        expect(root.querySelector('.events-counts').textContent).toBe(
          '1 live · 3 coming up · 2 finished',
        );
        expect(root.querySelector('.ok-warn').textContent).toContain('Latte Art Throwdown');
      });

      it('filters the Finished group too', async () => {
        const { root, screen } = mountHome();
        await screen;
        root.querySelector('#events-filter-chip-btc').click();
        expect(root.querySelector('#events-finished-toggle').textContent).toContain('Finished · 1');
        root.querySelector('#events-filter-chip-throwdown').click();
        expect(root.querySelector('#events-finished-toggle')).toBeNull();
      });
    });

    describe('Needs attention across events', () => {
      it('collects the format items (named for their event), no-venue and test data left waiting, worst first', async () => {
        const { root, screen } = mountHome();
        await screen;
        const card = root.querySelector('.ok-warn');
        const items = [...card.querySelectorAll('.ok-warn-item')].map((li) => li.textContent);
        expect(card.querySelector('h2').textContent).toContain('Needs attention');
        expect(items.some((t) => t.includes('Latte Art Throwdown: has no judges yet.'))).toBe(true);
        expect(items.some((t) => t.includes('Latte Art Throwdown has no venue yet.'))).toBe(true);
        expect(
          items.some((t) => t.includes('Rehearsal run is test data: delete it when you are done.')),
        ).toBe(true);
        // a warning outranks a note
        expect(card.querySelector('.ok-warn-item').dataset.severity).toBe('warning');
        const link = [...card.querySelectorAll('a')].find((a) =>
          a.closest('li').textContent.includes('no judges'),
        );
        expect(link.getAttribute('href')).toBe('#/events/latte');
      });

      it("leaves out the live event's test-data note and every finished event", async () => {
        const events = [
          { ...EVENTS[0], is_test: true },
          { ...EVENTS[4], venue: null },
        ];
        const { root, screen } = mountHome({
          client: fakeClient({ events, summaries: SUMMARIES }),
        });
        await screen;
        expect(root.querySelector('.ok-warn .ok-warn-item')).toBeNull();
        expect(root.querySelector('.ok-warn').textContent).toContain('Nothing needs attention.');
      });
    });

    describe("Finish and Delete are off the row's main line", () => {
      it('sit behind a Manage toggle that names its event and says whether it is open', async () => {
        const { root, screen } = mountHome();
        await screen;
        const toggle = root.querySelector('#manage-cup');
        expect(toggle.getAttribute('aria-label')).toBe('Manage "Brunei Cup Tasters Open"');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        const panel = root.querySelector(`#${toggle.getAttribute('aria-controls')}`);
        expect(panel.hidden).toBe(true);
        expect(panel.querySelector('#finish-event-cup')).not.toBeNull();
        toggle.click();
        expect(root.querySelector('#manage-cup').getAttribute('aria-expanded')).toBe('true');
        expect(root.querySelector('#manage-panel-cup').hidden).toBe(false);
        expect(document.activeElement).toBe(root.querySelector('#manage-cup'));
        root.querySelector('#manage-cup').click();
        expect(root.querySelector('#manage-panel-cup').hidden).toBe(true);
      });

      it('offers Delete only for test data, and no toggle at all where there is nothing to manage', async () => {
        const { root, screen } = mountHome();
        await screen;
        expect(
          root.querySelector('#manage-panel-rehearsal #delete-event-rehearsal'),
        ).not.toBeNull();
        expect(root.querySelector('#manage-panel-cup #delete-event-cup')).toBeNull();
        root.querySelector('#events-finished-toggle').click();
        // finished, real, no archive panel: nothing to manage
        expect(root.querySelector('#manage-old1')).toBeNull();
        // finished test data can still be deleted
        expect(root.querySelector('#manage-panel-old2 #delete-event-old2')).not.toBeNull();
      });

      it('keeps the live event reachable: Finish is on its card', async () => {
        const { root, screen } = mountHome();
        await screen;
        const panel = root.querySelector('.events-featured--live #manage-panel-live');
        expect(panel.querySelector('#finish-event-live')).not.toBeNull();
      });

      it('a flow in progress keeps its panel open, and Cancel leaves it open with focus on the button', async () => {
        const { root, screen } = mountHome();
        await screen;
        root.querySelector('#finish-event-cup').click();
        expect(root.querySelector('#manage-panel-cup').hidden).toBe(false);
        expect(document.activeElement).toBe(root.querySelector('#confirm-finish-cup'));
        root.querySelector('#cancel-finish-cup').click();
        expect(root.querySelector('#manage-panel-cup').hidden).toBe(false);
        expect(document.activeElement).toBe(root.querySelector('#finish-event-cup'));
      });

      it('finishing moves the event to the Finished group and says so', async () => {
        const { root, client, screen } = mountHome();
        await screen;
        root.querySelector('#finish-event-cup').click();
        root.querySelector('#confirm-finish-cup').click();
        await vi.waitFor(() =>
          expect(client.calls).toContainEqual([
            'rpc',
            'finish_event',
            { p_org_id: 'org1', p_event_id: 'cup' },
          ]),
        );
        await vi.waitFor(() =>
          expect(root.querySelector('.events-counts').textContent).toContain('3 finished'),
        );
        expect(rowNames(root.querySelector('.events-list'))).not.toContain(
          'Brunei Cup Tasters Open',
        );
        expect(root.querySelector('.screen-feedback').textContent).toBe('Event finished.');
      });

      it('deleting test data inside the collapsed Finished group opens the group for the flow', async () => {
        const { root, screen } = mountHome();
        await screen;
        root.querySelector('#delete-event-old2').click();
        await vi.waitFor(() => expect(root.querySelector('#confirm-delete-old2')).not.toBeNull());
        expect(root.querySelector('#events-finished-list').hidden).toBe(false);
        expect(root.querySelector('#manage-panel-old2').hidden).toBe(false);
        expect(document.activeElement).toBe(root.querySelector('#confirm-delete-old2'));
      });
    });

    describe('the rail and the new-event link', () => {
      it('lists the organisation links the caller gives, as links with their counts as text', async () => {
        const { root, screen } = mountHome({
          orgLinks: [
            { label: 'People', href: '#/people', meta: '64' },
            { label: 'Team logins', href: '#/team' },
            { label: 'Published results', href: '/results/' },
            { label: 'No link', href: null },
          ],
        });
        await screen;
        const links = [...root.querySelectorAll('.events-org-link')];
        expect(links.map((a) => [a.firstChild.textContent, a.getAttribute('href')])).toEqual([
          ['People', '#/people'],
          ['Team logins', '#/team'],
          ['Published results', '/results/'],
        ]);
        expect(links[0].querySelector('.events-org-meta').textContent).toBe('64');
        expect(root.querySelector('#events-org-heading').textContent).toBe('Your organisation');
      });

      it('draws no organisation card when it has no links to give', async () => {
        const { root, screen } = mountHome();
        await screen;
        expect(root.querySelector('.events-org')).toBeNull();
      });

      it('has one + New event link in the header and one after the list (CSS shows one at a time), both to the new-event route', async () => {
        const { root, screen } = mountHome({ newEventHref: '#/events/new' });
        await screen;
        const links = [...root.querySelectorAll('a.events-new')];
        expect(
          links.map((a) => a.className.includes('--header') || a.className.includes('--foot')),
        ).toEqual([true, true]);
        for (const link of links) {
          expect(link.getAttribute('href')).toBe('#/events/new');
          expect(link.textContent).toBe('+ New event');
          expect(link.classList.contains('btn-primary') && link.classList.contains('btn-lg')).toBe(
            true,
          );
          expect(link.getAttribute('aria-label')).toBe('New event in Kopi Kaki Collective');
        }
        // the only bevelled primary button on the page
        expect(root.querySelectorAll('.btn-primary.btn-lg')).toHaveLength(2);
        expect(root.querySelectorAll('.btn-primary:not(.btn-lg)').length).toBeLessThanOrEqual(1);
      });

      it('puts needs attention before the list on a phone (DOM slots the stylesheet orders)', async () => {
        const { root, screen } = mountHome({
          audienceLinks: { phone: 'https://x/p', projector: 'https://x/pr', splash: 'https://x/s' },
        });
        await screen;
        for (const slot of ['featured', 'attention', 'list', 'audience']) {
          expect(root.querySelector(`.events-slot-${slot}`), slot).not.toBeNull();
        }
        expect(root.querySelector('.events-home-rail .events-slot-attention')).not.toBeNull();
        expect(root.querySelector('.events-home-main .events-slot-list')).not.toBeNull();
      });
    });

    it('redraws the organisation links when they really change after the screen is up, and not when they do not', async () => {
      let isOwner = false;
      let notify = () => {};
      const unsubscribe = vi.fn();
      const links = () => [
        { label: 'People', href: '#/people' },
        ...(isOwner ? [{ label: 'Team logins', href: '#/team' }] : []),
      ];
      const { root, screen } = mountHome({
        orgLinks: links,
        subscribeOrgLinks: (callback) => {
          notify = callback;
          return unsubscribe;
        },
      });
      const handle = await screen;
      const labels = () =>
        [...root.querySelectorAll('.events-org-link')].map((a) => a.firstChild.textContent);
      expect(labels()).toEqual(['People']);
      const card = root.querySelector('.events-org');
      notify();
      expect(root.querySelector('.events-org')).toBe(card);
      isOwner = true;
      notify();
      expect(labels()).toEqual(['People', 'Team logins']);
      handle.unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('a late links change never paints over a superseded screen', async () => {
      let notify = () => {};
      let more = false;
      const controller = new AbortController();
      const { root, screen } = mountHome({
        signal: controller.signal,
        orgLinks: () => [
          { label: 'People', href: '#/people' },
          ...(more ? [{ label: 'Team logins', href: '#/team' }] : []),
        ],
        subscribeOrgLinks: (callback) => {
          notify = callback;
          return () => {};
        },
      });
      await screen;
      controller.abort();
      root.innerHTML = '<p>the next screen</p>';
      more = true;
      notify();
      expect(root.innerHTML).toBe('<p>the next screen</p>');
    });

    it('with no events at all says so and shows the way to a new one, no list, no filter', async () => {
      const { root, screen } = mountHome({ client: fakeClient({ events: [], summaries: [] }) });
      await screen;
      expect(root.querySelector('#events-none-heading').textContent).toBe('No events yet');
      expect(root.querySelector('.events-counts').textContent).toBe('No events yet');
      expect(root.querySelector('.events-list')).toBeNull();
      expect(root.querySelector('.events-featured')).toBeNull();
      expect(root.querySelector('a.events-new--header')).not.toBeNull();
    });
  });

  it("shows each event's own format label on its row when formats are configured", async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      events: [
        { id: 'ev1', org_id: 'org1', name: 'October Cup', format: 'cup_taster', is_test: false },
        { id: 'ev2', org_id: 'org1', name: 'Regional Bracket', format: 'btc', is_test: false },
      ],
    });
    await mountEventsScreen(root, {
      orgId: 'org1',
      client,
      formatOptions: [
        { value: 'cup_taster', label: 'Cup Taster' },
        { value: 'btc', label: 'BTC' },
      ],
    });
    const text = [...root.querySelectorAll('.events-format-tag')].map((t) => t.textContent);
    expect(text).toContain('Cup Taster');
    expect(text).toContain('BTC');
  });

  it('draws no format tag when no formats are configured', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      events: [
        { id: 'ev1', org_id: 'org1', name: 'October Cup', format: 'cup_taster', is_test: false },
      ],
    });
    await mountEventsScreen(root, { orgId: 'org1', client });
    expect(root.querySelector('.events-format-tag')).toBeNull();
  });

  describe('renderFormatFilter', () => {
    it('returns nothing for one format or none, and calls back with the value and where focus goes', () => {
      expect(renderFormatFilter(undefined, 'all', () => {})).toBeNull();
      expect(renderFormatFilter([{ value: 'a', label: 'A' }], 'all', () => {})).toBeNull();
      const onChange = vi.fn();
      const filter = renderFormatFilter(
        [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        'all',
        onChange,
      );
      filter.querySelector('#events-filter-chip-b').click();
      expect(onChange).toHaveBeenCalledWith('b', '#events-filter-chip-b');
    });
  });

  it('renders a Retry-capable error state when the initial load fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = { from: () => ({ from: () => {} }) };
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    expect(root.querySelector('button').textContent).toBe('Retry');
  });

  describe('a genuinely hung load', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out rather than leaving the screen on "Loading…" forever', async () => {
      function hungBuilder() {
        const b = {
          select: () => b,
          eq: () => b,
          order: () => b,
          then: () => new Promise(() => {}),
        };
        return b;
      }
      const hungClient = { from: () => hungBuilder() };
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mountPromise = mountEventsScreen(root, {
        orgId: 'org1',
        client: hungClient,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Loading events');

      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS);
      await mountPromise;

      const feedback = root.querySelector('.screen-feedback');
      expect(feedback.dataset.tone).toBe('error');
      expect(feedback.textContent).toMatch(/taking longer than expected/i);
    });
  });

  it('never writes to root again once its own signal is aborted mid-load — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): this screen's own load is still in flight when the
    // router (in production) decides a newer navigation has superseded it
    // and aborts this mount's signal — well before this screen's own
    // attemptLoad() promise gets a chance to resolve. A discarded screen's
    // late render() must never clobber whatever's actually on screen now.
    let resolveQuery;
    const controllableClient = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          then: (resolve) => {
            resolveQuery = () => resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountEventsScreen(root, {
      orgId: 'org1',
      client: controllableClient,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveQuery).toBeDefined());
    expect(root.textContent).toContain('Loading events');

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-loading screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    // The router aborts a superseded mount's signal the instant a newer
    // navigation starts — simulated directly here, then the slow query
    // FINALLY resolves, same as a late network response arriving after
    // the user has already moved on.
    controller.abort();
    resolveQuery();
    await mountPromise;

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own event list.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('No events yet');
  });

  // offline-sync-auditor D1, 2026-09-27: deleting a test event while this
  // device still has queued writes turns the leftovers into "N writes lost"
  // on the sync panel — a false alarm on event day. The confirm step says so.
  describe('unsynced-writes warning on delete', () => {
    const PLURAL_2 = `2 writes on this device haven't synced yet. Deleting now can make them show as lost on the sync panel until this tab is closed. Cancel, wait a moment, then click Delete again to re-check.`;
    const COULD_NOT_CHECK = `Couldn't check this device for writes that haven't synced yet. Cancel, then click Delete again to re-check.`;

    beforeEach(async () => {
      await _clearAllForTests();
    });

    function mountWithTestEvent(root, options = {}) {
      const client = fakeClient({
        events: [{ id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true }],
      });
      return {
        client,
        mounted: mountEventsScreen(root, {
          orgId: 'org1',
          client,
          ...options,
        }),
      };
    }

    it('warns in the confirm step, and on the focused Confirm button, counting writes queued up to the click', async () => {
      await enqueueOperation('confirm_heat', { heatId: 'h1' });
      const root = document.createElement('div');
      document.body.appendChild(root);
      try {
        await mountWithTestEvent(root).mounted;
        // Queued after mount: the count must be read at click time.
        await enqueueOperation('record_heat_time', { heatEntryId: 'he1' });

        await openDeleteConfirm(root, 'ev1');

        expect(root.querySelector('#delete-warning-ev1').textContent).toBe(PLURAL_2);
        const confirm = root.querySelector('#confirm-delete-ev1');
        expect(confirm.getAttribute('aria-describedby')).toBe('delete-warning-ev1');
        expect(document.activeElement).toBe(confirm);
      } finally {
        document.body.removeChild(root);
      }
    });

    it('counts what any account queued for THIS organisation, and nothing queued for another one (T-TEN.C6)', async () => {
      try {
        setOutboxOwner({ userId: 'alice', orgId: 'org1' });
        await enqueueOperation('confirm_heat', { p_org_id: 'org1', p_heat_id: 'h1' });
        setOutboxOwner({ userId: 'bob', orgId: 'org2' });
        await enqueueOperation('confirm_heat', { p_org_id: 'org2', p_heat_id: 'h2' });
        // somebody else is signed in now: the warning is about the event's organisation, not the signed-in account
        setOutboxOwner({ userId: 'carol', orgId: 'org1' });
        const root = document.createElement('div');
        document.body.appendChild(root);
        try {
          await mountWithTestEvent(root).mounted;
          await openDeleteConfirm(root, 'ev1');
          expect(root.querySelector('#delete-warning-ev1').textContent).toContain(
            "1 write on this device hasn't synced yet.",
          );
        } finally {
          document.body.removeChild(root);
        }
      } finally {
        _resetOutboxOwnerForTests();
      }
    });

    it('shows no warning when nothing is queued', async () => {
      const root = document.createElement('div');
      await mountWithTestEvent(root).mounted;

      await openDeleteConfirm(root, 'ev1');

      expect(root.querySelector('#delete-warning-ev1')).toBeNull();
      expect(root.querySelector('#confirm-delete-ev1').hasAttribute('aria-describedby')).toBe(
        false,
      );
    });

    it("says it couldn't check when the queue read fails, rather than staying silent", async () => {
      const root = document.createElement('div');
      // A long timeout, so only the rejection path can produce the message.
      await mountWithTestEvent(root, { unsyncedCheckTimeoutMs: 60000 }).mounted;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const realGetAll = IDBIndex.prototype.getAll; // outboxListAll reads via the createdAt index
      IDBIndex.prototype.getAll = function failingGetAll() {
        throw new Error('IndexedDB unavailable');
      };
      try {
        await openDeleteConfirm(root, 'ev1');
        // Logged, not swallowed.
        expect(consoleError).toHaveBeenCalledWith(
          'eventsScreen: unsynced-writes count failed',
          expect.any(Error),
        );
      } finally {
        IDBIndex.prototype.getAll = realGetAll;
        consoleError.mockRestore();
      }

      expect(root.querySelector('#delete-warning-ev1').textContent).toBe(COULD_NOT_CHECK);
    });

    it("says it couldn't check when the queue read hangs, instead of leaving Delete dead", async () => {
      const root = document.createElement('div');
      await mountWithTestEvent(root, { unsyncedCheckTimeoutMs: 50 }).mounted;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const realGetAll = IDBIndex.prototype.getAll;
      // A request that never fires success or error — a stalled open/read.
      IDBIndex.prototype.getAll = function hangingGetAll() {
        return {};
      };
      try {
        await openDeleteConfirm(root, 'ev1');
      } finally {
        IDBIndex.prototype.getAll = realGetAll;
        consoleError.mockRestore();
      }

      expect(root.querySelector('#delete-warning-ev1').textContent).toBe(COULD_NOT_CHECK);
    });

    // code-reviewer, 2026-09-27: with the count read before the confirm step,
    // a double-click's late second read could reopen the confirm step over a
    // delete already in flight — and a second Confirm would call the RPC twice.
    // The second click's read is made to hang until the (short) timeout, so
    // its result lands deterministically after Confirm. Two guards cover
    // this (no second read starts; a late read is ignored) — each alone is
    // enough, so this test fails only with both gone.
    it('a double-clicked Delete opens one confirm step, and a late read never reopens it over a delete in flight', async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const realGetAll = IDBIndex.prototype.getAll;
      let reads = 0;
      IDBIndex.prototype.getAll = function secondReadHangs(...args) {
        reads += 1;
        return reads === 1 ? realGetAll.apply(this, args) : {};
      };
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { client, mounted } = mountWithTestEvent(root, { unsyncedCheckTimeoutMs: 250 });
        await mounted;
        // The delete RPC stays in flight until released by hand — no timer
        // race between it and the hung read's timeout.
        const realRpc = client.rpc;
        let releaseRpc;
        client.rpc = (...args) =>
          new Promise((resolve) => {
            releaseRpc = resolve;
          }).then(() => realRpc(...args));
        const deleteButton = root.querySelector('#delete-event-ev1');
        const clickedAt = performance.now();
        deleteButton.click();
        deleteButton.click(); // before the first click's read resolves
        await vi.waitFor(() => expect(root.querySelector('#confirm-delete-ev1')).not.toBeNull(), {
          interval: 5,
        });
        // Precondition: Confirm must land before the hung read times out, or
        // this test could no longer catch a late read reopening the step.
        expect(performance.now() - clickedAt).toBeLessThan(250);

        root.querySelector('#confirm-delete-ev1').click();
        await new Promise((resolve) => setTimeout(resolve, 300)); // past the hung read's timeout
        expect(root.querySelector('#confirm-delete-ev1')).toBeNull();
        expect(root.textContent).toContain('Deleting…');

        releaseRpc();
        await vi.waitFor(() => expect(root.textContent).toContain('Event deleted.'));
        expect(client.calls.filter(([action]) => action === 'rpc')).toHaveLength(1);
      } finally {
        IDBIndex.prototype.getAll = realGetAll;
        consoleError.mockRestore();
        document.body.removeChild(root);
      }
    });

    it('uses the singular for one queued write', () => {
      const list = renderEventsList([{ id: 'ev1', name: 'Test Run', is_test: true }], {
        deleteStates: { ev1: 'confirming' },
        unsyncedWrites: 1,
      });
      expect(list.querySelector('#delete-warning-ev1').textContent).toBe(
        `1 write on this device hasn't synced yet. Deleting now can make it show as lost on the sync panel until this tab is closed. Cancel, wait a moment, then click Delete again to re-check.`,
      );
    });

    it("renders the couldn't-check wording for a null count", () => {
      const list = renderEventsList([{ id: 'ev1', name: 'Test Run', is_test: true }], {
        deleteStates: { ev1: 'confirming' },
        unsyncedWrites: null,
      });
      expect(list.querySelector('#delete-warning-ev1').textContent).toBe(COULD_NOT_CHECK);
    });
  });

  it('clicking Delete then Cancel returns to the plain Delete button, without ever calling the RPC', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    await openDeleteConfirm(root, 'ev1');
    expect(root.querySelector('#confirm-delete-ev1')).not.toBeNull();

    root.querySelector('#cancel-delete-ev1').click();
    expect(root.querySelector('#delete-event-ev1')).not.toBeNull();
    expect(client.calls.some(([action]) => action === 'rpc')).toBe(false);
  });

  it('confirming delete calls delete_test_event with orgId/eventId, removes only that row, and shows success', async () => {
    // Two test events, not one — found in review (test-auditor): a
    // single-event fixture can't tell "removed by id" apart from "removed
    // the only element regardless of id" (e.g. events = events.slice(1)
    // would pass just as well as the real events.filter(id !== eventId)).
    // ev2 surviving, untouched and still showing its own plain Delete
    // button throughout, is also the only coverage anywhere in this file
    // for deleteStates' own claimed per-id independence.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [
        { id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true },
        { id: 'ev2', org_id: 'org1', name: 'Other Test Run', is_test: true },
      ],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    await openDeleteConfirm(root, 'ev1');
    expect(root.querySelector('#delete-event-ev2')).not.toBeNull(); // untouched while ev1 confirms
    root.querySelector('#confirm-delete-ev1').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls).toContainEqual([
      'rpc',
      'delete_test_event',
      { p_org_id: 'org1', p_event_id: 'ev1' },
    ]);
    // Precise selectors, not a text-substring check — "Other Test Run"
    // itself contains "Test Run", so a bare toContain('Test Run') would
    // stay true even after ev1's own row is correctly gone.
    expect(root.querySelector('#delete-event-ev1')).toBeNull();
    expect(root.querySelector('#delete-event-ev2')).not.toBeNull();
    expect(root.textContent).toContain('Other Test Run');
    expect(root.querySelector('.screen-feedback').textContent).toBe('Event deleted.');
  });

  it('a rapid double-click on Confirm delete enqueues only one delete_test_event call', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev1', org_id: 'org1', name: 'Test Run', is_test: true }],
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    await openDeleteConfirm(root, 'ev1');
    const confirmButton = root.querySelector('#confirm-delete-ev1');
    // Both clicks dispatched before either handler's own await yields —
    // proves the guard itself (deleteStates[eventId] === 'deleting'), not
    // just that the button happened to already be gone by the second click.
    confirmButton.click();
    confirmButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls.filter(([action]) => action === 'rpc')).toHaveLength(1);
  });

  it('a delete_test_event failure (e.g. the server refusing a non-test event) shows the error and leaves the row in place', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      events: [{ id: 'ev2', org_id: 'org1', name: 'Real Event', is_test: true }],
      rpcResult: {
        data: null,
        error: new Error('delete_test_event: refusing to delete a non-test event (ev2)'),
      },
    });
    await mountEventsScreen(root, { orgId: 'org1', client, defaultFormat: 'cup_taster' });

    await openDeleteConfirm(root, 'ev2');
    root.querySelector('#confirm-delete-ev2').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('Real Event');
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    // Back to the plain Delete button, not stuck showing "Deleting…" forever.
    expect(root.querySelector('#delete-event-ev2')).not.toBeNull();
  });
});

describe('which organisation an event belongs to (T-TEN.C5)', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const h2s = (root) => [...root.querySelectorAll('h2')].map((h) => h.textContent);
  const eyebrow = (root) => root.querySelector('.events-org-eyebrow')?.textContent ?? null;

  it('the home names the organisation above its heading, without the spaces around the name', async () => {
    const root = document.createElement('div');
    await mountEventsScreen(root, {
      orgId: 'org1',
      orgName: '  Alpha Coffee  ',
      client: fakeClient({
        events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false }],
      }),
    });
    expect(eyebrow(root)).toBe('Alpha Coffee');
    expect(root.querySelector('h1').textContent).toBe('Events');
    expect(root.querySelector('a.events-new--header').getAttribute('aria-label')).toBe(
      'New event in Alpha Coffee',
    );
  });

  it('without a name there is no organisation line, and the headings read plainly', async () => {
    for (const none of [undefined, null, '', '   ']) {
      const root = document.createElement('div');
      await mountEventsScreen(root, {
        orgId: 'org1',
        orgName: none,
        client: fakeClient({
          events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false }],
        }),
      });
      expect(eyebrow(root)).toBeNull();
      expect(h2s(root)).toContain('Your events');
      expect(root.querySelector('a.events-new--header').getAttribute('aria-label')).toBe(
        'New event',
      );
    }
  });

  it('writes the name as text, never as markup', async () => {
    const root = document.createElement('div');
    const hostile = '<img src=x onerror=alert(1)>';
    await mountEventsScreen(root, {
      orgId: 'org1',
      orgName: hostile,
      client: fakeClient({
        events: [{ id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: false }],
      }),
    });
    expect(root.querySelector('img')).toBeNull();
    expect(eyebrow(root)).toBe(hostile);
  });

  // A client that honours the organisation: one shared database, `eq('org_id')` filters, and a delete that
  // only removes a row when BOTH the organisation and the event id match (like the real RPC).
  function orgClient(initial) {
    const db = { events: [...initial] };
    const calls = [];
    let insertGate = null;
    return {
      calls,
      db,
      holdInserts(gate) {
        insertGate = gate;
      },
      rpc: (name, payload) => {
        if (name === 'org_event_summaries') return Promise.resolve({ data: [], error: null });
        // The archive panel's plan read (T-ARC.4) is not one of the writes counted here.
        if (name === 'my_entitlements') return Promise.resolve({ data: null, error: null });
        calls.push(['rpc', name, payload]);
        if (name === 'delete_test_event') {
          db.events = db.events.filter(
            (row) => !(row.id === payload.p_event_id && row.org_id === payload.p_org_id),
          );
        }
        return Promise.resolve({ data: null, error: null });
      },
      from(table) {
        let orgFilter = null;
        const builder = {
          select: () => builder,
          insert: (payload) => {
            calls.push(['insert', table, payload]);
            const row = { id: `ev-new-${db.events.length}`, ...payload };
            return {
              select: () => ({
                single: async () => {
                  if (insertGate) await insertGate;
                  db.events.push(row);
                  return { data: row, error: null };
                },
              }),
            };
          },
          eq: (column, value) => {
            calls.push(['eq', table, column, value]);
            if (column === 'org_id') orgFilter = value;
            return builder;
          },
          order: () => builder,
          then: (resolve, reject) =>
            Promise.resolve({
              data: db.events.filter((row) => orgFilter === null || row.org_id === orgFilter),
              error: null,
            }).then(resolve, reject),
        };
        return builder;
      },
    };
  }
  const BOTH = [
    { id: 'ev-a', org_id: 'org1', name: 'Alpha Test Run', is_test: true },
    { id: 'ev-b', org_id: 'org2', name: 'Bravo Test Run', is_test: true },
  ];
  const mounted = [];
  function mountFor(orgId, orgName, client, extra = {}) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(root);
    const screen = mountEventsScreen(root, {
      orgId,
      orgName,
      client,
      ...extra,
    });
    return { root, screen };
  }
  afterEach(() => {
    for (const root of mounted.splice(0)) root.remove();
  });

  it('a screen mounted for the second organisation lists only that organisation', async () => {
    const client = orgClient(BOTH);
    const { root, screen } = mountFor('org2', 'Bravo Roasters', client);
    await screen;
    expect(root.textContent).toContain('Bravo Test Run');
    expect(root.textContent).not.toContain('Alpha Test Run');
  });

  it('reads the list for the organisation it was mounted for, and for no other', async () => {
    const client = orgClient(BOTH);
    const { screen } = mountFor('org2', 'Bravo Roasters', client);
    await screen;
    const listed = client.calls
      .filter(([kind, , column]) => kind === 'eq' && column === 'org_id')
      .map(([, , , value]) => value);
    expect(listed).toEqual(['org2']);
  });

  it("deletes in that organisation, and the other organisation's event is untouched", async () => {
    const client = orgClient(BOTH);
    const { root, screen } = mountFor('org2', 'Bravo Roasters', client);
    await screen;
    await openDeleteConfirm(root, 'ev-b');
    root.querySelector('#confirm-delete-ev-b').click();
    await tick();
    expect(client.calls).toContainEqual([
      'rpc',
      'delete_test_event',
      { p_org_id: 'org2', p_event_id: 'ev-b' },
    ]);
    expect(client.db.events.map((row) => row.id)).toEqual(['ev-a']);
  });

  it('two screens on one client never leak into each other', async () => {
    const client = orgClient(BOTH);
    const first = mountFor('org1', 'Alpha Coffee', client);
    const second = mountFor('org2', 'Bravo Roasters', client);
    await first.screen;
    await second.screen;
    expect(first.root.textContent).not.toContain('Bravo Test Run');
    expect(first.root.textContent).toContain('Alpha Test Run');
    expect(second.root.textContent).not.toContain('Alpha Test Run');
    expect(second.root.textContent).toContain('Bravo Test Run');
    expect(eyebrow(first.root)).toBe('Alpha Coffee');
    expect(eyebrow(second.root)).toBe('Bravo Roasters');
  });

  describe('a screen that has been superseded sends nothing', () => {
    it('a delete confirmed after the signal was aborted is not sent', async () => {
      const client = orgClient(BOTH);
      const controller = new AbortController();
      const { root, screen } = mountFor('org1', 'Alpha Coffee', client, {
        signal: controller.signal,
      });
      await screen;
      await openDeleteConfirm(root, 'ev-a');
      controller.abort();
      root.querySelector('#confirm-delete-ev-a').click();
      await tick();
      expect(client.calls.some(([kind]) => kind === 'rpc')).toBe(false);
      expect(client.db.events.map((row) => row.id)).toContain('ev-a');
    });

    it('a finish confirmed after the signal was aborted is not sent', async () => {
      const client = orgClient([
        { id: 'ev-open', org_id: 'org1', name: 'Open Cup', is_test: false, ended_at: null },
      ]);
      const controller = new AbortController();
      const { root, screen } = mountFor('org1', 'Alpha Coffee', client, {
        signal: controller.signal,
      });
      await screen;
      root.querySelector('#finish-event-ev-open').click();
      controller.abort();
      root.querySelector('#confirm-finish-ev-open').click();
      await tick();
      expect(client.calls.some(([kind]) => kind === 'rpc')).toBe(false);
    });

    it('a screen superseded mid-load paints nothing over the next one', async () => {
      const client = orgClient(BOTH);
      const controller = new AbortController();
      const root = document.createElement('div');
      document.body.appendChild(root);
      mounted.push(root);
      const first = mountEventsScreen(root, {
        orgId: 'org1',
        orgName: 'Alpha Coffee',
        client,
        signal: controller.signal,
      });
      controller.abort();
      await mountEventsScreen(root, { orgId: 'org2', orgName: 'Bravo Roasters', client });
      await first;
      await tick();
      expect(eyebrow(root)).toBe('Bravo Roasters');
      expect(root.textContent).not.toContain('Alpha Test Run');
    });
  });
});

describe('the audience links card on the Events screen (T-TEN.D4)', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const LINKS = {
    phone: 'https://seduh.example/app/#/live/alpha/phone',
    projector: 'https://seduh.example/app/#/live/alpha/projector',
    splash: 'https://seduh.example/app/#/live/alpha/splash',
  };

  it('shows the card, with all three links, when the caller has links for the organisation', async () => {
    const root = document.createElement('div');
    await mountEventsScreen(root, {
      orgId: 'org1',
      orgName: 'Alpha Coffee',
      audienceLinks: LINKS,
      client: fakeClient({ events: [] }),
    });
    expect(root.querySelector('#audience-links-heading').textContent).toBe(
      'Share with your audience',
    );
    expect([...root.querySelectorAll('.audience-links-url')].map((c) => c.textContent)).toEqual([
      LINKS.phone,
      LINKS.projector,
      LINKS.splash,
    ]);
  });

  it('offers the organisation links only when the caller gives some, each a real tap target', async () => {
    const withLink = document.createElement('div');
    await mountEventsScreen(withLink, {
      orgId: 'org1',
      orgLinks: [{ label: 'People', href: '#/people' }],
      client: fakeClient({ events: [] }),
    });
    const link = withLink.querySelector('.events-org a');
    expect(link.getAttribute('href')).toBe('#/people');
    expect(link.textContent).toBe('People');

    const without = document.createElement('div');
    await mountEventsScreen(without, {
      orgId: 'org1',
      client: fakeClient({ events: [] }),
    });
    expect(without.querySelector('.events-org')).toBeNull();
  });

  it('shows no card when there are no links to give', async () => {
    const root = document.createElement('div');
    await mountEventsScreen(root, {
      orgId: 'org1',
      client: fakeClient({ events: [] }),
    });
    expect(root.querySelector('.audience-links-card')).toBeNull();
  });

  it('sits in the rail after Needs attention, never before the events themselves', async () => {
    const root = document.createElement('div');
    await mountEventsScreen(root, {
      orgId: 'org1',
      audienceLinks: LINKS,
      client: fakeClient({ events: [] }),
    });
    const headings = [...root.querySelectorAll('h1, h2')].map((h) => h.textContent);
    expect(headings[0]).toBe('Events');
    expect(headings.indexOf('Needs attention')).toBeLessThan(
      headings.indexOf('Share with your audience'),
    );
    expect(root.querySelector('.events-home-rail .audience-links-card')).not.toBeNull();
  });

  it('is the same card after the screen redraws (a format filter, a Manage toggle): its QR and its "copied" line survive', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountEventsScreen(root, {
      orgId: 'org1',
      audienceLinks: LINKS,
      client: fakeClient({
        events: [
          { id: 'e1', org_id: 'org1', name: 'Open', is_test: false, ended_at: null },
          {
            id: 'e2',
            org_id: 'org1',
            name: 'Done',
            is_test: false,
            ended_at: '2026-10-01T00:00:00Z',
          },
        ],
      }),
    });
    const card = root.querySelector('.audience-links-card');
    root.querySelector('#events-finished-toggle')?.click();
    root.querySelector('.events-manage-toggle')?.click();
    await tick();
    expect(root.querySelector('.audience-links-card')).toBe(card);
    root.remove();
  });
});
