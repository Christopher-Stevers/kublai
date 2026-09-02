import 'dotenv/config';
import { expect, test } from '@playwright/test';

const agentAuthSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

test.describe('offline job navigation', () => {
  test('opens an existing cached job and its material list from the dashboard while offline', async ({ page }) => {
    test.setTimeout(90_000);

    if (agentAuthSecret) {
      await page.context().addCookies([
        {
          name: 'foremenhq_agent_auth',
          value: agentAuthSecret,
          url: baseURL,
          sameSite: 'Lax',
        },
      ]);
    }

    await page.goto('/dashboard');
    if (page.url().includes('/sign-in')) {
      test.skip(true, 'Dashboard auth/dev bypass is not available for this Playwright run.');
    }
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('foremanhq.offline.jobs-list');
          if (!raw) return false;
          const jobs = JSON.parse(raw).data as Array<{ id: string; name: string }>;
          return jobs.length > 0;
        }),
      { timeout: 30_000 })
      .toBe(true);

    await page.evaluate(async () => {
      await navigator.serviceWorker?.ready;
      const cache = await caches.open('foremenhq-offline-shell-v6');
      await Promise.all(
        ['/dashboard', '/dashboard/jobs/__offline-shell__', '/dashboard/material-lists/__offline-shell__'].map(async (url) => {
          const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
          if (response.ok) await cache.put(url, response.clone());
        }),
      );
    });

    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const raw = window.localStorage.getItem('foremanhq.offline.jobs-list');
          if (!raw) return false;
          const jobs = JSON.parse(raw).data as Array<{ id: string; name: string }>;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('foremanhq-offline', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });

          for (const candidate of jobs.filter((item) => !item.id.startsWith('offline-job-'))) {
            const detailRaw = window.localStorage.getItem(`foremanhq.offline.job-detail:${candidate.id}`);
            if (!detailRaw) continue;
            const materialLists = JSON.parse(detailRaw).data?.materialLists as Array<{ id: string; name: string }> | undefined;
            const materialList = materialLists?.[0];
            if (!materialList) continue;

            const cachedList = window.localStorage.getItem(`foremanhq.offline.material-list:${materialList.id}`) ?? await new Promise<unknown>((resolve, reject) => {
              const tx = db.transaction('materialLists', 'readonly');
              const store = tx.objectStore('materialLists');
              const request = store.get(materialList.id);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            if (cachedList) return true;
          }
          return false;
        }),
      { timeout: 45_000 })
      .toBe(true);

    const { job, materialList } = await page.evaluate(async () => {
      const raw = window.localStorage.getItem('foremanhq.offline.jobs-list');
      if (!raw) throw new Error('No cached jobs list');
      const jobs = JSON.parse(raw).data as Array<{ id: string; name: string }>;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('foremanhq-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      for (const candidate of jobs.filter((item) => !item.id.startsWith('offline-job-'))) {
        const detailRaw = window.localStorage.getItem(`foremanhq.offline.job-detail:${candidate.id}`);
        if (!detailRaw) continue;
        const materialLists = JSON.parse(detailRaw).data?.materialLists as Array<{ id: string; name: string }> | undefined;
        const materialList = materialLists?.[0];
        if (!materialList) continue;

        const cachedList = window.localStorage.getItem(`foremanhq.offline.material-list:${materialList.id}`) ?? await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction('materialLists', 'readonly');
          const store = tx.objectStore('materialLists');
          const request = store.get(materialList.id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (cachedList) return { job: candidate, materialList };
      }
      throw new Error('No cached job with cached material list');
    });

    await page.context().setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });

    await page.getByText(job.name, { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: job.name })).toBeVisible({ timeout: 20_000 });
    await page.getByText('Material Lists', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Material Lists' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByText(materialList.name, { exact: true }).first().click();
    await page.waitForURL(new RegExp(`/dashboard/material-lists/${materialList.id}`));
    await expect(page.getByRole('heading', { name: materialList.name })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('internet disconnected', { exact: false })).toHaveCount(0);
  });
});
