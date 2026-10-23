import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_DOOR,
  DOOR_TIMEOUT_MS,
  REASK_MS,
  askBrandDoor,
  createBrandSource,
  preloadImage,
} from './brandDoor.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const EVENT_2 = '33333333-3333-4333-8333-333333333333';
const LOGO = 'https://x.supabase.co/storage/v1/object/public/branding/o/abc.webp';

const doorRow = (extra = {}) => ({
  display_name: 'Brew Lab',
  accent_hex: '#E91E63',
  logo_url: LOGO,
  logo_alt: 'A steaming cup',
  banner_landscape_url: 'https://x.supabase.co/b.webp',
  ...extra,
});

// A client whose door answers are queued; every question is recorded.
function fakeClient(...answers) {
  const asked = [];
  const queue = [...answers];
  return {
    asked,
    rpc: (name, args) => {
      asked.push({ name, args });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return typeof next === 'function' ? next() : Promise.resolve(next);
    },
  };
}
const ok = (data) => ({ data, error: null });
const fail = (error) => ({ data: null, error });

describe('askBrandDoor', () => {
  it('asks the one narrow door by name, with the organisation and (when it is an id) the event', async () => {
    const client = fakeClient(ok([doorRow()]));
    await askBrandDoor(client, { orgId: ORG, eventId: EVENT });
    expect(client.asked).toEqual([
      { name: BRAND_DOOR, args: { p_org_id: ORG, p_event_id: EVENT } },
    ]);
    expect(BRAND_DOOR).toBe('public_event_branding');
  });

  it('always sends both arguments, the event null when there is none or it is not an id (so the call matches the declaration either way)', async () => {
    for (const eventId of [null, undefined, '', 'ev1', 42, '2222; drop table events']) {
      const client = fakeClient(ok([]));
      await askBrandDoor(client, { orgId: ORG, eventId });
      expect(client.asked[0].args, String(eventId)).toEqual({ p_org_id: ORG, p_event_id: null });
    }
  });

  it('never asks about an organisation id that cannot be one', async () => {
    for (const orgId of [undefined, null, '', 'org1', 42, {}, `${ORG}x`]) {
      const client = fakeClient(ok([doorRow()]));
      expect(await askBrandDoor(client, { orgId }), String(orgId)).toEqual({ status: 'invalid' });
      expect(client.asked).toHaveLength(0);
    }
  });

  it('turns the door row into a cleaned brand (camelCase, accent lower-cased), ignoring what it does not use', async () => {
    const outcome = await askBrandDoor(fakeClient(ok([doorRow()])), { orgId: ORG });
    expect(outcome).toEqual({
      status: 'brand',
      brand: {
        displayName: 'Brew Lab',
        logoUrl: LOGO,
        logoAlt: 'A steaming cup',
        accentHex: '#e91e63',
      },
    });
  });

  it('takes a single record as readily as a one-row table', async () => {
    const outcome = await askBrandDoor(fakeClient(ok(doorRow())), { orgId: ORG });
    expect(outcome).toEqual({
      status: 'brand',
      brand: {
        displayName: 'Brew Lab',
        logoUrl: LOGO,
        logoAlt: 'A steaming cup',
        accentHex: '#e91e63',
      },
    });
  });

  it('treats the answer as untrusted: a hostile name stays text, a bad logo or accent is dropped', async () => {
    const outcome = await askBrandDoor(
      fakeClient(
        ok([
          doorRow({
            display_name: '<img src=x onerror=alert(1)>',
            logo_url: 'javascript:alert(1)',
            accent_hex: 'red',
          }),
        ]),
      ),
      { orgId: ORG },
    );
    expect(outcome.brand).toEqual({
      displayName: '<img src=x onerror=alert(1)>',
      logoUrl: null,
      logoAlt: 'A steaming cup',
      accentHex: null,
    });
  });

  it('says "none" when the door answers and there is nothing usable', async () => {
    for (const data of [
      [],
      null,
      undefined,
      [null],
      [{}],
      [doorRow({ display_name: '​', logo_url: null })],
      'x',
      7,
    ]) {
      const outcome = await askBrandDoor(fakeClient(ok(data)), { orgId: ORG });
      expect(outcome, JSON.stringify(data)).toEqual({ status: 'none' });
    }
  });

  it('says "absent" when the database has no such door, however it says so', async () => {
    for (const error of [{ code: 'PGRST202' }, { code: '42883' }, { status: 404 }]) {
      expect(await askBrandDoor(fakeClient(fail(error)), { orgId: ORG })).toEqual({
        status: 'absent',
      });
    }
  });

  it('says "error" for any other failure, and never throws', async () => {
    const boom = { code: '500', message: 'boom' };
    expect(await askBrandDoor(fakeClient(fail(boom)), { orgId: ORG })).toEqual({
      status: 'error',
      error: boom,
    });
    const thrown = new Error('offline');
    const rejecting = { rpc: () => Promise.reject(thrown) };
    expect(await askBrandDoor(rejecting, { orgId: ORG })).toEqual({
      status: 'error',
      error: thrown,
    });
    const throwing = {
      rpc: () => {
        throw thrown;
      },
    };
    expect((await askBrandDoor(throwing, { orgId: ORG })).status).toBe('error');
    expect((await askBrandDoor({}, { orgId: ORG })).status).toBe('error');
  });

  describe('when the door is slow', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives up after the timeout and says "error"', async () => {
      const hung = { rpc: () => new Promise(() => {}) };
      const pending = askBrandDoor(hung, { orgId: ORG });
      await vi.advanceTimersByTimeAsync(DOOR_TIMEOUT_MS - 1);
      let settled = false;
      pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).status).toBe('error');
    });
  });
});

