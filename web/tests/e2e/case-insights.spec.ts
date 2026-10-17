import { test, expect } from '../support/staff-session';
import type { components } from '../../src/lib/generated/api-schema';

test('saved RCA, recurrence and repair comparison keep evidence inspectable and text inert', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open plant', exact: true }).click();
  const plant = await page.evaluate(() => localStorage.getItem('plantsense-workspace'));
  const id = '8f4a3780-00f9-4a9f-8797-cc9544521ba2';
  const stamp = '2026-10-16T10:00:00Z';
  const base = {
    id,
    organization_id: 'authored-ui-fixture',
    plant_id: plant!,
    title: 'Recurring pressure reports',
    description: 'Pressure concern reported by staff.',
    category: 'equipment' as const,
    asset_id: 'P-107',
    incident_id: null,
    phase: 'awaiting_decision' as const,
    revision: 2,
    analysis_version: 2,
    created_at: stamp,
    updated_at: stamp,
    created_by: null,
    origin: 'staff_report' as const,
  };
  const history = {
    id: 'equipment-history',
    origin: 'recorded_case_history',
    asset_id: 'P-107',
    recorded_issues: 3,
    window_days: 30,
    captured_at: stamp,
    cases: [
      { id, title: '<img src=x onerror=attack()>', created_at: stamp, origin: 'staff_report' },
    ],
  };
  const knowledge = {
    verified_repairs: [
      {
        id: 'case-repair-fixture',
        origin: 'verified_repair',
        text: JSON.stringify({
          asset_id: 'P-107',
          observed_cause: 'Recorded seal wear',
          fix: 'Approved seal replacement',
          outcome: 'Recorded post-repair measurements passed',
          verified_at: stamp,
        }),
      },
    ],
  };
  const current = {
    id: 'current-run',
    analysis_version: 2,
    provider: 'authored-ui-fixture',
    state: 'awaiting_decision',
    created_at: stamp,
    steps: [
      {
        stage: 'investigator',
        state: 'completed',
        updated_at: stamp,
        summary: 'Repeated reports need independent comparison.',
        citations: ['equipment-history'],
        hypotheses: [
          {
            cause: 'Wear is a possible explanation',
            confidence: 'low' as const,
            supporting_evidence: ['scoped-knowledge'],
            conflicting_evidence: ['equipment-trends'],
          },
        ],
      },
    ],
    sources: [
      {
        id: 'equipment-history',
        title: 'Recorded equipment issue history',
        status: 'reference' as const,
        text: JSON.stringify(history),
      },
      {
        id: 'scoped-knowledge',
        title: 'Procedures and confirmed repairs',
        status: 'reference' as const,
        text: JSON.stringify(knowledge),
      },
      {
        id: 'equipment-trends',
        title: 'Saved operational readings',
        status: 'missing' as const,
        text: '{"readings":[]}',
      },
    ],
  };
  const detail: components['schemas']['CaseDetail'] = {
    case: base,
    tasks: [],
    evidence: [],
    events: [],
    runs: [
      current,
      {
        ...current,
        id: 'prior-run',
        analysis_version: 1,
        steps: [
          {
            ...current.steps[0],
            summary: 'Earlier report lacked independent measurements.',
            hypotheses: [],
          },
        ],
      },
    ],
  };
  await page.route(`**/api/v1/plants/${plant}/cases/${id}`, (route) =>
    route.fulfill({ json: detail }),
  );
  await page.goto(`/incidents?workcase=${id}`);
  const region = page.getByRole('region', { name: 'Factory case detail', exact: true });
  const causes = region
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Possible causes and evidence/ }) })
    .first();
  await expect(causes).toContainText('Wear is a possible explanation');
  await expect(causes).toContainText('cause not physically confirmed');
  await causes.getByRole('button', { name: 'Saved operational readings', exact: true }).click();
  await expect(region.getByRole('region', { name: 'Selected evidence source' })).toContainText(
    'No usable records',
  );
  await region.getByRole('button', { name: 'Close source', exact: true }).click();
  await expect(
    causes.getByRole('button', { name: 'Saved operational readings', exact: true }),
  ).toBeFocused();
  await region
    .locator('summary')
    .filter({ hasText: /^Equipment issue history/ })
    .click();
  const savedCase = region.getByRole('link', {
    name: '<img src=x onerror=attack()> · Current case',
    exact: true,
  });
  await expect(savedCase).toHaveAttribute('href', `/incidents?workcase=${id}`);
  await expect(savedCase.locator('img')).toHaveCount(0);
  await region
    .locator('summary')
    .filter({ hasText: /^How the assessment changed$/ })
    .click();
  await expect(
    region.getByText('Earlier report lacked independent measurements.', { exact: true }),
  ).toBeVisible();
  await region
    .locator('summary')
    .filter({ hasText: /^Compare previous verified repairs/ })
    .click();
  await expect(region.getByText('Recorded seal wear', { exact: true })).toBeVisible();
  await expect(region.getByText('Approved seal replacement', { exact: true })).toBeVisible();
  for (const width of [1440, 430]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `../.runtime/case-insights-${width}.png`, fullPage: true });
  }
});
