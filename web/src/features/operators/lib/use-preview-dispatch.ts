'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { previewCatalog, oocAssetIds } from '@/features/plant/lib/preview-telemetry';
import {
  applyLatchedReadings,
  floorActors,
  liveAssignment,
  reconcileDispatch,
  type AssetRef,
} from './preview-dispatch';
import { emptyLedger, ledgerKey, recordTick } from '@/features/monitoring/lib/preview-records';
import { restoreSimulation, simulationKey, type SimulationState } from './simulation-state';

export function usePreviewDispatchState(assets: AssetRef[], plantId = '') {
  const [runtime, setRuntime] = useState<SimulationState | null>(null);
  const [now, setNow] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [storageError, setStorageError] = useState('');
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
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
    let current: SimulationState;
    const key = simulationKey(plantId);
    const load = () =>
      restoreSimulation(
        localStorage.getItem(key),
        localStorage.getItem(ledgerKey(plantId)),
        plantId,
        Date.now(),
      );
    try {
      current = load();
    } catch {
      persistent = false;
      current = restoreSimulation(null, null, plantId, Date.now());
      setStorageError(
        'Simulation persistence unavailable or invalid. This tab runs in memory; saved data was not overwritten.',
      );
    }
    setRuntime(current);
    const publish = () => {
      if (!active) return;
      const clock = Date.now();
      setNow(clock);
      if (!writer || !assetsRef.current.length) return;
      const tick = clock - current.advancedAt >= 2500 ? current.tick + 1 : current.tick;
      const catalog = previewCatalog(assetsRef.current, tick, current.seed);
      const snapshot = reconcileDispatch(current.snapshot, {
        assets: assetsRef.current,
        catalog,
        tick,
        now: clock,
      });
      const readings = applyLatchedReadings(
        catalog,
        assetsRef.current,
        snapshot.open.filter((a) => liveAssignment(a, clock).ooc).map((a) => a.assetId),
        tick,
        current.seed,
      );
      const ledger = recordTick(current.ledger, {
        plantId,
        assets: assetsRef.current,
        catalog: readings,
        tick,
        now: clock,
        open: snapshot.open,
        history: snapshot.history,
      });
      const next = {
        ...current,
        tick,
        advancedAt: tick === current.tick ? current.advancedAt : clock,
        snapshot,
        ledger,
      };
      if (
        persistent &&
        (tick !== current.tick ||
          JSON.stringify(snapshot) !== JSON.stringify(current.snapshot) ||
          ledger.lastTick !== current.ledger.lastTick ||
          ledger.cases.length !== current.ledger.cases.length ||
          ledger.cases.some(
            (item, index) =>
              item.id !== current.ledger.cases[index]?.id ||
              item.fixedAt !== current.ledger.cases[index]?.fixedAt ||
              item.attendedAt !== current.ledger.cases[index]?.attendedAt,
          ))
      ) {
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          persistent = false;
          setStorageError('Simulation storage unavailable. Changes remain in this tab only.');
        }
      }
      current = next;
      setRuntime(next);
    };
    const receive = (event: StorageEvent) => {
      if (event.key !== key || writer) return;
      try {
        current = load();
        setRuntime(current);
      } catch {
        setStorageError('Saved simulation update is invalid; retaining the last valid state.');
      }
    };
    window.addEventListener('storage', receive);
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
      setStorageError('Cross-tab coordination unavailable. Simulation runs in memory in this tab.');
      persistent = false;
      writer = true;
    }
    const timer = window.setInterval(publish, 200);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('storage', receive);
      release?.();
    };
  }, [plantId]);
  const seed = runtime?.seed ?? 0;
  const tick = runtime?.tick ?? 2;
  const assignments = useMemo(
    () => runtime?.snapshot.open.map((a) => liveAssignment(a, now, reduceMotion)) ?? [],
    [runtime, now, reduceMotion],
  );
  const history = useMemo(
    () =>
      runtime?.snapshot.history.map((a) => ({
        ...liveAssignment(a, now),
        phase: 'returned' as const,
        ooc: false,
        remainingMs: 0,
      })) ?? [],
    [runtime, now],
  );
  const readings = useMemo(
    () =>
      runtime
        ? applyLatchedReadings(
            previewCatalog(assets, tick, seed),
            assets,
            assignments.filter((a) => a.ooc).map((a) => a.assetId),
            tick,
            seed,
          )
        : {},
    [runtime, assets, tick, seed, assignments],
  );
  const oocIds = oocAssetIds(readings);
  const scannedId = assets.length ? assets[tick % assets.length].id : null;
  return {
    seed,
    tick,
    readings,
    oocIds,
    scannedId,
    hoverId,
    setHoverId,
    focusId: hoverId || scannedId,
    reduceMotion,
    assignments,
    history,
    actors: floorActors(assignments, assets),
    ledger: runtime?.ledger ?? emptyLedger(plantId),
    storageError,
  };
}
