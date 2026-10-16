'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import styles from './cases.module.css';

type Schema = components['schemas'];
export function HumanTaskCard({
  task,
  onChanged,
  onNavigate,
}: {
  task: Schema['HumanTask'];
  onChanged: () => void;
  onNavigate?: () => void;
}) {
  const { state, caseRequest } = usePlant();
  const [answer, setAnswer] = useState('');
  const [signal, setSignal] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const eligible = state?.workspace && ['admin', task.target_role].includes(state.workspace.role);
  const mine = task.owner_id === state?.workspace?.user.id;
  const active = task.state === 'open' || task.state === 'claimed';
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
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed. Retry the same response.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className={styles.task}>
      <div className={styles.line}>
        <strong>{task.question}</strong>
        <span>{task.state}</span>
      </div>
      <p>{task.reason}</p>
      <p className={styles.note}>
        {task.target_role} ·{' '}
        {task.owner_id
          ? mine
            ? 'Claimed by you'
            : 'Claimed by another staff member'
          : 'Unclaimed'}
        {task.due_at ? ` · Due ${new Date(task.due_at).toLocaleString()}` : ''}
        {task.escalated ? ' · Escalated to manager' : ''}
      </p>
      <details>
        <summary>Completion requirements</summary>
        <p>{task.completion_requirements}</p>
      </details>
      <Link href={`/incidents?workcase=${encodeURIComponent(task.case_id)}`} onClick={onNavigate}>
        Open case
      </Link>
      {eligible && active && !task.owner_id && (
        <button className="secondary" disabled={saving} onClick={() => void send(false)}>
          Claim request
        </button>
      )}
      {eligible && active && mine && (
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
          <p className={styles.note}>
            A staff statement does not enter sensor observations or verify a physical repair.
          </p>
          <button className="primary" disabled={saving}>
            Submit finding
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </article>
  );
}
