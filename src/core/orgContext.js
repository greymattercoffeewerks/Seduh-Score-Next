// Which organisations the signed-in person belongs to, and which one the console is acting in
// (T-TEN.C1). Format-agnostic: nothing here knows what an org does.
//
// The answer comes from the database (`my_orgs()`, which returns only the caller's own memberships),
// never from a build-time variable or from anything the person typed. This module only HOLDS that
// answer and the choice among several; every write is still checked by the database against the
// org it names, whatever this module says is active.
//
// Built as a factory (one context per mounted app), not a module-level singleton, so two mounted
// apps in a test, or a future second client, never share state.
//
// Rules this file keeps:
//   * A stored "last used" org is only ever a hint. It is re-checked against the fresh list on every
//     load, so a removed membership falls back to another org and never errors.
//   * Another account's answer is never reused. When the signed-in user changes, the previous org
//     list is dropped at once, before the new answer arrives.
//   * Only the database saying "no orgs" (an empty list) or "no usable user" (22P02) means "no
//     organisation". Anything else that goes wrong (offline, timed out, a 401, a gateway's 400, a
//     page that is not JSON) is a failure: it keeps the last known answer, and only reports an error
//     when nothing is known yet. A proxy hiccup must never lock an organiser out.
//   * `refresh()` never reads the database synchronously, and subscribers are called from a
//     microtask, never from inside `refresh()` / `setActiveOrg()`. That keeps both safe to call from
//     `onAuthStateChange`, where supabase-js holds its auth lock and an RPC that needs the session
//     would deadlock behind it, even if a subscriber starts one.
//   * Of overlapping refreshes for one user the newest answer wins, but an older good answer is still
//     applied if it arrives while the newer one is in flight, so a newer refresh that fails does not
//     throw a good answer away. An answer for an earlier user is dropped on arrival.
//   * Storage can be missing, blocked or full (private mode); the app works without it.
import { getSupabase } from './supabaseClient.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export const ORG_STATUS = Object.freeze({
  // Nobody is signed in (or they still have to choose a password): no question is being asked.
  IDLE: 'idle',
  // Signed in, and the first answer has not arrived.
  LOADING: 'loading',
  // One or more orgs, one of them active.
  READY: 'ready',
  // Signed in, and in no organisation: a real state, not an error (a Guess the Bean account shares
  // the same logins).
  NO_ORG: 'no_org',
  // Signed in, nothing known yet, and the question failed (offline, timed out, server error).
  ERROR: 'error',
});

const STORAGE_PREFIX = 'seduh.activeOrg.';

const IDLE_STATE = Object.freeze({
  status: ORG_STATUS.IDLE,
  userId: null,
  orgs: Object.freeze([]),
  activeOrgId: null,
});

// What the database says when the token has no usable user id (`sub` empty or not a UUID): 22P02
// (HTTP 400), the same as every policy that calls auth.uid(). GoTrue never issues such a token, but
// if it happened the honest answer is "no organisation context". A 400 WITHOUT that code (a proxy, a
// CDN, a header-too-large page) says nothing about this user, so it is an ordinary failure.
function isNoUserError(error) {
  return error?.code === '22P02';
}

// The rows the database sent, as the orgs this module holds; null when the answer is not a list at
// all (then it is a failure, not "no orgs").
function normaliseOrgs(data) {
  if (!Array.isArray(data)) return null;
  const seen = new Set();
  const orgs = [];
  for (const row of data) {
    if (!row || typeof row.org_id !== 'string' || !row.org_id || seen.has(row.org_id)) continue;
    seen.add(row.org_id);
    orgs.push(
      Object.freeze({
        id: row.org_id,
        name: typeof row.name === 'string' ? row.name : '',
        slug: typeof row.slug === 'string' ? row.slug : '',
        role: typeof row.role === 'string' ? row.role : '',
      }),
    );
  }
  // A fixed locale, so "first by name" does not depend on the browser's language. The sort is stable,
  // so two rows with the same name and slug keep the order they arrived in.
  orgs.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.slug.localeCompare(b.slug, 'en'));
  return Object.freeze(orgs);
}

