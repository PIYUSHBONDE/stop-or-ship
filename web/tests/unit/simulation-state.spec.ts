import { test, expect } from '@playwright/test';
import { restoreSimulation } from '../../src/features/operators/lib/simulation-state';
import { reconcileDispatch } from '../../src/features/operators/lib/preview-dispatch';
import { emptyLedger, syncCases } from '../../src/features/monitoring/lib/preview-records';

test('legacy samples survive migration and ticks never collide after refresh', () => {
  const ledger = emptyLedger('p');
  ledger.lastTick = 100;
  ledger.samples['P-107'] = [{ id: 'old', assetId: 'P-107', tick: 100, at: 10, readings: [] }];
  const state = restoreSimulation(null, JSON.stringify(ledger), 'p', 1000);
  expect(state.tick).toBe(101);
  expect(state.ledger.samples['P-107'][0].id).toBe('old');
  expect(restoreSimulation(JSON.stringify(state), null, 'p', 2000)).toEqual(state);
  expect(() => restoreSimulation(JSON.stringify(state), null, 'other', 2000)).toThrow();
  expect(() => restoreSimulation('{broken', null, 'p', 2000)).toThrow();
  const malformed = structuredClone(state);
  malformed.ledger.samples['P-107'][0].readings = [{ value: 1, low: 0, high: 2 } as never];
  expect(() => restoreSimulation(JSON.stringify(malformed), null, 'p', 2000)).toThrow();
});

test('saved dispatch completes once after elapsed time', () => {
  const asset = { id: 'P-107', type: 'pump', position: [0, 0, 0] };
  const catalog = {
    'P-107': [{ signal_id: 'pressure', value: 200, low: 140, high: 160, unit: 'bar', ooc: true }],
  };
  const snapshot = reconcileDispatch(
    { open: [], history: [] },
    { assets: [asset], catalog, tick: 10, now: 1000 },
  );
  expect(snapshot.open).toHaveLength(1);
  const legacy = syncCases(emptyLedger('p'), snapshot.open, [], 1000);
  const migrated = restoreSimulation(null, JSON.stringify(legacy), 'p', 2000);
  expect(migrated.ledger.cases[0].id).toBe(snapshot.open[0].id);
  expect(migrated.ledger.cases[0].interrupted).toBe(true);
  expect(migrated.snapshot.open).toEqual([]);
  const malformedCase = structuredClone(migrated);
  malformedCase.ledger.cases[0].operatorName = {} as never;
  expect(() => restoreSimulation(JSON.stringify(malformedCase), null, 'p', 2000)).toThrow();
  const state = restoreSimulation(null, null, 'p', 1000);
  state.snapshot = snapshot;
  const saved = restoreSimulation(JSON.stringify(state), null, 'p', 999999);
  const input = { assets: [asset], catalog: { 'P-107': [] }, tick: 11, now: 999999 };
  const completed = reconcileDispatch(saved.snapshot, input);
  expect(completed.open).toHaveLength(0);
  expect(completed.history).toHaveLength(1);
  expect(reconcileDispatch(completed, input).history).toHaveLength(1);
});
