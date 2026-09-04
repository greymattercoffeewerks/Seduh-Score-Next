import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountAppShell } from './appShell.js';
import { _clearAllForTests, outboxPut } from './db.js';
import { enqueueOperation } from './outbox.js';

// Every fake client needs a minimal auth shape now — mountAppShell's own
// "signed in as X / sign out" control subscribes via
// client.auth.onAuthStateChange on every mount (see that file's own
// comment for why: reactive, not a one-time fetch).
function fakeAuth() {
  return {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signOut: vi.fn(),
  };
}

function fakeClient(eventsById) {
  const calls = [];
  return {
    calls,
    auth: fakeAuth(),
    from(table) {
      return {
        select: () => ({
          eq: (col, val) => {
            calls.push([table, col, val]);
            return {
              single: () => Promise.resolve({ data: eventsById[val] ?? null, error: null }),
            };
          },
        }),
      };
    },
  };
}

describe('mountAppShell', () => {
  it('renders the app name and an empty outlet', () => {
    const root = document.createElement('div');
    const { outlet } = mountAppShell(root, { client: fakeClient({}) });
    expect(root.querySelector('.app-shell-name').textContent).toBe('Seduh Score');
    expect(outlet.className).toBe('app-shell-outlet');
    expect(root.contains(outlet)).toBe(true);
  });

  it('an explicit appName overrides the default', () => {
    const root = document.createElement('div');
    mountAppShell(root, { appName: 'Custom', client: fakeClient({}) });
    expect(root.querySelector('.app-shell-name').textContent).toBe('Custom');
  });

  it('setNav({links}) renders exactly those links, with hrefs and active state', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      links: [
        { label: 'Setup', href: '#/events/ev1/setup' },
        { label: 'Roster', href: '#/events/ev1/roster', active: true },
      ],
    });
    const links = [...root.querySelectorAll('.app-shell-link')];
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('Setup');
    expect(links[0].getAttribute('href')).toBe('#/events/ev1/setup');
    expect(links[0].className).toBe('app-shell-link');
    expect(links[1].className).toContain('app-shell-link-active');
  });

  it('marks the active link with aria-current="page", the inactive link with no aria-current at all — found in the holistic-pass review: the active state was only ever a visual (bold/underline) signal', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      links: [
        { label: 'Setup', href: '#/events/ev1/setup' },
        { label: 'Roster', href: '#/events/ev1/roster', active: true },
      ],
    });
    const links = [...root.querySelectorAll('.app-shell-link')];
    expect(links[0].hasAttribute('aria-current')).toBe(false);
    expect(links[1].getAttribute('aria-current')).toBe('page');
  });

  it("clicking a shell nav link blurs it — found in the holistic-pass review: unlike a link inside a routed screen (removed by the next screen's own root.innerHTML wipe), this link is never removed across a navigation, so router.js's own activeElement===document.body post-navigation focus fallback would otherwise never fire", async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ links: [{ label: 'Events', href: '#/events' }] });
    const link = root.querySelector('.app-shell-link');
    link.focus();
    expect(document.activeElement).toBe(link);
    link.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(link);
  });

  it('a second setNav call replaces the previous links rather than appending', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ links: [{ label: 'A', href: '#/a' }] });
    await setNav({ links: [{ label: 'B', href: '#/b' }] });
    const links = [...root.querySelectorAll('.app-shell-link')];
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('B');
  });

  it('setNav({eventId}) resolves the event name via one findEvent call and renders it as the breadcrumb', async () => {
    const client = fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('October Cup');
    expect(client.calls.filter(([table]) => table === 'events')).toHaveLength(1);
  });

  it('a second setNav call with the SAME eventId does not refetch', async () => {
    const client = fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    await setNav({ eventId: 'ev1', links: [{ label: 'X', href: '#/x' }] });
    expect(client.calls.filter(([table]) => table === 'events')).toHaveLength(1);
    // Links still update even though the event fetch was skipped.
    expect(root.querySelector('.app-shell-link').textContent).toBe('X');
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('October Cup');
  });

  it('omitting eventId clears the breadcrumb and resets the cache', async () => {
    const client = fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    await setNav({ links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('');
  });

  it('a findEvent failure clears the breadcrumb rather than leaving stale/error text', async () => {
    const client = {
      auth: fakeAuth(),
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('boom')) }) }),
      }),
    };
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('');
  });

  it('unmount() clears the shell DOM', () => {
    const root = document.createElement('div');
    const { unmount } = mountAppShell(root, { client: fakeClient({}) });
    expect(root.children.length).toBeGreaterThan(0);
    unmount();
    expect(root.children.length).toBe(0);
  });

  function fakeAuthWithTrigger() {
    let listener = null;
    const unsubscribe = vi.fn();
    return {
      auth: {
        signOut: vi.fn(() => Promise.resolve({ error: null })),
        onAuthStateChange: (cb) => {
          listener = cb;
          return { data: { subscription: { unsubscribe } } };
        },
      },
      unsubscribe,
      trigger(session) {
        listener?.('SIGNED_IN', session);
      },
    };
  }

  describe('the temporary sign-in/sign-out control', () => {
    it('renders nothing while signed out', () => {
      const root = document.createElement('div');
      const { auth } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });
      expect(root.querySelector('.app-shell-auth').children).toHaveLength(0);
    });

    it('shows the signed-in email and a Sign out button once a session appears — reactive, not a one-time fetch (the shell mounts before a sign-in can possibly have happened yet)', () => {
      const root = document.createElement('div');
      const { auth, trigger } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });

      trigger({ user: { email: 'organiser@local.test' } });

      expect(root.querySelector('.app-shell-auth-email').textContent).toBe('organiser@local.test');
      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      expect(signOutButton).not.toBeUndefined();
    });

    it('clicking Sign out calls client.auth.signOut() and navigates to #/events', async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { auth, trigger } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });
      trigger({ user: { email: 'organiser@local.test' } });
      location.hash = '#/events/ev1/setup';

      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      signOutButton.dispatchEvent(new Event('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(location.hash).toBe('#/events');
    });

    it('unmount() unsubscribes from the auth-state listener', () => {
      const root = document.createElement('div');
      const { auth, unsubscribe } = fakeAuthWithTrigger();
      const { unmount } = mountAppShell(root, { client: { auth, from: () => ({}) } });
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  it('a slower-resolving setNav call for a since-superseded eventId does not clobber a faster, later one', async () => {
    // Same staleness discipline as core/viewer-shell.js's own requestSeq
    // guard: event A's findEvent call is deliberately delayed past event
    // B's, so B's breadcrumb must survive A's late arrival.
    let resolveA;
    const client = {
      calls: [],
      auth: fakeAuth(),
      from() {
        return {
          select: () => ({
            eq: (col, val) => ({
              single: () => {
                if (val === 'evA') {
                  return new Promise((resolve) => {
                    resolveA = () =>
                      resolve({ data: { id: 'evA', name: 'Slow Event' }, error: null });
                  });
                }
                return Promise.resolve({ data: { id: 'evB', name: 'Fast Event' }, error: null });
              },
            }),
          }),
        };
      },
    };
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });

    const pendingA = setNav({ eventId: 'evA', links: [] });
    await setNav({ eventId: 'evB', links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('Fast Event');

    resolveA();
    await pendingA;
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('Fast Event');
  });
});

