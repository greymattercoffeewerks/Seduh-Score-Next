import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOrgContext, ORG_STATUS } from './orgContext.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const A = { org_id: 'org-a', name: 'Alpha Coffee', slug: 'alpha-coffee', role: 'owner' };
const B = { org_id: 'org-b', name: 'Bravo Roasters', slug: 'bravo-roasters', role: 'organiser' };
const C = { org_id: 'org-c', name: 'Charlie Beans', slug: 'charlie-beans', role: 'organiser' };

function sessionFor(id, metadata = {}) {
  return { user: { id, email: `${id}@test`, user_metadata: metadata } };
}
const U1 = sessionFor('user-1');
const U2 = sessionFor('user-2');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A client whose my_orgs answers come from a queue: a value (resolved at once), or a deferred the
// test settles by hand. The last answer repeats.
function fakeClient(...answers) {
  const queue = [...answers];
  const rpc = vi.fn(() => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next && typeof next.then === 'function' ? next : Promise.resolve(next);
  });
  return { rpc, client: { rpc } };
}
const rows = (...r) => ({ data: r, error: null });
const failure = (error = { code: '503', message: 'down' }, status) => ({
  data: null,
  error,
  ...(status ? { status } : {}),
});

async function started(client, session = U1, options = {}) {
  const storage = options.storage === undefined ? memoryStorage() : options.storage;
  const context = createOrgContext({ client, storage, ...options });
  await context.refresh(session);
  return context;
}

