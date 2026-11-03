import { test, expect } from '@playwright/test';
import { createTenant } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rest, rpc, signInPassword } from './support/api.js';

// T-ID.D1a: the Seduh ID archive feed over the REAL local PostgREST, with real JWTs, the way a hostile client would reach it
// (no browser). The pgTAP file 071 proves the rules inside the database; this proves what only travels over HTTP, where the
// session user is `authenticator`: an organiser's publish of a podium QUEUES a review row and CREATES NOTHING, the organiser
// learns nothing from it (the same empty answer as before the feed existed), a stranger's publish queues nothing, the queue
// and the mode are not reachable by name through the API by anyone, and no feed function is exposed.
//
// The mode is switched to `queue` for the run through the database owner (no API door can change it) and put back to its
// previous value afterwards. Local stack only (tenants.js and admins.js refuse any other host).

const tag = Date.now().toString(36);
const digits = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const PHONE = `+673962${digits()}`;
const w = {};
let previousMode = 'off';

const scalar = (query) => {
  const out = sqlAsOwner(`select (${query})::text as v`);
  const lines = out.split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => /^-+$/.test(l));
  const value = at === -1 || /^\(\d+ rows?\)$/.test(lines[at + 1]) ? null : lines[at + 1];
  return value === '' ? null : value; // psql prints a SQL NULL as an empty cell
};
const queueState = (eventId) =>
  scalar(
    `select q.state from app.seduh_feed_queue q join public.public_results r on r.id = q.result_id where r.event_id = '${eventId}'`,
  );
const podium = (name) => ({
  format: 'cup_taster',
  eventName: `Feed ${tag}`,
  podium: [{ rank: 1, name, cafe: 'Cafe Feed', correct: 5, total: 6 }],
});

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120000);
  previousMode = scalar('select mode from app.seduh_feed_mode') ?? 'off';
  sqlAsOwner(`update app.seduh_feed_mode set mode = 'queue'`);
  w.a = await createTenant({ label: 'fda', live: false, grant: false });
  w.b = await createTenant({ label: 'fdb', live: false, grant: false });
  w.tokenA = (await signInPassword(w.a)).token;
  w.tokenB = (await signInPassword(w.b)).token;

  w.event = (await w.a.createEvent({ format: 'cup_taster', name: `Feed ${tag}` })).id;
  const person = await rest('people?select=id', {
    method: 'POST',
    token: w.tokenA,
    body: { org_id: w.a.orgId, display_name: `Feed Winner ${tag}`, phone: PHONE },
    headers: { prefer: 'return=representation' },
  });
  expect(person.status, JSON.stringify(person.body)).toBe(201);
  w.person = person.body[0].id;
  const entry = await rest('event_entries', {
    method: 'POST',
    token: w.tokenA,
    body: {
      event_id: w.event,
      person_id: w.person,
      display_name: `Feed Winner ${tag}`,
      cafe: 'Cafe Feed',
    },
  });
  expect(entry.status, JSON.stringify(entry.body)).toBe(201);
});

test.afterAll(() => {
  sqlAsOwner(`update app.seduh_feed_mode set mode = '${previousMode}'`);
});

test('a stranger cannot publish for the organisation, and nothing is queued by the refusal', async () => {
  const r = await rpc(
    'publish_event_results',
    { p_org_id: w.a.orgId, p_event_id: w.event, p_payload: podium(`Feed Winner ${tag}`) },
    { token: w.tokenB },
  );
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(queueState(w.event)).toBeNull();
});

