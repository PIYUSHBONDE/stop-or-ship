import type { components } from '@/lib/generated/api-schema';

type Schema = components['schemas'];
export type CaseDetail = Schema['CaseDetail'];
export const phaseNames: Record<Schema['CaseView']['phase'], string> = {
  triage: 'Report recorded',
  investigating: 'AI is reviewing evidence',
  waiting_for_input: 'Waiting for a finding',
  awaiting_decision: 'Ready for human review',
  in_progress: 'Work in progress',
  verifying: 'Checking the outcome',
  resolved: 'Resolved',
  blocked: 'Needs attention',
  cancelled: 'Cancelled',
};
export const sourceNames: Record<string, string> = {
  'equipment-context': 'Equipment configuration',
  'equipment-trends': 'Saved operational readings',
  'production-context': 'Production areas and dependencies',
  'scoped-knowledge': 'Procedures and confirmed repairs',
  'case-evidence': 'Staff reports and human findings',
  'intervention-comparison': 'Saved intervention comparison',
};
export const stageNames: Record<string, string> = {
  context: 'Evidence gathered',
  investigator: 'Investigation',
  reviewer: 'Evidence review',
  Reliability: 'Reliability',
  Production: 'Production impact',
};

export function casePresentation(detail: CaseDetail, userId?: string, role?: string) {
  const terminal = ['resolved', 'cancelled'].includes(detail.case.phase);
  const activeTasks = terminal
    ? []
    : detail.tasks.filter((task) => ['open', 'claimed'].includes(task.state));
  const mine = activeTasks.find((task) => !!userId && task.owner_id === userId);
  const available = activeTasks.find(
    (task) => !task.owner_id && (role === 'admin' || task.target_role === role),
  );
  const next = mine || available || activeTasks[0];
  const run = detail.runs.find((item) => item.analysis_version === detail.case.analysis_version);
  const investigator = run?.steps.find((step) => step.stage === 'investigator' && step.summary);
  const production = run?.steps.find((step) => step.stage === 'Production' && step.summary);
  const missing =
    run?.sources?.filter(
      (source) => source.status === 'missing' && source.id !== 'intervention-comparison',
    ) ?? [];
  const status = terminal
    ? phaseNames[detail.case.phase]
    : next
      ? mine
        ? 'Waiting for your finding'
        : available === next
          ? 'Available to claim'
          : `Waiting for ${next.owner_name || next.target_role}`
      : phaseNames[detail.case.phase];
  const explanation = terminal
    ? detail.case.outcome || 'This case is closed. Its evidence and activity remain available.'
    : next
      ? next.reason
      : detail.case.phase === 'blocked'
        ? 'Analysis could not establish the next step. Retained findings remain available; a reviewer must address the blocker.'
        : detail.case.phase === 'investigating'
          ? 'The worker is reviewing saved evidence. You can leave this page and return later.'
          : detail.case.phase === 'awaiting_decision'
            ? 'Review the findings and remaining uncertainty. No approval or repair is implied.'
            : detail.case.phase === 'triage'
              ? 'The report is saved. Analysis depends on enabled automation and an available worker; manual review remains available.'
              : 'Progress follows the linked incident and its existing authorization and verification controls.';
  return {
    activeTasks,
    mine,
    available,
    next,
    run,
    investigator,
    production,
    missing,
    terminal,
    status,
    explanation,
  };
}

const taskTitles: Record<string, string> = {
  "Provide an independent measurement using the site's approved procedure, or report that it is unavailable.":
    'Add a measurement',
  'Record actual production output, its time window and the current operating condition, or report unavailable data.':
    'Record production output',
  'Review the cited evidence and record the finding, remaining uncertainty or unavailable information.':
    'Review the reported issue',
};

export function taskTitle(question: string) {
  const base = question.replace(/ Equipment: [A-Za-z0-9_-]+\.$/, '');
  return taskTitles[base] || question;
}
