import { test, expect } from '@playwright/test';
import { isExpired } from '../../src/core/countdown.js';

// Cross-surface countdown agreement (handoff §14, AC across T5.3/T5.4):
// "Playwright test driving organiser + projector + phone simultaneously,
// proving all three agree on remaining time within tolerance." Three
// separate browser contexts, not one page with three panels — the point is
// to catch drift that can only show up across genuinely independent page
// loads/clocks, not something a shared JS realm would hide.
//
// core/countdown.js's own module comment already states the invariant this
// test exists to prove: "organiser, projector, and phone... recompute
// remaining time locally against its own clock... two callers with the
// same inputs always agree." This is that proof, run for real, not a unit
// test's shared process.
//
// Drives the existing, already-reviewed demo harnesses directly —
// timingScreen.preview.html (organiser), projectorSurface.preview.html,
// phoneSummary.preview.html — via the dev server (see playwright.config.js's
// 'dev-harnesses' project). Each harness's own window.__e2e hook (added for
// this test) lets the organiser's REAL started_at/duration_secs (set by
// really clicking "Start heat", not invented by the test) get published to
// the other two contexts, so what's being compared is genuinely the same
// heat, not three independently-constructed timestamps that happen to be
// close.

const TOLERANCE_SECS = 2;
const DEMO_DURATION_SECS = 20; // matches timingScreen.preview.html's own short demo duration