// Subscribers are told from a microtask (and a listener's own change in the one after), so let them run.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('resolving the active org', () => {
  it('asks the database for the caller’s own orgs, with a plain rpc (a POST, never a cacheable GET)', async () => {
    const { rpc, client } = fakeClient(rows(A));
    await started(client);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(['my_orgs']);
  });

  it('zero orgs is its own state, with no active org (never an empty events list)', async () => {
    const { client } = fakeClient(rows());
    const context = await started(client);
    expect(context.getState().status).toBe(ORG_STATUS.NO_ORG);
    expect(context.getOrgs()).toEqual([]);
    expect(context.getActiveOrgId()).toBeNull();
    expect(context.getActiveOrg()).toBeNull();
  });

  it('one org is the active one, with its name, slug and role', async () => {
    const { client } = fakeClient(rows(A));
    const context = await started(client);
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getActiveOrgId()).toBe('org-a');
    expect(context.getActiveOrg()).toEqual({
      id: 'org-a',
      name: 'Alpha Coffee',
      slug: 'alpha-coffee',
      role: 'owner',
    });
  });

  it('with several orgs and nothing remembered, the first by name is active (whatever order they arrive in)', async () => {
    const { client } = fakeClient(rows(C, A, B));
    const context = await started(client);
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a', 'org-b', 'org-c']);
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('with several orgs, the one this user used last is active', async () => {
    const storage = memoryStorage({ 'seduh.activeOrg.user-1': 'org-c' });
    const { client } = fakeClient(rows(A, B, C));
    const context = await started(client, U1, { storage });
    expect(context.getActiveOrgId()).toBe('org-c');
  });

  it('a remembered org the user is no longer in falls back to the first by name, and is forgotten', async () => {
    const storage = memoryStorage({ 'seduh.activeOrg.user-1': 'org-gone' });
    const { client } = fakeClient(rows(B, C));
    const context = await started(client, U1, { storage });
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getActiveOrgId()).toBe('org-b');
    expect(storage.map.has('seduh.activeOrg.user-1')).toBe(false);
  });

  it('what one user chose is never used for another user on the same device', async () => {
    const storage = memoryStorage({ 'seduh.activeOrg.user-1': 'org-c' });
    const { client } = fakeClient(rows(A, B, C));
    const context = await started(client, U2, { storage });
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('the org already active beats the remembered one (another tab may have written a different hint)', async () => {
    const storage = memoryStorage();
    const { client } = fakeClient(rows(A, B), rows(A, B));
    const context = await started(client, U1, { storage });
    context.setActiveOrg('org-b');
    storage.map.set('seduh.activeOrg.user-1', 'org-a');
    await context.refresh(U1);
    expect(context.getActiveOrgId()).toBe('org-b');
  });
});

describe('ordering', () => {
  it('sorts by name, not by id', async () => {
    const zulu = { org_id: 'org-a', name: 'Zulu', slug: 'zulu', role: 'owner' };
    const alpha = { org_id: 'org-z', name: 'Alpha', slug: 'alpha', role: 'owner' };
    const { client } = fakeClient(rows(zulu, alpha));
    const context = await started(client);
    expect(context.getOrgs().map((o) => o.name)).toEqual(['Alpha', 'Zulu']);
    expect(context.getActiveOrgId()).toBe('org-z');
  });

  it('ignores case when ordering names', async () => {
    const lower = { org_id: 'org-1', name: 'alpha', slug: 'alpha', role: 'owner' };
    const upper = { org_id: 'org-2', name: 'Bravo', slug: 'bravo', role: 'owner' };
    const { client } = fakeClient(rows(upper, lower));
    const context = await started(client);
    expect(context.getOrgs().map((o) => o.name)).toEqual(['alpha', 'Bravo']);
  });

  it('breaks a tie on name by slug, whichever order they arrive in', async () => {
    const x = { org_id: 'org-1', name: 'Same Name', slug: 'x-slug', role: 'owner' };
    const y = { org_id: 'org-2', name: 'Same Name', slug: 'y-slug', role: 'owner' };
    for (const input of [
      [x, y],
      [y, x],
    ]) {
      const { client } = fakeClient(rows(...input));
      const context = await started(client);
      expect(context.getOrgs().map((o) => o.slug)).toEqual(['x-slug', 'y-slug']);
    }
  });

  it('keeps arrival order for rows identical in name and slug', async () => {
    const first = { org_id: 'org-2', name: 'Same', slug: 'same', role: 'owner' };
    const second = { org_id: 'org-1', name: 'Same', slug: 'same', role: 'owner' };
    const { client } = fakeClient(rows(first, second));
    const context = await started(client);
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-2', 'org-1']);
  });
});

describe('what the rows may look like', () => {
  it('drops malformed rows and duplicates instead of failing', async () => {
    const { client } = fakeClient(rows(A, null, { name: 'No id' }, { org_id: '' }, { ...A }, B));
    const context = await started(client);
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a', 'org-b']);
  });

  it('keeps a row with only an id (empty text fields) and drops one whose id is not text', async () => {
    const { client } = fakeClient(rows({ org_id: 'org-x' }, { org_id: 5, name: 7 }, A));
    const context = await started(client);
    expect(context.getOrgs()).toEqual([
      { id: 'org-x', name: '', slug: '', role: '' },
      { id: 'org-a', name: 'Alpha Coffee', slug: 'alpha-coffee', role: 'owner' },
    ]);
  });

  it('fills a non-text name, slug or role with an empty string', async () => {
    const { client } = fakeClient(rows({ org_id: 'org-x', name: 7, slug: {}, role: [] }));
    const context = await started(client);
    expect(context.getOrgs()).toEqual([{ id: 'org-x', name: '', slug: '', role: '' }]);
  });
});

describe('an answer that is not a list is a failure, never "no organisation"', () => {
  const garbage = [
    ['null data', { data: null, error: null }],
    ['an object', { data: { oops: true }, error: null }],
    ['an html page', { data: '<html>captive portal</html>', error: null }],
    ['an empty object', {}],
    ['nothing at all', undefined],
  ];

  for (const [label, answer] of garbage) {
    it(`${label}: an error while nothing is known`, async () => {
      const { client } = fakeClient(answer);
      const context = await started(client);
      expect(context.getState().status).toBe(ORG_STATUS.ERROR);
    });

    it(`${label}: the last known orgs are kept`, async () => {
      const { client } = fakeClient(rows(A, B), answer);
      const context = await started(client);
      await context.refresh(U1);
      expect(context.getState().status).toBe(ORG_STATUS.READY);
      expect(context.getOrgs()).toHaveLength(2);
    });
  }
});

describe('a removed membership, on a later load', () => {
  it('moves the active org to one the user still belongs to, without an error', async () => {
    const { client } = fakeClient(rows(A, B), rows(A));
    const context = await started(client);
    context.setActiveOrg('org-b');
    expect(context.getActiveOrgId()).toBe('org-b');
    await context.refresh(U1);
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('leaves the user with no org at all when every membership is gone', async () => {
    const { client } = fakeClient(rows(A), rows());
    const context = await started(client);
    await context.refresh(U1);
    expect(context.getState().status).toBe(ORG_STATUS.NO_ORG);
    expect(context.getActiveOrgId()).toBeNull();
  });

  it('keeps the org chosen this session across a refresh, even with storage unavailable', async () => {
    const { client } = fakeClient(rows(A, B), rows(A, B));
    const context = await started(client, U1, { storage: null });
    context.setActiveOrg('org-b');
    await context.refresh(U1);
    expect(context.getActiveOrgId()).toBe('org-b');
  });

  it('a choice made while a refresh is in flight survives the answer', async () => {
    const late = deferred();
    const { client } = fakeClient(rows(A, B), late.promise);
    const context = await started(client);
    const pending = context.refresh(U1);
    context.setActiveOrg('org-b');
    late.resolve(rows(A, B));
    await pending;
    expect(context.getActiveOrgId()).toBe('org-b');
  });

  it('…unless that answer no longer includes the chosen org', async () => {
    const late = deferred();
    const { client } = fakeClient(rows(A, B), late.promise);
    const context = await started(client);
    const pending = context.refresh(U1);
    context.setActiveOrg('org-b');
    late.resolve(rows(A));
    await pending;
    expect(context.getActiveOrgId()).toBe('org-a');
  });
});

describe('a change to an org the user is already in', () => {
  it('a changed role is applied and announced once', async () => {
    const { client } = fakeClient(rows(A), rows({ ...A, role: 'organiser' }));
    const context = await started(client);
    const listener = vi.fn();
    context.subscribe(listener);
    await context.refresh(U1);
    await tick();
    expect(context.getActiveOrg().role).toBe('organiser');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a renamed org or a changed slug is applied and announced once each', async () => {
    const { client } = fakeClient(
      rows(A),
      rows({ ...A, name: 'Alpha Coffee Roasters' }),
      rows({ ...A, name: 'Alpha Coffee Roasters', slug: 'alpha-roasters' }),
    );
    const context = await started(client);
    const listener = vi.fn();
    context.subscribe(listener);
    await context.refresh(U1);
    await tick();
    expect(context.getActiveOrg().name).toBe('Alpha Coffee Roasters');
    await context.refresh(U1);
    await tick();
    expect(context.getActiveOrg().slug).toBe('alpha-roasters');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a different user with the very same orgs still replaces the state and is announced', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1);
    const seen = [];
    context.subscribe((s) => seen.push(`${s.status}:${s.userId}`));
    await context.refresh(U2);
    await tick();
    expect(seen).toEqual(['loading:user-2', 'ready:user-2']);
    expect(context.getState().userId).toBe('user-2');
  });
});

describe('setActiveOrg', () => {
  it('switches to an org the user belongs to, remembers it per user, and tells subscribers', async () => {
    const storage = memoryStorage();
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1, { storage });
    const listener = vi.fn();
    context.subscribe(listener);

    expect(context.setActiveOrg('org-b')).toBe(true);
    expect(context.getActiveOrgId()).toBe('org-b');
    expect(storage.map.get('seduh.activeOrg.user-1')).toBe('org-b');
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].activeOrgId).toBe('org-b');
  });

  it('refuses an org the user does not belong to (false, nothing changes, nothing stored)', async () => {
    const storage = memoryStorage();
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1, { storage });
    const listener = vi.fn();
    context.subscribe(listener);

    expect(context.setActiveOrg('org-c')).toBe(false);
    expect(context.setActiveOrg(null)).toBe(false);
    expect(context.setActiveOrg(undefined)).toBe(false);
    expect(context.getActiveOrgId()).toBe('org-a');
    expect(storage.map.has('seduh.activeOrg.user-1')).toBe(false);
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('choosing the org that is already active is accepted, announces nothing, but IS remembered', async () => {
    const storage = memoryStorage();
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1, { storage });
    const listener = vi.fn();
    context.subscribe(listener);
    expect(context.setActiveOrg('org-a')).toBe(true);
    await tick();
    expect(listener).not.toHaveBeenCalled();
    expect(storage.map.get('seduh.activeOrg.user-1')).toBe('org-a');
  });

  it('refuses while nothing is ready: signed out, no org, or still loading a new user', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: memoryStorage() });
    expect(context.setActiveOrg('org-a')).toBe(false);

    await context.refresh(U1);
    const switching = context.refresh(U2);
    expect(context.getState().status).toBe(ORG_STATUS.LOADING);
    expect(context.setActiveOrg('org-a')).toBe(false);
    await switching;
    expect(context.setActiveOrg('org-a')).toBe(true);

    const { client: empty } = fakeClient(rows());
    const none = await started(empty);
    expect(none.setActiveOrg('org-a')).toBe(false);
  });
});

