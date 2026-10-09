'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Factory, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import { usePlant } from '../session-provider';
import type { components } from '@/lib/api-schema';
import styles from './plant-setup.module.css';

type Configuration = components['schemas']['PlantConfiguration'];
type View = components['schemas']['ConfigurationView'];

export function PlantSetup() {
  const {
    state,
    busy,
    can,
    configuration,
    configurationTemplate,
    saveConfiguration,
    validateConfiguration,
  } = usePlant();
  const [saved, setSaved] = useState<View | null>(null);
  const [draft, setDraft] = useState<Configuration | null>(null);
  const [lines, setLines] = useState(8);
  const [message, setMessage] = useState('');
  const [json, setJson] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState('');
  if (!state) return null;
  const editable = !!state.workspace && can('plant.configure');
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved.configuration);
  const stale = !!saved && saved.version !== state.configuration_version;
  const open = state.active_source_count;
  const count = draft?.assets.length || state.assets.length;
  const production = (draft?.areas || state.areas).filter(
    (area) => area.nominal_units_per_hour > 0,
  );
  const diagnosis = (draft?.assets || state.assets).filter((asset) => asset.diagnostic_profile);

  function update(next: Configuration) {
    setDraft(next);
    setJson(null);
    setJsonError('');
    setMessage('');
  }

  async function load() {
    const view = await configuration();
    if (view) {
      setSaved(view);
      update(view.configuration);
      setMessage(`Configuration v${view.version} loaded.`);
    }
  }

  function exportDraft() {
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'plantsense-plant-configuration.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.workspace} aria-label="Plant configuration">
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">
            PLANT FOUNDATION · VERSION {state.configuration_version || 'DEMO'}
          </span>
          <h1>Design your plant.</h1>
          <p>Define the equipment, rated output, and dependencies that investigations use.</p>
        </div>
        <Link className="secondary" href="/plant">
          <Factory size={16} /> Open factory
        </Link>
      </header>
      <div className={styles.metrics}>
        <div>
          <strong>{count}</strong>
          <span>configured assets</span>
        </div>
        <div>
          <strong>{production.length}</strong>
          <span>production lines</span>
        </div>
        <div>
          <strong>
            {production.reduce((total, area) => total + area.nominal_units_per_hour, 0)}
          </strong>
          <span>nominal parts / hour</span>
        </div>
        <div>
          <strong>{diagnosis.length}</strong>
          <span>assets with diagnostic profiles</span>
        </div>
      </div>
      <div className={styles.explanation}>
        <div>
          <GitBranch size={20} />
          <h2>One shared plant model</h2>
          <p>
            The 3D factory, downstream impact, and decision calculations use the same configuration.
            Shared utilities can supply every line.
          </p>
        </div>
        <div>
          <Sparkles size={20} />
          <h2>AI with equipment context</h2>
          <p>
            Pump, cooling, valve, and bearing investigations use mapped telemetry, dependency
            evidence, procedures, and verified repairs. Reliability and Production assess the same
            calculated options.
          </p>
          <p>
            Equipment without a diagnostic profile has context telemetry only. Investigator labels
            show whether Gemini is connected.
          </p>
        </div>
        <div>
          <ShieldCheck size={20} />
          <h2>Reviewed configuration changes</h2>
          <p>
            Only plant administrators can apply changes. Open sources and incidents block
            activation. Each incident keeps its original configuration and human approval.
          </p>
        </div>
      </div>
      {!state.workspace ? (
        <p className={styles.notice}>
          Sign in to a shared plant to configure equipment.{' '}
          <Link href="/workspace">Open staff access</Link>
        </p>
      ) : (
        <div className={styles.actions}>
          <button className="secondary" disabled={busy} onClick={load}>
            {saved ? 'Reload saved configuration' : 'Load plant configuration'}
          </button>
          {!editable && <span>Read-only access · plant administrator required to edit.</span>}
          {!!open && (
            <span>
              {open} open source{open === 1 ? '' : 's'} or incident{open === 1 ? '' : 's'} · resolve
              before applying configuration.
            </span>
          )}
        </div>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {stale && (
        <p role="alert" className={styles.notice}>
          The saved plant changed while you were editing. Reload it before applying a draft.
        </p>
      )}
      {draft && saved && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Plant and production</h2>
              <span>{dirty ? 'Unapplied draft' : `Saved v${saved.version}`}</span>
            </div>
            <div className={styles.fields}>
              <label>
                Plant name
                <input
                  value={draft.name}
                  maxLength={80}
                  disabled={!editable || busy}
                  onChange={(event) => update({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                Hydraulic template
                <select
                  value={lines}
                  disabled={!editable || busy}
                  onChange={(event) => setLines(Number(event.target.value))}
                >
                  {[2, 4, 6, 8].map((value) => (
                    <option key={value} value={value}>
                      {value} lines · {value * 4 + 4} assets
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.actions}>
              <button
                className="secondary"
                disabled={!editable || busy}
                onClick={async () => {
                  const template = await configurationTemplate(lines, draft.name);
                  if (template) {
                    update(template);
                    setMessage(
                      'Template is a draft. Review equipment and dependencies before applying.',
                    );
                  }
                }}
              >
                Preview template
              </button>
              <button className="secondary" onClick={exportDraft}>
                Export draft JSON
              </button>
            </div>
            <p className="muted">
              Templates reuse the canonical equipment IDs. Existing cases keep their original
              topology. Additional lines reuse test-rig replay records; they are not independent
              measured datasets.
            </p>
            <div className={styles.areaGrid}>
              {draft.areas.map((area, index) => (
                <label key={area.id}>
                  {area.name}
                  <span>
                    {area.id} ·{' '}
                    {area.nominal_units_per_hour
                      ? 'Production capacity'
                      : 'Shared / non-production area'}
                  </span>
                  <input
                    aria-label={`${area.name} nominal parts per hour`}
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    value={area.nominal_units_per_hour}
                    disabled={!editable || busy}
                    onChange={(event) =>
                      update({
                        ...draft,
                        areas: draft.areas.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, nominal_units_per_hour: Number(event.target.value) }
                            : item,
                        ),
                      })
                    }
                  />
                  <small>parts / hour</small>
                </label>
              ))}
            </div>
          </section>
          <section className={styles.panel}>
            <h2>Equipment registry</h2>
            <p className="muted">
              Names and placement can change. Canonical IDs used by historical workflows retain
              their equipment type.
            </p>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Asset ID</th>
                    <th scope="col">Equipment name</th>
                    <th scope="col">Area</th>
                    <th scope="col">Diagnosis</th>
                    <th scope="col">Position X / Z (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.assets.map((asset, index) => (
                    <tr key={asset.id}>
                      <th scope="row">
                        {asset.id}
                        <small>{asset.type}</small>
                      </th>
                      <td>
                        <input
                          aria-label={`${asset.id} name`}
                          maxLength={80}
                          value={asset.name}
                          disabled={!editable || busy}
                          onChange={(event) =>
                            update({
                              ...draft,
                              assets: draft.assets.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, name: event.target.value } : item,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        {draft.areas.find((area) => area.id === asset.area_id)?.name ||
                          asset.area_id}
                      </td>
                      <td>{asset.diagnostic_profile || 'Context only'}</td>
                      <td>
                        <div className={styles.coordinates}>
                          {[0, 2].map((coordinate) => (
                            <input
                              key={coordinate}
                              aria-label={`${asset.id} ${coordinate === 0 ? 'X' : 'Z'} position`}
                              type="number"
                              min={-150}
                              max={150}
                              step={0.5}
                              value={asset.position[coordinate]}
                              disabled={!editable || busy}
                              onChange={(event) =>
                                update({
                                  ...draft,
                                  assets: draft.assets.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          position: item.position.map((value, axis) =>
                                            axis === coordinate
                                              ? Number(event.target.value)
                                              : value,
                                          ),
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className={styles.panel}>
            <h2>Dependency topology</h2>
            <p className="muted">
              {draft.dependencies.length} directed relationships. Production is limited by the most
              restrictive active incident on each line; losses on a shared branch are counted once.
            </p>
            <ul className={styles.dependencies}>
              {draft.dependencies.map((edge) => (
                <li key={`${edge.source}-${edge.target}`}>
                  <strong>{edge.source}</strong>
                  <span>{edge.relationship}</span>
                  <strong>{edge.target}</strong>
                </li>
              ))}
            </ul>
            <details>
              <summary>Advanced configuration JSON</summary>
              <p>
                Use this to edit areas, equipment types, diagnostic bindings, and relationships. The
                server checks references, supported types, bounds, and cycles before activation.
              </p>
              <textarea
                aria-label="Advanced plant configuration JSON"
                spellCheck={false}
                disabled={!editable || busy}
                value={json ?? JSON.stringify(draft, null, 2)}
                onChange={(event) => {
                  setJson(event.target.value);
                  setJsonError('');
                }}
              />
              <button
                className="secondary"
                disabled={!editable || busy || json === null}
                onClick={async () => {
                  try {
                    const parsed = JSON.parse(json!);
                    const validated = await validateConfiguration(parsed);
                    if (validated) update(validated);
                  } catch (error) {
                    setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
                  }
                }}
              >
                Use JSON draft
              </button>
              {jsonError && <p role="alert">{jsonError}</p>}
            </details>
          </section>
          <footer className={styles.saveBar}>
            <div>
              <strong>
                {dirty
                  ? 'Review this draft before applying.'
                  : 'Configuration matches the saved plant.'}
              </strong>
              <p>
                Rated output and operating consequences are configured assumptions. The AI cannot
                activate changes.
              </p>
            </div>
            <div className={styles.actions}>
              <button
                className="secondary"
                disabled={busy || (!dirty && json === null)}
                onClick={() => update(saved.configuration)}
              >
                Discard draft
              </button>
              <button
                className="primary"
                disabled={!editable || busy || !dirty || stale || !!open || json !== null}
                onClick={async () => {
                  const view = await saveConfiguration({
                    expected_version: saved.version,
                    configuration: draft,
                  });
                  if (view) {
                    setSaved(view);
                    update(view.configuration);
                    setMessage(
                      `Configuration v${view.version} applied. The factory now uses ${view.configuration.assets.length} assets.`,
                    );
                  }
                }}
              >
                Apply configuration
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
