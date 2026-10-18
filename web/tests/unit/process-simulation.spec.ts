import { test, expect } from '@playwright/test';
import {
  advanceProcess,
  commandProcess,
  freshProcess,
  processView,
  type ProcessCatalog,
} from '../../src/features/plant/lib/process-simulation';
import { fixedAtFor, recordTick } from '../../src/features/monitoring/lib/preview-records';
import { emptyLedger } from '../../src/features/monitoring/lib/preview-records';
import type { DispatchSnapshot } from '../../src/features/operators/lib/preview-dispatch';

const catalog: ProcessCatalog = {
  areas: ['a', 'b'].map((id) => ({
    id,
    name: `Line ${id}`,
    purpose: 'Hydraulic forming',
    nominal_units_per_hour: 100,
  })),
  assets: ['a', 'b'].flatMap((line, i) =>
    ['motor', 'pump', 'press', 'conveyor'].map((type) => ({
      id: `${type}-${line}`,
      name: `${type} ${line}`,
      type,
      area_id: line,
      purpose: 'Formed components',
      position: [i * 4, 0, 0],
      status: 'healthy' as const,
    })),
  ),
  dependencies: ['a', 'b'].flatMap((line) =>
    [
      ['motor', 'pump'],
      ['pump', 'press'],
      ['press', 'conveyor'],
    ].map(([a, b]) => ({
      source: `${a}-${line}`,
      target: `${b}-${line}`,
      relationship: 'supports',
      capacity_fraction: 1,
    })),
  ),
};

test('healthy production stays stable until a defined fault and paused time cannot dispatch', () => {
  const start = freshProcess(1000);
  const paused = commandProcess(start, { type: 'pause' }, catalog);
  expect(
    advanceProcess(paused, { open: [], history: [] }, catalog, 100000, 3, 7).process.elapsed,
  ).toBe(0);
  const normal = advanceProcess(start, { open: [], history: [] }, catalog, 50000, 23, 7);
  const view = processView(normal.process, normal.snapshot, catalog, 23, 7);
  expect(view.output).toBe(200);
  expect(normal.snapshot.open).toEqual([]);
  expect(
    Object.values(view.readings)
      .flat()
      .every((r) => !r.ooc && Number.isFinite(r.value)),
  ).toBe(true);
  const scheduled = advanceProcess(normal.process, normal.snapshot, catalog, 10000, 27, 7);
  expect(scheduled.process.fault?.assetId).toBe('pump-a');
  expect(() => commandProcess(start, { type: 'fault', assetId: 'press-a' }, catalog)).toThrow();
  let controls = start;
  for (let i = 0; i < 60; i++) controls = commandProcess(controls, { type: 'pause' }, catalog);
  expect(controls.events).toHaveLength(40);
  expect(new Set(controls.events.map((e) => e.id)).size).toBe(40);
});

test('pump fault derates only its dependent line, stops for repair and verifies recovery before closure', () => {
  let process = commandProcess(freshProcess(1000), { type: 'fault', assetId: 'pump-a' }, catalog);
  let snapshot: DispatchSnapshot = { open: [], history: [] };
  const step = (delta: number, tick: number) => {
    ({ process, snapshot } = advanceProcess(process, snapshot, catalog, delta, tick, 7));
    return processView(process, snapshot, catalog, tick, 7);
  };
  expect(step(4000, 4).lines[0].rate).toBeLessThan(100);
  expect(snapshot.open).toHaveLength(0);
  expect(step(4000, 5).lines[1].rate).toBe(100);
  expect(snapshot.open).toHaveLength(1);
  expect(snapshot.open[0].assetId).toBe('pump-a');
  const repair = step(26000, 16);
  expect(repair.modes['pump-a']).toBe('under_repair');
  expect(repair.modes['press-a']).toBe('stopped');
  expect(repair.modes['motor-a']).toBe('idle');
  expect(repair.lines.map((l) => l.rate)).toEqual([0, 100]);
  const completion = fixedAtFor(snapshot.open[0]);
  const recovery = step(completion - process.epoch - process.elapsed, 70);
  expect(recovery.phase).toBe('recovering');
  expect(recovery.lines[0].rate).toBe(40);
  expect(recovery.readings['pump-a'].every((r) => !r.ooc)).toBe(true);
  const ledger = recordTick(emptyLedger('p'), {
    plantId: 'p',
    assets: catalog.assets,
    catalog: recovery.readings,
    tick: 70,
    now: recovery.now,
    open: snapshot.open,
    history: snapshot.history,
  });
  expect(ledger.cases[0].fixedAt).toBe(completion);
  expect(ledger.cases[0].clearedAt).toBeNull();
  process = commandProcess(process, { type: 'pause' }, catalog);
  expect(step(100000, 70).phase).toBe('recovering');
  process = commandProcess(process, { type: 'pause' }, catalog);
  const restored = step(30000, 82);
  expect(restored.output).toBe(200);
  expect(restored.phase).toBe('cleared');
  const cleared = recordTick(ledger, {
    plantId: 'p',
    assets: catalog.assets,
    catalog: restored.readings,
    tick: 82,
    now: restored.now,
    open: snapshot.open,
    history: snapshot.history,
  });
  expect(cleared.cases[0].clearedAt).toBe(completion + 30000);
  step(21000, 91);
  expect(process.fault).toBeNull();
  expect(snapshot.open).toHaveLength(0);
  expect(snapshot.history).toHaveLength(1);
});
