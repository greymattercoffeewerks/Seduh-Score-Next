import { test, expect as baseExpect } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';

// T-TEN.E2: the organiser console with REAL organisations, against the real app and a real local Supabase stack.
//
// organiser-flow.spec.js already drives the switcher, the deep-link notice and the refused switch, but it fakes the
// `my_orgs` answer: its second organisation has no rows behind it, so nothing there shows what the database itself
// keeps apart. Here every organisation, person and event is real, created through the same doors production uses
// (support/tenants.js), so row-level security answers:
//   person_b    belongs to organisation B only;
//   person_ab   owns organisation A and is an organiser of B (the case row-level security alone cannot tell apart);
//   person_none belongs to nobody;
//   organisation C is a stranger to both person_ab and person_b.
//
// "The app boots with VITE_DEFAULT_ORG_ID unset" is covered in three places, none of which alone is the whole claim:
// the built-app smoke test (smoke.spec.js: the console mounts from a build made WITHOUT the variable), the unit test
// in src/main.test.js (the console takes its organisation from the person's memberships), and this file: the
// people here work in organisations that are not the build's default one, which they could not if the console still
// depended on it. (The dev server used here does have the variable set, so this file is not a boot test.)

// A real database takes more than 5s to answer a chain of requests on a busy runner.
const expect = baseExpect.configure({ timeout: 10000 });

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

// Same page, new hash: what a person does by following a link inside the app. (Two `page.goto`s to a hash-only
// change race two router instances on one window; organiser-flow.spec.js explains.)
async function navigateHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

