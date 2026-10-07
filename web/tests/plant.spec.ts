import { test, expect, type Page } from '@playwright/test';

async function connect(page: Page) {
  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Plant overview' })).toBeVisible();
}
async function steps(page: Page, count: number) {
  for (let n = 0; n < count; n++) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/replay') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Advance one telemetry window' }).click();
    await response;
    await expect(page.getByRole('status')).toHaveCount(0);
  }
}
async function start(page: Page, scenario = 'pump_degradation') {
  await page.getByLabel('Demo scenario').selectOption(scenario);
  await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await steps(page, 6);
  await expect(page.getByText('INVESTIGATION SUMMARY', { exact: true })).toBeVisible();
}
async function complete(page: Page, failed = false) {
  await page.getByRole('button', { name: 'Compare interventions' }).click();
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve selected intervention' }).click();
  await expect(page.getByRole('button', { name: 'Start approved repair' })).toBeVisible();
  await page.getByRole('button', { name: 'Start approved repair' }).click();
  await page.getByLabel('Observed root cause').fill('Valve bypass');
  await page.getByLabel('Repair performed').fill('Reseated valve and replaced bypass seal');
  if (failed) await page.getByLabel('Post-repair telemetry').selectOption('failed');
  await page.getByRole('button', { name: 'Complete repair & verify' }).click();
  await expect(page.getByRole('heading', { name: 'Checking recovery' })).toBeVisible();
  await steps(page, 3);
}

test('whole plant, sources, accessible dialog and refresh persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await connect(page);
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Accessible plant plan' }).getByRole('button'),
  ).toHaveCount(12);
  await page.screenshot({ path: '../docs/artifacts/plant-overview.png', fullPage: true });
  await start(page);
  await page.getByRole('button', { name: 'Telemetry', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('INVESTIGATION SUMMARY', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../docs/artifacts/investigation.png', fullPage: true });
  expect(errors).toEqual([]);
});

for (let run = 1; run <= 5; run++)
  test(`complete incident-to-verified-memory run ${run}`, async ({ page }) => {
    await connect(page);
    await start(page);
    await complete(page);
    await expect(
      page.getByRole('heading', { name: 'Recovery verified', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'View confirmed repair' }).click();
    await expect(page.getByRole('heading', { name: 'Valve bypass', exact: true })).toBeVisible();
    if (run === 1) {
      await page.screenshot({ path: '../docs/artifacts/verified-memory.png', fullPage: true });
      await page.getByRole('button', { name: 'Replay a similar incident' }).click();
      await expect(page.getByRole('status')).toHaveCount(0);
      await page.getByRole('button', { name: 'Pause replay' }).click();
      await expect(page.getByRole('status')).toHaveCount(0);
      await steps(page, 6);
      await expect(
        page.getByRole('button', { name: 'Verified repair', exact: true }),
      ).toBeVisible();
    }
  });

test('sensor uncertainty abstains and unsuccessful repair stays unverified', async ({ page }) => {
  await connect(page);
  await start(page, 'sensor_uncertainty');
  await expect(
    page.getByText('Possible pressure instrumentation issue', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Independent pressure measurement and calibration check', { exact: true }),
  ).toBeVisible();
  await complete(page, true);
  await expect(page.getByRole('heading', { name: 'Checking recovery' })).toBeVisible();
  await page.getByRole('tab', { name: 'Memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge starts with proof' })).toBeVisible();
});

test('rejected proposal creates no work order and remains recoverable', async ({ page }) => {
  await connect(page);
  await start(page);
  await page.getByRole('tab', { name: 'Decision', exact: true }).click();
  await page.getByRole('button', { name: 'Reject proposal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen for review' })).toBeVisible();
  await page.getByRole('tab', { name: 'Work order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Human control, by design' })).toBeVisible();
  await page.getByRole('tab', { name: 'Decision', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen for review' }).click();
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toBeEnabled();
});

test('delayed polling cannot overwrite an approved intervention', async ({ page }) => {
  await connect(page);
  await start(page);
  await page.getByRole('button', { name: 'Compare interventions' }).click();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route('**/api/v1/sessions/*/advance', async (route) => {
    const response = await route.fetch();
    if (!intercepted) {
      intercepted = true;
      release();
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    await route.fulfill({ response });
  });
  await held;
  await page.getByRole('button', { name: 'Approve selected intervention' }).click();
  await expect(page.getByRole('button', { name: 'Start approved repair' })).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByRole('button', { name: 'Start approved repair' })).toBeVisible();
});

test('plant questions expose sources and reject cross-origin writes', async ({ page }) => {
  await connect(page);
  await page.getByLabel('Ask the plant', { exact: false }).fill('What is the flow measurement?');
  await page.getByRole('button', { name: 'Ask plant question' }).click();
  await expect(page.locator('.plant-answer')).toContainText('cycle-level replay measurements');
  await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  const denied = await page.request.post('/api/v1/local-identity', {
    headers: { Origin: 'https://foreign.example' },
  });
  expect(denied.status()).toBe(403);
  const oversized = await page.request.post('/api/v1/local-identity', { data: 'x'.repeat(65537) });
  expect(oversized.status()).toBe(413);
});
