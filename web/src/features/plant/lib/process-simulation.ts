import type { Asset, State } from '@/lib/types';
import { previewReadingsFor, type PreviewReading } from './preview-telemetry';
import {
  liveAssignment,
  RECOVERY_MS,
  reconcileDispatch,
  timelineFor,
  type DispatchSnapshot,
} from '@/features/operators/lib/preview-dispatch';

export type MachineMode =
  'idle' | 'running' | 'degraded' | 'stopped' | 'under_repair' | 'recovering';
export type ProcessEvent = { id: string; at: number; message: string; assetId: string | null };
export type ProcessState = {
  sequence?: number;
  version: 1;
  epoch: number;
  elapsed: number;
  paused: boolean;
  speed: 1 | 10;
  nextFaultAt: number;
  fault: { assetId: string; startedAt: number } | null;
  stage: string;
  events: ProcessEvent[];
};
export type SimulationCommand =
  | { type: 'pause' }
  | { type: 'speed'; speed: 1 | 10 }
  | { type: 'fault'; assetId: string }
  | { type: 'reset' };
export type ProcessCatalog = Pick<State, 'assets' | 'areas' | 'dependencies'>;
export const DETECTION_MS = 8_000;

export function freshProcess(now: number): ProcessState {
  return {
    version: 1,
    epoch: now,
    elapsed: 0,
    paused: false,
    speed: 1,
    nextFaultAt: 60_000,
    fault: null,
    stage: 'running',
    events: [
      {
        id: `start-${now}`,
        at: now,
        message:
          'Hydraulic forming simulation started. Both production and readings are synthetic.',
        assetId: null,
      },
    ],
  };
}

export function downstream(catalog: ProcessCatalog, id: string) {
  const found = new Set([id]);
  const pending = [id];
  while (pending.length) {
    const source = pending.shift();
    for (const edge of catalog.dependencies)
      if (edge.source === source && !found.has(edge.target)) {
        found.add(edge.target);
        pending.push(edge.target);
      }
  }
  return found;
}

export function scenarioPumps(catalog: ProcessCatalog) {
  return catalog.assets.filter(
    (a) =>
      a.type === 'pump' &&
      catalog.assets.some((p) => p.type === 'press' && downstream(catalog, a.id).has(p.id)),
  );
}

function event(process: ProcessState, message: string, assetId: string | null) {
  const sequence = (process.sequence ?? process.events.length) + 1;
  return {
    ...process,
    sequence,
    events: [
      {
        id: `${process.epoch}-event-${sequence}`,
        at: process.epoch + process.elapsed,
        message,
        assetId,
      },
      ...process.events,
    ].slice(0, 40),
  };
}

export function commandProcess(
  process: ProcessState,
  command: SimulationCommand,
  catalog: ProcessCatalog,
): ProcessState {
  if (!command || !['pause', 'speed', 'fault', 'reset'].includes(command.type))
    throw new Error('Unknown simulation command.');
  if (command.type === 'speed' && ![1, 10].includes(command.speed))
    throw new Error('Simulation speed must be 1× or 10×.');
  if (command.type === 'pause')
    return event(
      { ...process, paused: !process.paused },
      process.paused ? 'Simulation resumed.' : 'Simulation paused. Readings and jobs are held.',
      null,
    );
  if (command.type === 'speed')
    return event(
      { ...process, speed: command.speed },
      `Simulation speed set to ${command.speed}×. Durations use simulated time.`,
      null,
    );
  if (command.type === 'reset')
    return event(
      {
        ...process,
        fault: null,
        stage: 'running',
        paused: false,
        nextFaultAt: process.elapsed + 60_000,
      },
      'Scenario reset. Previous records are retained; the plant is running normally.',
      null,
    );
  if (process.fault) return process;
  if (!scenarioPumps(catalog).some((a) => a.id === command.assetId))
    throw new Error('Choose a configured pump with a downstream press.');
  return event(
    {
      ...process,
      fault: { assetId: command.assetId, startedAt: process.elapsed },
      stage: 'developing',
    },
    'Pump pressure is falling. Dependent forming output is reducing.',
    command.assetId,
  );
}

