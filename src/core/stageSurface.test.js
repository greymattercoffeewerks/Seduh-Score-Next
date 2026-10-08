import { describe, it, expect, vi } from 'vitest';
import { mountStageSurface } from './stageSurface.js';
import { createStageBody } from './stageBody.js';
import { renderScreenFrame } from './stageDisplay.js';

// A fake live source, as the viewer shell's own tests use: one org, an event row, no realtime traffic.
function fakeClient(rows = []) {
  const db = { live_sessions: [...rows], events: [{ id: 'ev1', org_id: 'org1' }] };
  function builder(table) {
    const filters = [];
    const b = {
      select: () => b,
      eq(col, val) {
        filters.push([col, val]);
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle() {
        const found = db[table].filter((r) => filters.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data: found[0] ?? null, error: null });
      },
    };
    return b;
  }
  return {
    from: (table) => builder(table),
    channel: () => ({
      on() {
        return this;
      },
      subscribe(cb) {
        Promise.resolve().then(() => cb('SUBSCRIBED'));
        return this;
      },
    }),
    removeChannel: () => {},
  };
}

const session = (payload, extra = {}) => ({
  id: 's1',
  org_id: 'org1',
  event_id: 'ev1',
  format: 'any',
  active: true,
  is_test: false,
  payload,
  ...extra,
});

function makeBody(log = []) {
  const screen = {
    key: 'one',
    mount(host, payload) {
      const frame = renderScreenFrame();
      frame.main.textContent = `shows:${payload.label}`;
      host.append(frame.el);
      return { update() {}, destroy: () => log.push('screen destroyed') };
    },
  };
  const body = createStageBody({
    selectScreen: (payload) => (payload?.label ? screen : null),
    bandFor: () => ({ eventName: 'An event', sectionLabel: 'Round 1', live: true }),
    hasContent: (payload) => Boolean(payload?.label),
  });
  const realDestroy = body.destroy;
  body.destroy = () => {
    log.push('body destroyed');
    realDestroy();
  };
  return body;
}

describe('mountStageSurface', () => {
  it('puts the root in the dark stage mode with the core surface class, and no organiser chrome', async () => {
    const root = document.createElement('div');
    await mountStageSurface(root, { body: makeBody(), orgId: 'org1', client: fakeClient() });
    expect(root.classList.contains('stage-surface')).toBe(true);
    expect(root.getAttribute('data-surface')).toBe('stage');
    expect(root.querySelector('.viewer-chrome')).toBeNull();
  });

  it('adds the format’s own class beside the core one when asked, and only then', async () => {
    const withClass = document.createElement('div');
    await mountStageSurface(withClass, {
      body: makeBody(),
      surfaceClass: 'projector-surface',
      orgId: 'org1',
      client: fakeClient(),
    });
    expect([...withClass.classList].sort()).toEqual(['projector-surface', 'stage-surface']);

    const without = document.createElement('div');
    await mountStageSurface(without, { body: makeBody(), orgId: 'org1', client: fakeClient() });
    expect([...without.classList]).toEqual(['stage-surface']);
  });

  it('shows the body’s display once the org has a session with content, band and screen together', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ label: 'hello' })]);
    const handle = await mountStageSurface(root, { body: makeBody(), orgId: 'org1', client });
    expect(root.querySelector('.stage-band-event').textContent).toBe('An event');
    expect(root.querySelector('.stage-band-section').textContent).toBe('Round 1');
    expect(root.querySelector('.stage-main').textContent).toBe('shows:hello');
    handle.unmount();
  });

  it('hands the shell the body’s content test: a session with no content shows the holding state, not an empty display', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ label: '' })]); // a session exists, but nothing to show
    const handle = await mountStageSurface(root, { body: makeBody(), orgId: 'org1', client });
    expect(root.querySelector('.stage-display')).toBeNull();
    expect(root.querySelector('.viewer-holding-card')).not.toBeNull();
    handle.unmount();
  });

  it('unmounting also unmounts the shell: its realtime channel is released', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ label: 'x' })]);
    const removeChannel = vi.spyOn(client, 'removeChannel');
    const handle = await mountStageSurface(root, { body: makeBody(), orgId: 'org1', client });
    handle.unmount();
    expect(removeChannel).toHaveBeenCalled();
  });

  it('falls back to the shell’s own holding state when nothing is published', async () => {
    const root = document.createElement('div');
    const handle = await mountStageSurface(root, {
      body: makeBody(),
      orgId: 'org1',
      client: fakeClient(),
    });
    expect(root.textContent).toContain('Waiting for the organiser');
    expect(root.querySelector('.stage-display')).toBeNull();
    handle.unmount();
  });

  it('still renders is_test unmistakably (the shell owns that, whichever body is mounted)', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ label: 'x' }, { is_test: true })]);
    const handle = await mountStageSurface(root, { body: makeBody(), orgId: 'org1', client });
    expect(root.querySelector('.is-test-banner').getAttribute('role')).toBe('alert');
    handle.unmount();
  });

  it('destroys the body when the surface unmounts, ending its timers', async () => {
    vi.useFakeTimers();
    try {
      const log = [];
      const root = document.createElement('div');
      const handle = await mountStageSurface(root, {
        body: makeBody(log),
        orgId: 'org1',
        client: fakeClient([session({ label: 'x' })]),
      });
      handle.unmount();
      expect(log).toContain('body destroyed');
      expect(log).toContain('screen destroyed');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys the body, and rethrows, when the shell cannot mount', async () => {
    const log = [];
    const root = document.createElement('div');
    const client = {
      ...fakeClient(),
      channel: () => {
        throw new Error('no realtime');
      },
    };
    await expect(
      mountStageSurface(root, { body: makeBody(log), orgId: 'org1', client }),
    ).rejects.toThrow('no realtime');
    expect(log).toContain('body destroyed');
  });
});
