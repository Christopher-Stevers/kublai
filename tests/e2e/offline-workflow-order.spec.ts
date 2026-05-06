import 'dotenv/config';
import { expect, test } from '@playwright/test';

const agentAuthSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

async function installAgentAuthCookie(page: import('@playwright/test').Page) {
  if (!agentAuthSecret) return;

  await page.context().addCookies([
    {
      name: 'foremenhq_agent_auth',
      value: agentAuthSecret,
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

async function waitForServiceWorker(page: import('@playwright/test').Page) {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return !!registration.active;
  });
}

test.describe('offline job → material list → order workflow', () => {
  test('creates a job/list, adds parts while offline, then syncs and generates an order without emailing', async ({ page }) => {
    test.setTimeout(150_000);

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobName = `Offline Order Job ${runId}`;
    const firstPart = '3 in ABS 22.5 Elbow';
    const secondPart = '3 in ABS 45 Elbow';
    const failedRequestsWhileOnline: string[] = [];
    const popupUrls: string[] = [];
    let offlineMode = false;

    page.on('requestfailed', (request) => {
      if (offlineMode) return;
      const failure = request.failure()?.errorText ?? 'unknown failure';
      if (failure === 'net::ERR_ABORTED') return;
      failedRequestsWhileOnline.push(`${request.method()} ${request.url()} - ${failure}`);
    });

    page.on('popup', (popup) => {
      popupUrls.push(popup.url());
    });

    await installAgentAuthCookie(page);

    await page.goto('/dashboard');
    if (page.url().includes('/sign-in')) {
      test.skip(true, 'Dashboard auth/dev bypass is not available for this Playwright run.');
    }
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const warmJobName = `Warm Cache Job ${runId}`;
    await page.getByRole('button', { name: 'Add Job' }).click();
    await page.getByLabel('Job Name *').fill(warmJobName);
    await page.getByRole('button', { name: 'Create Job' }).click();
    await page.waitForURL(/\/dashboard\/jobs\//);
    const warmJobUrl = page.url();
    await expect(page.getByRole('heading', { name: warmJobName })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'New Material List' }).first().click();
    await page.waitForURL(/\/dashboard\/material-lists\//, { timeout: 20_000 });
    const warmMaterialListUrl = page.url();
    await expect(page.getByText(`Job: ${warmJobName}`)).toBeVisible({ timeout: 20_000 });

    // Warm/cache the catalogue, supplier-part mappings, and app shell while online, then close the dialog.
    await page.getByRole('button', { name: /Add Part/ }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Select Catalog');
    await page.getByText('Plumbing', { exact: true }).click();
    await page.getByText('ABS', { exact: true }).click();
    await page.getByText('3 in', { exact: true }).click();
    await page.getByText('Fittings', { exact: true }).click();
    await page.getByText(firstPart).click();
    await page.getByText(secondPart).click();
    await page.getByRole('button', { name: 'Review Parts', exact: true }).click();
    await expect(page.getByRole('button', { name: /Add 2 Parts/ })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
    await waitForServiceWorker(page);
    await page.goto(warmJobUrl);
    await expect(page.getByRole('heading', { name: warmJobName })).toBeVisible({ timeout: 20_000 });
    await page.goto(warmMaterialListUrl);
    await expect(page.getByText(`Job: ${warmJobName}`)).toBeVisible({ timeout: 20_000 });

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    offlineMode = true;
    await page.context().setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByText(/Offline/).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add Job' }).click();
    await page.getByLabel('Job Name *').fill(jobName);
    await page.getByRole('button', { name: 'Create Job' }).click();
    await page.waitForURL(/\/dashboard\/jobs\/offline-job-/);
    await expect(page.getByRole('heading', { name: jobName })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'New Material List' }).first().click();
    await page.waitForURL(/\/dashboard\/material-lists\/offline-list-/);
    const materialListUrl = page.url();
    const materialListId = materialListUrl.split('/').pop();
    if (!materialListId) throw new Error(`Could not read material list id from ${materialListUrl}`);
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
    const cachedItemNamesAfterOfflineAdd = await page.evaluate(async (targetMaterialListId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('foremanhq-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction('materialLists', 'readonly');
        const store = tx.objectStore('materialLists');
        const request = store.get(targetMaterialListId);
        request.onsuccess = () =>
          resolve(
            (request.result?.value?.data?.items ?? []).map(
              (item: { descriptionSnapshot?: string | null }) => item.descriptionSnapshot ?? '',
            ),
          );
        request.onerror = () => reject(request.error);
      });
    }, materialListId);
    const queuedAddItemsAfterOfflineAdd = await page.evaluate(async (targetMaterialListId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('foremanhq-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise<Array<{ type: string; materialListId: string }>>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const request = store.get('material-list-mutation-queue');
        request.onsuccess = () => resolve(request.result?.value ?? []);
        request.onerror = () => reject(request.error);
      }).then((queue) => queue.filter((mutation) => mutation.materialListId === targetMaterialListId));
    }, materialListId);
    expect({ cachedItemNamesAfterOfflineAdd, queuedAddItemsAfterOfflineAdd }).toEqual({
      cachedItemNamesAfterOfflineAdd: expect.arrayContaining([
        expect.stringContaining(firstPart),
        expect.stringContaining(secondPart),
      ]),
      queuedAddItemsAfterOfflineAdd: expect.arrayContaining([
        expect.objectContaining({ type: 'addItem' }),
        expect.objectContaining({ type: 'addItem' }),
      ]),
    });
    await expect(page.getByText(/3 in ABS 22\.5 Elbow/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/3 in ABS 45 Elbow/)).toBeVisible();
    await expect(page.getByText(/Pending sync|Syncing material list/).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: `Job: ${jobName}` }).click();
    await page.waitForURL(/\/dashboard\/jobs\//);
    await expect(page.getByText('internet disconnected', { exact: false })).toHaveCount(0);
    await page.goBack();
    await page.waitForURL(/\/dashboard\/material-lists\//);
    await expect(page.getByText(/3 in ABS 22\.5 Elbow/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/3 in ABS 45 Elbow/)).toBeVisible();

    const queuedAddItems = await page.evaluate(async (targetMaterialListId) => {
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

      return queue.filter(
        (mutation) => mutation.type === 'addItem' && mutation.materialListId === targetMaterialListId,
      ).length;
    }, materialListId);
    expect(queuedAddItems).toBeGreaterThanOrEqual(2);

    offlineMode = false;
    await page.context().setOffline(false);
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByText(/Synced/).first()).toBeVisible({ timeout: 45_000 });
    await page.waitForURL((url) => /\/dashboard\/material-lists\//.test(url.pathname) && !url.pathname.includes('offline-list-'), { timeout: 20_000 });
    await page.reload();
    await expect(page.getByText(/3 in ABS 22\.5 Elbow/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/3 in ABS 45 Elbow/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Generate Order' }).click();
    await expect(page.getByRole('dialog')).toContainText('Existing Orders');
    await page.getByRole('button', { name: 'Generate New Order' }).click();
    await expect(page.getByRole('dialog')).toContainText(/Orders to Send \(1\)/, { timeout: 30_000 });
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Email Order' })).toBeVisible();

    // Do not click Email Order. This guards against accidental mailto/email side effects.
    expect(popupUrls.filter((url) => url.startsWith('mailto:'))).toEqual([]);
    expect(failedRequestsWhileOnline, 'unexpected failed network requests while online').toEqual([]);
  });
});
