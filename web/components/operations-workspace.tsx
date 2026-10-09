'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Gauge, Activity, Radio, Wrench } from 'lucide-react';
import { usePlant } from './session-provider';
import { WorkOrderPanel } from './workflow/work-order-panel';
import { MemoryPanel } from './workflow/memory-panel';
import { stateNames } from './workflow/shared';
import type { Tab } from './workflow/shared';
import styles from './monitoring/monitoring.module.css';

function MaintenanceForm() {
  const { state, busy, act, can } = usePlant();
  const [cause, setCause] = useState('');
  const [fix, setFix] = useState('');
  const [parts, setParts] = useState('');
  const [outcome, setOutcome] = useState('');
  if (!state) return null;
  const incident = state.incident;
  if (!incident)
    return (
      <section className={styles.empty}>
        <Wrench size={32} />
        <h2>No authorized work order</h2>
        <p>Review an incident and approve a valid intervention before scheduling maintenance.</p>
        <Link className="primary" href="/incidents">
          Review incidents
        </Link>
      </section>
    );
  if (incident.record_origin !== 'plant_observation')
    return (
      <section className={styles.empty}>
        <h2>Historical work record</h2>
        <p>
          This {incident.record_origin.replaceAll('_', ' ')} record is read-only. Its original
          authorization does not authorize operational work.
        </p>
        <Link href={`/incidents?incident=${incident.id}`}>Inspect original evidence</Link>
      </section>
    );
  return (
    <section className={styles.editor}>
      <WorkOrderPanel
        state={state}
        busy={busy || !can('repair.write')}
        act={act}
        cause={cause}
        setCause={setCause}
        fix={fix}
        setFix={setFix}
        parts={parts}
        setParts={setParts}
        outcome={outcome}
        setOutcome={setOutcome}
        setTab={(tab: Tab) => {
          if (tab === 'Memory') location.assign('/memory');
        }}
      />
    </section>
  );
}

export default function OperationsWorkspace({
  view = 'operations',
}: {
  view?: 'operations' | 'incidents' | 'maintenance' | 'memory';
}) {
  const { state, selected, selectAsset, busy, act } = usePlant();
  if (!state) return null;
  const operational =
    state.sources?.filter((source) => source.configuration.kind === 'operational') || [];
  const active = state.incidents.filter(
    (incident) => incident.record_origin === 'plant_observation' && incident.state !== 'resolved',
  );
  const asset = state.assets.find((item) => item.id === selected) || state.assets[0];
  const signals = state.signals[asset.id] || [];
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">{state.plant.name.toUpperCase()}</span>
          <h1>
            {view === 'maintenance'
              ? 'Maintenance workspace'
              : view === 'memory'
                ? 'Reliability memory'
                : 'Plant overview'}
          </h1>
          <p>
            {view === 'maintenance'
              ? 'Authorized work, technician outcomes, and observation-based recovery.'
              : view === 'memory'
                ? 'Confirmed repairs retained with their evidence and corrections.'
                : 'Current observations and configured production impact, with clear evidence boundaries.'}
          </p>
        </div>
        <Link className="secondary" href="/plant">
          Open plant <ArrowRight size={15} />
        </Link>
      </header>
      {view === 'maintenance' ? (
        <>
          <div className={styles.actions}>
            {state.incidents
              .filter(
                (incident) => incident.work_order && incident.record_origin === 'plant_observation',
              )
              .map((incident) => (
                <Link
                  key={incident.id}
                  className="secondary"
                  href={`/maintenance?incident=${incident.id}`}
                >
                  {incident.asset_id} · {stateNames[incident.state]}
                </Link>
              ))}
          </div>
          <MaintenanceForm key={state.incident?.id || 'empty'} />
        </>
      ) : view === 'memory' ? (
        <section className={styles.editor}>
          <MemoryPanel
            state={state}
            busy={busy}
            act={act}
            setTab={() => undefined}
            setOption={() => undefined}
          />
        </section>
      ) : (
        <>
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
              {operational.length} operational sources have current observations. Unknown equipment
              is not assumed healthy. <Link href="/monitoring">Review source quality</Link>
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
        </>
      )}
    </div>
  );
}
