import { test, expect } from '@playwright/test';
import { addMember, createLoneUser, createTenant, serviceRoleKey } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rest, rpc, send, signInPassword } from './support/api.js';
import { callAdminRpc, grantEventPlan, setKeyEnforced } from './support/grants.js';
import { dbNow, ledgerRow, makeDue, resultCount, runTick } from './support/archive.js';

// T-ARC.5 (API level): the archive pipeline over the REAL local PostgREST, with real sign-ins, the way a hostile or an
// ordinary client reaches it (no browser). The pgTAP files prove the same rules inside the database; this proves what
// travels over HTTP and that the scheduler's owner-only edge stays closed to every API role.
//
// HOW THE DARK GATE IS HANDLED. The pipeline is dark (T-ARC.1: app.archive_tick, and T-ARC.2's stage_archive_payload, do
// nothing while app.entitlement_keys.enforced is false for results_archive_optional), and no tick path ignores that gate.
// So the key is switched ON for the whole stack through the audited admin key switch with a real platform-admin session
// (support/grants.js, the route btc-entitlement.spec.js uses) and put back OFF in afterAll. The key is global, which is why
// this spec has its own project, last and alone (playwright.config.js, 'dev-archive'). Which organisation takes the
// compulsory path and which the optional one is decided by the plan each one is given (createTenant's `grant`).
//
// THE SCHEDULER. app.archive_tick is executable by no API role, so the tick is run as the database owner through the local
// container (support/archive.js), exactly as pg_cron will run it; the ledger is read the same way. The one thing faked is
// the clock: a row's stored due time is moved to one second ago (the 24 hours are in the migration, not re-proved by
// waiting), after proving that before that moment the tick publishes nothing.
//
// Callers (real sign-ins): the organiser of a Community organisation (com), the organiser of an Annual one (ann), the
// organiser of a Per-event one (per), a stranger who organises another organisation (other), a person who belongs to NOBODY,
// a person who belongs to TWO organisations (com and other), and the anonymous caller. Local stack only.

const KEY = 'results_archive_optional';
const tag = Date.now().toString(36);
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Brunei calendar date

// a podium row carrying everything a browser snapshot could carry; only the whitelisted keys may reach the archive
const PHONE = '+6739611234';
const EMAIL = `secret-${tag}@example.test`;
function snapshot(label) {
  return {
    format: 'cup_taster',
    eventName: `Arc ${label} ${tag}`,
    eventDate: today,
    city: 'Testville',
    venue: 'Test Roastery',
    competitors: 3,
    rounds: 2,
    podium: [
      {
        rank: 1,
        name: `Champion ${label} ${tag}`,
        cafe: 'Cafe One',
        correct: 5,
        total: 6,
        phone: PHONE,
      },
      {
        rank: 2,
        name: `Second ${label} ${tag}`,
        cafe: 'Cafe Two',
        correct: 4,
        total: 6,
        email: EMAIL,
      },
      { rank: 3, name: `Third ${label} ${tag}`, correct: 3, total: 6 },
    ],
    standings: [{ rank: 4, name: `Fourth ${label} ${tag}`, correct: 2, total: 6 }],
    notListed: [{ name: `Hidden ${label} ${tag}` }],
    secretExtra: 'must not be copied',
  };
}

const w = {};
const mine = {}; // events by name

