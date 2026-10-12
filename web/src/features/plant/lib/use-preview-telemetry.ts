'use client';

import { useEffect, useMemo, useState } from 'react';
import { oocAssetIds, previewCatalog } from '@/features/plant/lib/preview-telemetry';

const TICK_MS = 2500;

export function usePreviewTelemetry(assets: { id: string; type: string }[]) {
  const seed = useMemo(() => Date.now() % 9973, []);
  const [tick, setTick] = useState(2);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduceMotion || assets.length === 0) return;
    const timer = window.setInterval(() => setTick((current) => current + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [assets.length, reduceMotion]);

  const scannedId = assets.length ? assets[tick % assets.length].id : null;
  const focusId = hoverId || scannedId;
  const readings = useMemo(() => previewCatalog(assets, tick, seed), [assets, seed, tick]);
  const oocIds = useMemo(() => oocAssetIds(readings), [readings]);

  return { seed, tick, readings, oocIds, scannedId, hoverId, setHoverId, focusId, reduceMotion };
}
