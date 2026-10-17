import { test, expect } from '@playwright/test';
import { recordedHistory, verifiedRepairs } from '../../src/features/cases/insight-data';
import type { CaseDetail } from '../../src/features/cases/presentation';

function fixture(id: string, value: unknown): CaseDetail {
  return {
    case: { id: 'current', asset_id: 'P-107', analysis_version: 2 },
    runs: [
      {
        id: 'run',
        analysis_version: 2,
        sources: [{ id, status: 'reference', title: 'Saved source', text: JSON.stringify(value) }],
        steps: [],
      },
    ],
    tasks: [],
    evidence: [],
    events: [],
  } as unknown as CaseDetail;
}
const repair = {
  id: 'repair',
  origin: 'verified_repair',
  text: JSON.stringify({
    asset_id: 'P-107',
    observed_cause: 'Recorded wear',
    fix: 'Recorded correction',
    outcome: 'Verified output',
    verified_at: '2026-10-15T00:00:00Z',
  }),
};

test('repair comparison requires explicit verified origin and usable structured fields', () => {
  const detail = fixture('scoped-knowledge', {
    verified_repairs: [repair, { ...repair, origin: 'staff_report' }, { ...repair, text: 'null' }],
  });
  expect(verifiedRepairs(detail)).toEqual([
    {
      id: 'repair',
      asset_id: 'P-107',
      observed_cause: 'Recorded wear',
      fix: 'Recorded correction',
      outcome: 'Verified output',
      verified_at: '2026-10-15T00:00:00Z',
    },
  ]);
  for (const value of [
    null,
    [],
    { verified_repairs: {} },
    { verified_repairs: [{ ...repair, text: '<script>run()</script>' }] },
  ])
    expect(verifiedRepairs(fixture('scoped-knowledge', value))).toEqual([]);
});

test('current revision cannot silently reuse prior repair or history sources', () => {
  const detail = fixture('scoped-knowledge', { verified_repairs: [repair] });
  detail.runs[0].analysis_version = 1;
  expect(verifiedRepairs(detail)).toEqual([]);
  detail.runs[0].analysis_version = 2;
  detail.runs[0].sources![0].status = 'missing';
  expect(verifiedRepairs(detail)).toEqual([]);
});

test('history validates equipment, count, origin and route identifiers without interpreting text', () => {
  const value = {
    origin: 'recorded_case_history',
    asset_id: 'P-107',
    recorded_issues: 3,
    window_days: 30,
    captured_at: '2026-10-16T00:00:00Z',
    cases: [
      {
        id: '8f4a3780-00f9-4a9f-8797-cc9544521ba2',
        title: '<img onerror=attack()>',
        created_at: '2026-10-15T00:00:00Z',
        origin: 'staff_report',
      },
      { id: 'javascript:attack()', title: 'unsafe route' },
    ],
  };
  const history = recordedHistory(fixture('equipment-history', value));
  expect(history?.count).toBe(3);
  expect(history?.cases).toHaveLength(1);
  expect(history?.cases[0].title).toBe('<img onerror=attack()>');
  const plantWide = fixture('equipment-history', {
    ...value,
    asset_id: null,
    recorded_issues: 0,
    cases: [],
  });
  plantWide.case.asset_id = null;
  expect(recordedHistory(plantWide)).toBeNull();
  for (const patch of [
    { origin: 'browser_simulation' },
    { asset_id: 'P-207' },
    { recorded_issues: -1 },
    { recorded_issues: 1.5 },
    { recorded_issues: Infinity },
    { cases: null },
  ])
    expect(recordedHistory(fixture('equipment-history', { ...value, ...patch }))).toBeNull();
});
