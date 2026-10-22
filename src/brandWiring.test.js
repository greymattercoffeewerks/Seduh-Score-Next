// BR-E1: the organiser's brand reaches the real audience surfaces through the real composition (liveSurfaces.js), from
// a fake database that answers the one narrow door. What this holds: a surface is never delayed or broken by
// branding, a brand that arrives is on screen exactly once with the credit, a brand survives the display being
// rebuilt for the next event, a failure leaves the surface as it was, and a surface that is gone stops asking.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECTOR_BODIES,
  applyLateBrand,
  mountPhone,
  mountProjector,
  mountSplash,
} from './liveSurfaces.js';
import { createFormatBody } from './core/formatBody.js';
import { brandCssVariables } from './core/brandColor.js';
import { BRAND_DOOR, REASK_MS } from './core/brandDoor.js';
import { _clearOrgResolverForTests } from './core/orgResolver.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const EV1 = '22222222-2222-4222-8222-222222222222';
const EV2 = '33333333-3333-4333-8333-333333333333';
const LOGO = 'https://x.supabase.co/storage/v1/object/public/branding/o/abc.webp';

const doorRow = (extra = {}) => ({
  display_name: 'Brew Lab',
  accent_hex: '#e91e63',
  logo_url: LOGO,
  logo_alt: '',
  ...extra,
});
const rows = (...r) => Promise.resolve({ data: r, error: null });

const session = (extra = {}) => ({
  id: 's1',
  org_id: ORG,
  event_id: EV1,
  format: 'cup_taster',
  active: true,
  is_test: false,
  payload: {
    eventName: 'Grey Matter Cup 2026',
    stage: { kind: 'prelims', setCount: 5 },
    standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
  },
  ...extra,
});

