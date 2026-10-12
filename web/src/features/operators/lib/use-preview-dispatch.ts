'use client';

import { useEffect, useMemo, useState } from 'react';
import { oocAssetIds } from '@/features/plant/lib/preview-telemetry';
import { usePreviewTelemetry } from '@/features/plant/lib/use-preview-telemetry';
import {
  applyLatchedReadings,
  floorActors,
  liveAssignment,
  reconcileDispatch,
  type AssetRef,
  type DispatchSnapshot,
} from '@/features/operators/lib/preview-dispatch';
import {
  emptyLedger,
  ledgerKey,
  parseLedger,
  recordTick,
  type PreviewLedger,
} from '@/features/monitoring/lib/preview-records';

const EMPTY_ASSETS: AssetRef[] = [];

export function usePreviewDispatchState(assets: AssetRef[], plantId = '') {
  const preview = usePreviewTelemetry(assets.length ? assets : EMPTY_ASSETS);
  const [now, setNow] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState<DispatchSnapshot>({ open: [], history: [] });
  const [ledger, setLedger] = useState<PreviewLedger>(() => emptyLedger(plantId));

  useEffect(() => {
    if (!plantId) return;
    setLedger(parseLedger(window.localStorage.getItem(ledgerKey(plantId)), plantId));
  }, [plantId]);

  useEffect(() => {
    if (!assets.length) return;
    const pulse = () => {
      const clock = Date.now();
      setNow(clock);
      setSnapshot((current) =>
        reconcileDispatch(current, {
          assets,
          catalog: preview.readings,
          tick: preview.tick,
          now: clock,
        }),
      );
    };
    pulse();
    const timer = window.setInterval(pulse, preview.reduceMotion ? 400 : 80);
    return () => window.clearInterval(timer);
  }, [assets, preview.readings, preview.reduceMotion, preview.tick]);

  useEffect(() => {
    if (!plantId || !assets.length) return;
    setLedger((current) => {
      const next = recordTick(current, {
        plantId,
        assets,
        catalog: preview.readings,
        tick: preview.tick,
        now: Date.now(),
        open: snapshot.open,
        history: snapshot.history,
      });
      if (sameLedger(current, next)) return current;
      window.localStorage.setItem(ledgerKey(plantId), JSON.stringify(next));
      return next;
    });
  }, [assets, plantId, preview.readings, preview.tick, snapshot.history, snapshot.open]);

  const assignments = useMemo(
    () => snapshot.open.map((item) => liveAssignment(item, now, preview.reduceMotion)),
    [now, preview.reduceMotion, snapshot.open],
  );
  const history = useMemo(
    () =>
      snapshot.history.map((item) => ({
        ...liveAssignment(item, item.openedAt + 60_000),
        phase: 'returned' as const,
        ooc: false,
        remainingMs: 0,
      })),
    [snapshot.history],
  );
  const latchedIds = useMemo(
    () => assignments.filter((item) => item.ooc).map((item) => item.assetId),
    [assignments],
  );
  const readings = useMemo(
    () => applyLatchedReadings(preview.readings, assets, latchedIds, preview.tick, preview.seed),
    [assets, latchedIds, preview.readings, preview.seed, preview.tick],
  );
  const oocIds = useMemo(() => {
    const flagged = new Set([...oocAssetIds(readings), ...latchedIds]);
    return [...flagged];
  }, [latchedIds, readings]);
  const actors = useMemo(() => floorActors(assignments, assets), [assignments, assets]);

  return {
    ...preview,
    readings,
    oocIds,
    assignments,
    history,
    actors,
    ledger,
  };
}

function sameLedger(left: PreviewLedger, right: PreviewLedger) {
  return (
    left.lastTick === right.lastTick &&
    left.cases.length === right.cases.length &&
    left.cases.every(
      (item, index) =>
        item.id === right.cases[index]?.id &&
        item.clearedAt === right.cases[index]?.clearedAt &&
        item.attendedAt === right.cases[index]?.attendedAt &&
        item.fixedAt === right.cases[index]?.fixedAt,
    )
  );
}
