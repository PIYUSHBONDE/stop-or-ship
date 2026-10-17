import { test, expect } from '@playwright/test';
import {
  excursionAssetId,
  oocAssetIds,
  previewCatalog,
  previewReadingsFor,
  rankFactors,
} from '../../src/features/plant/lib/preview-telemetry';

const types = [
  'pump',
  'motor',
  'press',
  'conveyor',
  'cooling',
  'compressor',
  'electrical',
  'goods',
  'other',
];

test('every equipment type receives finite synthetic preview readings', () => {
  const assets = types.map((type, index) => ({ id: `A-${index}`, type }));
  const catalog = previewCatalog(assets, 3, 11);
  expect(Object.keys(catalog)).toHaveLength(types.length);
  for (const asset of assets) {
    const readings = catalog[asset.id];
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.every((reading) => Number.isFinite(reading.value) && reading.unit)).toBe(true);
  }
});

test('the same asset and tick stay deterministic across calls', () => {
  const asset = { id: 'P-107', type: 'pump' };
  expect(previewReadingsFor(asset, 4, 20)).toEqual(previewReadingsFor(asset, 4, 20));
  expect(previewReadingsFor(asset, 4, 20)).not.toEqual(previewReadingsFor(asset, 5, 20));
});

test('forced excursions mark a cell OOC against preview limits', () => {
  const assets = [
    { id: 'P-107', type: 'pump' },
    { id: 'M-101', type: 'motor' },
  ];
  const tick = 5;
  const seed = 20;
  expect(excursionAssetId(assets, tick, seed)).toBeTruthy();
  const catalog = previewCatalog(assets, tick, seed);
  const flagged = oocAssetIds(catalog);
  expect(flagged.length).toBeGreaterThan(0);
  expect(catalog[flagged[0]].some((reading) => reading.ooc && reading.value > reading.high)).toBe(
    true,
  );
});

test('an excursion moves every factor and includes a fall as well as a rise', () => {
  for (const type of types) {
    const readings = previewReadingsFor({ id: `CELL-${type}`, type }, 5, 20, true);
    const outside = readings.filter((reading) => reading.ooc);
    expect(outside).toHaveLength(readings.length);
    expect(outside.some((reading) => reading.value > reading.high)).toBe(true);
    expect(outside.some((reading) => reading.value < reading.low)).toBe(true);
    const ranked = rankFactors(readings);
    expect(ranked[0].distance).toBeGreaterThanOrEqual(ranked.at(-1)?.distance ?? 0);
    expect(ranked.some((factor) => factor.placement === 'above')).toBe(true);
    expect(ranked.some((factor) => factor.placement === 'below')).toBe(true);
  }
});
