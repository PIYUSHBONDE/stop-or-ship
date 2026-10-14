import { test, expect } from '@playwright/test';
import {
  captureCaseContext,
  validCaseContext,
  caseJourney,
  simulationCaseStatus,
} from '../../src/features/incidents/lib/simulation-case';
import {
  emptyLedger,
  syncCases,
  parseLedger,
} from '../../src/features/monitoring/lib/preview-records';
import { restoreSimulation } from '../../src/features/operators/lib/simulation-state';
import type { ProcessCatalog } from '../../src/features/plant/lib/process-simulation';

const catalog: ProcessCatalog = {
  assets: [
    {
      id: 'pump',
      name: 'Pump',
      type: 'pump',
      area_id: 'a',
      purpose: '',
      position: [0, 0, 0],
      status: 'healthy',
    },
    {
      id: 'press',
      name: 'Press',
      type: 'press',
      area_id: 'a',
      purpose: '',
      position: [0, 0, 0],
      status: 'healthy',
    },
    {
      id: 'other',
      name: 'Other press',
      type: 'press',
      area_id: 'b',
      purpose: '',
      position: [0, 0, 0],
      status: 'healthy',
    },
  ],
  areas: ['a', 'b'].map((id) => ({
    id,
    name: `Line ${id}`,
    purpose: '',
    nominal_units_per_hour: 100,
  })),
  dependencies: [
    { source: 'pump', target: 'press', relationship: 'supplies', capacity_fraction: 1 },
  ],
};
const assignment = {
  id: 'ASN-1',
  assetId: 'pump',
  assetType: 'pump',
  operatorId: 'OP-12',
  signalId: 'pressure',
  value: 125,
  unit: 'bar',
  low: 140,
  high: 160,
  severity: 'high' as const,
  openedTick: 2,
  openedAt: 1000,
};

test('case retains detection topology despite later configuration and sample eviction', () => {
  const ledger = syncCases(emptyLedger('p'), [assignment], [], 1000, catalog);
  const changed = {
    ...catalog,
    dependencies: [],
    areas: catalog.areas.map((a) => ({ ...a, nominal_units_per_hour: 999 })),
  };
  const later = syncCases(ledger, [], [assignment], 250000, changed);
  const item = later.cases[0];
  expect(item.context).toEqual(captureCaseContext(catalog, 'pump'));
  expect(item.context?.lines).toEqual([{ id: 'a', name: 'Line a', capacity: 100 }]);
  expect(item.context?.affected.map((a) => a.id)).toEqual(['pump', 'press']);
  expect(item.value).toBe(125);
  expect(later.samples).toEqual({});
  expect(parseLedger(JSON.stringify(later), 'p').cases[0].context).toEqual(item.context);
  expect(caseJourney(item).every((s) => s.at)).toBe(true);
  expect(simulationCaseStatus(item)).toBe('recovered');
});

test('legacy and corrupt optional dossiers retain cases without invented history', () => {
  const legacy = syncCases(emptyLedger('p'), [assignment], [], 1000);
  expect(syncCases(legacy, [assignment], [], 2000, catalog).cases[0].context).toBeUndefined();
  const corrupt = {
    ...legacy,
    cases: [{ ...legacy.cases[0], context: { version: 1, lines: null } }],
  };
  const restored = restoreSimulation(null, JSON.stringify(corrupt), 'p', 3000);
  expect(restored.ledger.cases).toHaveLength(1);
  expect(restored.ledger.cases[0].context).toBeUndefined();
  expect(restored.ledger.cases[0].interrupted).toBe(true);
  expect(
    validCaseContext({
      ...captureCaseContext(catalog, 'pump'),
      lines: [{ id: 'a', name: 'Line', capacity: Infinity }],
    }),
  ).toBe(false);
  expect(simulationCaseStatus({ ...legacy.cases[0], fixedAt: 161000 })).toBe('recovering');
  expect(simulationCaseStatus({ ...legacy.cases[0], interrupted: true })).toBe('interrupted');
});
