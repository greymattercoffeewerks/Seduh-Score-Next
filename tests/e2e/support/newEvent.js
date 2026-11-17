// The organiser home's "+ New event" flow, driven through the real screens: the link on the Events home, the form on
// #/events/new, and Create. Ends on the new event's own page (its heading is the event's name).
import { expect } from '@playwright/test';

export async function createEventViaUi(page, name) {
  await page
    .getByRole('link', { name: /New event/ })
    .and(page.locator(':visible'))
    .first()
    .click();
  await page.getByLabel('Event name').fill(name);
  await page.getByRole('button', { name: /^Create/ }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
