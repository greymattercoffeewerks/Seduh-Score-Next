import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Drives the REAL router through the three audience routes (/live/projector,
// /live/phone, /live/splash) with their REAL screens over the one shared
// bareRoot — main.test.js stubs every screen, so nothing there could have
// caught the two production bugs found on 2026-09-29:
//   1. switching audience views in one tab reused an already-subscribed
//      realtime channel, leaving the second view on "Connecting…";
//   2. once that was fixed, the router's order (mount the NEW screen first,
//      unmount the outgoing one after) let the outgoing screen's unmount()
//      wipe the shared root, leaving a blank page.
// Only what appShell.js needs from the outbox is mocked (jsdom has no
// IndexedDB); everything on the audience path is real.
const flushOutbox = vi.fn(() =>
  Promise.resolve({ processed: 0, stopped: false, permanentFailure: false }),
);
vi.mock('./core/outbox.js', () => ({
  flushOutbox: (...args) => flushOutbox(...args),
  listPendingOperations: () => Promise.resolve([]),
  listOtherOperations: () => Promise.resolve({ otherOrg: [], otherAccount: [] }),
  listAccountOperations: () => Promise.resolve([]),
  payloadOrgId: () => null,
  partitionOperations: () => Promise.resolve({ own: [], otherOrg: [], otherAccount: [] }),
  getOutboxOwner: () => undefined,
  setOutboxOwner: () => {},
  isFlushInProgress: () => false,
  onOperationDropped: () => () => {},
}));
vi.mock('./formats/cup-taster/outboxHandlers.js', () => ({
  cupTasterOutboxHandlers: () => ({}),
  cupTasterOperationLabels: {},
}));
vi.mock('./formats/btc/outboxHandlers.js', () => ({
  btcOutboxHandlers: () => ({}),
  btcOperationLabels: {},
}));

const { mountApp } = await import('./main.js');
const { _clearOrgResolverForTests } = await import('./core/orgResolver.js');

// A client with the two behaviours of supabase-js that caused bug 1:
// channel(topic) returns the channel already registered under that topic,
// and removeChannel() only deregisters it when unsubscribe() answers 'ok'
// (here it never does, as when the connection is slow or dropped).
function fakeClient({ organisers = { alpha: 'org1' }, rpcFailures = 0 } = {}) {
  const registered = new Map();
  const reads = [];
  let failuresLeft = rpcFailures;
  const removedChannels = [];
  const builder = (row, table) => {
    const b = {
      select: () => b,
      eq: (column, value) => {
        reads.push([table, column, value]);
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return b;
  };
  return {
    removedChannels,
    reads,
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: 'o@test.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
    // No live session, but the org has an event: the "Waiting for the
    // organiser" holding state.
    from: (table) => builder(table === 'events' ? { id: 'ev1' } : null, table),
    // public_org_by_slug (T-TEN.B7): one organiser or nothing; `rpcFailures` makes the first calls fail
    // as a dropped connection would.
    rpc: (name, args) => {
      if (name !== 'public_org_by_slug') return Promise.resolve({ data: null, error: null });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      const id = organisers[String(args.p_slug).trim().toLowerCase()];
      return Promise.resolve({
        data: id ? [{ id, name: 'Alpha', slug: args.p_slug }] : [],
        error: null,
      });
    },
    channel(topic) {
      if (registered.has(topic)) return registered.get(topic);
      const chan = {
        subscribed: false,
        on() {
          if (chan.subscribed) {
            throw new Error(
              `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
            );
          }
          return chan;
        },
        subscribe(cb) {
          chan.subscribed = true;
          Promise.resolve().then(() => cb('SUBSCRIBED'));
          return chan;
        },
      };
      registered.set(topic, chan);
      return chan;
    },
    removeChannel(chan) {
      removedChannels.push(chan);
      return Promise.resolve('timed out');
    },
  };
}

// Drains jsdom's double hashchange dispatch (see main.test.js) so a superseded
// mount and its teardown have both run. Only ever used to let things FINISH —
// every positive assertion below waits on the condition itself.
async function drain() {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

let activeApp = null;
beforeEach(async () => {
  _clearOrgResolverForTests();
  location.hash = '';
  sessionStorage.clear();
  await drain();
});
afterEach(async () => {
  // Unmount first: resetting the hash while the app is still listening would
  // mount the real organiser events screen against this minimal fake client.
  await activeApp?.unmount();
  activeApp = null;
  location.hash = '';
  await drain();
});

async function startOn(hash, { client = fakeClient(), ...options } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  // Initial load straight onto an audience route, as a projector laptop's
  // bookmark would — no organiser screen ever mounts.
  location.hash = hash;
  activeApp = mountApp(root, {
    client,
    legacyAudienceOrgId: 'org1',
    legacyAudienceOrgSlug: null,
    ...options,
  });
  await activeApp.ready;
  return { client, bareRoot: root.querySelector('.app-bare-root') };
}

const shell = (bareRoot) => bareRoot.querySelector('.viewer-shell');
const holdingShown = (bareRoot) =>
  expect(bareRoot.textContent).toContain('Waiting for the organiser');

async function go(hash) {
  location.hash = hash;
  await drain();
}

describe('switching between the real audience routes in one tab', () => {
  it('leaves exactly the newest screen on the shared root after every switch — projector -> phone -> splash -> projector', async () => {
    const { client, bareRoot } = await startOn('#/live/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.children).toHaveLength(1);
    expect(shell(bareRoot)).not.toBeNull();
    expect(bareRoot.getAttribute('data-surface')).toBe('stage');

    await go('#/live/phone');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.children).toHaveLength(1);
    expect(shell(bareRoot)).not.toBeNull();
    expect(bareRoot.getAttribute('data-surface')).toBeNull();
    // The first switch's symptom: stuck on the initial holding card.
    expect(bareRoot.textContent).not.toContain('Connecting…');
    // The outgoing view's channel was released, not just abandoned.
    expect(client.removedChannels.length).toBeGreaterThanOrEqual(1);

    await go('#/live/splash');
    await vi.waitFor(() => expect(bareRoot.querySelector('.splash-content')).not.toBeNull());
    expect(shell(bareRoot)).toBeNull();
    expect(client.removedChannels.length).toBeGreaterThanOrEqual(2);

    await go('#/live/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(shell(bareRoot)).not.toBeNull();
    expect(bareRoot.querySelector('.splash-content')).toBeNull();
    expect(bareRoot.children).toHaveLength(1);
    expect(bareRoot.getAttribute('data-surface')).toBe('stage');
    expect(bareRoot.textContent).not.toContain('Connecting…');
  });

  it('leaves exactly the newest screen when the tab starts on the splash and moves to the phone, then the projector', async () => {
    const { bareRoot } = await startOn('#/live/splash');
    await vi.waitFor(() => expect(bareRoot.querySelector('.splash-content')).not.toBeNull());

    await go('#/live/phone');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.querySelector('.splash-content')).toBeNull();
    expect(bareRoot.children).toHaveLength(1);
    expect(bareRoot.textContent).not.toContain('Connecting…');

    await go('#/live/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.children).toHaveLength(1);
    expect(bareRoot.getAttribute('data-surface')).toBe('stage');
    expect(bareRoot.textContent).not.toContain('Connecting…');
  });
});

describe('the same switching through links that name the organiser (T-TEN.D1)', () => {
  it('leaves exactly the newest screen on the shared root after every switch — projector -> phone -> splash -> projector', async () => {
    const { client, bareRoot } = await startOn('#/live/alpha/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.children).toHaveLength(1);
    expect(shell(bareRoot)).not.toBeNull();
    expect(bareRoot.getAttribute('data-surface')).toBe('stage');

    await go('#/live/alpha/phone');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.children).toHaveLength(1);
    expect(bareRoot.getAttribute('data-surface')).toBeNull();
    expect(bareRoot.textContent).not.toContain('Connecting…');
    expect(client.removedChannels.length).toBeGreaterThanOrEqual(1);

    await go('#/live/alpha/splash');
    await vi.waitFor(() => expect(bareRoot.querySelector('.splash-content')).not.toBeNull());
    expect(shell(bareRoot)).toBeNull();

    await go('#/live/alpha/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(shell(bareRoot)).not.toBeNull();
    expect(bareRoot.querySelector('.splash-content')).toBeNull();
    expect(bareRoot.children).toHaveLength(1);
    expect(bareRoot.textContent).not.toContain('Connecting…');
  });

  it('the old slug-less links and the new ones mix freely in one tab', async () => {
    const { bareRoot } = await startOn('#/live/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    await go('#/live/alpha/phone');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.children).toHaveLength(1);
    await go('#/live/splash');
    await vi.waitFor(() => expect(bareRoot.querySelector('.splash-content')).not.toBeNull());
  });

  it('a wrong slug says so on every surface, and a right link afterwards works', async () => {
    const { bareRoot } = await startOn('#/live/nobody/projector');
    await vi.waitFor(() =>
      expect(bareRoot.textContent).toContain('We couldn’t find that organiser'),
    );
    expect(bareRoot.textContent).not.toContain('Waiting for the organiser');
    expect(shell(bareRoot)).toBeNull();
    expect(bareRoot.children).toHaveLength(1);

    await go('#/live/nobody/splash');
    await vi.waitFor(() =>
      expect(bareRoot.textContent).toContain('We couldn’t find that organiser'),
    );
    expect(bareRoot.querySelector('.splash-content')).toBeNull();

    await go('#/live/alpha/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(bareRoot.textContent).not.toContain('We couldn’t find');
    expect(bareRoot.children).toHaveLength(1);
  });

  it('a dropped connection says it is trying again, then the surface appears on its own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      location.hash = '#/live/alpha/phone';
      activeApp = mountApp(root, {
        client: fakeClient({ rpcFailures: 2 }),
        legacyAudienceOrgId: 'org1',
        legacyAudienceOrgSlug: null,
      });
      await vi.advanceTimersByTimeAsync(20);
      const bareRoot = root.querySelector('.app-bare-root');
      expect(bareRoot.textContent).toContain('We can’t reach Seduh right now');
      expect(bareRoot.textContent).not.toContain('We couldn’t find that organiser');
      await vi.advanceTimersByTimeAsync(3100);
      await vi.waitFor(() => holdingShown(bareRoot));
      expect(bareRoot.textContent).not.toContain('This page will update by itself');
      expect(bareRoot.children).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      vi.mocked(Math.random).mockRestore();
    }
  });

  it('the legacy slug serves the old links through the same lookup', async () => {
    const { bareRoot } = await startOn('#/live/phone', {
      legacyAudienceOrgId: null,
      legacyAudienceOrgSlug: 'alpha',
    });
    await vi.waitFor(() => holdingShown(bareRoot));
  });

  it('each organiser link reads its own organisation, and a switch never carries the other one over', async () => {
    const client = fakeClient({ organisers: { alpha: 'org1', bravo: 'org2' } });
    const { bareRoot } = await startOn('#/live/bravo/projector', { client });
    await vi.waitFor(() => holdingShown(bareRoot));
    const orgReads = () =>
      client.reads.filter(([, column]) => column === 'org_id').map(([, , value]) => value);
    expect(new Set(orgReads())).toEqual(new Set(['org2']));

    client.reads.length = 0;
    await go('#/live/alpha/projector');
    await vi.waitFor(() => holdingShown(bareRoot));
    expect(orgReads().length).toBeGreaterThan(0);
    expect(new Set(orgReads())).toEqual(new Set(['org1']));
  });

  it('asks once for a slug however many surfaces the tab shows (and remembers it for the page)', async () => {
    const client = fakeClient();
    const rpc = vi.spyOn(client, 'rpc');
    const { bareRoot } = await startOn('#/live/alpha/projector', { client });
    await vi.waitFor(() => holdingShown(bareRoot));
    await go('#/live/alpha/phone');
    await vi.waitFor(() => holdingShown(bareRoot));
    await go('#/live/alpha/splash');
    await vi.waitFor(() => expect(bareRoot.querySelector('.splash-content')).not.toBeNull());
    expect(
      rpc.mock.calls.filter(([name]) => name === 'public_org_by_slug').length,
    ).toBeLessThanOrEqual(2);
  });

  it('a card, then a surface, leave one child and the right look each time (projector not found -> phone -> splash)', async () => {
    const { bareRoot } = await startOn('#/live/nobody/projector');
    await vi.waitFor(() => expect(bareRoot.textContent).toContain('couldn’t find that organiser'));
    expect(bareRoot.getAttribute('data-surface')).toBe('stage');
    expect(bareRoot.children).toHaveLength(1);

    await go('#/live/alpha/phone');
    await vi.waitFor(() => expect(shell(bareRoot)).not.toBeNull());
    expect(bareRoot.getAttribute('data-surface')).toBeNull();
    expect(bareRoot.children).toHaveLength(1);
    expect(bareRoot.textContent).not.toContain('couldn’t find');

    await go('#/live/alpha/splash');
    await vi.waitFor(() => expect(bareRoot.querySelector('.splash-content')).not.toBeNull());
    expect(bareRoot.getAttribute('data-surface')).toBe('stage');
  });
});
