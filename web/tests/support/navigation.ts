import { expect, type Page } from '@playwright/test';

export async function openNavigation(page: Page) {
  await expect(page.locator('#workspace-content')).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Application navigation', exact: true });
  // Wait for the responsive drawer to replace the desktop rail before inspecting its state.
  if ((page.viewportSize()?.width ?? Infinity) <= 760)
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  if (!(await navigation.isVisible()))
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(navigation).toBeVisible();
}

export async function closeNavigation(page: Page) {
  const close = page.getByRole('button', { name: 'Close navigation', exact: true });
  if (await close.isVisible()) await close.click();
}

export async function navigate(page: Page, name: string) {
  await openNavigation(page);
  await page.getByRole('link', { name, exact: true }).click();
}

export async function openPlantControls(page: Page) {
  const panel = page.getByRole('region', { name: 'Simulation controls', exact: true });
  if (!(await panel.isVisible())) {
    await openNavigation(page);
    await page.getByRole('button', { name: 'Simulation controls', exact: true }).click();
  }
  await expect(panel).toBeVisible();
}
