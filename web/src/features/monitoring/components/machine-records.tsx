'use client';

import Link from 'next/link';
import Sparkline from '@/components/ui/sparkline';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { seriesFor } from '@/features/monitoring/lib/preview-records';
import type { Asset } from '@/lib/types';
import styles from '@/features/monitoring/components/machine-records.module.css';

export function MachineRecords({ assets }: { assets: Asset[] }) {
  const preview = usePreviewDispatch();
  if (!preview.enabled || !assets.length) return null;
  return (
    <div className={styles.grid} role="list" aria-label="Machine preview records">
      {assets.map((item) => {
        const series = preview.ledger.samples[item.id] || [];
        const current = series.at(-1)?.readings || preview.readings[item.id] || [];
        const primary = current[0];
        const ooc = preview.oocIds.includes(item.id);
        const lastCase = preview.ledger.cases.find((entry) => entry.assetId === item.id);
        return (
          <Link
            key={item.id}
            href={`/monitoring/${encodeURIComponent(item.id)}?preview=1`}
            role="listitem"
            className={`${styles.card} ${ooc ? styles.ooc : ''}`}
            aria-label={`${item.id} preview records`}
          >
            <strong>
              {item.id} · {item.name}
            </strong>
            <small>
              {series.length ? `${series.length} stored records` : 'Recording preview samples'} ·{' '}
              {ooc ? 'preview OOC' : 'in preview limits'}
            </small>
            {primary && (
              <div className={styles.metrics}>
                {current.map((reading) => (
                  <span key={reading.signal_id}>
                    <small>{reading.signal_id.replaceAll('_', ' ')}</small>
                    <b className={reading.ooc ? styles.oocMark : undefined}>
                      {reading.value} {reading.unit}
                      {reading.ooc ? ' · OOC' : ''}
                    </b>
                  </span>
                ))}
              </div>
            )}
            <Sparkline
              label={`${item.id} ${primary?.signal_id || 'preview'} trend`}
              color={ooc ? '#ff8a5b' : '#73d8b7'}
              values={primary ? seriesFor(series, primary.signal_id) : []}
            />
            <small>
              {lastCase
                ? `${lastCase.operatorId} ${lastCase.operatorName} · ${lastCase.id}${lastCase.clearedAt ? ' cleared' : ' assigned'}`
                : 'No preview case yet'}
            </small>
            <span className={styles.open}>Open machine →</span>
          </Link>
        );
      })}
    </div>
  );
}
