import { previewReadingsFor, type PreviewReading } from '@/features/plant/lib/preview-telemetry';
import { plantBounds } from '@/lib/plant-layout';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type AssignmentPhase =
  | 'dispatched'
  | 'en_route'
  | 'on_site'
  | 'correcting'
  | 'recovering'
  | 'cleared'
  | 'returning'
  | 'returned';

export type PreviewOperator = {
  id: string;
  name: string;
  years: number;
  craft: string;
};

export type PreviewAssignment = {
  id: string;
  operatorId: string;
  assetId: string;
  assetType: string;
  signalId: string;
  value: number;
  unit: string;
  low: number;
  high: number;
  severity: Severity;
  openedTick: number;
  openedAt: number;
};

export type LiveAssignment = PreviewAssignment & {
  phase: AssignmentPhase;
  ooc: boolean;
  travel: number;
  elapsedMs: number;
  remainingMs: number;
};

export type FloorActor = {
  id: string;
  name: string;
  label: string;
  phase: AssignmentPhase;
  assetId: string | null;
  assignmentId: string | null;
  position: [number, number, number];
};

export type DispatchSnapshot = {
  open: PreviewAssignment[];
  history: PreviewAssignment[];
};

export function selectAssignment<T extends { id: string; operatorId: string }>(
  open: T[],
  history: T[],
  requested: string | null,
) {
  return (
    open.find((item) => item.id === requested || item.operatorId === requested) ||
    history.find((item) => item.id === requested || item.operatorId === requested) ||
    open[0]
  );
}

export type AssetRef = { id: string; type: string; position: number[] };

export const OPERATORS: PreviewOperator[] = [
  { id: 'OP-04', name: 'Priya Sen', years: 3, craft: 'mechanical' },
  { id: 'OP-12', name: 'Maya Chen', years: 8, craft: 'hydraulics' },
  { id: 'OP-19', name: 'Ravi Nair', years: 5, craft: 'rotating equipment' },
  { id: 'OP-27', name: 'Luis Ortega', years: 2, craft: 'utilities' },
  { id: 'OP-31', name: 'Asha Kapoor', years: 11, craft: 'forming presses' },
];

const TYPE_WEIGHT: Record<string, number> = {
  press: 3,
  compressor: 3,
  electrical: 3,
  pump: 2,
  motor: 2,
};

export const PHASE_COPY: Record<AssignmentPhase, string> = {
  dispatched: 'Assigned',
  en_route: 'Walking to cell',
  on_site: 'On station',
  correcting: 'Correcting OOC',
  recovering: 'Checking recovery',
  cleared: 'OOC cleared',
  returning: 'Returning to station',
  returned: 'Back at station',
};

export function assignmentId(assetId: string, tick: number) {
  return `ASN-${assetId}-${tick}`;
}

export function overshoot(reading: PreviewReading) {
  const span = Math.max(reading.high - reading.low, 0.001);
  if (reading.value > reading.high) return (reading.value - reading.high) / (span / 2);
  if (reading.value < reading.low) return (reading.low - reading.value) / (span / 2);
  return 0;
}

export function rateOoc(readings: PreviewReading[], type: string) {
  const breached = readings.filter((reading) => reading.ooc);
  if (!breached.length) return null;
  const reading = breached.reduce((worst, item) =>
    overshoot(item) > overshoot(worst) ? item : worst,
  );
  const weight = TYPE_WEIGHT[type] ?? 1;
  const extra = breached.length > 1 ? 1 : 0;
  let severity: Severity = 'low';
  if (weight + extra >= 4 || (weight >= 3 && overshoot(reading) >= 0.3)) severity = 'critical';
  else if (weight >= 2) severity = 'high';
  else if (overshoot(reading) >= 0.25) severity = 'medium';
  return { severity, reading, score: overshoot(reading) * 6 + breached.length + weight };
}

export function pickOperator(
  operators: PreviewOperator[],
  busy: Iterable<string>,
  severity: Severity,
) {
  const taken = new Set(busy);
  const idle = operators.filter((operator) => !taken.has(operator.id));
  if (!idle.length) return null;
  const byYears = [...idle].sort((left, right) => right.years - left.years);
  if (severity === 'critical') return byYears.find((operator) => operator.years >= 8) ?? byYears[0];
  if (severity === 'high')
    return (
      byYears.find((operator) => operator.years >= 5 && operator.years < 11) ??
      byYears.find((operator) => operator.years >= 5) ??
      byYears[0]
    );
  if (severity === 'medium')
    return [...idle].sort((left, right) => Math.abs(left.years - 4) - Math.abs(right.years - 4))[0];
  return [...idle].sort((left, right) => left.years - right.years)[0];
}

export const MIN_FIX_MS = 120_000;
export const RECOVERY_MS = 30_000;

export function timelineFor(severity: Severity) {
  const extra = severity === 'critical' ? 30_000 : severity === 'high' ? 15_000 : 0;
  return [
    { phase: 'dispatched' as const, ms: 2_000, ooc: true },
    { phase: 'en_route' as const, ms: 18_000, ooc: true },
    { phase: 'on_site' as const, ms: 5_000, ooc: true },
    { phase: 'correcting' as const, ms: MIN_FIX_MS + extra, ooc: true },
    { phase: 'recovering' as const, ms: RECOVERY_MS, ooc: false },
    { phase: 'cleared' as const, ms: 3_000, ooc: false },
    { phase: 'returning' as const, ms: 18_000, ooc: false },
  ];
}

