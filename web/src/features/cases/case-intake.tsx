'use client';

import { useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import styles from './cases.module.css';

type Schema = components['schemas'];

export function CaseIntake({
  assetId,
  description = '',
  onCreated,
}: {
  assetId?: string | null;
  description?: string;
  onCreated: (item: Schema['CaseView']) => void;
}) {
  const { state, caseRequest } = usePlant();
  const [title, setTitle] = useState('');
  const [text, setText] = useState(description);
  const [category, setCategory] = useState<Schema['CaseCreate']['category']>('production');
  const [asset, setAsset] = useState(assetId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className={styles.form}
      aria-label="Report factory issue"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        try {
          onCreated(
            await caseRequest<Schema['CaseView']>('/cases', {
              title,
              description: text,
              category,
              asset_id: asset || null,
            }),
          );
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : 'Unable to record issue. Retry your report.',
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        Issue title
        <input
          required
          minLength={2}
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className={styles.fields}>
        <label>
          Category
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {[
              'production',
              'equipment',
              'maintenance',
              'quality',
              'staffing',
              'materials',
              'general',
            ].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Equipment
          <select aria-label="Equipment" value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="">Plant-wide</option>
            {state?.assets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        What happened?
        <textarea
          aria-label="What happened?"
          required
          maxLength={3000}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className={styles.note}>
        This records a staff report, separate from verified measurements. Other categories currently
        support human triage.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button className="primary" disabled={saving}>
        {saving ? 'Recording…' : 'Create case'}
      </button>
    </form>
  );
}
