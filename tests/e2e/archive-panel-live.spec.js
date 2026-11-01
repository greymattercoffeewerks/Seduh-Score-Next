import { test, expect as baseExpect } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';
import { rest, rpc, signInPassword } from './support/api.js';
import { setKeyEnforced } from './support/grants.js';
import { dbNow, forceLedger, ledgerRow, makeDue, resultCount, runTick } from './support/archive.js';

// T-ARC.5 phase 2: the organiser's archive panel (T-ARC.4 + T-ARC.4c) in a REAL browser against the real local stack.
// archive-pipeline-live.spec.js proves the database over HTTP; this proves what an organiser sees and can do, and that
// what they see is the database's answer (the panel reads public.archive_event_status; it remembers nothing per device,
// so every "survives a reload" below is a real reload).
//
// The viewport is 360px (the phone an organiser actually holds) for everything; the last test repeats the key states at
// 1280px. The dark gate is the same as phase 1's: results_archive_optional is switched on through the audited admin switch
// and back off afterwards, the tick is run as the database owner (support/archive.js), the clock is the one thing faked.
//
// Selectors are the merged code's: #archive-panel-<event> with data-archive-state / data-archive-mode, #archive-listing-<event>,
// #archive-publish-now-<event>, #archive-unpublish-<event>, #archive-confirm-unpublish-<event>, #archive-cancel-unpublish-<event>,
// .archive-panel [role=alert], and the public rows .results-archive-row.

const expect = baseExpect.configure({ timeout: 15000 });
const KEY = 'results_archive_optional';
const tag = Date.now().toString(36);

test.use({ viewport: { width: 360, height: 740 } });
test.describe.configure({ mode: 'serial' });

const w = {};
const ev = {};

async function signInAs(page, { email, password }) {
  await page.goto('/app/');
  await page.evaluate(
    async ({ email: e, password: p }) => {
      const mod = await import('/src/core/supabaseClient.js');
      const { error } = await mod.getSupabase().auth.signInWithPassword({ email: e, password: p });
      if (error) throw new Error(`login failed: ${error.message}`);
    },
    { email, password },
  );
  await page.reload();
}

async function openEvents(page, tenant) {
  await signInAs(page, tenant);
  await expect(page.getByRole('heading', { name: `Events in ${tenant.orgName}` })).toBeVisible();
}

const panel = (page, id) => page.locator(`#archive-panel-${id}`);

async function newEvent(tenant, name) {
  const event = await tenant.createEvent({ format: 'cup_taster', name: `${name} ${tag}` });
  ev[name] = event.id;
  return event.id;
}

async function finishViaUi(page, id) {
  await page.locator(`#finish-event-${id}`).click();
  await page.locator(`#confirm-finish-${id}`).click();
  await expect(page.locator(`#finish-event-${id}`)).toHaveCount(0);
}

async function finishViaApi(token, orgId, id) {
  const r = await rpc('finish_event', { p_org_id: orgId, p_event_id: id }, { token });
  expect([200, 204]).toContain(r.status);
}

async function stageSnapshot(token, orgId, id, label) {
  const r = await rpc(
    'stage_archive_payload',
    {
      p_operation_id: crypto.randomUUID(),
      p_org_id: orgId,
      p_event_id: id,
      p_payload: {
        format: 'cup_taster',
        eventName: `${label} ${tag}`,
        podium: [
          { rank: 1, name: `Champion ${label} ${tag}`, cafe: 'Cafe One', correct: 5, total: 6 },
          { rank: 2, name: `Second ${label} ${tag}`, correct: 4, total: 6 },
        ],
      },
    },
    { token },
  );
  expect(r.body, JSON.stringify(r.body)).toEqual({ staged: true, reason: null });
}

async function noHorizontalScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(0);
}

async function atLeast44(locator, what) {
  const box = await locator.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box.height, `${what} is at least 44px tall`).toBeGreaterThanOrEqual(44);
}

const floorNow = () => new Date(dbNow().getTime() - 60e3).toISOString();

