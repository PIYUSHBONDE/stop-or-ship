import { test, expect } from '@playwright/test';

test('offline evidence workshop, source details and keyboard focus return', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) requests.push(request.url());
  });
  await page.goto('/evidence-preview');
  await expect(page.getByRole('heading', { name: 'Evidence component workshop' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(7);
  await page.screenshot({ path: '../docs/artifacts/evidence-workshop.png', fullPage: true });
  const opener = page.getByRole('button', { name: 'Open P-107 telemetry snapshot' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Evidence: P-107 telemetry snapshot' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('125 bar');
  await expect(dialog).toContainText('Healthy baseline: 150 bar');
  await expect(dialog).toContainText('Deviation: -16.67%');
  await page.keyboard.press('Tab');
  await expect(dialog).toContainText('Synthetic UI fixture');
  await page.screenshot({ path: '../docs/artifacts/evidence-details.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(requests).toEqual([]);
});

test('missing metadata, long text and narrow-screen evidence remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto('/evidence-preview');
  await page.getByRole('button', { name: 'Open Untitled evidence' }).click();
  await expect(page.getByRole('dialog')).toContainText('Provenance unavailable');
  await expect(page.getByRole('dialog')).toContainText('No source excerpt was provided.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Extended inspection notes' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '<script>this is text, not executable code</script>',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open P-107 telemetry snapshot' }).click();
  await expect(page.getByRole('dialog')).toContainText('3.5 L/min');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/artifacts/evidence-mobile.png' });
});