test('an organiser publishes a podium: the answer is the empty one, a review row is queued, and NOTHING is created', async () => {
  const r = await rpc(
    'publish_event_results',
    { p_org_id: w.a.orgId, p_event_id: w.event, p_payload: podium(`Feed Winner ${tag}`) },
    { token: w.tokenA },
  );
  // the feed adds nothing to what a publish says: a void function answers 200/204 with an empty body
  expect([200, 204], JSON.stringify(r.body)).toContain(r.status);
  expect(r.body === null || r.body === '' || r.body === undefined).toBe(true);

  expect(queueState(w.event)).toBe('queued');
  expect(scalar(`select count(*) from app.seduh_identities where phone_e164 = '${PHONE}'`)).toBe(
    '0',
  );
  const link = await rest(`people?id=eq.${w.person}&select=global_person_id`, {
    token: w.tokenA,
  });
  expect(link.status).toBe(200);
  expect(link.body[0].global_person_id).toBeNull();
});

test('republishing the same podium changes nothing; a stub (no podium) is not queued', async () => {
  const again = await rpc(
    'publish_event_results',
    { p_org_id: w.a.orgId, p_event_id: w.event, p_payload: podium(`Feed Winner ${tag}`) },
    { token: w.tokenA },
  );
  expect([200, 204]).toContain(again.status);
  expect(queueState(w.event)).toBe('queued');

  const stubEvent = (await w.a.createEvent({ format: 'cup_taster', name: `Stub ${tag}` })).id;
  const stub = await rpc(
    'publish_event_results',
    {
      p_org_id: w.a.orgId,
      p_event_id: stubEvent,
      p_payload: { format: 'cup_taster', listing: 'named_only' },
    },
    { token: w.tokenA },
  );
  expect([200, 204]).toContain(stub.status);
  expect(queueState(stubEvent)).toBeNull();
});

test('with the mode off a publish queues nothing', async () => {
  sqlAsOwner(`update app.seduh_feed_mode set mode = 'off'`);
  try {
    const offEvent = (await w.a.createEvent({ format: 'cup_taster', name: `Off ${tag}` })).id;
    const r = await rpc(
      'publish_event_results',
      { p_org_id: w.a.orgId, p_event_id: offEvent, p_payload: podium(`Someone ${tag}`) },
      { token: w.tokenA },
    );
    expect([200, 204]).toContain(r.status);
    expect(queueState(offEvent)).toBeNull();
  } finally {
    sqlAsOwner(`update app.seduh_feed_mode set mode = 'queue'`);
  }
});

test('the queue, the mode and the feed functions are reachable by no API caller, by any route', async () => {
  const callers = [
    ['an organiser', w.tokenA],
    ['a stranger', w.tokenB],
    ['anonymous', null],
  ];
  const statuses = [];
  for (const [who, token] of callers) {
    const opts = token === null ? {} : { token };
    for (const table of ['seduh_feed_queue', 'seduh_feed_mode']) {
      // by name in the default schema, and by asking for the `app` schema
      const plain = await rest(`${table}?select=*`, opts);
      const profiled = await rest(`${table}?select=*`, {
        ...opts,
        headers: { 'accept-profile': 'app' },
      });
      statuses.push({ who, table, plain: plain.status, profiled: profiled.status });
      expect(plain.status, `${who} ${table}`).toBeGreaterThanOrEqual(400);
      expect(profiled.status, `${who} ${table} (app profile)`).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify([plain.body, profiled.body])).not.toContain(PHONE);
    }
    for (const fn of ['seduh_identity_feed', 'seduh_feed_review', 'seduh_feed_auto_run']) {
      const plain = await rpc(fn, { p_result_ids: [crypto.randomUUID()] }, opts);
      const profiled = await rpc(
        fn,
        { p_result_ids: [crypto.randomUUID()] },
        { ...opts, headers: { 'content-profile': 'app' } },
      );
      expect(plain.status, `${who} ${fn}`).toBeGreaterThanOrEqual(400);
      expect(profiled.status, `${who} ${fn} (app profile)`).toBeGreaterThanOrEqual(400);
    }
  }
  console.log('FEED REACH\n' + statuses.map((s) => JSON.stringify(s)).join('\n'));
  // and still nothing was created by any of the above
  expect(scalar(`select count(*) from app.seduh_identities where phone_e164 = '${PHONE}'`)).toBe(
    '0',
  );
});
