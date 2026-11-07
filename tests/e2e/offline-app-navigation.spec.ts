import 'dotenv/config';
import { expect, test } from '@playwright/test';

const agentAuthSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

const routes = [
  { path: '/jobs', text: 'Dashboard' },
  { path: '/jobs/catalogue', text: 'Catalogue' },
  { path: '/jobs/suppliers', text: 'Suppliers' },
  { path: '/jobs/quotes', text: 'Quotes' },
  { path: '/jobs/orders', text: 'Orders' },
  { path: '/jobs/account', text: /Account|Billing|Subscription|Manage/i },
];

test.describe('authenticated app offline shell', () => {
  test('loads dashboard app routes after authentication while offline', async ({ page }) => {
    test.setTimeout(120_000);

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

    await page.goto('/jobs');
    if (page.url().includes('/sign-in')) {
      test.skip(true, 'Dashboard auth/dev bypass is not available for this Playwright run.');
    }
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.evaluate(async () => {
      await navigator.serviceWorker?.ready;
      const cache = await caches.open('foremenhq-offline-shell-v6');
      await Promise.all(
        [
          '/jobs',
          '/jobs/catalogue',
          '/jobs/suppliers',
          '/jobs/quotes',
          '/jobs/orders',
          '/jobs/account',
          '/jobs/__offline-shell__',
          '/jobs/material-lists/__offline-shell__',
          '/manifest.webmanifest',
          '/foremanhq/android-chrome-192x192.png',
          '/foremanhq/android-chrome-512x512.png',
        ].map(async (url) => {
          const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
          if (response.ok) await cache.put(url, response.clone());
        }),
      );
    });

    await page.context().setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });

    for (const route of routes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      await expect(page.getByText(route.text).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('internet disconnected', { exact: false })).toHaveCount(0);
      await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
    }
  });
});
