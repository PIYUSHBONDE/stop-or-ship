import { test, expect, type Page } from '@playwright/test';
import type { State } from '@/lib/types';

const password = 'testing-only strong passphrase!';
const ownerEmail = 'browser-owner@example.test';

async function owner(page: Page) {
  await page.goto('/workspace');
  const status = await page.context().request.get('/api/v1/access/state');
  const access = await status.json();
  if (access.setup_required) {
    await page.getByLabel('Your name', { exact: true }).fill('Staff owner');
    await page.getByLabel('Organization name').fill('Browser acceptance organization');
    await page.getByLabel('Plant name', { exact: true }).fill('Shared acceptance plant');
  }
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', {
      name: access.setup_required ? 'Create plant workspace' : 'Sign in',
      exact: true,
    })
    .click();
  await expect(page.getByRole('heading', { name: 'Welcome, Staff owner' })).toBeVisible();
  const signedIn = await page.context().request.get('/api/v1/access/state');
  return (await signedIn.json()).plants[0].id as string;
}

async function step(page: Page, count: number) {
  for (let index = 0; index < count; index++) {
    await page.getByRole('button', { name: 'Advance one telemetry window' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
  }
}

async function source(page: Page, scenario: string) {
  await page.getByLabel('Demo scenario').selectOption(scenario);
  await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await step(page, 6);
}

test('shared plant: invitation, viewer restrictions, concurrent cases, approval and verified repair', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const plantId = await owner(page);
  const viewerEmail = `viewer-${Date.now()}@example.test`;
  await page.getByLabel('Staff email').fill(viewerEmail);
  await page.getByLabel('Invitation role').selectOption('viewer');
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const inviteLink = await page.getByLabel('Invitation link').inputValue();
  const viewerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 430, height: 900 },
  });
  try {
    const viewer = await viewerContext.newPage();
    await viewer.goto(inviteLink);
    await viewer.getByLabel('Your name', { exact: true }).fill('Review operator');
    await viewer.getByLabel('Email', { exact: true }).fill(viewerEmail);
    await viewer.getByLabel('Password', { exact: true }).fill(password);
    await viewer.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: 'Welcome, Review operator' })).toBeVisible();
    const cookie = (await viewerContext.cookies()).find(
      (entry) => entry.name === 'plantsense_staff',
    );
    expect(cookie?.httpOnly).toBe(true);
    await viewer.screenshot({ path: 'test-results/shared-access-mobile.png', fullPage: true });
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      430,
    );

    await page.getByRole('button', { name: 'Open plant', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your plant, in context.' })).toBeVisible();
    await source(page, 'pump_degradation');
    const firstResponse = await page.context().request.get(`/api/v1/plants/${plantId}/snapshot`);
    const first = ((await firstResponse.json()) as State).incident!;
    await source(page, 'cooler_degradation');
    const bothResponse = await page.context().request.get(`/api/v1/plants/${plantId}/snapshot`);
    const both = (await bothResponse.json()) as State;
    expect(both.incidents.filter((item) => item.state !== 'resolved')).toHaveLength(2);

    await viewer.getByRole('button', { name: 'Open plant', exact: true }).click();
    await expect(
      viewer.getByRole('button', { name: 'Start scenario', exact: true }),
    ).toBeDisabled();
    await viewer.goto(`/incidents?incident=${first.id}`);
    await expect(viewer.getByText('INVESTIGATION SUMMARY', { exact: true })).toBeVisible();
    await expect(
      viewer.getByRole('button', { name: 'Approve selected intervention', exact: true }),
    ).toBeDisabled();
    const forged = await viewerContext.request.post(`/api/v1/plants/${plantId}/approve`, {
      data: { option_id: 'stop', calculation_version: first.calculation_version },
      headers: { 'X-Incident-ID': first.id, 'Idempotency-Key': 'viewer-forged-approval' },
    });
    expect(forged.status()).toBe(403);

    await page.goto(`/incidents?incident=${first.id}`);
    await expect(page.getByLabel('Approver')).toHaveValue('Staff owner');
    await expect(page.getByLabel('Approver')).toHaveAttribute('readonly', '');
    await page.reload();
    await expect(page.getByLabel('Approver')).toHaveValue('Staff owner');
    await expect(page).toHaveURL(new RegExp(first.id));
    await page.getByText('Calculation assumptions and sensitivity', { exact: true }).click();
    await expect(page.getByText('Total affected rated capacity', { exact: true })).toBeVisible();
    await expect(
      page
        .locator('dt')
        .filter({ hasText: /^Degraded output per affected line$/ })
        .locator('+ dd'),
    ).toHaveText('60 %');
    await expect(
      page
        .locator('dt')
        .filter({ hasText: /^Delivery target across affected lines$/ })
        .locator('+ dd'),
    ).toHaveText('650 parts');
    await page.getByRole('button', { name: 'Approve selected intervention', exact: true }).click();
    await page.getByRole('link', { name: 'Open authorized work order' }).click();
    await page.getByRole('button', { name: 'Start approved repair' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    await viewer.goto(`/maintenance?incident=${first.id}`);
    await expect(viewer.getByLabel('Observed root cause')).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Complete repair & verify' })).toBeDisabled();
    await page.getByLabel('Observed root cause').fill('Valve bypass');
    await page
      .getByLabel('Repair performed')
      .fill('Reseated the bypass valve and replaced its seal');
    await page.getByLabel('Parts used').fill('Reviewed seal kit');
    await page.getByLabel('Observed outcome').fill('Independent flow and pressure checks restored');
    await page.getByRole('button', { name: 'Complete repair & verify' }).click();
    await expect(page.getByRole('heading', { name: 'Checking recovery' })).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(first.id));
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    await step(page, 3);
    await page.getByRole('navigation').getByRole('link', { name: 'Memory', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Valve bypass', exact: true }).first(),
    ).toBeVisible();
    await page.goto('/workspace');
    await page.getByRole('button', { name: 'Refresh audit history' }).click();
    await expect(page.getByText('decision.approved', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/shared-audit.png', fullPage: true });
    // Complete the other acceptance case so a successful repeat has no open asset conflict.
    const cooler = both.incidents.find(
      (item) => item.asset_id === 'CL-001' && item.state !== 'resolved',
    )!;
    expect(cooler).toBeDefined();
    const headers = { 'X-Incident-ID': cooler.id };
    const base = `/api/v1/plants/${plantId}`;
    expect(
      (
        await page.context().request.post(base + '/approve', {
          data: { option_id: 'stop', calculation_version: cooler.calculation_version },
          headers: { ...headers, 'Idempotency-Key': 'browser-cooler-' + cooler.id },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await page.context().request.post(base + '/repair/start', { data: {}, headers })).status(),
    ).toBe(200);
    expect(
      (
        await page.context().request.post(base + '/repair/complete', {
          data: {
            observed_cause: 'Cooling circuit fouling',
            fix: 'Cleaned cooler and checked circulation',
            parts: 'Reviewed cooler service kit',
            outcome: 'Temperature and efficiency restored',
            recovery: 'healthy',
          },
          headers,
        })
      ).status(),
    ).toBe(200);
    for (let index = 0; index < 3; index++)
      expect(
        (
          await page.context().request.post(base + '/replay', { data: { action: 'step' }, headers })
        ).status(),
      ).toBe(200);
    expect(errors).toEqual([]);
  } finally {
    await viewerContext.close();
  }
});

test('staff sign-in supports keyboard navigation and session logout', async ({ page }) => {
  await owner(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in', exact: true })).toBeVisible();
  const email = page.getByLabel('Email', { exact: true });
  await email.fill('');
  await email.focus();
  await page.keyboard.type(ownerEmail);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Welcome, Staff owner' })).toBeVisible();
});

test('plant configuration: reviewed eight-line template, scalable plan and mobile editor', async ({
  page,
}) => {
  test.setTimeout(180000);
  const plantId = await owner(page);
  const originalResponse = await page
    .context()
    .request.get(`/api/v1/plants/${plantId}/configuration`);
  const original = await originalResponse.json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Design your plant.' })).toBeVisible();
  await page.getByRole('button', { name: 'Load plant configuration', exact: true }).click();
  await expect(page.getByLabel('Plant name', { exact: true })).toBeVisible();
  await page
    .getByLabel('Plant name', { exact: true })
    .fill(
      original.configuration.name === 'Hydraulic manufacturing works'
        ? 'Narmada hydraulic works'
        : 'Hydraulic manufacturing works',
    );
  await page.getByLabel('Hydraulic template').selectOption('8');
  await page.getByRole('button', { name: 'Preview template', exact: true }).click();
  await expect(page.getByLabel('P-807 name')).toBeVisible();
  await expect(page.getByText('Unapplied draft', { exact: true })).toBeVisible();
  const before = await page.context().request.get(`/api/v1/plants/${plantId}/snapshot`);
  expect((await before.json()).assets).toHaveLength(original.configuration.assets.length);
  await page.getByLabel('P-807 name').fill('Hydraulic pump H - assembly');
  await page.getByRole('button', { name: 'Apply configuration', exact: true }).click();
  await expect(page.getByText(/applied. The factory now uses 36 assets/)).toBeVisible();
  await page.getByRole('link', { name: 'Open factory', exact: true }).click();
  await expect(
    page.getByText('8 forming lines. Shared services. Every dependency visible.'),
  ).toBeVisible();
  await expect(page.getByLabel('Camera preset').locator('option')).toHaveCount(12);
  await expect(
    page.locator('canvas[aria-label="Interactive 3D simulated manufacturing plant"]'),
  ).toBeVisible();
  await page.waitForTimeout(1500); // Allow the procedural scene to render before visual review.
  await page.screenshot({ path: 'test-results/configurable-plant-3d.png', fullPage: true });
  await page.getByLabel('Telemetry equipment').selectOption('P-807');
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  const plan = page.getByRole('region', { name: 'Accessible plant plan' });
  await expect(plan.locator('svg')).toHaveAttribute('preserveAspectRatio', 'none');
  await expect(plan.getByRole('button')).toHaveCount(36);
  await plan
    .getByRole('button', { name: 'P-807 Hydraulic pump H - assembly', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Hydraulic pump H - assembly', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/configurable-plant-plan.png', fullPage: true });
  await page.reload();
  await expect(
    page.getByText('8 forming lines. Shared services. Every dependency visible.'),
  ).toBeVisible();
  const cases = await page.context().request.get(`/api/v1/plants/${plantId}/snapshot`);
  const historicalCooling = ((await cases.json()) as State).incidents
    .slice()
    .reverse()
    .find((incident) => incident.asset_id === 'CL-001' && incident.state === 'resolved');
  if (historicalCooling) {
    await page.goto(`/incidents?incident=${historicalCooling.id}`);
    await expect(
      page.getByText(
        `Plant configuration v${historicalCooling.plant_configuration_version} · recorded incident context`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /dependency branch/ })).toHaveCount(
      historicalCooling.plant_context?.dependencies.filter((edge) => edge.source === 'CL-001')
        .length || 2,
    );
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
  await page.setViewportSize({ width: 430, height: 900 });
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  const mobilePlan = page.getByRole('region', { name: 'Accessible plant plan' });
  await expect(mobilePlan.getByRole('button')).toHaveCount(36);
  await mobilePlan
    .getByRole('button', { name: 'P-807 Hydraulic pump H - assembly', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Hydraulic pump H - assembly', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  const toolbar = await page.locator('.camera-toolbar').boundingBox();
  const inspector = await page.locator('.factory-inspector').boundingBox();
  const console = await page.locator('.factory-console').boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(inspector!.y);
  expect(inspector!.y + inspector!.height).toBeLessThanOrEqual(console!.y);
  await page.screenshot({
    path: 'test-results/configurable-plant-mobile-plan.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Load plant configuration', exact: true }).click();
  await page.setViewportSize({ width: 430, height: 900 });
  await page.getByLabel('P-807 name').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await page.screenshot({ path: 'test-results/plant-configuration-mobile.png', fullPage: true });
  await page.getByText('Advanced configuration JSON', { exact: true }).click();
  await page.getByLabel('Advanced plant configuration JSON').fill('{"name":"malformed"}');
  await page.getByRole('button', { name: 'Use JSON draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Field required' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Apply configuration', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  // Restore this acceptance workspace so existing workflow tests remain repeatable.
  const current = await page.context().request.get(`/api/v1/plants/${plantId}/configuration`);
  const restored = await page.context().request.post(`/api/v1/plants/${plantId}/configuration`, {
    data: {
      expected_version: (await current.json()).version,
      configuration: original.configuration,
    },
  });
  expect(restored.status()).toBe(200);
  if (historicalCooling) {
    // Keep request interception after the real navigation/editor workflow, since routing disables cache.
    const snapshotPattern = `**/api/v1/plants/${plantId}/snapshot?incident=${historicalCooling.id}`;
    await page.route(snapshotPattern, async (route) => {
      const response = await route.fetch();
      const fixture = (await response.json()) as State;
      for (const incident of [fixture.incident, ...fixture.incidents]) {
        if (incident?.id === historicalCooling.id)
          incident.plant_context?.dependencies.push({
            source: 'P-207',
            target: 'PR-101',
            relationship: 'shared hydraulic supply',
            capacity_fraction: 1,
          });
      }
      await route.fulfill({ response, json: fixture });
    });
    await page.goto(`/incidents?incident=${historicalCooling.id}`);
    await expect(page.getByText(/downstream path shown above/)).toHaveCount(1);
    await page.unrouteAll({ behavior: 'wait' });
  }
  expect(errors).toEqual([]);
});
