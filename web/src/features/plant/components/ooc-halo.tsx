'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

export function OocHalo({ reduced }: { reduced: boolean }) {
  const ring = useRef<Mesh>(null);
  const wash = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const pulse = reduced ? 0.72 : 0.38 + (Math.sin(clock.elapsedTime * 6) + 1) * 0.28;
    if (ring.current && 'opacity' in ring.current.material)
      (ring.current.material as { opacity: number }).opacity = pulse;
    if (wash.current && 'opacity' in wash.current.material)
      (wash.current.material as { opacity: number }).opacity = pulse * 0.22;
  });
  return (
    <group>
      <mesh ref={wash} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
        <circleGeometry args={[1.85, 48]} />
        <meshBasicMaterial color="#ff5d6a" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 0]}>
        <ringGeometry args={[1.48, 1.78, 48]} />
        <meshBasicMaterial color="#ff6b78" transparent opacity={0.8} depthWrite={false} />
      </mesh>
    </group>
  );
}