test.beforeAll(async () => {
  test.setTimeout(180000);
  await setKeyEnforced(KEY, false);
  w.com = await createTenant({ label: 'apcom', live: false, grant: false });
  w.ann = await createTenant({ label: 'apann', live: false, grant: 'annual' });
  w.other = await createTenant({ label: 'apoth', live: false, grant: false });
  w.tCom = (await signInPassword(w.com)).token;
  w.tAnn = (await signInPassword(w.ann)).token;
  w.tOther = (await signInPassword(w.other)).token;
});

test.afterAll(async () => {
  test.setTimeout(90000);
  await setKeyEnforced(KEY, false);
});

test('INERT while the key is off: no panel, no archive words, nothing asked of the archive doors', async ({
  page,
}) => {
  const id = await newEvent(w.com, 'dark');
  const archiveCalls = [];
  page.on('request', (request) => {
    if (/archive_event_status|set_archive_listing|unpublish_event_results/.test(request.url())) {
      archiveCalls.push(request.url());
    }
  });
  const snapshotAnswered = page.waitForResponse((r) => r.url().includes('my_entitlements'));
  await openEvents(page, w.com);
  await expect(page.getByRole('link', { name: `dark ${tag}` })).toBeVisible();
  await snapshotAnswered; // the plan snapshot has been read, so an absent panel is the answer to it, not a race
  await page.locator(`#finish-event-${id}`).click();
  const copy = page.locator(`#finish-copy-${id}`);
  await expect(copy).toContainText('Finish this event?');
  await expect(copy).not.toContainText(/archive/i);
  await page.locator(`#confirm-finish-${id}`).click();
  await expect(page.getByText('Event finished.', { exact: true })).toBeVisible();
  await expect(page.locator('.archive-panel')).toHaveCount(0);
  await expect(page.locator('[id^="archive-"]')).toHaveCount(0);
  expect(archiveCalls, 'the archive doors are not called while the pipeline is dark').toEqual([]);
  await noHorizontalScroll(page);
});

test('LIVE: the key is switched on through the audited admin switch', async () => {
  await setKeyEnforced(KEY, true);
});

test('Community: Finish says what follows, then the panel shows a scheduled podium with Publish now, no tick box', async ({
  page,
}) => {
  const id = await newEvent(w.com, 'c1');
  await openEvents(page, w.com);
  // a running Community event has no panel: the Finish step says what follows
  await expect(panel(page, id)).toHaveCount(0);
  await page.locator(`#finish-event-${id}`).click();
  await expect(page.locator(`#finish-copy-${id}`)).toContainText(
    'About 24 hours after you finish, the podium is published to the public archive automatically',
  );
  await page.locator(`#confirm-finish-${id}`).click();
  await expect(
    page.getByText(/Event finished\. The podium goes to the public archive at about/),
  ).toBeVisible();

  await page.reload();
  const p = panel(page, id);
  await expect(p).toHaveAttribute('data-archive-state', 'scheduled');
  await expect(p).toHaveAttribute('data-archive-mode', 'compulsory');
  await expect(p).toContainText('The podium will be published to the public archive at about');
  await expect(p).toContainText('(Brunei time)');
  await expect(p.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator(`#archive-unpublish-${id}`)).toHaveCount(0);
  const publishNow = page.locator(`#archive-publish-now-${id}`);
  await expect(publishNow).toHaveAttribute('href', `#/events/${id}/report`);
  await atLeast44(publishNow, 'Publish now');
  await noHorizontalScroll(page);
  expect(resultCount(id), 'nothing is published by finishing').toBe(0);
});

