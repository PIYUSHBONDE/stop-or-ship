import { test, expect } from '../support/staff-session';
import { openPlantControls } from '../support/navigation';

test('factory chat presents the selected response across floating, expanded and mobile layouts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // This authored UI double is deliberately separate from real-provider acceptance.
  await page.route('**/assistant/questions', async (route) => {
    const body = route.request().postDataJSON();
    const snapshot = body.simulation_context;
    const selected = snapshot.assignments.find(
      (a: { id: string }) => a.id === snapshot.selected_assignment_id,
    );
    const reading = snapshot.equipment
      .find((a: { asset_id: string }) => a.asset_id === body.asset_id)
      ?.readings.find((r: { signal_id: string }) => r.signal_id === 'pressure');
    const line = snapshot.process.lines.find((l: { id: string }) => l.id === 'line-a');
    await route.fulfill({
      json: {
        answer: `Pump pressure is **${reading.value.toFixed(1)} bar**. **${selected.operator_name}** is responding.\n\nLine A is producing **${line.output_per_hour.toFixed(0)} of ${line.capacity_per_hour} parts/hour**. The response is currently **${selected.status}**.`,
        citations: [
          { id: 'browser-simulation', title: 'Screen snapshot', text: JSON.stringify(snapshot) },
        ],
        navigation: [],
        costs: [],
        configuration_version: 1,
        calculation_version: null,
        answer_reference: '3'.repeat(32),
        provider: 'Scripted UI fixture',
        incident_id: null,
        asset_id: body.asset_id,
      },
    });
  });
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
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const id = await page.evaluate(() => {
    const plant = localStorage.getItem('plantsense-workspace');
    return JSON.parse(localStorage.getItem(`plantsense-simulation-v2:${plant}`)!).snapshot.open[0]
      .id;
  });
  await page.goto(`/operators?assignment=${encodeURIComponent(id)}`);
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What needs your attention?' })).toBeVisible();
  await page.screenshot({ path: '../.runtime/factory-chat-empty.png' });
  await page.getByLabel('Question or editable transcript').fill("What's happening with this pump?");
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Ask PlantSense', exact: true });
  await expect(chat.locator('[id^="answer-"]')).toContainText('Maya Chen');
  await expect(chat.getByRole('link', { name: 'View response', exact: true })).toHaveAttribute(
    'href',
    `/operators?assignment=${encodeURIComponent(id)}`,
  );
  await expect(chat.locator('pre')).not.toBeVisible();
  await page.screenshot({ path: '../.runtime/factory-chat-desktop.png' });
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse chat', exact: true })).toBeFocused();
  await page.screenshot({ path: '../.runtime/factory-chat-expanded.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 430, height: 950 });
  await expect(page.getByRole('button', { name: 'Expand chat', exact: true })).toHaveCount(0);
  await expect(chat.locator('[id^="answer-"]')).toContainText('Maya Chen');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/factory-chat-mobile.png' });
  expect(errors).toEqual([]);
});
