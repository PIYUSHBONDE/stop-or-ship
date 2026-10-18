'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import { CaseIntake } from './case-intake';
import { CaseOverview } from './case-overview';
import { CaseAction, CaseDialog } from './case-dialog';
import { phaseNames } from './presentation';
import styles from './cases.module.css';

type Schema = components['schemas'];
type Detail = Schema['CaseDetail'];
export function CaseWorkspace() {
  const { state, caseRequest } = usePlant();
  const query = useSearchParams();
  const router = useRouter();
  const selected = query.get('workcase');
  const open = true;
  const [intake, setIntake] = useState(!!query.get('intake'));
  const [action, setAction] = useState<string | null>(null);
  const dialogState = useRef(action);
  dialogState.current = action;
  function openAction(name: string) {
    setError('');
    setAction(name);
  }
  const [page, setPage] = useState<Schema['CasePage'] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [policy, setPolicy] = useState<Schema['AutomationPolicy'] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    try {
      const next = await controller.current<Schema['CasePage']>(`/cases?cursor=${cursor}`);
      const rule = await controller.current<Schema['AutomationPolicy']>('/automation-policy');
      const record = identity
        ? await controller.current<Detail>(`/cases/${encodeURIComponent(identity)}`)
        : null;
      if (epoch.current !== version || currentSelection.current !== identity) return;
      setPage(next);
      setPolicy(rule);
      if (dialogState.current !== 'policy') setEnabled(rule.enabled);
      setDetail(record);
      if (!dialogState.current) setError('');
    } catch (cause) {
      if (epoch.current === version)
        setError(cause instanceof Error ? cause.message : 'Unable to load cases.');
    } finally {
      if (epoch.current === version) setLoading(false);
    }
  }
  useEffect(() => {
    setDetail(null);
    setAction(null);
    setQuestion('');
    setReason('');
    setRequirements('');
    setDue('');
    setCancelReason('');
    setLinkedIncident('');
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
      setAction(null);
      setFeedback('Action recorded. The case status below reflects the latest saved state.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed. Retry the same intent.');
    } finally {
      setSaving(false);
    }
  }
  const policyControls = policy && (
    <CaseAction
      title="Automation policy"
      label={`Automation policy · ${policy.enabled ? 'enabled' : 'disabled'}`}
      open={action === 'policy'}
      onOpen={() => openAction('policy')}
      onClose={() => setAction(null)}
      pending={saving}
      error={error}
    >
      <p className={styles.note}>
        Internal evidence requests and findings only. Intervention approval, physical work and
        verification retain their existing controls. Live AI requires matching evaluation reports;
        scripted runs are labeled.
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
    </CaseAction>
  );
  const active = detail?.case && !['resolved', 'cancelled'].includes(detail.case.phase);
  return (
    <section className={styles.board} aria-label="Factory cases" data-selected={!!selected}>
      {!selected && (
        <div className={styles.boardHeading}>
          <h2>Factory cases</h2>
          <p>Reported problems, evidence and the next action needed.</p>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.line}>
          {!selected && (
            <p className={styles.note}>
              Track an issue from report to accountable outcome. Tasks ask authorized staff for the
              findings needed to move it forward.
            </p>
          )}
          {!selected && state?.workspace?.role !== 'viewer' && (
            <button className="primary" onClick={() => setIntake(!intake)}>
              {intake ? 'Close issue form' : 'Report issue'}
            </button>
          )}
          {!selected && (
            <button className="secondary" onClick={() => void load()}>
              Refresh cases
            </button>
          )}
        </div>
        {intake && (
          <CaseDialog title="Report factory issue" onClose={() => setIntake(false)}>
            <CaseIntake
              onCreated={(item) => {
                setIntake(false);
                router.push(`/incidents?workcase=${encodeURIComponent(item.id)}`);
              }}
            />
          </CaseDialog>
        )}
        {error && !action && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!selected && policyControls}
        <details open={!selected} hidden={!!selected} className={styles.caseBrowser}>
          <summary>Browse cases {page ? `(${page.items.length})` : ''}</summary>
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
                    {item.next_action && (
                      <small>
                        Next: {item.next_action} · {item.next_owner}
                      </small>
                    )}
                  </span>
                  <span>{phaseNames[item.phase]}</span>
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
        </details>
        {loading && !detail && <p role="status">Loading case records…</p>}
        {feedback && !selected && (
          <p role="status" className={styles.success}>
            {feedback}
          </p>
        )}
        {detail && (
          <section className={styles.detail} aria-label="Factory case detail">
            <CaseOverview detail={detail} onChanged={() => void load()} onAction={openAction}>
              <section
                className={styles.controls}
                id="case-controls"
                aria-label="Case controls and human decisions"
              >
                <h3>Case actions</h3>
                <div className={styles.actionBar}>
                  {feedback && (
                    <p role="status" className={styles.success}>
                      {feedback}
                    </p>
                  )}
                  {policyControls}
                  {active &&
                    reviewer &&
                    !detail.case.incident_id &&
                    ['equipment', 'maintenance'].includes(detail.case.category) && (
                      <CaseAction
                        title="Link an observation-based incident"
                        open={action === 'link'}
                        onOpen={() => openAction('link')}
                        onClose={() => setAction(null)}
                        pending={saving}
                        error={error}
                      >
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
                                    (!detail.case.asset_id ||
                                      item.asset_id === detail.case.asset_id),
                                )
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.asset_id} · {item.id.slice(0, 8)} · {item.state}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <p className={styles.note}>
                            The report remains a staff statement. Linked repair and verification
                            stay in the incident workflow.
                          </p>
                          <button className="secondary" disabled={saving}>
                            Link incident
                          </button>
                        </form>
                      </CaseAction>
                    )}
                  {detail.case.incident_id && (
                    <Link
                      href={`/incidents?incident=${encodeURIComponent(detail.case.incident_id)}`}
                    >
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
                  {active && reviewer && (
                    <CaseAction
                      title="Request information"
                      open={action === 'information'}
                      onOpen={() => openAction('information')}
                      onClose={() => setAction(null)}
                      pending={saving}
                      error={error}
                    >
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
                    </CaseAction>
                  )}
                  {active &&
                    manager &&
                    !detail.case.incident_id &&
                    !['equipment', 'maintenance'].includes(detail.case.category) && (
                      <CaseAction
                        title="Record manager outcome"
                        open={action === 'outcome'}
                        onOpen={() => openAction('outcome')}
                        onClose={() => setAction(null)}
                        pending={saving}
                        error={error}
                      >
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
                            Select supporting evidence. This resolves the reported issue; it does
                            not verify an equipment repair.
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
                      </CaseAction>
                    )}
                  {detail.case.outcome && (
                    <p>
                      <strong>Recorded outcome:</strong> {detail.case.outcome}
                    </p>
                  )}
                  {active && reviewer && !detail.case.incident_id && (
                    <CaseAction
                      title="Cancel case"
                      open={action === 'cancel'}
                      onOpen={() => openAction('cancel')}
                      onClose={() => setAction(null)}
                      pending={saving}
                      error={error}
                    >
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
                    </CaseAction>
                  )}
                </div>
              </section>
            </CaseOverview>
          </section>
        )}
      </div>
    </section>
  );
}
