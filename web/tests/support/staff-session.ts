import { test as base, expect, type BrowserContext } from '@playwright/test';

type StaffWorkerFixtures = {
  staffStorageState: Awaited<ReturnType<BrowserContext['storageState']>>;
};

export const test = base.extend<object, StaffWorkerFixtures>({
  storageState: async ({ staffStorageState }, use) => {
    await use(staffStorageState);
  },
  staffStorageState: [
    async ({ browser }, use, workerInfo) => {
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
      let storageState: StaffWorkerFixtures['staffStorageState'];
      try {
        const page = await context.newPage();
        await page.goto('/');
        const accessResponse = await page.request.get('/api/v1/access/state');
        expect(accessResponse.status()).toBe(200);
        const access = await accessResponse.json();
        await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
        await page.getByLabel('Email', { exact: true }).fill('product-owner@example.test');
        await page.getByLabel('Password', { exact: true }).fill('testing-only strong passphrase!');
        const path = access.setup_required ? '/access/setup' : '/access/sign-in';
        const signedIn = page.waitForResponse(
          (response) => response.url().endsWith(path) && response.request().method() === 'POST',
        );
        await page
          .getByRole('button', {
            name: access.setup_required ? 'Get started' : 'Sign in',
            exact: true,
          })
          .click();
        const response = await signedIn;
        expect(response.status(), await response.text()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Welcome, Product Owner' })).toBeVisible();
        // Reuse authentication only; each test still receives its own browser context.
        storageState = await context.storageState();
      } finally {
        await context.close();
      }
      await use(storageState);
    },
    { scope: 'worker' },
  ],
});

export { expect };