describe('getActiveOrgIdFor', () => {
  it('gives the active org only for the user it was resolved for', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1);
    expect(context.getActiveOrgIdFor('user-1')).toBe('org-a');
    expect(context.getActiveOrgIdFor('user-2')).toBeNull();
    expect(context.getActiveOrgIdFor(undefined)).toBeNull();
  });

  it('gives nothing while the new user’s answer has not arrived, nor when signed out or in no org', async () => {
    const { client } = fakeClient(rows(A));
    const context = await started(client, U1);
    const switching = context.refresh(U2);
    expect(context.getActiveOrgIdFor('user-1')).toBeNull();
    expect(context.getActiveOrgIdFor('user-2')).toBeNull();
    await switching;
    await context.refresh(null);
    expect(context.getActiveOrgIdFor('user-2')).toBeNull();

    const { client: empty } = fakeClient(rows());
    const none = await started(empty);
    expect(none.getActiveOrgIdFor('user-1')).toBeNull();
  });
});

describe('storage', () => {
  it('uses the browser’s localStorage by default: the choice survives a new context', async () => {
    const { client } = fakeClient(rows(A, B));
    const first = createOrgContext({ client });
    await first.refresh(U1);
    first.setActiveOrg('org-b');
    expect(localStorage.getItem('seduh.activeOrg.user-1')).toBe('org-b');

    const second = createOrgContext({ client });
    await second.refresh(U1);
    expect(second.getActiveOrgId()).toBe('org-b');
  });

  it('`storage: null` really means none: nothing is written to localStorage', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: null });
    await context.refresh(U1);
    context.setActiveOrg('org-b');
    expect(localStorage.length).toBe(0);
    expect(context.getActiveOrgId()).toBe('org-b');
  });

  it('works when every storage call throws (private mode, blocked site data)', async () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    const storage = { getItem: boom, setItem: boom, removeItem: boom };
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1, { storage });
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.setActiveOrg('org-b')).toBe(true);
    expect(context.getActiveOrgId()).toBe('org-b');
  });

  it('works when only removing a stale hint throws', async () => {
    const storage = memoryStorage({ 'seduh.activeOrg.user-1': 'org-gone' });
    storage.removeItem = () => {
      throw new Error('quota');
    };
    const { client } = fakeClient(rows(A, B));
    const context = await started(client, U1, { storage });
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('works when merely reading the browser’s localStorage throws', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let reads = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        reads += 1;
        throw new Error('SecurityError');
      },
    });
    try {
      const { client } = fakeClient(rows(A, B));
      const context = createOrgContext({ client });
      await context.refresh(U1);
      expect(context.getActiveOrgId()).toBe('org-a');
      expect(context.setActiveOrg('org-b')).toBe(true);
      expect(reads).toBeGreaterThan(0);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });

  it('ignores a remembered value that is not text', async () => {
    for (const odd of [undefined, 42, {}, '']) {
      const storage = { getItem: () => odd, setItem() {}, removeItem() {} };
      const { client } = fakeClient(rows(A, B));
      const context = await started(client, U1, { storage });
      expect(context.getActiveOrgId()).toBe('org-a');
    }
  });
});

