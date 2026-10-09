import { describe, it, expect, vi } from 'vitest';
import { mountProjector, mountPhone } from './liveSurfaces.js';

// A client whose live_sessions row can be swapped and whose realtime callback can be fired, so a format
// change on a mounted surface can be driven. `events` defaults to one row so the shell's noEvent/notStarted
// distinction stays out of these tests.
function fakeClient(initialRow, { events = [{ id: 'ev1' }] } = {}) {
  let row = initialRow;
  let onChange = () => {};
  return {
    setRow(next) {
      row = next;
      onChange();
    },
    from: (table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: table === 'events' ? (events[0] ?? null) : row, error: null }),
      };
      return builder;
    },
    channel: () => ({
      on(_type, _filter, cb) {
        onChange = cb;
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

const standings17 = Array.from({ length: 17 }, (_, i) => ({
  position: i + 1,
  displayName: `Cupper ${i + 1}`,
  numCorrect: 1,
  totalElapsedSecs: 200 + i,
}));

const cupTasterSession = {
  id: 's1',
  org_id: 'org1',
  event_id: 'ev1',
  format: 'cup_taster',
  active: true,
  is_test: false,
  payload: {
    stage: { kind: 'prelims', setCount: 5 },
    standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
  },
};

const unknownFormatSession = { ...cupTasterSession, id: 's2', format: 'not_built_yet' };

const withPayload = (payload, extra = {}) => ({ ...cupTasterSession, ...extra, payload });

const heatPayload = {
  eventName: 'Grey Matter Cup Taster Competition 2026',
  stage: { kind: 'prelims', setCount: 5 },
  standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
  activeHeat: {
    heatNumber: 3,
    stageKind: 'prelims',
    status: 'timing',
    timingMode: 'app',
    startedAt: new Date().toISOString(),
    durationSecs: 480,
    cuppers: [{ displayName: 'Jordan', station: 'A', totalElapsedSecs: null, maxed: false }],
  },
};

// A body that records its life, for the lifecycle tests (Cup Taster's phone body has nothing to release).
function recordingBodies({ failRender = false } = {}) {
  const log = { built: 0, destroyed: 0 };
  const bodies = {
    cup_taster: () => {
      log.built += 1;
      return {
        hasContent: () => true,
        renderBody: (container) => {
          if (failRender) throw new Error('render failed');
          container.append('RECORDED');
        },
        destroy: () => {
          log.destroyed += 1;
        },
      };
    },
  };
  return { log, bodies };
}

describe('mountProjector', () => {
  it("shows Cup Taster's projector for a cup_taster session, on the dark chrome-less stage surface", async () => {
    const root = document.createElement('div');
    await mountProjector(root, { orgId: 'org1', client: fakeClient(cupTasterSession) });
    expect(root.querySelector('.stage-standings')).not.toBeNull();
    expect(root.querySelector('.standings-table')).toBeNull(); // not the phone's dense body
    expect(root.textContent).toContain('Alex');
    expect(root.getAttribute('data-surface')).toBe('stage');
    expect(root.querySelector('.viewer-chrome')).toBeNull();
  });

  it('draws its permanent band with the event name and stage, and a heat screen with the shared countdown element', async () => {
    const root = document.createElement('div');
    const handle = await mountProjector(root, {
      orgId: 'org1',
      client: fakeClient(withPayload(heatPayload)),
    });
    expect(root.querySelector('.stage-band-event').textContent).toBe(
      'Grey Matter Cup Taster Competition 2026',
    );
    expect(root.querySelector('.stage-band-section').textContent).toBe('Preliminary');
    expect(root.querySelector('.stage-title').textContent).toBe('Heat 3');
    // The element tests/e2e/cross-surface-countdown.spec.js reads on every surface.
    expect(root.querySelector('.viewer-countdown')).not.toBeNull();
    handle.unmount();
  });

  it('never scales or scrolls its view: 17 cuppers are a page of eight', async () => {
    const root = document.createElement('div');
    const handle = await mountProjector(root, {
      orgId: 'org1',
      client: fakeClient(
        withPayload({ stage: { kind: 'prelims', setCount: 5 }, standings: standings17 }),
      ),
    });
    expect(root.querySelector('.viewer-shell').style.transform).toBe('');
    expect(root.querySelectorAll('.stage-standing-row')).toHaveLength(8);
    handle.unmount();
  });

  it("never feeds a format with no projector another format's screens: the shell says it is not published yet", async () => {
    const root = document.createElement('div');
    await mountProjector(root, { orgId: 'org1', client: fakeClient(unknownFormatSession) });
    expect(root.textContent).toContain('Event not published yet');
    expect(root.querySelector('.stage-standings')).toBeNull();
    expect(root.textContent).not.toContain('Alex');
  });

  it('falls back to the shell\'s own "waiting for the organiser" state when nothing is published', async () => {
    const root = document.createElement('div');
    await mountProjector(root, { orgId: 'org1', client: fakeClient(null) });
    expect(root.textContent).toContain('Waiting for the organiser');
  });

  it('still renders is_test unmistakably (owned by viewer-shell)', async () => {
    const root = document.createElement('div');
    await mountProjector(root, {
      orgId: 'org1',
      client: fakeClient(withPayload(cupTasterSession.payload, { is_test: true })),
    });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.getAttribute('role')).toBe('alert');
  });

  it('follows a live session that changes format, and back', async () => {
    const root = document.createElement('div');
    const client = fakeClient(cupTasterSession);
    await mountProjector(root, { orgId: 'org1', client });
    expect(root.querySelector('.stage-standings')).not.toBeNull();

    client.setRow(unknownFormatSession);
    await vi.waitFor(() => expect(root.textContent).toContain('Event not published yet'));
    expect(root.querySelector('.stage-standings')).toBeNull();

    client.setRow(cupTasterSession);
    await vi.waitFor(() => expect(root.querySelector('.stage-standings')).not.toBeNull());
    expect(root.textContent).toContain('Alex');
  });

  it('stops everything when unmounted: no timer survives to touch the next screen on the shared root', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      const handle = await mountProjector(root, {
        orgId: 'org1',
        client: fakeClient(
          withPayload({ stage: { kind: 'prelims', setCount: 5 }, standings: standings17 }),
        ),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBeGreaterThan(0); // the page loop and the ring are running
      handle.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a format's display when the live session moves to another format", async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      const client = fakeClient(
        withPayload({ stage: { kind: 'prelims', setCount: 5 }, standings: standings17 }),
      );
      const handle = await mountProjector(root, { orgId: 'org1', client });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      client.setRow(unknownFormatSession);
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Event not published yet');
      expect(vi.getTimerCount()).toBe(0);
      handle.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys the format body when the surface unmounts and when the mount fails', async () => {
    const mounted = recordingBodies();
    const handle = await mountProjector(document.createElement('div'), {
      orgId: 'org1',
      client: fakeClient(cupTasterSession),
      bodies: mounted.bodies,
    });
    expect(mounted.log).toEqual({ built: 1, destroyed: 0 });
    handle.unmount();
    expect(mounted.log.destroyed).toBe(1);

    // A mount that fails after the body was built (its first render throws) still releases it.
    const failed = recordingBodies({ failRender: true });
    await expect(
      mountProjector(document.createElement('div'), {
        orgId: 'org1',
        client: fakeClient(cupTasterSession),
        bodies: failed.bodies,
      }),
    ).rejects.toThrow('render failed');
    expect(failed.log).toEqual({ built: 1, destroyed: 1 });
  });

  it('gives each mount its own format body, so unmounting one leaves the other running', async () => {
    const { log, bodies } = recordingBodies();
    const first = await mountProjector(document.createElement('div'), {
      orgId: 'org1',
      client: fakeClient(cupTasterSession),
      bodies,
    });
    const secondRoot = document.createElement('div');
    await mountProjector(secondRoot, {
      orgId: 'org1',
      client: fakeClient(cupTasterSession),
      bodies,
    });
    expect(log.built).toBe(2);
    first.unmount();
    expect(log.destroyed).toBe(1);
    expect(secondRoot.textContent).toContain('RECORDED');
  });

  it('unmounts cleanly', async () => {
    const root = document.createElement('div');
    const handle = await mountProjector(root, {
      orgId: 'org1',
      client: fakeClient(cupTasterSession),
    });
    expect(() => handle.unmount()).not.toThrow();
    expect(root.querySelector('.viewer-shell')).toBeNull();
  });
});

describe('mountPhone', () => {
  it("shows Cup Taster's phone body, with the identity chrome and no data-surface, for a cup_taster session", async () => {
    const root = document.createElement('div');
    await mountPhone(root, { orgId: 'org1', client: fakeClient(cupTasterSession) });
    expect(root.querySelector('.viewer-chrome')).not.toBeNull();
    expect(root.querySelectorAll('[data-surface]')).toHaveLength(0);
    expect(root.querySelector('.standings-table')).not.toBeNull();
    expect(root.textContent).toContain('Alex');
    expect(root.querySelector('.stage-standings')).toBeNull();
  });

  it('shows the not-published card for a format with no phone body', async () => {
    const root = document.createElement('div');
    await mountPhone(root, { orgId: 'org1', client: fakeClient(unknownFormatSession) });
    expect(root.textContent).toContain('Event not published yet');
    expect(root.querySelector('.standings-table')).toBeNull();
  });

  it('falls back to the shell\'s own "waiting for the organiser" state when nothing is published', async () => {
    const root = document.createElement('div');
    await mountPhone(root, { orgId: 'org1', client: fakeClient(null) });
    expect(root.textContent).toContain('Waiting for the organiser');
  });

  it('still renders is_test unmistakably', async () => {
    const root = document.createElement('div');
    await mountPhone(root, {
      orgId: 'org1',
      client: fakeClient(withPayload(cupTasterSession.payload, { is_test: true })),
    });
    expect(root.querySelector('.is-test-banner')?.getAttribute('role')).toBe('alert');
  });

  it('follows a live session that changes format, and back', async () => {
    const root = document.createElement('div');
    const client = fakeClient(cupTasterSession);
    await mountPhone(root, { orgId: 'org1', client });
    expect(root.querySelector('.standings-table')).not.toBeNull();

    client.setRow(unknownFormatSession);
    await vi.waitFor(() => expect(root.textContent).toContain('Event not published yet'));
    expect(root.querySelector('.standings-table')).toBeNull();

    client.setRow(cupTasterSession);
    await vi.waitFor(() => expect(root.querySelector('.standings-table')).not.toBeNull());
  });

  it('destroys the format body when the surface unmounts and gives each mount its own', async () => {
    const { log, bodies } = recordingBodies();
    const first = await mountPhone(document.createElement('div'), {
      orgId: 'org1',
      client: fakeClient(cupTasterSession),
      bodies,
    });
    await mountPhone(document.createElement('div'), {
      orgId: 'org1',
      client: fakeClient(cupTasterSession),
      bodies,
    });
    expect(log.built).toBe(2);
    first.unmount();
    expect(log.destroyed).toBe(1);
  });

  it('destroys the format body when the mount fails', async () => {
    const { log, bodies } = recordingBodies({ failRender: true });
    await expect(
      mountPhone(document.createElement('div'), {
        orgId: 'org1',
        client: fakeClient(cupTasterSession),
        bodies,
      }),
    ).rejects.toThrow('render failed');
    expect(log).toEqual({ built: 1, destroyed: 1 });
  });

  it('unmounts cleanly', async () => {
    const root = document.createElement('div');
    const handle = await mountPhone(root, { orgId: 'org1', client: fakeClient(cupTasterSession) });
    expect(() => handle.unmount()).not.toThrow();
    expect(root.querySelector('.viewer-shell')).toBeNull();
  });
});
