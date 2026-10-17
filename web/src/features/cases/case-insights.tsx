'use client';

import type { CaseDetail } from './presentation';
import Link from 'next/link';
import { recordedHistory, verifiedRepairs } from './insight-data';
import { casePresentation, sourceNames } from './presentation';
import styles from './cases.module.css';

export function CaseInsights({
  detail,
  onSource,
}: {
  detail: CaseDetail;
  onSource: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const view = casePresentation(detail);
  const hypotheses = view.investigator?.hypotheses ?? [];
  const previous = detail.runs
    .filter((item) => item.analysis_version < detail.case.analysis_version)
    .sort((a, b) => b.analysis_version - a.analysis_version)[0];
  const prior = previous?.steps.find((step) => step.stage === 'investigator' && step.summary);
  const repairs = verifiedRepairs(detail);
  const history = recordedHistory(detail);
  if (!view.run) return null;
  function citations(ids: string[]) {
    return (
      <div className={styles.sourceLinks}>
        {ids.map((id) => (
          <button
            key={id}
            className={styles.textButton}
            disabled={!view.run?.sources?.some((source) => source.id === id)}
            onClick={(event) => onSource(id, event.currentTarget)}
          >
            {sourceNames[id] || view.run?.sources?.find((source) => source.id === id)?.title || id}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.insights}>
      {history && (
        <details className={styles.specialistFindings}>
          <summary>
            Equipment issue history · {history.count} in {history.windowDays} days
          </summary>
          <p className={styles.note}>
            Recorded reports and detections, including this equipment case. Repeated reports do not
            confirm repeated failures or a shared cause.
          </p>
          {history.cases.map((item) => (
            <p key={item.id}>
              <Link href={`/incidents?workcase=${encodeURIComponent(item.id)}`}>
                {item.title}
                {item.id === detail.case.id ? ' · Current case' : ''}
              </Link>
              <small className={styles.note}>
                {item.origin === 'staff_report'
                  ? 'Staff report'
                  : item.origin === 'plant_observation'
                    ? 'Accepted incident record'
                    : 'Recorded case'}{' '}
                ·{' '}
                {Number.isFinite(Date.parse(item.createdAt))
                  ? new Date(item.createdAt).toLocaleString()
                  : 'Date unavailable'}
              </small>
            </p>
          ))}
          {history.count > history.cases.length && (
            <p className={styles.note}>
              Showing {history.cases.length} saved records from this snapshot.
            </p>
          )}
          <p className={styles.note}>
            Saved analysis snapshot ·{' '}
            {Number.isFinite(Date.parse(history.capturedAt))
              ? new Date(history.capturedAt).toLocaleString()
              : 'Capture time unavailable'}
          </p>
          {citations(['equipment-history'])}
        </details>
      )}
      <details className={styles.specialistFindings} open={hypotheses.length > 0 || undefined}>
        <summary>Possible causes and evidence ({hypotheses.length})</summary>
        {!hypotheses.length && (
          <p>
            No cause proposal has been recorded for this evidence revision. A missing measurement
            does not establish a fault.
          </p>
        )}
        {hypotheses.map((item, index) => (
          <article className={styles.hypothesis} key={index}>
            <strong>{item.cause}</strong>
            <small className={styles.note}>
              Agent assessment: {item.confidence} confidence · cause not physically confirmed
            </small>
            <div className={styles.assessmentCallouts}>
              <div>
                <b>Supporting sources</b>
                {citations(item.supporting_evidence)}
              </div>
              <div>
                <b>Conflicting sources</b>
                {item.conflicting_evidence?.length ? (
                  citations(item.conflicting_evidence)
                ) : (
                  <p className={styles.note}>
                    No conflicting source was cited. This is not proof of the proposed cause.
                  </p>
                )}
              </div>
            </div>
          </article>
        ))}
        {!!view.activeTasks.length && (
          <div className={styles.hypothesis}>
            <strong>Next recorded evidence checks</strong>
            {view.activeTasks.map((task) => (
              <p key={task.id}>
                {task.question}
                <small className={styles.note}>
                  Why: {task.reason} · Requested from {task.owner_name || task.target_role}
                </small>
              </p>
            ))}
          </div>
        )}
      </details>
      {prior && view.investigator && (
        <details className={styles.specialistFindings}>
          <summary>How the assessment changed</summary>
          <div className={styles.assessmentCallouts}>
            <div>
              <strong>Previous · revision {previous.analysis_version}</strong>
              <p>{prior.summary}</p>
            </div>
            <div>
              <strong>Current · revision {detail.case.analysis_version}</strong>
              <p>{view.investigator.summary}</p>
            </div>
          </div>
          <p className={styles.note}>
            Saved assessments remain separate. A new revision does not itself confirm a repair or
            grant approval.
          </p>
        </details>
      )}
      <details className={styles.specialistFindings}>
        <summary>Compare previous verified repairs ({repairs.length})</summary>
        <p className={styles.note}>Current report: {detail.case.description}</p>
        {!repairs.length && (
          <p>
            No usable verified-repair references were included in this saved analysis. Staff reports
            and generated operator cases are not substitutes.
          </p>
        )}
        {repairs.map((repair) => (
          <article className={styles.hypothesis} key={repair.id}>
            <strong>
              {repair.asset_id} ·{' '}
              {repair.asset_id === detail.case.asset_id
                ? 'Same equipment'
                : 'Other equipment in this plant'}
            </strong>
            <dl className={styles.repairFacts}>
              <dt>Recorded cause</dt>
              <dd>{repair.observed_cause}</dd>
              <dt>Recorded fix</dt>
              <dd>{repair.fix}</dd>
              <dt>Recorded outcome</dt>
              <dd>{repair.outcome}</dd>
              <dt>Verified at</dt>
              <dd>
                {repair.verified_at && Number.isFinite(Date.parse(repair.verified_at))
                  ? new Date(repair.verified_at).toLocaleString()
                  : 'Not recorded'}
              </dd>
            </dl>
            <p className={styles.note}>
              Historical outcome. Today’s cause and applicability require current evidence.
            </p>
          </article>
        ))}
        {!!repairs.length && citations(['scoped-knowledge'])}
      </details>
    </div>
  );
}
