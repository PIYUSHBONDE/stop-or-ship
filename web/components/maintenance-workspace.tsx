'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePlant } from './session-provider';
import OperationsWorkspace from './operations-workspace';

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
  return <OperationsWorkspace view="maintenance" />;
}
