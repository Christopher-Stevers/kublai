import { expect, test } from '@playwright/test';

test('catalog inline add selects existing Plumbing and returns to dropdown mode', async ({ page }) => {
  await page.goto('/dashboard/catalogue');

  await page.getByRole('button', { name: 'Create Part', exact: true }).click();
  await page.getByText('+ Add', { exact: true }).nth(0).click();

  const newCatalogInput = page.getByPlaceholder('New catalog name');
  await expect(newCatalogInput).toBeVisible();

  await newCatalogInput.fill('Plumbing');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(newCatalogInput).toBeHidden();
  await expect(page.getByRole('button', { name: 'Plumbing', exact: true })).toBeVisible();
});
