import { test, expect } from '../support/staff-session';
import { openPlantControls } from '../support/navigation';

test('2D readings stay above neighboring equipment cards', async ({ page }) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  const press = page.getByRole('button', { name: 'PR-101 Hydraulic press A', exact: true });
  await press.hover();
  await expect(press).toHaveAttribute('data-showing-readings', 'true');
  const above = await press.evaluate((node) => {
    const card = node.querySelector('div')!;
    const box = card.getBoundingClientRect();
    const front = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!front && node.contains(front);
  });
  expect(above).toBe(true);
});

test('Operators history uses the panel width and floor labels remain distinct at the same machine', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await openPlantControls(page);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const key = `plantsense-simulation-v2:${plant}`;
  await expect
    .poll(
      () =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) || '{}').snapshot?.open?.length || 0,
          key,
        ),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const fixture = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    const current = saved.snapshot.open[0];
    const extra = current.severity === 'critical' ? 30000 : current.severity === 'high' ? 15000 : 0;
    saved.process.elapsed = current.openedAt - saved.process.epoch + 25000 + 120000 + extra + 10000;
    saved.snapshot.history = Array.from({ length: 40 }, (_, index) => ({
      ...current,
      id: `ASN-floor-history-${index}`,
      openedAt: current.openedAt - (index + 1) * 300000,
    }));
    saved.advancedAt = Date.now();
    localStorage.setItem(key, JSON.stringify(saved));
    return { id: current.id, assetId: current.assetId, operatorId: current.operatorId };
  }, key);
  await page.goto(`/operators?assignment=${fixture.id}`);
  await page.reload();
  const floor = page.getByRole('region', { name: 'Simulated operator positions' });
  await expect(page.getByRole('status')).toContainText('Checking recovery');
  const labels = await floor.evaluate((element, fixture) => {
    const equipment = element
      .querySelector(`[data-floor-equipment-label="${fixture.assetId}"]`)!
      .getBoundingClientRect();
    const operator = element
      .querySelector(`[data-floor-operator-label="${fixture.operatorId}"]`)!
      .getBoundingClientRect();
    return {
      separated:
        equipment.bottom < operator.top ||
        operator.bottom < equipment.top ||
        equipment.right < operator.left ||
        operator.right < equipment.left,
    };
  }, fixture);
  expect(labels.separated).toBe(true);
  await floor.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await floor.screenshot({ path: '../.runtime/floor-detail-desktop-map.png' });
  const history = page.getByRole('region', { name: 'Recent simulated responses' });
  await history.locator('summary').click();
  await expect(history.getByRole('link')).toHaveCount(40);
  const panel = (await history.boundingBox())!;
  const row = (await history.getByRole('link').first().boundingBox())!;
  expect(row.width).toBeGreaterThan(panel.width * 0.85);
  await history.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await history.screenshot({ path: '../.runtime/floor-detail-desktop-history.png' });
  await page.setViewportSize({ width: 390, height: 900 });
  await floor.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await floor.screenshot({ path: '../.runtime/floor-detail-mobile-map.png' });
  await history.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await history.screenshot({ path: '../.runtime/floor-detail-mobile-history.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await history.getByRole('link').first().click();
  await expect(
    page.getByRole('heading', { name: 'Completed response', exact: true }),
  ).toBeVisible();
  await expect(history.getByRole('link').first()).toHaveAttribute('aria-current', 'true');
  await history.locator('summary').click();
  await expect(history.getByRole('link').first()).toBeHidden();
});

test('2D plan keeps readable equipment, selection, contained scrolling and a return to 3D', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await openPlantControls(page);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Close simulation controls', exact: true }).click();
  await page.getByRole('button', { name: 'Close machine inspector', exact: true }).click();
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  const plan = page.getByRole('region', { name: 'Accessible plant plan', exact: true });
  await expect(plan.getByRole('button')).toHaveCount(12);
  await expect(plan.getByText('Hydraulic pump A', { exact: true })).toBeVisible();
  await expect(plan.getByText('Utilities', { exact: true })).toBeVisible();
  const overlap = await plan.getByRole('button').evaluateAll((nodes) => {
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    return boxes.some((a, i) =>
      boxes
        .slice(i + 1)
        .some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
    );
  });
  expect(overlap).toBe(false);
  await page.screenshot({ path: '../.runtime/floor-detail-desktop-plan.png' });
  await page.setViewportSize({ width: 390, height: 900 });
  const pump = plan.getByRole('button', { name: 'P-207 Hydraulic pump B', exact: true });
  await pump.click();
  await expect(pump).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .getByLabel('Machine inspector', { exact: true })
      .getByRole('heading', { name: 'Hydraulic pump B', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close machine inspector', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(900);
  await page.screenshot({ path: '../.runtime/floor-detail-mobile-plan.png' });
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(plan).toHaveCount(0);
  expect(errors).toEqual([]);
});
