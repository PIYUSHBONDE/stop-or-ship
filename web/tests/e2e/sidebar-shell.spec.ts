import { test, expect } from '../support/staff-session';
import {
  openNavigation,
  closeNavigation,
  navigate,
  openPlantControls,
} from '../support/navigation';

test('desktop sidebar replaces header/footer, expands without remounting Plant and retains controls', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  const plant = page.getByRole('region', { name: 'Plant simulation workspace', exact: true });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('header.topbar')).toHaveCount(0);
  await expect(plant.locator('footer')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Application navigation', exact: true });
  expect((await navigation.boundingBox())?.width).toBe(88);
  await page
    .locator('canvas')
    .evaluate((canvas) => canvas.setAttribute('data-retained-sidebar', 'true'));
  const machine = page
    .getByLabel('Machine inspector', { exact: true })
    .getByRole('heading', { level: 2 });
  const selected = await machine.textContent();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  expect((await navigation.boundingBox())?.width).toBe(232);
  expect((await page.locator('canvas').boundingBox())?.y).toBe(0);
  await expect(page.locator('canvas')).toHaveAttribute('data-retained-sidebar', 'true');
  expect(await machine.textContent()).toBe(selected);
  await page.screenshot({ path: '../.runtime/sidebar-desktop-expanded.png' });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await openPlantControls(page);
  await expect(
    page.getByRole('region', { name: 'Simulation controls', exact: true }),
  ).toBeFocused();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Reset scenario', exact: true }).click();
  await expect(
    page.getByRole('alertdialog', { name: 'Reset simulation', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('alertdialog', { name: 'Reset simulation', exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Simulation controls', exact: true })).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Simulation controls', exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: '../.runtime/sidebar-desktop-plant.png' });
  await navigate(page, 'Incidents');
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Human requests', exact: true })).toBeVisible();
  await page.screenshot({ path: '../.runtime/sidebar-desktop-records.png' });
});

test('mobile uses a left drawer with layered focus, usable requests and full-height Plant', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 430, height: 950 });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const floor = await page.locator('canvas').boundingBox();
  expect(floor?.y).toBe(0);
  expect(floor?.height).toBe(950);
  await expect(
    page.getByRole('navigation', { name: 'Application navigation', exact: true }),
  ).toHaveCount(0);
  await openNavigation(page);
  const drawer = page.getByRole('dialog', { name: 'PlantSense navigation', exact: true });
  await expect(drawer).toBeVisible();
  await page.getByRole('button', { name: /Data provenance:/ }).click();
  const disclosure = page.getByRole('region', { name: 'Data provenance', exact: true });
  await expect(disclosure).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(disclosure).toBeHidden();
  await expect(drawer).toBeVisible();
  await page.getByRole('button', { name: 'Human requests', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Human requests', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close requests', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Human requests', exact: true })).toBeFocused();
  await page.screenshot({ path: '../.runtime/sidebar-mobile-navigation.png' });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await openPlantControls(page);
  await expect(
    page.getByRole('region', { name: 'Simulation controls', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('1');
  await page.screenshot({ path: '../.runtime/sidebar-mobile-controls.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await navigate(page, 'Operators');
  await expect(page.getByRole('heading', { name: 'Operators', exact: true })).toBeVisible();
  await navigate(page, 'Plant');
  await closeNavigation(page);
  for (const width of [430, 360]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 430, height: 950 });
  await page.screenshot({ path: '../.runtime/sidebar-mobile-plant.png' });
  expect(errors).toEqual([]);
});
