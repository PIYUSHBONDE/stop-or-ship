import { test, expect } from '@playwright/test';
import { previewCatalog } from '../../src/features/plant/lib/preview-telemetry';
import {
  MIN_FIX_MS,
  OPERATORS,
  actorPosition,
  assignmentId,
  liveAssignment,
  pickOperator,
  rateOoc,
  reconcileDispatch,
  timelineFor,
  timelineMs,
  selectAssignment,
} from '../../src/features/operators/lib/preview-dispatch';

const assets = [
  { id: 'PR-1', type: 'press', position: [4, 0, 2] },
  { id: 'P-107', type: 'pump', position: [0, 0, 0] },
  { id: 'G-1', type: 'goods', position: [-4, 0, 2] },
];

test('requested historical assignment takes precedence over an unrelated active job', () => {
  const active = { id: 'active', operatorId: 'OP-04' };
  const completed = { id: 'completed', operatorId: 'OP-12' };
  expect(selectAssignment([active], [completed], 'completed')).toBe(completed);
  expect(selectAssignment([active], [completed], 'OP-12')).toBe(completed);
  expect(selectAssignment([active], [completed], 'active')).toBe(active);
  expect(selectAssignment([active], [completed], null)).toBe(active);
  expect(selectAssignment([], [completed], 'completed')).toBe(completed);
});

test('press excursions rate as critical and assign the most experienced idle operator', () => {
  const catalog = previewCatalog(assets, 5, 20);
  const press = rateOoc(catalog['PR-1'], 'press');
  expect(press?.severity).toBe('critical');
  const chosen = pickOperator(OPERATORS, [], press!.severity);
  expect(chosen?.id).toBe('OP-31');
  expect(chosen?.years).toBeGreaterThanOrEqual(8);
});

test('low severity prefers the junior operator and skips busy seniors', () => {
  const junior = pickOperator(OPERATORS, [], 'low');
  expect(junior?.id).toBe('OP-27');
  const next = pickOperator(OPERATORS, ['OP-27'], 'low');
  expect(next?.years).toBeLessThan(5);
  const onlyLead = pickOperator(OPERATORS, ['OP-04', 'OP-12', 'OP-19', 'OP-27'], 'critical');
  expect(onlyLead?.id).toBe('OP-31');
});

test('an OOC tick opens one assignment ID and later ticks do not duplicate it', () => {
  const catalog = previewCatalog(assets, 5, 20);
  const first = reconcileDispatch(
    { open: [], history: [] },
    { assets, catalog, tick: 5, now: 1_000 },
  );
  expect(first.open).toHaveLength(1);
  expect(first.open[0].id).toBe(assignmentId(first.open[0].assetId, 5));
  const again = reconcileDispatch(first, { assets, catalog, tick: 5, now: 1_100 });
  expect(again.open.map((item) => item.id)).toEqual(first.open.map((item) => item.id));
});

test('assignment phases walk to the cell, clear OOC, then return', () => {
  const item = {
    id: 'ASN-P-107-5',
    operatorId: 'OP-12',
    assetId: 'P-107',
    assetType: 'pump',
    signalId: 'pressure',
    value: 160,
    unit: 'bar',
    low: 140,
    high: 156,
    severity: 'high' as const,
    openedTick: 5,
    openedAt: 0,
  };
  const steps = timelineFor(item.severity);
  const dispatched = steps[0].ms;
  const walkingAt = dispatched + steps[1].ms / 2;
  const correctingAt = dispatched + steps[1].ms + steps[2].ms + 1_000;
  expect(steps.find((step) => step.phase === 'correcting')?.ms).toBeGreaterThanOrEqual(MIN_FIX_MS);
  expect(liveAssignment(item, dispatched - 1).phase).toBe('dispatched');
  const walking = liveAssignment(item, walkingAt);
  expect(walking.phase).toBe('en_route');
  expect(walking.ooc).toBe(true);
  expect(walking.travel).toBeGreaterThan(0);
  expect(walking.travel).toBeLessThan(1);
  expect(liveAssignment(item, correctingAt).phase).toBe('correcting');
  expect(liveAssignment(item, correctingAt).ooc).toBe(true);
  expect(liveAssignment(item, walkingAt, true).phase).toBe('en_route');
  expect(liveAssignment(item, correctingAt, true).phase).toBe('correcting');
  expect(liveAssignment(item, timelineMs(item.severity) + 1).phase).toBe('returned');
  const mid = actorPosition(
    OPERATORS.find((operator) => operator.id === 'OP-12')!,
    walking,
    assets,
  );
  const start = actorPosition(
    OPERATORS.find((operator) => operator.id === 'OP-12')!,
    { ...walking, phase: 'dispatched', travel: 0 },
    assets,
  );
  expect(mid[0]).toBeGreaterThan(start[0]);
  expect(mid[0]).toBeLessThan(0.1);
});
