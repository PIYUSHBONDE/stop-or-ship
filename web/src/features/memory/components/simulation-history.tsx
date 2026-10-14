'use client';

import Link from 'next/link';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import styles from '@/features/incidents/components/case-journey.module.css';

export function SimulationHistory() {
  const { ledger } = usePreviewDispatch();
  const cases = ledger.cases.filter((c) => c.clearedAt && !c.interrupted).slice(0, 10);
  return (
    <section className={styles.section} aria-label="Simulation history">
      <h3>Scenario history</h3>
      <p>
        Browser-local simulated outcomes. Timer completion does not confirm a physical cause or
        qualify as verified repair memory.
      </p>
      {cases.length ? (
        cases.map((c) => (
          <p key={c.id}>
            <Link href={`/incidents?case=${encodeURIComponent(c.id)}`}>
              {c.assetId} · {c.id}
            </Link>{' '}
            · {c.signalId.replaceAll('_', ' ')} {c.value} {c.unit} at detection · scenario recovered
          </p>
        ))
      ) : (
        <p>No completed scenario is retained yet.</p>
      )}
    </section>
  );
}
