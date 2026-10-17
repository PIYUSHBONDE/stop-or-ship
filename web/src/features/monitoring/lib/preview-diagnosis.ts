import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';

export type SignalSide = 'inside' | 'low' | 'high' | 'stopped';

export type DiagnosisSample = {
  id: string;
  at: number;
  readings: PreviewReading[];
};

export type PriorAttempt = {
  id: string;
  signalId: string;
  fixed: boolean;
  /** Recorded fix text. The tree advances only when this names that task. */
  taskTitle?: string;
};

type TaskDef = { title: string; why: string };

type BranchDef = {
  id: string;
  title: string;
  when: string;
  points: string[];
  test: (sides: Record<string, SignalSide>) => boolean;
  tasks: TaskDef[];
};

export type DiagnosisTask = TaskDef & {
  state: 'done' | 'suggested' | 'later';
};

export type DiagnosisBranch = {
  id: string;
  title: string;
  when: string;
  matched: boolean;
  points: { signalId: string; label: string; pointed: boolean }[];
  tasks: DiagnosisTask[];
};

export type ReadingEpisode = {
  id: string;
  title: string;
  summary: string;
  from: number;
  to: number;
  count: number;
  samples: DiagnosisSample[];
};

export type PreviewDiagnosis = {
  active: boolean;
  repeated: boolean;
  summary: string;
  branches: DiagnosisBranch[];
  suggested: DiagnosisTask | null;
};

const low = (sides: Record<string, SignalSide>, id: string) =>
  sides[id] === 'low' || sides[id] === 'stopped';
const high = (sides: Record<string, SignalSide>, id: string) => sides[id] === 'high';

const TREES: Record<string, BranchDef[]> = {
  pump: [
    {
      id: 'no-delivery',
      title: 'Pump is not delivering',
      when: 'Pressure and flow are both below their limits',
      points: ['pressure', 'flow'],
      test: (sides) => low(sides, 'pressure') && low(sides, 'flow'),
      tasks: [
        {
          title: 'Check the suction strainer, inlet valve, and prime',
          why: 'Low pressure together with low flow means fluid is not reaching the pump, or the pump is not pushing it out.',
        },
        {
          title: 'Check the relief valve and internal bypass',
          why: 'The inlet path was already corrected, and the same low-pressure, low-flow failure came back. Fluid may now be recirculating inside the pump.',
        },
        {
          title: 'Inspect the pump element and coupling for wear',
          why: 'Inlet and bypass were already addressed. The same failure now points to a worn element that cannot build pressure.',
        },
      ],
    },
    {
      id: 'blocked-discharge',
      title: 'Discharge is blocked',
      when: 'Pressure is above its limit while flow is below its limit',
      points: ['pressure', 'flow'],
      test: (sides) => high(sides, 'pressure') && low(sides, 'flow'),
      tasks: [
        {
          title: 'Check for a closed discharge valve or a blocked line',
          why: 'High pressure with low flow means the pump is pushing against a restriction.',
        },
        {
          title: 'Check a relief valve that stayed shut',
          why: 'The discharge path was already opened, and high pressure with low flow returned.',
        },
      ],
    },
    {
      id: 'overheat',
      title: 'Pump is running hot',
      when: 'Temperature is above its limit',
      points: ['temperature'],
      test: (sides) => high(sides, 'temperature'),
      tasks: [
        {
          title: 'Check oil level and the cooling return',
          why: 'Temperature left its limit while the other signals are not telling the same story.',
        },
        {
          title: 'Check the bearing and seal for friction',
          why: 'Cooling was already restored, and the temperature breach came back.',
        },
      ],
    },
    {
      id: 'flow-only',
      title: 'Flow left its limit alone',
      when: 'Flow is outside its limit and pressure is still inside',
      points: ['flow'],
      test: (sides) => sides.flow !== 'inside' && sides.pressure === 'inside',
      tasks: [
        {
          title: 'Check the flow meter and the demand valve',
          why: 'Flow moved without a matching pressure breach, so start with the flow path.',
        },
        {
          title: 'Check the pump for slip',
          why: 'The flow path was already checked, and flow left its limit again.',
        },
      ],
    },
    {
      id: 'pressure-only',
      title: 'Pressure left its limit alone',
      when: 'Pressure is outside its limit and flow is still inside',
      points: ['pressure'],
      test: (sides) => sides.pressure !== 'inside' && sides.flow === 'inside',
      tasks: [
        {
          title: 'Check the pressure gauge and the relief setting',
          why: 'Pressure moved without a matching flow breach.',
        },
        {
          title: 'Check for a leak downstream of the gauge',
          why: 'The gauge and relief setting were already corrected, and pressure left its limit again.',
        },
      ],
    },
  ],
  motor: [
    {
      id: 'jam',
      title: 'Driven load is jammed',
      when: 'Current is high and speed is low',
      points: ['current', 'speed'],
      test: (sides) => high(sides, 'current') && low(sides, 'speed'),
      tasks: [
        {
          title: 'Clear a jam on the driven machine and reset the starter',
          why: 'High current with low speed means the motor is trying to turn a load that is not moving.',
        },
        {
          title: 'Check the coupling after the jam was cleared',
          why: 'The jam was already cleared and the same current-and-speed failure returned.',
        },
      ],
    },
    {
      id: 'vibration',
      title: 'Bearing or alignment',
      when: 'Vibration is above its limit',
      points: ['vibration'],
      test: (sides) => high(sides, 'vibration'),
      tasks: [
        {
          title: 'Check bearing condition and hold-down bolts',
          why: 'Vibration left its limit.',
        },
        {
          title: 'Check coupling alignment',
          why: 'The bearing check was already done and vibration returned.',
        },
      ],
    },
  ],
  press: [
    {
      id: 'force',
      title: 'Press is not making force',
      when: 'Force is below its limit',
      points: ['force'],
      test: (sides) => low(sides, 'force'),
      tasks: [
        {
          title: 'Check hydraulic supply to the press',
          why: 'Force is below the preview limit, so the ram is not seeing enough pressure.',
        },
        {
          title: 'Check the directional valve and the die for a leak-down path',
          why: 'Supply was already restored and low force returned.',
        },
      ],
    },
    {
      id: 'slow-cycle',
      title: 'Cycle is stretching',
      when: 'Cycle time is above its limit',
      points: ['cycle_time'],
      test: (sides) => high(sides, 'cycle_time'),
      tasks: [
        {
          title: 'Check for a sticking valve',
          why: 'The stroke is taking longer than the preview limit.',
        },
        {
          title: 'Check the guard interlock and the recipe',
          why: 'The valve was already freed and the slow cycle returned.',
        },
      ],
    },
  ],
};

