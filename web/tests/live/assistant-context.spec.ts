/** Explicit live text acceptance on an isolated deployment; normal browser tests remain scripted. */
import { test, expect } from '@playwright/test';

test('real Gemini explains a captured simulated response without granting operational authority', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  const access = await (await page.request.get('/api/v1/access/state')).json();
  const credentials = {
    email: 'product-owner@example.test',
    password: 'testing-only strong passphrase!',
  };
  const login = await page.request.post(
    `/api/v1/access/${access.setup_required ? 'setup' : 'sign-in'}`,
    {
      data: access.setup_required
        ? {
            ...credentials,
            display_name: 'Live fixture owner',
            organization_name: 'Isolated acceptance',
            plant_name: 'Live fixture',
          }
        : credentials,
    },
  );
  expect(login.ok()).toBe(true);
  const plant = (await login.json()).plants[0].id;
  await page.evaluate((id) => localStorage.setItem('plantsense-workspace', id), plant);
  await page.goto('/plant');
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Start pump pressure loss', exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem(`plantsense-simulation-v2:${id}`) || '{}').snapshot
              ?.open?.[0]?.id,
          plant,
        ),
      { timeout: 20000 },
    )
    .toBeTruthy();
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const assignment = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`plantsense-simulation-v2:${id}`)!).snapshot.open[0].id,
    plant,
  );
  await page.goto(`/operators?assignment=${assignment}`);
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await page
    .getByLabel('Question or editable transcript')
    .fill(
      'Explain this simulated fault, who is responding, and its effect on production. Does it prove a physical cause?',
    );
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/assistant/questions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const answer = await response.json();
  expect(answer.provider).toMatch(/^Gemini/);
  expect(answer.usage.status).toBe('completed');
  expect(answer.answer).toContain('Maya');
  expect(answer.citations.map((s: { id: string }) => s.id)).toEqual(
    expect.arrayContaining(['browser-simulation-process', 'browser-simulation-case']),
  );
  expect(answer.incident_id).toBeNull();
  expect(answer.costs).toEqual([]);
  expect(answer.calculation_version).toBeNull();
  const retry = await page.request.post(response.url(), {
    data: response.request().postDataJSON(),
    headers: { 'Idempotency-Key': response.request().headers()['idempotency-key'] },
  });
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual(answer);
  const reply = page.locator('[id^="answer-"]');
  await expect(reply).toContainText('Maya');
  expect(answer.answer.split(/\s+/).length).toBeLessThanOrEqual(160);
  expect(answer.answer).not.toContain(
    'Browser readings and operator cases are synthetic simulation',
  );
  await expect(page.locator('pre').first()).not.toBeVisible();
  await page.screenshot({ path: '../.runtime/factory-chat-desktop.png' });
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse chat', exact: true })).toBeVisible();
  await page.screenshot({ path: '../.runtime/factory-chat-expanded.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 430, height: 950 });
  await expect(page.getByRole('button', { name: 'Expand chat', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../.runtime/factory-chat-mobile.png' });
});
