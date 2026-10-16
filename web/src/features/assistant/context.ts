import type { components } from '@/lib/generated/api-schema';
import type { State } from '@/lib/types';
import type { PreviewLedger } from '@/features/monitoring/lib/preview-records';
import {
  OPERATORS,
  selectAssignment,
  type LiveAssignment,
} from '@/features/operators/lib/preview-dispatch';
import type { ProcessState, processView } from '@/features/plant/lib/process-simulation';
import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';
import { simulationCaseStatus, validCaseContext } from '@/features/incidents/lib/simulation-case';

type Schema = components['schemas'];
type Simulation = {
  assignments: LiveAssignment[];
  history: LiveAssignment[];
  ledger: PreviewLedger;
  readings: Record<string, PreviewReading[]>;
  process: ProcessState | null;
  view: ReturnType<typeof processView> | null;
};

export function assistantSelection(
  pathname: string,
  query: { get: (key: string) => string | null },
  selected: string,
  state: Pick<State, 'assets' | 'incident'>,
  simulation: Pick<Simulation, 'assignments' | 'history' | 'ledger'>,
) {
  const caseScreen = pathname === '/incidents' && !query.get('incident');
  const caseId = caseScreen ? query.get('case') || query.get('assignment') : null;
  const selectedCase = simulation.ledger.cases.find((c) => c.id === caseId);
  const operatorResponse =
    pathname === '/operators'
      ? selectAssignment(
          simulation.assignments,
          simulation.history,
          query.get('assignment') || query.get('operator'),
        )
      : undefined;
  const assignment = simulation.assignments.find((a) => a.id === operatorResponse?.id);
  const operatorCase = simulation.ledger.cases.find((c) => c.id === operatorResponse?.id);
  const caseRecord = pathname === '/operators' ? operatorCase : selectedCase;
  const synthetic =
    !!caseRecord ||
    !!caseId ||
    pathname === '/operators' ||
    pathname.startsWith('/monitoring') ||
    (pathname === '/plant' && query.get('view') !== 'observations');
  const incidentScreen =
    pathname === '/incidents' || pathname === '/maintenance' || !!query.get('incident');
  const matchingObservation =
    pathname === '/plant' &&
    query.get('view') === 'observations' &&
    state.incident?.asset_id === selected;
  const incident = !synthetic && (incidentScreen || matchingObservation) ? state.incident : null;
  const requestedIncident = query.get('incident');
  const routeAsset = /^\/(?:monitoring|memory)\/([^/]+)$/.exec(pathname)?.[1];
  const routeAssetId = routeAsset ? decodeURIComponent(routeAsset) : null;
  const candidate =
    routeAssetId ||
    caseRecord?.assetId ||
    operatorResponse?.assetId ||
    incident?.asset_id ||
    (pathname === '/plant' ? selected : null);
  const assetId = state.assets.some((a) => a.id === candidate) ? candidate : null;
  const context = {
    asset_id: assetId,
    incident_id: incident?.asset_id === assetId ? incident.id : null,
  };
  const error =
    requestedIncident && !synthetic && incident?.id !== requestedIncident
      ? 'The selected incident is still loading. Try again when its evidence is available.'
      : caseId && !selectedCase
        ? 'The selected simulated case is not available. Wait for its records or select another case.'
        : routeAssetId && !assetId
          ? 'The selected equipment is not in this plant.'
          : null;
  return {
    context,
    synthetic,
    selectedCase: caseRecord,
    assignment,
    error,
    key: JSON.stringify({
      pathname,
      ...context,
      synthetic,
      case: caseRecord?.id,
      assignment: operatorResponse?.id,
    }),
  };
}

type Selection = ReturnType<typeof assistantSelection>;

