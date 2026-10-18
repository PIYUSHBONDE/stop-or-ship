import { test, expect } from '../support/staff-session';
import { openPlantControls } from '../support/navigation';

test('Operators gives the active simulated response priority on desktop and mobile', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await openPlantControls(page);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  await page.goto('/operators');

  const response = page.getByRole('region', { name: 'Simulated response', exact: true });
  await expect(response.getByRole('heading', { name: 'Active response' })).toBeVisible({
    timeout: 20000,
  });
  await expect(response.getByRole('status')).toContainText('ASN-');
  await expect(response.getByRole('list', { name: 'Response phases' }).locator('li')).toHaveCount(
    6,
  );
  await expect(response.getByText('Synthetic reference')).toBeVisible();
  await expect(page.getByText('no staff are dispatched.')).toBeVisible();

  const roster = page.getByRole('region', { name: 'Operator roster' });
  await expect(roster.locator('a')).toHaveCount(1);
  await roster.locator('a').click();
  await expect(page).toHaveURL(/\/operators\?assignment=ASN-/);
  await expect(page.getByRole('region', { name: 'Simulated operator positions' })).toBeVisible();

  await page.setViewportSize({ width: 430, height: 950 });
  await expect(response).toBeVisible();
  await expect(roster).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
    responseTop: document
      .querySelector('[aria-label="Simulated response"]')
      ?.getBoundingClientRect().top,
    rosterTop: document.querySelector('[aria-label="Operator roster"]')?.getBoundingClientRect()
      .top,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  expect(layout.responseTop).toBeLessThan(layout.rosterTop!);

  await response.getByRole('link', { name: /See .* in Plant/ }).click();
  await expect(page).toHaveURL(/\/plant$/);

  await page.goto('/operators');
  const history = page.getByRole('region', { name: 'Recent simulated responses' });
  await expect(history.locator('summary')).toBeVisible({ timeout: 40000 });
  await history.locator('summary').click();
  await history.locator('a').first().click();
  await expect(page.getByRole('heading', { name: 'Completed response' })).toBeVisible();
  await expect(response.getByRole('status')).toContainText('Back at station');
});

test('Operators standby state explains what will happen next', async ({ page }) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.goto('/operators');
  await expect(page.getByRole('heading', { name: 'No active response' })).toBeVisible();
  await expect(
    page.getByText('The next simulated equipment fault will create an assignment here.'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operator roster' }).locator('a')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Recent simulated responses' })).toContainText(
    'No completed responses yet',
  );
});
