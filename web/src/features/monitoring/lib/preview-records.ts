import {
  OPERATORS,
  RECOVERY_MS,
  timelineFor,
  type PreviewAssignment,
} from '@/features/operators/lib/preview-dispatch';
import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';
import type { ProcessCatalog } from '@/features/plant/lib/process-simulation';
import {
  captureCaseContext,
  validCaseContext,
  type SimulationCaseContext,
} from '@/features/incidents/lib/simulation-case';

export const MAX_SAMPLES = 48;
export const MAX_CASES = 40;

export type MachineSample = {
  id: string;
  assetId: string;
  tick: number;
  at: number;
  readings: PreviewReading[];
};

export type CaseMetadata = {
  assignmentId: string;
  openedTick: number;
  assetType: string;
  craft: string;
  years: number;
  low: number;
  high: number;
  envelope: string;
};

export type MachineCase = {
  context?: SimulationCaseContext;
  interrupted?: boolean;
  id: string;
  assetId: string;
  assetType: string;
  operatorId: string;
  operatorName: string;
  signalId: string;
  value: number;
  unit: string;
  severity: string;
  openedAt: number;
  occurredAt: number;
  attendedAt: number | null;
  clearedAt: number | null;
  fixedAt: number | null;
  message: string;
  metadata: CaseMetadata;
};

export type PreviewLedger = {
  version: 1;
  plantId: string;
  lastTick: number | null;
  samples: Record<string, MachineSample[]>;
  cases: MachineCase[];
};

export function sampleId(assetId: string, tick: number) {
  return `REC-${assetId}-${tick}`;
}

export function emptyLedger(plantId: string): PreviewLedger {
  return { version: 1, plantId, lastTick: null, samples: {}, cases: [] };
}

export function ledgerKey(plantId: string) {
  return `plantsense-preview-ledger:${plantId}`;
}

export function sampleCount(ledger: PreviewLedger) {
  return Object.values(ledger.samples).reduce((total, series) => total + series.length, 0);
}

export function attendedAtFor(item: PreviewAssignment) {
  const wait = timelineFor(item.severity).reduce((total, step) => {
    if (step.phase === 'dispatched' || step.phase === 'en_route') return total + step.ms;
    return total;
  }, 0);
  return item.openedAt + wait;
}

export function fixedAtFor(item: PreviewAssignment) {
  return (
    item.openedAt +
    timelineFor(item.severity)
      .filter((step) => step.ooc)
      .reduce((total, step) => total + step.ms, 0)
  );
}

export function caseMessage(item: PreviewAssignment) {
  const signal = item.signalId.replaceAll('_', ' ');
  return `${signal} reached ${item.value} ${item.unit}, outside preview limits ${item.low}–${item.high}. ${item.severity} OOC on ${item.assetId}. Scripted scenario response; no technician finding has been recorded.`;
}

export function seriesFor(samples: MachineSample[], signalId: string) {
  return samples
    .map((sample) => sample.readings.find((reading) => reading.signal_id === signalId)?.value)
    .filter((value): value is number => value !== undefined);
}

export function appendSamples(
  ledger: PreviewLedger,
  input: {
    assets: { id: string }[];
    catalog: Record<string, PreviewReading[]>;
    tick: number;
    now: number;
  },
): PreviewLedger {
  if (ledger.lastTick === input.tick) return ledger;
  const samples = { ...ledger.samples };
  for (const asset of input.assets) {
    const readings = input.catalog[asset.id] || [];
    const series = samples[asset.id] || [];
    if (series.some((sample) => sample.tick === input.tick)) continue;
    samples[asset.id] = [
      ...series,
      {
        id: sampleId(asset.id, input.tick),
        assetId: asset.id,
        tick: input.tick,
        at: input.now,
        readings,
      },
    ].slice(-MAX_SAMPLES);
  }
  return { ...ledger, lastTick: input.tick, samples };
}

export function syncCases(
  ledger: PreviewLedger,
  open: PreviewAssignment[],
  history: PreviewAssignment[],
  now: number,
  context?: ProcessCatalog,
): PreviewLedger {
  const byId = new Map(ledger.cases.map((item) => [item.id, item]));
  for (const item of [...history].reverse()) {
    byId.set(item.id, toCase(item, now, byId.get(item.id), context));
  }
  for (const item of open) {
    byId.set(item.id, toCase(item, now, byId.get(item.id), context));
  }
  const cases = [...byId.values()]
    .sort((left, right) => right.openedAt - left.openedAt)
    .slice(0, MAX_CASES);
  return { ...ledger, cases };
}