async function newEvent(tenant, name) {
  const event = await tenant.createEvent({ format: 'cup_taster', name: `${name} ${tag}` });
  mine[name] = event.id;
  return event.id;
}
async function finish(token, orgId, eventId) {
  const r = await rpc('finish_event', { p_org_id: orgId, p_event_id: eventId }, { token });
  expect([200, 204], JSON.stringify(r.body)).toContain(r.status);
}
async function stage(token, orgId, eventId, payload, operationId = crypto.randomUUID()) {
  const r = await rpc(
    'stage_archive_payload',
    { p_operation_id: operationId, p_org_id: orgId, p_event_id: eventId, p_payload: payload },
    { token },
  );
  return r;
}
async function publicRow(eventId) {
  const r = await rest(
    `public_results?event_id=eq.${eventId}&select=id,org_id,payload,published_at`,
  );
  expect(r.status).toBe(200);
  return r.body[0] ?? null;
}
const answer = (r) => `${r.status}|${r.body?.code}|${r.body?.message}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180000);
  await setKeyEnforced(KEY, false);
  w.com = await createTenant({ label: 'arccom', live: false, grant: false });
  w.other = await createTenant({ label: 'arcoth', live: false, grant: false });
  w.ann = await createTenant({ label: 'arcann', live: false, grant: 'annual' });
  w.per = await createTenant({ label: 'arcper', live: false, grant: false });
  const nobody = await createLoneUser('arc-nobody');
  const both = await createLoneUser('arc-both');
  await addMember(w.com, both, 'organiser');
  await addMember(w.other, both, 'organiser');
  w.tCom = (await signInPassword(w.com)).token;
  w.tOther = (await signInPassword(w.other)).token;
  w.tAnn = (await signInPassword(w.ann)).token;
  w.tPer = (await signInPassword(w.per)).token;
  w.tNobody = (await signInPassword(nobody)).token;
  w.tBoth = (await signInPassword(both)).token;
});

test.afterAll(async () => {
  test.setTimeout(90000);
  await setKeyEnforced(KEY, false);
});

test('DARK: with the key off the tick does nothing and staging writes nothing', async () => {
  const id = await newEvent(w.com, 'dark');
  await finish(w.tCom, w.com.orgId, id);
  const staged = await stage(w.tCom, w.com.orgId, id, snapshot('dark'));
  expect(staged.status).toBe(200);
  expect(staged.body).toEqual({ staged: false, reason: 'dark' });
  expect(runTick('1970-01-01T00:00:00Z')).toEqual({ dark: true });
  expect(ledgerRow(id), 'a dark pipeline makes no ledger row').toBeNull();
  expect(resultCount(id)).toBe(0);
});

test('LIVE: the key is switched on through the audited admin switch', async () => {
  await setKeyEnforced(KEY, true);
  expect(runTick(null)).toMatchObject({ dark: false });
  w.before = (await callAdminRpc('admin_archive_status', {}))[0];
});

test('the tick publishes the staged podium exactly once, whitelisted, and not before it is due', async () => {
  const id = await newEvent(w.com, 'once');
  // staged BEFORE the event ends: the row exists with no due time
  const staged = await stage(w.tCom, w.com.orgId, id, snapshot('once'));
  expect(staged.body).toEqual({ staged: true, reason: null });
  const before = ledgerRow(id);
  expect(before).toMatchObject({ state: 'pending', due_at: null });
  // whitelisted at STAGE time: nothing the archive may not carry is even stored
  const stored = JSON.stringify(before.staged_payload);
  for (const forbidden of [
    'standings',
    'notListed',
    'secretExtra',
    PHONE,
    EMAIL,
    'Fourth',
    'Hidden',
  ]) {
    expect(stored, `staged payload must not carry ${forbidden}`).not.toContain(forbidden);
  }
  expect(before.staged_payload.podium).toHaveLength(3);

  await finish(w.tCom, w.com.orgId, id);
  runTick(null); // the tick learns the due time of a row an organiser RPC made early
  const learned = ledgerRow(id);
  expect(learned.state).toBe('pending');
  const ended = await rest(`events?id=eq.${id}&select=ended_at`, { token: w.tCom });
  expect(
    Math.abs(
      new Date(learned.due_at).getTime() - new Date(ended.body[0].ended_at).getTime() - 24 * 3600e3,
    ),
    'due exactly 24 hours after the end',
  ).toBeLessThan(1000);
  expect(resultCount(id), 'nothing is published before the 24 hours').toBe(0);

  makeDue(id);
  runTick(null);
  const row = await publicRow(id);
  expect(row, 'the due tick publishes').not.toBeNull();
  expect(row.org_id).toBe(w.com.orgId);
  expect(row.payload.podium.map((p) => p.name)).toEqual([
    `Champion once ${tag}`,
    `Second once ${tag}`,
    `Third once ${tag}`,
  ]);
  expect(row.payload.listing).toBeUndefined();
  const published = JSON.stringify(row.payload);
  for (const forbidden of [
    'standings',
    'notListed',
    'secretExtra',
    PHONE,
    EMAIL,
    'Fourth',
    'Hidden',
  ]) {
    expect(published, `public payload must not carry ${forbidden}`).not.toContain(forbidden);
  }
  const done = ledgerRow(id);
  expect(done).toMatchObject({
    state: 'published',
    outcome_via: 'auto',
    last_error: null,
    staged_payload: null,
  });

  // a second tick, and a third with a floor, change nothing: same row, same time, same ledger
  runTick(null);
  runTick(new Date(dbNow().getTime() - 60e3).toISOString());
  const again = await publicRow(id);
  expect(again).toEqual(row);
  expect(ledgerRow(id)).toEqual(done);
  expect(resultCount(id)).toBe(1);
  // and the organiser's browser cannot re-open it
  const late = await stage(w.tCom, w.com.orgId, id, snapshot('once'));
  expect(late.body).toEqual({ staged: false, reason: 'closed' });
});

test('the floor: an event that ended before it gets no row, one after it does and is stubbed when nothing was staged', async () => {
  const id = await newEvent(w.com, 'nosnap');
  await finish(w.tCom, w.com.orgId, id);
  const future = new Date(dbNow().getTime() + 60e3).toISOString();
  runTick(future);
  runTick(null);
  expect(ledgerRow(id), 'ended before the floor, or no floor: no row').toBeNull();

  runTick(new Date(dbNow().getTime() - 60e3).toISOString());
  expect(ledgerRow(id)).toMatchObject({ state: 'pending' });
  expect(resultCount(id)).toBe(0);
  makeDue(id);
  runTick(null);

  expect(ledgerRow(id)).toMatchObject({
    state: 'stubbed',
    outcome_via: 'auto',
    last_error: 'no_snapshot',
  });
  const row = await publicRow(id);
  expect(row.payload).toMatchObject({
    format: 'cup_taster',
    eventName: `nosnap ${tag}`,
    listing: 'named_only',
  });
  expect(row.payload.podium, 'a stub carries no podium').toBeUndefined();
});

test('a snapshot older than a score change is never published: a stub says why', async () => {
  const id = await newEvent(w.com, 'stale');
  expect((await stage(w.tCom, w.com.orgId, id, snapshot('stale'))).body.staged).toBe(true);
  // a real logged change AFTER staging, over HTTP: the member flips is_test and back (the events trigger logs it)
  for (const value of [true, false]) {
    const r = await rest(`events?id=eq.${id}`, {
      method: 'PATCH',
      token: w.tCom,
      body: { is_test: value },
    });
    expect(r.status).toBe(204);
  }
  await finish(w.tCom, w.com.orgId, id);
  makeDue(id);
  runTick(null);
  expect(ledgerRow(id)).toMatchObject({
    state: 'stubbed',
    last_error: 'stale_snapshot',
    staged_payload: null,
  });
  const row = await publicRow(id);
  expect(row.payload.podium).toBeUndefined();
  expect(JSON.stringify(row.payload)).not.toContain('Champion');
});

test('a test event is never published, whether it became one before or after staging', async () => {
  // became a test event AFTER staging and ending: the tick re-reads is_test at the moment of publish
  const late = await newEvent(w.com, 'testlate');
  expect((await stage(w.tCom, w.com.orgId, late, snapshot('testlate'))).body.staged).toBe(true);
  await finish(w.tCom, w.com.orgId, late);
  const flip = await rest(`events?id=eq.${late}`, {
    method: 'PATCH',
    token: w.tCom,
    body: { is_test: true },
  });
  expect(flip.status).toBe(204);
  makeDue(late);
  runTick(null);
  expect(ledgerRow(late)).toMatchObject({
    state: 'skipped',
    last_error: 'is_test',
    staged_payload: null,
  });
  expect(resultCount(late)).toBe(0);

  // a test event from the start: staging, choosing and the floor all refuse it
  const early = await newEvent(w.ann, 'testearly');
  const mark = await rest(`events?id=eq.${early}`, {
    method: 'PATCH',
    token: w.tAnn,
    body: { is_test: true },
  });
  expect(mark.status).toBe(204);
  const staged = await stage(w.tAnn, w.ann.orgId, early, snapshot('testearly'));
  expect(staged.body).toEqual({ staged: false, reason: 'test_event' });
  const choice = await rpc(
    'set_archive_listing',
    { p_org_id: w.ann.orgId, p_event_id: early, p_list: true },
    { token: w.tAnn },
  );
  expect(choice.status).toBe(400);
  expect(choice.body).toMatchObject({ code: 'P0001', hint: 'archive_event_is_test' });
  await finish(w.tAnn, w.ann.orgId, early);
  runTick(new Date(dbNow().getTime() - 60e3).toISOString());
  expect(ledgerRow(early), 'the floor never enqueues a test event').toBeNull();
  expect(resultCount(early)).toBe(0);
});

test("an organiser's own publish is never overwritten by the tick, early or late", async () => {
  const own = (label) => ({
    format: 'cup_taster',
    eventName: `Own ${label} ${tag}`,
    podium: [{ rank: 1, name: `Own champion ${label} ${tag}` }],
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const [when, label] of [
    ['organiser_early', 'first'],
    ['organiser_late', 'firstlate'],
  ]) {
    const id = await newEvent(w.com, label);
    expect((await stage(w.tCom, w.com.orgId, id, snapshot(label))).body.staged).toBe(true);
    await finish(w.tCom, w.com.orgId, id);
    const publish = () =>
      rpc(
        'publish_event_results',
        { p_org_id: w.com.orgId, p_event_id: id, p_payload: own(label) },
        { token: w.tCom },
      );
    if (when === 'organiser_early') {
      expect([200, 204]).toContain((await publish()).status);
      await sleep(1500); // the due time is set one second back, so it falls after the organiser's publish
      makeDue(id);
    } else {
      makeDue(id);
      await sleep(1500);
      expect([200, 204]).toContain((await publish()).status);
    }
    const theirs = await publicRow(id);
    runTick(null);
    expect(await publicRow(id), 'the tick never overwrites an organiser publish').toEqual(theirs);
    expect(theirs.payload.podium[0].name).toBe(`Own champion ${label} ${tag}`);
    expect(ledgerRow(id)).toMatchObject({
      state: 'skipped',
      outcome_via: when,
      staged_payload: null,
    });
  }
});

test('the paid tiers choose: unlisted is still named, with no podium; listed publishes it; the choice closes', async () => {
  // listed
  const listed = await newEvent(w.ann, 'listed');
  expect((await stage(w.tAnn, w.ann.orgId, listed, snapshot('listed'))).body.staged).toBe(true);
  const yes = await rpc(
    'set_archive_listing',
    { p_org_id: w.ann.orgId, p_event_id: listed, p_list: true },
    { token: w.tAnn },
  );
  expect(yes.status).toBe(200);
  expect(yes.body).toMatchObject({ listing: 'list', recorded: true });

  // no choice made: the default is named only (decision 10), even though a podium was staged
  const dflt = await newEvent(w.ann, 'default');
  expect((await stage(w.tAnn, w.ann.orgId, dflt, snapshot('default'))).body.staged).toBe(true);

  // changed their mind: list, then named only
  const unlisted = await newEvent(w.ann, 'unlisted');
  expect((await stage(w.tAnn, w.ann.orgId, unlisted, snapshot('unlisted'))).body.staged).toBe(true);
  await rpc(
    'set_archive_listing',
    { p_org_id: w.ann.orgId, p_event_id: unlisted, p_list: true },
    { token: w.tAnn },
  );
  const no = await rpc(
    'set_archive_listing',
    { p_org_id: w.ann.orgId, p_event_id: unlisted, p_list: false },
    { token: w.tAnn },
  );
  expect(no.body).toMatchObject({ listing: 'named_only', recorded: true });
  expect(ledgerRow(unlisted).listing_choice).toBe('named_only');

  for (const id of [listed, dflt, unlisted]) {
    await finish(w.tAnn, w.ann.orgId, id);
    makeDue(id);
  }
  runTick(null);

  const podium = await publicRow(listed);
  expect(podium.payload.podium).toHaveLength(3);
  expect(ledgerRow(listed)).toMatchObject({ state: 'published', outcome_via: 'auto' });
  for (const id of [dflt, unlisted]) {
    const row = await publicRow(id);
    expect(row, 'an unlisted event is still named in the archive').not.toBeNull();
    expect(row.payload.listing).toBe('named_only');
    expect(row.payload.podium).toBeUndefined();
    expect(JSON.stringify(row.payload)).not.toMatch(/Champion|Second|Third/);
    expect(ledgerRow(id)).toMatchObject({
      state: 'stubbed',
      outcome_via: 'auto',
      last_error: null,
    });
  }

  // once decided, the choice cannot change what the tick did
  const closed = await rpc(
    'set_archive_listing',
    { p_org_id: w.ann.orgId, p_event_id: listed, p_list: false },
    { token: w.tAnn },
  );
  expect(closed.status).toBe(400);
  expect(closed.body).toMatchObject({ code: 'P0001', hint: 'archive_listing_closed' });
});

test('Per-event: an event with its own grant may choose to be listed', async () => {
  const id = await newEvent(w.per, 'perevent');
  // the grant window is five Brunei calendar days around the event date, so the event is dated today
  const date = await rest(`events?id=eq.${id}`, {
    method: 'PATCH',
    token: w.tPer,
    body: { event_date: today },
  });
  expect(date.status).toBe(204);
  // before the grant: Community's listing is compulsory, there is nothing to choose
  const refused = await rpc(
    'set_archive_listing',
    { p_org_id: w.per.orgId, p_event_id: id, p_list: true },
    { token: w.tPer },
  );
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ code: '42501', hint: 'entitlement_required', details: KEY });
  await grantEventPlan(w.per.orgId, id, 0);
  const yes = await rpc(
    'set_archive_listing',
    { p_org_id: w.per.orgId, p_event_id: id, p_list: true },
    { token: w.tPer },
  );
  expect(yes.body).toMatchObject({ listing: 'list', recorded: true });
  expect((await stage(w.tPer, w.per.orgId, id, snapshot('perevent'))).body.staged).toBe(true);
  await finish(w.tPer, w.per.orgId, id);
  makeDue(id);
  runTick(null);
  expect((await publicRow(id)).payload.podium).toHaveLength(3);
  expect(ledgerRow(id)).toMatchObject({ state: 'published', outcome_via: 'auto' });

  // the OPTIONAL path is really taken for a Per-event grant: a second event with its own grant and no choice is named only
  // (were the grant not seen at the due time, the organisation would count as compulsory and the podium would be published)
  const quiet = await newEvent(w.per, 'perevent2');
  const dated = await rest(`events?id=eq.${quiet}`, {
    method: 'PATCH',
    token: w.tPer,
    body: { event_date: today },
  });
  expect(dated.status).toBe(204);
  await grantEventPlan(w.per.orgId, quiet, 0);
  expect((await stage(w.tPer, w.per.orgId, quiet, snapshot('perevent2'))).body.staged).toBe(true);
  await finish(w.tPer, w.per.orgId, quiet);
  makeDue(quiet);
  runTick(null);
  expect(ledgerRow(quiet)).toMatchObject({
    state: 'stubbed',
    last_error: null,
    outcome_via: 'auto',
  });
  const quietRow = await publicRow(quiet);
  expect(quietRow.payload.listing).toBe('named_only');
  expect(quietRow.payload.podium).toBeUndefined();
});

test('Community unpublish is soft: recorded, and the tick does not put it back', async () => {
  // the tick-published podium from the "exactly once" test, taken down by its organiser through the RPC
  const published = mine.once;
  expect(await publicRow(published)).not.toBeNull();
  const down = await rpc(
    'unpublish_event_results',
    { p_org_id: w.com.orgId, p_event_id: published },
    { token: w.tCom },
  );
  expect([200, 204]).toContain(down.status);
  expect(await publicRow(published)).toBeNull();
  expect(ledgerRow(published)).toMatchObject({
    state: 'removed',
    removed_from: 'published',
    outcome_via: 'auto',
  });

  // a stub taken down by a plain DELETE on the table (the other way a result goes away) ends the same way
  const stubbed = mine.nosnap;
  const del = await rest(`public_results?event_id=eq.${stubbed}`, {
    method: 'DELETE',
    token: w.tCom,
  });
  expect(del.status).toBe(204);
  expect(ledgerRow(stubbed)).toMatchObject({ state: 'removed', removed_from: 'stubbed' });

  // ticks, with and without a floor, never republish either
  runTick(null);
  runTick(new Date(dbNow().getTime() - 3600e3).toISOString());
  for (const id of [published, stubbed]) {
    expect(resultCount(id), 'a result an organiser took down stays down').toBe(0);
    expect(ledgerRow(id).state).toBe('removed');
  }
});

// ============ the negatives ============

test('NEGATIVE: every way of being refused at the staging door and the tick-box door is one answer', async () => {
  const target = await newEvent(w.com, 'target'); // an event of com
  const foreign = await newEvent(w.other, 'foreign'); // an event of other
  const payload = snapshot('negative');
  const missing = crypto.randomUUID();
  const attempts = [
    ['a stranger (other) names com and the com event', w.tOther, w.com.orgId, target],
    ['a person who belongs to nobody', w.tNobody, w.com.orgId, target],
    ["a com member names com and the OTHER organisation's event", w.tCom, w.com.orgId, foreign],
    ['a com member names the other organisation and its event', w.tCom, w.other.orgId, foreign],
    ['a com member names the other organisation and the com event', w.tCom, w.other.orgId, target],
    ['a com member names com and a missing event', w.tCom, w.com.orgId, missing],
    ['a com member names com and a NULL event', w.tCom, w.com.orgId, null],
    ['a com member names a NULL organisation', w.tCom, null, target],
    ['a com member names a missing organisation', w.tCom, missing, target],
    [
      "a two-organisation user names com and the other organisation's event",
      w.tBoth,
      w.com.orgId,
      foreign,
    ],
    [
      'a two-organisation user names the other organisation and the com event',
      w.tBoth,
      w.other.orgId,
      target,
    ],
  ];
  const ledgerBefore = [ledgerRow(target), ledgerRow(foreign)];
  const stageSeen = [];
  const listSeen = [];
  for (const [who, token, org, event] of attempts) {
    const a = await rpc(
      'stage_archive_payload',
      { p_operation_id: crypto.randomUUID(), p_org_id: org, p_event_id: event, p_payload: payload },
      { token },
    );
    const b = await rpc(
      'set_archive_listing',
      { p_org_id: org, p_event_id: event, p_list: true },
      { token },
    );
    stageSeen.push({ who, answer: answer(a) });
    listSeen.push({ who, answer: answer(b) });
  }
  console.log(
    'REFUSALS\n' +
      stageSeen.map((s, i) => `${s.answer} | ${listSeen[i].answer} <- ${s.who}`).join('\n'),
  );
  expect(new Set(stageSeen.map((s) => s.answer)).size, 'stage: one answer for every refusal').toBe(
    1,
  );
  expect(stageSeen[0].answer).toBe('403|42501|stage_archive_payload: event not found');
  expect(
    new Set(listSeen.map((s) => s.answer)).size,
    'set_archive_listing: one answer for every refusal',
  ).toBe(1);
  expect(listSeen[0].answer).toBe('403|42501|set_archive_listing: event not found');
  // and not one of them wrote a ledger row or changed one
  expect([ledgerRow(target), ledgerRow(foreign)]).toEqual(ledgerBefore);
  expect(ledgerRow(missing)).toBeNull();
});

test('NEGATIVE: the anonymous caller is stopped at the door of every archive function', async () => {
  const id = mine.target;
  const calls = [
    [
      'stage_archive_payload',
      {
        p_operation_id: crypto.randomUUID(),
        p_org_id: w.com.orgId,
        p_event_id: id,
        p_payload: snapshot('anon'),
      },
    ],
    ['set_archive_listing', { p_org_id: w.com.orgId, p_event_id: id, p_list: true }],
    ['admin_archive_status', {}],
  ];
  for (const [name, args] of calls) {
    for (const token of [undefined, null]) {
      // undefined = the anon key as the bearer; null = no Authorization header at all
      const r = await rpc(name, args, { token });
      expect(r.status, `${name} (${token === null ? 'no header' : 'anon key'})`).toBe(401);
      expect(r.body.message).toMatch(new RegExp(`permission denied for function ${name}`));
    }
  }
  expect(ledgerRow(id)).toBeNull();
});

test("NEGATIVE: the stage door gives no row-id existence oracle (another organisation's operation id)", async () => {
  const id = await newEvent(w.other, 'oracle');
  const opId = crypto.randomUUID();
  const first = await stage(w.tOther, w.other.orgId, id, snapshot('oracle'), opId);
  expect(first.body).toEqual({ staged: true, reason: null });
  // a replay by the owner of the operation and an attempt by ANOTHER organisation using the same id (on its own event)
  const replay = await stage(w.tOther, w.other.orgId, id, snapshot('oracle'), opId);
  const own = mine.target;
  const foreignUse = await stage(w.tCom, w.com.orgId, own, snapshot('oracle'), opId);
  const unusedId = await stage(w.tCom, w.com.orgId, own, snapshot('oracle'), crypto.randomUUID());
  expect(replay.body).toEqual({ staged: false, reason: 'duplicate' });
  expect(foreignUse.status, 'no 409 and no raw unique violation').toBe(200);
  expect(foreignUse.body).toEqual({ staged: false, reason: 'duplicate' });
  // the id alone told com's organiser nothing it could not learn from its own replay, and wrote nothing of theirs
  expect(unusedId.body).toEqual({ staged: true, reason: null });
  const ledger = ledgerRow(id);
  expect(ledger.org_id).toBe(w.other.orgId);
  expect(ledger.staged_payload.podium).toHaveLength(3);
});

test('NEGATIVE: the tick and the ledger are not reachable over the API, by any role, by name or by chosen id', async () => {
  const id = mine.target;
  const service = serviceRoleKey();
  const roles = [
    ['anon', undefined],
    ['organiser', w.tCom],
    ['service_role', service],
  ];
  const before = ledgerRow(id);

  for (const [role, token] of roles) {
    // the tick, in the public schema's namespace and in app's (which the API does not expose)
    const plain = await rpc('archive_tick', { p_enqueue_from: null }, { token });
    expect([401, 403, 404], `${role}: archive_tick`).toContain(plain.status);
    expect(plain.body).not.toHaveProperty('dark');
    const inApp = await send('/rest/v1/rpc/archive_tick', {
      method: 'POST',
      token,
      body: { p_enqueue_from: null },
      headers: { 'content-profile': 'app', 'accept-profile': 'app' },
    });
    expect(inApp.status, `${role}: app.archive_tick`).toBe(406);
    expect(inApp.body).toMatchObject({ code: 'PGRST106' });

    // the ledger: read, insert, upsert with a CHOSEN id, patch, delete (default profile and the app profile)
    const profile = { 'content-profile': 'app', 'accept-profile': 'app' };
    const tries = [
      ['select', 'GET', 'archive_events?select=*', undefined, {}],
      ['select (app)', 'GET', 'archive_events?select=*', undefined, profile],
      [
        'insert',
        'POST',
        'archive_events',
        { event_id: crypto.randomUUID(), org_id: w.com.orgId },
        profile,
      ],
      [
        'upsert with a chosen id',
        'POST',
        'archive_events?on_conflict=event_id',
        { event_id: id, org_id: w.com.orgId, state: 'published', outcome_via: 'auto' },
        { ...profile, prefer: 'resolution=merge-duplicates,return=representation' },
      ],
      ['patch by id', 'PATCH', `archive_events?event_id=eq.${id}`, { state: 'failed' }, profile],
      ['delete by id', 'DELETE', `archive_events?event_id=eq.${id}`, undefined, profile],
    ];
    for (const [what, method, path, body, headers] of tries) {
      const r = await send(`/rest/v1/${path}`, { method, token, body, headers });
      expect(
        r.status,
        `${role}: ${what} -> ${r.status} ${JSON.stringify(r.body)}`,
      ).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).not.toContain(id);
    }
  }
  expect(ledgerRow(id), 'no refused call changed the ledger').toEqual(before);

  // the database's own ACL, below the API's schema exposure. anon and authenticated hold USAGE on schema app, so the denial
  // they meet is the function's and the table's own; service_role has no USAGE, so it is checked in the catalogue instead.
  for (const role of ['anon', 'authenticated']) {
    expect(
      () => sqlAsOwner(`begin; set local role ${role}; select app.archive_tick(null); rollback;`),
      `${role}: app.archive_tick`,
    ).toThrow(/permission denied for function archive_tick/);
    expect(
      () =>
        sqlAsOwner(
          `begin; set local role ${role}; select count(*) from app.archive_events; rollback;`,
        ),
      `${role}: app.archive_events`,
    ).toThrow(/permission denied for table archive_events/);
  }
  const apiRoles = ['anon', 'authenticated', 'service_role'];
  const privileges = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
  const checks = apiRoles.flatMap((role) => [
    `has_function_privilege('${role}', 'app.archive_tick(timestamptz)', 'execute')`,
    `has_function_privilege('${role}', 'app.archive_process_one(uuid)', 'execute')`,
    ...privileges.map((p) => `has_table_privilege('${role}', 'app.archive_events', '${p}')`),
  ]);
  // raises (so sqlAsOwner throws) if any API role holds any of these privileges
  sqlAsOwner(
    `do $$ begin if ${checks.join(' or ')} then raise exception 'an API role holds a privilege on the archive ledger or tick'; end if; end $$`,
  );
});

test("NEGATIVE: a stranger cannot publish a result for an organisation's event, and cannot tell whether it exists", async () => {
  const real = mine.target;
  const missing = crypto.randomUUID();
  const seen = [];
  for (const event of [real, missing]) {
    const r = await rest('public_results', {
      method: 'POST',
      token: w.tOther,
      body: { org_id: w.com.orgId, event_id: event, payload: { podium: [{ name: 'Forged' }] } },
    });
    seen.push(answer(r));
  }
  const viaRpc = [];
  for (const event of [real, missing]) {
    const r = await rpc(
      'publish_event_results',
      { p_org_id: w.com.orgId, p_event_id: event, p_payload: { podium: [{ name: 'Forged' }] } },
      { token: w.tOther },
    );
    expect(r.status).toBeGreaterThanOrEqual(400);
    // (this older door echoes the id the caller sent; masked, the answer for a real and a missing event is the same)
    viaRpc.push(answer(r).replaceAll(event, '<event>'));
  }
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0].startsWith('403|42501')).toBe(true);
  expect(viaRpc[0]).toBe(viaRpc[1]);
  expect(resultCount(real)).toBe(0);
});

test('NEGATIVE: a non-member cannot unpublish, delete or rewrite a published result, and anon cannot write at all', async () => {
  const id = mine.listed; // published by the tick for the Annual organisation
  const before = await publicRow(id);
  const ledgerBefore = ledgerRow(id);
  expect(before).not.toBeNull();
  const missing = crypto.randomUUID();
  const outsiders = [
    ['a stranger', w.tOther],
    ['a person who belongs to nobody', w.tNobody],
    ['a two-organisation user (of other organisations)', w.tBoth],
  ];
  for (const [who, token] of outsiders) {
    const seen = [];
    for (const event of [id, missing]) {
      const r = await rpc(
        'unpublish_event_results',
        { p_org_id: w.ann.orgId, p_event_id: event },
        { token },
      );
      expect(r.status, who).toBeGreaterThanOrEqual(400);
      seen.push(answer(r).replaceAll(event, '<event>'));
    }
    expect(seen[0], `${who}: a real and a missing event are refused alike`).toBe(seen[1]);

    // a plain DELETE and PATCH reach zero rows (row-level security): nothing is removed, the ledger is not touched
    const del = await rest(`public_results?event_id=eq.${id}`, {
      method: 'DELETE',
      token,
      headers: { prefer: 'return=representation' },
    });
    expect([200, 204], who).toContain(del.status);
    expect(del.body || [], who).toEqual([]);
    const patch = await rest(`public_results?event_id=eq.${id}`, {
      method: 'PATCH',
      token,
      body: { payload: { podium: [{ name: 'Forged' }] } },
      headers: { prefer: 'return=representation' },
    });
    expect([200, 204], who).toContain(patch.status);
    expect(patch.body || [], who).toEqual([]);
  }
  for (const [who, token] of [
    ['anon key', undefined],
    ['no header', null],
  ]) {
    for (const [method, path, body] of [
      ['POST', 'public_results', { org_id: w.ann.orgId, event_id: id, payload: {} }],
      ['PATCH', `public_results?event_id=eq.${id}`, { payload: { podium: [{ name: 'Forged' }] } }],
      ['DELETE', `public_results?event_id=eq.${id}`, undefined],
    ]) {
      const r = await rest(path, { method, token, body });
      expect([401, 403], `anon (${who}) ${method}`).toContain(r.status);
    }
  }
  expect(await publicRow(id)).toEqual(before);
  expect(ledgerRow(id)).toEqual(ledgerBefore);
});

test('NEGATIVE: the stage door refuses a snapshot that can never be valid and clamps what it keeps', async () => {
  const id = await newEvent(w.ann, 'validation');
  const good = snapshot('validation');
  const cases = [
    ['no operation id', null, good, 'archive_payload_invalid'],
    ['an array', crypto.randomUUID(), [good], 'archive_payload_invalid'],
    ['an empty podium', crypto.randomUUID(), { ...good, podium: [] }, 'archive_payload_invalid'],
    [
      'nine podium rows',
      crypto.randomUUID(),
      { ...good, podium: Array.from({ length: 9 }, (_, i) => ({ name: `Row ${i}` })) },
      'archive_payload_invalid',
    ],
    [
      'a blank champion',
      crypto.randomUUID(),
      { ...good, podium: [{ rank: 1, name: '   ' }] },
      'archive_payload_invalid',
    ],
    [
      'a name that is not text',
      crypto.randomUUID(),
      { ...good, podium: [{ rank: 1, name: 7 }] },
      'archive_payload_invalid',
    ],
    [
      'over 64 KB',
      crypto.randomUUID(),
      { ...good, filler: 'x'.repeat(70000) },
      'archive_payload_too_large',
    ],
  ];
  for (const [what, operation, payload, hint] of cases) {
    const r = await rpc(
      'stage_archive_payload',
      { p_operation_id: operation, p_org_id: w.ann.orgId, p_event_id: id, p_payload: payload },
      { token: w.tAnn },
    );
    expect(r.status, what).toBe(400);
    expect(r.body, what).toMatchObject({ code: 'P0001', hint });
  }
  expect(ledgerRow(id), 'a refused snapshot makes no ledger row').toBeNull();

  // long text is clamped and a whitelisted key of the wrong type is dropped, not stored
  const long = 'L'.repeat(500);
  const kept = await stage(w.tAnn, w.ann.orgId, id, {
    ...good,
    competitors: 'three',
    eventName: long,
    podium: [{ rank: 1, name: long, cafe: long, correct: 1, total: 2 }],
  });
  expect(kept.body).toEqual({ staged: true, reason: null });
  const stored = ledgerRow(id).staged_payload;
  expect(stored.competitors).toBeUndefined();
  expect(stored.eventName).toHaveLength(200);
  expect(stored.podium[0].name).toHaveLength(120);
  expect(stored.podium[0].cafe).toHaveLength(120);

  // an older snapshot cannot replace a newer one
  const newer = await rpc(
    'stage_archive_payload',
    {
      p_operation_id: crypto.randomUUID(),
      p_org_id: w.ann.orgId,
      p_event_id: id,
      p_payload: good,
      p_built_at: new Date().toISOString(),
    },
    { token: w.tAnn },
  );
  expect(newer.body).toEqual({ staged: true, reason: null });
  const older = await rpc(
    'stage_archive_payload',
    {
      p_operation_id: crypto.randomUUID(),
      p_org_id: w.ann.orgId,
      p_event_id: id,
      p_payload: { ...good, eventName: 'OLDER' },
      p_built_at: new Date(Date.now() - 3600e3).toISOString(),
    },
    { token: w.tAnn },
  );
  expect(older.body).toEqual({ staged: false, reason: 'superseded' });
  expect(ledgerRow(id).staged_payload.eventName).toBe(good.eventName);
});

test('NEGATIVE: a Community organisation has no listing choice', async () => {
  const id = await newEvent(w.com, 'nochoice');
  const r = await rpc(
    'set_archive_listing',
    { p_org_id: w.com.orgId, p_event_id: id, p_list: false },
    { token: w.tCom },
  );
  expect(r.status).toBe(403);
  expect(r.body).toMatchObject({ code: '42501', hint: 'entitlement_required', details: KEY });
  expect(ledgerRow(id)).toBeNull();
});

test("NEGATIVE: the operator's counts refuse a non-admin, and a real admin gets counts only", async () => {
  for (const [who, token] of [
    ['organiser', w.tCom],
    ["a person in nobody's organisation", w.tNobody],
    ['a two-organisation user', w.tBoth],
  ]) {
    const r = await rpc('admin_archive_status', {}, { token });
    expect(r.status, who).toBe(403);
    expect(r.body, who).toMatchObject({ code: '42501', hint: 'admin_required' });
  }

  const rows = await callAdminRpc('admin_archive_status', {});
  expect(rows).toHaveLength(1);
  const status = rows[0];
  // D-A4: counts and one flag, nothing that names an event, an organisation or a person
  expect(Object.keys(status).sort()).toEqual(
    [
      'pipeline_live',
      'events_total',
      'events_pending',
      'events_pending_overdue',
      'events_published',
      'events_stubbed',
      'events_skipped',
      'events_failed',
      'events_removed',
      'published_by_pipeline',
      'stubbed_by_pipeline',
      'published_by_organiser',
      'stubbed_no_snapshot',
      'stubbed_invalid_snapshot',
      'stubbed_stale_snapshot',
      'listing_list',
      'listing_named_only',
      'removed_after_pipeline',
      'removed_unpublished',
    ].sort(),
  );
  for (const [key, value] of Object.entries(status)) {
    expect(typeof value, key).toBe(key === 'pipeline_live' ? 'boolean' : 'number');
  }
  expect(status.pipeline_live).toBe(true);
  // exactly what this spec did since the key went on (podiums published by the tick and still published: listed, perevent;
  // organiser-first: 2; removed after the pipeline: 2; stale stub: 1; the 'nosnap' stub was removed, so it no longer counts)
  const delta = (key) => status[key] - w.before[key];
  expect(delta('published_by_pipeline')).toBe(2);
  expect(delta('published_by_organiser')).toBe(2);
  expect(delta('removed_after_pipeline')).toBe(2);
  expect(delta('events_removed')).toBe(2);
  expect(delta('stubbed_stale_snapshot')).toBe(1);
  expect(delta('stubbed_no_snapshot')).toBe(0);
  expect(delta('stubbed_invalid_snapshot')).toBe(0);
  expect(delta('events_failed')).toBe(0);
  expect(delta('listing_list')).toBe(2);
  expect(delta('listing_named_only')).toBe(1);
});
