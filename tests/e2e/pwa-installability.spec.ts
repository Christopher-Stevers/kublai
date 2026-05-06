import { expect, test } from '@playwright/test';

test.describe('PWA baseline', () => {
  test('exposes an installable manifest and service worker', async ({ page, request }) => {
    const manifestResponse = await request.get('/manifest.webmanifest');
    expect(manifestResponse.ok()).toBe(true);
    expect(manifestResponse.headers()['content-type']).toContain('manifest');

    const manifest = await manifestResponse.json();
    expect(manifest).toEqual(
      expect.objectContaining({
        name: 'ForemanHQ',
        short_name: 'ForemanHQ',
        start_url: '/dashboard',
        display: 'standalone',
      }),
    );
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', src: '/foremanhq/android-chrome-192x192.png' }),
        expect.objectContaining({ sizes: '512x512', src: '/foremanhq/android-chrome-512x512.png' }),
      ]),
    );

    const swResponse = await request.get('/sw.js');
    expect(swResponse.ok()).toBe(true);
    expect(await swResponse.text()).toContain('foremenhq-offline-shell-v6');

    await page.goto('/dashboard');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');
  });
});
