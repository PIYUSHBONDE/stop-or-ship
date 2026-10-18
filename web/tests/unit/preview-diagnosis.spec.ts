import { test, expect } from '@playwright/test';
import {
  diagnosePreview,
  readingEpisodes,
  textMatchScore,
  type DiagnosisSample,
} from '../../src/features/monitoring/lib/preview-diagnosis';
import type { PreviewReading } from '../../src/features/plant/lib/preview-telemetry';

function reading(
  signal_id: string,
  value: number,
  low: number,
  high: number,
  unit: string,
): PreviewReading {
  return { signal_id, value, low, high, unit, ooc: value < low || value > high };
}

function pump(at: number, pressure: number, flow: number, temperature: number): DiagnosisSample {
  return {
    id: `REC-${at}`,
    at,
    readings: [
      reading('pressure', pressure, 139.6, 156.4, 'bar'),
      reading('flow', flow, 35.8, 46.3, 'L/min'),
      reading('temperature', temperature, 47.7, 60.3, '°C'),
    ],
  };
}

test('consecutive ticks with the same pattern collapse into one stretch', () => {
  const episodes = readingEpisodes([
    pump(1, 154.8, 36.1, 58.4),
    pump(2, 148, 36, 60),
    pump(3, 129.6, 26, 54.9),
    pump(4, 129.6, 23.4, 60),
    pump(5, 0, 0, 48.4),
    pump(6, 0, 0, 55),
  ]);
  expect(episodes.map((episode) => episode.title)).toEqual([
    'Inside the limit',
    'Pressure below its limit, flow below its limit',
    'Pressure at zero, flow at zero',
  ]);
  expect(episodes[2].count).toBe(2);
  expect(episodes[2].summary).toContain('pressure at 0');
  expect(episodes[2].summary).toContain('temperature near');
});

test('the first pump failure suggests the inlet check', () => {
  const diagnosis = diagnosePreview('pump', [pump(1, 0, 0, 50)], []);
  expect(diagnosis.active).toBe(true);
  expect(diagnosis.repeated).toBe(false);
  expect(diagnosis.suggested?.title).toContain('suction strainer');
  expect(diagnosis.branches.find((branch) => branch.matched)?.title).toBe('Pump is not delivering');
  expect(diagnosis.summary).toContain('Pump is not delivering');
  expect(diagnosis.summary).toContain('at zero');
});

test('comment match is the unadjusted word overlap', () => {
  expect(textMatchScore('pressure flow pump', 'pressure flow pump').percent).toBe(100);
  expect(textMatchScore('pressure flow pump', 'temperature vibration speed').percent).toBe(0);
  expect(textMatchScore('pressure flow pump', 'pressure').percent).toBe(50);
  expect(textMatchScore('', 'pressure flow').percent).toBe(0);
  expect(textMatchScore('pressure flow pump', 'pressure').shared).toEqual(['pressure']);
});

test('a repaired case does not skip ahead unless that task was recorded', () => {
  const samples = [pump(1, 129.6, 24, 54)];
  const unmarked = diagnosePreview('pump', samples, [
    { id: 'ASN-1', signalId: 'pressure', fixed: true },
    { id: 'ASN-2', signalId: 'flow', fixed: true },
  ]);
  expect(unmarked.repeated).toBe(false);
  expect(unmarked.suggested?.title).toContain('suction strainer');

  const suction = diagnosePreview('pump', samples, []).suggested?.title ?? '';
  const once = diagnosePreview('pump', samples, [
    { id: 'ASN-1', signalId: 'pressure', fixed: true, taskTitle: suction },
  ]);
  expect(once.repeated).toBe(true);
  expect(once.suggested?.title).toContain('relief valve');
  expect(once.branches.find((branch) => branch.matched)?.tasks.map((task) => task.state)).toEqual([
    'done',
    'suggested',
    'later',
  ]);

  const relief = once.suggested?.title ?? '';
  const twice = diagnosePreview('pump', samples, [
    { id: 'ASN-1', signalId: 'pressure', fixed: true, taskTitle: suction },
    { id: 'ASN-2', signalId: 'flow', fixed: true, taskTitle: relief },
  ]);
  expect(twice.suggested?.title).toContain('pump element');

  const open = diagnosePreview('pump', samples, [
    { id: 'ASN-3', signalId: 'pressure', fixed: false, taskTitle: suction },
  ]);
  expect(open.suggested?.title).toContain('suction strainer');
});