describe('a slow or failed load', () => {
  it('reports an error when nothing is known yet and the call fails, then recovers on a retry', async () => {
    const { client } = fakeClient(failure({ code: '500', message: 'down' }), rows(A));
    const context = await started(client);
    expect(context.getState().status).toBe(ORG_STATUS.ERROR);
    expect(context.getActiveOrgId()).toBeNull();

    const pending = context.refresh(U1);
    expect(context.getState().status).toBe(ORG_STATUS.LOADING);
    await pending;
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('keeps the last known orgs and active org when a later refresh fails', async () => {
    const { client } = fakeClient(rows(A, B), failure({ code: '503' }));
    const context = await started(client);
    context.setActiveOrg('org-b');
    await tick();
    const listener = vi.fn();
    context.subscribe(listener);
    await context.refresh(U1);
    await tick();
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getActiveOrgId()).toBe('org-b');
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps "no organisation" when the refresh that follows it fails', async () => {
    const { client } = fakeClient(rows(), failure({ code: '503' }));
    const context = await started(client);
    await context.refresh(U1);
    expect(context.getState().status).toBe(ORG_STATUS.NO_ORG);
  });

  it('times out a call that never answers: an error while nothing is known', async () => {
    vi.useFakeTimers();
    const { client } = fakeClient(new Promise(() => {}));
    const context = createOrgContext({ client, storage: memoryStorage() });
    const pending = context.refresh(U1);
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    expect(context.getState().status).toBe(ORG_STATUS.LOADING);
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(context.getState().status).toBe(ORG_STATUS.ERROR);
  });

  it('a hang after a good answer keeps that answer', async () => {
    vi.useFakeTimers();
    const { client } = fakeClient(rows(A, B), new Promise(() => {}));
    const context = createOrgContext({ client, storage: memoryStorage() });
    await context.refresh(U1);
    const pending = context.refresh(U1);
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
    await pending;
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getOrgs()).toHaveLength(2);
  });

  it('honours a custom timeout', async () => {
    vi.useFakeTimers();
    const { client } = fakeClient(new Promise(() => {}));
    const context = createOrgContext({ client, storage: memoryStorage(), timeoutMs: 50 });
    const pending = context.refresh(U1);
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    expect(context.getState().status).toBe(ORG_STATUS.ERROR);
  });

  it('treats a client that throws instead of returning as an ordinary failure', async () => {
    const context = createOrgContext({
      client: {
        rpc: () => {
          throw new Error('synchronous boom');
        },
      },
      storage: memoryStorage(),
    });
    await context.refresh(U1);
    expect(context.getState().status).toBe(ORG_STATUS.ERROR);
  });

  it('never rejects, and resolves with the state, even when reading the answer throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({
      get data() {
        throw new Error('getter boom');
      },
      error: null,
    });
    const context = createOrgContext({ client, storage: memoryStorage() });
    const resolved = await context.refresh(U1);
    expect(resolved).toBe(context.getState());
    expect(resolved.status).toBe(ORG_STATUS.ERROR);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('resolves with the state on sign-out too', async () => {
    const { client } = fakeClient(rows(A));
    const context = await started(client);
    expect(await context.refresh(null)).toBe(context.getState());
  });

  describe('which refusals mean "no organisation"', () => {
    it('only a database 22P02 (a token with no usable user id), even without an HTTP status', async () => {
      const { client } = fakeClient(failure({ code: '22P02' }));
      expect((await started(client)).getState().status).toBe(ORG_STATUS.NO_ORG);
    });

    it('22P02 after a good answer replaces it (the server answered)', async () => {
      const { client } = fakeClient(rows(A), failure({ code: '22P02' }, 400));
      const context = await started(client);
      await context.refresh(U1);
      expect(context.getState().status).toBe(ORG_STATUS.NO_ORG);
    });

    const others = [
      ['a 400 from a proxy (no error code)', failure({ message: 'Request Header Too Large' }, 400)],
      ['a 401 (expired token)', failure({ message: 'JWT expired' }, 401)],
      ['a 403', failure({ message: 'forbidden' }, 403)],
      ['a 503', failure({ message: 'unavailable' }, 503)],
      ['a 400 with another code', failure({ code: '22023' }, 400)],
    ];
    for (const [label, answer] of others) {
      it(`${label} is an error while nothing is known`, async () => {
        const { client } = fakeClient(answer);
        const context = await started(client);
        expect(context.getState().status).toBe(ORG_STATUS.ERROR);
      });

      it(`${label} keeps a known answer`, async () => {
        const { client } = fakeClient(rows(A, B), answer);
        const context = await started(client);
        await context.refresh(U1);
        expect(context.getState().status).toBe(ORG_STATUS.READY);
        expect(context.getOrgs()).toHaveLength(2);
      });
    }
  });
});

