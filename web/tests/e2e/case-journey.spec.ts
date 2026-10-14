import { test, expect } from '../support/staff-session';

test('case dossier preserves detection and scopes assistant separately from operational observations', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const before = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  const key = `plantsense-simulation-v2:${plant}`;
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).ledger.cases.length, key))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const saved = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!).ledger.cases[0],
    key,
  );
  await page.goto(`/incidents?case=${saved.id}`);
  await expect(page.getByLabel('Simulated case journey')).toBeVisible();
  await expect(page.getByLabel('Saved production impact')).toContainText(
    `${saved.context.lines[0].capacity} parts/h`,
  );
  await expect(page.getByLabel('Case evidence and uncertainty')).toContainText(
    'Mechanical cause: unconfirmed',
  );
  await page.reload();
  await expect(page.getByLabel('Case evidence and uncertainty')).toContainText(
    `${saved.value} ${saved.unit}`,
  );
  await page
    .getByRole('link', { name: 'Review this case with Ask PlantSense', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Ask PlantSense' })).toBeVisible();
  // The handoff opens an editable question; it never sends automatically.
  await expect(page.getByLabel('Question or editable transcript')).not.toHaveValue('');
  const question = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
  await page.getByRole('button', { name: 'Send question' }).click();
  const body = (await question).postDataJSON();
  expect(body.incident_id).toBeNull();
  expect(body.simulation_context.case_evidence.case_id).toBe(saved.id);
  expect(body.simulation_context.case_evidence.detection.value).toBe(saved.value);
  expect(body.simulation_context.case_evidence.recovery_basis).toBe('scenario_timer');
  await expect(
    page.getByText(
      'Simulated case · saved detection and scenario outcome · browser-simulation-case',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.setViewportSize({ width: 430, height: 950 });
  const bounds = await page.getByLabel('Case evidence and uncertainty').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/case-dossier-mobile.png' });
  await page.getByRole('link', { name: 'Operational evidence', exact: true }).click();
  await expect(page).toHaveURL(/view=observations/);
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await page
    .getByLabel('Question or editable transcript')
    .fill('What current operational observations are available?');
  const operational = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
  await page.getByRole('button', { name: 'Send question' }).click();
  expect((await operational).postDataJSON().simulation_context).toBeUndefined();
  await expect(
    page.getByText('Scripted summary · Gemini not connected', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.goto(`/plant?asset=${saved.assetId}`);
  await expect(page.getByLabel('Machine inspector')).toContainText(saved.assetId);
  const press = before.assets.find((a: { type: string }) => a.type === 'press');
  await page.getByLabel('Production lines').getByRole('button').first().click();
  await expect(page.getByLabel('Machine inspector')).toContainText(press.id);
  // An asset deep link applies once. Later polling must preserve the user's new selection.
  for (let i = 0; i < 2; i++) await page.waitForResponse((r) => r.url().endsWith('/snapshot'));
  await expect(page.getByLabel('Machine inspector')).toContainText(press.id);
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ k, id }) =>
            JSON.parse(localStorage.getItem(k)!).ledger.cases.find(
              (c: { id: string }) => c.id === id,
            )?.clearedAt,
          { k: key, id: saved.id },
        ),
      { timeout: 35000 },
    )
    .toBeTruthy();
  await page.goto('/memory');
  await expect(page.getByLabel('Simulation history')).toContainText(saved.id);
  await expect(
    page.getByRole('heading', { name: 'Confirmed repairs, reusable evidence' }),
  ).toBeVisible();
  await expect(page.locator('.memory-card').filter({ hasText: saved.id })).toHaveCount(0);
  const after = await (await page.request.get(`/api/v1/plants/${plant}/snapshot`)).json();
  expect(after.memory).toEqual(before.memory);
  await page.getByRole('link', { name: 'Operators', exact: true }).click();
  await expect(page).toHaveURL(/\/operators$/);
});
