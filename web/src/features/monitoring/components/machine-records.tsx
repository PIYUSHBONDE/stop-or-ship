'use client';

import Link from 'next/link';
import Sparkline, { FACTOR_COLORS } from '@/components/ui/sparkline';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { limitWords } from '@/features/monitoring/lib/preview-diagnosis';
import { seriesFor } from '@/features/monitoring/lib/preview-records';
import type { Asset, State } from '@/lib/types';
import styles from '@/features/monitoring/components/machine-records.module.css';

type Area = State['areas'][number];

export function LineRecords({
  assets,
  areas,
  query,
}: {
  assets: Asset[];
  areas: Area[];
  query: string;
}) {
  const preview = usePreviewDispatch();
  const needle = query.trim().toLowerCase();
  const known = new Set(areas.map((area) => area.id));
  const extras: Area[] = [...new Set(assets.map((asset) => asset.area_id))]
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      name: id,
      purpose: 'Equipment without a configured line',
      nominal_units_per_hour: 0,
    }));
  const groups = [...areas, ...extras]
    .map((area) => {
      const onLine = assets.filter((asset) => asset.area_id === area.id);
      const lineText = `${area.name} ${area.id} ${area.purpose}`.toLowerCase();
      const lineMatches = !needle || lineText.includes(needle);
      const machines = onLine.filter(
        (asset) =>
          lineMatches || `${asset.name} ${asset.id} ${asset.type}`.toLowerCase().includes(needle),
      );
      return { area, machines };
    })
    .filter((group) => group.machines.length)
    .sort(
      (left, right) =>
        Number(right.area.nominal_units_per_hour > 0) -
          Number(left.area.nominal_units_per_hour > 0) ||
        left.area.name.localeCompare(right.area.name),
    );
  if (!groups.length) return null;
  return (
    <div className={styles.lines} role="list" aria-label="Production line records">
      {groups.map(({ area, machines }) => {
        const live = preview.view?.lines.find((line) => line.id === area.id);
        const ooc = machines.some((machine) => preview.oocIds.includes(machine.id));
        return (
          <section
            key={area.id}
            role="listitem"
            className={`${styles.line} ${ooc ? styles.ooc : ''}`}
            aria-label={`${area.name} records`}
          >
            <header className={styles.lineHeader}>
              <div>
                <span className="eyebrow">
                  {area.nominal_units_per_hour > 0 ? 'PRODUCTION LINE' : 'SUPPORTING AREA'} ·{' '}
                  {area.id}
                </span>
                <h2>{area.name}</h2>
                <p>
                  {machines.length} machine{machines.length === 1 ? '' : 's'}
                  {live
                    ? ` · ${live.rate} / ${live.nominal_units_per_hour} parts/h · ${live.mode.replaceAll('_', ' ')}`
                    : ''}
                  {ooc ? ' · a signal is outside the limit' : ''}
                </p>
              </div>
            </header>
            <div className={styles.grid} aria-label={`${area.name} machines`}>
              {machines.map((item) => {
                const series = preview.ledger.samples[item.id] || [];
                const current = series.at(-1)?.readings || preview.readings[item.id] || [];
                const machineOoc = preview.oocIds.includes(item.id);
                const lastCase = preview.ledger.cases.find((entry) => entry.assetId === item.id);
                return (
                  <Link
                    key={item.id}
                    href={`/monitoring/${encodeURIComponent(item.id)}`}
                    className={`${styles.card} ${machineOoc ? styles.ooc : ''}`}
                    aria-label={`${item.id} preview records`}
                  >
                    <strong>
                      {item.id} · {item.name}
                    </strong>
                    <small>
                      {series.length
                        ? `${series.length} stored records`
                        : 'Recording preview samples'}{' '}
                      · {machineOoc ? 'outside the limit' : 'inside the limit'}
                    </small>
                    {current.length > 0 && (
                      <div className={styles.metrics}>
                        {current.map((reading) => (
                          <span key={reading.signal_id}>
                            <small>{reading.signal_id.replaceAll('_', ' ')}</small>
                            <b className={reading.ooc ? styles.oocMark : undefined}>
                              {reading.value} {reading.unit} · {limitWords(reading)}
                            </b>
                          </span>
                        ))}
                      </div>
                    )}
                    <Sparkline
                      label={`${item.id} factor trends`}
                      series={current.map((reading, index) => ({
                        name: reading.signal_id,
                        color: FACTOR_COLORS[index % FACTOR_COLORS.length],
                        low: reading.low,
                        high: reading.high,
                        values: seriesFor(series, reading.signal_id),
                      }))}
                    />
                    {current.length > 0 && (
                      <ul className={styles.legend}>
                        {current.map((reading, index) => (
                          <li key={reading.signal_id}>
                            <i data-tone={index % FACTOR_COLORS.length} />
                            {reading.signal_id.replaceAll('_', ' ')}
                          </li>
                        ))}
                      </ul>
                    )}
                    <small>
                      {lastCase
                        ? `${lastCase.operatorId} ${lastCase.operatorName} · ${lastCase.id}${lastCase.interrupted ? ' interrupted' : lastCase.clearedAt ? ' cleared' : ' assigned'}`
                        : 'No preview case yet'}
                    </small>
                    <span className={styles.open}>Open machine →</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
