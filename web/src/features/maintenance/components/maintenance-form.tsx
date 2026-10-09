'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { WorkOrderPanel } from './work-order-panel';
import styles from '@/components/layout/workspace.module.css';

export function MaintenanceForm() {
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
        onOpenMemory={() => location.assign('/memory')}
      />
    </section>
  );
}