test('"Publish now" leads to the report, publishes once, and a later tick changes nothing', async ({
  page,
}) => {
  const id = ev.c1;
  await openEvents(page, w.com);
  await page.locator(`#archive-publish-now-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${id}/report`));
  await expect(page.getByRole('heading', { name: `Report — c1 ${tag}` })).toBeVisible();
  // NOT proven here: the report's own "Publish to results archive" button. It appears only for a COMPLETE Cup Taster
  // competition (a declared champion), and seeding one over the API is a project of its own. This event has none, so the
  // report says so; the publish itself is made through the same RPC that button calls (publish_event_results).
  await expect(page.getByText('The report is not available yet')).toBeVisible();
  const published = await rpc(
    'publish_event_results',
    {
      p_org_id: w.com.orgId,
      p_event_id: id,
      p_payload: {
        format: 'cup_taster',
        eventName: `c1 ${tag}`,
        podium: [{ rank: 1, name: `Champion c1 ${tag}`, correct: 5, total: 6 }],
      },
    },
    { token: w.tCom },
  );
  expect([200, 204]).toContain(published.status);
  expect(resultCount(id)).toBe(1);

  const before = await rest(`public_results?event_id=eq.${id}&select=id,published_at,payload`);
  runTick(floorNow());
  makeDue(id);
  runTick(null);
  const after = await rest(`public_results?event_id=eq.${id}&select=id,published_at,payload`);
  expect(after.body, 'the tick never overwrites or duplicates an organiser publish').toEqual(
    before.body,
  );
  expect(after.body).toHaveLength(1);
  // and the tick's own record says it stood aside, not that it failed against the existing row
  expect(ledgerRow(id)).toMatchObject({ state: 'skipped', attempts: 0, last_error: null });
  expect(ledgerRow(id).outcome_via).toMatch(/^organiser_(early|late)$/);

  await page.goto('/app/#/events');
  await expect(panel(page, id)).toHaveAttribute('data-archive-state', 'published');
  await expect(panel(page, id)).toContainText('The podium is published on the public archive.');
});

test('Community take-down is two steps, recorded, survives a reload and is not republished by a tick', async ({
  page,
  browser,
}) => {
  const id = ev.c1;
  await openEvents(page, w.com);
  const p = panel(page, id);
  await expect(p).toHaveAttribute('data-archive-state', 'published');
  await atLeast44(page.locator(`#archive-unpublish-${id}`), 'Take down results');

  // step 1 asks; nothing is removed
  await page.locator(`#archive-unpublish-${id}`).click();
  await expect(p).toContainText('Take this result off the public archive?');
  await expect(p).toContainText('it will not be published again automatically');
  await atLeast44(page.locator(`#archive-confirm-unpublish-${id}`), 'Take it down');
  await noHorizontalScroll(page);
  expect(resultCount(id), 'asking removes nothing').toBe(1);

  // cancelling puts it back as it was
  await page.locator(`#archive-cancel-unpublish-${id}`).click();
  await expect(page.locator(`#archive-confirm-unpublish-${id}`)).toHaveCount(0);
  await expect(page.locator(`#archive-unpublish-${id}`)).toBeVisible();
  expect(resultCount(id)).toBe(1);

  // step 2 confirms
  await page.locator(`#archive-unpublish-${id}`).click();
  await page.locator(`#archive-confirm-unpublish-${id}`).click();
  await expect(p).toHaveAttribute('data-archive-state', 'taken_down');
  await expect(p, 'focus lands on the panel after the take-down').toBeFocused();
  await expect(p).toContainText('Taken down. It will not be published again automatically.');
  expect(resultCount(id)).toBe(0);
  expect(ledgerRow(id)).toMatchObject({ state: 'removed', removed_from: expect.any(String) });

  // the database remembers it, not this device: a brand-new browser profile (no storage at all) signs in and sees it
  await page.reload();
  await expect(panel(page, id)).toHaveAttribute('data-archive-state', 'taken_down');
  const otherDevice = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 360, height: 740 },
  });
  const devicePage = await otherDevice.newPage();
  await openEvents(devicePage, w.com);
  await expect(panel(devicePage, id)).toHaveAttribute('data-archive-state', 'taken_down');
  await otherDevice.close();

  // and the tick does not put it back, even when the event is due
  runTick(floorNow());
  makeDue(id);
  runTick(null);
  expect(resultCount(id), 'a taken-down result stays down').toBe(0);
  await page.reload();
  await expect(panel(page, id)).toHaveAttribute('data-archive-state', 'taken_down');
  await expect(page.locator(`#archive-publish-now-${id}`)).toBeVisible();
});

