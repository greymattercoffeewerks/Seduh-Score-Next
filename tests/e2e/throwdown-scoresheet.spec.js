import { test, expect as baseExpect } from '@playwright/test';
import { createTenant } from './support/tenants.js';

// Throwdown scoresheet module (stage 2): an 8-competitor TEST event with the module on (Final 2 cups, 3rd place 1 cup,
// 3 judges). The quarter- and semi-finals are tap-voted as ever; the 3rd place match and the Final are decided by the
// judges' paper sheets that a scorekeeper types into the console. One match is decided by "more judges scored them
// higher" (totals level), the other is level on everything and the organiser picks. A projector and a phone follow as an
// anonymous audience and must never show a score: only "Judges scoring" while it runs, and the winner after.

const expect = baseExpect.configure({ timeout: 15000 });
const NAMES = ['Ana', 'Bima', 'Citra', 'Dani', 'Eka', 'Farid', 'Gita', 'Hadi'];
// anything that would reveal how a scored match was decided
const LEAK = /total|point|\bcup\b|cups|decision|organiser|preferr|\b72\b|\b48\b|\b24\b/i;

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

// Types one paper sheet: `perSeat` is the same whole number on every line (0 to 3 fits every line's maximum).
async function enterSheet(card, seat, side, value) {
  await card
    .locator('.td-grid-btn')
    .nth((seat - 1) * 2 + side)
    .click();
  const inputs = card.locator('.td-points');
  const count = await inputs.count();
  expect(count).toBe(12); // 6 lines x 2 cups
  for (let i = 0; i < count; i += 1) await inputs.nth(i).fill(String(value));
  await card.getByRole('button', { name: 'Save sheet' }).click();
}

