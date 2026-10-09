'use client';
import { usePlant } from '@/providers/plant-session-provider';
import { WorkspaceFrame } from '@/components/layout/workspace-frame';
import styles from '@/components/layout/workspace.module.css';
import { MemoryPanel } from './memory-panel';

export default function MemoryWorkspace() {
  const { state } = usePlant();
  if (!state) return null;
  return (
    <WorkspaceFrame
      plantName={state.plant.name}
      title="Reliability memory"
      description="Confirmed repairs retained with their evidence and corrections."
    >
      <section className={styles.editor}>
        <MemoryPanel state={state} />
      </section>
    </WorkspaceFrame>
  );
}
