import type { CaseDetail } from './presentation';

function savedSource(detail: CaseDetail, id: string): unknown {
  const run = detail.runs.find((item) => item.analysis_version === detail.case.analysis_version);
  const source = run?.sources?.find((item) => item.id === id);
  if (!source || source.status === 'missing') return null;
  try {
    return JSON.parse(source.text) as unknown;
  } catch {
    return null;
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export type VerifiedRepair = {
  id: string;
  asset_id: string;
  observed_cause: string;
  fix: string;
  outcome: string;
  verified_at: string;
};
export function verifiedRepairs(detail: CaseDetail): VerifiedRepair[] {
  const payload = savedSource(detail, 'scoped-knowledge');
  if (!record(payload) || !Array.isArray(payload.verified_repairs)) return [];
  return payload.verified_repairs.slice(0, 3).flatMap((item: unknown) => {
    if (
      !record(item) ||
      item.origin !== 'verified_repair' ||
      typeof item.id !== 'string' ||
      typeof item.text !== 'string'
    )
      return [];
    try {
      const fields: unknown = JSON.parse(item.text);
      if (
        !record(fields) ||
        typeof fields.asset_id !== 'string' ||
        typeof fields.observed_cause !== 'string' ||
        typeof fields.fix !== 'string' ||
        typeof fields.outcome !== 'string'
      )
        return [];
      return [
        {
          id: item.id,
          asset_id: fields.asset_id,
          observed_cause: fields.observed_cause,
          fix: fields.fix,
          outcome: fields.outcome,
          verified_at: typeof fields.verified_at === 'string' ? fields.verified_at : '',
        },
      ];
    } catch {
      return [];
    }
  });
}
export type RecordedHistory = {
  count: number;
  windowDays: number;
  capturedAt: string;
  cases: { id: string; title: string; createdAt: string; origin: string }[];
};
export function recordedHistory(detail: CaseDetail): RecordedHistory | null {
  const payload = savedSource(detail, 'equipment-history');
  if (
    !record(payload) ||
    payload.origin !== 'recorded_case_history' ||
    typeof payload.asset_id !== 'string' ||
    !payload.asset_id ||
    payload.asset_id !== detail.case.asset_id ||
    !Number.isSafeInteger(payload.recorded_issues) ||
    (payload.recorded_issues as number) < 0 ||
    payload.window_days !== 30 ||
    typeof payload.captured_at !== 'string' ||
    !Array.isArray(payload.cases)
  )
    return null;
  return {
    count: payload.recorded_issues as number,
    windowDays: payload.window_days,
    capturedAt: payload.captured_at,
    cases: payload.cases.slice(0, 10).flatMap((item: unknown) => {
      if (
        !record(item) ||
        typeof item.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(item.id) ||
        typeof item.title !== 'string' ||
        typeof item.created_at !== 'string' ||
        typeof item.origin !== 'string'
      )
        return [];
      return [{ id: item.id, title: item.title, createdAt: item.created_at, origin: item.origin }];
    }),
  };
}
