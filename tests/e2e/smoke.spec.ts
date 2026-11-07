import { expect, test } from '@playwright/test';

test('homepage responds', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/127\.0\.0\.1:3000|localhost:3000/);
  await expect(page.locator('body')).toBeVisible();
});
