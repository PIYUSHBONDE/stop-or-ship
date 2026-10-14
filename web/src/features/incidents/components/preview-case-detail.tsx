'use client';

import Link from 'next/link';
import { usePlant } from '@/providers/plant-session-provider';
import type { MachineCase } from '@/features/monitoring/lib/preview-records';
import styles from '@/features/incidents/components/incidents.module.css';
import recordStyles from '@/features/monitoring/components/machine-records.module.css';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { caseJourney, simulationCaseStatus } from '../lib/simulation-case';
import dossier from './case-journey.module.css';

export function PreviewCaseDetail({ item }: { item: MachineCase }) {
  const { state } = usePlant();
  const { ledger } = usePreviewDispatch();
  const asset = state?.assets.find((candidate) => candidate.id === item.assetId);
  const previous = ledger.cases
    .filter(
      (c) =>
        c.id !== item.id &&
        c.assetId === item.assetId &&
        c.occurredAt < item.occurredAt &&
        c.clearedAt &&
        !c.interrupted,
    )
    .slice(0, 3);
  return (
    <section
      className={`${styles.detail} ${recordStyles.detail}`}
      aria-label={`${item.id} preview case`}
    >
      <span className={styles.eyebrow}>
        SYNTHETIC OOC CASE · {item.id} · {item.severity.toUpperCase()}
      </span>
      <h2>
        {item.assetId} · {item.context?.assetName || asset?.name || item.assetType}
      </h2>
      <p>{item.message}</p>
      <div className={dossier.next}>
        <strong>Simulated case · {simulationCaseStatus(item)}</strong>
        <p>
          Review saved detection, follow the response, then distinguish scenario recovery from
          operational proof.
        </p>
      </div>
      <ol className={dossier.steps} aria-label="Simulated case journey">
        {caseJourney(item).map((step) => (
          <li key={step.title} data-complete={!!step.at}>
            <strong>{step.title}</strong>
            <small>
              {step.at
                ? clock(step.at)
                : item.interrupted
                  ? 'Interrupted; no completion recorded'
                  : 'Pending'}
            </small>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>
      <section className={dossier.section} aria-label="Saved production impact">
        <h3>Production impact at detection</h3>
        {item.context ? (
          <>
            <p>
              Dependency path: {item.context.affected.map((a) => `${a.id} ${a.name}`).join(' · ')}
            </p>
            {item.context.lines.map((line) => (
              <p key={line.id}>
                {line.name}: {line.capacity} parts/h configured capacity exposed to this scenario.
              </p>
            ))}
            {!item.context.lines.length && <p>No downstream press line was captured.</p>}
            <small>
              Saved configuration snapshot. Capacity exposed is not measured production loss or
              money saved.
            </small>
          </>
        ) : (
          <p>
            Historical topology was not captured for this legacy case. Current configuration cannot
            establish its original impact.
          </p>
        )}
      </section>
      <section className={dossier.section} aria-label="Case evidence and uncertainty">
        <h3>What the evidence establishes</h3>
        <p>
          Saved synthetic detection: {item.signalId.replaceAll('_', ' ')} {item.value} {item.unit},
          against {item.metadata.envelope}. Current machine readings may differ.
        </p>
        <p>
          Mechanical cause: unconfirmed. A pressure deviation alone does not distinguish leakage,
          restriction, pump wear or sensor error.
        </p>
        <p>
          No technician inspection, physical isolation or repair finding has been recorded. The
          automatic response is an authored scenario.
        </p>
        <p>
          Operational work requires a reviewed source and procedure, evidence-backed investigation,
          a versioned human decision, technician findings and post-repair observations.
        </p>
        <Link href={`/incidents?case=${encodeURIComponent(item.id)}&ask=case`}>
          Review this case with Ask PlantSense
        </Link>
      </section>
      {item.interrupted && (
        <p>Interrupted simulation: this legacy case has no saved active dispatch.</p>
      )}
      <dl className={recordStyles.meta}>
        <div>
          <dt>Occurred</dt>
          <dd>{clock(item.occurredAt)}</dd>
        </div>
        <div>
          <dt>Attended</dt>
          <dd>
            {item.attendedAt
              ? clock(item.attendedAt)
              : item.interrupted
                ? 'Not retained in legacy dispatch state'
                : 'Operator still walking'}
          </dd>
        </div>
        <div>
          <dt>Fixed</dt>
          <dd>
            {item.fixedAt
              ? clock(item.fixedAt)
              : item.interrupted
                ? 'Interrupted simulation'
                : 'Fix in progress · at least 2 minutes'}
          </dd>
        </div>
        <div>
          <dt>Operator</dt>
          <dd>
            {item.operatorId} {item.operatorName} · {item.metadata.years}y {item.metadata.craft}
          </dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd>
            {item.clearedAt
              ? clock(item.clearedAt)
              : item.interrupted
                ? 'Interrupted simulation'
                : item.fixedAt
                  ? 'Checking stable pressure'
                  : 'Awaiting repair and recovery'}
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
      <section className={dossier.section} aria-label="Earlier simulated cases">
        <h3>Earlier scenario outcomes</h3>
        <p>
          Browser-local rehearsal history. These outcomes never enter verified operational repair
          memory.
        </p>
        {previous.length ? (
          previous.map((c) => (
            <p key={c.id}>
              <Link href={`/incidents?case=${encodeURIComponent(c.id)}`}>
                {c.id} · {clock(c.occurredAt)}
              </Link>
            </p>
          ))
        ) : (
          <p>No earlier recovered scenario is retained for this machine.</p>
        )}
      </section>
      <div className={recordStyles.actions}>
        <Link className="secondary" href={`/monitoring/${encodeURIComponent(item.assetId)}`}>
          Machine records
        </Link>
        <Link className="secondary" href={`/operators?assignment=${item.id}`}>
          Live assignment
        </Link>
        <Link className="primary" href={`/plant?asset=${encodeURIComponent(item.assetId)}`}>
          Watch plant floor
        </Link>
        <Link
          className="secondary"
          href={`/plant?view=observations&asset=${encodeURIComponent(item.assetId)}`}
        >
          Operational evidence
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
