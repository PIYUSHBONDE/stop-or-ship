'use client';

import Link from 'next/link';
import { Layers, Radio, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import styles from './frame-status.module.css';

export function FrameStatus({
  operational,
  simulation,
  expanded = false,
}: {
  operational: boolean;
  simulation: boolean;
  expanded?: boolean;
}) {
  const { state, connected } = usePlant();
  const provenance = useRef<HTMLDetailsElement>(null);
  const account = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      for (const menu of [provenance.current, account.current]) {
        if (!menu?.open) continue;
        if (event instanceof KeyboardEvent) {
          if (event.key === 'Escape') {
            event.preventDefault();
            menu.open = false;
            menu.querySelector('summary')?.focus();
          }
        } else if (!menu.contains(event.target as Node)) menu.open = false;
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);
  if (!state) return null;
  const sources =
    state.sources?.filter((source) => source.configuration.kind === 'operational') ?? [];
  const fresh = sources.some((source) => source.quality === 'fresh');
  const status = !connected
    ? 'Operational status unavailable'
    : fresh
      ? 'Operational observations'
      : sources.length
        ? 'No fresh operational data'
        : 'No operational data';
  const mode = operational
    ? 'Reviewed observations'
    : simulation
      ? 'Simulated plant'
      : 'Plant records';
  return (
    <div className={styles.status} data-expanded={expanded}>
      <details ref={provenance} className={styles.menu} data-sidebar-menu>
        <summary role="button" aria-label={`Data provenance: ${status}`} title={status}>
          <span className={styles.dataMark}>
            <Layers size={19} />
            <i data-health={!connected ? 'offline' : fresh ? 'fresh' : 'unknown'} />
          </span>
          <span className={styles.sourceLabel}>
            {expanded
              ? 'Plant data'
              : !connected
                ? 'Offline'
                : fresh
                  ? 'Live data'
                  : sources.length
                    ? 'Stale data'
                    : 'No feed'}
            <small>{status}</small>
          </span>
        </summary>
        <section className={styles.popover} aria-label="Data provenance">
          <header>
            <h2>Data provenance</h2>
            <button
              aria-label="Close data provenance"
              onClick={() => {
                if (provenance.current) {
                  provenance.current.open = false;
                  provenance.current.querySelector('summary')?.focus();
                }
              }}
            >
              <X size={17} />
            </button>
          </header>
          <p>
            <strong>{mode}</strong>
            <br />
            {!simulation
              ? 'Operational and historical records retain their original source and timestamps.'
              : 'Readings, dispatch and output are generated in the browser. Simulation cannot authorize work or verify an operational repair.'}
          </p>
          <p>
            <strong>{status}</strong>
            <br />
            {!connected
              ? 'The API is reconnecting. Current operational status cannot be confirmed from the browser simulation.'
              : fresh
                ? 'Fresh observations are available from a reviewed operational source. Inspect its source, acquisition time and units separately.'
                : sources.length
                  ? 'Operational sources are configured, but none currently reports fresh data. Stale or missing readings do not establish current health.'
                  : 'No operational source is configured for this plant. Synthetic readings are separate from operational evidence.'}
          </p>
          <Link href="/plant?view=observations">Reviewed operational observations</Link>
        </section>
      </details>
      <details ref={account} className={`${styles.menu} ${styles.account}`} data-sidebar-menu>
        <summary role="button" aria-label="Account and connection" title="Account and connection">
          <span className={styles.avatar}>
            {state.workspace?.user.display_name.slice(0, 2).toUpperCase() || 'NP'}
          </span>
          <span className={styles.identity}>
            {expanded ? state.workspace?.user.display_name : 'Account'}
            <small>{state.workspace?.role}</small>
          </span>
        </summary>
        <section className={styles.popover} aria-label="Account and connection details">
          <header>
            <h2>{state.workspace?.user.display_name || 'Plant access'}</h2>
            <button
              aria-label="Close account menu"
              onClick={() => {
                if (account.current) {
                  account.current.open = false;
                  account.current.querySelector('summary')?.focus();
                }
              }}
            >
              <X size={17} />
            </button>
          </header>
          <p>
            {state.plant.name} · {state.workspace?.role}
          </p>
          <Link href="/workspace" aria-label="Staff and plant access">
            Staff and plant access
          </Link>
          <p className={styles.connection}>
            <Radio size={13} />
            {connected ? 'API connected' : 'Reconnecting…'}
          </p>
        </section>
      </details>
    </div>
  );
}