test('Annual: the tick box is unticked by default, the choice survives a reload, and it decides the entry', async ({
  page,
}) => {
  const listed = await newEvent(w.ann, 'a1');
  const unlisted = await newEvent(w.ann, 'a2');
  await openEvents(page, w.ann);

  const box = page.locator(`#archive-listing-${listed}`);
  await expect(panel(page, listed)).toHaveAttribute('data-archive-mode', 'choice');
  await expect(box).not.toBeChecked();
  await expect(page.locator(`#archive-listing-help-${listed}`)).toContainText('Unticked:');
  await expect(page.getByLabel('List the podium in the public archive').first()).toBeVisible();
  await atLeast44(page.locator('.archive-listing .checkbox-field').first(), 'the tick box row');
  await noHorizontalScroll(page);
  expect(ledgerRow(listed), 'looking at the box saves nothing').toBeNull();

  // ticking saves, and a reload still shows it (the take-down test above proves it from a fresh profile)
  await box.check();
  await expect(page.locator(`#archive-listing-help-${listed}`)).toContainText(
    'The podium (first place and the others on it',
  );
  await expect(box, 'focus stays on the tick box after the save').toBeFocused();
  await expect.poll(() => ledgerRow(listed)?.listing_choice).toBe('list');
  await page.reload();
  await expect(box).toBeChecked();
  await expect(page.locator(`#archive-listing-${unlisted}`)).not.toBeChecked();

  // unticking saves too
  await box.uncheck();
  await expect.poll(() => ledgerRow(listed)?.listing_choice).toBe('named_only');
  await page.reload();
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(() => ledgerRow(listed)?.listing_choice).toBe('list');

  // finish both from the screen: the sentence differs for a paid plan, and the panel says what each will do
  await page.reload();
  await page.locator(`#finish-event-${listed}`).click();
  await expect(page.locator(`#finish-copy-${listed}`)).toContainText(
    'The podium is included only if you tick "List the podium" on the event.',
  );
  await page.locator(`#confirm-finish-${listed}`).click();
  await expect(page.locator(`#finish-event-${listed}`)).toHaveCount(0);
  await finishViaUi(page, unlisted);
  await page.reload();
  await expect(panel(page, listed)).toHaveAttribute('data-archive-state', 'scheduled');
  await expect(panel(page, unlisted)).toHaveAttribute('data-archive-state', 'scheduled_named_only');
  await expect(panel(page, unlisted)).toContainText(
    'by name, date and place only, with no results',
  );

  // a snapshot is staged for each (over the API: the browser stages it when the report is opened, which needs a complete
  // competition); the tick follows the saved choice, not the snapshot
  await stageSnapshot(w.tAnn, w.ann.orgId, listed, 'a1');
  await stageSnapshot(w.tAnn, w.ann.orgId, unlisted, 'a2');
  makeDue(listed);
  makeDue(unlisted);
  runTick(null);

  await page.reload();
  await expect(panel(page, listed)).toHaveAttribute('data-archive-state', 'published');
  await expect(page.locator(`#archive-listing-${listed}`)).toHaveCount(0); // decided: the box closes
  await expect(panel(page, unlisted)).toHaveAttribute('data-archive-state', 'listed_named_only');
  await expect(panel(page, unlisted)).toContainText(
    'lists this event by name only, with no results',
  );
  await expect(page.locator(`#archive-listing-${unlisted}`)).toHaveCount(0);
  const stored = await rest(`public_results?event_id=eq.${unlisted}&select=payload`);
  expect(stored.body[0].payload.listing).toBe('named_only');
  expect(stored.body[0].payload.podium).toBeUndefined();
});

test("a refused tick-box save shows the database's wording in an alert and puts the box back", async ({
  page,
}) => {
  const id = await newEvent(w.ann, 'a3');
  await openEvents(page, w.ann);
  await page.route('**/rpc/set_archive_listing', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'P0001',
        message: "set_archive_listing: this event's archive entry is already decided",
        hint: 'archive_listing_closed',
      }),
    }),
  );
  const box = page.locator(`#archive-listing-${id}`);
  await box.click(); // not check(): the refusal puts the box back, which check() would wait on
  const alert = panel(page, id).locator('[role="alert"]');
  await expect(alert).toContainText('has already been decided');
  await expect(box, 'the refused choice is not left ticked').not.toBeChecked();
  expect(ledgerRow(id), 'a refused save wrote nothing').toBeNull();
});

