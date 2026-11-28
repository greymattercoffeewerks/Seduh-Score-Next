import { test, expect as baseExpect } from '@playwright/test';
import { createTenant } from './support/tenants.js';

// T-TD.3 acceptance: a Throwdown TEST event with the redemption module on, against the real app and a real local Supabase
// stack. 12 competitors, 1 v 1 groups fed by Round 1. The organiser's console does everything (setup, draw, Round 1 by judges'
// taps) and the losers are then drawn into three GROUPS of two: a Redemption page lists who is in, a phone and a projector show the
// groups, each group is voted by the judges, and the group winners rejoin
// the bracket beside Round 1's winners (6 + 2 = 8 brewers: the quarter-finals). Nothing is shortcut through the database.

const expect = baseExpect.configure({ timeout: 15000 });
const NAMES = [
  'Ana',
  'Bima',
  'Citra',
  'Dani',
  'Eka',
  'Farid',
  'Gita',
  'Hadi',
  'Indra',
  'Joko',
  'Kiki',
  'Lina',
];

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

async function tap(card, side, expectedCount) {
  await card
    .locator('.td-side')
    .nth(side)
    .getByRole('button', { name: /^Vote / })
    .click();
  await expect(card.locator('.td-count').nth(side)).toHaveText(
    `${expectedCount} ${expectedCount === 1 ? 'vote' : 'votes'}`,
  );
}

