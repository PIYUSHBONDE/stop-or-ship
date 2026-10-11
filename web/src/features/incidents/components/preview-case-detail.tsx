'use client';

import Link from 'next/link';
import { usePlant } from '@/providers/plant-session-provider';
import type { MachineCase } from '@/features/monitoring/lib/preview-records';
import styles from '@/features/incidents/components/incidents.module.css';
import recordStyles from '@/features/monitoring/components/machine-records.module.css';

export function PreviewCaseDetail({ item }: { item: MachineCase }) {
  const { state } = usePlant();
  const asset = state?.assets.find((candidate) => candidate.id === item.assetId);
  return (
    <section
      className={`${styles.detail} ${recordStyles.detail}`}
      aria-label={`${item.id} preview case`}
    >
      <span className={styles.eyebrow}>
        SYNTHETIC OOC CASE · {item.id} · {item.severity.toUpperCase()}
      </span>
      <h2>
        {item.assetId} · {asset?.name || item.assetType}
      </h2>
      <p>{item.message}</p>
      <dl className={recordStyles.meta}>
        <div>
          <dt>Occurred</dt>
          <dd>{clock(item.occurredAt)}</dd>
        </div>
        <div>
          <dt>Attended</dt>
          <dd>{item.attendedAt ? clock(item.attendedAt) : 'Operator still walking'}</dd>
        </div>
        <div>
          <dt>Fixed</dt>
          <dd>{item.fixedAt ? clock(item.fixedAt) : 'Fix in progress · at least 2 minutes'}</dd>
        </div>
        <div>
          <dt>Operator</dt>
          <dd>
            {item.operatorId} {item.operatorName} · {item.metadata.years}y {item.metadata.craft}
          </dd>
        </div>
        <div>
          <dt>Metric</dt>
          <dd>
            {item.signalId.replaceAll('_', ' ')} {item.value} {item.unit}
          </dd>
        </div>
        <div>
          <dt>Envelope</dt>
          <dd>{item.metadata.envelope}</dd>
        </div>
        <div>
          <dt>Assignment</dt>
          <dd>{item.metadata.assignmentId}</dd>
        </div>
        <div>
          <dt>Tick</dt>
          <dd>{item.metadata.openedTick}</dd>
        </div>
      </dl>
      <p className="muted">
        This record is preview dispatch metadata. It is not an operational incident and does not
        authorize work.
      </p>
      <div className={recordStyles.actions}>
        <Link className="secondary" href={`/monitoring/${encodeURIComponent(item.assetId)}`}>
          Machine records
        </Link>
        <Link className="secondary" href={`/operators?assignment=${item.id}`}>
          Live assignment
        </Link>
        <Link className="primary" href="/plant">
          Watch plant floor
        </Link>
      </div>
    </section>
  );
}

function clock(at: number) {
  return new Date(at).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}
