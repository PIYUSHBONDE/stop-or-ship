import type { Asset } from '@/lib/types';
import { plantBounds, planPoint, planPosition } from '@/lib/plant-layout';
import type { FloorActor } from '@/features/operators/lib/preview-dispatch';
import styles from './operators.module.css';

export function FloorPositionMap({
  assets,
  actors,
  selectedAsset,
  selectedOperator,
  oocIds,
}: {
  assets: Asset[];
  actors: FloorActor[];
  selectedAsset?: string;
  selectedOperator?: string;
  oocIds: string[];
}) {
  const bounds = plantBounds(assets);
  const point = (position: number[]) => {
    const p = planPoint(position, bounds);
    return { x: p.x * 4.8, y: p.y * 3 };
  };
  const placed: { x: number; y: number }[] = [];
  const labels = actors.map((actor) => {
    const p = point(actor.position);
    let x = Math.max(40, Math.min(440, p.x));
    let y = Math.min(280, p.y + 25);
    // Keep labels separate while leaders retain the actual floor positions.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!placed.some((label) => Math.abs(label.x - x) < 78 && Math.abs(label.y - y) < 28)) break;
      y += 30;
      if (y > 280) {
        y = Math.max(20, p.y - 35);
        x = x < 360 ? x + 80 : x - 80;
      }
    }
    placed.push({ x, y });
    return { actor, point: p, x, y };
  });

  return (
    <svg
      className={styles.board}
      viewBox="0 0 480 300"
      role="img"
      aria-label="Equipment and operator floor positions"
    >
      <title>
        Equipment and simulated operator positions; labels connect to their floor markers.
      </title>
      <path d="M 36 150 H 444 M 36 226 H 444" className={styles.mapAisle} />
      {assets.map((asset) => {
        const p = planPosition(asset, bounds);
        const x = p.x * 4.8;
        const y = p.y * 3;
        const selected = asset.id === selectedAsset;
        return (
          <g key={asset.id} data-floor-asset={asset.id}>
            <title>
              {asset.id} · {asset.name}
            </title>
            {selected && <circle cx={x} cy={y} r="13" className={styles.mapSelection} />}
            <circle
              cx={x}
              cy={y}
              r={selected ? 6 : 4}
              className={oocIds.includes(asset.id) ? styles.mapFault : styles.mapEquipment}
            />
            {selected && (
              <g data-floor-equipment-label={asset.id}>
                <rect
                  x={x - 45}
                  y={y - 50}
                  width="90"
                  height="30"
                  rx="5"
                  className={styles.mapAssetLabel}
                />
                <text x={x} y={y - 29} className={styles.mapAssetText}>
                  {asset.id}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {labels.map(({ actor, point: p, x, y }) => (
        <g
          key={actor.id}
          data-floor-operator={actor.id}
          className={actor.id === selectedOperator ? styles.mapActiveActor : styles.mapActor}
        >
          <title>
            {actor.name} · {actor.id}
          </title>
          <path d={`M ${p.x} ${p.y} L ${x} ${y}`} className={styles.mapLeader} />
          <circle cx={p.x} cy={p.y} r="4" />
          <g data-floor-operator-label={actor.id}>
            <rect x={x - 35} y={y - 14} width="70" height="28" rx="5" />
            <text x={x} y={y + 6}>
              {actor.id}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}
