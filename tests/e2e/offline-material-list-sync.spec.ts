import 'dotenv/config';
import { expect, test } from '@playwright/test';

const agentAuthSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET;

test.describe('offline material list sync', () => {
  test('keeps deleted rows hidden across offline navigation and syncs them on reconnect', async ({ page }) => {
    test.setTimeout(120_000);

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobName = `Offline Sync Job ${runId}`;
    const firstPart = '3 in ABS 22.5 Elbow';
    const secondPart = '3 in ABS 45 Elbow';

    const failedRequestsWhileOnline: string[] = [];
    let offlineMode = false;
    page.on('requestfailed', (request) => {
      if (offlineMode) return;
      const failure = request.failure()?.errorText ?? 'unknown failure';
      if (failure === 'net::ERR_ABORTED') return;
      failedRequestsWhileOnline.push(`${request.method()} ${request.url()} - ${failure}`);
    });

    if (agentAuthSecret) {
      await page.context().addCookies([
        {
          name: 'foremenhq_agent_auth',
          value: agentAuthSecret,
          url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
          sameSite: 'Lax',
        },
      ]);
    }

    await page.goto('/dashboard');
    if (page.url().includes('/sign-in')) {
      test.skip(true, 'Dashboard auth/dev bypass is not available for this Playwright run.');
    }
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Job' }).click();
    await page.getByLabel('Job Name *').fill(jobName);
    await page.getByRole('button', { name: 'Create Job' }).click();
    await page.waitForURL(/\/dashboard\/jobs\//);
    await expect(page.getByRole('heading', { name: jobName })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'New Material List' }).click();
    await page.waitForURL(/\/dashboard\/material-lists\//, { timeout: 20_000 });
    const materialListUrl = page.url();
    const materialListId = materialListUrl.split('/').pop();
    expect(materialListId).toBeTruthy();
    await expect(page.getByText(`Job: ${jobName}`)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Add Part/ }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Select Catalog');
    await page.getByText('Plumbing', { exact: true }).click();
    await page.getByText('ABS', { exact: true }).click();
    await page.getByText('3 in', { exact: true }).click();
    await page.getByText('Fittings', { exact: true }).click();
    await page.getByText(firstPart).click();
    await page.getByText(secondPart).click();
    await page.getByRole('button', { name: 'Review Parts', exact: true }).click();
    await page.getByRole('button', { name: /Add 2 Parts/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(firstPart)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(secondPart)).toBeVisible();

    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return !!registration.active;
    });

    offlineMode = true;
    await page.context().setOffline(true);
    await expect(page.getByText(/Offline/).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Remove item' }).first().click();
    await expect(page.getByText(firstPart)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/Pending sync|Syncing material list/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: `Job: ${jobName}` }).click();
    await page.waitForURL(/\/dashboard\/jobs\//);
    await expect(page.getByText('internet disconnected', { exact: false })).toHaveCount(0);
    await page.goto(materialListUrl);
    await expect(page.getByText(secondPart)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(firstPart)).toHaveCount(0);

    const queuedRemoveItem = await page.evaluate(async (targetMaterialListId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('foremanhq-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const queue = await new Promise<Array<{ type: string; materialListId: string }>>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const request = store.get('material-list-mutation-queue');
        request.onsuccess = () => resolve(request.result?.value ?? []);
        request.onerror = () => reject(request.error);
      });

      return queue.some(
        (mutation) =>
          mutation.type === 'removeItem' && mutation.materialListId === targetMaterialListId,
      );
    }, materialListId);
    expect(queuedRemoveItem).toBe(true);

    offlineMode = false;
    await page.context().setOffline(false);
    await expect(page.getByText(/Synced/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(firstPart)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(secondPart)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(firstPart)).toHaveCount(0);

    expect(failedRequestsWhileOnline, 'unexpected online request failures').toEqual([]);
  });
});
