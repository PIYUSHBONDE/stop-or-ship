'use client';

import { useState } from 'react';
import { evidenceFixtures } from '@/lib/evidence-fixtures';
import { EvidenceCard } from './evidence/evidence-card';
import { EvidenceDetailsDialog } from './evidence/evidence-details-dialog';
import styles from './evidence-preview.module.css';

export default function EvidencePreview() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <main className={styles.preview}>
      <header>
        <span>PLANTSENSE / COMPONENT WORKSHOP</span>
        <h1>Evidence component workshop</h1>
        <p>
          All records below are synthetic UI fixtures. Source labels illustrate presentation
          categories; they do not claim real measurements or repairs. This workshop needs no API,
          identity, or dataset.
        </p>
      </header>
      <div className={styles.grid}>
        {evidenceFixtures.map((evidence) => (
          <EvidenceCard key={evidence.id} evidence={evidence} onOpen={setSelected} />
        ))}
      </div>
      <EvidenceDetailsDialog
        evidence={evidenceFixtures.find((item) => item.id === selected) || null}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
