import { test, expect } from '@playwright/test';
import { createTenant, localStack } from './support/tenants.js';
import { DEMO_TEAM_NAMES, preliminaryPayload } from '../../src/formats/btc/demoLivePayload.js';

// T-TEN.D5: the audience, anonymous and signed-out, against the real app and a real local Supabase stack with
// TWO real organisations, each with an active live session: a Cup Taster one ("Alpha") and a Brewers Cup one
// ("Bravo"), so both formats' own projector and phone bodies are exercised, and a leak in either direction
// (A's event on B's screens, B's on A's) shows up as the other's name on a page.
//
// Every audience here is its own browser context, as in a venue: nothing is shared between two screens but
// the database. Surfaces are reached with the slug-qualified links the organiser hands out (T-TEN.D1, D4).

const SURFACE_WAIT = { timeout: 15000 };

const ALPHA = {
  event: 'Alpha Open Cupping',
  cuppers: ['Alpha Ana', 'Alpha Ben'],
};

function cupTasterPayload(cuppers) {
  return {
    stage: { kind: 'prelims', ordinal: 1, setCount: 3 },
    eventName: ALPHA.event,
    standings: cuppers.map((displayName, i) => ({
      position: i + 1,
      displayName,
      numCorrect: 5 - i,
      totalElapsedSecs: 200 + i * 30,
      tieStatus: null,
    })),
    upNext: null,
    activeHeat: null,
    recentHeats: [],
    champion: null,
  };
}

// The demo Brewers Cup payload, built by the REAL assembler, with every team and the event named for Bravo.
function brewersCupPayload(playedCount) {
  let text = JSON.stringify(preliminaryPayload({ playedCount }));
  for (const team of DEMO_TEAM_NAMES) text = text.replaceAll(team, `Bravo ${team}`);
  return JSON.parse(text.replaceAll('BTC demo rehearsal', 'Bravo Brewers Cup'));
}

