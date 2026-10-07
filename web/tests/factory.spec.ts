import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';

async function advance(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.getByRole('button', { name: 'Advance one telemetry window' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
  }
}

test('dedicated factory and cross-workspace approval, repair and memory', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your plant, in context.' })).toBeVisible();
  const browser = page.getByRole('complementary', { name: 'Select plant equipment' });
  await expect(browser.getByRole('button')).toHaveCount(12);
  await page.getByLabel('Search plant assets').fill('CL-001');
  await expect(browser.getByRole('button')).toHaveCount(1);
  await browser.getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Cooling unit', exact: true })).toBeVisible();
  await page.getByLabel('Search plant assets').fill('');
  await page.getByLabel('Graphics quality').selectOption('balanced');
  await page.getByLabel('Camera preset').selectOption('overview');
  await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await advance(page, 6);
  await expect(page.getByText('P-107 needs attention', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /inspect assumptions/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation').getByRole('link', { name: 'Incidents', exact: true }).click();
  await expect(page.getByText('INVESTIGATION SUMMARY', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare interventions' }).click();
  await page.getByRole('button', { name: 'Approve selected intervention' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Maintenance', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start approved repair' }).click();
  await page.getByLabel('Observed root cause').fill('Valve bypass');
  await page.getByLabel('Repair performed').fill('Reseated valve and replaced seal');
  await page.getByLabel('Parts used').fill('Bypass seal');
  await page.getByLabel('Observed outcome').fill('Independent pressure and flow checks restored');
  await page.getByRole('button', { name: 'Complete repair & verify' }).click();
  await expect(page.getByRole('heading', { name: 'Checking recovery' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await advance(page, 3);
  await page.getByRole('navigation').getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Valve bypass', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Valve bypass', exact: true })).toBeVisible();
  await page.screenshot({ path: '../docs/artifacts/memory-v2.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('WebGL fallback preserves equipment access and keyboard inspection', async ({ page }) => {
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
  await page.goto('/plant');
  await expect(page.getByRole('region', { name: 'Accessible plant plan' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Accessible plant plan' }).getByRole('button'),
  ).toHaveCount(12);
  const button = page
    .getByRole('complementary', { name: 'Select plant equipment' })
    .getByRole('button', { name: /CL-001/ });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cooling unit', exact: true })).toBeVisible();
});

test('mobile factory has an accessible equipment selector without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto('/plant');
  await expect(page.getByRole('heading', { name: 'Your plant, in context.' })).toBeVisible();
  await page.getByLabel('Select equipment', { exact: true }).selectOption('M-107');
  await expect(page.getByRole('heading', { name: 'Drive motor A', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/artifacts/mobile-plant-v2.png', fullPage: true });
});

test('selecting the 3D equipment surface uses the canonical asset ID', async ({ page }) => {
  await page.goto('/plant');
  await page.getByLabel('Graphics quality').selectOption('balanced');
  const canvas = page.getByLabel('Interactive 3D simulated manufacturing plant');
  await expect(canvas).toBeVisible();
  // Wait for instanced geometry to populate before testing its raycast event.
  await page.waitForTimeout(1500);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const camera = new PerspectiveCamera(42, bounds!.width / bounds!.height, 0.1, 150);
  camera.position.set(23, 22, 26);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const motor = new Vector3(-7.5, 0.95, -1).project(camera);
  await page.mouse.click(
    bounds!.x + ((motor.x + 1) / 2) * bounds!.width,
    bounds!.y + ((1 - motor.y) / 2) * bounds!.height,
  );
  await expect(page.getByRole('heading', { name: 'Drive motor A', exact: true })).toBeVisible();
});
