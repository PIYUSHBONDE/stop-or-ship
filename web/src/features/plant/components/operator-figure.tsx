'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { FloorActor } from '@/features/operators/lib/preview-dispatch';

const PHASE_COLOR: Record<string, string> = {
  dispatched: '#f1b675',
  en_route: '#ff8a5b',
  on_site: '#91baff',
  correcting: '#85ddba',
  cleared: '#85ddba',
  returning: '#c9d4dc',
  returned: '#8aa0ad',
};

export function OperatorFigure({ actor, reduced }: { actor: FloorActor; reduced: boolean }) {
  const body = useRef<THREE.Group>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2a1c16';
    context.fillRect(0, 0, 256, 72);
    context.strokeStyle = PHASE_COLOR[actor.phase] || '#f1b675';
    context.lineWidth = 6;
    context.strokeRect(3, 3, 250, 66);
    context.font = '32px Arial';
    context.fillStyle = '#fff4ea';
    context.fillText(actor.label, 18, 48);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [actor.label, actor.phase]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ clock }) => {
    if (!body.current) return;
    const moving = actor.phase === 'en_route' || actor.phase === 'returning';
    const bob = !reduced && moving ? Math.abs(Math.sin(clock.elapsedTime * 11)) * 0.08 : 0;
    body.current.position.y = bob;
  });
  return (
    <group position={actor.position}>
      <group ref={body}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <capsuleGeometry args={[0.16, 0.55, 4, 10]} />
          <meshStandardMaterial color={PHASE_COLOR[actor.phase] || '#f1b675'} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.92, 0]} castShadow>
          <sphereGeometry args={[0.15, 14, 14]} />
          <meshStandardMaterial color="#e8d2c4" roughness={0.6} />
        </mesh>
        <sprite position={[0, 1.35, 0]} scale={[1.15, 0.32, 1]}>
          <spriteMaterial map={texture} depthTest={false} />
        </sprite>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <circleGeometry args={[0.28, 18]} />
        <meshBasicMaterial
          color={PHASE_COLOR[actor.phase] || '#f1b675'}
          transparent
          opacity={0.35}
        />
      </mesh>
    </group>
  );
}
