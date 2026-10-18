import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/staff-session';
import { openNavigation } from '../support/navigation';

test('inbox filters preserve task claims, counts, deadlines and notification read state', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  const access = await (await page.request.get('/api/v1/access/state')).json();
  const plant = access.plants[0].id;
  const base = `/api/v1/plants/${plant}`;
  async function post(path: string, body: unknown) {
    const result = await page.request.post(base + path, {
      data: body,
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(result.ok(), await result.text()).toBe(true);
    return result.json();
  }
  const earlierFixtures = await (await page.request.get(base + '/cases?limit=50')).json();
  for (const record of earlierFixtures.items) {
    if (
      !['resolved', 'cancelled'].includes(record.phase) &&
      record.description === 'Explicitly authored inbox demonstration; no plant measurements.'
    ) {
      await post(`/cases/${record.id}/cancel`, {
        expected_revision: record.revision,
        reason: 'Previous isolated inbox acceptance fixture; history retained.',
      });
    }
  }
  async function task(question: string, due: string | null) {
    const record = await post('/cases', {
      title: question,
      description: 'Explicitly authored inbox demonstration; no plant measurements.',
      category: 'materials',
      asset_id: 'P-107',
    });
    return post(`/cases/${record.id}/tasks`, {
      expected_revision: record.revision,
      question,
      reason: 'A recorded human check is needed for planning.',
      completion_requirements: 'Record the result or state what evidence is unavailable.',
      target_role: 'technician',
      due_at: due,
    });
  }
  await task('Check packing stock', '2050-01-01T00:00:00+00:00');
  await task('Confirm pump gauge', '2000-01-01T00:00:00+00:00');
  const assigned = await task('Check spare availability', null);
  await post(`/tasks/${assigned.id}/claim`, { expected_revision: assigned.revision });

  const trigger = page.getByRole('button', { name: 'My tasks', exact: true, includeHidden: true });
  await trigger.click();
  const inbox = page.getByRole('dialog', { name: 'My tasks', exact: true });
  await expect(inbox.getByRole('article')).toHaveCount(3);
  await expect(inbox.getByRole('article').first()).toContainText('Confirm pump gauge');
  await expect(inbox.getByRole('article').first()).toContainText('Overdue');
  await expect(trigger).toHaveAccessibleDescription(
    '3 tasks assigned to you or available to claim',
  );
  await inbox.getByRole('button', { name: 'Assigned to me', exact: true }).click();
  await expect(inbox.getByRole('article')).toHaveCount(1);
  await expect(inbox.getByRole('article')).toContainText('Check spare availability');
  await inbox.getByRole('button', { name: 'Available to claim', exact: true }).click();
  await expect(inbox.getByRole('article')).toHaveCount(2);
  await page.screenshot({
    path: '../.runtime/inbox-improvements/tasks-desktop.png',
    animations: 'disabled',
  });
  await inbox.getByRole('article').first().getByRole('button', { name: 'Claim task' }).click();
  const finding = inbox.getByLabel('Your finding', { exact: true });
  await expect(finding).toBeVisible();
  await finding.fill('Draft human gauge check.');
  await expect(inbox.getByRole('button', { name: 'Assigned to me', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(inbox.getByRole('article')).toHaveCount(2);
  const refreshed = page.waitForResponse(
    (response) => response.url().includes('/tasks?') && response.request().method() === 'GET',
  );
  await inbox.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  await refreshed;
  await expect(finding).toHaveValue('Draft human gauge check.');
  await page.setViewportSize({ width: 430, height: 950 });
  await expect(inbox).toBeHidden();
  await openNavigation(page);
  await trigger.click();
  await expect(inbox.getByRole('group', { name: 'Filter tasks', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '../.runtime/inbox-improvements/tasks-mobile.png',
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('navigation', { name: 'Application navigation', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notices = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(notices.getByRole('article')).toHaveCount(3);
  const stock = notices.getByRole('article').filter({ hasText: 'Check packing stock' });
  await expect(stock).toContainText('Request');
  await stock.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(stock).toHaveAttribute('data-unread', 'false');
  await notices.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(notices.getByRole('article')).toHaveCount(2);
  await expect(stock).toHaveCount(0);
  await page.screenshot({
    path: '../.runtime/inbox-improvements/notifications-mobile.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(notices).toBeHidden();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await notices.getByRole('button', { name: 'All', exact: true }).click();
  await expect(notices.getByRole('article')).toHaveCount(3);
  await expect(stock).toHaveAttribute('data-unread', 'false');
  await page.screenshot({
    path: '../.runtime/inbox-improvements/notifications-desktop.png',
    animations: 'disabled',
  });
});
