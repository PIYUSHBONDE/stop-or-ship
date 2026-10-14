'use client';

import { useSearchParams } from 'next/navigation';
import { ObservationWorkspace } from './observation-workspace';
import { SimulationWorkspace } from './simulation-workspace';

export function FactoryWorkspace() {
  return useSearchParams().get('view') === 'observations' ? (
    <ObservationWorkspace />
  ) : (
    <SimulationWorkspace />
  );
}
