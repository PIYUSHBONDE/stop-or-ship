'use client';

import { ArrowUpRight, FileText } from 'lucide-react';
import { evidenceKindNames, type EvidenceView } from '@/features/incidents/lib/evidence-view-model';
import styles from '@/features/incidents/components/evidence/evidence.module.css';

export type EvidenceCardProps = {
  evidence: EvidenceView;
  onOpen: (id: string) => void;
};

export function EvidenceCard({ evidence, onOpen }: EvidenceCardProps) {
  return (
    <button
      className={styles.card}
      onClick={() => onOpen(evidence.id)}
      aria-label={`Open ${evidence.title}`}
    >
      <span className={styles.cardTop}>
        <span className={styles.kind} data-kind={evidence.kind}>
          {evidenceKindNames[evidence.kind]}
        </span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </span>
      <span className={styles.title}>
        <FileText size={15} aria-hidden="true" />
        {evidence.title}
      </span>
      <span className={styles.section}>
        {evidence.section} · {evidence.version}
      </span>
      <span className={styles.summary}>{evidence.summary}</span>
      {evidence.values.slice(0, 2).map((value) => (
        <span className={styles.previewValue} key={value.label}>
          <span>{value.label}</span>
          <strong>
            {value.value} {value.unit}
          </strong>
        </span>
      ))}
    </button>
  );
}
