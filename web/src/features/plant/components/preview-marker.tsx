import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import type { Asset } from '@/lib/types';
import { PreviewCard } from '@/features/plant/components/preview-card';
import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';

export function PreviewMarker({ asset, readings }: { asset: Asset; readings: PreviewReading[] }) {
  const { gl } = useThree();
  // Pin the DOM target: changing event connections must not recreate a root on the same element.
  const portal = useMemo(() => ({ current: gl.domElement.parentElement! }), [gl]);
  return (
    <group
      position={[
        asset.position[0],
        asset.position[1] + (asset.type === 'press' ? 4.15 : 3.1),
        asset.position[2],
      ]}
    >
      <Html
        portal={portal}
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
