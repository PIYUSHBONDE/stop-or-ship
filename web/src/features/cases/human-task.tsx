'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import styles from './cases.module.css';
import { taskTitle } from './presentation';

type Schema = components['schemas'];
export function HumanTaskCard({
  task,
  onChanged,
  onNavigate,
  inCase = false,
  readOnly = false,
}: {
  task: Schema['HumanTask'];
  onChanged: (message?: string) => void;
  onNavigate?: () => void;
  inCase?: boolean;
  readOnly?: boolean;
}) {
  const { state, caseRequest } = usePlant();
  const [answer, setAnswer] = useState('');
  const [signal, setSignal] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [responding, setResponding] = useState(false);
  const eligible = state?.workspace && ['admin', task.target_role].includes(state.workspace.role);
  const mine = task.owner_id === state?.workspace?.user.id;
  const active = !readOnly && (task.state === 'open' || task.state === 'claimed');
  async function send(respond: boolean) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const values =
        signal || value || unit ? [{ signal_id: signal, value: Number(value), unit }] : [];
      if (
        respond &&
        values.length &&
        (!signal || !value || !unit || !Number.isFinite(Number(value)))
      )
        throw new Error(
          'Provide a signal, finite value and explicit unit, or leave all measurement fields empty.',
        );
      await caseRequest(`/tasks/${encodeURIComponent(task.id)}/${respond ? 'respond' : 'claim'}`, {
        expected_revision: task.revision,
        ...(respond ? { text: answer, values } : {}),
      });
      setAnswer('');
      setFeedback(
        respond
          ? 'Finding saved as evidence. The case will resume if automation is enabled; its status shows the next step.'
          : 'Task claimed. You can now record your finding.',
      );
      setResponding(!respond);
      onChanged(
        respond
          ? 'Finding saved. The case will resume if coordination is enabled; follow its status for the next step.'
          : 'Task claimed. Record your finding when ready.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed. Retry the same response.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className={styles.task}>
      <div className={styles.line}>
        <strong>{taskTitle(task.question)}</strong>
        <span className={styles.taskState}>
          {task.state === 'claimed'
            ? 'In progress'
            : task.state === 'open'
              ? 'Needs a finding'
              : task.state === 'completed'
                ? 'Finding recorded'
                : 'Closed'}
        </span>
      </div>
      <p>{task.reason}</p>
      <p className={styles.note}>
        {task.target_role} ·{' '}
        {task.owner_id
          ? mine
            ? 'Claimed by you'
            : `Owned by ${task.owner_name || 'another staff member'}`
          : 'Unclaimed'}
        {task.due_at
          ? ` · Due ${new Date(task.due_at).toLocaleString()}${Date.parse(task.due_at) < Date.now() && active ? ' · Overdue' : ''}`
          : ' · No deadline set'}
        {task.escalated ? ' · Escalated to manager' : ''}
      </p>
      {inCase && active && (
        <div className={styles.taskChecklist}>
          <strong>Include in your finding</strong>
          <p>{task.completion_requirements}</p>
        </div>
      )}
      <details className={styles.taskRequirements} open={responding || undefined}>
        <summary>Request and completion requirements</summary>
        {((inCase && active) || taskTitle(task.question) !== task.question) && (
          <p>{task.question}</p>
        )}
        {(!inCase || !active) && <p>{task.completion_requirements}</p>}
      </details>
      {!inCase && (
        <Link href={`/incidents?workcase=${encodeURIComponent(task.case_id)}`} onClick={onNavigate}>
          Open case
        </Link>
      )}
      {eligible && active && !task.owner_id && (
        <button className="secondary" disabled={saving} onClick={() => void send(false)}>
          {saving ? 'Claiming…' : 'Claim task'}
        </button>
      )}
      {eligible && active && mine && !responding && (
        <button className="primary" onClick={() => setResponding(true)}>
          Record finding
        </button>
      )}
      {eligible && active && mine && responding && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void send(true);
          }}
        >
          <label>
            Your finding
            <textarea
              aria-label="Your finding"
              required
              maxLength={3000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Record your finding or explain what is unavailable."
            />
          </label>
          <details>
            <summary>Add a reported measurement</summary>
            <div className={styles.fields}>
              <label>
                Signal
                <input maxLength={80} value={signal} onChange={(e) => setSignal(e.target.value)} />
              </label>
              <label>
                Value
                <input
                  type="number"
                  step="any"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <label>
                Unit
                <input maxLength={30} value={unit} onChange={(e) => setUnit(e.target.value)} />
              </label>
            </div>
          </details>
          <button className="primary" disabled={saving}>
            {saving ? 'Saving finding…' : 'Submit finding'}
          </button>
          <p className={styles.note}>
            Your response is saved with your name. Enabled AI coordination then reassesses the case;
            it does not verify sensor readings, approve work or verify a repair.
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {feedback && (
        <p role="status" className={styles.success}>
          {feedback}
        </p>
      )}
    </article>
  );
}
