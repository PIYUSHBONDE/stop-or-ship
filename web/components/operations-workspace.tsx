'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronRight,
  Clock3,
  FileCheck2,
  Gauge,
  Layers3,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  StepForward,
  Workflow,
} from 'lucide-react';
import { money } from '@/lib/api';
import type { CommandBodies, QuestionAnswer } from '@/lib/api';
import { usePlant } from '@/components/session-provider';
import { MemoryPanel } from './workflow/memory-panel';
import { WorkOrderPanel } from './workflow/work-order-panel';
import { DecisionPanel } from './workflow/decision-panel';
import { InvestigationPanel } from './workflow/investigation-panel';
import { IncidentHistory } from '@/components/incident-history';
import { Metric } from '@/components/dashboard-primitives';
import EvidenceDialog from '@/components/evidence-dialog';
import type { Evidence } from '@/lib/types';
import Sparkline from '@/components/sparkline';

const PlantScene = dynamic(() => import('@/components/plant-scene'), {
  ssr: false,
  loading: () => (
    <div className="scene-loading">
      <LoaderCircle className="spin" />
      Loading plant geometry
    </div>
  ),
});
import { type Tab } from './workflow/shared';
const tabs = ['Investigation', 'Decision', 'Work order', 'Memory'] as const;

export default function OperationsWorkspace({
  view = 'operations',
}: {
  view?: 'operations' | 'incidents' | 'maintenance' | 'memory';
}) {
  const {
    state,
    error,
    busy,
    act,
    approve: approveIntent,
    ask: askPlant,
    selected,
    selectAsset: setSelected,
  } = usePlant();
  const [tab, setTab] = useState<Tab>(
    view === 'maintenance' ? 'Work order' : view === 'memory' ? 'Memory' : 'Investigation',
  );
  const [planView, setPlanView] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [assumptions, setAssumptions] = useState(false);
  const [scenario, setScenario] =
    useState<CommandBodies['/scenarios']['scenario']>('pump_degradation');
  const [option, setOption] = useState<CommandBodies['/approve']['option_id'] | ''>('');
  const [riskDraft, setRiskDraft] = useState({ version: '', value: 1 });
  const risk =
    riskDraft.version === state?.incident?.calculation_version
      ? riskDraft.value
      : (state?.incident?.calculation.risk_multiplier ?? 1);
  const setRisk = (value: number) =>
    setRiskDraft({ version: state?.incident?.calculation_version || '', value });
  const [approver, setApprover] = useState('Maintenance manager');
  const [cause, setCause] = useState('');
  const [fix, setFix] = useState('');
  const [parts, setParts] = useState('None recorded');
  const [outcome, setOutcome] = useState(
    'Simulated repair completed; telemetry verification pending',
  );
  const [recovery, setRecovery] =
    useState<CommandBodies['/repair/complete']['recovery']>('healthy');
  const [question, setQuestion] = useState('What is affecting Line A?');
  const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
  const focusedIncident = useRef<string | null>(null);

  useEffect(() => {
    const id = state?.incident?.id;
    if (id && id !== focusedIncident.current) {
      focusedIncident.current = id;
      setSelected(state?.incident?.asset_id || 'P-107');
      setFocusRequest((n) => n + 1);
    }
  }, [state?.incident?.id, state, setSelected]);

  async function approve() {
    if (!state?.incident) return;
    const approved = await approveIntent({
      option_id: option || state.incident.calculation.recommended,
      calculation_version: state.incident.calculation_version,
      approver,
    });
    if (approved) setTab('Work order');
  }
  async function ask() {
    if (question.trim().length < 3 || busy || !state || state.quotas.questions >= 5) return;
    const result = await askPlant(question);
    if (result) setAnswer(result);
  }

  if (!state)
    return (
      <main className="boot">
        <div className="brand-mark">
          <Workflow size={28} />
        </div>
        <h1>PlantSense</h1>
        <p>Connecting to your demo plant</p>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button className="primary" onClick={() => location.reload()}>
              Retry connection
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </main>
    );
  const incident = state.incident;
  const asset = state.assets.find((a) => a.id === selected)!;
  const signals = state.signals[selected] || [];
  const healthy = state.assets.filter((a) => a.status === 'healthy').length;
  const calc = incident?.calculation;
  const chosen = calc?.options.find((o) => o.id === (option || calc.recommended));
  const isResolved = incident?.state === 'resolved';

  return (
    <div className={`embedded-workspace view-${view}`}>
      <div className="workspace-body">
        <div className="page-heading">
          <div>
            <div className="breadcrumb">
              WORKSPACE <ChevronRight size={12} /> NARMADA PRECISION WORKS
            </div>
            <h1>
              {view === 'operations'
                ? 'Plant overview'
                : view === 'incidents'
                  ? 'Incident workspace'
                  : view === 'maintenance'
                    ? 'Maintenance workspace'
                    : 'Reliability memory'}
              <span className="live-tag">REPLAY</span>
            </h1>
            <p>A clear view of your plant. An informed next move.</p>
          </div>
          <div className="heading-actions">
            <span className="shift">
              <Clock3 size={14} />
              Shift A · {state.simulated_minutes} simulated min
            </span>
            <button
              className="icon-button"
              aria-label="Reset demo plant"
              onClick={() => {
                act('/reset');
                setOption('');
                setAnswer(null);
              }}
              disabled={busy}
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
        <section className="metrics" aria-label="Plant metrics">
          <Metric
            label="ASSET HEALTH"
            value={`${healthy}`}
            unit="/ 12 healthy"
            icon={<ShieldCheck size={18} />}
            note={
              healthy === 12
                ? 'All systems within normal state'
                : `${12 - healthy} assets need attention`
            }
            tone={healthy === 12 ? 'green' : 'amber'}
          />
          <Metric
            label="PLANT OUTPUT"
            value={`${state.output_per_hour}`}
            unit="parts / h"
            icon={<Gauge size={18} />}
            note={`Nominal capacity ${state.nominal_output_per_hour} parts / h`}
            tone="green"
          />
          <Metric
            label="EXPECTED OPTION COST"
            value={
              calc ? money(calc.options.find((o) => o.id === calc.recommended)!.total_paise) : '—'
            }
            icon={<ArrowDownRight size={18} />}
            note="Configured shift economics"
            tone="amber"
            onClick={() => setAssumptions(true)}
          />
          <Metric
            label="VERIFIED REPAIRS"
            value={`${state.memory.length}`}
            unit="confirmed cases"
            icon={<FileCheck2 size={18} />}
            note="Evidence retained for the next incident"
            tone="green"
          />
        </section>
        <IncidentHistory state={state} />
        <div className="main-grid">
          <aside className="assets-panel panel">
            <div className="panel-title">
              <h2>
                <Box size={16} />
                Plant assets
              </h2>
              <span className="count">12</span>
            </div>
            <div className="asset-groups">
              {['line-a', 'line-b', 'utilities', 'dispatch'].map((group) => (
                <div key={group}>
                  <div className="group-label">{group.replace('-', ' ').toUpperCase()}</div>
                  {state.assets
                    .filter((a) => a.area_id === group)
                    .map((a) => (
                      <button
                        className={`asset-row ${selected === a.id ? 'selected' : ''}`}
                        key={a.id}
                        onClick={() => setSelected(a.id)}
                        aria-pressed={selected === a.id}
                      >
                        <span className={`dot ${a.status}`} />
                        <span>
                          <strong>{a.id}</strong>
                          <small>{a.name}</small>
                        </span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                </div>
              ))}
            </div>
            <div className="asset-footer">
              <span className="dot healthy" />
              Healthy
              <span className="dot degrading" />
              Attention
            </div>
          </aside>
          <section className="plant-column">
            <div className="scene-panel panel">
              <div className="scene-toolbar">
                <div>
                  <span className="dot healthy" />
                  <strong>Digital plant</strong>
                  <span className="subtle"> / {planView ? '2D plan' : '3D view'}</span>
                </div>
                <div>
                  <button
                    className={`text-button ${planView ? 'is-active' : ''}`}
                    onClick={() => setPlanView(!planView)}
                  >
                    <Layers3 size={14} />
                    {planView ? '3D view' : '2D plan'}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Focus incident equipment"
                    onClick={() => {
                      setSelected(state?.incident?.asset_id || 'P-107');
                      setFocusRequest((n) => n + 1);
                    }}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
              <div className="scene">
                <PlantScene
                  state={state}
                  selected={selected}
                  onSelect={setSelected}
                  planView={planView || view !== 'operations'}
                  focusRequest={focusRequest}
                />
                <div className="scene-location">
                  NARMADA PRECISION WORKS<small>Hydraulic forming · 2 production lines</small>
                </div>
                <div className="scene-legend">
                  <span className="dot healthy" />
                  Healthy
                  <span className="dot degrading" />
                  Degrading
                  <span className="dot affected" />
                  Downstream impact
                </div>
              </div>
              <div className="replay-toolbar">
                <div className="replay-status">
                  <span className="dot investigating" />
                  <span>
                    Telemetry replay<small>{state.data_mode}</small>
                  </span>
                </div>
                <div className="replay-controls">
                  <button
                    className="icon-button"
                    aria-label={state.running ? 'Pause replay' : 'Play replay'}
                    onClick={() => act('/replay', { action: state.running ? 'pause' : 'play' })}
                    disabled={busy}
                  >
                    {state.running ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Advance one telemetry window"
                    onClick={() => act('/replay', { action: 'step' })}
                    disabled={busy}
                  >
                    <StepForward size={16} />
                  </button>
                  <span>12×</span>
                </div>
              </div>
            </div>
            <div className="scenario-bar">
              <div>
                <Sparkles size={17} />
                <span>Explore a scenario</span>
              </div>
              <select
                aria-label="Demo scenario"
                value={scenario}
                onChange={(e) =>
                  setScenario(e.target.value as CommandBodies['/scenarios']['scenario'])
                }
              >
                {state.scenarios.map((scenario) => (
                  <option
                    key={scenario.id}
                    value={scenario.id}
                    disabled={scenario.requires_memory && !state.memory.length}
                  >
                    {scenario.name}
                    {!scenario.measured_available ? ' · synthetic' : ''}
                  </option>
                ))}
              </select>
              <button
                className="primary compact"
                disabled={busy || (!!incident && !isResolved)}
                onClick={() => {
                  setSelected(state.scenarios.find((s) => s.id === scenario)?.asset_id || 'P-107');
                  setTab('Investigation');
                  setOption('');
                  act('/scenarios', { scenario });
                }}
              >
                Start scenario
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="telemetry-panel panel">
              <div className="panel-title">
                <h2>
                  <Activity size={16} />
                  {asset.id} <span className="subtle"> / {asset.name}</span>
                </h2>
                <span className={`status-badge ${asset.status}`}>{asset.status}</span>
              </div>
              <p className="asset-purpose">{asset.purpose}</p>
              <div className="signal-grid">
                {signals.map((signal) => (
                  <div className="signal-card" key={signal.signal_id}>
                    <div className="signal-label">
                      {signal.signal_id}
                      <span>
                        {signal.provenance === 'measured_replay' ? 'MEASURED' : 'SYNTHETIC'}
                      </span>
                    </div>
                    <div className="signal-value">
                      {signal.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      <small>{signal.unit}</small>
                    </div>
                    <Sparkline
                      values={
                        selected === state.incident?.asset_id
                          ? state.history.map(
                              (r) =>
                                r.signals.find((s) => s.signal_id === signal.signal_id)?.value || 0,
                            )
                          : []
                      }
                      color={asset.status === 'healthy' ? '#73d8b7' : '#f0b275'}
                      label={`${signal.signal_id} telemetry history`}
                    />
                    {signal.source_cycle_id && (
                      <small className="cycle-label">
                        {signal.source_dataset_id || 'UCI'} record{' '}
                        {signal.source_record_id || signal.source_cycle_id}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="activity-panel panel">
              <div className="panel-title">
                <h2>
                  <Clock3 size={16} />
                  Activity log
                </h2>
                <span className="subtle">SESSION AUDIT</span>
              </div>
              {state.events.length === 0 ? (
                <p className="muted log-empty">
                  Start a scenario to observe the reliability workflow.
                </p>
              ) : (
                <div className="event-list">
                  {state.events
                    .slice(-4)
                    .reverse()
                    .map((e, i) => (
                      <div key={e.at + i}>
                        <span className="event-dot" />
                        <span>{e.message}</span>
                        <time>
                          {new Date(e.at).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </section>
          <aside className="intelligence-panel panel">
            <div className="intelligence-title">
              <div className="ai-symbol">
                <Sparkles size={19} />
              </div>
              <div>
                <h2>Plant intelligence</h2>
                <small>EVIDENCE → DECISION → OUTCOME</small>
              </div>
              <span className="intelligence-status" />
            </div>
            <div className="tabs" role="tablist" aria-label="Incident workflow">
              {tabs.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t}
                  {t === 'Memory' && state.memory.length > 0 && <span>{state.memory.length}</span>}
                </button>
              ))}
            </div>
            <div className="intelligence-content" role="tabpanel" aria-label={tab}>
              {tab === 'Investigation' && (
                <InvestigationPanel
                  state={state}
                  busy={busy}
                  act={act}
                  setEvidence={setEvidence}
                  setTab={setTab}
                />
              )}
              {tab === 'Decision' && (
                <DecisionPanel
                  state={state}
                  busy={busy}
                  act={act}
                  option={option}
                  setOption={setOption}
                  chosen={chosen}
                  risk={risk}
                  setRisk={setRisk}
                  approver={approver}
                  setApprover={setApprover}
                  approve={approve}
                  setAssumptions={setAssumptions}
                />
              )}
              {tab === 'Work order' && (
                <WorkOrderPanel
                  state={state}
                  busy={busy}
                  act={act}
                  cause={cause}
                  setCause={setCause}
                  fix={fix}
                  setFix={setFix}
                  parts={parts}
                  setParts={setParts}
                  outcome={outcome}
                  setOutcome={setOutcome}
                  recovery={recovery}
                  setRecovery={setRecovery}
                  setTab={setTab}
                />
              )}
              {tab === 'Memory' && (
                <MemoryPanel
                  state={state}
                  busy={busy}
                  act={act}
                  setTab={setTab}
                  setOption={setOption}
                />
              )}
            </div>
            <div className="ask-plant">
              <label htmlFor="plant-question">
                <Sparkles size={13} />
                Ask the plant <small>{5 - state.quotas.questions} left</small>
              </label>
              <div>
                <input
                  id="plant-question"
                  value={question}
                  maxLength={500}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) ask();
                  }}
                />
                <button
                  aria-label="Ask plant question"
                  disabled={busy || question.trim().length < 3 || state.quotas.questions >= 5}
                  onClick={ask}
                >
                  <ArrowRight size={17} />
                </button>
              </div>
              {answer && (
                <div className="plant-answer">
                  <p>{answer.answer}</p>
                  <small>{answer.provider}</small>
                  <div className="citation-links">
                    {answer.citations.map((id) => (
                      <button
                        key={id}
                        onClick={() =>
                          setEvidence(answer.evidence.find((source) => source.id === id) || null)
                        }
                      >
                        Inspect source
                        <ArrowUpRight size={10} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            <span className="dot healthy" />
            System online · isolated demo session
          </span>
          <span>PlantSense / Evidence-backed reliability</span>
        </footer>
      </div>
      <EvidenceDialog
        evidence={evidence}
        assumptions={assumptions}
        calc={calc}
        onClose={() => {
          setEvidence(null);
          setAssumptions(false);
        }}
      />
    </div>
  );
}
