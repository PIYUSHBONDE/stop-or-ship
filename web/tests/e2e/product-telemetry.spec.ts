import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
const password = 'testing-only strong passphrase!';
const email = 'product-owner@example.test';

async function owner(page: Page) {
  await page.goto('/');
  const access = await (await page.request.get('/api/v1/access/state')).json();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', {
      name: access.setup_required ? 'Get started' : 'Sign in',
      exact: true,
    })
    .click();
  await expect(page.getByRole('heading', { name: 'Welcome, Product Owner' })).toBeVisible({
    timeout: 30000,
  });
  const signed = await (await page.request.get('/api/v1/access/state')).json();
  const plant = signed.plants[0].id as string;
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  return plant;
}

async function csvPreview(page: Page, csv: string) {
  await page.getByLabel('CSV contents').fill(csv);
  await page.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible();
}

test('staff access is required; no anonymous fallback', async ({ page }) => {
  const anonymous: string[] = [];
  page.on('request', (request) => {
    if (/local-identity|\/sessions/.test(request.url())) anonymous.push(request.url());
  });
  await page.goto('/plant');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open isolated demo' })).toHaveCount(0);
  expect(anonymous).toEqual([]);
});

test('expanded plant has unknown equipment and separate production measures', async ({ page }) => {
  const plant = await owner(page);
  const current = await (await page.request.get(`/api/v1/plants/${plant}/configuration`)).json();
  const template = await (
    await page.request.post(`/api/v1/plants/${plant}/configuration/template`, {
      data: { lines: 8, name: 'Expanded operational plant' },
    })
  ).json();
  const activated = await page.request.post(`/api/v1/plants/${plant}/configuration`, {
    data: { expected_version: current.version, configuration: template },
  });
  expect(activated.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole('button', { name: /Start scenario|Play replay|Reset demo/ }),
  ).toHaveCount(0);
  await expect(page.getByText('SIMULATED DEMO PLANT', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No data connected · Condition unknown')).toBeVisible();
  const state = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  expect(state.assets).toHaveLength(36);
  expect(state.assets.every((asset: { status: string }) => asset.status === 'unknown')).toBe(true);
  expect(state.measured_output_per_hour).toBeNull();
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await page.screenshot({ path: '../docs/artifacts/product-plant.png' });
  await expect(page.getByText(/measured parts\/h/)).toBeVisible();
  await expect(page.getByText(/parts\/h rated capacity/)).toBeVisible();
  await page.screenshot({ path: '../docs/artifacts/product-operations.png' });
});

test('reviewed historical import preserves provenance and cannot authorize', async ({ page }) => {
  const plant = await owner(page);
  await page.goto('/monitoring');
  await page.getByRole('button', { name: 'Add source' }).click();
  await page.getByLabel('Source name', { exact: true }).fill('Historical inspection dataset');
  await page.getByLabel('Equipment', { exact: true }).selectOption('P-107');
  await page.getByLabel('Evidence origin').selectOption('historical');
  await page.getByLabel('Dataset identity').fill('review-fixture');
  await page
    .getByLabel('Attribution', { exact: true })
    .fill('Explicitly authored acceptance values; not measured dataset readings');
  await page.getByRole('button', { name: 'Add required signal' }).click();
  await page.getByLabel('Lower limit').fill('130');
  await page.getByLabel('Upper limit').fill('180');
  await page.getByRole('button', { name: 'Save reviewed source' }).click();
  const card = page.getByRole('article', { name: 'P-107 telemetry source' });
  await expect(card.getByRole('heading', { name: 'Historical inspection dataset' })).toBeVisible();
  await card.getByRole('button', { name: 'Import observations' }).click();
  const csv =
    'asset_id,record_id,window_start,observed_at,signal_id,value,unit,std,p95\n' +
    [1, 2, 3].map((i) => `P-107,historical-${i},,,pressure,125,bar,,\n`).join('');
  await csvPreview(page, csv);
  const before = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  expect(before.incidents).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByText('3 windows accepted; 0 duplicate records skipped.')).toBeVisible();
  await expect(card.getByText('Historical dataset · historical')).toBeVisible();
  await card.getByRole('link', { name: 'Inspect incident' }).click();
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toHaveCount(0);
  await expect(page.getByText(/historical import · Historical or legacy evidence/)).toBeVisible();
  const open = page.getByRole('button', { name: 'P-107 source observations', exact: true }).first();
  await open.click();
  await expect(page.getByRole('dialog')).toContainText('125 bar');
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await page.goto('/monitoring');
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/artifacts/product-monitor-mobile.png' });
});

test('operational incident, dirty decisions, authorized repair and incoming recovery', async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const plant = await owner(page);
  const configuration = await (
    await page.request.get(`/api/v1/plants/${plant}/configuration`)
  ).json();
  const sourceResponse = await page.request.post(`/api/v1/plants/${plant}/sources`, {
    data: {
      expected_version: 0,
      plant_configuration_version: configuration.version,
      name: 'Operational acceptance source',
      asset_id: 'P-107',
      kind: 'operational',
      rules: [{ signal_id: 'pressure', unit: 'bar', lower: 130, upper: 180 }],
      procedure:
        'Explicitly reviewed acceptance procedure revision 1; personnel perform isolation.',
    },
  });
  expect(sourceResponse.ok()).toBeTruthy();
  const source = await sourceResponse.json();
  const origin = Date.now();
  const windows = [0, 1, 2].map((i) => {
    const end = origin - (2 - i) * 60000;
    return {
      record_id: `operational-fault-${i}`,
      window_start: new Date(end - 60000).toISOString(),
      observed_at: new Date(end).toISOString(),
      values: [{ signal_id: 'pressure', value: 190, unit: 'bar' }],
    };
  });
  const submitted = await page.request.post(
    `/api/v1/plants/${plant}/sources/${source.id}/observations`,
    {
      data: { expected_version: 1, windows },
      headers: { 'Idempotency-Key': 'browser-operational-fault' },
    },
  );
  expect(submitted.ok()).toBeTruthy();
  let snapshot = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  const incident = snapshot.incident;
  expect(incident.record_origin).toBe('plant_observation');
  await page.goto(`/incidents?incident=${incident.id}`);
  const approve = page.getByRole('button', { name: 'Approve selected intervention' });
  await expect(approve).toBeEnabled();
  const risk = page.getByLabel('Risk assumption multiplier');
  await risk.focus();
  await risk.press('Home');
  for (let index = 0; index < 7; index++) await risk.press('ArrowRight');
  await expect(approve).toBeDisabled();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Risk assumption multiplier')).toHaveValue('1');
  await page.getByRole('radio', { name: /Stop.*repair now/ }).check();
  await approve.click();
  await page.getByRole('link', { name: 'Open authorized work order' }).click();
  await expect(page).toHaveURL(/\/maintenance/);
  await expect(page.getByRole('heading', { name: 'Maintenance workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Start approved repair' }).click();
  await page.getByLabel('Observed root cause').fill('Valve bypass confirmed by inspection');
  await page.getByLabel('Repair performed').fill('Repaired and inspected the valve assembly');
  await page.getByLabel('Parts used').fill('Seal kit');
  await page
    .getByLabel('Observed outcome')
    .fill('Technician work complete; incoming observations pending');
  await expect(page.getByLabel('Post-repair telemetry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Complete repair & verify' }).click();
  await expect(page.getByText('0 / 3 consecutive healthy windows')).toBeVisible();
  snapshot = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  const completed = new Date(snapshot.incident.repair_completed_at).getTime();
  expect(snapshot.memory).toHaveLength(0);
  for (let i = 0; i < 3; i++) {
    const start = completed + 1000 + i * 60000;
    const end = start + 60000;
    await page.waitForTimeout(Math.max(0, end - Date.now() + 100));
    const result = await page.request.post(
      `/api/v1/plants/${plant}/sources/${source.id}/observations`,
      {
        data: {
          expected_version: 1,
          windows: [
            {
              record_id: `operational-recovery-${i}`,
              window_start: new Date(start).toISOString(),
              observed_at: new Date(end).toISOString(),
              values: [{ signal_id: 'pressure', value: 165, unit: 'bar' }],
            },
          ],
        },
        headers: { 'Idempotency-Key': `browser-recovery-${i}` },
      },
    );
    expect(result.ok()).toBeTruthy();
  }
  await expect(page.getByRole('heading', { name: 'Recovery verified' })).toBeVisible();
  await page.goto('/memory');
  await expect(page.getByText('VERIFIED FROM OPERATIONAL OBSERVATIONS')).toBeVisible();
  await expect(page.getByText('Valve bypass confirmed by inspection').first()).toBeVisible();
  await page.screenshot({ path: '../docs/artifacts/product-memory.png' });
  expect(errors).toEqual([]);
});

test('WebGL failure retains the plant plan and keyboard equipment access', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]) as RenderingContext | null;
    } as typeof original;
  });
  await owner(page);
  const plan = page.getByRole('region', { name: 'Accessible plant plan' });
  await expect(plan).toBeVisible();
  await expect(plan.getByRole('button')).toHaveCount(36);
  const equipment = plan.getByRole('button', { name: /CL-001/ });
  await equipment.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cooling unit', exact: true })).toBeVisible();
  await expect(page.getByText('No data connected · Condition unknown')).toBeVisible();
});
