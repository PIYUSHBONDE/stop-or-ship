'use client';
import { useState } from 'react';
import { usePlant } from '../session-provider';
import type { components } from '@/lib/api-schema';
import styles from './monitoring.module.css';
type Source = components['schemas']['SourceView'];
type Configuration = components['schemas']['SourceConfiguration'];
type Rule = components['schemas']['SignalRule'];
export function SourceEditor({ source, onClose }: { source?: Source; onClose: () => void }) {
  const { state, saveSource, busy } = usePlant();
  const [name, setName] = useState(source?.configuration.name || '');
  const [asset, setAsset] = useState(source?.configuration.asset_id || state!.assets[0].id);
  const [kind, setKind] = useState<Configuration['kind']>(
    source?.configuration.kind || 'operational',
  );
  const [rules, setRules] = useState<Rule[]>(source?.configuration.rules || []);
  const [procedure, setProcedure] = useState(source?.configuration.procedure || '');
  const [dataset, setDataset] = useState(source?.configuration.dataset || '');
  const [attribution, setAttribution] = useState(source?.configuration.attribution || '');
  const [transformation, setTransformation] = useState(source?.configuration.transformation || '');
  const updateRule = (index: number, values: Partial<Rule>) =>
    setRules(rules.map((rule, i) => (i === index ? { ...rule, ...values } : rule)));
  return (
    <section className={styles.editor} aria-label="Source configuration">
      <h2>{source ? 'Review source revision' : 'Connect an observation source'}</h2>
      <p>
        Configuration is attributed to your staff account. Envelopes require plant-specific review;
        test-rig limits are never applied automatically.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const saved = await saveSource(
            {
              expected_version: source?.version || 0,
              plant_configuration_version: state!.configuration_version!,
              name,
              asset_id: asset,
              kind,
              rules,
              procedure,
              dataset,
              attribution,
              transformation,
            },
            source?.id,
          );
          if (saved) onClose();
        }}
      >
        <div className={styles.fields}>
          <label>
            Source name
            <input
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Equipment
            <select
              aria-label="Equipment"
              disabled={!!source}
              value={asset}
              onChange={(event) => setAsset(event.target.value)}
            >
              {state!.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Evidence origin
            <select
              aria-label="Evidence origin"
              disabled={!!source}
              value={kind}
              onChange={(event) => setKind(event.target.value as Configuration['kind'])}
            >
              <option value="operational">Operational observations</option>
              <option value="historical">Historical dataset import</option>
            </select>
          </label>
        </div>
        <h3>Required signals and operating envelopes</h3>
        <p>
          Every listed signal is required for a complete window. A reviewed lower or upper limit
          enables envelope-based detection.
        </p>
        {rules.map((rule, index) => (
          <div className={styles.rule} key={index}>
            <label>
              Signal ID
              <input
                required
                value={rule.signal_id}
                onChange={(event) => updateRule(index, { signal_id: event.target.value })}
              />
            </label>
            <label>
              Unit
              <input
                required
                value={rule.unit}
                onChange={(event) => updateRule(index, { unit: event.target.value })}
              />
            </label>
            <label>
              Lower limit
              <input
                type="number"
                step="any"
                value={rule.lower ?? ''}
                onChange={(event) =>
                  updateRule(index, {
                    lower: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Upper limit
              <input
                type="number"
                step="any"
                value={rule.upper ?? ''}
                onChange={(event) =>
                  updateRule(index, {
                    upper: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Require stop on breach
              <input
                type="checkbox"
                checked={rule.requires_stop || false}
                onChange={(event) => updateRule(index, { requires_stop: event.target.checked })}
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => setRules(rules.filter((_, i) => i !== index))}
            >
              Remove signal {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={rules.length >= 32}
          onClick={() =>
            setRules([
              ...rules,
              {
                signal_id: 'pressure',
                unit: 'bar',
                lower: null,
                upper: null,
                requires_stop: false,
              },
            ])
          }
        >
          Add required signal
        </button>
        <label>
          Reviewed maintenance procedure
          <textarea
            maxLength={3000}
            value={procedure}
            onChange={(event) => setProcedure(event.target.value)}
            placeholder="Procedure title, revision, isolation requirements and authorized steps"
          />
        </label>
        <p>
          A reviewed procedure is required before operational approval. Personnel perform physical
          isolation.
        </p>
        {kind === 'historical' && (
          <div className={styles.fields}>
            <label>
              Dataset identity
              <input
                required
                maxLength={200}
                value={dataset}
                onChange={(event) => setDataset(event.target.value)}
                placeholder="uci-hydraulics or ims-bearings"
              />
            </label>
            <label>
              Attribution
              <textarea
                required
                maxLength={1000}
                value={attribution}
                onChange={(event) => setAttribution(event.target.value)}
              />
            </label>
            <label>
              Transformation metadata
              <textarea
                maxLength={1000}
                value={transformation}
                onChange={(event) => setTransformation(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            Discard changes
          </button>
          <button className="primary" disabled={busy}>
            Save reviewed source
          </button>
        </div>
      </form>
    </section>
  );
}