test('the stub path: the organiser is told why, and the public list and sheet render it without breaking', async ({
  page,
  browser,
}) => {
  // a Community event nobody opened the report for: the tick can only publish the name (no_snapshot)
  const id = await newEvent(w.com, 'c2');
  await finishViaApi(w.tCom, w.com.orgId, id);
  runTick(floorNow());
  makeDue(id);
  runTick(null);
  expect(ledgerRow(id)).toMatchObject({ state: 'stubbed', last_error: 'no_snapshot' });

  await openEvents(page, w.com);
  const p = panel(page, id);
  await expect(p).toHaveAttribute('data-archive-state', 'listed_named_only');
  await expect(p).toContainText(
    'The podium was not prepared because the report or standings were not opened',
  );
  await expect(page.locator(`#archive-publish-now-${id}`)).toBeVisible();
  await noHorizontalScroll(page);

  // the public archive: the stub is a row by name with no winner, the podium event shows its champion
  // (in a fresh browser context: a SIGNED-IN person reads public_results as `authenticated`, whose policy shows only their own
  // organisation's rows, so the public page must be read the way the public reads it, with no session)
  const visitor = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 360, height: 740 },
  });
  const publicPage = await visitor.newPage();
  const errors = [];
  publicPage.on('pageerror', (error) => errors.push(error.message));
  await publicPage.goto('/results/');
  const stubRow = publicPage.locator('.results-archive-row', { hasText: `c2 ${tag}` });
  await expect(stubRow).toBeVisible();
  await expect(stubRow).toContainText('Results not published');
  await expect(stubRow).not.toContainText('Champion');
  // the newest event with a podium is the page's Latest card (a stub never takes that place), so the champion is on the page
  await expect(publicPage.getByText(`Champion a1 ${tag}`).first()).toBeVisible();
  await noHorizontalScroll(publicPage);

  // the printable sheet of a stub says only the name is listed
  await publicPage.goto(`/results/?sheet=${id}`);
  await expect(
    publicPage.getByText('Only the event name is listed; no results are published.'),
  ).toBeVisible();
  await noHorizontalScroll(publicPage);
  expect(errors, 'no script error on the public pages').toEqual([]);
  await visitor.close();
});

test('retrying and failed show a safe reason only: never the raw error text', async ({ page }) => {
  const id = await newEvent(w.com, 'f1');
  await finishViaApi(w.tCom, w.com.orgId, id);
  await stageSnapshot(w.tCom, w.com.orgId, id, 'f1');
  // a value shaped like text a person could have left in an error, in the column the tick writes SQLSTATEs to
  const SECRET = 'Ahmad_Rahman_0129';
  forceLedger(id, { state: 'pending', attempts: 2, lastError: SECRET });

  // what the database door itself answers
  const status = await rpc(
    'archive_event_status',
    { p_org_id: w.com.orgId, p_event_ids: [id] },
    { token: w.tCom },
  );
  expect(status.status).toBe(200);
  expect(status.body[0]).toMatchObject({
    state: 'pending',
    retrying: true,
    reason: 'processing_error',
  });
  expect(JSON.stringify(status.body)).not.toContain(SECRET);

  await openEvents(page, w.com);
  const p = panel(page, id);
  await expect(p).toHaveAttribute('data-archive-state', 'retrying');
  await expect(p).toContainText('will be tried again shortly');
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.locator('body')).not.toContainText('Ahmad');
  await expect(page.locator(`#archive-publish-now-${id}`)).toBeVisible();

  forceLedger(id, { state: 'failed', attempts: 5, lastError: '22P02' });
  await page.reload();
  await expect(panel(page, id)).toHaveAttribute('data-archive-state', 'failed');
  await expect(panel(page, id)).toContainText(
    'The automatic publish did not work. Nothing is published.',
  );
  await expect(page.locator('body')).not.toContainText('22P02');
  await noHorizontalScroll(page);
});