// §8.4/T3.3's own AC: "three-state sync panel on the organiser device: off /
// live / not synced." Regression coverage for the Phase 6 offline-soak
// finding that computeSyncState() (syncState.js) had this logic fully built
// and tested, but zero UI consumers anywhere in the app.
describe('mountAppShell — sync panel', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  // A real, short wait — not vi.useFakeTimers(): fake-indexeddb schedules
  // its own callback resolution in a way that doesn't fire under faked
  // timers, so any IndexedDB op performed while timers are faked just hangs
  // (found writing this suite). Real time, kept small via mountAppShell's
  // own syncPollMs test-only override below, is the reliable choice here.
  // A non-zero default — refreshSync() is fired-and-forgotten from inside
  // setNav (never awaited there, so awaiting setNav itself doesn't
  // guarantee its own internal IndexedDB read has resolved yet); a single
  // 0ms macrotask tick wasn't reliably enough (found writing this suite).
  function tick(ms = 10) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('renders nothing ("off") with no event context and no pending operations', async () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    await tick(); // let the mount-time refreshSync() settle
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('');
    expect(syncEl.className).toBe('app-shell-sync');
  });

  it('shows "Synced" once an event is set with nothing pending', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');
    expect(syncEl.classList.contains('app-shell-sync-live')).toBe(true);
    expect(syncEl.querySelector('.status-live-dot')).not.toBeNull();
  });

  it('shows the pending count as "not synced" once an operation is queued', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Not synced (1 pending)');
    expect(syncEl.classList.contains('app-shell-sync-pending')).toBe(true);
  });

  it('escalates to the distinct "retrying failed" styling once an operation has a real attempt on record (a poison operation, not just in-flight)', async () => {
    const op = await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await outboxPut({ ...op, attempts: 1, lastError: 'stale conflict' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Not synced — retrying failed (1 pending)');
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
    expect(syncEl.classList.contains('app-shell-sync-pending')).toBe(false);
  });

  it('fail-open: a pending operation still reports "not synced", never "off", even with no current event context — computeSyncState()\'s own guarantee, this caller must not accidentally suppress it', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) }); // no setNav call at all — cachedEventId stays null
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Not synced (1 pending)');
  });

  it('picks up a change on its own poll cycle, without requiring another setNav call', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');

    // Enqueued directly against the outbox — nothing tells the shell about
    // this new operation except its own poll.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(60); // > syncPollMs, so at least one poll tick has fired
    expect(syncEl.textContent).toBe('Not synced (1 pending)');
  });

  it('unmount() stops the poll — a leaked interval would keep reading IndexedDB (and touching a detached DOM node) forever', async () => {
    const root = document.createElement('div');
    const { setNav, unmount } = mountAppShell(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');
    unmount();

    // Enqueued AFTER unmount — if the interval weren't really cleared, a
    // later poll tick would eventually reflect this. Waiting past several
    // poll intervals and asserting NOTHING changed proves the timer is
    // actually gone, not just that clearInterval() was called.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(80);
    expect(syncEl.textContent).toBe('Synced');
  });

  // reportFlushError() — found in review (offline-sync-auditor): main.js's
  // own sync-on-reconnect trigger has no screen watching its flush result,
  // unlike every other flush call site. Without a way to surface a genuine
  // conflict here, a permanently-failed (and therefore removed-from-the-
  // queue) operation left the very next poll seeing zero pending operations
  // and reporting "Synced" — a false all-clear for a write that was
  // actually discarded, exactly the "conflict silently resolved" failure
  // mode §9 exists to prevent.
  it('reportFlushError() surfaces a permanently-failed write even with zero pending operations, instead of falsely reporting "Synced"', async () => {
    const root = document.createElement('div');
    const { setNav, reportFlushError } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');

    reportFlushError(new Error('stale conflict'));
    await tick();
    expect(syncEl.textContent).toBe('Not synced — a write failed to save and was not retried');
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
  });

  it('reportFlushError(null) clears a previously-reported error once a later attempt succeeds', async () => {
    const root = document.createElement('div');
    const { setNav, reportFlushError } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    reportFlushError(new Error('stale conflict'));
    await tick();
    expect(root.querySelector('.app-shell-sync').textContent).toBe(
      'Not synced — a write failed to save and was not retried',
    );

    reportFlushError(null);
    await tick();
    expect(root.querySelector('.app-shell-sync').textContent).toBe('Synced');
  });

  it('fail-open also covers a reported flush error: it still reports "not synced", never "off", with no current event context', async () => {
    const root = document.createElement('div');
    const { reportFlushError } = mountAppShell(root, { client: fakeClient({}) }); // no setNav — cachedEventId stays null
    reportFlushError(new Error('stale conflict'));
    await tick();
    expect(root.querySelector('.app-shell-sync').textContent).toBe(
      'Not synced — a write failed to save and was not retried',
    );
  });

  it('a genuinely pending operation takes priority over a stale reported flush error in the displayed text — the "N pending" case is the more actionable one', async () => {
    const root = document.createElement('div');
    const { setNav, reportFlushError } = mountAppShell(root, {
      client: fakeClient({}),
      syncPollMs: 20,
    });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    reportFlushError(new Error('stale conflict'));
    await tick();
    // Enqueued directly, same as the "picks up a change on its own poll
    // cycle" test above — nothing calls refreshSync() directly here, only
    // the poll itself observes it.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(60); // > syncPollMs, so at least one poll tick has fired
    // Not the zero-pending "a write failed to save" wording — a real
    // operation is sitting in the queue now, so the ordinary pending count
    // is what's actionable (it hasn't even had a failed attempt of its
    // own yet — attempts starts at 0 on enqueue).
    expect(root.querySelector('.app-shell-sync').textContent).toBe('Not synced (1 pending)');
  });
});
