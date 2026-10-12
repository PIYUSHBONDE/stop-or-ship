import { test, expect } from '@playwright/test';
import { previewCatalog } from '../../src/features/plant/lib/preview-telemetry';
import {
  appendSamples,
  attendedAtFor,
  parseLedger,
  recordTick,
  sampleCount,
  sampleId,
  seriesFor,
  syncCases,
} from '../../src/features/monitoring/lib/preview-records';

const assets = [
  { id: 'P-107', type: 'pump' },
  { id: 'M-101', type: 'motor' },
];

test('each tick stores one record per machine and the same tick does not duplicate', () => {
  const catalog = previewCatalog(assets, 2, 9);
  const first = appendSamples(
    { version: 1, plantId: 'plant-1', lastTick: null, samples: {}, cases: [] },
    { assets, catalog, tick: 2, now: 1000 },
  );
  expect(sampleCount(first)).toBe(2);
  expect(first.samples['P-107'][0].id).toBe(sampleId('P-107', 2));
  const again = appendSamples(first, { assets, catalog, tick: 2, now: 1100 });
  expect(sampleCount(again)).toBe(2);
  const next = appendSamples(first, {
    assets,
    catalog: previewCatalog(assets, 3, 9),
    tick: 3,
    now: 3500,
  });
  expect(sampleCount(next)).toBe(4);
  expect(seriesFor(next.samples['P-107'], 'pressure').length).toBe(2);
});

test('assignment history becomes a cleared case for the operator who fixed it', () => {
  const opened = {
    id: 'ASN-P-107-2',
    operatorId: 'OP-12',
    assetId: 'P-107',
    assetType: 'pump',
    signalId: 'pressure',
    value: 160,
    unit: 'bar',
    low: 140,
    high: 156,
    severity: 'high' as const,
    openedTick: 2,
    openedAt: 1000,
  };
  const open = syncCases(
    { version: 1, plantId: 'plant-1', lastTick: 2, samples: {}, cases: [] },
    [opened],
    [],
    1200,
  );
  expect(open.cases[0].clearedAt).toBeNull();
  expect(open.cases[0].operatorName).toBe('Maya Chen');
  expect(open.cases[0].message).toContain('pressure reached 160 bar');
  expect(open.cases[0].attendedAt).toBeNull();
  const attended = syncCases(
    { version: 1, plantId: 'plant-1', lastTick: 2, samples: {}, cases: open.cases },
    [opened],
    [],
    attendedAtFor(opened) + 10,
  );
  expect(attended.cases[0].attendedAt).toBe(attendedAtFor(opened));
  expect(attended.cases[0].metadata.envelope).toBe('140–156 bar');
  const cleared = recordTick(open, {
    plantId: 'plant-1',
    assets,
    catalog: previewCatalog(assets, 5, 9),
    tick: 5,
    now: 20_000,
    open: [],
    history: [opened],
  });
  expect(cleared.cases[0].clearedAt).toBe(20_000);
  expect(sampleCount(cleared)).toBe(2);
});

test('a ledger from another plant is not reused', () => {
  const stored = JSON.stringify({
    version: 1,
    plantId: 'other',
    lastTick: 4,
    samples: { 'P-107': [{ id: 'REC-P-107-4', assetId: 'P-107', tick: 4, at: 1, readings: [] }] },
    cases: [],
  });
  const parsed = parseLedger(stored, 'plant-1');
  expect(parsed.plantId).toBe('plant-1');
  expect(sampleCount(parsed)).toBe(0);
});
