'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import { CaseIntake } from './case-intake';
import { HumanTaskCard } from './human-task';
import styles from './cases.module.css';

type Schema = components['schemas'];
type Detail = Schema['CaseDetail'];
export function CaseWorkspace() {
  const { state, caseRequest } = usePlant();
  const query = useSearchParams();
  const router = useRouter();
  const selected = query.get('workcase');
  const [open, setOpen] = useState(!!selected || !!query.get('intake'));
  const [intake, setIntake] = useState(!!query.get('intake'));
  const [page, setPage] = useState<Schema['CasePage'] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [policy, setPolicy] = useState<Schema['AutomationPolicy'] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState('');
  const [reason, setReason] = useState('');
  const [requirements, setRequirements] = useState('');
  const [role, setRole] = useState<'manager' | 'reliability' | 'technician'>('technician');
  const [due, setDue] = useState('');
  const [outcome, setOutcome] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [linkedIncident, setLinkedIncident] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const controller = useRef(caseRequest);
  controller.current = caseRequest;
  const epoch = useRef(0);
  function invalidateReads() {
    epoch.current++;
  }
  const currentSelection = useRef(selected);
  currentSelection.current = selected;
  const reviewer = ['admin', 'manager', 'reliability'].includes(state?.workspace?.role || '');
  const manager = ['admin', 'manager'].includes(state?.workspace?.role || '');
  async function load() {
    const version = ++epoch.current;
    const identity = currentSelection.current;
    try {
      const next = await controller.current<Schema['CasePage']>(`/cases?cursor=${cursor}`);
      const rule = await controller.current<Schema['AutomationPolicy']>('/automation-policy');
      const record = identity
        ? await controller.current<Detail>(`/cases/${encodeURIComponent(identity)}`)
        : null;
      if (epoch.current !== version || currentSelection.current !== identity) return;
      setPage(next);
      setPolicy(rule);
      setEnabled(rule.enabled);
      setDetail(record);
      setError('');
    } catch (cause) {
      if (epoch.current === version)
        setError(cause instanceof Error ? cause.message : 'Unable to load cases.');
    }
  }
  useEffect(() => {
    if (selected) setOpen(true);
    setDetail(null);
    setEvidenceIds([]);
    setOutcome('');
  }, [selected]);
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);
    return () => {
      invalidateReads();
      clearInterval(timer);
    };
    // Every read is serialized by the shared plant controller; identity changes remount the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, cursor]);
  async function mutate(path: string, body: unknown) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await caseRequest(path, body);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed. Retry the same intent.');
    } finally {
      setSaving(false);
    }
  }
  const active = detail?.case && !['resolved', 'cancelled'].includes(detail.case.phase);
  return (
    <details className={styles.board} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Factory cases and human requests</summary>
      <div className={styles.body}>
        <div className={styles.line}>
          <p className={styles.note}>
            Persistent staff reports and operational cases. Browser-generated incident records
            remain in the table below.
          </p>
          {state?.workspace?.role !== 'viewer' && (
            <button className="primary" onClick={() => setIntake(!intake)}>
              {intake ? 'Close issue form' : 'Report issue'}
            </button>
          )}
          <button className="secondary" onClick={() => void load()}>
            Refresh cases
          </button>
        </div>
        {intake && (
          <CaseIntake
            onCreated={(item) => {
              setIntake(false);
              router.push(`/incidents?workcase=${encodeURIComponent(item.id)}`);
            }}
          />
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {policy && (
          <details>
            <summary>Automation policy · {policy.enabled ? 'enabled' : 'disabled'}</summary>
            <p className={styles.note}>
              Internal evidence requests and findings only. Intervention approval, physical work and
              verification retain their existing controls. Live AI requires matching evaluation
              reports; scripted runs are labeled.
            </p>
            {state?.workspace?.role === 'admin' && (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate('/automation-policy', { expected_version: policy.version, enabled });
                }}
              >
                <label>
                  <span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />{' '}
                    Enable internal case coordination
                  </span>
                </label>
                <button className="secondary" disabled={saving}>
                  Save automation policy
                </button>
              </form>
            )}
          </details>
        )}
        <ul className={styles.list}>
          {page?.items.map((item) => (
            <li key={item.id}>
              <Link href={`/incidents?workcase=${encodeURIComponent(item.id)}`}>
                <span>
                  {item.title}
                  <small>
                    {item.asset_id || 'Plant-wide'} · {item.category} ·{' '}
                    {new Date(item.updated_at).toLocaleString()}
                  </small>
                </span>
                <span>{item.phase.replaceAll('_', ' ')}</span>
              </Link>
            </li>
          ))}
        </ul>
        {page && !page.items.length && (
          <p className={styles.note}>
            No factory cases yet. Report an issue or connect reviewed observations.
          </p>
        )}
        <div className={styles.line}>
          <button
            className="secondary"
            disabled={!cursor}
            onClick={() => setCursor(Math.max(0, cursor - 25))}
          >
            Previous cases
          </button>
          <button
            className="secondary"
            disabled={page?.next_cursor == null}
            onClick={() => setCursor(page!.next_cursor!)}
          >
            Next cases
          </button>
        </div>
        {detail && (
          <section className={styles.detail} aria-label="Factory case detail">
            <div className={styles.line}>
              <h2>{detail.case.title}</h2>
              <span>
                {detail.case.phase.replaceAll('_', ' ')} · Revision {detail.case.revision}
              </span>
            </div>
            <p>{detail.case.description}</p>
            <p className={styles.note}>
              {detail.case.origin.replaceAll('_', ' ')} · Analysis revision{' '}
              {detail.case.analysis_version}
            </p>
            {active &&
              reviewer &&
              !detail.case.incident_id &&
              ['equipment', 'maintenance'].includes(detail.case.category) && (
                <details>
                  <summary>Link an observation-based incident</summary>
                  <form
                    className={styles.form}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutate(`/cases/${detail.case.id}/link-incident`, {
                        expected_revision: detail.case.revision,
                        incident_id: linkedIncident,
                      });
                    }}
                  >
                    <label>
                      Matching incident
                      <select
                        aria-label="Matching incident"
                        required
                        value={linkedIncident}
                        onChange={(e) => setLinkedIncident(e.target.value)}
                      >
                        <option value="">Select an incident</option>
                        {state?.incidents
                          .filter(
                            (item) =>
                              item.record_origin === 'plant_observation' &&
                              (!detail.case.asset_id || item.asset_id === detail.case.asset_id),
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.asset_id} · {item.id.slice(0, 8)} · {item.state}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className={styles.note}>
                      The report remains a staff statement. Linked repair and verification stay in
                      the incident workflow.
                    </p>
                    <button className="secondary" disabled={saving}>
                      Link incident
                    </button>
                  </form>
                </details>
              )}
            {detail.case.incident_id && (
              <Link href={`/incidents?incident=${encodeURIComponent(detail.case.incident_id)}`}>
                Open linked incident and intervention controls
              </Link>
            )}
            {active && reviewer && (
              <button
                className="secondary"
                disabled={
                  saving ||
                  !policy?.enabled ||
                  !['equipment', 'production'].includes(detail.case.category)
                }
                onClick={() =>
                  void mutate(`/cases/${detail.case.id}/analysis`, {
                    expected_revision: detail.case.revision,
                  })
                }
              >
                Request analysis / retry
              </button>
            )}
            <div>
              <h3>Human requests</h3>
              {!detail.tasks.length && (
                <p className={styles.note}>No information requests recorded.</p>
              )}
              {detail.tasks.map((task) => (
                <HumanTaskCard key={task.id} task={task} onChanged={() => void load()} />
              ))}
            </div>
            {active && reviewer && (
              <details>
                <summary>Request information</summary>
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(`/cases/${detail.case.id}/tasks`, {
                      expected_revision: detail.case.revision,
                      question,
                      reason,
                      completion_requirements: requirements,
                      target_role: role,
                      due_at: due ? new Date(due).toISOString() : null,
                    });
                  }}
                >
                  <label>
                    Question
                    <textarea
                      aria-label="Question"
                      required
                      maxLength={3000}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                  </label>
                  <label>
                    Why this is needed
                    <input
                      required
                      maxLength={3000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <label>
                    Completion requirements
                    <input
                      required
                      maxLength={3000}
                      value={requirements}
                      onChange={(e) => setRequirements(e.target.value)}
                    />
                  </label>
                  <div className={styles.fields}>
                    <label>
                      Responsible role
                      <select
                        aria-label="Responsible role"
                        value={role}
                        onChange={(e) => setRole(e.target.value as typeof role)}
                      >
                        <option value="technician">Technician</option>
                        <option value="reliability">Reliability</option>
                        <option value="manager">Manager</option>
                      </select>
                    </label>
                    <label>
                      Due date (optional)
                      <input
                        type="datetime-local"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                      />
                    </label>
                  </div>
                  <button className="primary" disabled={saving}>
                    Create information request
                  </button>
                </form>
              </details>
            )}
            <details>
              <summary>Evidence · {detail.evidence.length} recent submissions</summary>
              {detail.evidence.map((item) => (
                <article className={styles.task} key={item.id}>
                  <strong>{item.origin.replaceAll('_', ' ')}</strong>
                  <p>{item.text}</p>
                  <small>
                    {new Date(item.created_at).toLocaleString()} · Author{' '}
                    {item.actor_id || 'System'}
                  </small>
                  {(item.values ?? []).map((value, index) => (
                    <p key={index}>
                      {value.signal_id}: {value.value} {value.unit} · Staff-reported
                    </p>
                  ))}
                </article>
              ))}
            </details>
            <div>
              <h3>Analysis history</h3>
              <p className={styles.note}>
                Advisory outputs with recorded sources. Review evidence limitations before making a
                decision.
              </p>
              {!detail.runs.length && (
                <p className={styles.note}>
                  No analysis runs. Manual work remains available with automation disabled.
                </p>
              )}
              {detail.runs.map((run) => (
                <details key={run.id}>
                  <summary>
                    Revision {run.analysis_version} · {run.provider} ·{' '}
                    {run.state.replaceAll('_', ' ')}
                  </summary>
                  {run.error && (
                    <p className={styles.note}>
                      Analysis could not complete ({run.error}). Retained evidence and manual
                      requests remain available.
                    </p>
                  )}
                  {!run.steps.length && (
                    <p className={styles.note}>
                      No stage output recorded. A worker and passing provider gates are required.
                    </p>
                  )}
                  {run.steps.map((step) => (
                    <article className={styles.task} key={step.stage}>
                      <strong>
                        {step.stage.replaceAll('_', ' ')} · {step.state}
                      </strong>
                      {step.summary && <p>{step.summary}</p>}
                      {!!step.unsupported_claims?.length && (
                        <p className={styles.error}>
                          Reviewer cautions: {step.unsupported_claims.join('; ')}
                        </p>
                      )}
                      {!!step.hypotheses?.length && (
                        <ul>
                          {step.hypotheses.map((item, index) => (
                            <li key={index}>
                              {item.cause} · {item.confidence} confidence · Supporting:{' '}
                              {item.supporting_evidence.join(', ')}
                              {item.conflicting_evidence?.length
                                ? ` · Conflicting: ${item.conflicting_evidence.join(', ')}`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {!!step.citations?.length && (
                        <small>Sources: {step.citations.join(', ')}</small>
                      )}
                    </article>
                  ))}
                </details>
              ))}
            </div>
            {active &&
              manager &&
              !detail.case.incident_id &&
              !['equipment', 'maintenance'].includes(detail.case.category) && (
                <details>
                  <summary>Record manager outcome</summary>
                  <form
                    className={styles.form}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutate(`/cases/${detail.case.id}/resolve`, {
                        expected_revision: detail.case.revision,
                        outcome,
                        evidence_ids: evidenceIds,
                      });
                    }}
                  >
                    <label>
                      Outcome
                      <textarea
                        aria-label="Outcome"
                        required
                        maxLength={3000}
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                      />
                    </label>
                    <p className={styles.note}>
                      Select supporting evidence. This resolves the reported issue; it does not
                      verify an equipment repair.
                    </p>
                    {detail.evidence.map((item) => (
                      <label key={item.id}>
                        <span>
                          <input
                            type="checkbox"
                            checked={evidenceIds.includes(item.id)}
                            onChange={(e) =>
                              setEvidenceIds((old) =>
                                e.target.checked
                                  ? [...old, item.id]
                                  : old.filter((id) => id !== item.id),
                              )
                            }
                          />{' '}
                          {item.origin.replaceAll('_', ' ')} · {item.text.slice(0, 90)}
                        </span>
                      </label>
                    ))}
                    <button className="primary" disabled={saving || !evidenceIds.length}>
                      Resolve reported issue
                    </button>
                  </form>
                </details>
              )}
            {detail.case.outcome && (
              <p>
                <strong>Recorded outcome:</strong> {detail.case.outcome}
              </p>
            )}
            {active && reviewer && !detail.case.incident_id && (
              <details>
                <summary>Cancel case</summary>
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(`/cases/${detail.case.id}/cancel`, {
                      expected_revision: detail.case.revision,
                      reason: cancelReason,
                    });
                  }}
                >
                  <label>
                    Cancellation reason
                    <input
                      required
                      maxLength={3000}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                  </label>
                  <button className="secondary" disabled={saving}>
                    Cancel reported case
                  </button>
                </form>
              </details>
            )}
            <details>
              <summary>Recorded activity</summary>
              <div className={styles.events}>
                {detail.events.map((item) => (
                  <p key={item.sequence}>
                    {new Date(item.at).toLocaleString()} · {item.message}
                  </p>
                ))}
              </div>
            </details>
          </section>
        )}
      </div>
    </details>
  );
}