function timestamp(value: number | null) {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function captureSimulationContext(
  state: Pick<State, 'assets' | 'areas'>,
  simulation: Simulation,
  selection: Selection,
): Schema['SimulationContext'] {
  const { selectedCase, assignment } = selection;
  const allowed = new Set(state.assets.map((a) => a.id));
  const areaIds = new Set(state.areas.map((a) => a.id));
  // Prioritize the selected and affected equipment before applying the contract bound.
  const priority = [
    selection.context.asset_id,
    simulation.process?.fault?.assetId,
    ...simulation.assignments.map((a) => a.assetId),
    ...(simulation.view?.affected || []),
  ];
  const ids = [...new Set([...priority, ...state.assets.map((a) => a.id)])]
    .filter((id): id is string => !!id && allowed.has(id))
    .slice(0, 36);
  const context: Schema['SimulationContext'] = {
    captured_at: new Date().toISOString(),
    selected_case_id: selectedCase?.id ?? null,
    selected_assignment_id: assignment?.id ?? null,
    equipment: ids.map((asset_id) => ({
      asset_id,
      mode: simulation.view?.modes[asset_id] ?? null,
      readings: (simulation.readings[asset_id] ?? [])
        .filter((r) => [r.value, r.low, r.high].every(Number.isFinite))
        .slice(0, 8)
        .map((r) => ({ ...r })),
    })),
    assignments: [
      ...(assignment ? [assignment] : []),
      ...simulation.assignments.filter((a) => a.id !== assignment?.id),
    ]
      .filter((a) => allowed.has(a.assetId))
      .slice(0, 5)
      .map((a) => {
        const operator = OPERATORS.find((o) => o.id === a.operatorId);
        return {
          id: a.id,
          asset_id: a.assetId,
          operator_id: a.operatorId,
          status: a.phase,
          note: 'Simulated operator assignment',
          operator_name: operator?.name ?? null,
          craft: operator?.craft ?? null,
          experience_years: operator?.years ?? null,
        };
      }),
    cases: [
      ...(selectedCase ? [selectedCase] : []),
      ...simulation.ledger.cases.filter((c) => c.id !== selectedCase?.id),
    ]
      .filter((c) => allowed.has(c.assetId))
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        asset_id: c.assetId,
        operator_id: c.operatorId,
        status: simulationCaseStatus(c),
        note: c.message.slice(0, 600),
      })),
  };
  if (selectedCase && allowed.has(selectedCase.assetId) && timestamp(selectedCase.occurredAt)) {
    const saved = selectedCase.context;
    const captured =
      validCaseContext(saved) &&
      saved.affected.every((a) => allowed.has(a.id)) &&
      saved.lines.every((line) => areaIds.has(line.id));
    context.case_evidence = {
      case_id: selectedCase.id,
      asset_id: selectedCase.assetId,
      occurred_at: timestamp(selectedCase.occurredAt)!,
      attended_at: timestamp(selectedCase.attendedAt),
      fixed_at: timestamp(selectedCase.fixedAt),
      recovered_at: timestamp(selectedCase.clearedAt),
      interrupted: !!selectedCase.interrupted,
      detection: {
        signal_id: selectedCase.signalId,
        value: selectedCase.value,
        unit: selectedCase.unit,
        low: selectedCase.metadata.low,
        high: selectedCase.metadata.high,
        ooc: true,
      },
      topology_captured: captured,
      affected_asset_ids: captured ? saved.affected.map((a) => a.id) : [],
      lines: captured
        ? saved.lines.map((line) => ({
            id: line.id,
            name: line.name,
            capacity_per_hour: line.capacity,
          }))
        : [],
      recovery_basis: 'scenario_timer',
    };
  }
  if (simulation.process && simulation.view) {
    context.process = {
      simulated_at: timestamp(simulation.view.now)!,
      paused: simulation.process.paused,
      speed: simulation.process.speed,
      phase: simulation.view.phase,
      fault_asset_id: simulation.process.fault?.assetId ?? null,
      affected_asset_ids: simulation.view.affected.filter((id) => allowed.has(id)).slice(0, 36),
      lines: simulation.view.lines.slice(0, 8).map((line) => ({
        id: line.id,
        capacity_per_hour: line.nominal_units_per_hour,
        output_per_hour: line.rate,
        mode: line.mode,
      })),
    };
  }
  return context;
}