function parseMmSs(text) {
  const match = text.trim().match(/^(\d+):(\d{2})$/);
  if (!match) throw new Error(`could not parse mm:ss from "${text}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

async function readOrganiserRemaining(page) {
  return parseMmSs(await page.locator('.countdown-display').textContent());
}

async function readViewerRemaining(page) {
  return parseMmSs(await page.locator('.viewer-countdown').textContent());
}

test.describe('cross-surface countdown agreement', () => {
  test('organiser, projector, and phone all agree on remaining time, including near expiry', async ({
    browser,
  }) => {
    // The default 30s test timeout is too tight for this test's own
    // deliberate real-time waits (~22s: 3s + 9s + 10s, genuinely waiting
    // out a real countdown across three real browser contexts, not fake
    // timers) plus page-load/setup overhead.
    test.setTimeout(60000);
    // Declared here, created inside the try below — found in review: with
    // creation OUTSIDE try/finally, a throw partway through the three
    // newContext()/newPage() calls (three simultaneous contexts is exactly
    // the kind of thing that can fail under resource pressure) would leak
    // whichever context(s) had already been created, since Playwright
    // doesn't auto-track manually created contexts the way it does the
    // built-in `context`/`page` fixtures.
    let organiserContext, projectorContext, phoneContext;
    try {
      organiserContext = await browser.newContext();
      projectorContext = await browser.newContext();
      phoneContext = await browser.newContext();
      const organiser = await organiserContext.newPage();
      const projector = await projectorContext.newPage();
      const phone = await phoneContext.newPage();
      await organiser.goto('/src/formats/cup-taster/timingScreen.preview.html');
      await organiser.getByRole('button', { name: 'Start heat' }).click();
      await expect(organiser.locator('.countdown-display')).toBeVisible();

      // Read back the REAL values this page's own action set.
      const { startedAt, durationSecs } = await organiser.evaluate(() => {
        const heat = window.__e2e.client.db.ct_heats[0];
        return { startedAt: heat.started_at, durationSecs: heat.duration_secs };
      });
      expect(startedAt).toBeTruthy();
      expect(durationSecs).toBe(DEMO_DURATION_SECS);

      await projector.goto('/src/formats/cup-taster/projectorSurface.preview.html');
      await phone.goto('/src/formats/cup-taster/phoneSummary.preview.html');
      await projector.evaluate(
        ({ startedAt, durationSecs }) => window.__e2e.publishActiveHeat(startedAt, durationSecs),
        { startedAt, durationSecs },
      );
      await phone.evaluate(
        ({ startedAt, durationSecs }) => window.__e2e.publishActiveHeat(startedAt, durationSecs),
        { startedAt, durationSecs },
      );
      await expect(projector.locator('.viewer-countdown')).toBeVisible();
      await expect(phone.locator('.viewer-countdown')).toBeVisible();

      async function assertAllAgree(label) {
        const [organiserSecs, projectorSecs, phoneSecs] = await Promise.all([
          readOrganiserRemaining(organiser),
          readViewerRemaining(projector),
          readViewerRemaining(phone),
        ]);
        const spread =
          Math.max(organiserSecs, projectorSecs, phoneSecs) -
          Math.min(organiserSecs, projectorSecs, phoneSecs);
        expect(
          spread,
          `${label}: organiser=${organiserSecs}s projector=${projectorSecs}s phone=${phoneSecs}s`,
        ).toBeLessThanOrEqual(TOLERANCE_SECS);
      }

      // Shortly after start — mid-heat agreement.
      await organiser.waitForTimeout(3000);
      await assertAllAgree('mid-heat');

      // Inside the urgent window (<=10s remaining, all three surfaces'
      // own URGENT_THRESHOLD_SECS) — agreement AND that all three
      // independently crossed into their own urgent/danger-color state.
      await organiser.waitForTimeout(9000); // ~12s elapsed, ~8s remaining
      await assertAllAgree('urgent window');
      await expect(organiser.locator('.countdown-display')).toHaveAttribute('data-urgent', 'true');
      await expect(projector.locator('.viewer-countdown')).toHaveAttribute('data-urgent', 'true');
      await expect(phone.locator('.viewer-countdown')).toHaveAttribute('data-urgent', 'true');

      // Past expiry, the two sides genuinely diverge — found running this
      // test for real, not assumed: the organiser's own timingScreen.js
      // auto-maxes every unstopped cupper and replaces the whole countdown
      // view with a "Timing complete" summary (a write-access action only
      // the organiser side takes); the read-only viewers never receive a
      // "heat completed" signal in this demo (no re-publish happens), so
      // per T5.3's own AC they instead freeze their last-known display at
      // 0:00 rather than blanking, erroring, or ticking negative. Proving
      // "agreement" past expiry means proving each surface reaches ITS OWN
      // correct terminal state, not forcing a numeric comparison across
      // two representations that are no longer the same kind of thing.
      await organiser.waitForTimeout(10000); // ~22s elapsed, past the 20s duration
      await expect(organiser.getByRole('heading', { name: 'Timing complete' })).toBeVisible();
      const [projectorFinal, phoneFinal] = await Promise.all([
        readViewerRemaining(projector),
        readViewerRemaining(phone),
      ]);
      expect(projectorFinal).toBe(0);
      expect(phoneFinal).toBe(0);
      await expect(projector.locator('.viewer-countdown')).toHaveAttribute('data-urgent', 'true');
      await expect(phone.locator('.viewer-countdown')).toHaveAttribute('data-urgent', 'true');

      // "Timing complete" and "frozen at 0:00" are two DIFFERENT-looking
      // outcomes — found in review: proven side by side like this, they're
      // never actually tied back to the SAME zero-crossing event. Close
      // that gap: every organiser-side entry got auto-maxed to exactly
      // durationSecs (the real clamp, not a guess), and isExpired() — the
      // same pure function every surface's own countdown math already
      // calls — independently agrees this startedAt/durationSecs pair is
      // expired right now. Three different kinds of proof, one true fact.
      const heatEntries = await organiser.evaluate(() => window.__e2e.client.db.ct_heat_entries);
      for (const entry of heatEntries) {
        expect(entry.maxed).toBe(true);
        expect(entry.elapsed_secs).toBe(durationSecs);
      }
      expect(isExpired(new Date(startedAt).getTime(), durationSecs, Date.now())).toBe(true);
    } finally {
      await organiserContext?.close();
      await projectorContext?.close();
      await phoneContext?.close();
    }
  });
});
