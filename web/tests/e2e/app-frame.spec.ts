import { test, expect } from '../support/staff-session';
import {
  openPlantControls,
  openNavigation,
  closeNavigation,
  navigate,
} from '../support/navigation';

test('floating chat keeps desktop plant controls usable and preserves tab-local history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await openPlantControls(page);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const canvasBefore = await page.locator('canvas').boundingBox();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Ask PlantSense', exact: true });
  await expect(chat).toBeVisible();
  await expect(page.getByLabel('Question or editable transcript')).toBeFocused();
  expect(await page.locator('canvas').boundingBox()).toEqual(canvasBefore);
  await page.getByRole('button', { name: 'Find equipment', exact: true }).click();
  await page.getByLabel('Search equipment', { exact: true }).fill('P-207');
  await page
    .getByLabel('Equipment browser', { exact: true })
    .getByRole('button', { name: /Hydraulic pump B/ })
    .click();
  await expect(chat).toBeVisible();
  await expect(chat.getByText(/P-207/).first()).toBeVisible();
  await page.getByLabel('Question or editable transcript').fill('Explain the selected equipment.');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(chat.getByText('Read-only · Scripted provider', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
  await expect(page.locator('#assistant-history')).toContainText('Explain the selected equipment.');
  await page.locator('#assistant-history').getByRole('button').click();
  await expect(page.locator('#assistant-history')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ask PlantSense', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(chat.getByText('Explain the selected equipment.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../.runtime/frame-desktop-chat.png' });
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.screenshot({ path: '../.runtime/frame-desktop-closed.png' });
  expect(errors).toEqual([]);
});

test('provenance, account and active navigation remain correct across desktop and mobile routes', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByRole('button', { name: /Data provenance:/ }).click();
  const provenance = page.getByRole('region', { name: 'Data provenance', exact: true });
  await expect(provenance).toContainText('Simulation cannot authorize work');
  await page.keyboard.press('Escape');
  await expect(provenance).toBeHidden();
  await page.getByRole('button', { name: 'Account and connection', exact: true }).click();
  const account = page.getByRole('region', { name: 'Account and connection details', exact: true });
  await expect(account).toContainText('API connected');
  await expect(
    account.getByRole('link', { name: 'Staff and plant access', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close account menu', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  for (const [destination, route] of [
    ['Operators', '/operators'],
    ['Monitor', '/monitoring'],
    ['Incidents', '/incidents'],
    ['Memory', '/memory'],
    ['Setup', '/plant-setup'],
    ['Plant', '/plant'],
  ]) {
    await navigate(page, destination);
    await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}(\\?.*)?$`));
    await expect(
      page
        .getByRole('navigation', { name: 'Application navigation' })
        .locator('[aria-current="page"]'),
    ).toHaveCount(0);
    await openNavigation(page);
    await expect(
      page
        .getByRole('navigation', { name: 'Application navigation' })
        .locator('[aria-current="page"]'),
    ).toHaveCount(1);
    await expect(page.getByRole('link', { name: destination, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await closeNavigation(page);
  }
  await openNavigation(page);
  await page.getByRole('button', { name: 'Account and connection', exact: true }).click();
  await expect(
    account.getByRole('link', { name: 'Staff and plant access', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close account menu', exact: true }).click();
  await page.getByRole('button', { name: /Data provenance:/ }).click();
  await expect(provenance).toBeVisible();
  await page.getByRole('button', { name: 'Close data provenance', exact: true }).click();
  await closeNavigation(page);
  await page.setViewportSize({ width: 430, height: 950 });
  await page.screenshot({ path: '../.runtime/frame-mobile-closed.png' });
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(page.getByLabel('Question or editable transcript')).toBeFocused();
  const chat = page.getByRole('dialog', { name: 'Ask PlantSense', exact: true });
  await expect(chat).toBeVisible();
  await page.screenshot({ path: '../.runtime/frame-mobile-chat.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ask PlantSense', exact: true })).toBeFocused();
  await page.route('**/api/v1/plants/*/snapshot*', (route) => route.abort());
  await openNavigation(page);
  const unavailable = page.getByRole('button', {
    name: 'Data provenance: Operational status unavailable',
    exact: true,
  });
  await expect(unavailable).toBeVisible({ timeout: 10000 });
  await unavailable.click();
  await expect(provenance).toContainText('Current operational status cannot be confirmed');
  await page.getByRole('button', { name: 'Close data provenance', exact: true }).click();
  await page.unroute('**/api/v1/plants/*/snapshot*');
});
