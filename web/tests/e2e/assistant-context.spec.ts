import { test, expect } from '../support/staff-session';
import { openPlantControls } from '../support/navigation';

test('assistant follows guide and machine routes instead of stale global equipment', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.goto('/memory/AC-001');
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await page.getByLabel('Question or editable transcript').fill('Explain the selected equipment.');
  const guideRequest = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const guideBody = (await guideRequest).postDataJSON();
  expect(guideBody.asset_id).toBe('AC-001');
  expect(guideBody.simulation_context).toBeUndefined();
  await expect(page.getByText('Read-only · Scripted provider', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.getByRole('link', { name: 'Machine records', exact: true }).click();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await page.getByLabel('Question or editable transcript').fill('Explain the selected equipment.');
  const machineRequest = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const machineBody = (await machineRequest).postDataJSON();
  expect(machineBody.asset_id).toBe('AC-001');
  expect(machineBody.history).toEqual([]);
  expect(machineBody.simulation_context.equipment[0].asset_id).toBe('AC-001');
  expect(machineBody.simulation_context.process.lines.length).toBeGreaterThan(0);
  await expect(page.getByText('Read-only · Scripted provider', { exact: true })).toBeVisible();
});

test('operator questions carry the selected response, detection, named operator and simulated output', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await openPlantControls(page);
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const plant = localStorage.getItem('plantsense-workspace');
          return JSON.parse(localStorage.getItem(`plantsense-simulation-v2:${plant}`) || '{}')
            .snapshot?.open?.[0]?.id;
        }),
      { timeout: 20000 },
    )
    .toBeTruthy();
  const id = await page.evaluate(() => {
    const plant = localStorage.getItem('plantsense-workspace');
    return JSON.parse(localStorage.getItem(`plantsense-simulation-v2:${plant}`)!).snapshot.open[0]
      .id;
  });
  await page.goto(`/operators?assignment=${id}`);
  await page.getByRole('heading', { name: 'Active response', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await page
    .getByLabel('Question or editable transcript')
    .fill('Explain this fault, operator response and output.');
  const request = page.waitForRequest((r) => r.url().endsWith('/assistant/questions'));
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.asset_id).toBe('P-107');
  expect(body.incident_id).toBeNull();
  const simulation = body.simulation_context;
  expect(simulation.selected_assignment_id).toBe(id);
  expect(simulation.selected_case_id).toBe(id);
  expect(simulation.case_evidence.case_id).toBe(id);
  expect(simulation.case_evidence.recovery_basis).toBe('scenario_timer');
  expect(simulation.assignments[0].operator_name).toBe('Maya Chen');
  expect(simulation.process.fault_asset_id).toBe('P-107');
  expect(
    simulation.process.lines.some(
      (line: { output_per_hour: number; capacity_per_hour: number }) =>
        line.output_per_hour < line.capacity_per_hour,
    ),
  ).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThan(65536);
  await expect(page.getByText('Read-only · Scripted provider', { exact: true })).toBeVisible();
  await page
    .locator('summary')
    .filter({ hasText: /^Sources \(\d+\)$/ })
    .click();
  await expect(page.getByText('Simulated production and response', { exact: true })).toBeVisible();
});