export function timelineMs(severity: Severity) {
  return timelineFor(severity).reduce((total, step) => total + step.ms, 0);
}

export function liveAssignment(
  item: PreviewAssignment,
  now: number,
  reduceMotion = false,
): LiveAssignment {
  const steps = timelineFor(item.severity);
  const elapsedMs = Math.max(0, now - item.openedAt);
  let cursor = 0;
  for (const step of steps) {
    if (elapsedMs < cursor + step.ms) {
      const travel =
        !reduceMotion && (step.phase === 'en_route' || step.phase === 'returning')
          ? (elapsedMs - cursor) / step.ms
          : 1;
      return finishLive(
        item,
        step.phase,
        step.ooc,
        travel,
        elapsedMs,
        timelineMs(item.severity) - elapsedMs,
      );
    }
    cursor += step.ms;
  }
  return finishLive(item, 'returned', false, 1, elapsedMs, 0);
}

function finishLive(
  item: PreviewAssignment,
  phase: AssignmentPhase,
  ooc: boolean,
  travel: number,
  elapsedMs: number,
  remainingMs: number,
): LiveAssignment {
  return { ...item, phase, ooc, travel, elapsedMs, remainingMs: Math.max(0, remainingMs) };
}

export function reconcileDispatch(
  current: DispatchSnapshot,
  input: {
    assets: { id: string; type: string }[];
    catalog: Record<string, PreviewReading[]>;
    tick: number;
    now: number;
  },
): DispatchSnapshot {
  const open: PreviewAssignment[] = [];
  const history = current.history.filter(
    (item, index, list) => list.findIndex((entry) => entry.id === item.id) === index,
  );
  for (const item of current.open) {
    if (liveAssignment(item, input.now).phase === 'returned') {
      if (!history.some((entry) => entry.id === item.id)) history.unshift(item);
    } else open.push(item);
  }
  const busy = new Set(open.map((item) => item.operatorId));
  const held = new Set([
    ...open.map((item) => item.assetId),
    ...history.filter((item) => item.openedTick === input.tick).map((item) => item.assetId),
  ]);
  for (const asset of input.assets) {
    if (held.has(asset.id)) continue;
    const rating = rateOoc(input.catalog[asset.id] || [], asset.type);
    if (!rating) continue;
    const operator = pickOperator(OPERATORS, busy, rating.severity);
    if (!operator) continue;
    const created: PreviewAssignment = {
      id: assignmentId(asset.id, input.tick),
      operatorId: operator.id,
      assetId: asset.id,
      assetType: asset.type,
      signalId: rating.reading.signal_id,
      value: rating.reading.value,
      unit: rating.reading.unit,
      low: rating.reading.low,
      high: rating.reading.high,
      severity: rating.severity,
      openedTick: input.tick,
      openedAt: input.now,
    };
    open.push(created);
    busy.add(operator.id);
    held.add(asset.id);
  }
  return { open, history: history.slice(0, 40) };
}

export function applyLatchedReadings(
  catalog: Record<string, PreviewReading[]>,
  assets: { id: string; type: string }[],
  latchedIds: string[],
  tick: number,
  seed: number,
) {
  const next = { ...catalog };
  for (const id of latchedIds) {
    const asset = assets.find((item) => item.id === id);
    if (asset) next[id] = previewReadingsFor(asset, tick, seed, true);
  }
  return next;
}

export function operatorStation(
  index: number,
  count: number,
  bounds: ReturnType<typeof plantBounds>,
): [number, number, number] {
  const span = Math.max(bounds.width - 4, 4);
  const x = bounds.minX + 2 + (count <= 1 ? span / 2 : (index / (count - 1)) * span);
  return [x, 0, bounds.maxZ - 1.15];
}

export function mix(
  from: [number, number, number],
  to: [number, number, number],
  amount: number,
): [number, number, number] {
  const t = Math.min(1, Math.max(0, amount));
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

export function actorPosition(
  operator: PreviewOperator,
  assignment: LiveAssignment | undefined,
  assets: AssetRef[],
): [number, number, number] {
  const bounds = plantBounds(
    assets.length ? assets : [{ id: 'x', type: 'pump', position: [0, 0, 0] }],
  );
  const index = OPERATORS.findIndex((item) => item.id === operator.id);
  const home = operatorStation(Math.max(0, index), OPERATORS.length, bounds);
  if (!assignment) return home;
  const asset = assets.find((item) => item.id === assignment.assetId);
  if (!asset) return home;
  const target: [number, number, number] = [asset.position[0], 0, asset.position[2] + 1.2];
  if (assignment.phase === 'dispatched') return home;
  if (assignment.phase === 'en_route') return mix(home, target, assignment.travel);
  if (assignment.phase === 'returning') return mix(target, home, assignment.travel);
  if (assignment.phase === 'returned') return home;
  return target;
}

export function floorActors(assignments: LiveAssignment[], assets: AssetRef[]): FloorActor[] {
  return OPERATORS.map((operator) => {
    const assignment = assignments.find((item) => item.operatorId === operator.id);
    return {
      id: operator.id,
      name: operator.name,
      label: operator.id,
      phase: assignment?.phase ?? 'returned',
      assetId: assignment?.assetId ?? null,
      assignmentId: assignment?.id ?? null,
      position: actorPosition(operator, assignment, assets),
    };
  });
}