async function enterAll(card, judgeValues) {
  // judgeValues[side][seat-1]
  let n = 0;
  for (let seat = 1; seat <= 3; seat += 1) {
    for (let side = 0; side < 2; side += 1) {
      await expect(card.getByRole('button', { name: 'Confirm result' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await enterSheet(card, seat, side, judgeValues[side][seat - 1]);
      n += 1;
      await expect(card.locator('.td-sheets-count')).toContainText(`Sheets in: ${n} of 6`);
    }
  }
}

test.describe('Throwdown scoresheet rounds (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });
  let tenant;

  test.afterAll(async () => {
    await tenant?.cleanUp();
  });

  test('taps to the semi-finals, then sheets decide the 3rd place match and the Final, and the audience sees no scores', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300000);
    tenant = await createTenant({ label: 'tdsheet', live: false });
    const event = await tenant.createEvent({
      format: 'throwdown',
      name: `Sheets ${Date.now()}`,
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
    await page.goto(`/app/#/events/${event.id}`);
    await expect(page.locator('.is-test-banner')).toBeVisible();

    const projector = await (
      await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    ).newPage();
    const phone = await (
      await browser.newContext({ viewport: { width: 360, height: 740 } })
    ).newPage();

    for (const name of NAMES) {
      await page.getByLabel('Competitor name').fill(name);
      await page.getByRole('button', { name: 'Add competitor' }).click();
      await expect(page.locator('.td-roster-name', { hasText: name })).toBeVisible();
    }

    // ---- setup: switch the scoresheet on; the defaults are Final 2 cups and 3rd place 1 cup
    await page.getByLabel(/Scoresheet rounds/).check();
    await expect(page.getByLabel('Final', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('3rd place match', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('Semi-finals', { exact: true })).toHaveValue('0');
    await page.getByRole('button', { name: 'Draw the bracket' }).click();
    await page.getByRole('button', { name: 'Start Round 1' }).click();
    await expect(page.getByRole('heading', { name: 'Now playing' })).toBeVisible();

    await projector.goto(`/app/#/live/${tenant.slug}/projector`);
    await phone.goto(`/app/#/live/${tenant.slug}/phone`);
    await expect(phone.locator('.td-phone')).toContainText('Quarter-finals');

    // ---- quarter-finals and semi-finals are tap-voted, exactly as before
    for (const round of ['Quarter-finals', 'Semi-finals']) {
      await expect(page.locator('article.td-match').first()).toBeVisible();
      const total = await page.locator('article.td-match').count();
      expect(total).toBe(round === 'Quarter-finals' ? 4 : 2);
      for (let i = 0; i < total; i += 1) {
        const title = (await page.locator('article.td-match h3').first().textContent()).trim();
        const card = page
          .locator('article.td-match')
          .filter({ has: page.locator('h3', { hasText: title }) });
        await card
          .getByRole('button', { name: /^Vote / })
          .first()
          .click();
        await expect(card.locator('.td-count').first()).toHaveText('1 vote');
        await card.getByRole('button', { name: /^Confirm: / }).click();
        await expect(card).toBeHidden();
      }
    }

    // ---- the 3rd place match and the Final are scored: no tap buttons, a sheets grid instead
    await expect(page.locator('article.td-scored')).toHaveCount(2, { timeout: 20000 });
    await expect(page.locator('.td-vote')).toHaveCount(0);
    await expect(page.locator('.td-sheets-count').first()).toContainText('Sheets in: 0 of 6');
    await expect(phone.locator('.td-phone')).toContainText('Judges scoring', { timeout: 20000 });
    await expect(projector.locator('.td-stage-now')).toContainText('Judges scoring');
    // while judging, neither audience surface shows any number tied to a result, or a hint of the rules
    for (const surface of [phone, projector]) {
      const judging = await surface.locator('.td-phone, .td-stage-now').first().innerText();
      expect(judging).not.toMatch(LEAK);
    }

    // ---- first match: the totals are level (72 each) but two judges scored Competitor 1 higher => "more judges"
    const first = page.locator('article.td-scored').first();
    const firstNames = (await first.locator('h3').textContent()).split(' vs ');
    await enterAll(first, [
      [3, 3, 0],
      [2, 2, 2],
    ]);
    // a saved sheet can be reopened (prefilled) and replaced until the match is confirmed
    await first.locator('.td-grid-btn').first().click();
    await expect(first.locator('.td-points').first()).toHaveValue('3');
    await first.getByRole('button', { name: 'Close without saving' }).click();
    // replace judge 1's sheet for competitor 1 (3 -> 2 on every line, 72 -> 60) and put it back: the replace must land
    await first.locator('.td-grid-btn').first().click();
    for (let i = 0; i < 12; i += 1) await first.locator('.td-points').nth(i).fill('2');
    await first.getByRole('button', { name: 'Save sheet' }).click();
    await expect(first).toContainText(`${firstNames[1]} wins`);
    await first.locator('.td-grid-btn').first().click();
    for (let i = 0; i < 12; i += 1) await first.locator('.td-points').nth(i).fill('3');
    await first.getByRole('button', { name: 'Save sheet' }).click();
    await expect(first).toContainText('more judges scoring them higher');
    await expect(first).toContainText(`${firstNames[0]} wins`);
    await first.getByRole('button', { name: `Confirm: ${firstNames[0]} wins` }).click();
    await expect(page.locator('article.td-scored')).toHaveCount(1, { timeout: 15000 });

    // ---- second match: level on points AND on judges => the organiser picks, and the copy says so
    const second = page.locator('article.td-scored').first();
    const secondNames = (await second.locator('h3').textContent()).split(' vs ');
    await enterAll(second, [
      [2, 2, 2],
      [2, 2, 2],
    ]);
    await expect(second).toContainText('recorded as your decision');
    await expect(second.getByRole('button', { name: 'Confirm result' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await second.getByRole('radio', { name: secondNames[1] }).check();
    await second.getByRole('button', { name: `Confirm: ${secondNames[1]} wins` }).click();
    await expect(page.locator('article.td-scored')).toHaveCount(0, { timeout: 15000 });

    // ---- the audience learns the winner only
    await expect(page.locator('.td-champion')).toBeVisible();
    await expect(phone.locator('.td-phone-champion')).toBeVisible();
    await expect(projector.locator('.stage-champion-name')).toBeVisible();
    for (const surface of [phone, projector]) {
      const text = await surface.locator('body').innerText();
      expect(text).not.toMatch(LEAK);
      expect(text).not.toContain('Judges scoring');
    }

    // ---- the console keeps the read-only audit, on the event screen and on the results page
    await expect(page.getByText('Score breakdown')).toHaveCount(2);
    await page.getByRole('link', { name: 'Results and match log' }).click();
    await expect(page.getByRole('heading', { name: /Final scores/ })).toBeVisible();
    await expect(page.getByText(/won on more judges scoring them higher/)).toBeVisible();
    await expect(page.getByText(/won on the organiser’s decision/)).toBeVisible();
  });
});