describe('preloadImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubImage(behaviour) {
    const made = [];
    class FakeImage {
      constructor() {
        made.push(this);
      }
      set src(value) {
        this._src = value;
        if (behaviour === 'load') queueMicrotask(() => this.onload?.());
        if (behaviour === 'error') queueMicrotask(() => this.onerror?.());
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal('Image', FakeImage);
    return made;
  }

  it('is true when the image loads, and loads it without sending the referrer', async () => {
    const made = stubImage('load');
    expect(await preloadImage(LOGO)).toBe(true);
    expect(made[0].src).toBe(LOGO);
    expect(made[0].referrerPolicy).toBe('no-referrer');
  });

  it('is false when it fails, and false (not a hang) when it never answers', async () => {
    stubImage('error');
    expect(await preloadImage(LOGO)).toBe(false);
    vi.useFakeTimers();
    try {
      stubImage('never');
      const pending = preloadImage(LOGO, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has nothing to wait for outside a browser', async () => {
    vi.stubGlobal('Image', undefined);
    expect(await preloadImage(LOGO)).toBe(true);
  });
});

describe('createBrandSource', () => {
  const OK_PRELOAD = () => Promise.resolve(true);
  let seen;
  const onBrand = (brand) => seen.push(brand);
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function source(client, extra = {}) {
    return createBrandSource({ client, orgId: ORG, onBrand, preload: OK_PRELOAD, ...extra });
  }

  it('asks nothing until it is started, then asks once and hands over the brand', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    await flush();
    expect(client.asked).toHaveLength(0);
    s.start();
    await flush();
    expect(client.asked).toHaveLength(1);
    expect(seen).toEqual([
      { displayName: 'Brew Lab', logoUrl: LOGO, logoAlt: 'A steaming cup', accentHex: '#e91e63' },
    ]);
    s.stop();
  });

  it('starts once however many times it is asked to', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    s.start();
    s.start();
    await flush();
    expect(client.asked).toHaveLength(1);
    s.stop();
  });

  it('asks again on the slow timer, and says nothing when the brand has not changed', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(client.asked).toHaveLength(3);
    expect(seen).toHaveLength(1);
    s.stop();
  });

  it('hands over an edit that arrives on a later question', async () => {
    const client = fakeClient(ok([doorRow()]), ok([doorRow({ display_name: 'Brew Lab 2' })]));
    const s = source(client);
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen.map((b) => b.displayName)).toEqual(['Brew Lab', 'Brew Lab 2']);
    s.stop();
  });

  it('takes the brand away only when the door says there is nothing, and not twice', async () => {
    const client = fakeClient(ok([doorRow()]), ok([]), ok([]));
    const s = source(client);
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen.map((b) => b?.displayName ?? null)).toEqual(['Brew Lab', null]);
    s.stop();
  });

  it('says nothing at all for an unbranded organisation', async () => {
    const client = fakeClient(ok([]));
    const s = source(client);
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen).toEqual([]);
    s.stop();
  });

  it('keeps the brand on screen through a failed question (a dropped connection must not strip the name)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(ok([doorRow()]), fail({ code: '500' }), { data: null, error: null });
    const s = source(client);
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS); // the failure
    expect(seen).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REASK_MS); // an empty answer: now it goes
    expect(seen.map((b) => b?.displayName ?? null)).toEqual(['Brew Lab', null]);
    s.stop();
  });

  it('is quiet about a database that has no door yet, keeps the screen as it is, and finds the door when it appears', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(
      fail({ code: 'PGRST202' }),
      fail({ code: 'PGRST202' }),
      ok([doorRow()]),
    );
    const s = source(client);
    s.start();
    await flush();
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(REASK_MS); // still absent
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(REASK_MS); // the migration has been pushed
    expect(seen.map((b) => b.displayName)).toEqual(['Brew Lab']);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    s.stop();
  });

  it('does not take a brand away because the door went missing (a rollback)', async () => {
    const client = fakeClient(ok([doorRow()]), fail({ code: 'PGRST202' }));
    const s = source(client);
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen).toHaveLength(1);
    s.stop();
  });

  it('asks nothing, and keeps no timer, for an organisation id that cannot be one', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = createBrandSource({ client, orgId: 'org1', onBrand, preload: OK_PRELOAD });
    s.start();
    await flush();
    expect(client.asked).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks again at once when the event changes, passing the event, and not when it is the same', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    s.start();
    await flush();
    s.setEventId(EVENT);
    await flush();
    s.setEventId(EVENT);
    await flush();
    s.setEventId(EVENT_2);
    await flush();
    expect(client.asked.map((q) => q.args.p_event_id)).toEqual([null, EVENT, EVENT_2]);
    s.stop();
  });

  it('remembers an event told before it started, and asks about it first', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    s.setEventId(EVENT);
    await flush();
    expect(client.asked).toHaveLength(0);
    s.start();
    await flush();
    expect(client.asked[0].args).toEqual({ p_org_id: ORG, p_event_id: EVENT });
    s.stop();
  });

  it('asks one question at a time, delivers answers in the order asked, and never lets an older answer land after a newer one', async () => {
    let releaseFirst;
    const slow = () =>
      new Promise((resolve) => {
        releaseFirst = () => resolve(ok([doorRow({ display_name: 'Old answer' })]));
      });
    const client = fakeClient(slow, ok([doorRow({ display_name: 'New answer' })]));
    const s = source(client);
    s.start(); // the slow first question
    await flush();
    s.setEventId(EVENT); // a newer one is wanted while it is in flight
    await flush();
    expect(client.asked).toHaveLength(1); // ...and waits its turn
    releaseFirst();
    await flush();
    expect(client.asked).toHaveLength(2);
    expect(client.asked[1].args.p_event_id).toBe(EVENT);
    expect(seen.map((b) => b.displayName)).toEqual(['Old answer', 'New answer']);
    s.stop();
  });

  it('shows the name and colour without a logo that will not load, and tries the logo again on the next question', async () => {
    const preload = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const client = fakeClient(ok([doorRow()]));
    const s = source(client, { preload });
    s.start();
    await flush();
    expect(seen[0]).toMatchObject({ displayName: 'Brew Lab', logoUrl: null, accentHex: '#e91e63' });
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen).toHaveLength(2);
    expect(seen[1].logoUrl).toBe(LOGO);
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen).toHaveLength(2); // and then it is stable
    s.stop();
  });

  it('shows nothing for a logo-only brand whose logo will not load', async () => {
    const client = fakeClient(ok([doorRow({ display_name: null })]));
    const s = source(client, { preload: () => Promise.resolve(false) });
    s.start();
    await flush();
    expect(seen).toEqual([]);
    s.stop();
  });

  it('does not wait for a logo when there is none', async () => {
    const preload = vi.fn();
    const client = fakeClient(ok([doorRow({ logo_url: null })]));
    const s = source(client, { preload });
    s.start();
    await flush();
    expect(preload).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    s.stop();
  });

  it('stop() clears the slow timer that is armed', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    s.start();
    await flush(); // the first question is answered, so the slow timer is armed
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hands over the same brand once, even when its logo failed and the organiser then removes the logo', async () => {
    const client = fakeClient(ok([doorRow()]), ok([doorRow({ logo_url: null })]));
    const s = source(client, { preload: () => Promise.resolve(false) });
    s.start();
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].logoUrl).toBeNull();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(client.asked).toHaveLength(2);
    expect(seen).toHaveLength(1); // the answer now equals what is already on screen
    s.stop();
  });

  it('says nothing more once stopped, even to an answer already in flight, and stops its timer', async () => {
    let release;
    const client = fakeClient(
      () => new Promise((resolve) => (release = () => resolve(ok([doorRow()])))),
    );
    const s = source(client);
    s.start();
    await flush();
    s.stop();
    release();
    await flush();
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    s.setEventId(EVENT);
    await vi.advanceTimersByTimeAsync(REASK_MS * 2);
    expect(client.asked).toHaveLength(1);
  });

  it('drops an answer about an event that is no longer current, and a failure after the change leaves the old brand off, not on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let releaseA;
    const forA = () =>
      new Promise((resolve) => {
        releaseA = () => resolve(ok([doorRow({ display_name: 'Event A brand' })]));
      });
    // org-only question (answered at once with a brand), then event A (held), then event B (fails)
    const client = fakeClient(
      ok([doorRow({ display_name: 'Org brand' })]),
      forA,
      fail({ code: '500' }),
    );
    const s = source(client);
    s.start();
    await flush();
    s.setEventId(EVENT); // event A: in flight
    await flush();
    s.setEventId(EVENT_2); // the event moved on
    await flush();
    releaseA(); // A's answer lands: about an event that is no longer current
    await flush();
    expect(seen.map((b) => b.displayName)).toEqual(['Org brand']); // never "Event A brand"
    s.stop();
  });

  it('keeps an existing logo-only brand when its new logo will not load', async () => {
    const client = fakeClient(
      ok([doorRow({ display_name: null })]),
      ok([doorRow({ display_name: null, logo_url: `${LOGO}?v=2` })]),
    );
    const preload = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const s = source(client, { preload });
    s.start();
    await flush();
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(seen).toHaveLength(1); // not removed by a logo that would not load
    s.stop();
  });

  it('never lets a fault inside a question reach the caller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(ok([doorRow()]));
    const s = source(client, {
      preload: () => {
        throw new Error('the preload broke');
      },
    });
    s.start();
    await flush();
    expect(console.error).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REASK_MS); // and it keeps asking
    expect(client.asked).toHaveLength(2);
    s.stop();
  });

  it('says nothing if it is stopped while the logo is still loading', async () => {
    let finishLoading;
    const preload = () => new Promise((resolve) => (finishLoading = () => resolve(true)));
    const client = fakeClient(ok([doorRow()]));
    const s = source(client, { preload });
    s.start();
    await flush();
    s.stop();
    finishLoading();
    await flush();
    expect(seen).toEqual([]);
  });

  it('does not stop asking because the callback threw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(ok([doorRow()]), ok([doorRow({ display_name: 'Two' })]));
    const s = createBrandSource({
      client,
      orgId: ORG,
      preload: OK_PRELOAD,
      onBrand: () => {
        throw new Error('callback broke');
      },
    });
    s.start();
    await flush();
    await vi.advanceTimersByTimeAsync(REASK_MS);
    expect(client.asked).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith(
      'brandDoor: a brand callback failed',
      expect.any(Error),
    );
    s.stop();
  });

  it('asks again for the organisation alone when the screen says it has no event any more', async () => {
    const client = fakeClient(ok([doorRow()]));
    const s = source(client);
    s.start();
    await flush();
    s.setEventId(EVENT);
    await flush();
    s.setEventId(null); // the session ended
    await flush();
    expect(client.asked.map((q) => q.args.p_event_id)).toEqual([null, EVENT, null]);
    s.stop();
  });

  it('settles on the event the screen ends up on after rapid changes (A, then B, then A)', async () => {
    let releaseFirst;
    const slow = () =>
      new Promise((resolve) => {
        releaseFirst = () => resolve(ok([doorRow({ display_name: 'First' })]));
      });
    const client = fakeClient(slow, ok([doorRow({ display_name: 'Latest' })]));
    const s = source(client);
    s.start();
    await flush();
    s.setEventId(EVENT);
    s.setEventId(EVENT_2);
    s.setEventId(EVENT);
    await flush();
    releaseFirst();
    await flush();
    // One waiting question, about the event the screen is on now (not one per change).
    expect(client.asked.map((q) => q.args.p_event_id)).toEqual([null, EVENT]);
    expect(seen.at(-1).displayName).toBe('Latest');
    s.stop();
  });
});
