'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import Sparkline from '@/components/ui/sparkline';
import { usePlant } from '@/providers/plant-session-provider';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { seriesFor } from '@/features/monitoring/lib/preview-records';
import styles from '@/features/monitoring/components/machine-records.module.css';
import pageStyles from '@/components/layout/workspace.module.css';

export function MachineRecordPage({ assetId }: { assetId: string }) {
  const { state, selectAsset } = usePlant();
  const preview = usePreviewDispatch();
  const asset = state?.assets.find((item) => item.id === assetId);
  useEffect(() => {
    if (assetId) selectAsset(assetId);
  }, [assetId, selectAsset]);
  if (!state) return null;
  if (!asset)
    return (
      <div className={pageStyles.page}>
        <h1>Machine not found</h1>
        <p>That equipment is not in this plant catalog.</p>
        <Link className="secondary" href="/monitoring">
          <ArrowLeft size={15} /> Back to machine cards
        </Link>
      </div>
    );
  const samples = preview.ledger.samples[asset.id] || [];
  const latest = samples.at(-1)?.readings || preview.readings[asset.id] || [];
  const cases = preview.ledger.cases.filter((item) => item.assetId === asset.id);
  const ooc = preview.oocIds.includes(asset.id);
  return (
    <div className={pageStyles.page}>
      <header className={pageStyles.heading}>
        <div>
          <span className="eyebrow">
            SYNTHETIC LEDGER <span className="live-tag">{asset.id}</span>
          </span>
          <h1>{asset.name}</h1>
          <p>
            {samples.length} stored preview records · {ooc ? 'preview OOC' : 'in preview limits'}.
            These samples do not become operational observations or authorize work.
          </p>
        </div>
        <Link className="secondary" href="/monitoring">
          <ArrowLeft size={15} /> All machines
        </Link>
      </header>
      <section className={styles.detail} aria-label={`${asset.id} record history`}>
        {latest.map((reading) => (
          <div className={styles.chart} key={reading.signal_id}>
            <small>
              {reading.signal_id.replaceAll('_', ' ')} · {reading.value} {reading.unit} · limits{' '}
              {reading.low}–{reading.high}
              {reading.ooc ? ' · OOC' : ''}
            </small>
            <Sparkline
              label={`${asset.id} ${reading.signal_id} history`}
              color={reading.ooc ? '#ff8a5b' : '#73d8b7'}
              values={seriesFor(samples, reading.signal_id)}
            />
          </div>
        ))}
        <table className={styles.table}>
          <caption className="eyebrow">Stored samples</caption>
          <thead>
            <tr>
              <th>Record</th>
              <th>Time</th>
              <th>Metrics</th>
            </tr>
          </thead>
          <tbody>
            {[...samples]
              .reverse()
              .slice(0, 24)
              .map((sample) => (
                <tr key={sample.id}>
                  <td>{sample.id}</td>
                  <td>{clock(sample.at)}</td>
                  <td>
                    {sample.readings
                      .map(
                        (reading) =>
                          `${reading.signal_id.replaceAll('_', ' ')} ${reading.value}${reading.ooc ? ' OOC' : ''}`,
                      )
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            {!samples.length && (
              <tr>
                <td colSpan={3}>Waiting for the first preview tick.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className={styles.cases}>
          <small className="eyebrow">CASE HISTORY</small>
          {cases.length ? (
            cases.map((item) => (
              <div className={styles.case} key={item.id}>
                <strong>
                  {item.id} · {item.operatorId} {item.operatorName}
                </strong>
                <small>
                  {item.signalId.replaceAll('_', ' ')} {item.value} {item.unit} · {item.severity} ·{' '}
                  {item.clearedAt
                    ? `cleared ${clock(item.clearedAt)}`
                    : `assigned ${clock(item.openedAt)} · fix takes at least 2 minutes`}
                </small>
                <Link href={`/incidents?case=${item.id}`}>Open case</Link>
              </div>
            ))
          ) : (
            <p>No operator has taken a preview OOC on this machine yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
