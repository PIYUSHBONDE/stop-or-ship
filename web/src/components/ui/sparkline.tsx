export default function Sparkline({
  values,
  color = '#73d8b7',
  label,
}: {
  values: number[];
  color?: string;
  label: string;
}) {
  if (values.length < 2)
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