describe('retry', () => {
  it('asks again with the session the last refresh was given', async () => {
    const { rpc, client } = fakeClient(failure(), rows(A));
    const context = await started(client);
    expect(context.getState().status).toBe(ORG_STATUS.ERROR);
    const pending = context.retry();
    expect(context.getState().status).toBe(ORG_STATUS.LOADING);
    await pending;
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('asks nothing when nobody is signed in', async () => {
    const { rpc, client } = fakeClient(rows(A));
    const context = createOrgContext({ client, storage: memoryStorage() });
    await context.retry();
    await context.refresh(null);
    await context.retry();
    expect(rpc).not.toHaveBeenCalled();
    expect(context.getState().status).toBe(ORG_STATUS.IDLE);
  });

  it('follows the newest session, not an earlier one', async () => {
    const { client } = fakeClient(rows(A), rows(C));
    const context = await started(client, U1);
    await context.refresh(U2);
    await context.retry();
    expect(context.getState().userId).toBe('user-2');
  });
});

describe('overlapping auth events', () => {
  it('of two refreshes for one user the newest wins, even when the older answer arrives last', async () => {
    const slow = deferred();
    const fast = deferred();
    const { rpc, client } = fakeClient(slow.promise, fast.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });

    const first = context.refresh(U1);
    const second = context.refresh(U1);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    fast.resolve(rows(A, B));
    await second;
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a', 'org-b']);

    slow.resolve(rows(A));
    await first;
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a', 'org-b']);
  });

  it('an older answer that arrives first is used, and the newer one replaces it', async () => {
    const slow = deferred();
    const fast = deferred();
    const { rpc, client } = fakeClient(slow.promise, fast.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });

    const first = context.refresh(U1);
    const second = context.refresh(U1);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    slow.resolve(rows(A));
    await first;
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getOrgs()).toHaveLength(1);

    fast.resolve(rows(A, B));
    await second;
    expect(context.getOrgs()).toHaveLength(2);
  });

  it('a newer refresh that fails does not throw away the older good answer', async () => {
    const slow = deferred();
    const fast = deferred();
    const { rpc, client } = fakeClient(slow.promise, fast.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });

    const first = context.refresh(U1);
    const second = context.refresh(U1);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    slow.resolve(rows(A, B));
    await first;
    fast.resolve(failure());
    await second;
    expect(context.getState().status).toBe(ORG_STATUS.READY);
    expect(context.getOrgs()).toHaveLength(2);
  });

  it('an older refresh that fails while a newer one is in flight shows no error', async () => {
    const slow = deferred();
    const fast = deferred();
    const { rpc, client } = fakeClient(slow.promise, fast.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });

    const first = context.refresh(U1);
    const second = context.refresh(U1);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    slow.resolve(failure());
    await first;
    expect(context.getState().status).toBe(ORG_STATUS.LOADING);
    fast.resolve(rows(A));
    await second;
    expect(context.getState().status).toBe(ORG_STATUS.READY);
  });

  it('switching to another user drops the first user’s orgs at once and ignores their late answer', async () => {
    const slowForU1 = deferred();
    const answerForU2 = deferred();
    const rpc = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(rows(A, B)))
      .mockImplementationOnce(() => slowForU1.promise)
      .mockImplementationOnce(() => answerForU2.promise);
    const context = createOrgContext({ client: { rpc }, storage: memoryStorage() });
    await context.refresh(U1);
    expect(context.getActiveOrgId()).toBe('org-a');

    const staleRefresh = context.refresh(U1);
    const switched = context.refresh(U2);
    // Before the new user's answer arrives, none of the first user's orgs is visible.
    expect(context.getState()).toMatchObject({
      status: ORG_STATUS.LOADING,
      userId: 'user-2',
      orgs: [],
      activeOrgId: null,
    });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));

    slowForU1.resolve(rows(A, B));
    await staleRefresh;
    expect(context.getState().userId).toBe('user-2');
    expect(context.getOrgs()).toEqual([]);

    answerForU2.resolve(rows(C));
    await switched;
    expect(context.getState()).toMatchObject({ status: ORG_STATUS.READY, userId: 'user-2' });
    expect(context.getActiveOrgId()).toBe('org-c');
  });

  it('a failure for the new user right after a switch shows an error, not the old user’s orgs', async () => {
    const { client } = fakeClient(rows(A, B), failure());
    const context = await started(client, U1);
    await context.refresh(U2);
    expect(context.getState()).toMatchObject({
      status: ORG_STATUS.ERROR,
      userId: 'user-2',
      orgs: [],
      activeOrgId: null,
    });
  });

  it('signing out clears everything and drops an answer still on its way', async () => {
    const late = deferred();
    const { rpc, client } = fakeClient(rows(A, B), late.promise);
    const context = await started(client);
    const pending = context.refresh(U1);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await context.refresh(null);
    expect(context.getState()).toMatchObject({ status: ORG_STATUS.IDLE, userId: null, orgs: [] });
    expect(context.getActiveOrgId()).toBeNull();

    late.resolve(rows(A, B));
    await pending;
    expect(context.getState().status).toBe(ORG_STATUS.IDLE);
  });

  it('a user who signs out and back in gets a fresh answer, with their remembered org', async () => {
    const storage = memoryStorage();
    const { rpc, client } = fakeClient(rows(A, B), rows(A, B));
    const context = await started(client, U1, { storage });
    context.setActiveOrg('org-b');
    await context.refresh(null);
    await context.refresh(U1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(context.getActiveOrgId()).toBe('org-b');
  });
});

