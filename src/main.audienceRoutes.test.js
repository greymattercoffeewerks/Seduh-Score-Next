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

// A client with the two behaviours of supabase-js that caused bug 1:
// channel(topic) returns the channel already registered under that topic,
// and removeChannel() only deregisters it when unsubscribe() answers 'ok'
// (here it never does, as when the connection is slow or dropped).
function fakeClient() {
  const registered = new Map();
  const removedChannels = [];
  const builder = (row) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return b;
  };
  return {
    removedChannels,
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: 'o@test.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
    // No live session, but the org has an event: the "Waiting for the
    // organiser" holding state.
    from: (table) => builder(table === 'events' ? { id: 'ev1' } : null),
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

async function startOn(hash) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  // Initial load straight onto an audience route, as a projector laptop's
  // bookmark would — no organiser screen ever mounts.
  location.hash = hash;
  const client = fakeClient();
  activeApp = mountApp(root, { client, orgId: 'org1' });
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
