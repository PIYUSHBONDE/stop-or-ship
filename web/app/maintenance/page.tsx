import { Suspense } from 'react';
import MaintenanceWorkspace from '@/components/maintenance-workspace';
export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading maintenance…</p>}>
      <MaintenanceWorkspace />
    </Suspense>
  );
}