test('a test event is marked, never offered the archive, and never told it will be published', async ({
  page,
}) => {
  const id = await newEvent(w.ann, 't1');
  const flip = await rest(`events?id=eq.${id}`, {
    method: 'PATCH',
    token: w.tAnn,
    body: { is_test: true },
  });
  expect(flip.status).toBe(204);
  await openEvents(page, w.ann);
  const row = page.locator('.events-list li', { hasText: `t1 ${tag}` });
  await expect(row.locator('.is-test-indicator')).toHaveText('Test data');
  await expect(panel(page, id)).toHaveAttribute('data-archive-state', 'test');
  await expect(panel(page, id)).toContainText('Test data is never published to the archive.');
  await expect(page.locator(`#archive-listing-${id}`)).toHaveCount(0);
  await expect(page.locator(`#archive-publish-now-${id}`)).toHaveCount(0);
  await page.locator(`#finish-event-${id}`).click();
  await expect(page.locator(`#finish-copy-${id}`)).not.toContainText(/archive/i);
  await page.locator(`#confirm-finish-${id}`).click();
  // the success line for a test event is exactly this (an archive sentence would make the text longer, and exact: true fails)
  await expect(page.getByText('Event finished.', { exact: true })).toBeVisible();
  runTick(floorNow());
  makeDue(id);
  runTick(null);
  expect(ledgerRow(id), 'a test event never gets a ledger row').toBeNull();
  expect(resultCount(id)).toBe(0);
});

test("NEGATIVE: another organisation neither sees nor can act on this organisation's panel", async ({
  page,
}) => {
  const target = ev.a1; // published by the tick for the Annual organisation
  const before = await rest(`public_results?event_id=eq.${target}&select=id,published_at,payload`);
  expect(before.body).toHaveLength(1);
  const ledgerBefore = ledgerRow(target);

  await openEvents(page, w.other);
  await expect(page.getByText(`a1 ${tag}`)).toHaveCount(0);
  await expect(panel(page, target)).toHaveCount(0);

  // the same doors the panel uses, called from this person's own signed-in browser
  const answers = await page.evaluate(
    async ({ org, event }) => {
      const { getSupabase } = await import('/src/core/supabaseClient.js');
      const db = getSupabase();
      const pick = (r) => ({ status: r.status, code: r.error?.code, message: r.error?.message });
      return {
        status: pick(await db.rpc('archive_event_status', { p_org_id: org, p_event_ids: [event] })),
        listing: pick(
          await db.rpc('set_archive_listing', { p_org_id: org, p_event_id: event, p_list: false }),
        ),
        takeDown: pick(
          await db.rpc('unpublish_event_results', { p_org_id: org, p_event_id: event }),
        ),
      };
    },
    { org: w.ann.orgId, event: target },
  );
  for (const [what, answer] of Object.entries(answers)) {
    expect(answer.code, what).toBeTruthy();
    expect(answer.status, what).toBeGreaterThanOrEqual(400);
  }
  expect(answers.status.code).toBe('42501');
  expect(answers.listing.code).toBe('42501');

  const after = await rest(`public_results?event_id=eq.${target}&select=id,published_at,payload`);
  expect(after.body).toEqual(before.body);
  expect(ledgerRow(target)).toEqual(ledgerBefore);

  // a person who belongs to nobody gets no panel at all
  const nobody = await createLoneUser('ap-nobody');
  const none = await signInPassword(nobody);
  const refused = await rpc(
    'archive_event_status',
    { p_org_id: w.ann.orgId, p_event_ids: [target] },
    { token: none.token },
  );
  expect(refused.status).toBe(403);
});

