import { test, expect } from '@playwright/test';

test('home page mounts the app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveText('Seduh Score Next');
});
