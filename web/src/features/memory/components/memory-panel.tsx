'use client';
import { Cpu, ShieldCheck } from 'lucide-react';
import type { State } from '@/lib/types';
import { Empty } from '@/components/ui/dashboard-primitives';

type Props = { state: State };
export function MemoryPanel({ state }: Props) {
  return (
    <>
      <div className="section-label">VERIFIED RELIABILITY MEMORY</div>
      <h3 className="tab-heading">Confirmed repairs, reusable evidence</h3>
      <p className="muted">
        Only recovery established from post-repair operational observations enters confirmed memory.
        The original diagnosis and technician correction remain traceable.
      </p>
      {state.memory.length === 0 ? (
        <Empty
          icon={<Cpu size={32} />}
          title="Knowledge starts with proof"
          text="A technician's note enters confirmed memory only after telemetry verifies recovery."
        />
      ) : (
        state.memory.map((repair) => (
          <div className="memory-card" key={repair.id}>
            <span className="verified-label">
              <ShieldCheck size={13} /> VERIFIED FROM OPERATIONAL OBSERVATIONS
            </span>
            <h3>{repair.observed_cause}</h3>
            <p>{repair.fix}</p>
            <dl>
              <dt>Equipment</dt>
              <dd>{repair.asset_id}</dd>
              <dt>Original AI hypothesis</dt>
              <dd>{repair.original_diagnosis?.hypotheses[0]?.cause || 'Not available'}</dd>
              <dt>Technician confirmed</dt>
              <dd>{repair.observed_cause}</dd>
              <dt>Outcome</dt>
              <dd>{repair.outcome}</dd>
              <dt>Verified</dt>
              <dd>{repair.verified_at}</dd>
            </dl>
          </div>
        ))
      )}
    </>
  );
}
