'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { PHASE_COPY } from '@/features/operators/lib/preview-dispatch';
import previewStyles from '@/features/plant/components/plant-preview.module.css';
import {
  ArrowRight,
  ChevronRight,
  Focus,
  Layers,
  Search,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { money } from '@/lib/api/client';
import Sparkline from '@/components/ui/sparkline';
import EvidenceDialog from '@/features/incidents/components/evidence-dialog';

const PlantScene = dynamic(() => import('@/features/plant/components/plant-scene'), {
  ssr: false,
  loading: () => <div className="scene-loading">Preparing your factory view…</div>,
});

export function ObservationWorkspace() {
  const { state, selected, selectAsset } = usePlant();
  const [planView, setPlanView] = useState(false);
  const [quality, setQuality] = useState<'auto' | 'detail' | 'balanced'>('auto');
  const [automaticQuality, setAutomaticQuality] = useState<'detail' | 'balanced'>('detail');
  const usePerformanceMode = useCallback(() => setAutomaticQuality('balanced'), []);
  const [assumptions, setAssumptions] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [preset, setPreset] = useState('overview');
  const [inspector, setInspector] = useState(true);
  const [query, setQuery] = useState('');
  const [overlay, setOverlay] = useState<'health' | 'impact'>('health');
  const preview = {
    ...usePreviewDispatch(),
    readings: {} as ReturnType<typeof usePreviewDispatch>['readings'],
    oocIds: [] as string[],
    assignments: [] as ReturnType<typeof usePreviewDispatch>['assignments'],
    actors: [],
    focusId: null,
    scannedId: null,
  };
  if (!state) return null;
  const asset = state.assets.find((a) => a.id === selected) || state.assets[0];
  const incident = state.incident;
  const equipmentIncident = state.workspace
    ? state.incidents
        .slice()
        .reverse()
        .find((item) => item.asset_id === asset.id)
    : incident;
  const active =
    incident && incident.state !== 'resolved' && incident.record_origin === 'plant_observation';
  const source = state.sources?.find(
    (item) => item.configuration.kind === 'operational' && item.configuration.asset_id === asset.id,
  );
  const signals = state.signals[asset.id] || [];
  const job = preview.assignments.find((item) => item.assetId === asset.id);
  const recommended = active
    ? incident.calculation.options.find((o) => o.id === incident.calculation.recommended)
    : undefined;
  function inspect(id: string) {
    selectAsset(id);
    setInspector(true);
    setPreset('asset');
    setFocusRequest((n) => n + 1);
  }
  return (
    <section className="factory-view" aria-label="Whole plant workspace">
      <div className="factory-canvas">
        <PlantScene
          state={state}
          selected={asset.id}
          onSelect={inspect}
          planView={planView}
          focusRequest={focusRequest}
          preset={preset}
          overlay={overlay}
          quality={quality === 'auto' ? automaticQuality : quality}
          onSlowDevice={quality === 'auto' ? usePerformanceMode : undefined}
          preview={{
            focusId: preview.focusId,
            scannedId: preview.scannedId,
            oocIds: preview.oocIds,
            readings: preview.readings,
            actors: preview.actors,
            onHover: preview.setHoverId,
          }}
        />
      </div>
      <header className="factory-heading">
        <div>
          <span className="eyebrow">
            FACTORY EXPLORER <span className="live-tag">REVIEWED OBSERVATIONS</span>
          </span>
          <h1>Your plant, in context.</h1>
          <p>
            {state.areas.filter((area) => area.nominal_units_per_hour > 0).length} forming lines.
            Shared services. Every dependency visible.
          </p>
        </div>
        <button
          className="icon-button inspector-toggle"
          aria-label={inspector ? 'Hide asset inspector' : 'Show asset inspector'}
          onClick={() => setInspector(!inspector)}
        >
          {inspector ? <PanelRightClose /> : <PanelRightOpen />}
        </button>
      </header>
      <div className="factory-stats">
        <span>
          <i className={`dot ${active ? 'degrading' : 'unknown'}`} />
          {state.assets.filter((a) => a.status === 'healthy').length} / {state.assets.length}{' '}
          healthy
        </span>
        <span>
          <strong>{state.measured_output_per_hour ?? 'Unavailable'}</strong> measured parts/h{' '}
          <small>{state.nominal_output_per_hour} parts/h rated capacity</small>
        </span>
        <button
          className="factory-assumptions"
          disabled={!recommended}
          onClick={() => setAssumptions(true)}
        >
          {recommended ? money(recommended.total_paise) : 'No active incident'}
          <small>
            {recommended
              ? 'option cost · inspect assumptions ↗'
              : 'source observations and planning estimates'}
          </small>
        </button>
      </div>
      <aside className="factory-browser" aria-label="Select plant equipment">
        <label className="asset-search">
          <Search size={15} />
          <input
            aria-label="Search plant assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find equipment…"
          />
        </label>
        {state.areas.map((area) => (
          <div key={area.id}>
            <div className="group-label">{area.name}</div>
            {state.assets
              .filter(
                (a) =>
                  a.area_id === area.id &&
                  (a.name + a.id).toLowerCase().includes(query.toLowerCase()),
              )
              .map((a) => {
                const job = preview.assignments.find((item) => item.assetId === a.id);
                return (
                  <button
                    key={a.id}
                    className={`factory-asset ${selected === a.id ? 'selected' : ''} ${preview.oocIds.includes(a.id) ? previewStyles.listOoc : ''}`}
                    aria-pressed={selected === a.id}
                    onClick={() => inspect(a.id)}
                  >
                    <span className={`dot ${a.status}`} />
                    <span>
                      <strong>{a.id}</strong>
                      <small>
                        {a.name} ·{' '}
                        {job
                          ? `${job.operatorId} ${PHASE_COPY[job.phase]}`
                          : preview.oocIds.includes(a.id)
                            ? 'preview OOC'
                            : a.status}
                      </small>
                    </span>
                    <ChevronRight size={13} />
                  </button>
                );
              })}
          </div>
        ))}
      </aside>
      <div className="camera-toolbar" aria-label="Factory camera and overlays">
        <select
          className="mobile-asset-select"
          aria-label="Select equipment"
          value={selected}
          onChange={(e) => inspect(e.target.value)}
        >
          {state.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} · {a.status}
            </option>
          ))}
        </select>
        <select
          aria-label="Camera preset"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            setFocusRequest((n) => n + 1);
          }}
        >
          <option value="overview">Whole factory</option>
          {state.areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
          <option value="asset">Selected equipment</option>
        </select>
        <button
          onClick={() => {
            setPreset('asset');
            setFocusRequest((n) => n + 1);
          }}
        >
          <Focus size={15} />
          Close-up
        </button>
        <button aria-pressed={planView} onClick={() => setPlanView(!planView)}>
          <Layers size={15} />
          {planView ? '3D factory' : '2D plan'}
        </button>
        <select
          aria-label="Graphics quality"
          value={quality}
          onChange={(e) => setQuality(e.target.value as typeof quality)}
        >
          <option value="auto">
            Auto graphics{automaticQuality === 'balanced' ? ' · performance' : ''}
          </option>
          <option value="detail">Detailed lighting</option>
          <option value="balanced">Performance mode</option>
        </select>
        <select
          aria-label="Plant overlay"
          value={overlay}
          onChange={(e) => setOverlay(e.target.value as 'health' | 'impact')}
        >
          <option value="health">Equipment health</option>
          <option value="impact">Production impact</option>
        </select>
      </div>
      {inspector && (
        <aside className="factory-inspector" aria-label="Asset inspector">
          <span className="eyebrow">
            {asset.area_id.replace('-', ' ').toUpperCase()} / {asset.id}
          </span>
          <h2>{asset.name}</h2>
          <span className={`asset-state ${asset.status}`}>
            <i className={`dot ${asset.status}`} />
            {asset.status.replace('_', ' ')}
          </span>
          <p>{asset.purpose}</p>
          <p className="muted">
            {source?.reason || 'No data connected · Condition unknown'} ·{' '}
            <Link href="/monitoring">Source details</Link>
          </p>
          {job && (
            <p className="muted">
              {job.operatorId} · {PHASE_COPY[job.phase]} · {job.id} ·{' '}
              <Link href={`/operators?assignment=${job.id}`}>Live assignment</Link>
            </p>
          )}
          <div className="inspector-signals">
            {(signals.length ? signals : preview.readings[asset.id] || []).map((signal) => (
              <div key={signal.signal_id}>
                <span>{signal.signal_id.replaceAll('_', ' ')}</span>
                <strong>
                  {signal.value.toFixed(2)} <small>{signal.unit}</small>
                </strong>
                <small className="source-label">
                  {'provenance' in signal
                    ? `${signal.provenance.replaceAll('_', ' ')} · ${signal.source_record_id || 'Record unavailable'}`
                    : 'ooc' in signal && signal.ooc
                      ? 'synthetic OOC · outside preview limits'
                      : 'synthetic preview · not plant health'}
                </small>
                {'provenance' in signal && (
                  <Sparkline
                    label={`${signal.signal_id} observation history`}
                    values={state.history
                      .map(
                        (w) =>
                          w.signals.find(
                            (s) => s.asset_id === asset.id && s.signal_id === signal.signal_id,
                          )?.value,
                      )
                      .filter((v): v is number => v !== undefined)}
                  />
                )}
              </div>
            ))}
          </div>
          <h3>Dependencies</h3>
          {state.dependencies
            .filter((d) => d.source === asset.id || d.target === asset.id)
            .map((d) => (
              <button
                className="dependency-row"
                key={d.source + d.target}
                onClick={() => inspect(d.source === asset.id ? d.target : d.source)}
              >
                {d.source}
                <span>{d.relationship}</span>
                {d.target}
                <ArrowRight size={12} />
              </button>
            ))}
          {equipmentIncident && (
            <Link
              className="primary inspector-cta"
              href={`/incidents?incident=${equipmentIncident.id}`}
            >
              Open investigation <ArrowRight size={15} />
            </Link>
          )}
          <p className="muted">
            {asset.diagnostic_profile
              ? `Evidence-backed ${asset.diagnostic_profile} investigation is available for this equipment.`
              : 'Context telemetry only. An equipment-specific diagnostic model is not configured.'}
          </p>
          <p className="muted">
            Production impact is an estimate from reviewed plant dependencies. Source readings
            retain their original provenance.
          </p>
        </aside>
      )}
      {!active && preview.assignments[0] && (
        <Link
          href={`/operators?assignment=${preview.assignments[0].id}`}
          className={previewStyles.banner}
        >
          <span className="dot stopped" />
          <div>
            <strong>
              {preview.assignments[0].operatorId} {PHASE_COPY[preview.assignments[0].phase]}{' '}
              {preview.assignments[0].assetId}
            </strong>
            <small>
              {preview.assignments[0].id} · {preview.assignments[0].severity} · synthetic dispatch
            </small>
          </div>
        </Link>
      )}
      {!active && !preview.assignments[0] && preview.oocIds.length > 0 && (
        <div className={previewStyles.banner} role="status">
          <span className="dot stopped" />
          <div>
            <strong>
              Preview OOC on {preview.oocIds.length} cell
              {preview.oocIds.length === 1 ? '' : 's'}
            </strong>
            <small>
              {preview.oocIds.slice(0, 4).join(', ')}
              {preview.oocIds.length > 4 ? '…' : ''} · synthetic limits only
            </small>
          </div>
        </div>
      )}
      {active && (
        <Link href={`/incidents?incident=${incident.id}`} className="factory-incident-toast">
          <span className="dot degrading" />
          <div>
            <strong>{incident.asset_id} needs attention</strong>
            <small>
              {incident.state.replaceAll('_', ' ')} · {incident.affected_lines.join(', ')}
            </small>
          </div>
          <ArrowRight size={18} />
        </Link>
      )}
      <footer className="factory-console">
        <div>
          <span className="eyebrow">PLANT OBSERVATIONS</span>
          <p>
            {state.sources?.filter(
              (item) => item.configuration.kind === 'operational' && item.quality === 'fresh',
            ).length || 0}{' '}
            sources with current data
          </p>
          <small>
            Unconnected equipment stays unknown. This view uses reviewed operational observations.
          </small>
        </div>
        <Link className="primary" href="/monitoring">
          Manage telemetry sources <ArrowRight size={15} />
        </Link>
      </footer>
      <EvidenceDialog
        evidence={null}
        assumptions={assumptions}
        calc={incident?.calculation}
        onClose={() => setAssumptions(false)}
      />
    </section>
  );
}
