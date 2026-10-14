'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import { usePreviewDispatchState } from '@/features/operators/lib/use-preview-dispatch';
import {
  OPERATORS,
  type FloorActor,
  type LiveAssignment,
} from '@/features/operators/lib/preview-dispatch';
import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';
import type { PreviewLedger } from '@/features/monitoring/lib/preview-records';
import type {
  ProcessState,
  SimulationCommand,
  processView,
} from '@/features/plant/lib/process-simulation';
import type { Asset } from '@/lib/types';

const EMPTY: Asset[] = [];

type PreviewDispatch = {
  process: ProcessState | null;
  view: ReturnType<typeof processView> | null;
  command: (command: SimulationCommand) => void;
  controlError: string;
  storageError: string;
  seed: number;
  tick: number;
  readings: Record<string, PreviewReading[]>;
  oocIds: string[];
  scannedId: string | null;
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  focusId: string | null;
  reduceMotion: boolean;
  assignments: LiveAssignment[];
  history: LiveAssignment[];
  actors: FloorActor[];
  operators: typeof OPERATORS;
  ledger: PreviewLedger;
};

const PreviewDispatchContext = createContext<PreviewDispatch | null>(null);

export function PreviewDispatchProvider({ children }: { children: ReactNode }) {
  const { state } = usePlant();
  return <PlantDispatch key={state?.plant.id || ''}>{children}</PlantDispatch>;
}

function PlantDispatch({ children }: { children: ReactNode }) {
  const { state } = usePlant();
  const dispatch = usePreviewDispatchState(
    {
      assets: state?.assets ?? EMPTY,
      areas: state?.areas ?? [],
      dependencies: state?.dependencies ?? [],
    },
    state?.plant.id ?? '',
  );
  return (
    <PreviewDispatchContext.Provider value={{ ...dispatch, operators: OPERATORS }}>
      {children}
    </PreviewDispatchContext.Provider>
  );
}

export function usePreviewDispatch() {
  const value = useContext(PreviewDispatchContext);
  if (!value) throw new Error('Operator dispatch requires PreviewDispatchProvider');
  return value;
}