export function signalSide(reading: PreviewReading): SignalSide {
  if (reading.value === 0 && (reading.value < reading.low || reading.value > reading.high))
    return 'stopped';
  if (reading.value < reading.low) return 'low';
  if (reading.value > reading.high) return 'high';
  return 'inside';
}

export function readingEpisodes(samples: DiagnosisSample[]): ReadingEpisode[] {
  const episodes: ReadingEpisode[] = [];
  for (const sample of samples) {
    const key = patternKey(sample.readings);
    const current = episodes.at(-1);
    if (current && current.id.endsWith(key) && sample.at >= current.to) {
      current.to = sample.at;
      current.count += 1;
      current.samples.push(sample);
      current.summary = episodeSummary(sample.readings);
      continue;
    }
    episodes.push({
      id: `${sample.id}:${key}`,
      title: episodeTitle(sample.readings),
      summary: episodeSummary(sample.readings),
      from: sample.at,
      to: sample.at,
      count: 1,
      samples: [sample],
    });
  }
  return episodes;
}

export function diagnosePreview(
  assetType: string,
  samples: DiagnosisSample[],
  attempts: PriorAttempt[],
): PreviewDiagnosis {
  const latest = samples.at(-1)?.readings ?? [];
  const sides = Object.fromEntries(latest.map((reading) => [reading.signal_id, signalSide(reading)]));
  const notable = latest.filter((reading) => signalSide(reading) !== 'inside');
  const defs = TREES[assetType] ?? genericTree(latest);
  const matchedId = defs.find((branch) => branch.test(sides))?.id ?? null;
  const branches = defs.map((branch) => {
    const matched = branch.id === matchedId;
    const index = matched ? completedThrough(branch.tasks, attempts) : 0;
    return {
      id: branch.id,
      title: branch.title,
      when: branch.when,
      matched,
      points: latest.map((reading) => ({
        signalId: reading.signal_id,
        label: pointLabel(reading, branch.points.includes(reading.signal_id)),
        pointed: branch.points.includes(reading.signal_id) && signalSide(reading) !== 'inside',
      })),
      tasks: branch.tasks.map((task, taskIndex) => ({
        ...task,
        state: !matched
          ? 'later'
          : taskIndex < index
            ? 'done'
            : taskIndex === index
              ? 'suggested'
              : 'later',
      })),
    };
  });
  const active = branches.find((branch) => branch.matched) ?? null;
  const exhausted = !!active && active.tasks.every((task) => task.state === 'done');
  const repeated = !!active && active.tasks.some((task) => task.state === 'done');
  return {
    active: notable.length > 0 && !!active,
    repeated,
    summary: summaryFor(notable, active, exhausted),
    branches,
    suggested: exhausted ? null : (active?.tasks.find((task) => task.state === 'suggested') ?? null),
  };
}

