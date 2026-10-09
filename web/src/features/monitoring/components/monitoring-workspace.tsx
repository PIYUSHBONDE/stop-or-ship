'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Radio, Plus, ArrowRight, ShieldCheck, Search } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import styles from '@/components/layout/workspace.module.css';
import { SourceEditor } from '@/features/monitoring/components/source-editor';
import { ImportPanel } from '@/features/monitoring/components/import-panel';

type Source = components['schemas']['SourceView'];

export function MonitoringWorkspace() {
  const { state, can, busy } = usePlant();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Source | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  if (!state) return null;
  const sources = state.sources || [];
  const operational = sources.filter((source) => source.configuration.kind === 'operational');
  const current = operational.filter((source) => source.quality === 'fresh');
  const importSource = sources.find((source) => source.id === selected);
  const filtered = sources.filter((source) =>
    `${source.configuration.name} ${source.configuration.asset_id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">PLANT DATA</span>
          <h1>Telemetry sources</h1>
          <p>
            Know where readings came from, whether they are current, and what they can establish.
          </p>
        </div>
        {can('plant.configure') && (
          <button className="primary" disabled={busy} onClick={() => setEditor('new')}>
            <Plus size={16} /> Add source
          </button>
        )}
      </header>
      <div className={styles.metrics}>
        <div>
          <small>Operational sources</small>
          <strong>{operational.length}</strong>
        </div>
        <div>
          <small>Current observations</small>
          <strong>{current.length}</strong>
        </div>
        <div>
          <small>Equipment without current data</small>
          <strong>{state.assets.length - current.length}</strong>
        </div>
      </div>
      <section className={styles.notice}>
        <Radio size={19} />
        <p>
          Sources accept submitted observations and historical files. No PLC or historian connector
          is active. Missing data means unknown condition; plant configuration does not supply
          measurements.
        </p>
      </section>
      {editor && (
        <SourceEditor
          key={editor === 'new' ? 'new' : `${editor.id}-${editor.version}`}
          source={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      <label className={styles.search}>
        <Search size={17} />
        <input
          aria-label="Search telemetry sources"
          placeholder="Find a source or equipment…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.sourceList}>
        {filtered.map((source) => (
          <article
            className={styles.source}
            key={source.id}
            aria-label={`${source.configuration.asset_id} telemetry source`}
          >
            <div>
              <span className="eyebrow">
                {source.configuration.asset_id} · REVISION {source.version}
              </span>
              <h2>{source.configuration.name}</h2>
              <p>
                {source.configuration.kind === 'historical'
                  ? 'Historical dataset'
                  : 'Operational observations'}{' '}
                · {source.quality.replaceAll('_', ' ')}
              </p>
              <p>{source.reason}</p>
            </div>
            <dl className={styles.metadata}>
              <dt>Observed</dt>
              <dd>{source.observed_at || 'Acquisition time unavailable'}</dd>
              <dt>Received</dt>
              <dd>{source.received_at || 'No data received'}</dd>
              <dt>Diagnostics</dt>
              <dd>
                {source.diagnostic_ready
                  ? 'Reviewed analysis available'
                  : 'Diagnostics not configured / model features unavailable'}
              </dd>
              <dt>Reviewed by</dt>
              <dd>
                {source.reviewed_by} · {source.reviewed_at}
              </dd>
              {source.configuration.dataset && (
                <>
                  <dt>Dataset</dt>
                  <dd>{source.configuration.dataset}</dd>
                  <dt>Attribution</dt>
                  <dd>{source.configuration.attribution}</dd>
                  <dt>Transformation</dt>
                  <dd>{source.configuration.transformation || 'Not supplied'}</dd>
                </>
              )}
            </dl>
            <div className={styles.values}>
              {(source.signals || []).map((signal) => (
                <span key={signal.signal_id}>
                  <strong>
                    {signal.value.toLocaleString('en-IN', { maximumFractionDigits: 4 })}{' '}
                    {signal.unit}
                  </strong>
                  <small>
                    {signal.signal_id} · record {signal.source_record_id}
                  </small>
                </span>
              ))}
            </div>
            <div className={styles.actions}>
              {can('plant.configure') && (
                <button className="secondary" disabled={busy} onClick={() => setEditor(source)}>
                  Review configuration
                </button>
              )}
              {can('plant.manage') && (
                <button className="secondary" onClick={() => setSelected(source.id)}>
                  Import observations
                </button>
              )}
              {source.incident_id && (
                <Link className="primary" href={`/incidents?incident=${source.incident_id}`}>
                  Inspect incident <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </article>
        ))}
        {!filtered.length && (
          <section className={styles.empty}>
            <ShieldCheck size={30} />
            <h2>{sources.length ? 'No matching sources' : 'No data connected'}</h2>
            <p>
              Configure a source to receive observations. Equipment remains unknown until usable
              evidence is available.
            </p>
          </section>
        )}
      </div>
      {importSource && <ImportPanel key={importSource.id} source={importSource} />}
    </div>
  );
}
