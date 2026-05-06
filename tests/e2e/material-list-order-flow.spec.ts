import 'dotenv/config';
import { expect, test } from '@playwright/test';

const agentAuthSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

test.describe('material list ordering flow', () => {
  test('creates a job, creates a material list, adds parts, and generates an order', async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobName = `E2E Flow Job ${runId}`;
    let materialListUrl = '';
    const slowSteps: Array<{ name: string; ms: number }> = [];
    const failedRequests: string[] = [];
    const consoleErrors: string[] = [];
    const requestStartedAt = new Map<string, number>();
    const slowResponses: Array<{ url: string; ms: number; status: number }> = [];

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

    const recordStep = async (name: string, action: () => Promise<void>, slowAfterMs = 2_500) => {
      const startedAt = Date.now();
      await action();
      const ms = Date.now() - startedAt;
      if (ms > slowAfterMs) {
        slowSteps.push({ name, ms });
      }
    };

    page.on('request', (request) => {
      requestStartedAt.set(request.url(), Date.now());
    });

    page.on('response', (response) => {
      const startedAt = requestStartedAt.get(response.url());
      if (!startedAt) return;
      const ms = Date.now() - startedAt;
      if (response.url().includes('/api/trpc') && ms > 2_500) {
        slowResponses.push({
          url: response.url().replace(/\?.*/, ''),
          ms,
          status: response.status(),
        });
      }
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown failure';
      // Browser navigations can abort batched tRPC requests during expected route changes.
      if (failure === 'net::ERR_ABORTED') return;
      failedRequests.push(`${request.method()} ${request.url()} - ${failure}`);
    });

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Background cache warmups can be aborted by route changes in this flow.
      if (text.includes('TRPCClientError: Failed to fetch')) return;
      if (text.includes('TRPCClientError: network error')) return;
      if (text.includes('Failed to sync cached job detail')) return;
      consoleErrors.push(text);
    });

    await recordStep('open dashboard', async () => {
      await page.goto('/dashboard');
      if (page.url().includes('/sign-in')) {
        test.skip(true, 'Dashboard auth/dev bypass is not available for this Playwright run.');
      }
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });

    await recordStep('create job', async () => {
      await page.getByRole('button', { name: 'Add Job' }).click();
      await page.getByLabel('Job Name *').fill(jobName);
      await page.getByRole('button', { name: 'Create Job' }).click();
      await page.waitForURL(/\/dashboard\/jobs\//);
    });

    await recordStep('create exactly one material list', async () => {
      await expect(page.getByRole('heading', { name: jobName })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'New Material List' }).first().click();
      await page.waitForURL(/\/dashboard\/material-lists\//, { timeout: 20_000 });
      await expect(page.getByText(`Job: ${jobName}`)).toBeVisible({ timeout: 20_000 });
      materialListUrl = page.url();

      await page.getByRole('button', { name: `Job: ${jobName}` }).click();
      await page.waitForURL(/\/dashboard\/jobs\//);
      await expect(page.getByText('0 items')).toHaveCount(1, { timeout: 10_000 });

      await page.goto(materialListUrl);
      await expect(page.getByText(`Job: ${jobName}`)).toBeVisible({ timeout: 20_000 });
    }, 5_000);

    await recordStep('open add-parts dialog', async () => {
      await page.getByRole('button', { name: /Add Part/ }).first().click();
      await expect(page.getByRole('dialog')).toContainText('Select Catalog');
    });

    await recordStep('choose part filters', async () => {
      await page.getByText('Plumbing', { exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Select Material');
      await page.getByText('ABS', { exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Select Size');
      await page.getByText('3 in', { exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Select Category');
      await page.getByText('Fittings', { exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Select Parts');
    });

    const firstPart = '3 in ABS 22.5 Elbow';
    const secondPart = '3 in ABS 45 Elbow';

    await recordStep('select parts and open review', async () => {
      await page.getByText(firstPart).click();
      await page.getByText(secondPart).click();
      await expect(page.getByRole('button', { name: 'Review Parts', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Review Parts', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Review Parts');
      await expect(page.getByRole('button', { name: /Add 2 Parts/ })).toBeEnabled({ timeout: 10_000 });
    });

    await recordStep('add reviewed parts to material list', async () => {
      await page.getByRole('button', { name: /Add 2 Parts/ }).click();
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
      await expect(page.getByText(firstPart)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(secondPart)).toBeVisible();
    }, 5_000);

    await recordStep('generate order', async () => {
      await page.getByRole('button', { name: 'Generate Order' }).click();
      await expect(page.getByRole('dialog')).toContainText('Existing Orders');
      await page.getByRole('button', { name: 'Generate New Order' }).click();
      await expect(page.getByRole('dialog')).toContainText(/Orders to Send \(1\)/, { timeout: 20_000 });
      await expect(page.getByRole('dialog')).toContainText('Noble');
      await expect(page.getByRole('button', { name: 'Email Order' })).toBeVisible();
    }, 5_000);

    const notes = [
      `Job: ${jobName}`,
      `Slow UI steps (> threshold): ${JSON.stringify(slowSteps)}`,
      `Slow tRPC responses (>2500ms): ${JSON.stringify(slowResponses)}`,
      `Failed requests: ${JSON.stringify(failedRequests)}`,
      `Console errors: ${JSON.stringify(consoleErrors)}`,
    ].join('\n');

    await testInfo.attach('flow-observations.txt', {
      body: notes,
      contentType: 'text/plain',
    });

    expect(failedRequests, 'unexpected failed network requests').toEqual([]);
    expect(consoleErrors, 'unexpected console errors').toEqual([]);
  });
});
