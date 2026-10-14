import type { MachineCase } from '@/features/monitoring/lib/preview-records';
import { downstream, type ProcessCatalog } from '@/features/plant/lib/process-simulation';

/** Saved at detection. Never reconstruct historical impact from today's plant layout. */
export type SimulationCaseContext = {
  version: 1;
  assetName: string;
  affected: { id: string; name: string }[];
  lines: { id: string; name: string; capacity: number }[];
};

export function captureCaseContext(
  catalog: ProcessCatalog,
  assetId: string,
): SimulationCaseContext {
  const ids = downstream(catalog, assetId);
  const affected = catalog.assets.filter((a) => ids.has(a.id));
  return {
    version: 1,
    assetName: catalog.assets.find((a) => a.id === assetId)?.name ?? assetId,
    affected: affected.map(({ id, name }) => ({ id, name })),
    lines: catalog.areas
      .filter(
        (area) =>
          area.nominal_units_per_hour > 0 &&
          affected.some((a) => a.type === 'press' && a.area_id === area.id),
      )
      .map((a) => ({ id: a.id, name: a.name, capacity: a.nominal_units_per_hour })),
  };
}

export function validCaseContext(value: unknown): value is SimulationCaseContext {
  if (!value || typeof value !== 'object') return false;
  const c = value as SimulationCaseContext;
  const text = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 160;
  return (
    c.version === 1 &&
    text(c.assetName) &&
    Array.isArray(c.affected) &&
    c.affected.length <= 36 &&
    c.affected.every((a) => a && text(a.id) && text(a.name)) &&
    Array.isArray(c.lines) &&
    c.lines.length <= 8 &&
    c.lines.every(
      (a) => a && text(a.id) && text(a.name) && Number.isFinite(a.capacity) && a.capacity >= 0,
    )
  );
}

export function simulationCaseStatus(item: MachineCase) {
  return item.interrupted
    ? 'interrupted'
    : item.clearedAt
      ? 'recovered'
      : item.fixedAt
        ? 'recovering'
        : item.attendedAt
          ? 'repairing'
          : 'dispatched';
}

export function caseJourney(item: MachineCase) {
  return [
    {
      title: 'Detected',
      at: item.occurredAt,
      detail: `${item.signalId.replaceAll('_', ' ')} ${item.value} ${item.unit}; synthetic running envelope ${item.metadata.envelope}.`,
    },
    {
      title: 'Attended',
      at: item.attendedAt,
      detail: `${item.operatorName || item.operatorId}; scripted dispatch, not a technician inspection record.`,
    },
    {
      title: 'Repair finished',
      at: item.fixedAt,
      detail: 'Scenario timer completed. No physical fault or repair has been confirmed.',
    },
    {
      title: 'Recovered',
      at: item.clearedAt,
      detail: 'Scenario recovery timer completed. This is not operational verification.',
    },
  ];
}
