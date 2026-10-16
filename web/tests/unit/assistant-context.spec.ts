import { test, expect } from '@playwright/test';
import { assistantSelection, captureSimulationContext } from '../../src/features/assistant/context';
import { emptyLedger, syncCases } from '../../src/features/monitoring/lib/preview-records';
import { freshProcess, processView } from '../../src/features/plant/lib/process-simulation';
import { liveAssignment } from '../../src/features/operators/lib/preview-dispatch';
import type { State } from '../../src/lib/types';

const catalog = {
  assets: Array.from({ length: 42 }, (_, i) => ({
    id: `asset-${i}`,
    name: `Machine ${i}`,
    type: 'pump',
    area_id: 'line-a',
    purpose: 'Authored fixture',
    position: [i, 0, 0],
    status: 'healthy' as const,
  })),
  areas: [{ id: 'line-a', name: 'Line A', purpose: 'Fixture', nominal_units_per_hour: 100 }],
  dependencies: [],
};
const saved = {
  id: 'saved',
  assetId: 'asset-41',
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
const active = { ...saved, id: 'active', assetId: 'asset-0', operatorId: 'OP-04' };
function fixture() {
  const process = freshProcess(1000);
  const view = processView(process, { open: [], history: [] }, catalog, 3, 1);
  const ledger = syncCases(emptyLedger('plant'), [], [saved], 300000, catalog);
  return {
    assignments: [liveAssignment(active, 10000)],
    history: [liveAssignment(saved, 300000)],
    ledger,
    process,
    view,
    readings: view.readings,
  };
}
const state = { ...catalog, incident: null };

test('route and operator selection override stale global equipment; list pages clear it', () => {
  const simulation = fixture();
  for (const route of ['/monitoring/asset-41', '/memory/asset-41']) {
    expect(
      assistantSelection(route, new URLSearchParams(), 'asset-0', state, simulation).context
        .asset_id,
    ).toBe('asset-41');
  }
  for (const route of ['/monitoring', '/memory', '/plant-setup']) {
    expect(
      assistantSelection(route, new URLSearchParams(), 'asset-0', state, simulation).context
        .asset_id,
    ).toBeNull();
  }
  for (const query of ['assignment=saved', 'operator=OP-12']) {
    const result = assistantSelection(
      '/operators',
      new URLSearchParams(query),
      'asset-0',
      state,
      simulation,
    );
    expect(result.context.asset_id).toBe('asset-41');
    expect(result.selectedCase?.id).toBe('saved');
    expect(result.assignment).toBeUndefined();
  }
});

test('selected equipment beyond 36 retains readings, saved detection and original topology', () => {
  const simulation = fixture();
  const selection = assistantSelection(
    '/operators',
    new URLSearchParams('assignment=saved'),
    'asset-0',
    state,
    simulation,
  );
  const captured = captureSimulationContext(state, simulation, selection);
  expect(captured.equipment).toHaveLength(36);
  expect(captured.equipment[0].asset_id).toBe('asset-41');
  expect(captured.equipment[0].readings.length).toBeGreaterThan(0);
  expect(captured.case_evidence?.detection.value).toBe(125);
  expect(captured.case_evidence?.topology_captured).toBe(true);
  expect(captured.case_evidence?.recovery_basis).toBe('scenario_timer');
  expect(captured.process?.lines[0].output_per_hour).toBe(100);
  expect(captured.process?.paused).toBe(false);
  simulation.readings['asset-41'][0].value = 999;
  expect(captured.equipment[0].readings[0].value).not.toBe(999);
  delete simulation.ledger.cases[0].context;
  expect(
    captureSimulationContext(state, simulation, selection).case_evidence?.topology_captured,
  ).toBe(false);
});

test('active operator context includes the named roster and phase without unrelated incident evidence', () => {
  const simulation = fixture();
  const incident = { id: 'incident-1', asset_id: 'asset-41' } as NonNullable<State['incident']>;
  const selection = assistantSelection(
    '/operators',
    new URLSearchParams('operator=OP-04'),
    'asset-41',
    { ...state, incident },
    simulation,
  );
  expect(selection.context).toEqual({ asset_id: 'asset-0', incident_id: null });
  const captured = captureSimulationContext(state, simulation, selection);
  expect(captured.selected_assignment_id).toBe('active');
  expect(captured.assignments[0]).toMatchObject({
    operator_name: 'Priya Sen',
    craft: 'mechanical',
    experience_years: 3,
  });
  const operational = assistantSelection(
    '/incidents',
    new URLSearchParams('incident=incident-1&case=saved'),
    'asset-0',
    { ...state, incident },
    simulation,
  );
  expect(operational.synthetic).toBe(false);
  expect(operational.context.incident_id).toBe('incident-1');
  expect(
    assistantSelection(
      '/incidents',
      new URLSearchParams('incident=still-loading'),
      'asset-0',
      { ...state, incident },
      simulation,
    ).error,
  ).toContain('loading');
  const observations = assistantSelection(
    '/plant',
    new URLSearchParams('view=observations'),
    'asset-41',
    { ...state, incident },
    simulation,
  );
  expect(observations.context.incident_id).toBe('incident-1');
  const missingCase = assistantSelection(
    '/incidents',
    new URLSearchParams('case=missing'),
    'asset-0',
    { ...state, incident },
    simulation,
  );
  expect(missingCase.synthetic).toBe(true);
  expect(missingCase.context.incident_id).toBeNull();
  expect(missingCase.error).toContain('not available');
});
