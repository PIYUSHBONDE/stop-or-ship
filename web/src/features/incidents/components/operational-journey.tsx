import Link from 'next/link';
import type { Incident } from '@/lib/types';
import styles from './case-journey.module.css';

const NEXT: Record<string, string> = {
  detected: 'Evidence collection is queued. Review the detection record.',
  investigating: 'Investigation is collecting evidence. Diagnosis is not yet complete.',
  investigation_failed:
    'Investigation is incomplete. Review the failure and retry through the incident controls.',
  awaiting_approval:
    'Review evidence, missing checks and deterministic intervention costs before a human decision.',
  proposal_rejected: 'Proposal rejected. Review the recorded decision before reopening.',
  approved:
    'Open the authorized work order. Site procedures and authorized personnel govern physical maintenance.',
  repairing:
    'Record the technician’s observed cause, fix, parts and outcome in the authorized work order.',
  verifying:
    'Wait for three complete, distinct healthy observation windows after repair completion. Missing or abnormal data cannot confirm recovery.',
  resolved: 'Review the verified repair and original hypothesis together in Memory.',
};

export function OperationalJourney({ incident }: { incident: Incident }) {
  const operational = incident.record_origin === 'plant_observation';
  const steps = [
    {
      title: 'Detection',
      complete: true,
      detail: `Source ${incident.source_id || 'not recorded'}${incident.source_version ? ` · revision ${incident.source_version}` : ''}.`,
    },
    {
      title: 'Investigation',
      complete: !!incident.diagnosis,
      detail: incident.provider || 'Investigator not yet recorded.',
    },
    {
      title: 'Human decision',
      complete: !!incident.work_order,
      detail: incident.work_order
        ? `${incident.work_order.id} · ${incident.work_order.status}.`
        : 'No current approved work order.',
    },
    {
      title: 'Recovery',
      complete: incident.state === 'resolved',
      detail: `${incident.verification_windows} of 3 qualifying windows${incident.repair_completed_at ? ` since ${incident.repair_completed_at}` : '; repair completion not recorded'}.`,
    },
  ];
  return (
    <section aria-label="Operational case journey">
      <div className={styles.next}>
        <strong>{operational ? 'Next step' : 'Historical record · read-only'}</strong>
        <p>
          {operational
            ? NEXT[incident.state] || 'Review the saved case state.'
            : 'Historical and replay evidence cannot authorize operational work or verify a current repair.'}
        </p>
        {incident.authorization_blocked_reason && <p>{incident.authorization_blocked_reason}</p>}
      </div>
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step.title} data-complete={step.complete}>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className={styles.links}>
        <Link href={`/incidents?incident=${incident.id}`}>Investigation and decision</Link>
        {operational && incident.work_order && (
          <Link href={`/maintenance?incident=${incident.id}`}>Authorized work and recovery</Link>
        )}
        {operational && incident.state === 'resolved' && (
          <Link href={`/memory?incident=${incident.id}`}>Verified repair memory</Link>
        )}
      </div>
    </section>
  );
}
