import { describe, it, expect } from 'vitest';
import { mountAppShell } from './appShell.js';

function fakeClient(eventsById) {
  const calls = [];
  return {
    calls,
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

  it('a slower-resolving setNav call for a since-superseded eventId does not clobber a faster, later one', async () => {
    // Same staleness discipline as core/viewer-shell.js's own requestSeq
    // guard: event A's findEvent call is deliberately delayed past event
    // B's, so B's breadcrumb must survive A's late arrival.
    let resolveA;
    const client = {
      calls: [],
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
