'use client';

import { useState } from 'react';
import type { State, Incident } from '@/lib/types';
import EvidenceDialog from './evidence-dialog';
import type { Evidence } from '@/lib/types';

export function IncidentHistory({ state }: { state: State }) {
  const [archive, setArchive] = useState<Incident | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const past = state.incidents.filter((i) => i.id !== state.incident?.id);
  if (!past.length) return null;
  return (
    <section className="case-history panel">
      <h2>Previous incidents</h2>
      <div className="case-history-list">
        {past.map((i) => (
          <button key={i.id} className="secondary" onClick={() => setArchive(i)}>
            {i.asset_id} · {i.state.replaceAll('_', ' ')} · {i.id.slice(0, 8)}
          </button>
        ))}
      </div>
      {archive && (
        <div className="archived-incident">
          <h3>{archive.asset_id} · archived case</h3>
          <p>{archive.diagnosis?.summary || 'Investigation unavailable'}</p>
          <p className="muted">
            Read-only historical evidence. Actions apply only to the active incident.
          </p>
          {archive.evidence.map((e) => (
            <button key={e.id} className="citation" onClick={() => setEvidence(e)}>
              {e.source}
            </button>
          ))}
          <button className="text-button" onClick={() => setArchive(null)}>
            Close archived case
          </button>
        </div>
      )}
      <EvidenceDialog evidence={evidence} assumptions={false} onClose={() => setEvidence(null)} />
    </section>
  );
}