test.describe('the organiser console with real organisations (real app, real local Supabase)', () => {
  // Serial: one shared, stateful local stack (Realtime included), as in the other spec files. The tests do not
  // depend on each other's state; serial only keeps the backend load down, at the price that one failure hides the
  // rest of this file.
  test.describe.configure({ mode: 'serial' });

  const uniq = Date.now().toString(36);
  let orgA; // owned by person_ab
  let orgB; // owned by person_b
  let orgC; // a stranger to both
  let personAB;
  let personB;
  let personNone;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    const make = (label, name) =>
      createTenant({
        label,
        format: 'cup_taster',
        eventName: name,
        payload: { stage: null, standings: [], eventName: name },
      });
    orgA = await make('consolea', `Console A event ${uniq}`);
    orgB = await make('consoleb', `Console B event ${uniq}`);
    orgC = await make('consolec', `Console C event ${uniq}`);
    personB = { userId: orgB.userId, email: orgB.email, password: orgB.password };
    personAB = { userId: orgA.userId, email: orgA.email, password: orgA.password };
    // person_ab is the owner of A and, through the provisioning door, an organiser of B
    await addMember(orgB, personAB, 'organiser');
    personNone = await createLoneUser('console');
  });

  test.afterAll(async () => {
    await orgA?.cleanUp();
    await orgB?.cleanUp();
    await orgC?.cleanUp();
  });

  const orgSelect = (page) => page.getByRole('combobox', { name: 'Organisation' });
  const eventLink = (page, name) => page.getByRole('link', { name });
  const listedEvents = (page) => page.locator('.events-list a');

  // Which organisation an event of this name belongs to, as the database itself says.
  const owningOrg = (page, name) =>
    page.evaluate(async (n) => {
      const { getSupabase } = await import('/src/core/supabaseClient.js');
      const { data, error } = await getSupabase().from('events').select('org_id').eq('name', n);
      return {
        rows: data?.length ?? 0,
        org: data?.[0]?.org_id ?? null,
        error: error?.message ?? null,
      };
    }, name);

  test('a person in one organisation sees only that organisation: exactly its events, no switcher, and what they create stays in it', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signInAs(page, personB);

    await expect(page.getByRole('heading', { name: `Events in ${orgB.orgName}` })).toBeVisible();
    // exactly one event is listed, and it is theirs: no other organisation's event is there, named or not
    await expect(eventLink(page, `Console B event ${uniq}`)).toBeVisible();
    await expect(listedEvents(page)).toHaveCount(1);
    await expect(page.getByText(`Console A event ${uniq}`)).toHaveCount(0);
    // one organisation: nothing to switch between
    await expect(orgSelect(page)).toHaveCount(0);

    // an event they create lands in their organisation, and in the database
    const created = `Only in B ${uniq}`;
    await page.getByLabel('Event name').fill(created);
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(eventLink(page, created)).toBeVisible();
    await expect(listedEvents(page)).toHaveCount(2);
    expect(await owningOrg(page, created)).toEqual({ rows: 1, org: orgB.orgId, error: null });
  });

  test('a person in both organisations switches between them, creates an event in B, and never sees one organisation’s events in the other’s list', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await signInAs(page, personAB);
    const select = orgSelect(page);
    await expect(select).toBeVisible();
    // both organisations are offered, by name (and no third one)
    await expect(select.locator('option')).toHaveCount(2);
    await expect(select.locator('option', { hasText: orgA.orgName })).toHaveCount(1);
    await expect(select.locator('option', { hasText: orgB.orgName })).toHaveCount(1);

    // work in A
    await select.selectOption(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();
    await expect(eventLink(page, `Console A event ${uniq}`)).toBeVisible();
    await expect(listedEvents(page)).toHaveCount(1);
    await expect(page.getByText(`Console B event ${uniq}`)).toHaveCount(0);

    // switch to B: announced, and B's list is shown, with none of A's events in it
    await select.selectOption(orgB.orgId);
    await expect(page.locator('#app-shell-org-notice')).toHaveText(
      `Now working in ${orgB.orgName}. Showing Events.`,
    );
    await expect(page.getByRole('heading', { name: `Events in ${orgB.orgName}` })).toBeVisible();
    await expect(eventLink(page, `Console B event ${uniq}`)).toBeVisible();
    await expect(page.getByText(`Console A event ${uniq}`)).toHaveCount(0);

    // create an event in B (the form says where it will go)
    await expect(
      page.getByRole('heading', { name: `Create an event in ${orgB.orgName}` }),
    ).toBeVisible();
    const created = `Made in B ${uniq}`;
    await page.getByLabel('Event name').fill(created);
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(eventLink(page, created)).toBeVisible();

    // back in A, the new event is not in the list; in the database it belongs to B
    await select.selectOption(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();
    await expect(eventLink(page, `Console A event ${uniq}`)).toBeVisible();
    await expect(listedEvents(page)).toHaveCount(1);
    await expect(page.getByText(created)).toHaveCount(0);
    expect(await owningOrg(page, created)).toEqual({ rows: 1, org: orgB.orgId, error: null });
  });

  test('a link to an event in the person’s other organisation switches to it, says so, and opens the event, followed in the app and opened cold', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await signInAs(page, personAB);
    const select = orgSelect(page);
    await select.selectOption(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();

    // B's event, followed from inside the app while working in A
    await navigateHash(page, `#/events/${orgB.eventId}`);
    await expect(page.locator('#app-shell-org-notice')).toHaveText(
      `Now working in ${orgB.orgName}, the organisation this event belongs to.`,
    );
    await expect(select).toHaveValue(orgB.orgId);
    await expect(page.getByRole('heading', { name: `Console B event ${uniq}` })).toBeVisible();
    expect(new URL(page.url()).hash).toBe(`#/events/${orgB.eventId}`);

    // The common real case: the same link opened COLD (an emailed link, a new tab) while the console last worked in A.
    await navigateHash(page, '#/events');
    await select.selectOption(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();
    await page.goto('about:blank');
    await page.goto(`/app/#/events/${orgB.eventId}`);
    await expect(page.locator('#app-shell-org-notice')).toHaveText(
      `Now working in ${orgB.orgName}, the organisation this event belongs to.`,
    );
    await expect(orgSelect(page)).toHaveValue(orgB.orgId);
    await expect(page.getByRole('heading', { name: `Console B event ${uniq}` })).toBeVisible();
  });

  test('a person in two organisations opening a third organisation’s event is told "Page not found", is not moved, and sees nothing of it', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signInAs(page, personAB);
    const select = orgSelect(page);
    await select.selectOption(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();

    // C's event is real, but C is not one of their organisations: the guard that works out which organisation a link
    // belongs to finds it is none of theirs
    await navigateHash(page, `#/events/${orgC.eventId}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText(`Console C event ${uniq}`)).toHaveCount(0);
    await expect(page.getByText(orgC.orgName)).toHaveCount(0);
    // not moved: still in A, no "Now working in" notice, no panel
    await expect(select).toHaveValue(orgA.orgId);
    await expect(page.locator('#app-shell-org-notice')).toHaveText('');
    await expect(page.locator('.app-shell-org-notice-open')).toHaveCount(0);
  });

  test('a person in one organisation opening another organisation’s event is shown nothing of it and is not moved', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signInAs(page, personB);
    await expect(page.getByRole('heading', { name: `Events in ${orgB.orgName}` })).toBeVisible();

    // A's event is real, but not theirs: the database shows them nothing. Wait for the screen to reach a TERMINAL
    // state (today a retryable error, the day the known gap below is fixed "Page not found"), then check what it shows.
    await navigateHash(page, `#/events/${orgA.eventId}`);
    await expect(
      page
        .getByRole('button', { name: 'Retry' })
        .or(page.getByRole('heading', { name: 'Page not found' })),
    ).toBeVisible();
    await expect(page.getByText(`Console A event ${uniq}`)).toHaveCount(0);
    await expect(page.getByText(orgA.orgName)).toHaveCount(0);
    // (this person has one organisation, so there is nothing to switch to: a notice here would be a leak of its own)
    await expect(page.locator('#app-shell-org-notice')).toHaveText('');
    await expect(page.locator('.app-shell-org-notice-open')).toHaveCount(0);
    // and their own organisation is still theirs
    await navigateHash(page, '#/events');
    await expect(page.getByRole('heading', { name: `Events in ${orgB.orgName}` })).toBeVisible();
  });

  // KNOWN GAP (ROADMAP, T-TEN.E2): the route guard that works out which organisation an event link belongs to only
  // runs for a person in TWO OR MORE organisations (src/main.js: `org.orgs.length < 2`). A person in one organisation
  // who opens another organisation's event link skips it: the event screen tries to load, the database hides the
  // event, and they see the generic "Something went wrong saving that — try again" with a Retry that can never work,
  // instead of "Page not found". Nothing of the other organisation is exposed (the test above), so this is a wrong
  // message, not a leak. test.fail() keeps this honest: it passes while the gap exists and FAILS the day it is fixed,
  // so the marker is removed (and the case becomes an ordinary test) when the guard covers one-organisation people too.
  test('a link to another organisation’s event says "Page not found" to a person in one organisation', async ({
    page,
  }) => {
    test.fail(
      true,
      'known gap: the event-route guard only runs for people in two or more organisations',
    );
    test.setTimeout(60000);
    await signInAs(page, personB);
    await expect(page.getByRole('heading', { name: `Events in ${orgB.orgName}` })).toBeVisible();
    await navigateHash(page, `#/events/${orgA.eventId}`);
    // the screen has settled (so a failure below is about its CONTENT, not about a slow load or a broken sign-in) ...
    await expect(
      page
        .getByRole('button', { name: 'Retry' })
        .or(page.getByRole('heading', { name: 'Page not found' })),
    ).toBeVisible();
    // ... and what it settled on should be "Page not found"
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({
      timeout: 1000,
    });
  });

  test('an unsynced change on this device refuses the switch, says exactly why, stays in the organisation, and the switch works once it has synced', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signInAs(page, personAB);
    const select = orgSelect(page);
    await select.selectOption(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();

    // something this device has not yet sent
    await page.evaluate(async () => {
      const outbox = await import('/src/core/outbox.js');
      await outbox.enqueueOperation('refusal_probe', {});
    });

    await select.focus();
    await select.selectOption(orgB.orgId);
    const panel = page.locator('.app-shell-org-notice-open');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(
      '1 change on this device has not synced yet. Wait for it to sync before switching organisation.',
    );
    // nothing moved: still A, on A's list
    await expect(select).toHaveValue(orgA.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgA.orgName}` })).toBeVisible();
    await expect(page.getByText(`Console B event ${uniq}`)).toHaveCount(0);

    // the refusal is not permanent: once nothing is waiting, the same choice goes through
    await page.evaluate(async () => {
      const db = await import('/src/core/db.js');
      for (const operation of await db.outboxListAll()) await db.outboxRemove(operation.id);
    });
    await page.locator('.app-shell-outlet h1').first().click(); // a tap puts the refusal away
    await select.selectOption(orgB.orgId);
    await expect(page.getByRole('heading', { name: `Events in ${orgB.orgName}` })).toBeVisible();
    await expect(select).toHaveValue(orgB.orgId);
  });

  test('an account that belongs to no organisation is told so, and is offered no organisation and no events', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signInAs(page, personNone);
    await expect(
      page.getByRole('heading', { name: "This account isn't part of an organisation" }),
    ).toBeVisible();
    await expect(orgSelect(page)).toHaveCount(0);
    await expect(page.getByLabel('Event name')).toHaveCount(0);
    await expect(page.getByText(`Console A event ${uniq}`)).toHaveCount(0);
    await expect(page.getByText(`Console B event ${uniq}`)).toHaveCount(0);
    // they can still leave
    await expect(page.getByRole('main').getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