// A database with one live_sessions row (swappable), an event summary, and a door whose answers are the test's.
function fakeDatabase({ row = session(), door = () => rows(doorRow()), readDelayMs = 0 } = {}) {
  let current = row;
  let onChange = () => {};
  const asked = [];
  const client = {
    asked,
    setRow(next) {
      current = next;
      onChange();
    },
    from(table) {
      if (table !== 'live_sessions') throw new Error(`an audience surface read ${table}`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        // No timer at all when there is no delay, so a test with fake timers is not stalled by its own database.
        maybeSingle: () =>
          readDelayMs > 0
            ? new Promise((resolve) =>
                setTimeout(() => resolve({ data: current, error: null }), readDelayMs),
              )
            : Promise.resolve({ data: current, error: null }),
      };
      return builder;
    },
    rpc(name, args) {
      asked.push({ name, args });
      if (name === BRAND_DOOR) return door(args);
      if (name === 'public_event_summary') {
        return rows({ id: EV1, name: 'Grey Matter Cup 2026', event_date: null, is_test: false });
      }
      throw new Error(`an unexpected call: ${name}`);
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
  client.doorQuestions = () => asked.filter((q) => q.name === BRAND_DOOR);
  return client;
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const credits = (root) => root.querySelectorAll('.powered-by');

// An image that loads at once, so the logo preload does not wait for a network that is not there.
function stubImages(behaviour = 'load') {
  class FakeImage {
    set src(value) {
      this._src = value;
      queueMicrotask(() => (behaviour === 'load' ? this.onload?.() : this.onerror?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

let mounted;
const track = (handle) => {
  mounted.push(handle);
  return handle;
};
beforeEach(() => {
  mounted = [];
  _clearOrgResolverForTests();
  stubImages();
});
afterEach(() => {
  for (const handle of mounted) handle.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the projector', () => {
  async function mountOn(client, extra = {}) {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = track(await mountProjector(root, { orgId: ORG, client, ...extra }));
    return { root, handle };
  }

  it('shows the ordinary display first and the organiser brand once the door answers, with exactly one credit', async () => {
    let answer;
    const client = fakeDatabase({
      door: () => new Promise((resolve) => (answer = resolve)),
    });
    const { root } = await mountOn(client);
    // The display is up and unbranded while the door has not answered.
    expect(root.querySelector('.stage-standings')).not.toBeNull();
    expect(root.querySelector('.stage-band-brand-custom')).toBeNull();
    expect(credits(root)).toHaveLength(0);
    answer({ data: [doorRow()], error: null });
    await settle();
    expect(root.querySelector('.stage-band-brand-custom .brand-slot-name').textContent).toBe(
      'Brew Lab',
    );
    expect(root.querySelector('.stage-band-brand-custom img').getAttribute('src')).toBe(LOGO);
    expect(credits(root)).toHaveLength(1);
    expect(root.querySelector('.stage-band-event').textContent).toBe('Grey Matter Cup 2026');
    // The accent is on the display it belongs to, never on the shared root.
    // The accent the colour engine derives for the stage (the brand colour, moved if it had to be).
    expect(root.querySelector('.stage-display').style.getPropertyValue('--color-accent')).toBe(
      brandCssVariables('#e91e63', 'stage')['--color-accent'],
    );
    expect(root.style.getPropertyValue('--color-accent')).toBe('');
  });

  it('asks for the event the live session is for, once it knows it', async () => {
    const client = fakeDatabase();
    await mountOn(client);
    await settle();
    expect(client.doorQuestions().map((q) => q.args)).toEqual([
      { p_org_id: ORG, p_event_id: null },
      { p_org_id: ORG, p_event_id: EV1 },
    ]);
  });

  it('keeps the brand when the display is rebuilt for the next event', async () => {
    const client = fakeDatabase();
    const { root } = await mountOn(client);
    await settle();
    expect(root.querySelector('.stage-band-brand-custom')).not.toBeNull();
    client.setRow(session({ event_id: EV2, id: 's2' })); // another event: a brand new display
    await settle();
    expect(root.querySelector('.stage-band-brand-custom .brand-slot-name').textContent).toBe(
      'Brew Lab',
    );
    expect(credits(root)).toHaveLength(1);
  });

  it('is branded and credited in its holding state too, when nothing is live', async () => {
    const client = fakeDatabase({ row: null });
    const { root } = await mountOn(client);
    await settle();
    expect(root.querySelector('.viewer-holding-card')).not.toBeNull();
    expect(root.querySelector('.stage-band-brand-custom .brand-slot-name').textContent).toBe(
      'Brew Lab',
    );
    expect(credits(root)).toHaveLength(1);
  });

  it('brands the holding state when the brand arrives after the surface has mounted', async () => {
    let answer;
    const client = fakeDatabase({
      row: null,
      door: () => new Promise((resolve) => (answer = resolve)),
    });
    const { root } = await mountOn(client);
    expect(root.querySelector('.viewer-holding-card')).not.toBeNull();
    expect(credits(root)).toHaveLength(0);
    answer({ data: [doorRow()], error: null });
    await settle();
    expect(root.querySelector('.stage-band-brand-custom .brand-slot-name').textContent).toBe(
      'Brew Lab',
    );
    expect(credits(root)).toHaveLength(1);
  });

  it('applies a brand that arrived while the surface was still mounting', async () => {
    const client = fakeDatabase({ readDelayMs: 50 });
    const { root } = await mountOn(client); // the door answers long before the first read does
    await settle();
    expect(root.querySelector('.stage-band-brand-custom')).not.toBeNull();
    expect(credits(root)).toHaveLength(1);
  });

  it('brands a holding state that the surface mounted into while the brand was already known', async () => {
    // Nothing is live and the door answers before the first read does: the surface is built after the brand is
    // known, and only the late apply can reach its holding card (a live display would get it from the factory).
    const client = fakeDatabase({ row: null, readDelayMs: 50 });
    const { root } = await mountOn(client);
    await settle();
    expect(root.querySelector('.viewer-holding-card')).not.toBeNull();
    expect(root.querySelector('.stage-band-brand-custom .brand-slot-name').textContent).toBe(
      'Brew Lab',
    );
    expect(credits(root)).toHaveLength(1);
  });

  it('leaves the display exactly as it was when the door fails, however it fails', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const door of [
      () => Promise.resolve({ data: null, error: { code: '500', message: 'boom' } }),
      () => Promise.reject(new Error('offline')),
      () => {
        throw new Error('the client broke');
      },
      () => rows(),
      () => rows(doorRow({ display_name: '', logo_url: null })),
      () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }),
    ]) {
      const { root, handle } = await mountOn(fakeDatabase({ door }));
      await settle();
      expect(root.querySelector('.stage-standings'), String(door)).not.toBeNull();
      expect(root.querySelector('.stage-band-brand-custom')).toBeNull();
      expect(credits(root)).toHaveLength(0);
      expect(root.textContent).toContain('Alex');
      handle.unmount();
    }
    expect(quiet).toHaveBeenCalled();
  });

  it("never shows an organiser brand on a test event without the test banner: the banner is the shell's, untouched", async () => {
    const client = fakeDatabase({ row: session({ is_test: true }) });
    const { root } = await mountOn(client);
    await settle();
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
    expect(root.querySelector('.stage-band-brand-custom')).not.toBeNull();
    expect(root.querySelector('.is-test-banner').closest('[data-brand]')).toBeNull();
  });

  describe('over time', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    const flush = () => vi.advanceTimersByTimeAsync(0);

    it('picks up an edit on the slow timer, and drops the brand when the door says there is none (a lapsed tier)', async () => {
      const answers = [
        () => rows(doorRow()),
        () => rows(doorRow()), // the event-specific question
        () => rows(doorRow({ display_name: 'Brew Lab Two' })),
        () => rows(),
      ];
      let n = 0;
      const client = fakeDatabase({ door: () => answers[Math.min(n++, answers.length - 1)]() });
      const { root } = await mountOn(client);
      await flush();
      await flush();
      expect(root.querySelector('.brand-slot-name').textContent).toBe('Brew Lab');
      await vi.advanceTimersByTimeAsync(REASK_MS);
      expect(root.querySelector('.brand-slot-name').textContent).toBe('Brew Lab Two');
      await vi.advanceTimersByTimeAsync(REASK_MS);
      expect(root.querySelector('.stage-band-brand-custom')).toBeNull();
      expect(credits(root)).toHaveLength(0);
    });

    it('stops asking when the surface is unmounted', async () => {
      const client = fakeDatabase();
      const { handle } = await mountOn(client);
      await flush();
      handle.unmount();
      const before = client.doorQuestions().length;
      await vi.advanceTimersByTimeAsync(REASK_MS * 3);
      expect(client.doorQuestions()).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops asking when the navigation is aborted, and asks nothing at all if it already was', async () => {
      const controller = new AbortController();
      const client = fakeDatabase();
      await mountOn(client, { signal: controller.signal });
      await flush();
      controller.abort();
      const before = client.doorQuestions().length;
      await vi.advanceTimersByTimeAsync(REASK_MS * 3);
      expect(client.doorQuestions()).toHaveLength(before);

      const aborted = new AbortController();
      aborted.abort();
      const other = fakeDatabase();
      await mountOn(other, { signal: aborted.signal });
      await flush();
      expect(other.doorQuestions()).toHaveLength(0);
    });

    it('asks a database that has no door yet only on the slow timer, quietly, and finds the door once it exists', async () => {
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let doorExists = false;
      const client = fakeDatabase({
        door: () =>
          doorExists
            ? rows(doorRow())
            : Promise.resolve({ data: null, error: { code: 'PGRST202' } }),
      });
      const { root } = await mountOn(client);
      await flush();
      await flush();
      const early = client.doorQuestions().length;
      expect(early).toBeLessThanOrEqual(2); // no chatter
      expect(root.querySelector('.stage-band-brand-custom')).toBeNull();
      doorExists = true;
      await vi.advanceTimersByTimeAsync(REASK_MS);
      expect(root.querySelector('.stage-band-brand-custom')).not.toBeNull();
      expect(quiet).not.toHaveBeenCalled();
    });
  });
});

describe('a brand that arrived while a surface was mounting', () => {
  it('is applied, and a fault in applying it is logged, never allowed to fail the mount', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const taken = [];
    applyLateBrand({ setBrand: (b) => taken.push(b) }, { displayName: 'Brew Lab' });
    expect(taken).toEqual([{ displayName: 'Brew Lab' }]);
    applyLateBrand({ setBrand: () => taken.push('never') }, null); // nothing arrived: nothing applied
    expect(taken).toHaveLength(1);
    const broken = {
      setBrand: () => {
        throw new Error('paint failed');
      },
    };
    expect(() => applyLateBrand(broken, { displayName: 'Brew Lab' })).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('every projector body', () => {
  it('is handed the brand by its factory, so a display built after the brand arrived starts branded', () => {
    for (const [format, factory] of Object.entries(PROJECTOR_BODIES)) {
      const body = factory({ brand: { displayName: 'Brew Lab' } });
      const root = document.createElement('div');
      body.renderBody(root, {});
      expect(typeof body.setBrand, format).toBe('function');
      body.destroy();
    }
    // A format whose factory drops its options would build an unbranded display every time: catch it here.
    const seen = [];
    const spy = {
      cup_taster: (options) => {
        seen.push(options);
        return PROJECTOR_BODIES.cup_taster(options);
      },
    };
    const body = createFormatBody(spy);
    body.setBrand({ displayName: 'Brew Lab' });
    body.hasContent({}, { format: 'cup_taster', eventId: EV1 });
    expect(seen[0]).toEqual({ brand: { displayName: 'Brew Lab' } });
    body.destroy();
  });
});

describe('the phone', () => {
  async function mountOn(client) {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = track(await mountPhone(root, { orgId: ORG, client }));
    return { root, handle };
  }

  it('shows the brand in its heading and the credit in its footer once the door answers', async () => {
    const client = fakeDatabase();
    const { root } = await mountOn(client);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    await settle();
    expect(root.querySelector('h1 .brand-slot-name').textContent).toBe('Brew Lab');
    expect(root.querySelectorAll('footer.viewer-footer .powered-by')).toHaveLength(1);
    expect(credits(root)).toHaveLength(1);
    expect(root.querySelector('.viewer-shell').style.getPropertyValue('--color-accent')).toBe(
      brandCssVariables('#e91e63', 'paper')['--color-accent'],
    );
    expect(root.style.getPropertyValue('--color-accent')).toBe('');
  });

  it('is the ordinary phone when the door fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = await mountOn(
      fakeDatabase({ door: () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }) }),
    );
    await settle();
    const failing = await mountOn(
      fakeDatabase({ door: () => Promise.reject(new Error('offline')) }),
    );
    await settle();
    // The ordinary phone really is showing the session (a positive control, so two empty pages cannot match).
    expect(plain.root.textContent).toContain('Alex');
    expect(failing.root.textContent).toContain('Alex');
    expect(failing.root.innerHTML).toBe(plain.root.innerHTML);
    expect(credits(failing.root)).toHaveLength(0);
  });

  it('asks for the event of the live session', async () => {
    const client = fakeDatabase();
    await mountOn(client);
    await settle();
    expect(client.doorQuestions().at(-1).args).toEqual({ p_org_id: ORG, p_event_id: EV1 });
  });

  it('applies a brand that arrived while the phone was still mounting', async () => {
    const { root } = await mountOn(fakeDatabase({ readDelayMs: 50 }));
    await settle();
    expect(root.querySelector('h1 .brand-slot-name').textContent).toBe('Brew Lab');
    expect(credits(root)).toHaveLength(1);
  });

  it('stops asking once unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const client = fakeDatabase();
      const { handle } = await mountOn(client);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.doorQuestions().length).toBeGreaterThan(0);
      handle.unmount();
      const before = client.doorQuestions().length;
      await vi.advanceTimersByTimeAsync(REASK_MS * 3);
      expect(client.doorQuestions()).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the splash', () => {
  function mountOn(client) {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = track(mountSplash(root, { orgId: ORG, client }));
    return { root, handle };
  }

  it('is branded once the door answers, with the credit in its own element, and asks for the event it shows', async () => {
    const client = fakeDatabase();
    const { root } = mountOn(client);
    expect(root.querySelector('.splash-wordmark').hidden).toBe(false); // unbranded at first
    await settle();
    expect(root.querySelector('.splash-brand .brand-slot-name').textContent).toBe('Brew Lab');
    expect(root.querySelector('.splash-wordmark').hidden).toBe(true);
    expect(credits(root)).toHaveLength(1);
    expect(client.doorQuestions().at(-1).args).toEqual({ p_org_id: ORG, p_event_id: EV1 });
  });

  it('is the ordinary splash when the door fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = mountOn(fakeDatabase({ door: () => Promise.reject(new Error('offline')) }));
    await settle();
    expect(root.querySelector('.splash-brand')).toBeNull();
    expect(root.querySelector('.splash-wordmark').hidden).toBe(false);
    expect(credits(root)).toHaveLength(0);
    expect(root.textContent).toContain('Powered by Seduh Score'); // the ordinary pill, as before
  });

  it('stops asking once unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const client = fakeDatabase();
      const { handle } = mountOn(client);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.doorQuestions().length).toBeGreaterThan(0);
      handle.unmount();
      const before = client.doorQuestions().length;
      await vi.advanceTimersByTimeAsync(REASK_MS * 3);
      expect(client.doorQuestions()).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
