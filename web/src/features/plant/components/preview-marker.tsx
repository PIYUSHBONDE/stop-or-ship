import { Html } from '@react-three/drei';
import type { Asset } from '@/lib/types';
import { PreviewCard } from '@/features/plant/components/preview-card';
import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';

export function PreviewMarker({ asset, readings }: { asset: Asset; readings: PreviewReading[] }) {
  return (
    <group
      position={[
        asset.position[0],
        asset.position[1] + (asset.type === 'press' ? 4.15 : 3.1),
        asset.position[2],
      ]}
    >
      <Html
        center
        sprite
        distanceFactor={16}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <PreviewCard id={asset.id} name={asset.name} readings={readings} />
      </Html>
    </group>
  );
}
