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
  await detail.getByRole('button', { name: /^Automation policy/ }).click();
  const policyDialog = page.getByRole('dialog', { name: 'Automation policy', exact: true });
  const policyEnabled = policyDialog.getByLabel('Enable internal case coordination', {
    exact: true,
  });
  if (!(await policyEnabled.isChecked())) {
    await policyEnabled.check();
    await policyDialog.getByRole('button', { name: 'Save automation policy', exact: true }).click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(
    detail.getByRole('button', { name: 'Automation policy · enabled', exact: true }),
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
  const assessmentPosition = await detail
    .getByRole('heading', { name: 'What we know', exact: true })
    .boundingBox();
  const activityPosition = await detail
    .getByRole('heading', { name: 'AI activity', exact: true })
    .boundingBox();
  expect(assessmentPosition!.y).toBeLessThan(activityPosition!.y);
  const evidencePosition = await detail
    .getByRole('heading', { name: 'Evidence behind this assessment', exact: true })
    .boundingBox();
  const historyPosition = await detail
    .getByRole('heading', { name: 'What happened', exact: true })
    .boundingBox();
  const controlsPosition = await detail.locator('#case-controls').boundingBox();
  expect(evidencePosition!.y).toBeLessThan(activityPosition!.y);
  expect(activityPosition!.y).toBeLessThan(historyPosition!.y);
  expect(historyPosition!.y).toBeLessThan(controlsPosition!.y);
  await page.screenshot({ path: '../.runtime/case-ux-waiting-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 900, height: 950 });
  const tabletEvidence = await detail
    .getByRole('heading', { name: 'Evidence behind this assessment', exact: true })
    .boundingBox();
  const tabletActivity = await detail
    .getByRole('heading', { name: 'AI activity', exact: true })
    .boundingBox();
  expect(tabletEvidence!.y).toBeLessThan(tabletActivity!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  expect(
    await detail
      .getByRole('button', { name: /Equipment configuration/ })
      .evaluate((button) => button.nextElementSibling?.getAttribute('aria-label')),
  ).toBe('Selected evidence source');
  await expect(detail.getByRole('region', { name: 'Selected evidence source' })).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Selected evidence source' })).toContainText(
    'Configuration does not establish current condition.',
  );
  await detail.getByRole('button', { name: 'Close source', exact: true }).click();
  await expect(detail.getByRole('button', { name: /Equipment configuration/ })).toBeFocused();
  await expect(detail.getByRole('button', { name: /Equipment configuration/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.setViewportSize({ width: 1024, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '../.runtime/case-foundation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 430, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/case-foundation-mobile.png', fullPage: true });
  await detail.getByRole('button', { name: 'Record outcome', exact: true }).click();
  const outcomeDialog = page.getByRole('dialog', { name: 'Record manager outcome', exact: true });
  await expect(outcomeDialog).toBeVisible();
  await outcomeDialog
    .getByLabel('Outcome', { exact: true })
    .fill('Reviewed the reported output and recorded the planning response.');
  await outcomeDialog.getByLabel(/technician statement · Manager reports/).check();
  await outcomeDialog.getByRole('button', { name: 'Resolve reported issue', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).case.phase)
    .toBe('resolved');
  await page.reload();
  await expect(detail).toContainText(
    'Reviewed the reported output and recorded the planning response.',
  );
  await expect(
    detail
      .getByText('Reviewed the reported output and recorded the planning response.', {
        exact: true,
      })
      .filter({ visible: true }),
  ).toHaveCount(1);
  await expect(
    detail.getByRole('list', { name: 'Case progress' }).locator('li').last(),
  ).toHaveAttribute('data-complete', 'true');
  await detail
    .locator('summary')
    .filter({ hasText: /^View complete recorded activity$/ })
    .click();
  const log = detail.getByRole('region', { name: 'Complete recorded activity', exact: true });
  await expect(log).toBeVisible();
  expect(await log.evaluate((node) => getComputedStyle(node).maxHeight)).toBe('240px');
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
  await expect(
    detail.getByRole('button', { name: 'Request analysis / retry', exact: true }),
  ).toBeDisabled();
  await detail.getByRole('button', { name: 'Request information', exact: true }).click();
  const informationDialog = page.getByRole('dialog', { name: 'Request information', exact: true });
  await informationDialog
    .getByLabel('Question', { exact: true })
    .fill('Confirm the material availability record');
  await informationDialog
    .getByLabel('Why this is needed', { exact: true })
    .fill('Planning needs a staff update');
  await informationDialog
    .getByLabel('Completion requirements', { exact: true })
    .fill('Record availability or missing information');
  await informationDialog.getByLabel('Responsible role', { exact: true }).selectOption('manager');
  await page.keyboard.press('Escape');
  await expect(
    detail.getByRole('button', { name: 'Request information', exact: true }),
  ).toBeFocused();
  await detail.getByRole('button', { name: 'Request information', exact: true }).click();
  await expect(informationDialog.getByLabel('Question', { exact: true })).toHaveValue(
    'Confirm the material availability record',
  );
  await page.screenshot({ path: '../.runtime/case-information-modal-desktop.png' });
  await informationDialog
    .getByRole('button', { name: 'Create information request', exact: true })
    .click();
  await expect(
    detail.getByText('Confirm the material availability record', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notices = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await notices.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
  const notice = notices
    .locator('article')
    .filter({ hasText: 'Confirm the material availability record' });
  await expect(notice).toHaveAttribute('data-unread', 'true');
  const reads: { key?: string; body: unknown }[] = [];
  await page.route('**/notifications/read', async (route) => {
    reads.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (reads.length === 1) await route.abort('failed');
    else await route.continue();
  });
  await notice.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(notices.getByRole('alert')).toBeVisible();
  await notice.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(notice).toHaveAttribute('data-unread', 'false');
  expect(reads).toHaveLength(2);
  expect(reads[1]).toEqual(reads[0]);
  await page.screenshot({ path: '../.runtime/notifications-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeFocused();
  await page.reload();
  await page.setViewportSize({ width: 430, height: 950 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(notice).toHaveAttribute('data-unread', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/notifications-mobile.png' });
  await notice.getByRole('link', { name: 'Open request', exact: true }).click();
  await expect(notices).not.toBeVisible();
  await expect(
    detail.getByText('Confirm the material availability record', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await detail.getByRole('button', { name: 'Claim task', exact: true }).click();
  const findingDialog = page.getByRole('dialog', { name: 'Record finding', exact: true });
  await expect(findingDialog).toBeVisible();
  await findingDialog
    .getByLabel('Your finding', { exact: true })
    .fill('Draft availability check; not yet submitted.');
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: 'Record finding', exact: true })).toBeFocused();
  await detail.getByRole('button', { name: 'Record finding', exact: true }).click();
  await expect(findingDialog.getByLabel('Your finding', { exact: true })).toHaveValue(
    'Draft availability check; not yet submitted.',
  );
  await page.setViewportSize({ width: 430, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.runtime/case-finding-modal-mobile.png' });
  await page.keyboard.press('Escape');
  await detail.getByRole('button', { name: 'Cancel case', exact: true }).click();
  const cancelDialog = page.getByRole('dialog', { name: 'Cancel case', exact: true });
  await cancelDialog
    .getByLabel('Cancellation reason', { exact: true })
    .fill('Duplicate staff planning request; history retained.');
  await cancelDialog.getByRole('button', { name: 'Cancel reported case', exact: true }).click();
  await expect(detail).toContainText('Cancelled');
  await detail
    .locator('summary')
    .filter({ hasText: /^View complete recorded activity$/ })
    .click();
  await expect(detail).toContainText('Duplicate staff planning request; history retained.');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await notices.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
  await expect(notice).toHaveCount(0);
});
