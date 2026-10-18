import { test, expect } from '@playwright/test';
import {
  casePresentation,
  eventTitle,
  sourceSummary,
  taskTitle,
  type CaseDetail,
} from '../../src/features/cases/presentation';

const fixture = (): CaseDetail => ({
  case: {
    id: 'case',
    organization_id: 'org',
    plant_id: 'plant',
    title: 'Pump issue',
    description: 'Reported concern',
    category: 'equipment',
    asset_id: 'P-107',
    incident_id: null,
    phase: 'waiting_for_input',
    revision: 4,
    analysis_version: 2,
    created_at: '2026-10-16T10:00:00Z',
    updated_at: '2026-10-16T10:01:00Z',
    created_by: 'staff',
    origin: 'staff_report',
  },
  tasks: [],
  evidence: [],
  runs: [],
  events: [],
});

test('specialist completion cannot imply completed factory production; custom audit text survives', () => {
  const event = {
    sequence: 1,
    at: '2026-10-16T10:00:00Z',
    actor_id: null,
    action: 'analysis.step_completed',
    message: 'Production completed',
  };
  expect(eventTitle(event)).toBe('Production impact review completed');
  expect(eventTitle({ ...event, action: 'staff.note' })).toBe('Production completed');
  expect(eventTitle({ ...event, message: 'Custom finding' })).toBe('Custom finding');
});

test('source summaries preserve missing evidence and reported provenance without trusting arbitrary content', () => {
  const source = {
    id: 'equipment-trends',
    title: 'Readings',
    status: 'missing' as const,
    text: '{"readings":[1,2]}',
  };
  expect(sourceSummary(source)).toContain('No usable records');
  expect(sourceSummary({ ...source, status: 'recorded', text: '{"readings":[{},{}]}' })).toContain(
    '2 saved observations',
  );
  expect(
    sourceSummary({ ...source, status: 'recorded', text: '<script>attack()</script>' }),
  ).toContain('Saved evidence');
  expect(sourceSummary({ ...source, status: 'recorded', text: 'null' })).toContain(
    'Saved evidence',
  );
  expect(
    sourceSummary({
      ...source,
      id: 'case-evidence',
      status: 'recorded',
      text: '{"submissions":[{}]}',
    }),
  ).toContain('distinct from verified measurements');
});

test('claimed ownership takes precedence over role when explaining the next action', () => {
  const detail = fixture();
  detail.tasks = [
    {
      id: 'task',
      organization_id: 'org',
      plant_id: 'plant',
      case_id: 'case',
      target_role: 'reliability',
      owner_id: 'other',
      owner_name: 'Alex',
      state: 'claimed',
      revision: 2,
      due_at: null,
      created_at: '2026-10-16T10:00:00Z',
      question: 'Record pressure',
      reason: 'Pressure missing',
      completion_requirements: 'Value and units',
      escalated: false,
    },
  ];
  const view = casePresentation(detail, 'me', 'admin');
  expect(view.mine).toBeUndefined();
  expect(view.status).toBe('Waiting for Alex');
  detail.tasks[0].owner_id = null;
  expect(casePresentation(detail, 'me', 'reliability').status).toBe('Available to claim');
  expect(casePresentation(detail, 'me', 'reliability').mine).toBeUndefined();
  detail.case.phase = 'resolved';
  expect(casePresentation(detail, 'me', 'reliability').next).toBeUndefined();
  detail.case.phase = 'waiting_for_input';
  detail.tasks[0].owner_id = 'me';
  expect(casePresentation(detail, 'me', 'reliability').status).toBe('Waiting for your finding');
});

test('old analysis never appears as the current assessment and closure overrides active-task copy', () => {
  const detail = fixture();
  detail.runs = [
    {
      id: 'old',
      analysis_version: 1,
      provider: 'vertex',
      state: 'superseded',
      created_at: '2026-10-16T10:00:00Z',
      steps: [
        {
          stage: 'investigator',
          state: 'completed',
          updated_at: '2026-10-16T10:00:00Z',
          summary: 'Old hypothesis',
        },
      ],
    },
  ];
  expect(casePresentation(detail).investigator).toBeUndefined();
  detail.case.phase = 'resolved';
  detail.case.outcome = 'Manager recorded the outcome';
  expect(casePresentation(detail).status).toBe('Resolved');
  expect(casePresentation(detail).explanation).toBe(detail.case.outcome);
});

test('known generated requests have short headings without rewriting custom requests', () => {
  expect(
    taskTitle(
      'Record actual production output, its time window and the current operating condition, or report unavailable data. Equipment: P-107.',
    ),
  ).toBe('Record production output');
  expect(taskTitle('Check the pressure at shift start.')).toBe(
    'Check the pressure at shift start.',
  );
});
