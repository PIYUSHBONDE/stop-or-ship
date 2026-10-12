import { Suspense } from 'react';
import { OperatorsWorkspace } from '@/features/operators/components/operators-workspace';

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading operators…</p>}>
      <OperatorsWorkspace />
    </Suspense>
  );
}
