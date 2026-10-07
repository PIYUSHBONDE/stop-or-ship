'use client';

import { X } from 'lucide-react';
import Modal from '@/components/modal';
import { evidenceKindNames, type EvidenceView } from '@/lib/incident-view-model';
import styles from './evidence.module.css';

export type EvidenceDetailsDialogProps = {
  evidence: EvidenceView | null;
  onClose: () => void;
};

export function EvidenceDetailsDialog({ evidence, onClose }: EvidenceDetailsDialogProps) {
  if (!evidence) return null;
  return (
    <Modal title={`Evidence: ${evidence.title}`} onClose={onClose}>
      <section className={styles.dialog}>
        <button
          className="modal-close icon-button"
          aria-label="Close evidence details"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className={styles.kind} data-kind={evidence.kind}>
          {evidenceKindNames[evidence.kind]}
        </span>
        <h2>{evidence.title}</h2>
        <p className={styles.section}>
          {evidence.section} · {evidence.version}
        </p>
        <p className={styles.summary}>{evidence.summary}</p>
        <dl className={styles.metadata}>
          <div>
            <dt>Source provenance</dt>
            <dd>{evidence.provenance}</dd>
          </div>
          <div>
            <dt>Reference ID</dt>
            <dd>{evidence.id}</dd>
          </div>
        </dl>
        {evidence.values.length > 0 && (
          <div className={styles.values}>
            {evidence.values.map((value) => (
              <div key={value.label} className={styles.value}>
                <h3>{value.label}</h3>
                <strong>
                  {value.value} <small>{value.unit}</small>
                </strong>
                {value.baseline !== undefined && (
                  <p>
                    Healthy baseline: {value.baseline} {value.unit}
                  </p>
                )}
                {value.deviation !== undefined && <p>Deviation: {value.deviation}</p>}
                {value.source && <p>{value.source}</p>}
              </div>
            ))}
          </div>
        )}
        {evidence.values.length === 0 ? (
          <p className={styles.excerpt}>
            {evidence.excerpt.trim() || 'No source excerpt was provided.'}
          </p>
        ) : (
          <details className={styles.original}>
            <summary>Original source excerpt</summary>
            <pre>{evidence.excerpt}</pre>
          </details>
        )}
      </section>
    </Modal>
  );
}
