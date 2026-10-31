import { test, expect as baseExpect } from '@playwright/test';
import { createTenant } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rest, signInPassword } from './support/api.js';

// T-ID.C2 (part 2): the People screen (#/people, T-ID.C1) and the Linked label, in a real browser against the real
// app and the real local Supabase stack. affiliations-live.spec.js proves what the database refuses over HTTP; this
// proves that the screen an organiser actually uses does the right thing with it:
//   - an organiser marks a person as staff, sees the tag, ends the role, and the history stays in the table;
//   - the name filter narrows the list and says so when nothing matches;
//   - a member of ANOTHER organisation never sees those people, nor receives them over the wire;
//   - a person whose phone is changed in the Roster loses the "Linked to a Seduh ID" label (the database clears the
//     link and the new number has no identity), while a change of name alone keeps it;
//   - the identity uuid itself is never rendered, on either screen.
//
// An identity can only be made as the database owner (no API door creates one), so it is inserted the way
// identity-link-live.spec.js does it, BEFORE the person is registered through the Roster form, which asks for the link
// after registering.

const expect = baseExpect.configure({ timeout: 15000 });

const LINKED = 'Linked to a Seduh ID';
const uniq = Date.now().toString(36);
// A Brunei mobile number the Roster form accepts (it validates the shape, unlike the table, which takes any E.164).
// Random per call: a persistent local stack keeps earlier runs' identities, and an identity is keyed by its phone.
const phone = () => `+6738${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

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

async function openPeople(page, orgName) {
  await page.getByRole('link', { name: 'Open People' }).click();
  await expect(page.getByRole('heading', { name: `People in ${orgName}` })).toBeVisible();
}

// Everything a person can read or copy from the page: the text, and every attribute of the rendered markup.
async function pageSurface(page) {
  return page.evaluate(() => `${document.body.innerText}\n${document.documentElement.outerHTML}`);
}

test.describe('the People screen and the Linked label (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let a; // organisation A: the one whose people are marked
  let b; // organisation B: a stranger to A
  let tokenA;
  let alice;
  let bob;
  let carol;
  let zed;
  let event;

  const names = {
    alice: `Plp Alice ${uniq}`,
    bob: `Plp Bob ${uniq}`,
    carol: `Plp Carol ${uniq}`,
    zed: `Plp Zed ${uniq}`,
  };

  async function addPerson(token, orgId, name) {
    const r = await rest('people?select=id', {
      method: 'POST',
      token,
      body: { org_id: orgId, display_name: name, phone: phone() },
      headers: { prefer: 'return=representation' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body[0].id;
  }

  // every roster row of the person, closed or not, as the owning organisation reads it over the API
  const rolesOf = async (personId) =>
    (
      await rest(
        `org_person_affiliations?person_id=eq.${personId}&select=id,relationship,ended_at&order=created_at`,
        { token: tokenA },
      )
    ).body;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    a = await createTenant({ label: 'plpa', live: false, grant: false });
    b = await createTenant({ label: 'plpb', live: false, grant: false });
    tokenA = (await signInPassword(a)).token;
    const tokenB = (await signInPassword(b)).token;
    alice = await addPerson(tokenA, a.orgId, names.alice);
    bob = await addPerson(tokenA, a.orgId, names.bob);
    carol = await addPerson(tokenA, a.orgId, names.carol);
    zed = await addPerson(tokenB, b.orgId, names.zed);
    event = await a.createEvent({ format: 'cup_taster', name: `Plp roster event ${uniq}` });
  });

  test('an organiser marks a person as staff, filters by name, ends the role, and the history stays', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await signInAs(page, a);
    await openPeople(page, a.orgName);

    const row = (id) => page.locator(`#people-row-${id}`);
    const summary = page.getByText(/^\d+ (people|person), \d+ staff, \d+ affiliates$/);
    await expect(summary).toHaveText('3 people, 0 staff, 0 affiliates');
    // only this organisation's people are listed
    await expect(page.getByText(names.zed)).toHaveCount(0);
    await expect(page.locator('.people-list > li')).toHaveCount(3);
    await expect(page.locator('.people-tag-role')).toHaveCount(0);

    // mark Alice as staff: the tag appears, the count moves, the button turns into its opposite
    await page.getByRole('button', { name: `Mark as staff, ${names.alice}` }).click();
    await expect(row(alice).locator('.people-tag-role')).toHaveText('Staff');
    await expect(summary).toHaveText('3 people, 1 staff, 0 affiliates');
    await expect(page.getByRole('status').filter({ hasText: 'marked as staff' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `End staff role, ${names.alice}` }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: `Mark as staff, ${names.alice}` })).toHaveCount(
      0,
    );
    // the other two are untouched
    await expect(row(bob).locator('.people-tag-role')).toHaveCount(0);
    expect(await rolesOf(alice)).toEqual([
      expect.objectContaining({ relationship: 'staff', ended_at: null }),
    ]);

    // a second role for another person, and a person can hold both roles at once
    await page.getByRole('button', { name: `Mark as affiliate, ${names.bob}` }).click();
    await expect(row(bob).locator('.people-tag-role')).toHaveText('Affiliate');
    await page.getByRole('button', { name: `Mark as affiliate, ${names.alice}` }).click();
    await expect(row(alice).locator('.people-tag-role')).toHaveText(['Affiliate', 'Staff']);
    await expect(summary).toHaveText('3 people, 1 staff, 2 affiliates');

    // the name filter: case-insensitive substring, and a plain sentence when nothing matches
    const filter = page.getByRole('searchbox', { name: 'Find a person by name' });
    await filter.fill(`ALICE ${uniq}`);
    await expect(page.locator('.people-list > li')).toHaveCount(1);
    await expect(row(alice)).toBeVisible();
    await expect(page.getByText(names.bob)).toHaveCount(0);
    await filter.fill('nobody by this name');
    await expect(page.getByText('No one matches that name.')).toBeVisible();
    await expect(page.locator('.people-list')).toHaveCount(0);
    // the filter survives an action: mark Carol from a filtered list, then clear it
    await filter.fill(`carol ${uniq}`);
    await page.getByRole('button', { name: `Mark as staff, ${names.carol}` }).click();
    await expect(row(carol).locator('.people-tag-role')).toHaveText('Staff');
    await expect(filter).toHaveValue(`carol ${uniq}`);
    await expect(page.locator('.people-list > li')).toHaveCount(1);
    await filter.fill('');
    await expect(page.locator('.people-list > li')).toHaveCount(3);

    // end Alice's staff role: the tag goes, her affiliate role stays, and the row is CLOSED, not deleted
    await page.getByRole('button', { name: `End staff role, ${names.alice}` }).click();
    await expect(row(alice).locator('.people-tag-role')).toHaveText(['Affiliate']);
    await expect(summary).toHaveText('3 people, 1 staff, 2 affiliates'); // Carol is staff now
    await expect(page.getByRole('status').filter({ hasText: 'no longer staff' })).toBeVisible();
    const aliceRoles = await rolesOf(alice);
    expect(aliceRoles).toHaveLength(2);
    const staff = aliceRoles.find((r) => r.relationship === 'staff');
    expect(staff.ended_at).not.toBeNull();
    expect(aliceRoles.find((r) => r.relationship === 'affiliate').ended_at).toBeNull();

    // the roster is stored, not remembered by the page: a reload shows the same
    await page.reload();
    await expect(page.getByRole('heading', { name: `People in ${a.orgName}` })).toBeVisible();
    await expect(row(alice).locator('.people-tag-role')).toHaveText(['Affiliate']);
    await expect(row(bob).locator('.people-tag-role')).toHaveText('Affiliate');
    await expect(row(carol).locator('.people-tag-role')).toHaveText('Staff');

    // marking Alice as staff AGAIN after it ended opens a new row; the closed one is still there
    await page.getByRole('button', { name: `Mark as staff, ${names.alice}` }).click();
    await expect(row(alice).locator('.people-tag-role')).toHaveText(['Affiliate', 'Staff']);
    const afterRe = await rolesOf(alice);
    expect(
      afterRe.filter((r) => r.relationship === 'staff').map((r) => r.ended_at === null),
    ).toEqual([false, true]);
  });

  test('a member of another organisation never sees those people, on the page or over the wire', async ({
    page,
  }) => {
    test.setTimeout(60000);
    const seenBodies = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (!/\/rest\/v1\/(people|org_person_affiliations)/.test(url)) return;
      seenBodies.push({ url, body: await response.text().catch(() => '') });
    });
    await signInAs(page, b);
    await openPeople(page, b.orgName);

    await expect(page.locator('.people-list > li')).toHaveCount(1);
    await expect(page.getByText(names.zed)).toBeVisible();
    await expect(page.locator('.people-tag-role')).toHaveCount(0);
    await expect(page.getByText('1 person, 0 staff, 0 affiliates')).toBeVisible();
    for (const name of [names.alice, names.bob, names.carol]) {
      await expect(page.getByText(name)).toHaveCount(0);
    }
    // nothing about A's people was even sent to this browser
    expect(seenBodies.length).toBeGreaterThan(0);
    const everything = seenBodies.map((s) => s.body).join('\n');
    for (const id of [alice, bob, carol]) expect(everything).not.toContain(id);
    for (const name of [names.alice, names.bob, names.carol])
      expect(everything).not.toContain(name);
    expect(everything).not.toContain(a.orgId);
    // and the screen did not run into an error while being refused anything
    await expect(page.getByText(/went wrong|could not/i)).toHaveCount(0);
    expect(zed).toBeTruthy();
  });

  test('a person whose phone is changed in the Roster loses the Linked label; a change of name alone keeps it; the identity id is never shown', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const linkedName = `Plp Linky ${uniq}`;
    const renamed = `Plp Linky Renamed ${uniq}`;
    const phoneOld = phone();
    const phoneNew = phone();
    const identity = '00000000-0000-4000-8002-' + String(Date.now()).slice(-12).padStart(12, '0');
    sqlAsOwner(
      `insert into app.seduh_identities (id, phone_e164, display_name, source) values ('${identity}', '${phoneOld}', 'plp ${uniq}', 'archive')`,
    );

    await signInAs(page, a);
    await page.goto(`/app/#/events/${event.id}/roster`);
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

    // register through the real form; the link is asked for after the registration, so reload until it shows
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(linkedName);
    await page.getByRole('textbox', { name: 'Phone', exact: true }).fill(phoneOld);
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    const rosterRow = () => page.locator('.roster-list li', { hasText: /Plp Linky/ });
    await expect(rosterRow()).toHaveCount(1);
    await expect(async () => {
      await page.reload();
      await expect(rosterRow().locator('.roster-linked-tag')).toHaveText(LINKED, { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // the People screen agrees, and says it in words, never with the id
    await page.goto('/app/#/people');
    await expect(page.getByRole('heading', { name: `People in ${a.orgName}` })).toBeVisible();
    const peopleRow = () => page.locator('.people-list > li', { hasText: /Plp Linky/ });
    await expect(peopleRow().locator('.people-tag-linked')).toHaveText(LINKED);
    expect(await pageSurface(page)).not.toContain(identity);
    // the other people were never linked: exactly one Linked tag on the screen
    await expect(page.locator('.people-tag-linked')).toHaveCount(1);

    // rename only: the number did not change, so the link stays
    await page.goto(`/app/#/events/${event.id}/roster`);
    await page.getByRole('button', { name: `Edit ${linkedName}` }).click();
    const nameBox = page.getByRole('textbox', { name: `Name for ${linkedName}` });
    await nameBox.fill(renamed);
    await page.getByRole('button', { name: `Save changes to ${linkedName}` }).click();
    await expect(page.locator('.roster-list li', { hasText: renamed })).toHaveCount(1);
    await page.reload();
    await expect(
      page.locator('.roster-list li', { hasText: renamed }).locator('.roster-linked-tag'),
    ).toHaveText(LINKED);
    expect(await pageSurface(page)).not.toContain(identity);

    // change the phone to a number no identity has: the label goes, on the Roster and on the People screen
    await page.getByRole('button', { name: `Edit ${renamed}` }).click();
    await page.getByRole('textbox', { name: `Phone for ${renamed}` }).fill(phoneNew);
    await page.getByRole('button', { name: `Save changes to ${renamed}` }).click();
    await expect(page.locator('.roster-list li', { hasText: renamed })).toContainText(phoneNew);
    await expect(async () => {
      await page.reload();
      await expect(page.locator('.roster-list li', { hasText: renamed })).toHaveCount(1, {
        timeout: 2000,
      });
    }).toPass({ timeout: 20000 });
    await expect(
      page.locator('.roster-list li', { hasText: renamed }).locator('.roster-linked-tag'),
    ).toHaveCount(0);
    expect(await pageSurface(page)).not.toContain(identity);

    await page.goto('/app/#/people');
    await expect(page.getByRole('heading', { name: `People in ${a.orgName}` })).toBeVisible();
    await expect(page.locator('.people-list > li', { hasText: renamed })).toHaveCount(1);
    await expect(page.locator('.people-tag-linked')).toHaveCount(0);
    expect(await pageSurface(page)).not.toContain(identity);

    // and the database agrees: the link is gone, and the old identity is still there for the old number
    const person = await rest(
      `people?display_name=eq.${encodeURIComponent(renamed)}&select=phone,global_person_id`,
      {
        token: tokenA,
      },
    );
    expect(person.body).toEqual([{ phone: phoneNew, global_person_id: null }]);
    sqlAsOwner(
      `do $$ begin if not exists (select 1 from app.seduh_identities where id = '${identity}') then raise exception 'identity was removed'; end if; end $$`,
    );
  });
});