export function recordTick(
  ledger: PreviewLedger,
  input: {
    plantId: string;
    assets: { id: string }[];
    catalog: Record<string, PreviewReading[]>;
    tick: number;
    now: number;
    open: PreviewAssignment[];
    history: PreviewAssignment[];
    context?: ProcessCatalog;
  },
): PreviewLedger {
  const base = ledger.plantId === input.plantId ? ledger : emptyLedger(input.plantId);
  return syncCases(appendSamples(base, input), input.open, input.history, input.now, input.context);
}

export function parseLedger(raw: string | null, plantId: string): PreviewLedger {
  if (!raw) return emptyLedger(plantId);
  try {
    const parsed = JSON.parse(raw) as PreviewLedger;
    if (parsed.version !== 1 || parsed.plantId !== plantId || !parsed.samples) {
      return emptyLedger(plantId);
    }
    return {
      version: 1,
      plantId,
      lastTick: typeof parsed.lastTick === 'number' ? parsed.lastTick : null,
      samples: parsed.samples,
      cases: Array.isArray(parsed.cases)
        ? parsed.cases.map((item) => normalizeCase(item)).slice(0, MAX_CASES)
        : [],
    };
  } catch {
    return emptyLedger(plantId);
  }
}

function toCase(
  item: PreviewAssignment,
  now: number,
  existing: MachineCase | undefined,
  context?: ProcessCatalog,
): MachineCase {
  const operator = OPERATORS.find((person) => person.id === item.operatorId);
  const attend = attendedAtFor(item);
  const attendedAt = existing?.attendedAt ?? (now >= attend ? attend : null);
  const completion = fixedAtFor(item);
  const fixedAt =
    existing?.fixedAt ?? existing?.clearedAt ?? (now >= completion ? completion : null);
  const clearedAt =
    existing?.clearedAt ?? (now >= completion + RECOVERY_MS ? completion + RECOVERY_MS : null);
  return {
    ...(existing?.context
      ? { context: existing.context }
      : !existing && context
        ? { context: captureCaseContext(context, item.assetId) }
        : {}),
    id: item.id,
    assetId: item.assetId,
    assetType: item.assetType,
    operatorId: item.operatorId,
    operatorName: operator?.name || item.operatorId,
    signalId: item.signalId,
    value: item.value,
    unit: item.unit,
    severity: item.severity,
    openedAt: item.openedAt,
    occurredAt: existing?.occurredAt ?? item.openedAt,
    attendedAt,
    clearedAt,
    fixedAt,
    message: existing?.message || caseMessage(item),
    metadata: existing?.metadata || {
      assignmentId: item.id,
      openedTick: item.openedTick,
      assetType: item.assetType,
      craft: operator?.craft || 'general',
      years: operator?.years || 0,
      low: item.low,
      high: item.high,
      envelope: `${item.low}–${item.high} ${item.unit}`,
    },
  };
}

export function normalizeCase(raw: Partial<MachineCase> & { id?: string }): MachineCase {
  const openedAt = raw.openedAt ?? raw.occurredAt ?? 0;
  const clearedAt = raw.clearedAt ?? raw.fixedAt ?? null;
  return {
    ...(validCaseContext(raw.context) ? { context: raw.context } : {}),
    id: raw.id || 'ASN-unknown',
    assetId: raw.assetId || '',
    assetType: raw.assetType || raw.metadata?.assetType || '',
    operatorId: raw.operatorId || '',
    operatorName: raw.operatorName || raw.operatorId || '',
    signalId: raw.signalId || '',
    value: raw.value ?? 0,
    unit: raw.unit || '',
    severity: raw.severity || 'medium',
    openedAt,
    occurredAt: raw.occurredAt ?? openedAt,
    attendedAt: raw.attendedAt ?? null,
    clearedAt,
    fixedAt: raw.fixedAt ?? clearedAt,
    message: raw.message || '',
    metadata: raw.metadata || {
      assignmentId: raw.id || '',
      openedTick: 0,
      assetType: raw.assetType || '',
      craft: '',
      years: 0,
      low: 0,
      high: 0,
      envelope: '',
    },
  };
}
