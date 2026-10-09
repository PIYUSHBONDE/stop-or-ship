import { Suspense } from 'react';
import IncidentWorkspace from '@/features/incidents/components/incident-workspace';
export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading incident workspace…</p>}>
      <IncidentWorkspace />
    </Suspense>
  );
}
