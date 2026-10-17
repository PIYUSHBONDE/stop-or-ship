export const FACTOR_COLORS = ['#73d8b7', '#f1b675', '#9ec1ff'];

export type SparklineSeries = {
  name: string;
  values: number[];
  color: string;
  low?: number;
  high?: number;
};

export default function Sparkline({
  values,
  color = '#73d8b7',
  label,
  series,
}: {
  values?: number[];
  color?: string;
  label: string;
  series?: SparklineSeries[];
}) {
  if (series?.length) return <FactorSparkline label={label} series={series} />;
  if (!values || values.length < 2)
    return <div className="chart-placeholder">Awaiting observation history</div>;
  const low = Math.min(...values) * 0.95;
  const high = Math.max(...values) * 1.05;
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 280},${64 - ((v - low) / Math.max(high - low, 0.001)) * 52}`,
    )
    .join(' ');
  return (
    <svg viewBox="0 0 280 75" className="sparkline" role="img" aria-label={label}>
      {[15, 38, 62].map((y) => (
        <line key={y} x1="0" x2="280" y1={y} y2={y} stroke="#293d49" strokeDasharray="3 5" />
      ))}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function FactorSparkline({ label, series }: { label: string; series: SparklineSeries[] }) {
  const drawn = series.filter((item) => item.values.length >= 2);
  if (!drawn.length) return <div className="chart-placeholder">Awaiting observation history</div>;
  return (
    <svg viewBox="0 0 280 75" className="sparkline" role="img" aria-label={label}>
      {[guideY(0), guideY(1)].map((y) => (
        <line key={y} x1="0" x2="280" y1={y} y2={y} stroke="#293d49" strokeDasharray="3 5" />
      ))}
      {drawn.map((item) => (
        <polyline
          key={item.name}
          points={item.values
            .map((value, index) => {
              const count = item.values.length;
              const x = count <= 1 ? 0 : (index / (count - 1)) * 280;
              return `${x},${scaleY(value, item.low, item.high, item.values)}`;
            })
            .join(' ')}
          fill="none"
          stroke={item.color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function scaleY(
  value: number,
  low: number | undefined,
  high: number | undefined,
  values: number[],
) {
  const floor = low ?? Math.min(...values);
  const ceiling = high ?? Math.max(...values);
  const span = Math.max(ceiling - floor, 0.001);
  const normal = (value - floor) / span;
  const padded = (normal + 0.35) / 1.7;
  return 68 - Math.min(1, Math.max(0, padded)) * 58;
}

function guideY(normal: number) {
  return 68 - ((normal + 0.35) / 1.7) * 58;
}
