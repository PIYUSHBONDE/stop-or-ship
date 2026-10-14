'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { oocAssetIds } from '@/features/plant/lib/preview-telemetry';
import {
  advanceProcess,
  commandProcess,
  freshProcess,
  processView,
  type ProcessCatalog,
  type SimulationCommand,
} from '@/features/plant/lib/process-simulation';
import { floorActors, liveAssignment } from './preview-dispatch';
import { emptyLedger, ledgerKey, recordTick } from '@/features/monitoring/lib/preview-records';
import { restoreSimulation, simulationKey, type SimulationState } from './simulation-state';

function hydrate(state: SimulationState) {
  if (state.process) return state;
  return {
    ...state,
    process: freshProcess(Date.now()),
    snapshot: { open: [], history: state.snapshot.history },
    ledger: {
      ...state.ledger,
      cases: state.ledger.cases.map((c) => (c.clearedAt ? c : { ...c, interrupted: true })),
    },
  };
}

export function usePreviewDispatchState(catalog: ProcessCatalog, plantId = '') {
  const [runtime, setRuntime] = useState<SimulationState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [controlError, setControlError] = useState('');
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const controller = useRef<((command: SimulationCommand) => void) | null>(null);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!plantId) return;
    let active = true;
    let writer = false;
    let persistent = true;
    let saved = false;
    let current: SimulationState;
    const key = simulationKey(plantId);
    const load = () =>
      hydrate(
        restoreSimulation(
          localStorage.getItem(key),
          localStorage.getItem(ledgerKey(plantId)),
          plantId,
          Date.now(),
        ),
      );
    try {
      current = load();
    } catch {
      persistent = false;
      current = hydrate(restoreSimulation(null, null, plantId, Date.now()));
      setStorageError(
        'Simulation persistence unavailable or invalid. This tab runs in memory; saved data was not overwritten.',
      );
    }
    setRuntime(current);
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`${key}:controls`) : null;
    const publish = (command?: SimulationCommand) => {
      if (!active || !writer || !catalogRef.current.assets.length) return;
      const clock = Date.now();
      let base = current;
      let process = current.process!;
      if (command) {
        process = commandProcess(process, command, catalogRef.current);
        if (command.type === 'reset')
          base = {
            ...base,
            snapshot: { open: [], history: base.snapshot.history },
            ledger: {
              ...base.ledger,
              cases: base.ledger.cases.map((c) => (c.clearedAt ? c : { ...c, interrupted: true })),
            },
          };
      }
      const delta = command ? 0 : Math.max(0, clock - current.advancedAt);
      const elapsed = process.elapsed + (process.paused ? 0 : delta * process.speed);
      const nextTick =
        base.tick +
        Math.max(0, Math.floor(elapsed / 2500) - Math.floor(process.elapsed / 2500)) +
        (command?.type === 'fault' || command?.type === 'reset' ? 1 : 0);
      const advanced = advanceProcess(
        process,
        base.snapshot,
        catalogRef.current,
        delta,
        nextTick,
        base.seed,
      );
      const view = processView(
        advanced.process,
        advanced.snapshot,
        catalogRef.current,
        nextTick,
        base.seed,
      );
      const ledger = recordTick(base.ledger, {
        plantId,
        assets: catalogRef.current.assets,
        catalog: view.readings,
        tick: nextTick,
        now: view.now,
        open: advanced.snapshot.open,
        history: advanced.snapshot.history,
        context: catalogRef.current,
      });
      const next: SimulationState = {
        ...base,
        process: advanced.process,
        snapshot: advanced.snapshot,
        ledger,
        tick: nextTick,
        advancedAt: clock,
      };
      if (
        persistent &&
        (command ||
          !saved ||
          nextTick !== current.tick ||
          JSON.stringify(next.snapshot) !== JSON.stringify(current.snapshot) ||
          next.process!.stage !== current.process!.stage ||
          ledger.cases.length !== current.ledger.cases.length ||
          ledger.cases.some(
            (c, i) =>
              c.fixedAt !== current.ledger.cases[i]?.fixedAt ||
              c.clearedAt !== current.ledger.cases[i]?.clearedAt ||
              c.attendedAt !== current.ledger.cases[i]?.attendedAt,
          ))
      ) {
        try {
          localStorage.setItem(key, JSON.stringify(next));
          saved = true;
        } catch {
          persistent = false;
          setStorageError('Simulation storage unavailable. Changes remain in this tab only.');
        }
      }
      current = next;
      setRuntime(next);
    };
    const receive = (e: StorageEvent) => {
      if (e.key !== key || writer) return;
      try {
        current = load();
        setRuntime(current);
      } catch {
        setStorageError('Saved simulation update is invalid; retaining the last valid state.');
      }
    };
    window.addEventListener('storage', receive);
    if (channel)
      channel.onmessage = (e) => {
        if (!active) return;
        const message = e.data;
        if (message?.type === 'command' && writer) {
          try {
            publish(message.command);
            channel.postMessage({ type: 'ack', id: message.id, state: current });
          } catch (cause) {
            channel.postMessage({
              type: 'ack',
              id: message.id,
              error: cause instanceof Error ? cause.message : 'Simulation command failed.',
            });
          }
        } else if (message?.type === 'ack' && pending.has(message.id)) {
          clearTimeout(pending.get(message.id));
          pending.delete(message.id);
          if (message.error) setControlError(message.error);
          else {
            try {
              current = hydrate(
                restoreSimulation(JSON.stringify(message.state), null, plantId, Date.now()),
              );
              setRuntime(current);
              setControlError('');
            } catch {
              setControlError('Invalid simulation response. Reload and try again.');
            }
          }
        }
      };
    controller.current = (command) => {
      setControlError('');
      if (writer) {
        try {
          publish(command);
        } catch (cause) {
          setControlError(cause instanceof Error ? cause.message : 'Simulation command failed.');
        }
      } else if (channel) {
        const id = crypto.randomUUID();
        pending.set(
          id,
          setTimeout(() => {
            pending.delete(id);
            if (active)
              setControlError(
                'The writing tab did not respond. Close inactive plant tabs and retry.',
              );
          }, 4000),
        );
        channel.postMessage({ type: 'command', id, command });
      } else setControlError('This tab is read-only. Open the plant in its writing tab.');
    };
    let release: (() => void) | undefined;
    if (navigator.locks) {
      void navigator.locks
        .request(key, async () => {
          if (!active) return;
          if (persistent) {
            try {
              current = load();
            } catch {
              persistent = false;
              setStorageError('Saved simulation is invalid. This tab runs in memory.');
            }
          }
          writer = true;
          publish();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        .catch(() => {
          if (!active) return;
          persistent = false;
          writer = true;
          setStorageError(
            'Cross-tab coordination unavailable. Simulation runs in memory in this tab.',
          );
          publish();
        });
    } else {
      persistent = false;
      writer = true;
      setStorageError('Cross-tab coordination unavailable. Simulation runs in memory in this tab.');
      publish();
    }
    const timer = window.setInterval(() => publish(), 200);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('storage', receive);
      release?.();
      channel?.close();
      for (const t of pending.values()) clearTimeout(t);
      controller.current = null;
    };
  }, [plantId]);
  const seed = runtime?.seed ?? 0;
  const tick = runtime?.tick ?? 3;
  const view = useMemo(
    () =>
      runtime?.process ? processView(runtime.process, runtime.snapshot, catalog, tick, seed) : null,
    [runtime, catalog, tick, seed],
  );
  const now = view?.now ?? 0;
  const assignments = runtime?.snapshot.open.map((a) => liveAssignment(a, now, reduceMotion)) ?? [];
  const history =
    runtime?.snapshot.history.map((a) => ({
      ...liveAssignment(a, now),
      phase: 'returned' as const,
      ooc: false,
      remainingMs: 0,
    })) ?? [];
  const readings = view?.readings ?? {};
  return {
    seed,
    tick,
    readings,
    oocIds: oocAssetIds(readings),
    scannedId: null,
    hoverId,
    setHoverId,
    focusId: hoverId,
    reduceMotion,
    assignments,
    history,
    actors: floorActors(assignments, catalog.assets),
    ledger: runtime?.ledger ?? emptyLedger(plantId),
    storageError,
    controlError,
    process: runtime?.process ?? null,
    view,
    command: (command: SimulationCommand) => controller.current?.(command),
  };
}
