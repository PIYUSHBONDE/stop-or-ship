import { test, expect } from '../support/staff-session';

test('restored guides, configuration and navigation retain the previous interface', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await expect(page.getByLabel('Plant simulation workspace')).toBeVisible();
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await page.screenshot({ path: '../.runtime/ui-restoration-plant.png' });
  await page.getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plant guide', exact: true })).toBeVisible();
  const guides = page.getByRole('list', { name: 'Plant machine guides' });
  await expect(guides.getByRole('listitem').first()).toBeVisible();
  await page.getByLabel('Search plant guides').fill('P-107');
  await expect(guides.getByRole('listitem')).toHaveCount(1);
  await guides.getByRole('listitem').click();
  await expect(page.getByRole('heading', { name: 'What can break', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What can be fixed', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'User guide', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Machine records', exact: true }).click();
  await expect(page).toHaveURL(/\/monitoring\/P-107$/);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Design your plant.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load plant configuration', exact: true }).click();
  await expect(page.getByText(/Configuration v\d+ loaded\./)).toBeVisible();
  await page.getByRole('link', { name: 'Plant', exact: true }).click();
  await expect(page.getByLabel('Plant simulation workspace')).toBeVisible();
  await expect(page.getByLabel('Operational case journey')).toHaveCount(0);
  await page.getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page.getByLabel('Simulation history')).toHaveCount(0);
  await page.setViewportSize({ width: 430, height: 950 });
  await page.screenshot({ path: '../.runtime/ui-restoration-memory-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('restored assistant UI sends compatible evidence context on both plant views', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  for (const synthetic of [true, false]) {
    await page.goto(synthetic ? '/plant' : '/plant?view=observations');
    await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
    await page
      .getByLabel('Question or editable transcript')
      .fill('Explain the available evidence.');
    const request = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
    await page.getByRole('button', { name: 'Send question', exact: true }).click();
    const body = (await request).postDataJSON();
    expect(!!body.simulation_context).toBe(synthetic);
    if (synthetic) expect(body.incident_id).toBeNull();
    await expect(
      page.getByText('Scripted summary · Gemini not connected', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  }
});

test('restored case pagination, expansion, collapse and machine links work', async ({ page }) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const key = `plantsense-simulation-v2:${plant}`;
  const backend = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).ledger.cases.length, key))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k)!);
    const original = saved.ledger.cases[0];
    saved.snapshot = { open: [], history: [] };
    saved.process.fault = null;
    saved.process.stage = 'running';
    saved.ledger.cases = Array.from({ length: 6 }, (_, i) => ({
      ...original,
      id: `ASN-UI-${i}`,
      occurredAt: original.occurredAt - i,
      interrupted: true,
    }));
    localStorage.setItem(k, JSON.stringify(saved));
  }, key);
  await page.goto('/incidents');
  const total = 6 + backend.incidents.length;
  await expect(page.getByText(`Showing 1–5 of ${total} cases`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText(new RegExp(`Showing 6–.* of ${total} cases`))).toBeVisible();
  await page.getByRole('button', { name: 'Show ASN-UI-5 details', exact: true }).click();
  await expect(page.getByLabel('ASN-UI-5 preview case')).toBeVisible();
  await page.getByRole('button', { name: 'Hide ASN-UI-5 details', exact: true }).click();
  await expect(page.getByLabel('ASN-UI-5 preview case')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show ASN-UI-5 details', exact: true }).click();
  await page.getByRole('link', { name: 'Machine records', exact: true }).click();
  await expect(page).toHaveURL(/\/monitoring\/P-107$/);
});