describe('when it asks the database', () => {
  it('never inside refresh() itself, so a call from onAuthStateChange cannot deadlock behind the auth lock', async () => {
    const { rpc, client } = fakeClient(rows(A));
    const context = createOrgContext({ client, storage: memoryStorage() });
    const pending = context.refresh(U1);
    expect(rpc).not.toHaveBeenCalled();
    await pending;
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a signed-out visitor', async () => {
    const { rpc, client } = fakeClient(rows(A));
    const context = createOrgContext({ client, storage: memoryStorage() });
    await context.refresh(null);
    await context.refresh({});
    await context.refresh({ user: {} });
    expect(rpc).not.toHaveBeenCalled();
    expect(context.getState().status).toBe(ORG_STATUS.IDLE);
  });

  it('asks nothing for someone who still has to choose a password', async () => {
    const { rpc, client } = fakeClient(rows(A));
    const context = createOrgContext({ client, storage: memoryStorage() });
    await context.refresh(sessionFor('user-1', { must_change_password: true }));
    expect(rpc).not.toHaveBeenCalled();
    expect(context.getState().status).toBe(ORG_STATUS.IDLE);
  });

  it('and a signed-in user who is then told to choose a password loses their orgs', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = await started(client);
    await context.refresh(sessionFor('user-1', { must_change_password: true }));
    expect(context.getState()).toMatchObject({ status: ORG_STATUS.IDLE, orgs: [] });
    expect(context.getActiveOrgId()).toBeNull();
  });
});

describe('subscribers', () => {
  it('hear a loading then a ready state, in that order, once each', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: memoryStorage() });
    const seen = [];
    context.subscribe((s) => seen.push(s.status));
    const pending = context.refresh(U1);
    await pending;
    await tick();
    // The two changes happen in separate microtasks, so each is announced, in order.
    expect(seen).toEqual(['loading', 'ready']);
    expect(context.getState().status).toBe(ORG_STATUS.READY);
  });

  it('are called from a microtask, never inside refresh() or setActiveOrg()', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: memoryStorage() });
    const listener = vi.fn();
    context.subscribe(listener);
    const pending = context.refresh(U2);
    expect(listener).not.toHaveBeenCalled();
    await pending;
    listener.mockClear();
    context.setActiveOrg('org-b');
    expect(listener).not.toHaveBeenCalled();
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('are told the state as it is when they run, once for a burst of changes', async () => {
    const { client } = fakeClient(rows(A, B, C));
    const context = await started(client);
    await tick();
    const seen = [];
    context.subscribe((s) => seen.push(s.activeOrgId));
    context.setActiveOrg('org-b');
    context.setActiveOrg('org-c');
    await tick();
    expect(seen).toEqual(['org-c']);
  });

  it('do not hear an identical answer (an hourly token refresh)', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: memoryStorage() });
    await context.refresh(U1);
    await tick();
    const listener = vi.fn();
    context.subscribe(listener);
    await context.refresh(U1);
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('do not hear a change that was undone before they ran', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = await started(client);
    await tick();
    const listener = vi.fn();
    context.subscribe(listener);
    context.setActiveOrg('org-b');
    context.setActiveOrg('org-a');
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stop hearing after unsubscribing, and one that throws is reported and does not stop the others', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: memoryStorage() });
    const gone = vi.fn();
    const thrower = vi.fn(() => {
      throw new Error('subscriber bug');
    });
    const healthy = vi.fn();
    const unsubscribe = context.subscribe(gone);
    context.subscribe(thrower);
    context.subscribe(healthy);
    unsubscribe();

    await context.refresh(U1);
    await tick();
    expect(gone).not.toHaveBeenCalled();
    expect(thrower).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('orgContext: a subscriber threw', expect.any(Error));
  });

  it('a listener unsubscribed by an earlier listener in the same round is not called', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = createOrgContext({ client, storage: memoryStorage() });
    const second = vi.fn();
    let unsubscribeSecond;
    context.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = context.subscribe(second);
    await context.refresh(U1);
    await tick();
    expect(second).not.toHaveBeenCalled();
  });

  it('a listener may unsubscribe itself from inside its own callback', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = await started(client);
    await tick();
    const calls = vi.fn();
    const unsubscribe = context.subscribe((s) => {
      calls(s.activeOrgId);
      unsubscribe();
    });
    context.setActiveOrg('org-b');
    await tick();
    context.setActiveOrg('org-a');
    await tick();
    expect(calls.mock.calls).toEqual([['org-b']]);
  });

  it('a listener that changes the state is told, in order, with the later listeners seeing every state once', async () => {
    const { client } = fakeClient(rows(A, B, C));
    const context = await started(client);
    await tick();
    const first = [];
    const second = [];
    context.subscribe((s) => {
      first.push(s.activeOrgId);
      if (s.activeOrgId === 'org-b') context.setActiveOrg('org-c');
    });
    context.subscribe((s) => second.push(s.activeOrgId));
    context.setActiveOrg('org-b');
    await tick();
    await tick();
    expect(first).toEqual(['org-b', 'org-c']);
    expect(second).toEqual(['org-b', 'org-c']);
  });

  it('hands out states that cannot be edited from outside', async () => {
    const { client } = fakeClient(rows(A));
    const context = await started(client);
    expect(Object.isFrozen(context.getState())).toBe(true);
    expect(Object.isFrozen(context.getOrgs())).toBe(true);
    expect(Object.isFrozen(context.getOrgs()[0])).toBe(true);
  });
});

