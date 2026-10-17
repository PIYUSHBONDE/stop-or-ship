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
  'equipment-history': 'Recorded equipment issue history',
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

// Translate only known system events; custom staff text and the audit record stay intact.
export function eventTitle(event: CaseDetail['events'][number]) {
  if (['analysis.step_started', 'analysis.step_completed'].includes(event.action)) {
    const match =
      /^(context|investigator|reviewer|Reliability|Production) (started|completed)$/.exec(
        event.message,
      );
    if (match) {
      const names: Record<string, string> = {
        context: 'Evidence gathering',
        investigator: 'Investigation',
        reviewer: 'Evidence review',
        Reliability: 'Reliability review',
        Production: 'Production impact review',
      };
      return `${names[match[1]]} ${match[2]}`;
    }
  }
  if (
    event.action === 'analysis.findings' &&
    event.message === 'Advisory findings recorded; human/domain authorization unchanged'
  )
    return 'AI assessment saved for human review';
  if (event.action === 'analysis.paused' && event.message === 'Analysis waiting for input')
    return 'Human finding requested';
  if (event.action === 'analysis.claimed' && event.message === 'Worker claimed durable analysis')
    return 'AI evidence review started';
  return event.message;
}

type CaseSource = NonNullable<CaseDetail['runs'][number]['sources']>[number];
export function sourceSummary(source: CaseSource): string {
  if (source.status === 'missing')
    return 'No usable records in this analysis. More evidence may be needed.';
  try {
    const data = JSON.parse(source.text) as Record<string, unknown>;
    const count = (key: string) => (Array.isArray(data?.[key]) ? data[key].length : null);
    if (source.id === 'equipment-context' && count('assets') !== null)
      return `${count('assets')} configured equipment ${count('assets') === 1 ? 'record' : 'records'}. Configuration does not establish current condition.`;
    if (source.id === 'equipment-trends' && count('readings') !== null)
      return `${count('readings')} saved observations. Check observation time and quality before use.`;
    if (source.id === 'equipment-history' && !data?.asset_id)
      return 'No equipment selected. Recurrence cannot be assessed from this source.';
    if (source.id === 'equipment-history' && Number.isSafeInteger(data?.recorded_issues))
      return `${data.recorded_issues} recorded equipment cases in the saved 30-day window. Reports are not confirmed failures; linked duplicate incidents are counted once.`;
    if (
      source.id === 'production-context' &&
      count('areas') !== null &&
      count('dependencies') !== null
    )
      return `${count('areas')} production areas and ${count('dependencies')} dependencies. Rated capacity is not measured output.`;
    if (source.id === 'case-evidence' && count('submissions') !== null)
      return `${count('submissions')} staff ${count('submissions') === 1 ? 'submission' : 'submissions'}. Reported findings remain distinct from verified measurements.`;
  } catch {
    // Older sources may contain plain text; preserve their complete original details.
  }
  return source.status === 'reference'
    ? 'Reference material for this assessment. Applicability requires review.'
    : 'Saved evidence for this analysis. Inspect its origin and timestamps.';
}

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
