'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { WorkspaceFrame } from '@/components/layout/workspace-frame';
import styles from '@/components/layout/workspace.module.css';
import { PlantGuideBoard } from '@/features/memory/components/plant-guide-board';
import { MemoryPanel } from './memory-panel';

export default function MemoryWorkspace() {
  const { state } = usePlant();
  const [query, setQuery] = useState('');
  if (!state) return null;
  return (
    <WorkspaceFrame
      plantName={state.plant.name}
      title="Plant guide"
      description="Every machine address, what can break, what can be fixed, and the station user guide."
    >
      <label className={styles.search}>
        <Search size={17} />
        <input
          aria-label="Search plant guides"
          placeholder="Find a machine, area or type…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <PlantGuideBoard query={query} />
      <section className={styles.editor}>
        <MemoryPanel state={state} />
      </section>
    </WorkspaceFrame>
  );
}
