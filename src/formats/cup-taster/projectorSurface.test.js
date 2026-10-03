import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountProjectorSurface } from './projectorSurface.js';

// `events` defaults to one row for org1 so viewer-shell.js's own
// noEvent/notStarted distinction (see viewer-shell.test.js) doesn't affect
// these tests, none of which are about that distinction.
function fakeClient(initialRows = [], { events = [{ id: 'ev1', org_id: 'org1' }] } = {}) {
  const db = { live_sessions: [...initialRows], events: [...events] };

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function makeBuilder(table) {
    const filters = [];
    const builder = {
      select: () => builder,
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle() {
        const rows = db[table].filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    return builder;
  }

  return {
    db,
    from: (table) => makeBuilder(table),
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

describe('mountProjectorSurface', () => {
  it('mounts a chrome-LESS viewer-shell wired to viewerBody, with data-surface="stage" on the root', async () => {
    const root = document.createElement('div');
    await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    // showChrome: false — the projector's own defining choice, opposite of
    // T5.4's phone surface (which shows the identity band).
    expect(root.querySelector('.viewer-chrome')).toBeNull();
    expect(root.getAttribute('data-surface')).toBe('stage');
    expect(root.classList.contains('projector-surface')).toBe(true);
  });

  it('shows real standings content once the org has a published session', async () => {
    const root = document.createElement('div');
    const client = fakeClient([
      {
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
      },
    ]);
    await mountProjectorSurface(root, { orgId: 'org1', client });
    expect(root.querySelector('.standings-table')).not.toBeNull();
    expect(root.textContent).toContain('Alex');
  });

  it('falls back to the shell\'s own "waiting for the organiser" holding state when nothing is published', async () => {
    const root = document.createElement('div');
    await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    expect(root.textContent).toContain('Waiting for the organiser');
  });

  it('still renders is_test unmistakably, exactly like the phone surface (owned entirely by viewer-shell.js)', async () => {
    const root = document.createElement('div');
    const client = fakeClient([
      {
        id: 's1',
        org_id: 'org1',
        event_id: 'ev1',
        format: 'cup_taster',
        active: true,
        is_test: true,
        payload: { standings: [{ position: 1, displayName: 'Alex' }] },
      },
    ]);
    await mountProjectorSurface(root, { orgId: 'org1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.getAttribute('role')).toBe('alert');
  });
});

// jsdom has no layout engine, so the heights fitToScreen measures are stubbed:
// `root` is the screen (clientHeight), `shell` is the content (scrollHeight).
function sized(el, prop, value) {
  Object.defineProperty(el, prop, { configurable: true, get: () => value });
  return el;
}

describe('mountProjectorSurface — fit lifecycle', () => {
  // Frames run as microtasks so a scheduled fit lands before the assertion;
  // every .viewer-shell reports 2160px of content against a 1080px screen.
  function setUp() {
    // Runs just after returning, like a real frame — synchronously would run
    // before the caller stores the frame id and wedge every later fit.
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      queueMicrotask(cb);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
      return this.classList.contains('viewer-shell') ? 2160 : 0;
    });
    const root = sized(document.createElement('div'), 'clientHeight', 1080);
    return { root, fonts };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.fonts;
  });

  it('fits its own view to the screen once mounted', async () => {
    const { root } = setUp();
    await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    await settle();
    expect(root.querySelector('.viewer-shell').style.transform).toBe('scale(0.5)');
  });

  it("never resizes the NEXT screen's view, which can appear on the shared root before this one unmounts", async () => {
    const { root } = setUp();
    await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    await settle();
    const own = root.querySelector('.viewer-shell');
    // The router mounts the next audience screen first: it clears the root
    // and appends its own shell while this projector is still observing.
    root.innerHTML = '';
    const next = document.createElement('div');
    next.className = 'viewer-shell';
    root.append(next);
    await settle();
    expect(own.parentNode).toBeNull();
    expect(next.style.transform).toBe('');
  });

  it('stops fitting once unmounted: the next screen on the shared root is never scaled by it', async () => {
    const { root, fonts } = setUp();
    const handle = await mountProjectorSurface(root, { orgId: 'org1', client: fakeClient([]) });
    await settle();
    handle.unmount();

    // The next screen mounts into the same root; a leftover observer, resize
    // listener, or font listener would pick this up as "its own" and scale it.
    const next = document.createElement('div');
    next.className = 'viewer-shell';
    root.append(next);
    window.dispatchEvent(new Event('resize'));
    fonts.dispatchEvent(new Event('loadingdone'));
    await settle();
    expect(next.style.transform).toBe('');
  });
});
