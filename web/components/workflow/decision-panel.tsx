'use client';
import { ArrowUpRight, Layers3, ShieldCheck } from 'lucide-react';
import type { State, Option } from '@/lib/types';
import type { CommandBodies } from '@/lib/api';
import { money } from '@/lib/api';
import { Empty } from '../dashboard-primitives';
import { type SessionActions } from './shared';
type Props = SessionActions & {
  state: State;
  option: CommandBodies['/approve']['option_id'] | '';
  setOption: (value: CommandBodies['/approve']['option_id'] | '') => void;
  chosen?: Option;
  risk: number;
  setRisk: (value: number) => void;
  approver: string;
  setApprover: (value: string) => void;
  approve: () => void;
  setAssumptions: (value: boolean) => void;
};
export function DecisionPanel({
  state,
  busy,
  act,
  option,
  setOption,
  chosen,
  risk,
  setRisk,
  approver,
  setApprover,
  approve,
  setAssumptions,
}: Props) {
  const incident = state.incident;
  const calc = incident?.calculation;
  const dirty = !!calc && risk !== calc.risk_multiplier;
  const source = state.monitoring?.enabled
    ? state.monitoring.health.find((item) => item.asset_id === incident?.asset_id)
    : undefined;
  const qualityBlocked = !!source && source.quality !== 'fresh';
  const canReview = !state.workspace || state.workspace.permissions.includes('incident.review');
  const canApprove = !state.workspace || state.workspace.permissions.includes('incident.approve');
  return !calc ? (
    <Empty
      icon={<Layers3 size={32} />}
      title="An informed intervention"
      text="Decision options appear after a persistent incident is detected."
    />
  ) : (
    <>
      <div className="section-label">SHARED FACTS. COMPETING OBJECTIVES.</div>
      <h3 className="tab-heading">Choose your next move</h3>
      <p className="muted">Eight-hour comparison · configured assumptions</p>
      <div className="role-cards">
        {incident?.diagnosis?.roles.length ? (
          incident.diagnosis.roles.map((r) => (
            <div key={r.role}>
              <strong>{r.role}</strong>
              <p>{calc.options.find((o) => o.id === r.preferred_option)?.name}</p>
              <p>{r.explanation}</p>
              {incident.roles_calculation_version !== incident.calculation_version && (
                <small className="muted">Earlier comparison · explanation needs review</small>
              )}
            </div>
          ))
        ) : (
          <p className="muted">
            Role explanation unavailable; deterministic comparison remains available.
          </p>
        )}
      </div>
      <div className="decision-options">
        {calc.options.map((o) => (
          <button
            key={o.id}
            className={`decision-option ${(option || calc.recommended) === o.id ? 'selected' : ''}`}
            disabled={!o.feasible || !['awaiting_approval', 'approved'].includes(incident!.state)}
            onClick={() => setOption(o.id)}
          >
            <div>
              <span className="radio-dot" />
              <strong>{o.name}</strong>
              {o.id === calc.recommended && <span className="recommended">LOWEST COST</span>}
            </div>
            <div className="option-cost">
              {money(o.total_paise)}
              <small>expected configured cost</small>
            </div>
            <div className="option-detail">
              <span>{o.lost_units} shift output shortfall</span>
              <span>{Math.round(o.failure_probability * 100)}% assumed risk</span>
            </div>
            {o.constraint && <p>{o.constraint}</p>}
          </button>
        ))}
      </div>
      {chosen && (
        <div className="cost-breakdown">
          <div>
            <span>Planned repair</span>
            <strong>{money(chosen.repair_cost_paise)}</strong>
          </div>
          <div>
            <span>Lost contribution margin</span>
            <strong>{money(chosen.lost_margin_paise)}</strong>
          </div>
          <div>
            <span>Delivery penalties</span>
            <strong>{money(chosen.penalty_paise)}</strong>
          </div>
          <div>
            <span>Incremental failure exposure</span>
            <strong>{money(chosen.failure_exposure_paise)}</strong>
          </div>
        </div>
      )}
      <button className="text-button assumption-link" onClick={() => setAssumptions(true)}>
        Inspect assumptions & sensitivity
        <ArrowUpRight size={13} />
      </button>
      <label className="field-label">
        Risk assumption multiplier <span>{risk.toFixed(2)}×</span>
        <input
          aria-label="Risk assumption multiplier"
          type="range"
          min=".25"
          max="3"
          step=".25"
          value={risk}
          onChange={(e) => setRisk(Number(e.target.value))}
        />
      </label>
      <button
        className="secondary full"
        disabled={
          !canReview || busy || !['awaiting_approval', 'approved'].includes(incident!.state)
        }
        onClick={() => {
          setOption('');
          act('/calculate', { risk_multiplier: risk });
        }}
      >
        Recalculate · requires new approval
      </button>
      {dirty && (
        <>
          <p className="fine-print" role="alert">
            Unapplied risk changes. Recalculate or discard them before approval.
          </p>
          <button
            className="text-button full"
            disabled={busy}
            onClick={() => setRisk(calc.risk_multiplier)}
          >
            Discard changes
          </button>
        </>
      )}
      <label className="field-label">
        {state.workspace ? 'Authenticated approver' : 'Approver'}
        <input
          aria-label="Approver"
          value={state.workspace?.user.display_name || approver}
          readOnly={!!state.workspace}
          maxLength={80}
          onChange={(e) => setApprover(e.target.value)}
        />
      </label>
      <button
        className="primary full"
        onClick={approve}
        disabled={
          busy ||
          !canApprove ||
          qualityBlocked ||
          dirty ||
          !chosen?.feasible ||
          incident?.state !== 'awaiting_approval' ||
          approver.trim().length < 2
        }
      >
        <ShieldCheck size={15} />
        Approve selected intervention
      </button>
      <button
        className="text-button full"
        disabled={!canApprove || busy || incident?.state !== 'awaiting_approval'}
        onClick={() => act('/reject')}
      >
        Reject proposal
      </button>
      {incident?.state === 'proposal_rejected' && (
        <button
          className="secondary full"
          disabled={!canApprove || busy}
          onClick={() => act('/reopen')}
        >
          Reopen for review
        </button>
      )}
      <p className="fine-print">
        {qualityBlocked && (
          <span>{source?.reason}. Restore valid monitoring evidence before approval. </span>
        )}
        Human approval authorizes simulated work only. Financial risk is an assumption, not a
        predicted probability.
      </p>
    </>
  );
}
