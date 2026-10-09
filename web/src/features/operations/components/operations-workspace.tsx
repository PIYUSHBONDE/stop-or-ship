'use client';
import Link from 'next/link';
import { ArrowRight, Gauge, Activity, Radio } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { WorkspaceFrame } from '@/components/layout/workspace-frame';
import { stateNames } from '@/lib/workflow';
import styles from '@/components/layout/workspace.module.css';

export default function OperationsWorkspace() {
  const { state, selected, selectAsset } = usePlant();
  if (!state) return null;
  const operational =
    state.sources?.filter((source) => source.configuration.kind === 'operational') || [];
  const active = state.incidents.filter(
    (incident) => incident.record_origin === 'plant_observation' && incident.state !== 'resolved',
  );
  const asset = state.assets.find((item) => item.id === selected) || state.assets[0];
  const signals = state.signals[asset.id] || [];
  return (
    <WorkspaceFrame
      plantName={state.plant.name}
      title="Plant overview"
      description="Current observations and configured production impact, with clear evidence boundaries."
    >
      <div className={styles.metrics}>
        <div>
          <small>
            <Gauge size={15} /> Measured plant output
          </small>
          <strong>{state.measured_output_per_hour ?? 'Unavailable'}</strong>
          <small>parts / h · requires current dispatch observations</small>
        </div>
        <div>
          <small>Rated plant capacity</small>
          <strong>{state.nominal_output_per_hour}</strong>
          <small>parts / h · configured</small>
        </div>
        <div>
          <small>Estimated available output</small>
          <strong>{state.estimated_output_per_hour ?? state.nominal_output_per_hour}</strong>
          <small>parts / h · dependency model, not a measurement</small>
        </div>
      </div>
      <section className={styles.notice}>
        <Radio size={20} />
        <p>
          {operational.filter((source) => source.quality === 'fresh').length} of{' '}
          {operational.length} operational sources have current observations. Unknown equipment is
          not assumed healthy. <Link href="/monitoring">Review source quality</Link>
        </p>
      </section>
      <div className={styles.sourceList}>
        <section className={styles.source}>
          <h2>
            <Activity size={20} /> Active incidents
          </h2>
          {active.length ? (
            active.map((incident) => (
              <div className={styles.previewRow} key={incident.id}>
                <strong>
                  {incident.asset_id} · {stateNames[incident.state]}
                </strong>
                <span>{incident.diagnosis?.summary || 'Evidence collection in progress'}</span>
                <Link href={`/incidents?incident=${incident.id}`}>
                  Inspect evidence and interventions <ArrowRight size={14} />
                </Link>
              </div>
            ))
          ) : (
            <p>No active operational incidents. This does not establish plant health.</p>
          )}
          <Link href="/incidents">Browse incident history</Link>
        </section>
        <section className={styles.source}>
          <h2>Equipment observations</h2>
          <label>
            Equipment
            <select value={asset.id} onChange={(event) => selectAsset(event.target.value)}>
              {state.assets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <p>Condition: {asset.status}</p>
          {signals.length ? (
            signals.map((signal) => (
              <div className={styles.previewRow} key={signal.signal_id}>
                <strong>
                  {signal.signal_id.replaceAll('_', ' ')} · {signal.value} {signal.unit}
                </strong>
                <span>
                  {signal.timestamp || 'Acquisition time unavailable'} ·{' '}
                  {signal.provenance.replaceAll('_', ' ')}
                </span>
                <span>Record {signal.source_record_id}</span>
              </div>
            ))
          ) : (
            <p>No data connected / Condition unknown</p>
          )}
        </section>
      </div>
    </WorkspaceFrame>
  );
}
