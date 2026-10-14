import { test, expect } from '../support/staff-session';

test('simulation navigation, refresh and cross-tab ownership retain records', async ({
  page,
  context,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const key = `plantsense-simulation-v2:${plant}`;
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').tick || 0, key))
    .toBeGreaterThan(2);
  const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  await page.getByRole('link', { name: 'Operators', exact: true }).click();
  await expect(page.getByRole('link', { name: /^ASN-/ }).first()).toBeVisible();
  await page.getByRole('link', { name: /^ASN-/ }).first().click();
  await expect(page).toHaveURL(/assignment=ASN-/);
  const assignmentId = new URL(page.url()).searchParams.get('assignment');
  const assetId = await page.evaluate(
    ({ key, assignmentId }) =>
      JSON.parse(localStorage.getItem(key)!).snapshot.open.find(
        (a: { id: string }) => a.id === assignmentId,
      ).assetId,
    { key, assignmentId },
  );
  await expect(page.getByText('No operational dispatch connector is configured.')).toHaveCount(0);
  await page.getByRole('link', { name: 'Monitor', exact: true }).click();
  await page.getByRole('listitem', { name: `${assetId} preview records`, exact: true }).click();
  await expect(page).toHaveURL(/monitoring\//);
  await page.getByRole('link', { name: 'Open case', exact: true }).first().click();
  await expect(page.locator('[aria-label$="preview case"]')).toBeVisible();
  await page.getByRole('button', { name: /^Hide ASN-/ }).click();
  await expect(page.getByRole('button', { name: /^Show ASN-/ }).first()).toBeVisible();
  await page.reload();
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').tick || 0, key))
    .toBeGreaterThanOrEqual(before.tick);
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(after.seed).toBe(before.seed);
  expect(after.snapshot.open.map((a: { id: string }) => a.id)).toEqual(
    expect.arrayContaining(before.snapshot.open.map((a: { id: string }) => a.id)),
  );
  const follower = await context.newPage();
  await follower.goto('/monitoring');
  await expect(follower.getByRole('list', { name: 'Machine preview records' })).toBeVisible();
  await expect
    .poll(async () => {
      const locks = await follower.evaluate(() => navigator.locks.query());
      return locks.held?.filter((l) => l.name === key).length;
    })
    .toBe(1);
  await expect
    .poll(async () => {
      const locks = await follower.evaluate(() => navigator.locks.query());
      return locks.pending?.filter((l) => l.name === key).length;
    })
    .toBe(1);
  await page.close();
  await expect
    .poll(
      async () =>
        (await follower.evaluate(() => navigator.locks.query())).pending?.filter(
          (l) => l.name === key,
        ).length,
    )
    .toBe(0);
  await follower.close();
});

test('unavailable simulation storage keeps the app usable', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('plantsense-simulation') || key.startsWith('plantsense-preview-ledger'))
        throw new Error('Storage unavailable');
      return get.call(this, key);
    };
  });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await expect(page.getByText(/Simulation persistence unavailable or invalid/)).toBeVisible();
  await page.getByRole('link', { name: 'Monitor', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Machine preview records' })).toBeVisible();
});

test('invalid saved case metadata is preserved without breaking rendering', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const key = `plantsense-simulation-v2:${plant}`;
  await expect
    .poll(
      () =>
        page.evaluate(
          (k) => JSON.parse(localStorage.getItem(k) || '{}').ledger?.cases?.length || 0,
          key,
        ),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k)!);
    saved.ledger.cases[0].operatorName = {};
    localStorage.setItem(k, JSON.stringify(saved));
  }, key);
  await page.reload();
  await expect(page.getByText(/Simulation persistence unavailable or invalid/)).toBeVisible();
  await page.getByRole('link', { name: 'Monitor', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Machine preview records' })).toBeVisible();
  expect(
    await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)!).ledger.cases[0].operatorName,
      key,
    ),
  ).toEqual({});
  expect(errors).toEqual([]);
});
