import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';
import styles from '@/features/plant/components/plant-preview.module.css';

export function PreviewCard({
  id,
  name,
  readings,
}: {
  id: string;
  name: string;
  readings: PreviewReading[];
}) {
  const ooc = readings.some((reading) => reading.ooc);
  return (
    <div className={`${styles.card} ${ooc ? styles.oocCard : ''}`} role="status">
      <strong>
        {id} · {name}
      </strong>
      <small>{ooc ? 'SYNTHETIC OOC' : 'SYNTHETIC PREVIEW'}</small>
      {readings.map((reading) => (
        <div
          className={`${styles.row} ${reading.ooc ? styles.oocRow : ''}`}
          key={reading.signal_id}
        >
          <span>{reading.signal_id.replaceAll('_', ' ')}</span>
          <span>
            {reading.value} {reading.unit}
            {reading.ooc ? ' · OOC' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
