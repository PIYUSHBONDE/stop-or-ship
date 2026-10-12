export type PreviewReading = {
  signal_id: string;
  value: number;
  unit: string;
  low: number;
  high: number;
  ooc: boolean;
};

type Channel = {
  signal_id: string;
  unit: string;
  base: number;
  span: number;
  digits: number;
};

const CHANNELS: Record<string, Channel[]> = {
  pump: [
    { signal_id: 'pressure', unit: 'bar', base: 148, span: 8, digits: 1 },
    { signal_id: 'flow', unit: 'L/min', base: 41, span: 5, digits: 1 },
    { signal_id: 'temperature', unit: '°C', base: 54, span: 6, digits: 1 },
  ],
  motor: [
    { signal_id: 'current', unit: 'A', base: 28, span: 4, digits: 1 },
    { signal_id: 'vibration', unit: 'mm/s', base: 2.4, span: 0.8, digits: 2 },
    { signal_id: 'speed', unit: 'rpm', base: 1480, span: 40, digits: 0 },
  ],
  press: [
    { signal_id: 'force', unit: 'kN', base: 210, span: 18, digits: 0 },
    { signal_id: 'temperature', unit: '°C', base: 61, span: 7, digits: 1 },
    { signal_id: 'cycle_time', unit: 's', base: 6.2, span: 0.8, digits: 2 },
  ],
  conveyor: [
    { signal_id: 'speed', unit: 'm/min', base: 18, span: 3, digits: 1 },
    { signal_id: 'load', unit: '%', base: 62, span: 12, digits: 0 },
    { signal_id: 'motor_current', unit: 'A', base: 11, span: 2, digits: 1 },
  ],
  cooling: [
    { signal_id: 'temperature', unit: '°C', base: 36, span: 4, digits: 1 },
    { signal_id: 'flow', unit: 'L/min', base: 22, span: 3, digits: 1 },
    { signal_id: 'pressure', unit: 'bar', base: 3.4, span: 0.4, digits: 2 },
  ],
  compressor: [
    { signal_id: 'pressure', unit: 'bar', base: 7.2, span: 0.6, digits: 2 },
    { signal_id: 'temperature', unit: '°C', base: 48, span: 5, digits: 1 },
    { signal_id: 'duty', unit: '%', base: 58, span: 10, digits: 0 },
  ],
  electrical: [
    { signal_id: 'voltage', unit: 'V', base: 415, span: 8, digits: 0 },
    { signal_id: 'current', unit: 'A', base: 36, span: 5, digits: 1 },
    { signal_id: 'frequency', unit: 'Hz', base: 50, span: 0.3, digits: 2 },
  ],
  goods: [
    { signal_id: 'occupancy', unit: '%', base: 44, span: 16, digits: 0 },
    { signal_id: 'weight', unit: 'kg', base: 380, span: 40, digits: 0 },
    { signal_id: 'dwell', unit: 's', base: 90, span: 20, digits: 0 },
  ],
};

const FALLBACK: Channel[] = [
  { signal_id: 'output', unit: 'units/h', base: 120, span: 18, digits: 0 },
  { signal_id: 'temperature', unit: '°C', base: 42, span: 5, digits: 1 },
];

export function previewReadingsFor(
  asset: { id: string; type: string },
  tick: number,
  seed: number,
  excursion = false,
): PreviewReading[] {
  const channels = CHANNELS[asset.type] || FALLBACK;
  return channels.map((channel, index) => {
    const wave = Math.sin((tick + seed + index * 3) * 0.7 + hash(asset.id + channel.signal_id));
    const low = Number((channel.base - channel.span * 1.05).toFixed(channel.digits));
    const high = Number((channel.base + channel.span * 1.05).toFixed(channel.digits));
    let raw = channel.base + wave * channel.span;
    if (excursion && index === 0) raw = high + channel.span * 0.45;
    const value = Number(raw.toFixed(channel.digits));
    return {
      signal_id: channel.signal_id,
      unit: channel.unit,
      low,
      high,
      value,
      ooc: value < low || value > high,
    };
  });
}

export function previewCatalog(assets: { id: string; type: string }[], tick: number, seed: number) {
  const excursionId = excursionAssetId(assets, tick, seed);
  return Object.fromEntries(
    assets.map((asset) => [
      asset.id,
      previewReadingsFor(asset, tick, seed, asset.id === excursionId),
    ]),
  );
}

export function excursionAssetId(
  assets: { id: string }[],
  tick: number,
  seed: number,
): string | null {
  if (!assets.length || tick % 3 !== 2) return null;
  return assets[(Math.floor(tick / 3) + seed) % assets.length].id;
}

export function oocAssetIds(catalog: Record<string, PreviewReading[]>) {
  return Object.entries(catalog)
    .filter(([, readings]) => readings.some((reading) => reading.ooc))
    .map(([id]) => id);
}

function hash(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1)
    total = (total * 33 + value.charCodeAt(index)) % 1000;
  return total / 160;
}
