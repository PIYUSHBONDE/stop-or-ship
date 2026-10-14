import {
  emptyLedger,
  parseLedger,
  type PreviewLedger,
} from '@/features/monitoring/lib/preview-records';
import type { DispatchSnapshot } from './preview-dispatch';

export type SimulationState = {
  version: 2;
  plantId: string;
  seed: number;
  tick: number;
  advancedAt: number;
  snapshot: DispatchSnapshot;
  ledger: PreviewLedger;
};
export const simulationKey = (plantId: string) => `plantsense-simulation-v2:${plantId}`;

export function restoreSimulation(
  raw: string | null,
  legacy: string | null,
  plantId: string,
  now: number,
): SimulationState {
  if (raw) {
    const state = JSON.parse(raw) as SimulationState;
    if (
      state.version !== 2 ||
      state.plantId !== plantId ||
      !Number.isSafeInteger(state.tick) ||
      state.tick < 2 ||
      !Number.isFinite(state.seed) ||
      !Number.isFinite(state.advancedAt) ||
      !Array.isArray(state.snapshot?.open) ||
      !Array.isArray(state.snapshot?.history)
    )
      throw new Error('Invalid simulation state');
    validateLedger(state.ledger, plantId);
    for (const item of [...state.snapshot.open, ...state.snapshot.history]) {
      if (
        !item.id ||
        !item.assetId ||
        !item.operatorId ||
        !Number.isFinite(item.openedAt) ||
        !Number.isSafeInteger(item.openedTick) ||
        typeof item.signalId !== 'string' ||
        typeof item.unit !== 'string' ||
        typeof item.assetType !== 'string' ||
        !['low', 'medium', 'high', 'critical'].includes(item.severity) ||
        ![item.value, item.low, item.high].every(Number.isFinite)
      )
        throw new Error('Invalid dispatch state');
    }
    return state;
  }
  if (legacy) {
    const saved = JSON.parse(legacy);
    if (saved.version !== 1 || saved.plantId !== plantId || !saved.samples)
      throw new Error('Invalid legacy ledger');
  }
  const ledger = legacy ? parseLedger(legacy, plantId) : emptyLedger(plantId);
  validateLedger(ledger, plantId);
  const ticks = [
    2,
    ledger.lastTick ?? 2,
    ...Object.values(ledger.samples)
      .flat()
      .map((s) => s.tick),
    ...ledger.cases.map((c) => c.metadata.openedTick),
  ];
  return {
    version: 2,
    plantId,
    seed: now % 9973,
    tick: Math.max(...ticks) + 1,
    advancedAt: now,
    snapshot: { open: [], history: [] },
    ledger: {
      ...ledger,
      cases: ledger.cases.map((c) => (c.fixedAt ? c : { ...c, interrupted: true })),
    },
  };
}

function validateLedger(ledger: PreviewLedger, plantId: string) {
  if (ledger.plantId !== plantId || !ledger.samples || !Array.isArray(ledger.cases))
    throw new Error('Invalid ledger');
  for (const item of ledger.cases) {
    if (
      ![
        item.id,
        item.assetId,
        item.assetType,
        item.operatorId,
        item.operatorName,
        item.signalId,
        item.unit,
        item.severity,
        item.message,
        item.metadata?.assignmentId,
        item.metadata?.craft,
        item.metadata?.envelope,
      ].every((value) => typeof value === 'string') ||
      !Number.isFinite(item.metadata?.years) ||
      !item.id ||
      !item.assetId ||
      typeof item.message !== 'string' ||
      typeof item.severity !== 'string' ||
      !Number.isFinite(item.occurredAt) ||
      !Number.isSafeInteger(item.metadata?.openedTick) ||
      typeof item.signalId !== 'string' ||
      typeof item.unit !== 'string' ||
      ![item.value, item.metadata.low, item.metadata.high].every(Number.isFinite)
    )
      throw new Error('Invalid saved case');
  }
  for (const samples of Object.values(ledger.samples)) {
    if (
      !Array.isArray(samples) ||
      samples.some(
        (s) =>
          typeof s.id !== 'string' ||
          typeof s.assetId !== 'string' ||
          !Number.isSafeInteger(s.tick) ||
          !Number.isFinite(s.at) ||
          !Array.isArray(s.readings) ||
          s.readings.some(
            (r) =>
              typeof r.signal_id !== 'string' ||
              typeof r.unit !== 'string' ||
              typeof r.ooc !== 'boolean' ||
              ![r.value, r.low, r.high].every(Number.isFinite),
          ),
      )
    )
      throw new Error('Invalid samples');
  }
}
