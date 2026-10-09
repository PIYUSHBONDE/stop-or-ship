'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Radio, Play, Pause, SkipForward, ShieldCheck, AlertTriangle, Save } from 'lucide-react';
import { usePlant } from '../session-provider';
import type { components } from '@/lib/api-schema';
import styles from './monitoring.module.css';

type View = components['schemas']['MonitoringView'];
type Binding = components['schemas']['SourceBinding'];

export function MonitoringWorkspace() {
  const { state } = usePlant();
  if (!state) return null;
  if (!state.workspace || !state.monitoring)
    return (
      <section className={styles.access}>
        <Radio size={32} />
        <h1>Whole-plant monitoring</h1>
        <p>
          Sign in to a shared plant to configure coordinated telemetry and automatic investigation.
        </p>
        <Link className="primary" href="/workspace">
          Sign in to your plant
        </Link>
      </section>
    );
  return (
    <MonitoringPanel
      key={state.monitoring.version + ':' + state.configuration_version}
      monitoring={state.monitoring}
    />
  );
}

function MonitoringPanel({ monitoring }: { monitoring: View }) {
  const { state, busy, can, saveMonitoring, controlMonitoring } = usePlant();
  const [draft, setDraft] = useState<Binding[]>(monitoring.sources);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  if (!state) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(monitoring.sources);
  const assets = new Map(state.assets.map((asset) => [asset.id, asset]));
  const health = new Map(monitoring.health.map((source) => [source.asset_id, source]));
  const visible = draft.filter((binding) => {
    const asset = assets.get(binding.asset_id)!;
    const source = health.get(binding.asset_id);
    return (
      `${asset.id} ${asset.name}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'issues' ? source?.quality !== 'fresh' : !!asset.diagnostic_profile))
    );
  });
  const update = (id: string, fields: Partial<Binding>) =>
    setDraft((items) =>
      items.map((item) => (item.asset_id === id ? { ...item, ...fields } : item)),
    );
  const save = (enabled: boolean) =>
    saveMonitoring({
      expected_version: monitoring.version,
      plant_configuration_version: monitoring.plant_configuration_version,
      enabled,
      sources: draft,
    });
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">TELEMETRY / AUTOMATIC INVESTIGATION</span>
          <h1>One plant. One clock.</h1>
          <p>
            Review each source, follow data quality, and investigate persistent faults across your
            configured plant.
          </p>
        </div>
        <Link className="secondary" href="/plant">
          Open plant
        </Link>
      </header>
      <div className={styles.metrics}>
        <section>
          <Radio size={21} />
          <span>Mapped equipment</span>
          <strong>{draft.length}</strong>
          <small>
            {state.configuration_version
              ? `Plant configuration v${state.configuration_version}`
              : 'Configured plant'}
          </small>
        </section>
        <section>
          <ShieldCheck size={21} />
          <span>Valid observations</span>
          <strong>{monitoring.health.filter((source) => source.quality === 'fresh').length}</strong>
          <small>Missing or inconsistent data never verifies a repair</small>
        </section>
        <section>
          <AlertTriangle size={21} />
          <span>Quality needs attention</span>
          <strong>{monitoring.quality_issue_count}</strong>
          <small>Includes sources that have not started</small>
        </section>
      </div>
      <section className={styles.clock} aria-label="Coordinated plant clock">
        <div>
          <span className="eyebrow">COORDINATED REPLAY</span>
          <h2>
            {!monitoring.enabled
              ? 'Monitoring disabled'
              : monitoring.running
                ? 'Plant clock running'
                : 'Plant clock paused'}
          </h2>
          <p>
            Tick <strong data-testid="plant-tick">{monitoring.tick}</strong> · 1 simulated minute
            per 5 seconds · mappings v{monitoring.version}
          </p>
          <small>
            {monitoring.observed_at
              ? `Replay observation: ${monitoring.observed_at}`
              : 'No aligned observation yet.'}
          </small>
        </div>
        <div className={styles.actions}>
          <button
            className="secondary"
            disabled={busy || dirty || !monitoring.enabled || !can('plant.manage')}
            onClick={() => controlMonitoring(monitoring.running ? 'pause' : 'play')}
          >
            {monitoring.running ? <Pause size={16} /> : <Play size={16} />}
            {monitoring.running ? 'Pause plant clock' : 'Run plant clock'}
          </button>
          <button
            className="secondary"
            disabled={busy || dirty || !monitoring.enabled || !can('plant.manage')}
            onClick={() => controlMonitoring('step')}
          >
            <SkipForward size={16} />
            Advance plant window
          </button>
        </div>
      </section>
      <div className={styles.notice}>
        <strong>
          {monitoring.output_basis ||
            'Configured production estimate; generated supporting signals'}
        </strong>
        <p>
          Diagnostic sources use prepared hydraulic and bearing datasets when available, with
          labelled synthetic fallbacks. Test-rig records can be reused across equipment. Replay
          ordering, faults, and sensor outages are configured examples. These observations are not
          live plant measurements.
        </p>
        <p>
          Three consecutive valid abnormal windows create one incident. The bounded investigator
          gathers evidence, and specialists compare the same backend cost table. Human approval
          remains required for maintenance.
        </p>
      </div>
      <section className={styles.sources} aria-label="Telemetry source mappings">
        <div className={styles.sourceHeader}>
          <div>
            <h2>Sources and condition</h2>
            <p>
              Admin changes are versioned and pause the clock. Resolve an incident before changing
              its fault replay.
            </p>
          </div>
          <div className={styles.filters}>
            <input
              aria-label="Find telemetry equipment"
              placeholder="Find equipment…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label="Filter telemetry sources"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All equipment</option>
              <option value="diagnostic">Diagnostic profiles</option>
              <option value="issues">Quality issues</option>
            </select>
          </div>
        </div>
        <div className={styles.sourceList}>
          {visible.map((binding) => {
            const asset = assets.get(binding.asset_id)!;
            const source = health.get(binding.asset_id)!;
            return (
              <article
                key={asset.id}
                className={styles.source}
                aria-label={`${asset.id} telemetry source`}
              >
                <div className={styles.identity}>
                  <strong>
                    {asset.id} · {asset.name}
                  </strong>
                  <span>
                    {asset.diagnostic_profile
                      ? `${asset.diagnostic_profile} diagnostics`
                      : 'Supporting context only'}
                  </span>
                  <small>{source.source_label}</small>
                  <small>
                    {source.observed_at
                      ? `Observed ${source.observed_at}`
                      : 'Awaiting first observation'}
                  </small>
                  {source.incident_id && (
                    <Link href={`/incidents?incident=${source.incident_id}`}>
                      Open incident evidence →
                    </Link>
                  )}
                </div>
                <div className={styles.condition}>
                  <span className={source.quality === 'fresh' ? styles.fresh : styles.unknown}>
                    {source.quality.replaceAll('_', ' ')}
                  </span>
                  <p>{source.reason}</p>
                  <small>
                    {source.signals
                      .slice(0, 2)
                      .map(
                        (signal) =>
                          `${signal.signal_id}: ${signal.value.toFixed(2)} ${signal.unit}`,
                      )
                      .join(' · ') || 'No values available'}
                  </small>
                </div>
                <div className={styles.mapping}>
                  <label htmlFor={`mode-${asset.id}`}>Replay condition</label>
                  <select
                    id={`mode-${asset.id}`}
                    aria-label={`${asset.id} replay condition`}
                    value={binding.mode}
                    disabled={busy || !can('plant.configure') || !asset.diagnostic_profile}
                    onChange={(event) =>
                      update(asset.id, { mode: event.target.value as Binding['mode'] })
                    }
                  >
                    <option value="healthy">Healthy operating windows</option>
                    {asset.diagnostic_profile && (
                      <option value="degradation">Degradation after 3 windows</option>
                    )}
                  </select>
                  <label htmlFor={`quality-${asset.id}`}>Data availability</label>
                  <select
                    id={`quality-${asset.id}`}
                    aria-label={`${asset.id} data availability`}
                    value={binding.quality_mode}
                    disabled={busy || !can('plant.configure')}
                    onChange={(event) =>
                      update(asset.id, {
                        quality_mode: event.target.value as Binding['quality_mode'],
                      })
                    }
                  >
                    <option value="fresh">Fresh observations</option>
                    <option value="missing">Missing observations</option>
                    <option value="stale">Stale observations</option>
                    <option value="conflicting">Conflicting sensor readings</option>
                  </select>
                </div>
              </article>
            );
          })}
          {!visible.length && <p className={styles.noSources}>No sources match this filter.</p>}
        </div>
        <footer className={styles.saveBar}>
          <div>
            <strong>
              {dirty
                ? 'Unapplied source changes'
                : `Mappings v${monitoring.version} · ${monitoring.enabled ? 'enabled' : 'disabled'}`}
            </strong>
            <p>
              {dirty
                ? 'Save or discard changes before advancing the clock.'
                : 'Invalid source data blocks new approval and repair start. Recovery requires three valid healthy windows.'}
            </p>
          </div>
          <div className={styles.actions}>
            {dirty && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setDraft(monitoring.sources)}
              >
                Discard changes
              </button>
            )}
            <button
              className="primary"
              disabled={busy || !can('plant.configure') || (!dirty && monitoring.enabled)}
              onClick={() => save(true)}
            >
              <Save size={16} />
              {monitoring.enabled ? 'Save source mappings' : 'Enable plant monitoring'}
            </button>
            {monitoring.enabled && (
              <button
                className="secondary"
                disabled={busy || dirty || !can('plant.configure')}
                onClick={() => save(false)}
              >
                Disable monitoring
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
