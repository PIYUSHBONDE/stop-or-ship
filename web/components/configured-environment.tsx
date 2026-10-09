'use client';

import { createInstances, Line } from '@react-three/drei';
import type { State } from '@/lib/types';
import { plantBounds } from '@/lib/plant-layout';

const [Structure, Beam] = createInstances();

/** Building and production bays follow the configured equipment footprint. */
export function ConfiguredEnvironment({ state }: { state: State }) {
  const bounds = plantBounds(state.assets);
  const posts = Array.from(
    { length: Math.ceil(bounds.depth / 6) + 1 },
    (_, index) => bounds.minZ + (index * bounds.depth) / Math.ceil(bounds.depth / 6),
  );
  return (
    <Structure limit={300} frames={1} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.72} metalness={0.22} />
      <Beam
        position={[bounds.x, -0.2, bounds.z]}
        scale={[bounds.width, 0.35, bounds.depth]}
        color="#929792"
      />
      <Beam
        position={[bounds.minX, 1.5, bounds.z]}
        scale={[0.2, 3, bounds.depth]}
        color="#c3ccc7"
      />
      <Beam
        position={[bounds.x, 1.5, bounds.minZ]}
        scale={[bounds.width, 3, 0.2]}
        color="#c3ccc7"
      />
      {posts.map((z) => (
        <group key={z}>
          <Beam position={[bounds.minX + 0.3, 3, z]} scale={[0.25, 6, 0.25]} color="#53696b" />
          <Beam position={[bounds.minX + 0.3, 5.8, z]} scale={[3, 0.2, 0.25]} color="#53696b" />
          <Beam
            position={[bounds.minX + 0.3, 4.3, z + 1.3]}
            scale={[0.1, 1.6, 2]}
            color="#94b7c0"
          />
        </group>
      ))}
      {state.areas.map((area) => {
        const assets = state.assets.filter((asset) => asset.area_id === area.id);
        if (!assets.length) return null;
        const x0 = Math.min(...assets.map((asset) => asset.position[0])) - 1.4;
        const x1 = Math.max(...assets.map((asset) => asset.position[0])) + 1.6;
        const z0 = Math.min(...assets.map((asset) => asset.position[2])) - 1.9;
        const z1 = Math.max(...assets.map((asset) => asset.position[2])) + 1.9;
        return (
          <Line
            key={area.id}
            points={[
              [x0, 0.02, z0],
              [x1, 0.02, z0],
              [x1, 0.02, z1],
              [x0, 0.02, z1],
              [x0, 0.02, z0],
            ]}
            color={area.nominal_units_per_hour ? '#efcc66' : '#d1e2dc'}
            lineWidth={2}
          />
        );
      })}
      <Line
        points={[
          [bounds.maxX - 2, 0.025, bounds.minZ + 1],
          [bounds.maxX - 2, 0.025, bounds.maxZ - 1],
        ]}
        color="#edece0"
        lineWidth={7}
        dashed
        dashSize={0.7}
        gapSize={0.5}
      />
    </Structure>
  );
}
