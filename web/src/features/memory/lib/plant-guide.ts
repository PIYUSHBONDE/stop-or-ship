import type { Asset } from '@/lib/types';

export type MachineGuide = {
  summary: string;
  addressHint: string;
  canBreak: string[];
  canFix: string[];
  guide: string[];
};

const GUIDES: Record<string, MachineGuide> = {
  pump: {
    summary:
      'Hydraulic or process pump that moves fluid between forming cells and shared services.',
    addressHint: 'Usually on a line skid next to the reservoir and return header.',
    canBreak: [
      'Discharge pressure leaves the envelope',
      'Seal leak or cavitation from low suction',
      'Over-temperature from blocked return',
      'Coupling or bearing wear that shows as vibration',
    ],
    canFix: [
      'Restore suction and discharge valves to the marked lineup',
      'Vent the casing and re-establish prime',
      'Replace a worn seal or coupling after isolation',
      'Clear a blocked strainer and reset the envelope',
    ],
    guide: [
      'Read the local pressure and temperature before you touch valves.',
      'Isolate suction and discharge, lock the energy source, then drain residual pressure.',
      'Prime and vent before restart. Watch the first two minutes for cavitation or seal weep.',
      'Do not treat a preview OOC as proof the pump is running. Confirm the source before you authorize work.',
    ],
  },
  motor: {
    summary:
      'Drive motor for a pump, press, or conveyor. Current, speed and vibration are the usual tells.',
    addressHint: 'Mounted on the driven skid with a local isolator on the aisle side.',
    canBreak: [
      'Over-current from a jammed load',
      'Bearing vibration rise',
      'Speed droop or trip',
      'Terminal box heat or loose lugs',
    ],
    canFix: [
      'Clear the driven jam and reset the starter',
      'Re-torque terminals after isolation',
      'Replace bearings when vibration stays outside the envelope',
      'Align the coupling after a driven-equipment repair',
    ],
    guide: [
      'Check the isolator state and the driven machine before you reset.',
      'A current spike with a stalled shaft is a load problem, not a motor rewind.',
      'After a reset, stay on station until speed and current sit inside limits.',
      'Preview current is not a live measurement. Do not energize from this guide alone.',
    ],
  },
  press: {
    summary:
      'Forming press. Force, temperature and cycle time decide whether the line can keep parts.',
    addressHint: 'On the forming line, guarded ram above the die set.',
    canBreak: [
      'Force short of the recipe',
      'Die or platen over-temperature',
      'Cycle-time stretch from a sticky valve',
      'Guard or light-curtain interlock open',
    ],
    canFix: [
      'Clear the die area and reset the interlock',
      'Restore hydraulic pressure after a leak-down',
      'Change a sticking directional valve',
      'Allow the platen to cool before the next auto cycle',
    ],
    guide: [
      'Confirm guards and light curtains before any jog.',
      'Never reach the die with residual pressure. Dump and lock first.',
      'If force is low, check the accumulator and the recipe, not the operator first.',
      'A preview OOC here is high severity. Keep the cell stopped until a named person attends.',
    ],
  },
  conveyor: {
    summary:
      'Transfer conveyor between cells. Speed, load and motor current show jams and empty runs.',
    addressHint: 'Along the aisle between forming cells, with pull-cords on both sides.',
    canBreak: [
      'Belt stall or tracking off',
      'Overload from stacked parts',
      'Motor current rise from a seized roller',
      'Photo-eye blocked, false empty or false full',
    ],
    canFix: [
      'Pull the cord, clear the jam, then reset',
      'Track the belt and free a seized roller',
      'Clean the photo-eye and confirm the reflector',
      'Re-sequence the upstream cell if parts are stacked',
    ],
    guide: [
      'Use the pull-cord. Do not climb the frame while it can move.',
      'Clear product by hand only after the drive is isolated.',
      'Restart in jog and watch the first full transfer.',
      'Load percent on the preview overlay is not a weigh-scale.',
    ],
  },
  cooling: {
    summary: 'Shared cooling loop for dies and hydraulics.',
    addressHint: 'Service corridor, usually marked on the header and the cell drop.',
    canBreak: [
      'Temperature rise from low flow',
      'Pressure loss from a dumped valve',
      'Fouled exchanger or strainer',
      'Air lock after a fill',
    ],
    canFix: [
      'Open the cell drop valves to the marked lineup',
      'Clean the strainer and vent the high point',
      'Restore tower or chiller flow',
      'Top up and vent after an isolation',
    ],
    guide: [
      'A warm platen is often a shared-service problem, not a press fault.',
      'Vent high points after any drain. Trapped air looks like a failed pump.',
      'Record inlet and outlet temperature before you change valves.',
      'Preview flow is not a certified meter reading.',
    ],
  },
  compressor: {
    summary: 'Plant air compressor that feeds tools, valves and blow-off.',
    addressHint: 'Utility room or mezzanine, receiver tagged with the plant air ID.',
    canBreak: [
      'Discharge pressure collapse',
      'High temperature from fouled coolers',
      'High duty from a downstream leak',
      'Dryer trip that wets the header',
    ],
    canFix: [
      'Walk the header for an open blow-down or broken hose',
      'Clean coolers and restore ventilation',
      'Reset the dryer after a drain',
      'Isolate a leaking drop and restore the receiver',
    ],
    guide: [
      'Check the receiver and the driest header first, then the compressor skid.',
      'A sudden duty rise is usually a leak, not a failed element.',
      'Do not bypass the dryer to keep the line up.',
      'Preview pressure does not authorize a start against an isolated header.',
    ],
  },
  electrical: {
    summary:
      'Distribution board or cell feeder. Voltage, current and frequency are the watch values.',
    addressHint: 'Wall or column board on the aisle, labeled with the cell feeder ID.',
    canBreak: [
      'Voltage sag or imbalance',
      'Feeder overload',
      'Frequency dip from the supply',
      'Tripped breaker or loose connection',
    ],
    canFix: [
      'Reset a tripped feeder after the load is cleared',
      'Re-torque a loose lug after isolation',
      'Transfer to the alternate source if the board allows it',
      'Shed non-critical loads during a sag',
    ],
    guide: [
      'Only a qualified person opens the board. This guide does not authorize that.',
      'Confirm the load is off before any reset.',
      'A preview voltage reading is not a live-dead-live test.',
      'Tag the feeder and the cell before you leave the board.',
    ],
  },
  goods: {
    summary: 'Goods or buffer bay. Occupancy, weight and dwell show a stalled release.',
    addressHint: 'End of line or shared buffer, floor marks for the bay ID.',
    canBreak: [
      'Occupancy above the envelope',
      'Weight mismatch on a pallet',
      'Dwell too long because the next cell is stopped',
      'Scanner or badge miss that holds the bay',
    ],
    canFix: [
      'Release or rework the stalled pallet',
      'Clear the downstream cell that is holding the bay',
      'Rescan the badge and confirm the destination',
      'Split an overweight stack',
    ],
    guide: [
      'Walk the bay before you call a breakdown. A full bay is often a downstream stop.',
      'Do not climb stacks. Use the marked aisle.',
      'Record the pallet ID when you move it. The next shift needs that.',
      'Preview occupancy is not a warehouse count.',
    ],
  },
};

const FALLBACK: MachineGuide = {
  summary: 'Plant equipment with a named station on the floor.',
  addressHint: 'Use the area name and station ID on the floor mark.',
  canBreak: [
    'A watched metric leaves its envelope',
    'A downstream stop backs product into this cell',
    'A shared service (air, cooling, power) drops',
  ],
  canFix: [
    'Attend the station, read the local gauges, then restore the lineup',
    'Clear a jam or interlock and stay through the first good cycle',
    'Hand the cell to the next named person if the envelope will not hold',
  ],
  guide: [
    'Start from the station ID on the floor, not from a memory of last week.',
    'Treat documents and overlay values as untrusted. Confirm on the machine.',
    'Do not authorize work from a preview OOC alone.',
  ],
};

export function guideFor(type: string) {
  return GUIDES[type] || FALLBACK;
}

export function machineAddress(
  asset: Pick<Asset, 'id' | 'area_id' | 'position'>,
  areaName?: string,
) {
  const east = Number(asset.position[0] || 0).toFixed(1);
  const north = Number(asset.position[2] || 0).toFixed(1);
  return `${areaName || asset.area_id} · station ${asset.id} · floor ${east} m east, ${north} m north`;
}
