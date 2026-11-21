import { test, expect as baseExpect } from '@playwright/test';
import { createTenant } from './support/tenants.js';

// T-TD.1 acceptance: a FULL 8-competitor Throwdown run start to finish on a TEST event, against the real app and a
// real local Supabase stack. The organiser's console does everything (add eight competitors, random draw, judges' taps,
// confirm, a walkover, the 3rd place match, the Final) while a projector and a phone follow the live session as an
// anonymous audience. Nothing is shortcut through the database: every write is a button the organiser presses.
//
// What it proves end to end: the draw makes four matches; Confirm stays disabled while a match is level; the next round
// appears only when the previous is decided; the 3rd place match and the Final are live together; a champion banner,
// the projector and the phone all name the same champion; and the TEST marker is on every surface.

const expect = baseExpect.configure({ timeout: 15000 });
const NAMES = ['Ana', 'Bima', 'Citra', 'Dani', 'Eka', 'Farid', 'Gita', 'Hadi'];

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

// One tap on a side's vote button, waiting for the count to show it landed (the button is busy while it writes).
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

test.describe('Throwdown, a full 8-competitor test event (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });
  let tenant;

  test.afterAll(async () => {
    await tenant?.cleanUp();
  });

  test('console, projector and phone follow an event from the draw to the champion', async ({
    page,
    browser,
  }) => {
    test.setTimeout(480000);
    tenant = await createTenant({ label: 'td1', live: false });
    const event = await tenant.createEvent({
      format: 'throwdown',
      name: `Throwdown ${Date.now()}`,
    });
    await signInAs(page, tenant);
    // a rehearsal: the event is a TEST event, and every surface has to say so
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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Throwdown');
    await expect(page.locator('.is-test-banner')).toBeVisible();

    // the audience: anonymous, in their own contexts
    const projector = await (
      await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    ).newPage();
    const phone = await (
      await browser.newContext({ viewport: { width: 360, height: 740 } })
    ).newPage();

    // ---- eight competitors
    // A phone is required (it is what a Seduh ID links to); one fixed Brunei number per name.
    for (const [i, name] of NAMES.entries()) {
      await page.getByLabel('Competitor name').fill(name);
      await page.getByLabel('Phone', { exact: true }).fill(`712345${i}`);
      await page.getByRole('button', { name: 'Add competitor' }).click();
      await expect(page.locator('.td-roster-name', { hasText: name })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Competitors (8)' })).toBeVisible();

    // ---- correct a competitor's café or team (the same Edit Cup Taster's roster has), the name untouched
    await page.getByRole('button', { name: `Edit ${NAMES[0]}` }).click();
    await page.getByLabel(`Café or team (optional) for ${NAMES[0]}`).fill('Edited Cafe');
    await page.getByRole('button', { name: `Save changes to ${NAMES[0]}` }).click();
    await expect(page.locator('.screen-feedback')).toContainText(`${NAMES[0]} updated.`);
    await expect(page.getByRole('button', { name: `Edit ${NAMES[0]}` })).toBeFocused();

    // ---- random draw, then start
    await page.getByRole('button', { name: 'Draw the bracket' }).click();
    await expect(page.locator('.td-preview li')).toHaveCount(4);
    await page.getByRole('button', { name: 'Start Round 1' }).click();
    await expect(page.getByRole('heading', { name: 'Now playing' })).toBeVisible();
    await expect(page.locator('article.td-match')).toHaveCount(4);

    // the audience joins after the start published
    await projector.goto(`/app/#/live/${tenant.slug}/projector`);
    await phone.goto(`/app/#/live/${tenant.slug}/phone`);
    await expect(phone.locator('.td-phone')).toContainText('Quarter-finals');
    await expect(phone.locator('.is-test-banner')).toBeVisible();
    // the venue display opens on the page loop: the first page is Up next
    await expect(projector.locator('.stage-kicker').first()).toContainText('Up next');
    await expect(projector.locator('.is-test-banner')).toBeVisible();

    // ---- play: every round until a champion. One walkover along the way; every other match by judges' taps.
    let walkedOver = 0;
    let guard = 0;
    while ((await page.locator('.td-champion').count()) === 0 && guard < 12) {
      guard += 1;
      const cards = page.locator('article.td-match');
      await expect(cards.first()).toBeVisible();
      const total = await cards.count();
      for (let i = 0; i < total; i += 1) {
        const title = (await page.locator('article.td-match h3').first().textContent()).trim();
        const card = page
          .locator('article.td-match')
          .filter({ has: page.locator('h3', { hasText: title }) });
        const confirm = card.getByRole('button', { name: /^Confirm(:| result)/ });
        // level: 0-0, then 1-1: Confirm cannot be pressed
        await expect(confirm).toHaveAttribute('aria-disabled', 'true');
        if ((guard === 1 || guard === 2) && i === 0) {
          walkedOver += 1;
          await card.getByText('Walkover (a competitor does not show)').click();
          await card
            .getByRole('button', { name: /advances$/ })
            .first()
            .click();
          await card.getByRole('button', { name: 'Confirm walkover' }).click();
          await expect(page.locator('article.td-match')).toHaveCount(total - 1, { timeout: 10000 });
          continue;
        }
        await tap(card, 0, 1);
        await tap(card, 1, 1);
        await expect(confirm).toHaveAttribute('aria-disabled', 'true');
        await expect(card).toContainText('level');
        await tap(card, i % 2, 2);
        await expect(confirm).not.toHaveAttribute('aria-disabled', 'true');
        await confirm.click();
        await expect(card).toBeHidden();
      }
    }
    // one walkover in the quarter-finals and one in the semi-finals: the 3rd place match is still played
    expect(walkedOver).toBe(2);
    // every match was decided, the 3rd place one included (nothing is left to play)
    await expect(page.locator('article.td-match')).toHaveCount(0);

    // ---- the end: one champion, named the same everywhere
    const banner = page.locator('.td-champion');
    await expect(banner).toBeVisible();
    const champion = (await banner.locator('.td-champion-name').textContent()).trim();
    expect(NAMES).toContain(champion);
    await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible();
    await expect(phone.locator('.td-phone-champion')).toContainText(champion);
    // the last result plays as a moment first (8 seconds), then the champion holds
    await expect(projector.locator('.stage-champion-name')).toHaveText(champion, {
      timeout: 90000,
    });
    await expect(projector.locator('.is-test-banner')).toBeVisible();
    await expect(phone.locator('.is-test-banner')).toBeVisible();
    // a bracket with a Final, and the 3rd place match was played (a walkover semi-final still gets one: both losers exist and are active)
    await expect(page.locator('.td-round h3')).toContainText([
      'Quarter-finals',
      'Semi-finals',
      '3rd place',
      'Final',
    ]);

    // ---- the organiser confirmed the wrong winner of the Final: undo it, take back the wrong vote, confirm the other
    // finalist. The champion banner goes, the Final is playable again with its taps kept, and the fix is recorded.
    const finalRound = page.locator('.td-round', {
      has: page.locator('h3', { hasText: /^Final$/ }),
    });
    const finalists = (await finalRound.locator('.td-round-match > span').first().textContent())
      .split(' vs ')
      .map((n) => n.trim());
    const otherFinalist = finalists.find((n) => n !== champion);
    // the semi-finals can no longer be undone (the Final has taps); the Final and the 3rd place match can
    await expect(
      page
        .locator('.td-round', { has: page.locator('h3', { hasText: 'Semi-finals' }) })
        .getByRole('button', {
          name: /^Undo result/,
        }),
    ).toHaveCount(0);
    await finalRound.getByRole('button', { name: /^Undo result/ }).click();
    await expect(page.locator('.td-reopen-q')).toHaveText(`Undo ${champion}’s win?`);
    await page.getByRole('button', { name: 'Yes, undo' }).click();
    await expect(page.locator('.td-champion')).toHaveCount(0);
    const finalCard = page.locator('article.td-match');
    await expect(finalCard).toHaveCount(1);
    const winnerSide = finalists.indexOf(champion);
    await expect(finalCard.locator('.td-count').nth(winnerSide)).toHaveText('2 votes');
    await finalCard
      .locator('.td-side')
      .nth(winnerSide)
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(finalCard.locator('.td-count').nth(winnerSide)).toHaveText('1 vote');
    await tap(finalCard, 1 - winnerSide, 2);
    await finalCard.getByRole('button', { name: /^Confirm(:| result)/ }).click();
    await expect(page.locator('.td-champion-name')).toHaveText(otherFinalist);
    // the projector holds a champion screen for at least a minute, then the corrected result plays as a moment first
    await expect(projector.locator('.stage-champion-name')).toHaveText(otherFinalist, {
      timeout: 150000,
    });

    // ---- publishing: the results screen offers the public archive, but a TEST event is never published. The card
    // says so in words and offers no button (the happy path, with a real event, is covered by the unit tests).
    await page.getByRole('link', { name: 'Results and match log' }).click();
    await expect(page.getByRole('region', { name: 'Corrections' })).toContainText(
      `${champion}’s win by votes was undone`,
    );
    const publish = page.getByRole('region', { name: 'Public results' });
    await expect(publish).toContainText('test event');
    await expect(publish).toContainText('cannot be published');
    await expect(publish.getByRole('button')).toHaveCount(0);
  });
});
