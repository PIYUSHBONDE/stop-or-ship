'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  FileText,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { usePlant } from '@/components/session-provider';
import { stateNames } from '@/components/workflow/shared';
import { toEvidenceView } from '@/lib/incident-view-model';
import type { Incident, State } from '@/lib/types';
import { EvidenceCard } from './evidence/evidence-card';
import { EvidenceDetailsDialog } from './evidence/evidence-details-dialog';
import { DependencyImpact } from './dependency-impact';
import { IncidentDecision } from './incident-decision';
import styles from './incidents.module.css';

function IncidentDetail({
  state,
  incident,
  readOnly,
}: {
  state: State;
  incident: Incident;
  readOnly: boolean;
}) {
  const { busy: saving, connected, actForIncident, selectAsset, can } = usePlant();
  const busy = saving || !can('incident.review');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const contextState = incident.plant_context
    ? {
        ...state,
        areas: incident.plant_context.areas,
        assets: incident.plant_context.assets,
        dependencies: incident.plant_context.dependencies,
      }
    : state;
  const asset = contextState.assets.find((candidate) => candidate.id === incident.asset_id);
  const evidence = incident.evidence.map(toEvidenceView);
  const source = evidence.find((candidate) => candidate.id === sourceId) || null;
  const pending = ['detected', 'investigating'].includes(incident.state);

  function compareInterventions() {
    document.getElementById('decision-heading')?.focus({ preventScroll: true });
    document.getElementById('decision-section')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  function citation(id: string, conflicting = false) {
    const record = evidence.find((candidate) => candidate.id === id);
    return (
      <button
        key={`${conflicting ? 'conflict' : 'support'}-${id}`}
        className={styles.citation}
        disabled={!record}
        onClick={() => setSourceId(id)}
      >
        {conflicting
          ? 'Conflicting evidence'
          : record?.kind === 'measured' || record?.kind === 'mixed'
            ? 'Telemetry'
            : record?.kind === 'verified'
              ? 'Verified repair'
              : record?.title || 'Source unavailable'}
        <ArrowRight size={11} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={styles.detail}>
      <header className={styles.caseHeader}>
        <div>
          <span className={styles.eyebrow}>INCIDENT {incident.id.slice(0, 8).toUpperCase()}</span>
          <h2>
            {incident.asset_id} · {asset?.name || 'Equipment deviation'}
          </h2>
          <p>{asset?.purpose}</p>
          {incident.plant_configuration_version && (
            <p>
              Plant configuration v{incident.plant_configuration_version} · recorded incident
              context
            </p>
          )}
        </div>
        <div className={styles.caseActions}>
          <span className={styles.status} data-state={incident.state}>
            {stateNames[incident.state] || incident.state.replaceAll('_', ' ')}
          </span>
          <button className="primary" onClick={compareInterventions}>
            Compare interventions
            <ArrowRight size={15} />
          </button>
          <Link
            href={state.workspace ? `/plant?incident=${incident.id}` : '/plant'}
            onClick={() => selectAsset(incident.asset_id)}
          >
            View equipment in Plant
            <ArrowRight size={13} />
          </Link>
        </div>
      </header>
      <div className={styles.caseFacts}>
        <span>
          <Clock3 size={14} />
          Detected{' '}
          {new Date(incident.created_at).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span>
          {incident.affected_lines
            .map((line) => contextState.areas.find((area) => area.id === line)?.name || line)
            .join(' + ')}{' '}
          affected
        </span>
        <span>
          {incident.severity === 'critical' ? 'Critical deviation' : 'Persistent deviation'}
        </span>
        <span>{incident.provider || 'Investigation queued'}</span>
      </div>
      {readOnly && (
        <p className={styles.readOnly}>
          Archived incident · its evidence and comparison are read-only.
        </p>
      )}
      <section className={styles.section} aria-labelledby="investigation-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>01 / INVESTIGATION</span>
            <h2 id="investigation-heading">What does the evidence explain?</h2>
          </div>
          <span className={styles.meta}>{incident.evidence.length} sources collected</span>
        </div>
        <details className={styles.progress} open={pending}>
          <summary>Evidence collection progress</summary>
          {incident.progress.map((entry, index) => (
            <p key={`${entry.at}-${index}`}>
              {entry.status === 'running' ? (
                <LoaderCircle className="spin" size={13} />
              ) : entry.status === 'unavailable' ? (
                <TriangleAlert size={13} />
              ) : (
                <Check size={13} />
              )}
              {entry.message}
            </p>
          ))}
        </details>
        {pending && (
          <div className={styles.emptyInline} role="status">
            <LoaderCircle className="spin" size={22} />
            <div>
              <strong>Investigation in progress</strong>
              <p>Collected evidence stays available as the investigation proceeds.</p>
            </div>
          </div>
        )}
        {incident.error && (
          <div className={styles.warning}>
            <TriangleAlert size={18} />
            <div>
              <strong>Investigation needs attention</strong>
              <p>{incident.error}</p>
            </div>
          </div>
        )}
        {!readOnly && incident.state === 'investigation_failed' && (
          <div className={styles.retry}>
            <button
              className="secondary"
              disabled={busy || !connected || incident.attempts >= 2}
              onClick={() => actForIncident(incident.id, '/investigation/retry')}
            >
              Retry investigation
            </button>
            <p className={styles.note}>
              {incident.attempts >= 2
                ? 'Retry allowance exhausted. Collected evidence remains available.'
                : 'A bounded retry will use the evidence already collected.'}
            </p>
          </div>
        )}
        {incident.diagnosis && (
          <>
            <div className={styles.finding}>
              <span className={styles.eyebrow}>INVESTIGATION SUMMARY</span>
              <p>{incident.diagnosis.summary}</p>
            </div>
            <div className={styles.hypotheses}>
              {incident.diagnosis.hypotheses.map((hypothesis, index) => (
                <article className={styles.hypothesis} key={hypothesis.cause}>
                  <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <div className={styles.hypothesisHeading}>
                      <h3>{hypothesis.cause}</h3>
                      <span>{hypothesis.confidence} confidence</span>
                    </div>
                    <div className={styles.citations}>
                      {hypothesis.supporting_evidence.map((id) => citation(id))}
                    </div>
                    {hypothesis.conflicting_evidence.length > 0 && (
                      <div className={styles.conflicts}>
                        <span>Conflicting evidence</span>
                        <div className={styles.citations}>
                          {hypothesis.conflicting_evidence.map((id) => citation(id, true))}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {incident.diagnosis.missing_information.length > 0 && (
              <div className={styles.missing}>
                <CircleHelp size={19} />
                <div>
                  <h3>What would improve certainty?</h3>
                  <ul>
                    {incident.diagnosis.missing_information.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
        <div className={styles.subheading}>
          <h3>Production impact</h3>
          <span className={styles.meta}>Synthetic plant configuration</span>
        </div>
        <DependencyImpact state={contextState} assetId={incident.asset_id} />
        <details className={styles.evidenceLibrary}>
          <summary>Browse all {evidence.length} saved evidence records</summary>
          <div className={styles.evidenceGrid}>
            {evidence.map((record) => (
              <EvidenceCard key={record.id} evidence={record} onOpen={setSourceId} />
            ))}
          </div>
        </details>
        {!evidence.length && <p className={styles.note}>No evidence has been collected yet.</p>}
      </section>
      <IncidentDecision incident={incident} readOnly={readOnly} />
      {incident.decision_changes.length > 0 && (
        <details className={styles.audit}>
          <summary>Decision revision history · {incident.decision_changes.length} changes</summary>
          {incident.decision_changes.map((change) => (
            <p key={change.calculation_version}>
              {change.reason}
              <small>{new Date(change.at).toLocaleString('en-IN')}</small>
            </p>
          ))}
        </details>
      )}
      <EvidenceDetailsDialog evidence={source} onClose={() => setSourceId(null)} />
    </div>
  );
}

export default function IncidentWorkspace() {
  const { state } = usePlant();
  const query = useSearchParams();
  const router = useRouter();
  const requested = query.get('incident');
  const fallback = state?.incident || state?.incidents.at(-1);
  const selectedId = requested || fallback?.id;
  const incident = state?.incidents.find((candidate) => candidate.id === selectedId);
  useEffect(() => {
    if (!requested && fallback)
      router.replace(`/incidents?incident=${fallback.id}`, { scroll: false });
  }, [requested, fallback, router]);
  if (!state) return null;
  const open = state.incidents.filter((candidate) => candidate.state !== 'resolved').length;
  return (
    <div className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>{state.plant.name.toUpperCase()} / RELIABILITY</span>
          <h1>Incidents</h1>
          <p>Understand the evidence. Choose an intervention. Keep human control.</p>
        </div>
        <div className={styles.counts}>
          <strong>{open}</strong>
          <span>
            open incident{open === 1 ? '' : 's'}
            <small>
              {state.incidents.filter((candidate) => candidate.state === 'resolved').length}{' '}
              verified resolutions
            </small>
          </span>
        </div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.caseList} aria-label="Incident list">
          <div className={styles.listHeading}>
            <FileText size={15} />
            <h2>Cases</h2>
            <span>{state.incidents.length}</span>
          </div>
          {state.incidents
            .slice()
            .reverse()
            .map((candidate) => (
              <Link
                key={candidate.id}
                href={`/incidents?incident=${candidate.id}`}
                className={styles.caseLink}
                aria-current={candidate.id === selectedId ? 'page' : undefined}
              >
                <span className={styles.caseLinkTop}>
                  <strong>{candidate.asset_id}</strong>
                  <span className={styles.caseDot} data-state={candidate.state} />
                </span>
                <span>{state.assets.find((asset) => asset.id === candidate.asset_id)?.name}</span>
                <small>{stateNames[candidate.state]}</small>
                <small>
                  {candidate.id.slice(0, 8).toUpperCase()} ·{' '}
                  {new Date(candidate.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </small>
              </Link>
            ))}
          {!state.incidents.length && (
            <p className={styles.note}>Detected incidents appear here automatically.</p>
          )}
          <Link className={styles.plantLink} href="/plant">
            Open simulated plant
            <ArrowRight size={13} />
          </Link>
        </aside>
        {incident ? (
          <IncidentDetail
            key={`${state.generation}-${incident.id}`}
            state={state}
            incident={incident}
            readOnly={incident.id !== state.incident?.id || incident.state === 'resolved'}
          />
        ) : (
          <section className={styles.empty}>
            <ShieldCheck size={36} />
            <h2>
              {requested ? 'Incident unavailable' : 'Your next investigation starts in the plant'}
            </h2>
            <p>
              {requested
                ? 'This incident is not available in your current session. Choose a case from the list.'
                : 'Start a replay scenario in Plant. A persistent deviation creates an incident with evidence and intervention options.'}
            </p>
            <Link className="primary" href="/plant">
              Open Plant
              <ArrowRight size={14} />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
