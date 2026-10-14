'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePlant } from '@/providers/plant-session-provider';
import { MaintenanceForm } from './maintenance-form';
import { WorkspaceFrame } from '@/components/layout/workspace-frame';
import { stateNames } from '@/lib/workflow';
import styles from '@/components/layout/workspace.module.css';
import { OperationalJourney } from '@/features/incidents/components/operational-journey';

export default function MaintenanceWorkspace() {
  const { state } = usePlant();
  const requested = useSearchParams().get('incident');
  const incident = state?.incident;
  const mismatch = requested && requested !== incident?.id;
  const invalidApproval =
    incident?.state === 'approved' &&
    (incident.work_order?.status !== 'approved' ||
      incident.work_order.approval.calculation_version !== incident.calculation_version);
  if (state && (mismatch || invalidApproval))
    return (
      <section className="panel" style={{ padding: 30 }}>
        <h1>Work order unavailable</h1>
        <p className="muted" style={{ margin: '16px 0' }}>
          This link does not identify a currently authorized intervention. Review the case before
          starting maintenance.
        </p>
        <Link
          className="primary"
          href={incident ? `/incidents?incident=${incident.id}` : '/incidents'}
        >
          Review current incident
        </Link>
      </section>
    );
  if (!state) return null;
  return (
    <WorkspaceFrame
      plantName={state.plant.name}
      title="Maintenance workspace"
      description="Authorized work, technician outcomes, and observation-based recovery."
    >
      <div className={styles.actions}>
        {state.incidents
          .filter((item) => item.work_order && item.record_origin === 'plant_observation')
          .map((item) => (
            <Link key={item.id} className="secondary" href={`/maintenance?incident=${item.id}`}>
              {item.asset_id} · {stateNames[item.state]}
            </Link>
          ))}
      </div>
      {incident && <OperationalJourney incident={incident} />}
      <MaintenanceForm key={incident?.id || 'empty'} />
    </WorkspaceFrame>
  );
}