export function processView(
  process: ProcessState,
  snapshot: DispatchSnapshot,
  catalog: ProcessCatalog,
  tick: number,
  seed: number,
) {
  const now = process.epoch + process.elapsed;
  const fault = process.fault;
  const assignment = fault
    ? [...snapshot.open, ...snapshot.history].find(
        (a) => a.assetId === fault.assetId && a.openedAt >= process.epoch + fault.startedAt,
      )
    : undefined;
  const job = assignment ? liveAssignment(assignment, now) : undefined;
  const age = fault ? process.elapsed - fault.startedAt : 0;
  const phase = !fault
    ? 'running'
    : age < DETECTION_MS
      ? 'developing'
      : (job?.phase ?? 'dispatched');
  const affected = fault ? downstream(catalog, fault.assetId) : new Set<string>();
  const repairing = phase === 'correcting';
  const stopped = phase === 'on_site' || repairing;
  const recovering = phase === 'recovering';
  const recovered = ['cleared', 'returning', 'returned', 'running'].includes(phase);
  const repairEnd = assignment
    ? assignment.openedAt +
      timelineFor(assignment.severity)
        .filter((s) => s.ooc)
        .reduce((n, s) => n + s.ms, 0)
    : now;
  const factor =
    !fault || recovered
      ? 1
      : stopped
        ? 0
        : recovering
          ? Math.min(1, 0.4 + (0.6 * (now - repairEnd)) / RECOVERY_MS)
          : 1 - 0.35 * Math.min(1, age / DETECTION_MS);
  const lines = catalog.areas
    .filter((a) => a.nominal_units_per_hour > 0)
    .map((area) => {
      const impacted = catalog.assets.some(
        (a) => a.area_id === area.id && a.type === 'press' && affected.has(a.id),
      );
      const rate = Math.round(area.nominal_units_per_hour * (impacted ? factor : 1));
      return {
        ...area,
        impacted: impacted && factor < 1,
        rate,
        mode: (!impacted || recovered
          ? 'running'
          : stopped
            ? 'stopped'
            : recovering
              ? 'recovering'
              : 'degraded') as MachineMode,
      };
    });
  const modes: Record<string, MachineMode> = {};
  const readings: Record<string, PreviewReading[]> = {};
  for (const asset of catalog.assets) {
    const line = lines.find((l) => l.id === asset.area_id);
    const isFault = fault?.assetId === asset.id;
    const impacted = line?.impacted || (affected.has(asset.id) && factor < 1);
    const mode: MachineMode =
      isFault && !recovered
        ? repairing
          ? 'under_repair'
          : stopped
            ? 'stopped'
            : recovering
              ? 'recovering'
              : 'degraded'
        : impacted
          ? stopped
            ? asset.type === 'motor'
              ? 'idle'
              : 'stopped'
            : recovering
              ? 'recovering'
              : 'degraded'
          : 'running';
    modes[asset.id] = mode;
    const values = previewReadingsFor(asset, tick, seed, false).map((r) => {
      let value = r.value;
      let low = r.low;
      if (isFault && r.signal_id === 'pressure')
        value = stopped
          ? 0
          : recovered
            ? r.value
            : recovering
              ? r.low + 0.5 + (r.value - r.low - 0.5) * Math.min(1, (now - repairEnd) / RECOVERY_MS)
              : age < DETECTION_MS
                ? r.value + ((r.low + 0.2 - r.value) * age) / DETECTION_MS
                : r.low - 10;
      if (isFault && r.signal_id === 'flow') value *= factor;
      if (asset.type === 'motor' && impacted && r.signal_id === 'speed') value *= factor;
      if (
        asset.type === 'conveyor' &&
        impacted &&
        ['speed', 'load', 'motor_current'].includes(r.signal_id)
      )
        value *= factor;
      if (asset.type === 'press' && impacted && r.signal_id === 'force') value *= factor;
      if (asset.type === 'press' && impacted && r.signal_id === 'cycle_time')
        value = factor ? r.value / factor : 0;
      // Stopped equipment is expected to have zero throughput; only the failing pump is alarm evidence.
      if ((mode === 'stopped' || mode === 'idle' || mode === 'under_repair') && !isFault) low = 0;
      value = Number(value.toFixed(2));
      return {
        ...r,
        low,
        value,
        ooc: mode === 'degraded' && (value < low || value > r.high),
      };
    });
    readings[asset.id] = values;
  }
  return {
    now,
    phase,
    modes,
    lines,
    readings,
    job,
    affected: [...affected],
    output: lines.reduce((n, l) => n + l.rate, 0),
    nominal: lines.reduce((n, l) => n + l.nominal_units_per_hour, 0),
  };
}

export function advanceProcess(
  process: ProcessState,
  snapshot: DispatchSnapshot,
  catalog: ProcessCatalog,
  delta: number,
  tick: number,
  seed: number,
) {
  let next = {
    ...process,
    elapsed: process.elapsed + (process.paused ? 0 : Math.max(0, delta) * process.speed),
  };
  if (
    !next.paused &&
    !next.fault &&
    next.elapsed >= next.nextFaultAt &&
    scenarioPumps(catalog).length
  )
    next = commandProcess(next, { type: 'fault', assetId: scenarioPumps(catalog)[0].id }, catalog);
  const view = processView(next, snapshot, catalog, tick, seed);
  // Only the explicit scenario source may dispatch. Dependency symptoms never create unrelated jobs.
  const dispatchCatalog = Object.fromEntries(
    catalog.assets.map((a) => [
      a.id,
      a.id === next.fault?.assetId
        ? view.readings[a.id].filter((r) => r.signal_id === 'pressure')
        : [],
    ]),
  );
  const updated = reconcileDispatch(snapshot, {
    assets: catalog.assets,
    catalog: dispatchCatalog,
    tick,
    now: view.now,
  });
  const after = processView(next, updated, catalog, tick, seed);
  if (next.fault && after.phase !== next.stage) {
    const messages: Record<string, string> = {
      dispatched: 'Pressure breached the simulation envelope. Operator assigned.',
      en_route: 'Operator is travelling to the pump. The affected line is derated.',
      on_site: 'Inspection started. The affected line is stopped.',
      correcting: 'Pump repair started. Other independent lines keep running.',
      recovering: 'Repair complete. Checking stable pressure for 30 simulated seconds.',
      cleared: 'Recovery complete. Line output restored; case closed.',
      returning: 'Operator is returning to station.',
      returned: 'Operator is back at station. Normal production continues.',
    };
    next = event(
      { ...next, stage: after.phase },
      messages[after.phase] ?? after.phase,
      next.fault.assetId,
    );
    if (after.phase === 'returned')
      next = { ...next, fault: null, nextFaultAt: next.elapsed + 180_000, stage: 'running' };
  }
  return { process: next, snapshot: updated };
}

export function sceneAssets(assets: Asset[], modes: Record<string, MachineMode>): Asset[] {
  const status: Record<MachineMode, Asset['status']> = {
    idle: 'stopped',
    running: 'healthy',
    degraded: 'degrading',
    stopped: 'stopped',
    under_repair: 'investigating',
    recovering: 'verifying',
  };
  return assets.map((a) => ({ ...a, status: status[modes[a.id] ?? 'running'] }));
}