test.describe('Throwdown redemption, a 12-competitor test event (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });
  let tenant;

  test.afterAll(async () => {
    await tenant?.cleanUp();
  });

  test('the losers of Round 1 are drawn into groups, voted, and the winners return', async ({
    page,
    browser,
  }) => {
    test.setTimeout(480000);
    tenant = await createTenant({ label: 'td3', live: false });
    const event = await tenant.createEvent({
      format: 'throwdown',
      name: `Redemption ${Date.now()}`,
    });
    await signInAs(page, tenant);
    await page.evaluate(async (id) => {
      const mod = await import('/src/core/supabaseClient.js');
      const { error } = await mod
        .getSupabase()
        .from('events')
        .update({ is_test: true })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }, event.id);
    await page.goto('about:blank');
    await page.goto(`/app/#/events/${event.id}/throwdown/matches`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Redemption');

    // ---- twelve competitors
    for (const [i, name] of NAMES.entries()) {
      await page.getByLabel('Competitor name').fill(name);
      await page.getByLabel('Phone', { exact: true }).fill(`71234${String(i).padStart(2, '0')}`);
      await page.getByRole('button', { name: 'Add competitor' }).click();
      await expect(page.locator('.td-roster-name', { hasText: name })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Competitors (12)' })).toBeVisible();

    // ---- setup: redemption on (pairs, fed by Round 1, no cap), then the draw
    const toggle = page.getByLabel(/Redemption round \(competitors who lose/);
    await toggle.check();
    // 1 v 1 first: there is no group-size choice yet
    await expect(page.getByLabel(/Groups of/)).toHaveCount(0);
    await expect(page.getByLabel(/At most this many come back/)).toHaveValue('0');
    await expect(page.getByLabel('After Round 1')).toBeChecked();
    await page.getByRole('button', { name: 'Draw the bracket' }).click();
    await expect(page.locator('.td-preview li')).toHaveCount(6);
    await page.getByRole('button', { name: 'Start Round 1' }).click();
    await expect(page.getByRole('heading', { name: 'Now playing' })).toBeVisible();
    await expect(page.locator('article.td-match')).toHaveCount(6);
    // no trace of redemption yet beyond the setup it was chosen in: no groups, no link
    await expect(page.getByRole('link', { name: /Redemption round: who is in/ })).toHaveCount(0);

    const projector = await (
      await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    ).newPage();
    const phone = await (
      await browser.newContext({ viewport: { width: 360, height: 740 } })
    ).newPage();
    await projector.goto(`/app/#/live/${tenant.slug}/projector`);
    await phone.goto(`/app/#/live/${tenant.slug}/phone`);

    // ---- Round 1: six matches, the first side wins 2-1 each time
    for (let i = 0; i < 6; i += 1) {
      const card = page.locator('article.td-match').first();
      await expect(card).toBeVisible();
      const title = (await card.locator('h3').textContent()).trim();
      const same = page
        .locator('article.td-match')
        .filter({ has: page.locator('h3', { hasText: title }) });
      await tap(same, 0, 1);
      await tap(same, 1, 1);
      await tap(same, 0, 2);
      await same.getByRole('button', { name: /^Confirm:/ }).click();
      await expect(same).toBeHidden();
    }

    // ---- the redemption round exists: three pairs, and a page that shows who is in
    const groups = page.locator('article.td-match');
    await expect(groups).toHaveCount(3);
    await expect(groups.first().locator('h3')).toContainText('Group 1:');
    await expect(groups.first().locator('.td-vote')).toHaveCount(2);
    await expect(groups.nth(2).locator('.td-vote')).toHaveCount(2);
    await page.getByRole('link', { name: 'Redemption round: who is in' }).click();
    await expect(page).toHaveURL(new RegExp(`#/events/${event.id}/throwdown/redemption$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redemption round');
    await expect(page.getByRole('heading', { name: 'Who is in (6)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Group 1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Group 3' })).toBeVisible();
    await expect(page.getByText(/Draw code: /)).toBeVisible();
    await expect(page.locator('.td-red-roster li')).toHaveCount(6);
    // the six are exactly the six who lost: every one is a name on the roster
    const inRoster = await page.locator('.td-red-roster li').allTextContents();
    for (const name of inRoster) expect(NAMES).toContain(name);
    await page.getByRole('link', { name: 'Open the matches to vote' }).click();
    await expect(page.locator('article.td-match')).toHaveCount(3);

    // the audience sees groups, not duels
    await expect(phone.locator('.td-phone')).toContainText('Redemption', { timeout: 45000 });
    await expect(phone.locator('.td-phone')).toContainText('Group 1:', { timeout: 45000 });
    await expect(
      projector.locator('.stage-kicker').filter({ hasText: 'the groups' }).first(),
    ).toBeVisible({
      timeout: 100000,
    });

    // ---- group 1: 1-1 is level (Confirm stays off), a second vote settles it; groups 2 and 3 by a majority
    const group = (n) =>
      page
        .locator('article.td-match')
        .filter({ has: page.locator('h3', { hasText: `Group ${n}:` }) });
    const g1 = group(1);
    await tap(g1, 0, 1);
    await tap(g1, 1, 1);
    await expect(g1.getByRole('button', { name: 'Confirm result' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await tap(g1, 1, 2);
    await g1.getByRole('button', { name: /^Confirm:/ }).click();
    await expect(g1).toBeHidden();
    for (const [n, winner] of [
      [2, 0],
      [3, 1],
    ]) {
      const g = group(n);
      await tap(g, winner, 1);
      await tap(g, winner, 2);
      await tap(g, 1 - winner, 1);
      await g.getByRole('button', { name: /^Confirm:/ }).click();
      await expect(g).toBeHidden();
    }

    // ---- the winners rejoin: 6 winners + 3 revived = 9 brewers, five matches (a bye among them)
    await expect(page.locator('article.td-match')).toHaveCount(4);
    await expect(page.locator('.td-round h3')).toContainText(['Round 1', 'Redemption', 'Round 2']);
    // a group is undoable while the next round has not started: the button is offered on its row
    await expect(
      page
        .locator('.td-round', { has: page.locator('h3', { hasText: /^Redemption$/ }) })
        .getByRole('button', { name: /^Undo result/ }),
    ).toHaveCount(3);

    // ---- the results page names each group as a group, with every brewer's votes
    await page.getByRole('link', { name: 'Results and match log' }).click();
    const redemption = page.getByRole('region', { name: 'Redemption' });
    await expect(redemption).toContainText('Group 1:');
    await expect(redemption).toContainText('Group 3:');
    await expect(redemption).toContainText(/\d+ to \d+/);
    await expect(page.locator('body')).not.toContainText('undefined');
  });
});
