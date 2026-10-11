import { test, expect } from '@playwright/test';
import { guideFor, machineAddress } from '../../src/features/memory/lib/plant-guide';

test('each common machine type has break, fix and guide copy', () => {
  for (const type of [
    'pump',
    'motor',
    'press',
    'conveyor',
    'cooling',
    'compressor',
    'electrical',
    'goods',
  ]) {
    const guide = guideFor(type);
    expect(guide.canBreak.length).toBeGreaterThan(0);
    expect(guide.canFix.length).toBeGreaterThan(0);
    expect(guide.guide.length).toBeGreaterThan(0);
  }
});

test('machine address uses area name and floor coordinates', () => {
  expect(
    machineAddress({ id: 'FG-001', area_id: 'goods', position: [4, 0, -2] }, 'Goods bay'),
  ).toBe('Goods bay · station FG-001 · floor 4.0 m east, -2.0 m north');
});