test.describe('the audience of two organisations (real app, real local Supabase)', () => {
  // Serial, as organiser-flow.spec.js is: one shared stateful local stack (Realtime included).
  test.describe.configure({ mode: 'serial' });

  let alpha;
  let bravo;

  test.beforeAll(async () => {
    test.setTimeout(60000);
    alpha = await createTenant({
      label: 'alpha',
      format: 'cup_taster',
      eventName: ALPHA.event,
      payload: cupTasterPayload(ALPHA.cuppers),
    });
    bravo = await createTenant({
      label: 'bravo',
      format: 'btc',
      eventName: 'Bravo Brewers Cup',
      payload: brewersCupPayload(12),
    });
  });

  test.afterAll(async () => {
    await alpha?.cleanUp();
    await bravo?.cleanUp();
  });

  // One anonymous visitor on one surface of one organisation.
  async function audience(browser, tenant, surface) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/app/#/live/${tenant.slug}/${surface}`);
    return { page, context };
  }

  for (const surface of ['projector', 'phone']) {
    test(`the ${surface} of each organisation shows only its own event, in its own format`, async ({
      browser,
    }) => {
      test.setTimeout(60000);
      const forAlpha = await audience(browser, alpha, surface);
      const forBravo = await audience(browser, bravo, surface);
      try {
        const alphaScreen = forAlpha.page.locator('.app-bare-root');
        const bravoScreen = forBravo.page.locator('.app-bare-root');
        // Cup Taster's own body: its event and its cuppers...
        await expect(alphaScreen).toContainText(ALPHA.cuppers[0], SURFACE_WAIT);
        if (surface === 'projector') await expect(alphaScreen).toContainText(ALPHA.event);
        // ...Brewers Cup's own body: its event and its teams.
        await expect(bravoScreen).toContainText('Bravo Brewers Cup', SURFACE_WAIT);
        await expect(bravoScreen).toContainText('Bravo Pour Decisions');
        // Neither screen shows a trace of the other organisation, now that both are plainly loaded.
        await expect(alphaScreen).not.toContainText('Bravo');
        await expect(bravoScreen).not.toContainText('Alpha');
        // ...and neither is the organiser's console: audience screens carry no sign-in and no organiser chrome.
        for (const { page } of [forAlpha, forBravo]) {
          await expect(page.locator('.app-shell-root')).toBeHidden();
          await expect(page.getByRole('heading', { name: /sign in/i })).toHaveCount(0);
        }
      } finally {
        await forAlpha.context.close();
        await forBravo.context.close();
      }
    });
  }

  test('what one organisation publishes reaches its own open screens and never the other organisation’s', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const alphaProjector = await audience(browser, alpha, 'projector');
    const alphaPhone = await audience(browser, alpha, 'phone');
    const bravoProjector = await audience(browser, bravo, 'projector');
    const bravoPhone = await audience(browser, bravo, 'phone');
    const all = [alphaProjector, alphaPhone, bravoProjector, bravoPhone];
    try {
      await expect(alphaProjector.page.locator('.app-bare-root')).toContainText(
        ALPHA.cuppers[0],
        SURFACE_WAIT,
      );
      await expect(alphaPhone.page.locator('.app-bare-root')).toContainText(
        ALPHA.cuppers[0],
        SURFACE_WAIT,
      );
      await expect(bravoProjector.page.locator('.app-bare-root')).toContainText(
        'Bravo',
        SURFACE_WAIT,
      );
      await expect(bravoPhone.page.locator('.app-bare-root')).toContainText('Bravo', SURFACE_WAIT);

      // Alpha publishes a new standing. A publish made in the instant before a screen's live channel has joined
      // is not delivered to it (the screen reads once at start-up, then listens), so the publish is repeated
      // until Alpha's own screens show it: that is the proof the change travelled.
      await expect(async () => {
        await alpha.publish(cupTasterPayload([...ALPHA.cuppers, 'Alpha Newcomer']));
        await expect(alphaPhone.page.locator('.app-bare-root')).toContainText('Alpha Newcomer', {
          timeout: 3000,
        });
      }).toPass({ timeout: 30000 });
      await expect(alphaProjector.page.locator('.app-bare-root')).toContainText(
        'Alpha Newcomer',
        SURFACE_WAIT,
      );

      // And the other way: Bravo publishes (more matches played) and its own screens show it.
      await expect(async () => {
        await bravo.publish(brewersCupPayload(20));
        await expect(bravoPhone.page.locator('.app-bare-root')).toContainText(
          '20 of 28 matches played',
          { timeout: 3000 },
        );
      }).toPass({ timeout: 30000 });
      await expect(bravoProjector.page.locator('.app-bare-root')).toContainText('Bravo');

      // Both changes have now travelled to the people they belong to. Only now is "nothing crossed over" a
      // meaningful thing to check: neither organisation's screens picked up the other's name or standing.
      for (const { page } of [alphaProjector, alphaPhone]) {
        await expect(page.locator('.app-bare-root')).not.toContainText('Bravo');
      }
      for (const { page } of [bravoProjector, bravoPhone]) {
        await expect(page.locator('.app-bare-root')).not.toContainText('Alpha');
        await expect(page.locator('.app-bare-root')).not.toContainText('Newcomer');
      }
    } finally {
      for (const { context } of all) await context.close();
    }
  });

  test('a wrong slug says so on both surfaces, and the old slug-less link opens a surface without showing either organisation', async ({
    browser,
  }) => {
    test.setTimeout(60000);
    // A fresh visitor for each link, so one surface's card can never stand in for the next one's.
    for (const surface of ['phone', 'projector']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`/app/#/live/${alpha.slug}-typo/${surface}`);
        await expect(page.getByText('We couldn’t find that organiser')).toBeVisible(SURFACE_WAIT);
        // The projector's card carries the stage surface's own marker; the phone's does not.
        const bare = page.locator('.app-bare-root');
        if (surface === 'projector') await expect(bare).toHaveAttribute('data-surface', 'stage');
        else await expect(bare).not.toHaveAttribute('data-surface', 'stage');
        // Never another organisation's event in its place, and never a "no event tonight" answer.
        await expect(page.locator('.app-bare-root')).not.toContainText('Alpha');
        await expect(page.locator('.app-bare-root')).not.toContainText('Bravo');
        await expect(page.getByText('Not live')).toHaveCount(0);
      } finally {
        await context.close();
      }
    }

    // The old link names nobody; it opens the organisation this build was configured for (the seeded local
    // one), whatever other organisations are live at the same time.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto('/app/#/live/phone');
      // Past "Connecting…" (whose badge already reads "Not live"), so the checks below see a loaded screen.
      await expect(page.locator('.app-bare-root .viewer-badge')).toHaveText(
        /^(live|not live)$/i,
        SURFACE_WAIT,
      );
      await expect(page.getByText('Connecting…')).toBeHidden(SURFACE_WAIT);
      await expect(page.getByText('We couldn’t find that organiser')).toHaveCount(0);
      await expect(page.locator('.app-bare-root')).not.toContainText('Alpha');
      await expect(page.locator('.app-bare-root')).not.toContainText('Bravo');
    } finally {
      await context.close();
    }
  });

  // T-TEN.D6, over the real HTTP door an anonymous caller (or an old, cached screen) would use.
  test('an anonymous caller cannot list events, and the live sessions it can list are the active ones', async ({
    request,
  }) => {
    const { api, anonKey } = localStack();
    const headers = { apikey: anonKey, authorization: `Bearer ${anonKey}` };

    const events = await request.get(`${api}/rest/v1/events?select=name`, { headers });
    expect([401, 403]).toContain(events.status());

    const sessions = await request.get(`${api}/rest/v1/live_sessions?select=org_id,active`, {
      headers,
    });
    expect(sessions.ok()).toBe(true);
    const rows = await sessions.json();
    // Both organisations' live sessions are listed, and nothing that is not live.
    expect(rows.map((row) => row.org_id)).toEqual(
      expect.arrayContaining([alpha.orgId, bravo.orgId]),
    );
    expect(rows.every((row) => row.active === true)).toBe(true);
  });

  test('moving between phone, projector and splash in one tab keeps showing the same organisation’s event', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const { page, context } = await audience(browser, alpha, 'phone');
    const screen = page.locator('.app-bare-root');
    const go = (surface) =>
      page.evaluate((hash) => {
        location.hash = hash;
      }, `#/live/${alpha.slug}/${surface}`);
    try {
      await expect(screen).toContainText(ALPHA.cuppers[0], SURFACE_WAIT);

      await go('projector');
      await expect(screen).toContainText(ALPHA.event, SURFACE_WAIT);
      await expect(screen).toContainText(ALPHA.cuppers[0]);

      await go('splash');
      await expect(page.locator('.app-bare-root .splash-content')).toBeVisible(SURFACE_WAIT);
      // The splash names the event it was opened for (read after the screen first appears).
      await expect(page.locator('.app-bare-root .splash-eventline')).toContainText(
        ALPHA.event,
        SURFACE_WAIT,
      );
      await expect(screen).not.toContainText('Bravo');

      // Back to the projector after the splash, then the phone again: each still draws its own screen.
      await go('projector');
      await expect(screen).toContainText(ALPHA.cuppers[0], SURFACE_WAIT);
      await expect(page.locator('.app-bare-root .splash-content')).toHaveCount(0);
      await go('phone');
      await expect(screen).toContainText(ALPHA.cuppers[0], SURFACE_WAIT);
      await expect(screen).not.toContainText('Bravo');
      await expect(page.locator('.app-shell-root')).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
