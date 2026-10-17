import { test, expect } from '../support/staff-session';

test('factory pages share the login palette and remain usable on desktop and mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  for (const width of [1440, 430]) {
    await page.setViewportSize({ width, height: 950 });
    for (const route of [
      'operators',
      'monitoring',
      'incidents',
      'memory',
      'plant-setup',
      'workspace',
    ]) {
      await page.goto(`/${route}`);
      const headings: Record<string, string> = {
        operators: 'Operators',
        monitoring: 'Machine records',
        incidents: 'Incidents',
        memory: 'Plant guide',
        'plant-setup': 'Design your plant.',
        workspace: 'Welcome, Product Owner',
      };
      await expect(
        page.getByRole('heading', { level: 1, name: headings[route], exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        'rgb(6, 17, 14)',
      );
      await page.screenshot({ path: `../.runtime/theme-${route}-${width}.png` });
    }
  }
  expect(errors).toEqual([]);
});
