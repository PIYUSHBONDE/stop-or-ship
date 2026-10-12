'use client';

import Link from 'next/link';
import { usePlant } from '@/providers/plant-session-provider';
import { guideFor, machineAddress } from '@/features/memory/lib/plant-guide';
import styles from '@/features/monitoring/components/machine-records.module.css';

export function PlantGuideBoard({ query = '' }: { query?: string }) {
  const { state } = usePlant();
  if (!state) return null;
  const assets = state.assets.filter((asset) =>
    `${asset.id} ${asset.name} ${asset.area_id} ${asset.type}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className={styles.grid} role="list" aria-label="Plant machine guides">
      {assets.map((asset) => {
        const area = state.areas.find((item) => item.id === asset.area_id);
        const guide = guideFor(asset.type);
        return (
          <Link
            key={asset.id}
            href={`/memory/${encodeURIComponent(asset.id)}`}
            role="listitem"
            className={styles.card}
            aria-label={`${asset.id} plant guide`}
          >
            <strong>
              {asset.id} · {asset.name}
            </strong>
            <small>{machineAddress(asset, area?.name)}</small>
            <p>{guide.summary}</p>
            <small>
              {guide.canBreak.length} failure modes · {guide.canFix.length} recoveries
            </small>
            <span className={styles.open}>Open guide →</span>
          </Link>
        );
      })}
    </div>
  );
}