function genericTree(readings: PreviewReading[]): BranchDef[] {
  const outside = readings.filter((reading) => signalSide(reading) !== 'inside');
  const points = outside.map((reading) => reading.signal_id);
  return [
    {
      id: 'outside',
      title: 'Signals left their limits',
      when: outside.length
        ? outside.map((reading) => pointLabel(reading, true)).join(' ')
        : 'Any preview signal leaves its limit',
      points,
      test: () => outside.length > 0,
      tasks: outside.length
        ? [
            {
              title: `Check ${label(outside[0].signal_id)} first`,
              why: `${label(outside[0].signal_id)} is the first condition on this pattern.`,
            },
            ...outside.slice(1).map((reading) => ({
              title: `Check ${label(reading.signal_id)} next`,
              why: `An earlier condition was already fixed, and the same failure returned. Move to ${label(reading.signal_id)}.`,
            })),
            {
              title: 'Inspect the machine after the signal checks',
              why: 'Every signal on this pattern was already checked, and the failure is still present.',
            },
          ]
        : [
            {
              title: 'No check yet',
              why: 'Readings are inside the limit.',
            },
          ],
    },
  ];
}

function completedThrough(tasks: TaskDef[], attempts: PriorAttempt[]) {
  let count = 0;
  for (const task of tasks) {
    const recorded = attempts.some(
      (attempt) =>
        attempt.fixed &&
        !!attempt.taskTitle &&
        attempt.taskTitle.toLowerCase().includes(task.title.toLowerCase()),
    );
    if (!recorded) break;
    count += 1;
  }
  return count;
}

export function limitWords(reading: PreviewReading) {
  const side = signalSide(reading);
  if (side === 'stopped') return 'at zero';
  if (side === 'low') return 'below the limit';
  if (side === 'high') return 'above the limit';
  return 'inside the limit';
}

function summaryFor(
  notable: PreviewReading[],
  active: DiagnosisBranch | null,
  exhausted: boolean,
) {
  if (!notable.length) return 'Every signal is inside the limit.';
  if (!active) return 'Signals are outside the limit, and no typed path matches this machine.';
  const pointed = active.points
    .filter((point) => point.pointed)
    .map((point) => point.label.replace(/\.$/, ''))
    .join('; ');
  const suggested = exhausted
    ? 'Inspect the whole machine.'
    : (active.tasks.find((task) => task.state === 'suggested')?.title ?? '');
  const used = active.tasks
    .filter((task) => task.state === 'done')
    .map((task) => task.title);
  return [active.title, pointed, suggested, used.join('; ')].filter(Boolean).join(' ');
}

function patternKey(readings: PreviewReading[]) {
  return readings.map((reading) => `${reading.signal_id}:${signalSide(reading)}`).join('|');
}

function episodeTitle(readings: PreviewReading[]) {
  const notable = readings.filter((reading) => signalSide(reading) !== 'inside');
  if (!notable.length) return 'Inside the limit';
  const text = notable
    .map((reading) => {
      const side = signalSide(reading);
      const name = label(reading.signal_id);
      if (side === 'stopped') return `${name} at zero`;
      if (side === 'low') return `${name} below its limit`;
      return `${name} above its limit`;
    })
    .join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function episodeSummary(readings: PreviewReading[]) {
  return readings
    .map((reading) => {
      const name = label(reading.signal_id);
      const side = signalSide(reading);
      if (side === 'inside')
        return `${name} near ${reading.value} ${reading.unit}, inside ${reading.low}–${reading.high}`;
      if (side === 'stopped')
        return `${name} at 0 ${reading.unit}, below ${reading.low}–${reading.high}`;
      if (side === 'low')
        return `${name} at ${reading.value} ${reading.unit}, below ${reading.low}`;
      return `${name} at ${reading.value} ${reading.unit}, above ${reading.high}`;
    })
    .join('. ');
}

function pointLabel(reading: PreviewReading, pointed: boolean) {
  const name = label(reading.signal_id);
  const side = signalSide(reading);
  const where = limitWords(reading);
  if (!pointed || side === 'inside') return `${name} is ${where}.`;
  return `${name} is ${where}.`;
}

function label(signalId: string) {
  return signalId.replaceAll('_', ' ');
}

const MATCH_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'on',
  'in',
  'was',
  'is',
  'for',
  'this',
  'that',
  'with',
  'from',
  'at',
  'by',
  'it',
  'be',
  'before',
  'after',
]);

/** F1 overlap of content words. Extra words on either side lower the score; nothing is added. */
export function textMatchScore(left: string, right: string) {
  const operatorTerms = contentTerms(left);
  const toolTerms = contentTerms(right);
  const shared = [...operatorTerms].filter((term) => toolTerms.has(term)).sort();
  if (!operatorTerms.size || !toolTerms.size) return { percent: 0, shared };
  const precision = shared.length / operatorTerms.size;
  const recall = shared.length / toolTerms.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { percent: Math.round(f1 * 100), shared };
}

function contentTerms(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2 && !MATCH_STOPWORDS.has(term)),
  );
}