describe('destroy', () => {
  it('drops an answer still on its way, and leaves the state alone', async () => {
    const late = deferred();
    const { client } = fakeClient(late.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });
    const listener = vi.fn();
    context.subscribe(listener);
    const pending = context.refresh(U1);
    await tick();
    listener.mockClear();
    context.destroy();
    late.resolve(rows(A));
    await pending;
    await tick();
    expect(listener).not.toHaveBeenCalled();
    expect(context.getState().status).toBe(ORG_STATUS.LOADING);
  });

  it('is final: no subscriber is called again, nothing asks the database, nothing can be chosen', async () => {
    const { rpc, client } = fakeClient(rows(A, B));
    const context = await started(client);
    await tick();
    const listener = vi.fn();
    context.subscribe(listener);
    context.destroy();
    rpc.mockClear();

    expect(context.setActiveOrg('org-b')).toBe(false);
    await context.refresh(U2);
    await context.retry();
    context.subscribe(listener)();
    await tick();
    expect(rpc).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(context.getState().userId).toBe('user-1');
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('a change announced just before destroy is not delivered to anyone', async () => {
    const { client } = fakeClient(rows(A, B));
    const context = await started(client);
    await tick();
    const listener = vi.fn();
    context.subscribe(listener);
    context.setActiveOrg('org-b');
    context.destroy();
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('a subscriber added after destroy is never called', async () => {
    const { client } = fakeClient(rows(A));
    const context = createOrgContext({ client, storage: memoryStorage() });
    context.destroy();
    const listener = vi.fn();
    context.subscribe(listener);
    await context.refresh(U1);
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the remembered org list (a stand-in when the first question fails)', () => {
  const snapshotKey = 'seduh.orgs.user-1';
  const remembered = (...orgs) => JSON.stringify(orgs);

  it('is written after every real answer with orgs, and holds what the screen shows', async () => {
    const storage = memoryStorage();
    const { client } = fakeClient(rows(B, A));
    await started(client, U1, { storage });
    expect(JSON.parse(storage.map.get(snapshotKey))).toEqual([A, B]);
  });

  it('stands in when the first question fails and nothing is known: ready, but marked stale', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A, B) });
    const { client } = fakeClient(failure());
    const context = await started(client, U1, { storage });
    expect(context.getState()).toMatchObject({ status: ORG_STATUS.READY, stale: true });
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a', 'org-b']);
    expect(context.getActiveOrgId()).toBe('org-a');
  });

  it('honours the remembered "last used" org while standing in', async () => {
    const storage = memoryStorage({
      [snapshotKey]: remembered(A, B),
      'seduh.activeOrg.user-1': 'org-b',
    });
    const { client } = fakeClient(failure());
    const context = await started(client, U1, { storage });
    expect(context.getActiveOrgId()).toBe('org-b');
  });

  it('stands in for every kind of failure: a hang, an error, a non-list answer', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage({ [snapshotKey]: remembered(A) });
    for (const answer of [new Promise(() => {}), failure({ code: '503' }, 503), { data: 'oops' }]) {
      const { client } = fakeClient(answer);
      const context = createOrgContext({ client, storage });
      const pending = context.refresh(U1);
      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
      await pending;
      expect(context.getState()).toMatchObject({ status: ORG_STATUS.READY, stale: true });
    }
  });

  it('the next real answer replaces it, and is no longer stale', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A, B) });
    const { client } = fakeClient(failure(), rows(A));
    const context = await started(client, U1, { storage });
    expect(context.getState().stale).toBe(true);
    await context.retry();
    expect(context.getState()).toMatchObject({ status: ORG_STATUS.READY, stale: false });
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a']);
    expect(JSON.parse(storage.map.get(snapshotKey))).toEqual([A]);
  });

  it('is announced to subscribers like any other change', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A) });
    const { client } = fakeClient(failure(), rows(A));
    const context = createOrgContext({ client, storage });
    const seen = [];
    context.subscribe((state) => seen.push(`${state.status}:${state.stale}`));
    await context.refresh(U1);
    await context.retry();
    await tick();
    expect(seen).toEqual(['loading:false', 'ready:true', 'ready:false']);
  });

  it('is never used for another user', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A) });
    const { client } = fakeClient(failure());
    const context = await started(client, U2, { storage });
    expect(context.getState().status).toBe(ORG_STATUS.ERROR);
    expect(context.getOrgs()).toEqual([]);
  });

  it('is never used when something is already known (a failed later refresh keeps the real answer)', async () => {
    const storage = memoryStorage();
    const { client } = fakeClient(rows(B), failure());
    const context = await started(client, U1, { storage });
    storage.map.set(snapshotKey, remembered(A));
    await context.refresh(U1);
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-b']);
    expect(context.getState().stale).toBe(false);
  });

  it('is erased by an answer that says "no organisation", so it cannot resurrect a lost membership', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A) });
    const { client } = fakeClient(rows(), failure());
    const first = await started(client, U1, { storage });
    expect(first.getState().status).toBe(ORG_STATUS.NO_ORG);
    expect(storage.map.has(snapshotKey)).toBe(false);

    const second = await started(client, U1, { storage });
    expect(second.getState().status).toBe(ORG_STATUS.ERROR);
  });

  it('is erased by a 22P02 answer too', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A) });
    const { client } = fakeClient(failure({ code: '22P02' }, 400));
    await started(client, U1, { storage });
    expect(storage.map.has(snapshotKey)).toBe(false);
  });

  it('is ignored when it is empty, corrupt, or not a list', async () => {
    for (const bad of ['', 'not json', '{"a":1}', '[]', 'null', '[{"name":"no id"}]']) {
      const storage = memoryStorage({ [snapshotKey]: bad });
      const { client } = fakeClient(failure());
      const context = await started(client, U1, { storage });
      expect(context.getState().status).toBe(ORG_STATUS.ERROR);
    }
  });

  it('is sorted and cleaned like a real answer', async () => {
    const storage = memoryStorage({
      [snapshotKey]: remembered(B, A, { org_id: 'org-a', name: 'duplicate' }, null),
    });
    const { client } = fakeClient(failure());
    const context = await started(client, U1, { storage });
    expect(context.getOrgs().map((o) => o.id)).toEqual(['org-a', 'org-b']);
  });

  it('does nothing, and breaks nothing, with no storage or a storage that throws', async () => {
    const { client } = fakeClient(rows(A), failure());
    const context = await started(client, U1, { storage: null });
    expect(context.getState().status).toBe(ORG_STATUS.READY);

    const boom = () => {
      throw new Error('SecurityError');
    };
    const broken = { getItem: boom, setItem: boom, removeItem: boom };
    const { client: failing } = fakeClient(failure());
    const withBroken = await started(failing, U1, { storage: broken });
    expect(withBroken.getState().status).toBe(ORG_STATUS.ERROR);
  });

  it('a sign-out and a different user clear the stale flag', async () => {
    const storage = memoryStorage({ [snapshotKey]: remembered(A) });
    const { client } = fakeClient(failure());
    const context = await started(client, U1, { storage });
    expect(context.getState().stale).toBe(true);
    await context.refresh(null);
    expect(context.getState().stale).toBe(false);
    await context.refresh(U2);
    expect(context.getState().stale).toBe(false);
  });
});

