import { test, expect } from '../support/staff-session';

test('connected plant follows pressure loss, line shutdown, repair and recovery without operational writes', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/workspace');
  const access = await (await page.request.get('/api/v1/access/state')).json();
  const plant = access.plants[0].id;
  const before = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await expect(page.getByLabel('Plant simulation workspace')).toBeVisible();
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  const nominal = before.areas.reduce(
    (n: number, a: { nominal_units_per_hour: number }) => n + a.nominal_units_per_hour,
    0,
  );
  await expect(page.getByLabel('Simulated production rate')).toContainText(String(nominal));
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  const inspector = page.getByLabel('Machine inspector');
  await expect(inspector.getByText('under repair', { exact: true })).toBeVisible({
    timeout: 12000,
  });
  const lines = page.getByLabel('Production lines').getByRole('button');
  await expect(lines.first()).toContainText('stopped');
  await expect(lines.nth(1)).toContainText('running');
  await page.screenshot({ path: '../.runtime/plant-process-repair.png' });
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const clock = await page.getByLabel('Simulation clock').textContent();
  const follower = await context.newPage();
  await follower.goto('/plant');
  await expect(
    follower.getByRole('button', { name: 'Resume simulation', exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByLabel('Simulation clock')).toHaveText(clock!);
  await follower.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeVisible();
  await follower.close();
  await expect(inspector.getByText('recovering', { exact: true })).toBeVisible({ timeout: 25000 });
  await expect(inspector.getByText('Recovered', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel('Simulated production rate')).toContainText(String(nominal));
  const after = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  expect(after.incidents).toEqual(before.incidents);
  expect(after.measured_output_per_hour).toEqual(before.measured_output_per_hour);
  expect(after.sources).toEqual(before.sources);
  await page.screenshot({ path: '../.runtime/plant-process-desktop.png' });
  await page.setViewportSize({ width: 430, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/plant-process-mobile.png' });
  expect(errors).toEqual([]);
});

test('reset retains cases, pauses survive refresh and subsequent faults get new IDs', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const key = `plantsense-simulation-v2:${plant}`;
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).ledger.cases.length, key))
    .toBeGreaterThan(0);
  const original = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!).ledger.cases[0].id,
    key,
  );
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const clock = await page.getByLabel('Simulation clock').textContent();
  await page.reload();
  await expect(page.getByLabel('Simulation clock')).toHaveText(clock!);
  await page.getByRole('button', { name: 'Reset scenario', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Reset simulation' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  expect(
    await page.evaluate(
      ({ key, id }) =>
        JSON.parse(localStorage.getItem(key)!).ledger.cases.find((c: { id: string }) => c.id === id)
          .interrupted,
      { key, id: original },
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).ledger.cases.length, key))
    .toBeGreaterThan(1);
  const ids = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!).ledger.cases.map((c: { id: string }) => c.id),
    key,
  );
  expect(new Set(ids).size).toBe(ids.length);
});
