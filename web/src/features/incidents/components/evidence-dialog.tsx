import { X } from 'lucide-react';
import Modal from '@/components/ui/modal';
import type { Calculation, Evidence } from '@/lib/types';

type Props = {
  evidence: Evidence | null;
  assumptions: boolean;
  calc?: Calculation;
  onClose: () => void;
};

export default function EvidenceDialog({ evidence, assumptions, calc, onClose }: Props) {
  if (!evidence && !assumptions) return null;
  return (
    <Modal title={evidence ? 'Evidence source' : 'Economic assumptions'} onClose={onClose}>
      <section className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
        {evidence ? (
          <>
            <span className="eyebrow">EVIDENCE RECORD · {evidence.id}</span>
            <h2>{evidence.source}</h2>
            <p className="muted">
              {evidence.section} · version {evidence.version}
            </p>
            <div className="context-note">
              <p>{evidence.provenance}</p>
            </div>
            <pre className="evidence-text">{evidence.text}</pre>
            <p className="fine-print">
              Citation existence is checked automatically. Claim support requires evaluation; this
              source is not marked as human-reviewed.
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">TRANSPARENT ECONOMICS</span>
            <h2>Assumptions behind the decision</h2>
            <p className="muted">
              All options use an eight-hour horizon and configured synthetic operational inputs.
            </p>
            <div className="assumptions-table">
              {Object.entries(calc?.assumptions || {}).map(([k, v]) => (
                <div key={k}>
                  <span>{k.replaceAll('_', ' ')}</span>
                  <strong>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</strong>
                </div>
              ))}
            </div>
            <p className="fine-print">
              Currency inputs are integer paise. Lost contribution margin, planned penalties, and
              incremental failure exposure are counted separately. Failure probabilities are
              assumptions.
            </p>
            <div className="section-label">SENSITIVITY</div>
            {calc?.sensitivity.map((s) => (
              <p key={s.multiplier}>
                {s.multiplier}× risk → {calc.options.find((o) => o.id === s.recommended)?.name}
              </p>
            ))}
          </>
        )}
      </section>
    </Modal>
  );
}