describe('whenSettled', () => {
  it('resolves at once with the state when nothing has been asked', async () => {
    const { rpc, client } = fakeClient(rows(A));
    const context = createOrgContext({ client, storage: memoryStorage() });
    expect(await context.whenSettled()).toBe(context.getState());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('waits for the refresh in flight and resolves with its answer, without asking anything itself', async () => {
    const late = deferred();
    const { rpc, client } = fakeClient(late.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });
    const refreshing = context.refresh(U1);
    let settled = false;
    const waiting = context.whenSettled().then((state) => {
      settled = true;
      return state;
    });
    await tick();
    expect(settled).toBe(false);
    late.resolve(rows(A, B));
    const state = await waiting;
    await refreshing;
    expect(state.status).toBe(ORG_STATUS.READY);
    expect(state.orgs).toHaveLength(2);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('follows the newest refresh when a newer one started', async () => {
    const slow = deferred();
    const fast = deferred();
    const { rpc, client } = fakeClient(slow.promise, fast.promise);
    const context = createOrgContext({ client, storage: memoryStorage() });
    context.refresh(U1);
    context.refresh(U1);
    const waiting = context.whenSettled();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    fast.resolve(rows(A, B));
    expect((await waiting).orgs).toHaveLength(2);
    slow.resolve(rows(A));
  });

  it('resolves to the idle state after a sign-out', async () => {
    const { client } = fakeClient(rows(A));
    const context = await started(client);
    await context.refresh(null);
    expect((await context.whenSettled()).status).toBe(ORG_STATUS.IDLE);
  });

  it('does not hang after destroy', async () => {
    const { client } = fakeClient(rows(A));
    const context = await started(client);
    context.destroy();
    await expect(context.whenSettled()).resolves.toBeDefined();
  });
});
