'use client';
import { ArrowRight, Check, FileCheck2, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { State } from '@/lib/types';
import type { CommandBodies } from '@/lib/api';
import { money } from '@/lib/api';
import { Empty } from '../dashboard-primitives';
import { stateNames, type Tab, type SessionActions } from './shared';
type Props = SessionActions & {
  state: State;
  cause: string;
  setCause: (value: string) => void;
  fix: string;
  setFix: (value: string) => void;
  parts: string;
  setParts: (value: string) => void;
  outcome: string;
  setOutcome: (value: string) => void;
  recovery: CommandBodies['/repair/complete']['recovery'];
  setRecovery: (value: CommandBodies['/repair/complete']['recovery']) => void;
  setTab: (tab: Tab) => void;
};
export function WorkOrderPanel({
  state,
  busy: saving,
  act,
  cause,
  setCause,
  fix,
  setFix,
  parts,
  setParts,
  outcome,
  setOutcome,
  recovery,
  setRecovery,
  setTab,
}: Props) {
  const incident = state.incident;
  const busy =
    saving || (!!state.workspace && !state.workspace.permissions.includes('repair.write'));
  const isResolved = incident?.state === 'resolved';
  const source = state.monitoring?.enabled
    ? state.monitoring.health.find((item) => item.asset_id === incident?.asset_id)
    : undefined;
  const qualityBlocked = !!source && source.quality !== 'fresh';
  const delay = incident?.work_order
    ? { stop: 0, derate: 180, defer: 180, continue: 480 }[
        incident.work_order.approval.option_id as 'stop' | 'derate' | 'defer' | 'continue'
      ]
    : 0;
  const dueTick =
    state.monitoring?.enabled && incident?.work_order?.approved_tick != null
      ? incident.work_order.approved_tick + delay
      : null;
  const waiting = dueTick !== null && (state.monitoring?.tick ?? -1) < dueTick;
  return !incident?.work_order ? (
    <Empty
      icon={<FileCheck2 size={32} />}
      title="Human control, by design"
      text="An approved intervention creates a structured work order. No action is issued before approval."
    />
  ) : (
    <>
      <span className="eyebrow">{incident.work_order.id}</span>
      <h3 className="tab-heading">{incident.work_order.option.name}</h3>
      <div className="work-order-meta">
        <span>
          Approved by <strong>{incident.work_order.approval.approver}</strong>
        </span>
        <span>
          State <strong>{stateNames[incident.state]}</strong>
        </span>
        <span>
          Expected option cost <strong>{money(incident.work_order.option.total_paise)}</strong>
        </span>
      </div>
      <div className="context-note">
        <ShieldCheck size={16} />
        <p>{incident.work_order.procedure}</p>
      </div>
      {incident.state === 'approved' && (
        <button
          className="primary full"
          disabled={busy || qualityBlocked || waiting}
          onClick={() => act('/repair/start')}
        >
          Start approved repair
          <ArrowRight size={14} />
        </button>
      )}
      {incident.state === 'approved' && qualityBlocked && (
        <p className="context-note">
          {source?.reason}. Fresh monitoring evidence is required to start repair.
        </p>
      )}
      {incident.state === 'approved' && waiting && (
        <p className="context-note">
          The approved maintenance window begins at plant tick {dueTick}. Advance the shared clock
          in Monitoring.
        </p>
      )}
      {incident.state === 'repairing' && (
        <>
          <div className="section-label">TECHNICIAN OUTCOME · SIMULATED</div>
          <label className="field-label">
            Observed root cause
            <input
              aria-label="Observed root cause"
              disabled={busy}
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="field-label">
            Repair performed
            <textarea
              aria-label="Repair performed"
              disabled={busy}
              value={fix}
              onChange={(e) => setFix(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label className="field-label">
            Parts used
            <input
              aria-label="Parts used"
              disabled={busy}
              value={parts}
              onChange={(e) => setParts(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="field-label">
            Observed outcome
            <textarea
              aria-label="Observed outcome"
              disabled={busy}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="field-label">
            Simulated post-repair telemetry
            <select
              aria-label="Post-repair telemetry"
              disabled={busy}
              value={recovery}
              onChange={(e) =>
                setRecovery(e.target.value as CommandBodies['/repair/complete']['recovery'])
              }
            >
              <option value="healthy">Recovery to healthy operating envelope</option>
              <option value="failed">Fault persists · test failed verification</option>
            </select>
          </label>
          <button
            className="primary full"
            disabled={
              busy || cause.trim().length < 3 || fix.trim().length < 3 || outcome.trim().length < 3
            }
            onClick={() =>
              act('/repair/complete', {
                observed_cause: cause,
                fix,
                parts,
                outcome,
                recovery,
              })
            }
          >
            Complete repair & verify
            <Check size={15} />
          </button>
        </>
      )}
      {incident.state === 'verifying' && (
        <div className="verification">
          <LoaderCircle className="spin" size={27} />
          <h3>Checking recovery</h3>
          <p>{incident.verification_windows} / 3 consecutive healthy windows</p>
          <div className="verification-bars">
            {[1, 2, 3].map((n) => (
              <span key={n} className={incident.verification_windows >= n ? 'complete' : ''} />
            ))}
          </div>
          {incident.verification_message && (
            <p className="warning-text">{incident.verification_message}</p>
          )}
          <p className="muted">Work completion alone does not confirm recovery.</p>
          {incident.verification_message && (
            <button
              className="secondary full"
              disabled={busy}
              onClick={() => act('/repair/reopen')}
            >
              Continue approved repair
            </button>
          )}
        </div>
      )}
      {isResolved && (
        <div className="verification success">
          <ShieldCheck size={32} />
          <h3>Recovery verified</h3>
          <p>Three healthy telemetry windows confirmed.</p>
          <button className="primary full" onClick={() => setTab('Memory')}>
            View confirmed repair
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </>
  );
}