test('NEGATIVE: archive_event_status answers one way for every refusal and returns nothing but words', async () => {
  const target = ev.a1;
  const own = ev.a2;
  const ask = (token, org, ids) =>
    rpc('archive_event_status', { p_org_id: org, p_event_ids: ids }, { token });
  const body = (r) => `${r.status}|${JSON.stringify(r.body)}`;

  // positive control: a member gets rows for exactly the events asked, with exactly the eight columns, no names
  const ok = await ask(w.tAnn, w.ann.orgId, [target, own]);
  expect(ok.status).toBe(200);
  expect(ok.body).toHaveLength(2);
  for (const row of ok.body) {
    expect(Object.keys(row).sort()).toEqual(
      [
        'due_at',
        'event_id',
        'listing_choice',
        'published',
        'reason',
        'removed',
        'retrying',
        'state',
      ].sort(),
    );
  }
  expect(JSON.stringify(ok.body)).not.toMatch(/Champion|Second|Cafe|a1 |a2 /);
  expect(ok.body.find((r) => r.event_id === target)).toMatchObject({
    state: 'published',
    published: true,
  });
  const stubbed = await ask(w.tCom, w.com.orgId, [ev.c2]);
  expect(stubbed.body[0]).toMatchObject({ state: 'stubbed', reason: 'no_snapshot' });
  expect(JSON.stringify(stubbed.body)).not.toContain(`c2 ${tag}`);

  // one answer for a foreign event under the caller's OWN organisation, a missing event, and a NULL inside the list
  const both = await createLoneUser('ap-both');
  await addMember(w.ann, both, 'organiser');
  await addMember(w.other, both, 'organiser');
  const tBoth = (await signInPassword(both)).token;
  const refusals = {
    foreignEventOwnOrg: await ask(w.tOther, w.other.orgId, [target]),
    missingEvent: await ask(w.tOther, w.other.orgId, [crypto.randomUUID()]),
    nullInList: await ask(w.tOther, w.other.orgId, [null]),
    mixedWithForeign: await ask(w.tAnn, w.ann.orgId, [own, ev.c1]),
    twoOrgWrongPairing: await ask(tBoth, w.ann.orgId, [ev.c1]),
    twoOrgOtherWayRound: await ask(tBoth, w.other.orgId, [target]),
  };
  for (const [what, r] of Object.entries(refusals)) {
    expect(r.status, what).toBe(403);
    expect(r.body, what).toMatchObject({
      code: '42501',
      message: 'archive_event_status: event not found',
    });
  }
  expect(new Set(Object.values(refusals).map(body)).size, 'one body for every refusal').toBe(1);
  // the right pairings of the same two-organisation user work, and show only the named organisation's events
  const right = await ask(tBoth, w.ann.orgId, [target]);
  expect(right.status).toBe(200);
  expect(right.body).toHaveLength(1);

  // malformed lists and organisations
  const nullList = await ask(w.tAnn, w.ann.orgId, null);
  expect(nullList.body).toMatchObject({ code: '22023', hint: 'archive_status_invalid' });
  const nullOrg = await ask(w.tAnn, null, [target]);
  expect(nullOrg.body).toMatchObject({ code: '42501' });
  const many = await ask(
    w.tAnn,
    w.ann.orgId,
    Array.from({ length: 201 }, () => target),
  );
  expect(many.body).toMatchObject({ code: '22023', hint: 'archive_status_too_many' });
  const exactly200 = await ask(
    w.tAnn,
    w.ann.orgId,
    Array.from({ length: 200 }, () => target),
  );
  expect(exactly200.status).toBe(200);
  expect(exactly200.body, 'a repeated id is one row').toHaveLength(1);

  // nobody, and the anonymous caller
  const nobody = await createLoneUser('ap-nobody2');
  const none = await signInPassword(nobody);
  const lone = await ask(none.token, w.ann.orgId, [target]);
  expect(lone.status).toBe(403);
  expect(lone.body).toMatchObject({ code: '42501' });
  expect(JSON.stringify(lone.body)).not.toContain(target);
  for (const token of [undefined, null]) {
    const anon = await ask(token, w.ann.orgId, [target]);
    expect(anon.status).toBe(401);
    expect(anon.body.message).toMatch(/permission denied for function archive_event_status/);
  }
});

test('at 1280px the same panels hold: states, no overflow, controls still reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEvents(page, w.ann);
  await expect(panel(page, ev.a1)).toHaveAttribute('data-archive-state', 'published');
  await expect(panel(page, ev.a2)).toHaveAttribute('data-archive-state', 'listed_named_only');
  await noHorizontalScroll(page);
  await atLeast44(page.locator(`#archive-publish-now-${ev.a2}`), 'Publish now at 1280px');

  await openEvents(page, w.com);
  await expect(panel(page, ev.c1)).toHaveAttribute('data-archive-state', 'taken_down');
  await page.locator(`#archive-publish-now-${ev.c1}`).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${ev.c1}/report`));
});
