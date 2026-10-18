import { test, expect } from '../support/staff-session';
import {
  openPlantControls,
  openNavigation,
  closeNavigation,
  navigate,
} from '../support/navigation';

test('full-screen plant retains the live scene, overlays, controls and mobile navigation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await openPlantControls(page);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Close simulation controls', exact: true }).click();
  const retainedCanvas = await page.locator('canvas').evaluate((canvas) => {
    canvas.setAttribute('data-fullscreen-retained', 'true');
    return (canvas as HTMLCanvasElement).width;
  });
  expect(retainedCanvas).toBeGreaterThan(0);
  for (const [width, height] of [
    [1440, 1000],
    [1024, 768],
    [430, 950],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      const workspace = document
        .querySelector('[aria-label="Plant simulation workspace"]')!
        .getBoundingClientRect();
      return {
        width: innerWidth,
        overflow: document.documentElement.scrollWidth,
        height: innerHeight,
        scroll: document.documentElement.scrollHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        workspaceWidth: workspace.width,
        workspaceHeight: workspace.height,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(layout.width);
    expect(layout.scroll).toBeLessThanOrEqual(layout.height);
    expect(layout.canvasWidth).toBeGreaterThanOrEqual(layout.workspaceWidth - 2);
    expect(layout.canvasHeight).toBeGreaterThan(layout.workspaceHeight * 0.75);
    await expect(page.locator('canvas')).toHaveAttribute('data-fullscreen-retained', 'true');
  }
  await page.setViewportSize({ width: 430, height: 950 });
  await expect(page.getByLabel('Machine inspector', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Find equipment', exact: true }).click();
  await expect(page.getByLabel('Search equipment', { exact: true })).toBeFocused();
  await page.getByLabel('Search equipment', { exact: true }).fill('no matching asset');
  await expect(
    page.getByText('No matching equipment. Try another name or asset ID.'),
  ).toBeVisible();
  await page.getByLabel('Search equipment', { exact: true }).fill('P-107');
  await page
    .getByLabel('Equipment browser', { exact: true })
    .getByRole('button', { name: /Hydraulic pump A/ })
    .click();
  const inspector = page.getByLabel('Machine inspector', { exact: true });
  await expect(
    inspector.getByRole('heading', { name: 'Hydraulic pump A', exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByRole('heading', { name: 'Hydraulic pump A', exact: true }),
  ).toBeFocused();
  expect(
    await inspector
      .locator('strong small')
      .evaluateAll((units) =>
        units.every((unit) => getComputedStyle(unit).textTransform === 'none'),
      ),
  ).toBe(true);
  await expect(
    inspector.getByRole('link', { name: 'Full machine records', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close machine inspector', exact: true }).click();
  await openPlantControls(page);
  await expect(page.getByLabel('Scenario pump', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset scenario', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Reset simulation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog', { name: 'Reset simulation' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Close simulation controls', exact: true }).click();
  await page.getByRole('button', { name: 'Plant details', exact: true }).click();
  await expect(page.getByLabel('Production lines')).toBeVisible();
  await expect(page.getByLabel('Plant activity')).toBeVisible();
  await page.getByRole('button', { name: 'Close plant details', exact: true }).click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Account and connection', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Account and connection details', exact: true })
      .getByRole('link', { name: 'Staff and plant access', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close account menu', exact: true }).click();
  await closeNavigation(page);
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await expect(page.getByRole('button', { name: '2D plan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await navigate(page, 'Operators');
  await expect(page.getByRole('heading', { name: 'Operators', exact: true })).toBeVisible();
  await navigate(page, 'Plant');
  await openPlantControls(page);
  await expect(page.getByRole('button', { name: 'Resume simulation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close simulation controls', exact: true }).click();
  // Allow the remounted WebGL scene to finish its first rendered frames before visual capture.
  await page.waitForTimeout(750);
  await page.screenshot({ path: '../.runtime/plant-fullscreen-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: '../.runtime/plant-fullscreen-desktop.png' });
  await page.locator('canvas').dispatchEvent('webglcontextlost', { cancelable: true });
  await expect(page.getByRole('region', { name: 'Accessible plant plan' })).toBeVisible();
  expect(errors).toEqual([]);
});
