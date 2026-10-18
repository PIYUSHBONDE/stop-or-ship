'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  Focus,
  Search,
  ArrowRight,
  Activity,
  X,
  ChevronRight,
  Maximize2,
} from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { usePlantControls } from '@/components/layout/plant-controls-context';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { scenarioPumps, sceneAssets } from '@/features/plant/lib/process-simulation';
import { OPERATORS, PHASE_COPY } from '@/features/operators/lib/preview-dispatch';
import Sparkline from '@/components/ui/sparkline';
import { seriesFor } from '@/features/monitoring/lib/preview-records';
import styles from './simulation-workspace.module.css';

const PlantScene = dynamic(() => import('./plant-scene'), {
  ssr: false,
  loading: () => <p>Preparing your factory floor…</p>,
});
const label = (text: string) => text.replaceAll('_', ' ');
const time = (elapsed: number) =>
  `${Math.floor(elapsed / 60000)
    .toString()
    .padStart(2, '0')}:${Math.floor((elapsed / 1000) % 60)
    .toString()
    .padStart(2, '0')}`;

export function SimulationWorkspace() {
  const { state, selected, selectAsset } = usePlant();
  const simulation = usePreviewDispatch();
  const [planView, setPlanView] = useState(false);
  const [query, setQuery] = useState('');
  const [pump, setPump] = useState('');
  const [focus, setFocus] = useState(0);
  const [preset, setPreset] = useState('overview');
  const [quality, setQuality] = useState<'detail' | 'balanced'>('detail');
  const [reset, setReset] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { open: controlsOpen, setOpen: setControlsOpen, returnFocus } = usePlantControls();
  const controlsPanel = useRef<HTMLElement>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const equipmentTrigger = useRef<HTMLButtonElement>(null);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inspectorOpen) inspectorHeading.current?.focus({ preventScroll: true });
  }, [focus, inspectorOpen]);
  useEffect(() => {
    if (reset) resetDialog.current?.showModal();
    else resetDialog.current?.close();
  }, [reset]);
  useEffect(() => {
    if (equipmentOpen) searchInput.current?.focus();
  }, [equipmentOpen]);
  useEffect(() => {
    if (controlsOpen) {
      setEquipmentOpen(false);
      setDetailsOpen(false);
      controlsPanel.current?.focus();
    }
  }, [controlsOpen]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (event.key === '/') {
        event.preventDefault();
        setEquipmentOpen(true);
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  const slow = useCallback(() => setQuality('balanced'), []);
  const { view, process } = simulation;
  if (!state || !view || !process) return <p role="status">Restoring your simulated plant…</p>;
  const asset = state.assets.find((a) => a.id === selected) ?? state.assets[0];
  if (!asset) return <p>No equipment configured. Open Setup to configure a plant.</p>;
  const pumps = scenarioPumps(state);
  const chosenPump = pumps.find((a) => a.id === pump) ?? pumps[0];
  const mode = view.modes[asset.id];
  const job = simulation.assignments.find((a) => a.assetId === asset.id);
  const operator = OPERATORS.find((o) => o.id === job?.operatorId);
  const cases = simulation.ledger.cases.filter((c) => c.assetId === asset.id).slice(0, 3);
  const readings = view.readings[asset.id] ?? [];
  const line = view.lines.find((l) => l.id === asset.area_id);
  const dependent = state.dependencies.filter((d) => d.source === asset.id);
  const faultAsset = state.assets.find((a) => a.id === process.fault?.assetId);
  const phaseCopy: Record<string, string> = {
    developing: 'Pressure is falling. Downstream production is slowing.',
    dispatched: 'Pressure loss detected. An operator is assigned.',
    en_route: 'Operator travelling to the pump. Downstream production is reduced.',
    on_site: 'Operator inspecting the pump. The affected line is stopped.',
    correcting: 'Pump repair in progress. The affected line remains stopped.',
    recovering: 'Repair complete. Checking pressure recovery for 30 simulated seconds.',
    cleared: 'Recovery complete. Simulated production restored.',
    returning: 'Simulated production restored. Operator returning to station.',
    returned: 'Simulated production restored. Operator back at station.',
  };
  const scenarioMessage = process.fault
    ? `${faultAsset?.name ?? process.fault.assetId}: ${phaseCopy[view.phase] ?? 'Response in progress.'}`
    : 'Plant running normally.';
  const scene = {
    ...state,
    assets: sceneAssets(state.assets, view.modes),
    affected: process.fault ? view.affected : [],
  };
  const inspect = (id: string) => {
    selectAsset(id);
    setPreset('asset');
    setFocus((n) => n + 1);
    setInspectorOpen(true);
    setEquipmentOpen(false);
    setDetailsOpen(false);
  };
  const activeCases = simulation.ledger.cases.filter((c) => !c.clearedAt && !c.interrupted).length;
  return (
    <section className={styles.workspace} aria-label="Plant simulation workspace">
      <header className={styles.heading}>
        <div>
          <h1>{state.plant.name}</h1>
          <p>
            Hydraulic forming · {view.lines.length} production lines · Simulated plant
            {process.paused ? ' · Paused' : ''}
          </p>
        </div>
      </header>
      <div className={styles.notice}>
        <div className={styles.scenarioStatus} role="status" aria-label="Simulation progress">
          <strong>{scenarioMessage}</strong>
        </div>
        <p className={styles.scenarioOutput}>
          {view.output} / {view.nominal} parts/h · {time(process.elapsed)} simulated time
          {process.paused ? ' · Paused' : ''}
        </p>
        Generated readings, dispatch and output illustrate a manufacturing scenario.{' '}
        <Link href="/plant?view=observations">
          Reviewed operational observations <ArrowRight size={13} />
        </Link>
        <div>
          {!process.fault && (
            <small>
              Normal operation is stable. The next scheduled fault starts in{' '}
              {Math.max(0, Math.ceil((process.nextFaultAt - process.elapsed) / 1000))} simulated
              seconds.
            </small>
          )}
          {simulation.controlError && <p role="alert">{simulation.controlError}</p>}
        </div>
      </div>
      <div className={styles.compactSummary} aria-label="Simulation summary">
        <span>
          <strong aria-label="Simulated production rate">{view.output}</strong> / {view.nominal}{' '}
          parts/h
        </span>
        <span>
          {view.lines.filter((l) => l.rate > 0).length} / {view.lines.length} lines producing
        </span>
        <span>{simulation.assignments.length} operator jobs</span>
      </div>
      <div className={styles.panelActions}>
        <button
          ref={equipmentTrigger}
          className="secondary"
          aria-expanded={equipmentOpen}
          aria-controls="plant-equipment"
          onClick={() => {
            setControlsOpen(false);
            setEquipmentOpen(!equipmentOpen);
          }}
        >
          <Search size={15} /> Find equipment
        </button>
        <button
          className="secondary"
          aria-expanded={detailsOpen}
          aria-controls="plant-details"
          onClick={() => {
            setControlsOpen(false);
            setDetailsOpen(!detailsOpen);
            setEquipmentOpen(false);
          }}
        >
          <Activity size={15} /> Plant details
        </button>
      </div>
      <section
        ref={controlsPanel}
        className={styles.controlPanel}
        hidden={!controlsOpen}
        aria-label="Simulation controls"
        id="plant-controls"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setControlsOpen(false);
            returnFocus();
          }
        }}
      >
        <div className={styles.panelHeader}>
          <h2>Simulation controls</h2>
          <button
            className={styles.closeControls}
            aria-label="Close simulation controls"
            onClick={() => {
              setControlsOpen(false);
              returnFocus();
            }}
          >
            <X size={17} />
          </button>
        </div>
        <p className={styles.controlNote}>
          Browser-generated readings and dispatch. These controls do not operate factory equipment.
        </p>
        <div className={styles.playback}>
          <div className={styles.clock}>
            <span className={process.paused ? styles.paused : styles.running}>
              {process.paused ? 'Paused' : 'Running'}
            </span>
            <strong aria-label="Simulation clock">{time(process.elapsed)}</strong>
            <small>Simulated time</small>
          </div>
          <button
            className="secondary"
            aria-label={process.paused ? 'Resume simulation' : 'Pause simulation'}
            onClick={() => simulation.command({ type: 'pause' })}
          >
            {process.paused ? <Play size={15} /> : <Pause size={15} />}
            {process.paused ? 'Resume' : 'Pause'}
          </button>
        </div>
        <label>
          Speed
          <select
            aria-label="Simulation speed"
            title="1× real time; 10× demonstration. Durations are simulated."
            value={process.speed}
            onChange={(e) =>
              simulation.command({ type: 'speed', speed: Number(e.target.value) as 1 | 10 })
            }
          >
            <option value={1}>1× real time</option>
            <option value={10}>10× demonstration</option>
          </select>
        </label>
        <label>
          Pump pressure loss
          <select
            aria-label="Scenario pump"
            title={chosenPump?.name}
            value={chosenPump?.id ?? ''}
            disabled={!pumps.length || !!process.fault}
            onChange={(e) => setPump(e.target.value)}
          >
            {pumps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          aria-label="Start pump pressure loss"
          disabled={!chosenPump || !!process.fault || process.paused}
          onClick={() => {
            if (chosenPump) {
              simulation.command({ type: 'fault', assetId: chosenPump.id });
              inspect(chosenPump.id);
            }
          }}
        >
          Start scenario <ArrowRight size={15} />
        </button>
        <button
          className="secondary"
          aria-label="Reset scenario"
          title="Reset scenario"
          onClick={() => setReset(true)}
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </section>
      <dialog
        ref={resetDialog}
        className={styles.confirm}
        role="alertdialog"
        aria-label="Reset simulation"
        onCancel={() => setReset(false)}
        onClose={() => setReset(false)}
      >
        <strong>Reset this scenario?</strong>
        <p>
          Active work becomes interrupted history. Existing samples and completed cases stay
          available.
        </p>
        <button
          className="primary"
          onClick={() => {
            simulation.command({ type: 'reset' });
            setReset(false);
          }}
        >
          Confirm reset
        </button>
        <button className="secondary" onClick={() => setReset(false)}>
          Keep running
        </button>
      </dialog>
      <div className={styles.workarea}>
        <aside
          className={styles.catalog}
          aria-label="Equipment browser"
          id="plant-equipment"
          hidden={!equipmentOpen}
        >
          <div className={styles.panelHeader}>
            <h2>Equipment</h2>
            <button
              aria-label="Close equipment browser"
              onClick={() => {
                setEquipmentOpen(false);
                equipmentTrigger.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          </div>
          <label>
            <Search size={15} />
            <input
              ref={searchInput}
              aria-label="Search equipment"
              placeholder="Find equipment…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!state.assets.some((a) =>
            `${a.name} ${a.id}`.toLowerCase().includes(query.toLowerCase()),
          ) && <p className={styles.empty}>No matching equipment. Try another name or asset ID.</p>}
          {state.areas.map((area) => {
            const assets = state.assets.filter(
              (a) =>
                a.area_id === area.id &&
                `${a.name} ${a.id}`.toLowerCase().includes(query.toLowerCase()),
            );
            return assets.length ? (
              <div key={area.id}>
                <h2>{area.name}</h2>
                {assets.map((a) => (
                  <button key={a.id} aria-pressed={a.id === asset.id} onClick={() => inspect(a.id)}>
                    <i className={styles.dot} data-mode={view.modes[a.id]} />
                    <span>
                      {a.name}
                      <small>
                        {a.id} · {label(view.modes[a.id])}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </aside>
        <section className={styles.floor} aria-label="Factory floor">
          <div className={styles.toolbar}>
            <strong>Factory floor</strong>
            <button
              className="secondary"
              aria-label="Whole factory"
              title="Whole factory"
              onClick={() => {
                setPreset('overview');
                setFocus((n) => n + 1);
              }}
            >
              <Maximize2 size={15} />
            </button>
            <button
              aria-pressed={!planView}
              className={planView ? 'secondary' : 'primary'}
              onClick={() => setPlanView(false)}
            >
              3D view
            </button>
            <button
              aria-pressed={planView}
              className={planView ? 'primary' : 'secondary'}
              onClick={() => setPlanView(true)}
            >
              2D plan
            </button>
            <button
              className="secondary"
              aria-label="Focus selected equipment"
              onClick={() => {
                setPreset('asset');
                setFocus((n) => n + 1);
              }}
            >
              <Focus size={15} />
            </button>
            <select
              aria-label="Scene quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value as 'detail' | 'balanced')}
            >
              <option value="detail">Detailed</option>
              <option value="balanced">Performance</option>
            </select>
            <div className={styles.legend}>
              <span>
                <i data-mode="running" />
                Running
              </span>
              <span>
                <i data-mode="degraded" />
                Degraded
              </span>
              <span>
                <i data-mode="under_repair" />
                Under repair
              </span>
              <span>
                <i data-mode="recovering" />
                Recovering
              </span>
            </div>
          </div>
          <div className={styles.stage}>
            <PlantScene
              state={scene}
              selected={asset.id}
              onSelect={inspect}
              planView={planView}
              focusRequest={focus}
              preset={preset}
              overlay="impact"
              quality={quality}
              onSlowDevice={slow}
              simulationPaused={process.paused}
              isSimulation
              preview={{
                focusId: simulation.hoverId,
                scannedId: null,
                oocIds: simulation.oocIds,
                readings: simulation.readings,
                actors: simulation.actors,
                onHover: simulation.setHoverId,
              }}
            />
          </div>
        </section>
        <button
          ref={inspectorTrigger}
          className={styles.inspectorTrigger}
          data-open={inspectorOpen}
          aria-controls="plant-inspector"
          aria-expanded={inspectorOpen}
          onClick={() => setInspectorOpen(true)}
        >
          <span>
            {asset.id} · {asset.name}
            <small>{label(mode)} · Simulated readings</small>
          </span>
          <ChevronRight size={17} />
        </button>
        <aside
          className={styles.inspector}
          data-open={inspectorOpen}
          aria-label="Machine inspector"
          id="plant-inspector"
        >
          <div className={styles.panelHeader}>
            <span>
              {asset.area_id} / {asset.id}
            </span>
            <button
              aria-label="Close machine inspector"
              onClick={() => {
                setInspectorOpen(false);
                inspectorTrigger.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          </div>
          <span className={styles.eyebrow}>
            {asset.id} · {asset.type}
          </span>
          <h2 ref={inspectorHeading} tabIndex={-1}>
            {asset.name}
          </h2>
          <span className={styles.state} data-mode={mode}>
            {label(mode)}
          </span>
          <p>{asset.purpose}</p>
          <h3>Current response</h3>
          <p>
            {job
              ? `${operator?.name ?? job.operatorId} · ${PHASE_COPY[job.phase]}. ${Math.ceil(job.remainingMs / 1000)} simulated seconds to station return.`
              : mode === 'degraded'
                ? 'Pressure is deteriorating. Dispatch starts when the scenario envelope is breached.'
                : line?.impacted
                  ? 'Upstream pump work is controlling this line. Open the affected pump for its operator job.'
                  : 'No active work on this machine.'}
          </p>
          {job && (
            <Link href={`/operators?assignment=${job.id}`}>
              Follow operator job <ArrowRight size={13} />
            </Link>
          )}
          <h3>Simulated readings</h3>
          {readings.map((r) => (
            <div className={styles.reading} key={r.signal_id}>
              <div>
                <span>{label(r.signal_id)}</span>
                <strong>
                  {r.value} <small>{r.unit}</small>
                </strong>
              </div>
              <Sparkline
                values={seriesFor(simulation.ledger.samples[asset.id] ?? [], r.signal_id)}
                label={`${asset.id} ${r.signal_id} simulated trend`}
                color={r.ooc ? '#f1b675' : '#85ddba'}
              />
              <small>
                {mode === 'under_repair' || mode === 'stopped' || mode === 'idle'
                  ? 'Stopped/repair readings; running reference'
                  : 'Running reference'}
                : {r.low}–{r.high} {r.unit}
                {r.ooc ? ' · Outside envelope' : ''}
              </small>
            </div>
          ))}
          <h3>Production impact</h3>
          <p>
            {line
              ? `${line.name}: ${line.rate} of ${line.nominal_units_per_hour} simulated parts/h. ${line.impacted ? 'This line is affected by the pressure-loss scenario.' : 'This line is operating normally.'}`
              : 'Shared service or collection equipment. Select a production line to inspect its throughput.'}
          </p>
          <h3>Supplies and dependencies</h3>
          <div className={styles.dependencies}>
            {dependent.length ? (
              dependent.map((d) => (
                <button key={d.target} onClick={() => inspect(d.target)}>
                  {d.relationship} {state.assets.find((a) => a.id === d.target)?.name ?? d.target}
                  <ArrowRight size={13} />
                </button>
              ))
            ) : (
              <small>End of this dependency path.</small>
            )}
          </div>
          <h3>Recent simulated cases</h3>
          {cases.length ? (
            cases.map((c) => (
              <Link className={styles.case} key={c.id} href={`/incidents?case=${c.id}`}>
                {c.id}
                <small>
                  {c.interrupted
                    ? 'Interrupted'
                    : c.clearedAt
                      ? 'Recovered'
                      : c.fixedAt
                        ? 'Checking recovery'
                        : 'In progress'}
                </small>
              </Link>
            ))
          ) : (
            <p>No previous simulated fault on this machine.</p>
          )}
          <Link href={`/monitoring/${encodeURIComponent(asset.id)}`}>
            Full machine records <ArrowRight size={13} />
          </Link>
        </aside>
      </div>
      <aside
        className={styles.details}
        aria-label="Plant details"
        id="plant-details"
        hidden={!detailsOpen}
      >
        <div className={styles.panelHeader}>
          <h2>Plant details</h2>
          <button aria-label="Close plant details" onClick={() => setDetailsOpen(false)}>
            <X size={17} />
          </button>
        </div>
        <div className={styles.summary}>
          <div>
            <small>Simulated output</small>
            <strong>
              {view.output}
              <span> parts/h</span>
            </strong>
            <small>{view.nominal} parts/h configured capacity</small>
          </div>
          <div>
            <small>Lines producing</small>
            <strong>
              {view.lines.filter((l) => l.rate > 0).length}
              <span> / {view.lines.length}</span>
            </strong>
            <small>{view.lines.filter((l) => l.impacted).length} affected by this scenario</small>
          </div>
          <div>
            <small>Machines needing attention</small>
            <strong>
              {
                Object.values(view.modes).filter((m) =>
                  ['degraded', 'under_repair', 'recovering', 'stopped'].includes(m),
                ).length
              }
            </strong>
            <small>
              {activeCases} active simulated case{activeCases === 1 ? '' : 's'}
            </small>
          </div>
          <div>
            <small>Operator jobs</small>
            <strong>{simulation.assignments.length}</strong>
            <small>Inspection, repair and recovery</small>
          </div>
        </div>
        <div className={styles.flow} aria-label="Production flow">
          <span>Material stock</span>
          <ArrowRight size={16} />
          <span>Hydraulic forming press</span>
          <ArrowRight size={16} />
          <span>Transfer conveyor</span>
          <ArrowRight size={16} />
          <span>Finished components</span>
          <small>Motors, pumps, cooling, air and power support the forming lines.</small>
        </div>
        <div className={styles.lineList} aria-label="Production lines">
          {view.lines.map((l) => (
            <button
              key={l.id}
              data-mode={l.mode}
              onClick={() => {
                const press = state.assets.find((a) => a.area_id === l.id && a.type === 'press');
                if (press) inspect(press.id);
              }}
            >
              <span>
                {l.name}
                <small>{label(l.mode)}</small>
              </span>
              <strong>
                {l.rate} <small>/ {l.nominal_units_per_hour} parts/h</small>
              </strong>
              <meter
                min={0}
                max={l.nominal_units_per_hour}
                value={l.rate}
                aria-label={`${l.name} simulated output`}
              />
            </button>
          ))}
        </div>
        <section className={styles.activity} aria-label="Plant activity">
          <header>
            <Activity size={18} />
            <h2>Plant activity</h2>
            <small>Simulated events · most recent first</small>
          </header>
          <ol>
            {process.events.slice(0, 8).map((e) => (
              <li key={e.id}>
                <time>{time(e.at - process.epoch)}</time>
                {e.assetId ? (
                  <button onClick={() => inspect(e.assetId!)}>{e.assetId}</button>
                ) : (
                  <span>Plant</span>
                )}
                <p>{e.message}</p>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </section>
  );
}
