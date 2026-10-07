'use client';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { State, Evidence } from '@/lib/types';
import { stateNames, type Tab, type SessionActions } from './shared';
type Props = SessionActions & {
  state: State;
  setEvidence: (value: Evidence | null) => void;
  setTab: (tab: Tab) => void;
};
export function InvestigationPanel({ state, busy, act, setEvidence, setTab }: Props) {
  const incident = state.incident;
  const isResolved = incident?.state === 'resolved';
  return (
    <>
      {!incident ? (
        <div className="empty-state">
          <div className="empty-icon">
            <ShieldCheck size={36} />
          </div>
          <h3>Your plant is in view.</h3>
          <p>
            Start a scenario. PlantSense will detect a persistent change and investigate it
            automatically.
          </p>
          <div className="flow-preview">
            <span>Detect</span>
            <ArrowRight size={12} />
            <span>Investigate</span>
            <ArrowRight size={12} />
            <span>Decide</span>
          </div>
          <div className="context-note">
            <Activity size={16} />
            <p>
              Whole-plant state and dependency effects are simulated. Measured pump replay is
              attributed separately.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="incident-heading">
            <span className="eyebrow">INCIDENT · {incident.id.slice(0, 8).toUpperCase()}</span>
            <span className={`status-badge ${isResolved ? 'healthy' : 'degrading'}`}>
              {stateNames[incident.state]}
            </span>
            <h3>{incident.asset_id} · equipment deviation</h3>
            <p>
              {incident.affected_lines.join(', ')} · {state.affected.length} downstream assets
            </p>
          </div>
          <div className="investigation-steps">
            {incident.progress.map((p, i) => (
              <div key={p.at + i}>
                {p.status === 'running' ? (
                  <LoaderCircle size={13} className="spin" />
                ) : p.status === 'unavailable' ? (
                  <TriangleAlert size={13} />
                ) : (
                  <Check size={13} />
                )}
                <span>{p.message}</span>
              </div>
            ))}
            {['detected', 'investigating'].includes(incident.state) && (
              <div>
                <LoaderCircle size={14} className="spin" />
                <span>Gathering evidence…</span>
              </div>
            )}
          </div>
          {incident.error && (
            <div className="context-note warning">
              <TriangleAlert size={15} />
              <p>{incident.error}</p>
            </div>
          )}
          {incident.state === 'investigation_failed' && (
            <button
              className="secondary"
              disabled={busy || incident.attempts >= 2}
              onClick={() => act('/investigation/retry')}
            >
              Retry investigation
            </button>
          )}
          {incident.diagnosis && (
            <>
              <div className="section-label">
                <Sparkles size={13} />
                INVESTIGATION SUMMARY
              </div>
              <p className="diagnosis-summary">{incident.diagnosis.summary}</p>
              <div className="provider-label">{incident.provider}</div>
              <div className="section-label">RANKED HYPOTHESES</div>
              {incident.diagnosis.hypotheses.map((h, i) => (
                <div className="hypothesis" key={h.cause}>
                  <span className="rank">0{i + 1}</span>
                  <div>
                    <strong>{h.cause}</strong>
                    <span className="confidence">{h.confidence} confidence</span>
                    <div className="citation-pills">
                      {h.supporting_evidence.map((id) => (
                        <button
                          key={id}
                          onClick={() =>
                            setEvidence(incident.evidence.find((e) => e.id === id) || null)
                          }
                        >
                          {id.startsWith('case-')
                            ? 'Verified repair'
                            : id === 'telemetry-current'
                              ? 'Telemetry'
                              : 'Source'}
                          <ArrowUpRight size={10} />
                        </button>
                      ))}
                      {h.conflicting_evidence.map((id) => (
                        <button
                          key={'conflict-' + id}
                          onClick={() =>
                            setEvidence(incident.evidence.find((e) => e.id === id) || null)
                          }
                        >
                          Conflicting evidence <ArrowUpRight size={10} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              <div className="context-note warning">
                <CircleHelp size={16} />
                <div>
                  <strong>What would improve certainty?</strong>
                  {incident.diagnosis.missing_information.map((m) => (
                    <p key={m}>{m}</p>
                  ))}
                </div>
              </div>
              <div className="section-label">PLANT IMPACT</div>
              <div className="impact-path">
                {[incident.asset_id, ...state.affected].map((id, i) => (
                  <span key={id}>
                    {i > 0 && <ArrowRight size={12} />}
                    {id}
                  </span>
                ))}
              </div>
              <p className="muted">
                Affected production follows the configured dependency graph. Consequences use the
                configured dependency model.
              </p>
              <button className="primary full" onClick={() => setTab('Decision')}>
                Compare interventions
                <ArrowRight size={15} />
              </button>
              <details className="all-evidence">
                <summary>Inspect all {incident.evidence.length} evidence records</summary>
                {incident.evidence.map((e) => (
                  <button key={e.id} onClick={() => setEvidence(e)}>
                    {e.source}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </details>
            </>
          )}
        </>
      )}
    </>
  );
}