function sameOrgs(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (org, i) =>
        org.id === b[i].id &&
        org.name === b[i].name &&
        org.slug === b[i].slug &&
        org.role === b[i].role,
    )
  );
}

function sameState(a, b) {
  return (
    a.status === b.status &&
    a.userId === b.userId &&
    a.activeOrgId === b.activeOrgId &&
    sameOrgs(a.orgs, b.orgs)
  );
}

// Someone who must still choose a password sees nothing but that screen, so no org question is
// asked for them (same rule as the Team-link check in main.js).
function signedInUserId(session) {
  const userId = session?.user?.id;
  if (typeof userId !== 'string' || !userId) return null;
  if (session.user.user_metadata?.must_change_password === true) return null;
  return userId;
}

export function createOrgContext({
  client = getSupabase(),
  // `undefined` means "the browser's localStorage if there is one"; pass `null` for none.
  storage,
  timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
} = {}) {
  let state = IDLE_STATE;
  // Bumped by every refresh: "which question is the newest".
  let seq = 0;
  // The newest refresh whose answer has been applied; an older one arriving later is dropped.
  let appliedSeq = 0;
  // Bumped whenever the signed-in user changes (including sign-out) and by destroy(): an answer
  // carrying an older epoch belongs to someone else and is dropped.
  let epoch = 0;
  let destroyed = false;
  // The session the last refresh() was given, so retry() can ask again without the caller digging
  // it out of the auth client.
  let lastSession = null;
  const listeners = new Set();
  let deliveryQueued = false;
  let lastDelivered = state;

  function getStore() {
    try {
      return storage === undefined ? (globalThis.localStorage ?? null) : storage;
    } catch {
      return null;
    }
  }
  function readStored(userId) {
    try {
      return getStore()?.getItem(STORAGE_PREFIX + userId) || null;
    } catch {
      return null;
    }
  }
  function writeStored(userId, orgId) {
    try {
      getStore()?.setItem(STORAGE_PREFIX + userId, orgId);
    } catch {
      // Blocked or full: the choice just does not survive a reload.
    }
  }
  function removeStored(userId) {
    try {
      getStore()?.removeItem(STORAGE_PREFIX + userId);
    } catch {
      // Nothing to clean up if storage cannot be reached.
    }
  }

  // Subscribers are told from a microtask, with the state as it is by then, once per burst of
  // changes. A listener that unsubscribes another is honoured at once; one that changes the state
  // again is told about it in the next delivery, in order.
  function deliver() {
    deliveryQueued = false;
    if (sameState(state, lastDelivered)) return;
    const snapshot = state;
    lastDelivered = snapshot;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener(snapshot);
      } catch (err) {
        console.error('orgContext: a subscriber threw', err);
      }
    }
  }

  function setState(next) {
    const merged = Object.freeze({ ...state, ...next });
    if (sameState(merged, state)) return;
    state = merged;
    if (!deliveryQueued) {
      deliveryQueued = true;
      queueMicrotask(deliver);
    }
  }

  // The org to act in: the one already active if it is still in the list, else the stored "last
  // used" one if it still is, else the first by name. A stored id that is no longer valid is
  // removed, so it cannot come back after a membership is restored under a different history.
  function chooseActive(userId, orgs, currentActiveId) {
    if (orgs.length === 0) return null;
    if (currentActiveId && orgs.some((org) => org.id === currentActiveId)) return currentActiveId;
    const stored = readStored(userId);
    if (stored) {
      if (orgs.some((org) => org.id === stored)) return stored;
      removeStored(userId);
    }
    return orgs[0].id;
  }

  // A failed answer: keep what is known; only report an error when nothing is known yet. Only the
  // newest question reports, so an older one failing while a newer one is still in flight cannot
  // flash an error.
  function reportFailure(mySeq, myEpoch) {
    if (myEpoch !== epoch || mySeq !== seq) return;
    const known = state.status === ORG_STATUS.READY || state.status === ORG_STATUS.NO_ORG;
    if (!known) setState({ status: ORG_STATUS.ERROR });
  }

  async function load(mySeq, myEpoch, userId) {
    let result;
    try {
      // Evaluated inside the try, so even a synchronous throw from the client is a failure.
      result = await raceTimeout(client.rpc('my_orgs'), timeoutMs);
    } catch {
      reportFailure(mySeq, myEpoch);
      return;
    }
    // The signed-in user changed (or the context was destroyed) while this was in flight.
    if (myEpoch !== epoch) return;

    let orgs;
    if (result?.error) {
      if (!isNoUserError(result.error)) {
        reportFailure(mySeq, myEpoch);
        return;
      }
      orgs = Object.freeze([]);
    } else {
      orgs = normaliseOrgs(result?.data);
      if (orgs === null) {
        reportFailure(mySeq, myEpoch);
        return;
      }
    }

    // A newer question's answer is already in; this older one is out of date.
    if (mySeq < appliedSeq) return;
    appliedSeq = mySeq;

    // Read now, not before the await: a choice made while the answer was on its way still counts.
    setState({
      status: orgs.length > 0 ? ORG_STATUS.READY : ORG_STATUS.NO_ORG,
      userId,
      orgs,
      activeOrgId: chooseActive(userId, orgs, state.activeOrgId),
    });
  }

  // Ask the database which orgs this session's user belongs to. Call it on every auth event
  // (including sign-out, with a null session). Resolves, with the state, once that question is
  // answered or overtaken; it never rejects.
  function refresh(session) {
    if (destroyed) return Promise.resolve(state);
    lastSession = session ?? null;
    seq += 1;
    const mySeq = seq;
    const userId = signedInUserId(session);
    if (!userId) {
      epoch += 1;
      setState(IDLE_STATE);
      return Promise.resolve(state);
    }
    if (state.userId !== userId) {
      // A different person: nothing from the previous account may be used, not even while waiting.
      epoch += 1;
      setState({ status: ORG_STATUS.LOADING, userId, orgs: IDLE_STATE.orgs, activeOrgId: null });
    } else if (state.status === ORG_STATUS.ERROR) {
      setState({ status: ORG_STATUS.LOADING });
    }
    const myEpoch = epoch;
    // Deferred a tick: see the note at the top about the auth lock.
    return Promise.resolve()
      .then(() => load(mySeq, myEpoch, userId))
      .catch((err) => {
        console.error('orgContext: refresh failed', err);
        reportFailure(mySeq, myEpoch);
      })
      .then(() => state);
  }

  return {
    refresh,

    // Ask again with the session the last refresh() was given (the Retry button after an error).
    retry: () => refresh(lastSession),

    getState: () => state,
    getOrgs: () => state.orgs,
    getActiveOrgId: () => state.activeOrgId,
    getActiveOrg: () => state.orgs.find((org) => org.id === state.activeOrgId) ?? null,

    // The active org, but only if it was resolved for this very user: a writer that holds a session
    // (an outbox flush) uses this so it can never pair one account's token with another's org in the
    // gap between the session changing and the auth callback running.
    // (activeOrgId is only ever set while READY, so a matching user is the whole check.)
    getActiveOrgIdFor: (userId) => (state.userId === userId ? state.activeOrgId : null),

    // Switch the org the console acts in. Only an org the user belongs to can be chosen; anything
    // else is refused (false), never thrown. The choice is remembered per user, including picking
    // the org that is already active (so a new org that sorts first later does not take over).
    setActiveOrg(orgId) {
      // Only READY has orgs to choose from, so membership is the whole check.
      if (destroyed || !state.orgs.some((org) => org.id === orgId)) return false;
      writeStored(state.userId, orgId);
      if (orgId !== state.activeOrgId) setState({ activeOrgId: orgId });
      return true;
    },

    // fn(state) runs after a change, from a microtask (not at once on subscribing). Returns the
    // unsubscribe function.
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    // Final: drop any answer still on its way and every subscriber (an app being unmounted). Nothing
    // asks the database or changes state afterwards.
    destroy() {
      destroyed = true;
      epoch += 1;
      seq += 1;
      listeners.clear();
    },
  };
}
