'use client';
import { useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import styles from '@/components/layout/workspace.module.css';
type Source = components['schemas']['SourceView'];
import { FileUp } from 'lucide-react';
export function ImportPanel({ source }: { source: Source }) {
  const { previewImport, commitImport, busy, can } = usePlant();
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<components['schemas']['ImportPreview'] | null>(null);
  const [key, setKey] = useState('');
  const [success, setSuccess] = useState('');
  const change = (value: string) => {
    setCsv(value);
    setPreview(null);
    setSuccess('');
    setKey('');
  };
  const validPreview = preview && preview.source_version === source.version;
  return (
    <section className={styles.editor} aria-label="Telemetry import">
      <h2>
        <FileUp size={20} /> Review observations before accepting
      </h2>
      <p>
        {source.configuration.kind === 'historical'
          ? 'Historical records remain separate from current plant condition and operational authorizations.'
          : 'Submit complete 60-second windows no older than 180 seconds. File submission does not establish a live connection.'}
      </p>
      <a href="/telemetry-template.csv" download>
        Download the CSV template
      </a>
      <label>
        Telemetry CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy || !can('plant.manage')}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 50000) {
              setError('Split this file into batches smaller than 50,000 bytes and ten windows.');
              change('');
              return;
            }
            setError('');
            change(await file.text());
          }}
        />
      </label>
      <label>
        CSV contents
        <textarea
          className={styles.csv}
          value={csv}
          disabled={busy || !can('plant.manage')}
          onChange={(event) => change(event.target.value)}
          maxLength={50000}
          spellCheck={false}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        className="secondary"
        disabled={busy || !csv || !can('plant.manage')}
        onClick={async () => {
          const result = await previewImport(source.id, { expected_version: source.version, csv });
          if (result) {
            setPreview(result);
            setKey(crypto.randomUUID());
            setSuccess('');
          }
        }}
      >
        Validate and preview
      </button>
      {validPreview && (
        <div className={styles.preview}>
          <h3>
            {preview.window_count} windows · {preview.signal_count} values · revision{' '}
            {preview.source_version}
          </h3>
          <p>
            {preview.missing_timestamp_count} windows without acquisition timestamps. Missing
            timestamps are retained.
          </p>
          {preview.windows.map((window) => (
            <div className={styles.previewRow} key={window.record_id}>
              <strong>{window.record_id}</strong>
              <span>{window.observed_at || 'Acquisition time unavailable'}</span>
              <span>
                {window.values
                  .map((value) => `${value.signal_id}: ${value.value} ${value.unit}`)
                  .join(' · ')}
              </span>
            </div>
          ))}
          <button
            className="primary"
            disabled={busy || !!success}
            onClick={async () => {
              const result = await commitImport(
                source.id,
                { expected_version: source.version, csv, preview_checksum: preview.checksum },
                key,
              );
              if (result)
                setSuccess(
                  `${result.accepted} windows accepted; ${result.duplicates} duplicate records skipped.`,
                );
            }}
          >
            Confirm import
          </button>
        </div>
      )}
      {preview && !validPreview && <p>Source revision changed. Validate and preview again.</p>}
      {success && <p role="status">{success}</p>}
    </section>
  );
}
