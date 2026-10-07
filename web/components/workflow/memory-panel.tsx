'use client';
import { ArrowRight, Cpu, ShieldCheck } from 'lucide-react';
import type { State } from '@/lib/types';
import type { CommandBodies } from '@/lib/api';
import { Empty } from '../dashboard-primitives';
import { type Tab, type SessionActions } from './shared';
type Props = SessionActions & {
  state: State;
  setTab: (tab: Tab) => void;
  setOption: (value: CommandBodies['/approve']['option_id'] | '') => void;
};
export function MemoryPanel({ state, busy, act, setTab, setOption }: Props) {
  const isResolved = state.incident?.state === 'resolved';
  return (
    <>
      <div className="section-label">VERIFIED RELIABILITY MEMORY</div>
      <h3 className="tab-heading">Make the next repair smarter</h3>
      <p className="muted">
        Confirmed outcomes are reusable evidence. This is retrieval memory, not online model
        retraining.
      </p>
      {state.memory.length === 0 ? (
        <Empty
          icon={<Cpu size={32} />}
          title="Knowledge starts with proof"
          text="A technician's note enters confirmed memory only after telemetry verifies recovery."
        />
      ) : (
        state.memory.map((c) => (
          <div className="memory-card" key={c.id}>
            <span className="verified-label">
              <ShieldCheck size={13} />
              VERIFIED IN SIMULATION
            </span>
            <h3>{c.observed_cause}</h3>
            <p>{c.fix}</p>
            <dl>
              <dt>Original AI hypothesis</dt>
              <dd>{c.original_diagnosis?.hypotheses[0]?.cause || 'Not available'}</dd>
              <dt>Technician confirmed</dt>
              <dd>{c.observed_cause}</dd>
              <dt>Outcome</dt>
              <dd>{c.outcome}</dd>
            </dl>
          </div>
        ))
      )}
      {state.memory.length > 0 && (
        <button
          className="primary full"
          disabled={busy || !isResolved}
          onClick={() => {
            setTab('Investigation');
            setOption('');
            act('/scenarios', { scenario: 'memory_recurrence' });
          }}
        >
          Replay a similar incident
          <ArrowRight size={14} />
        </button>
      )}
    </>
  );
}
