import { test, expect, type Page } from '@playwright/test';
import type { State } from '../lib/types';

async function settled(page: Page) {
  await expect(page.getByRole('status')).toHaveCount(0);
}
async function step(page: Page, count: number) {
  for (let index = 0; index < count; index++) {
    await page.getByRole('button', { name: 'Advance one telemetry window' }).click();
    await settled(page);
  }
}
async function state(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const session = localStorage.getItem('plantsense-session');
    const response = await fetch(`/api/v1/sessions/${session}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('plantsense-token')}` },
    });
    if (!response.ok) throw new Error('Could not read test session');
    return response.json();
  });
}
async function changeRisk(page: Page, value: number) {
  const slider = page.getByLabel('Risk assumption multiplier');
  await slider.focus();
  await slider.press('Home');
  for (let index = 0; index < Math.round((value - 0.25) / 0.25); index++)
    await slider.press('ArrowRight');
}
async function start(page: Page, scenario = 'pump_degradation') {
  await page.goto('/plant');
  await expect(page.getByRole('heading', { name: 'Your plant, in context.' })).toBeVisible();
  await page.getByLabel('Demo scenario').selectOption(scenario);
  await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
  await settled(page);
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await settled(page);
  await step(page, 6);
  await page.getByRole('navigation').getByRole('link', { name: 'Incidents', exact: true }).click();
  await expect(page.getByText('INVESTIGATION SUMMARY', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/incidents\?incident=/);
}
async function complete(page: Page) {
  await page.getByRole('button', { name: 'Compare interventions' }).click();
  await page.getByRole('button', { name: 'Approve selected intervention' }).click();
  await expect(page.getByRole('link', { name: 'Open authorized work order' })).toBeVisible();
  await page.getByRole('link', { name: 'Open authorized work order' }).click();
  await expect(page).toHaveURL(/\/maintenance\?incident=/);
  await page.getByRole('button', { name: 'Start approved repair' }).click();
  await settled(page);
  await page.getByLabel('Observed root cause').fill('Valve bypass');
  await page.getByLabel('Repair performed').fill('Reseated valve and replaced bypass seal');
  await page.getByLabel('Parts used').fill('Bypass seal');
  await page.getByLabel('Observed outcome').fill('Independent pressure and flow checks restored');
  await page.getByRole('button', { name: 'Complete repair & verify' }).click();
  await expect(page.getByRole('heading', { name: 'Checking recovery' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await settled(page);
  await step(page, 3);
  await page.getByRole('navigation').getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Valve bypass', exact: true })).toBeVisible();
}

for (let run = 1; run <= 5; run++)
  test(`dedicated incident-to-verified-repair run ${run}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await start(page);
    if (run === 1) {
      await page.screenshot({
        path: '../docs/artifacts/incidents-milestone-1.png',
        fullPage: true,
      });
      const before = await state(page);
      for (const option of before.incident!.calculation.options) {
        const row = page
          .getByRole('row')
          .filter({ has: page.getByRole('radio', { name: option.name, exact: true }) });
        await expect(row).toContainText(
          new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: option.total_paise % 100 === 0 ? 0 : 2,
            maximumFractionDigits: 2,
          }).format(option.total_paise / 100),
        );
      }
      await page.getByRole('button', { name: 'Telemetry', exact: true }).first().click();
      await expect(page.getByRole('dialog')).toContainText('Healthy baseline:');
      await page.keyboard.press('Escape');
    }
    await complete(page);
    const after = await state(page);
    expect(after.incident?.state).toBe('resolved');
    expect(after.memory[0].observed_cause).toBe('Valve bypass');
    expect(errors).toEqual([]);
  });

test('dirty risk blocks approval, saved assumptions survive navigation and refresh', async ({
  page,
}) => {
  await start(page);
  const risk = page.getByLabel('Risk assumption multiplier');
  await changeRisk(page, 2);
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Unapplied changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(risk).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toBeEnabled();
  await changeRisk(page, 2);
  await page.getByRole('button', { name: 'Recalculate', exact: true }).click();
  await settled(page);
  await expect(page.getByText('Earlier comparison · explanation needs review')).toHaveCount(2);
  const selectedUrl = page.url();
  await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
  await page.goto(selectedUrl);
  await expect(page.getByLabel('Risk assumption multiplier')).toHaveValue('2');
  await page.reload();
  await expect(page.getByLabel('Risk assumption multiplier')).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toBeEnabled();
});

test('shared cooling displays distinct dependency branches on a narrow screen', async ({
  page,
}) => {
  await start(page, 'cooler_degradation');
  const lineA = page.getByRole('region', { name: 'Line A dependency branch' });
  const lineB = page.getByRole('region', { name: 'Line B dependency branch' });
  await expect(lineA).toContainText('P-107');
  await expect(lineA).toContainText('PR-101');
  await expect(lineA).not.toContainText('PR-201');
  await expect(lineB).toContainText('P-207');
  await expect(lineB).toContainText('PR-201');
  await expect(lineB).not.toContainText('PR-101');
  await page.setViewportSize({ width: 430, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const opener = page.getByRole('button', { name: /Open CL-001 telemetry replay/ });
  await page.getByText(/Browse all \d+ saved evidence records/).click();
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.screenshot({ path: '../docs/artifacts/incidents-mobile.png', fullPage: true });
});

test('historical case selection is read-only and maintenance deep links are guarded', async ({
  page,
}) => {
  await start(page);
  const first = (await state(page)).incident!.id;
  await complete(page);
  await page.getByRole('button', { name: 'Replay a similar incident' }).click();
  await settled(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Plant', exact: true }).click();
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await settled(page);
  await step(page, 6);
  await page.goto(`/incidents?incident=${first}`);
  await expect(
    page.getByText('Archived incident · its evidence and comparison are read-only.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toHaveCount(0);
  await expect(page.getByText('RECORDED AUTHORIZATION', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`incident=${first}`));
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await page.goto(`/maintenance?incident=${first}`);
  await expect(page.getByRole('heading', { name: 'Work order unavailable' })).toBeVisible();
});

test('a concurrent decision change rejects stale approval and refreshes the page', async ({
  page,
}) => {
  await start(page);
  const before = await state(page);
  const token = await page.evaluate(() => localStorage.getItem('plantsense-token'));
  await page.route('**/approve', async (route) => {
    const update = await page.request.post(`/api/v1/sessions/${before.id}/calculate`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Incident-ID': before.incident!.id },
      data: { risk_multiplier: 2 },
    });
    expect(update.ok()).toBe(true);
    await route.continue();
  });
  await page.getByRole('button', { name: 'Approve selected intervention' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Decision changed' })).toBeVisible();
  await expect(page.getByLabel('Risk assumption multiplier')).toHaveValue('2');
  await expect(page.getByRole('link', { name: 'Open authorized work order' })).toHaveCount(0);
  expect((await state(page)).incident?.work_order).toBeNull();
});

test('incomplete investigation keeps evidence available and explains disabled approval', async ({
  page,
}) => {
  await start(page);
  await page.route('**/api/v1/sessions/**', async (route) => {
    if (route.request().method() !== 'GET' && !route.request().url().endsWith('/advance'))
      return route.continue();
    const response = await route.fetch();
    const snapshot = await response.json();
    const current = {
      ...snapshot.incident,
      state: 'investigation_failed',
      error: 'Investigation timed out; collected evidence is retained.',
      diagnosis: null,
    };
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        incident: current,
        incidents: snapshot.incidents.map((candidate: { id: string }) =>
          candidate.id === current.id ? current : candidate,
        ),
      },
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry investigation' })).toBeEnabled();
  await expect(
    page.getByText(
      'Specialist explanations are unavailable. The calculated comparison remains available.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve selected intervention' })).toBeDisabled();
  await page.getByText(/Browse all \d+ saved evidence records/).click();
  await page.getByRole('button', { name: /Open P-107 telemetry replay/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
