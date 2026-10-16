import { test, expect } from '../support/staff-session';

test.describe.configure({ mode: 'serial' });

test('chat intake, durable human request, stable retry and manager outcome form one production case', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Ask PlantSense', exact: true });
  await page
    .getByLabel('Question or editable transcript')
    .fill('Line A output needs a human check.');
  await chat.getByRole('button', { name: 'Start case', exact: true }).click();
  const intake = chat.getByRole('form', { name: 'Report factory issue', exact: true });
  await intake.getByLabel('Issue title', { exact: true }).fill('Line A output review');
  await expect(intake.getByLabel('What happened?', { exact: true })).toHaveValue(
    'Line A output needs a human check.',
  );
  await intake.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(chat.getByRole('link', { name: 'Open recorded case', exact: true })).toBeVisible();
  await expect(page.getByLabel('Question or editable transcript')).toHaveValue(
    'Line A output needs a human check.',
  );
  await chat.getByRole('link', { name: 'Open recorded case', exact: true }).click();
  await expect(page).toHaveURL(/workcase=/);
  const caseId = new URL(page.url()).searchParams.get('workcase')!;
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const endpoint = `/api/v1/plants/${plant}/cases/${caseId}`;
  const detail = page.getByRole('region', { name: 'Factory case detail', exact: true });
  await expect(
    detail.getByRole('heading', { name: 'Line A output review', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ask PlantSense', exact: true }).click();
  await expect(chat).toContainText('Case: Line A output review');
  await page.getByLabel('Question or editable transcript').fill('What is this case waiting for?');
  const caseQuestion = page.waitForRequest(
    (request) => request.url().endsWith('/assistant/questions') && request.method() === 'POST',
  );
  await chat.getByRole('button', { name: 'Send question', exact: true }).click();
  expect((await caseQuestion).postDataJSON().case_id).toBe(caseId);
  await expect(chat.getByText(/Saved answer · Line A output review/)).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Start case', exact: true })).toHaveCount(0);
  await chat.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await detail
    .locator('summary')
    .filter({ hasText: /^Case controls and human decisions$/ })
    .click();
  await page
    .locator('summary')
    .filter({ hasText: /^Automation policy/ })
    .click();
  const policyEnabled = page.getByLabel('Enable internal case coordination', { exact: true });
  if (!(await policyEnabled.isChecked())) {
    await policyEnabled.check();
    await page.getByRole('button', { name: 'Save automation policy', exact: true }).click();
  }
  await expect(
    page.locator('summary').filter({ hasText: /^Automation policy · enabled$/ }),
  ).toBeVisible();
  if (!(await (await page.request.get(endpoint)).json()).runs.length)
    await detail.getByRole('button', { name: 'Request analysis / retry', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).case.phase, {
      timeout: 30000,
    })
    .toBe('waiting_for_input');
  await page.getByRole('button', { name: 'Refresh cases', exact: true }).click();
  await expect(detail.getByText('Available to claim', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Record production output', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../.runtime/case-ux-waiting-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 430, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/case-ux-waiting-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'My tasks', exact: true }).click();
  const inbox = page.getByRole('dialog', { name: 'My tasks', exact: true });
  await inbox.getByRole('button', { name: 'Claim task', exact: true }).click();
  await inbox
    .getByLabel('Your finding', { exact: true })
    .fill('Manager reports 65 parts/hour over the last hour; reviewed operating conditions.');
  const attempts: { key: string | undefined; body: unknown }[] = [];
  await page.route('**/tasks/*/respond', async (route) => {
    attempts.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (attempts.length === 1) await route.abort('failed');
    else await route.continue();
  });
  await inbox.getByRole('button', { name: 'Submit finding', exact: true }).click();
  await expect(inbox.getByRole('alert')).toBeVisible();
  await expect(inbox.getByLabel('Your finding', { exact: true })).toHaveValue(/Manager reports 65/);
  await inbox.getByRole('button', { name: 'Submit finding', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(
    inbox.getByText(
      'No open tasks for your role in this plant. Tasks assigned to other roles remain visible in their case.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close requests', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).case.phase, {
      timeout: 30000,
    })
    .toBe('awaiting_decision');
  await page.getByRole('button', { name: 'Refresh cases', exact: true }).click();
  await expect(detail).toContainText('Analysis revision 2');
  await expect(
    detail.getByRole('heading', { name: 'Evidence behind this assessment' }),
  ).toBeVisible();
  await detail.getByRole('button', { name: /Equipment configuration/ }).click();
  await expect(detail.getByRole('region', { name: 'Selected evidence source' })).toBeVisible();
  await page.screenshot({ path: '../.runtime/case-foundation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 430, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/case-foundation-mobile.png', fullPage: true });
  await detail.getByRole('button', { name: 'Record outcome', exact: true }).click();
  await expect(detail.locator('[data-case-control="outcome"]')).toHaveAttribute('open', '');
  await detail
    .getByLabel('Outcome', { exact: true })
    .fill('Reviewed the reported output and recorded the planning response.');
  await detail.getByLabel(/technician statement · Manager reports/).check();
  await detail.getByRole('button', { name: 'Resolve reported issue', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).case.phase)
    .toBe('resolved');
  await page.reload();
  await expect(detail).toContainText(
    'Reviewed the reported output and recorded the planning response.',
  );
  expect(errors).toEqual([]);
});

test('other categories remain human triage and cancelled requests retain their activity', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  await page.goto('/incidents?intake=1');
  const form = page.getByRole('form', { name: 'Report factory issue', exact: true });
  await form.getByLabel('Issue title', { exact: true }).fill('Packing material review');
  await form.getByLabel('Category', { exact: true }).selectOption('materials');
  await form
    .getByLabel('What happened?', { exact: true })
    .fill('Staff reports packing material availability needs review.');
  await form.getByRole('button', { name: 'Create case', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Factory case detail', exact: true });
  await expect(
    detail.getByRole('heading', { name: 'Packing material review', exact: true }),
  ).toBeVisible();
  await detail
    .locator('summary')
    .filter({ hasText: /^Case controls and human decisions$/ })
    .click();
  await expect(
    detail.getByRole('button', { name: 'Request analysis / retry', exact: true }),
  ).toBeDisabled();
  await detail
    .locator('summary')
    .filter({ hasText: /^Request information$/ })
    .click();
  await detail
    .getByLabel('Question', { exact: true })
    .fill('Confirm the material availability record');
  await detail
    .getByLabel('Why this is needed', { exact: true })
    .fill('Planning needs a staff update');
  await detail
    .getByLabel('Completion requirements', { exact: true })
    .fill('Record availability or missing information');
  await detail.getByLabel('Responsible role', { exact: true }).selectOption('manager');
  await detail.getByRole('button', { name: 'Create information request', exact: true }).click();
  await expect(
    detail.getByText('Confirm the material availability record', { exact: true }),
  ).toBeVisible();
  await detail
    .locator('summary')
    .filter({ hasText: /^Cancel case$/ })
    .click();
  await detail
    .getByLabel('Cancellation reason', { exact: true })
    .fill('Duplicate staff planning request; history retained.');
  await detail.getByRole('button', { name: 'Cancel reported case', exact: true }).click();
  await expect(detail).toContainText('Cancelled');
  await detail
    .locator('summary')
    .filter({ hasText: /^View complete recorded activity$/ })
    .click();
  await expect(detail).toContainText('Duplicate staff planning request; history retained.');
});
