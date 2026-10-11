import type { Asset } from '@/lib/types';

export function plantBounds(assets: { position: number[] }[]) {
  const minX = Math.min(-10, ...assets.map((asset) => asset.position[0])) - 3;
  const maxX = Math.max(10, ...assets.map((asset) => asset.position[0])) + 3;
  const minZ = Math.min(-8, ...assets.map((asset) => asset.position[2])) - 3;
  const maxZ = Math.max(8, ...assets.map((asset) => asset.position[2])) + 3;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
  };
}

export function planPoint(position: number[], bounds: ReturnType<typeof plantBounds>) {
  return {
    x: 8 + ((position[0] - bounds.minX) / bounds.width) * 84,
    y: 8 + ((position[2] - bounds.minZ) / bounds.depth) * 84,
  };
}

export function planPosition(asset: Asset, bounds: ReturnType<typeof plantBounds>) {
  return planPoint(asset.position, bounds);
}
