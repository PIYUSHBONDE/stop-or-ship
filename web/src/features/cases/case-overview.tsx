'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Clock3,
  ShieldCheck,
  ArrowRight,
  FileText,
  GitBranch,
  CircleAlert,
} from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { HumanTaskCard } from './human-task';
import {
  casePresentation,
  stageNames,
  sourceNames,
  eventTitle,
  sourceSummary,
  type CaseDetail,
} from './presentation';
import styles from './cases.module.css';

export function CaseOverview({
  detail,
  onChanged,
  children,
}: {
  detail: CaseDetail;
  onChanged: () => void;
  children: ReactNode;
}) {
  const { state } = usePlant();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (sourceId) {
      sourcePanel.current?.focus({ preventScroll: true });
      sourcePanel.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [sourceId]);
  function openSource(id: string, trigger: HTMLButtonElement) {
    sourceTrigger.current = trigger;
    setSourceId(id);
  }
  const [feedback, setFeedback] = useState('');
  const taskChanged = (message?: string) => {
    setFeedback(message || 'Task updated.');
    onChanged();
  };
  const view = casePresentation(detail, state?.workspace?.user.id, state?.workspace?.role);
  const asset = state?.assets.find((item) => item.id === detail.case.asset_id);
  const source = view.run?.sources?.find((item) => item.id === sourceId);
  const references = view.run?.sources?.filter((item) => !(item.id in sourceNames)) ?? [];
  const taskIds = new Set(view.activeTasks.map((task) => task.id));
  const pastTasks = detail.tasks.filter((task) => !taskIds.has(task.id));
  const phase = detail.case.phase;
  const role = state?.workspace?.role;
  const reviewer = ['admin', 'manager', 'reliability'].includes(role || '');
  const outcomeAction =
    phase === 'awaiting_decision' &&
    !detail.case.incident_id &&
    !['equipment', 'maintenance'].includes(detail.case.category) &&
    ['admin', 'manager'].includes(role || '');
  function openControl(name: string) {
    const controls = document.getElementById('case-controls');
    controls?.setAttribute('open', '');
    const target = controls?.querySelector<HTMLDetailsElement>(`[data-case-control="${name}"]`);
    target?.setAttribute('open', '');
    target?.scrollIntoView({ block: 'nearest' });
    target?.querySelector('summary')?.focus();
  }
  const stageIndex = view.terminal
    ? 3
    : view.next
      ? 2
      : phase === 'investigating'
        ? 1
        : phase === 'triage'
          ? 0
          : 3;
  return (
    <div className={styles.caseWorkspace}>
      <header className={styles.caseHeading}>
        <div>
          <h1>{detail.case.title}</h1>
          <p>
            {asset?.name || 'Plant-wide issue'}
            {detail.case.asset_id ? ` · ${detail.case.asset_id}` : ''} ·{' '}
            {asset?.area_id
              ? `${state?.areas.find((area) => area.id === asset.area_id)?.name || asset.area_id} · `
              : ''}
            {detail.case.origin === 'staff_report'
              ? 'Staff-reported issue'
              : 'Observation-based incident'}
          </p>
        </div>
        <div className={styles.headingActions}>
          <button className={styles.textButton} onClick={onChanged}>
            Refresh cases
          </button>
          <Link href="/incidents">
            All cases <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <div className={styles.statusBand} role="status" aria-atomic="true" data-phase={phase}>
        <Clock3 size={20} aria-hidden="true" />
        <div>
          <strong>{view.status}</strong>
          <p>{view.explanation}</p>
        </div>
        {view.next && (
          <span className={styles.ownerBadge}>
            {view.next.target_role} · {view.mine ? 'You' : view.next.owner_name || 'Unclaimed'}
          </span>
        )}
      </div>
      {feedback && (
        <p role="status" className={styles.success}>
          {feedback}
        </p>
      )}
      <ol className={styles.journey} aria-label="Case progress">
        {['Report recorded', 'Evidence review', 'Human finding', 'Next decision'].map(
          (name, index) => (
            <li key={name} aria-current={index === stageIndex ? 'step' : undefined}>
              <span>
                {index === 0 ||
                (index === 1 &&
                  view.run?.steps.some(
                    (step) => step.stage === 'context' && step.state === 'completed',
                  )) ||
                (index === 2 && detail.tasks.some((task) => task.state === 'completed')) ||
                (index === 3 && view.terminal) ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              {name}
            </li>
          ),
        )}
      </ol>
      <div className={styles.caseColumns}>
        <div className={styles.caseMain}>
          <section className={styles.assessmentSection} aria-label="Latest case assessment">
            <div className={styles.line}>
              <h3>What we know</h3>
              <span>Analysis revision {detail.case.analysis_version}</span>
            </div>
            <p className={styles.assessment}>
              {view.investigator?.summary ||
                'The report is recorded. No completed assessment is available for the current evidence revision.'}
            </p>
            {!!view.missing.length && (
              <div className={styles.evidenceGap}>
                <CircleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>What still needs checking</strong>
                  <p>{view.missing.map((item) => item.title).join('; ')}.</p>
                  <small>Missing evidence does not confirm a fault.</small>
                </div>
              </div>
            )}
            {view.production && (
              <div className={styles.productionImpact}>
                <GitBranch size={18} aria-hidden="true" />
                <div>
                  <h4>Production impact</h4>
                  <p>{view.production.summary}</p>
                </div>
              </div>
            )}
            <p className={styles.note}>
              Staff reports and AI findings do not verify physical cause, spending approval or
              repair.
            </p>
            {view.run && (
              <details>
                <summary>Specialist findings</summary>
                {view.run.steps
                  .filter((step) => step.stage !== 'context')
                  .map((step) => (
                    <article className={styles.task} key={step.stage}>
                      <strong>
                        {stageNames[step.stage] || step.stage} · {step.state.replaceAll('_', ' ')}
                      </strong>
                      <p>{step.summary || 'No assessment has been saved for this stage.'}</p>
                      {!!step.unsupported_claims?.length && (
                        <p className={styles.gap}>
                          <strong>Needs evidence:</strong> {step.unsupported_claims.join('; ')}
                        </p>
                      )}
                      {!!step.hypotheses?.length && (
                        <ul>
                          {step.hypotheses.map((hypothesis, index) => (
                            <li key={index}>
                              {hypothesis.cause} · {hypothesis.confidence} confidence
                              <div className={styles.sourceLinks}>
                                {hypothesis.supporting_evidence.map((id) => (
                                  <button
                                    key={id}
                                    className={styles.textButton}
                                    disabled={!view.run?.sources?.some((item) => item.id === id)}
                                    onClick={(event) => openSource(id, event.currentTarget)}
                                  >
                                    Support: {sourceNames[id] || id}
                                  </button>
                                ))}
                                {(hypothesis.conflicting_evidence ?? []).map((id) => (
                                  <button
                                    key={id}
                                    className={styles.textButton}
                                    disabled={!view.run?.sources?.some((item) => item.id === id)}
                                    onClick={(event) => openSource(id, event.currentTarget)}
                                  >
                                    Conflicting: {sourceNames[id] || id}
                                  </button>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className={styles.sourceLinks}>
                        {(step.citations ?? []).map((id) => (
                          <button
                            key={id}
                            className={styles.textButton}
                            disabled={!view.run?.sources?.some((item) => item.id === id)}
                            onClick={(event) => openSource(id, event.currentTarget)}
                          >
                            {view.run?.sources?.find((item) => item.id === id)?.title ||
                              sourceNames[id] ||
                              id}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
              </details>
            )}
          </section>
          <section className={styles.evidenceSection} aria-labelledby="case-evidence-heading">
            <h3 id="case-evidence-heading">Evidence behind this assessment</h3>
            {detail.evidence.map((item) => (
              <details className={styles.evidenceRow} key={item.id}>
                <summary>
                  <FileText size={15} aria-hidden="true" />
                  <span>
                    {item.origin === 'staff_report'
                      ? 'Staff report'
                      : item.origin === 'manager_outcome'
                        ? 'Manager outcome'
                        : 'Human finding'}
                    <small>
                      {item.actor_name || 'Recorded staff member'} ·{' '}
                      {new Date(item.created_at).toLocaleString()}
                    </small>
                  </span>
                </summary>
                <p>{item.text}</p>
                {(item.values ?? []).map((value, index) => (
                  <p key={index}>
                    {value.signal_id}: {value.value} {value.unit} · Staff-reported
                  </p>
                ))}
              </details>
            ))}
            {view.run?.sources
              ?.filter((item) => item.id in sourceNames)
              .map((item) => (
                <button
                  className={styles.sourceRow}
                  key={item.id}
                  aria-expanded={sourceId === item.id}
                  onClick={(event) => openSource(item.id, event.currentTarget)}
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{sourceSummary(item)}</small>
                  </span>
                  <span className={styles.sourceStatus} data-status={item.status}>
                    {item.status === 'missing'
                      ? 'Not available'
                      : item.status === 'reference'
                        ? 'Reference'
                        : 'Saved source'}{' '}
                    <ArrowRight size={13} aria-hidden="true" />
                  </span>
                </button>
              ))}
            {!!references.length && (
              <details className={styles.referenceGroup}>
                <summary>Procedure and repair references ({references.length})</summary>
                {references.map((item) => (
                  <button
                    className={styles.sourceRow}
                    key={item.id}
                    onClick={(event) => openSource(item.id, event.currentTarget)}
                  >
                    {item.title} · {item.id}
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ))}
              </details>
            )}
            {!detail.evidence.length && !view.run?.sources?.length && (
              <p className={styles.note}>No evidence submissions have been recorded yet.</p>
            )}
            {source && (
              <section
                ref={sourcePanel}
                tabIndex={-1}
                className={styles.sourceDetail}
                aria-label="Selected evidence source"
              >
                <div className={styles.line}>
                  <h4>{source.title}</h4>
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      setSourceId(null);
                      sourceTrigger.current?.focus({ preventScroll: true });
                    }}
                  >
                    Close source
                  </button>
                </div>
                <p>{sourceSummary(source)}</p>
                {source.status === 'reference' && !source.text.trim().startsWith('{') && (
                  <p>{source.text}</p>
                )}
                <details>
                  <summary>Saved source details</summary>
                  <pre>{source.text}</pre>
                </details>
              </section>
            )}
          </section>
          <section className={styles.timeline}>
            <h3>What happened</h3>
            {detail.events.slice(0, 3).map((event) => (
              <div key={event.sequence} className={styles.activityItem}>
                <span className={styles.activityDot} />
                <div>
                  <p>{eventTitle(event)}</p>
                  <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
                </div>
              </div>
            ))}
            <details>
              <summary>View complete recorded activity</summary>
              {detail.events.slice(3).map((event) => (
                <p className={styles.note} key={event.sequence}>
                  {new Date(event.at).toLocaleString()} · {eventTitle(event)}
                </p>
              ))}
            </details>
          </section>
          <details>
            <summary>Previous analysis revisions</summary>
            {detail.runs
              .filter((run) => run.id !== view.run?.id)
              .map((run) => (
                <details key={run.id}>
                  <summary>
                    Revision {run.analysis_version} · {run.provider} ·{' '}
                    {run.state.replaceAll('_', ' ')}
                  </summary>
                  {run.steps.map((step) => (
                    <p key={step.stage}>
                      <strong>{stageNames[step.stage] || step.stage}</strong> ·{' '}
                      {step.summary || step.state}
                    </p>
                  ))}
                </details>
              ))}
            {detail.runs.length < 2 && (
              <p className={styles.note}>No earlier revisions recorded.</p>
            )}
          </details>
          {children}
        </div>
        <aside className={styles.caseAside} aria-label="Next case action">
          <section className={styles.nextAction}>
            <h3>
              {view.mine
                ? 'Your next action'
                : view.available
                  ? 'A task you can take'
                  : 'What happens next'}
            </h3>
            {view.next ? (
              <>
                <HumanTaskCard inCase task={view.next} onChanged={taskChanged} />
                {view.activeTasks.length > 1 && (
                  <details>
                    <summary>{view.activeTasks.length - 1} other active tasks</summary>
                    {view.activeTasks
                      .filter((task) => task.id !== view.next?.id)
                      .map((task) => (
                        <HumanTaskCard inCase key={task.id} task={task} onChanged={taskChanged} />
                      ))}
                  </details>
                )}
              </>
            ) : (
              <>
                <h4>{view.status}</h4>
                <p>{view.explanation}</p>
                {!view.terminal && detail.case.incident_id && (
                  <Link href={`/incidents?incident=${encodeURIComponent(detail.case.incident_id)}`}>
                    Review linked incident
                  </Link>
                )}
                {!view.terminal && !view.next && reviewer && phase !== 'investigating' && (
                  <button
                    className="secondary"
                    onClick={() => openControl(outcomeAction ? 'outcome' : 'information')}
                  >
                    {outcomeAction ? 'Record outcome' : 'Request missing information'}
                  </button>
                )}
                {view.run?.error && (
                  <p className={styles.error}>
                    Analysis stopped: {view.run.error}. A reviewer can address the cause and retry;
                    saved evidence remains available.
                  </p>
                )}
              </>
            )}
          </section>
          <section className={styles.aiActivity}>
            <h3>AI activity</h3>
            {view.run?.steps.map((step) => (
              <p key={step.stage}>
                <span>{stageNames[step.stage] || step.stage}</span>
                <strong data-state={step.state}>{step.state.replaceAll('_', ' ')}</strong>
              </p>
            ))}
            {!view.run && <p>No analysis has started for this revision.</p>}
            <p>{view.status}</p>
            <small>
              Last case update{' '}
              <time dateTime={detail.case.updated_at}>
                {new Date(detail.case.updated_at).toLocaleString()}
              </time>
            </small>
          </section>
          {!!pastTasks.length && (
            <details>
              <summary>Completed and closed tasks ({pastTasks.length})</summary>
              {pastTasks.map((task) => (
                <HumanTaskCard inCase readOnly key={task.id} task={task} onChanged={taskChanged} />
              ))}
            </details>
          )}
        </aside>
      </div>
      <p className={styles.boundary}>
        <ShieldCheck size={15} aria-hidden="true" /> AI findings are advisory. Approvals and repair
        verification stay with authorized staff.
      </p>
    </div>
  );
}
