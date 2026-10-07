'use client';

import { memo, useEffect, useMemo } from 'react';
import { createInstances, Line } from '@react-three/drei';
import * as THREE from 'three';

const [StaticBoxes, StaticBox] = createInstances();

function Solid({
  position,
  size,
  color,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  metal?: number;
}) {
  return <StaticBox position={position} scale={size} color={color} />;
}

function Pipe({
  points,
  color = '#7b8b94',
  radius = 0.07,
}: {
  points: [number, number, number][];
  color?: string;
  radius?: number;
}) {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
    [points],
  );
  return (
    <mesh castShadow>
      <tubeGeometry args={[curve, 20, radius, 8, false]} />
      <meshStandardMaterial color={color} metalness={0.7} roughness={0.36} />
    </mesh>
  );
}

export const FactoryEnvironment = memo(function FactoryEnvironment() {
  const floor = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#929792';
    ctx.fillRect(0, 0, 512, 512);
    let seed = 42;
    for (let i = 0; i < 12000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed % 512;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      ctx.fillStyle = i % 2 ? '#858b8644' : '#bec3b644';
      ctx.fillRect(x, seed % 512, 1, 1);
    }
    ctx.strokeStyle = '#747f7a';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(7, 6);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => floor.dispose(), [floor]);
  return (
    <StaticBoxes limit={100} frames={1} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial metalness={0.25} roughness={0.65} />
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} receiveShadow>
          <planeGeometry args={[24, 22]} />
          <meshStandardMaterial map={floor} roughness={0.94} metalness={0.03} />
        </mesh>
        <Solid position={[0, -0.25, 0]} size={[24, 0.45, 22]} color="#656e6c" />
        <Solid position={[0, 1.8, -10.7]} size={[24, 3.6, 0.22]} color="#d1d4ce" metal={0} />
        <Solid position={[-11.7, 0.8, 0]} size={[0.22, 1.6, 22]} color="#bdc3bd" metal={0} />
        <Solid position={[0, 0.12, -10.55]} size={[23.5, 0.24, 0.15]} color="#6a7371" />
        {[-10.8, -5.4, 0, 5.4, 10.8].map((x) => (
          <group key={x}>
            <Solid position={[x, 2.9, -10.5]} size={[0.26, 5.8, 0.28]} color="#526063" />
            <Solid position={[x, 5.8, -9]} size={[0.2, 0.25, 3.5]} color="#526063" />
            <Solid
              position={[x, 4.25, -10.45]}
              size={[3.8, 1.55, 0.08]}
              color="#93b5bd"
              metal={0.1}
            />
            <Solid position={[x, 4.25, -10.36]} size={[0.055, 1.55, 0.04]} color="#5b6b6d" />
            <Solid position={[x, 4.25, -10.35]} size={[3.8, 0.06, 0.04]} color="#5b6b6d" />
          </group>
        ))}
        <Solid position={[0, 5.7, -10.3]} size={[23.8, 0.22, 0.28]} color="#546165" />
        <Solid position={[0, 4.1, -9.95]} size={[21, 0.15, 0.3]} color="#a6afb2" />
        <Pipe
          points={[
            [-10, 3.6, -10],
            [0, 3.6, -10],
            [10.8, 3.6, -10],
            [10.8, 1.2, -8],
          ]}
          color="#9eaa77"
          radius={0.1}
        />
        {[
          [-2, 'LINE A'],
          [4, 'LINE B'],
        ].map(([z, label]) => (
          <group key={label}>
            <Line
              points={[
                [-9.5, 0.025, Number(z) - 2.1],
                [5, 0.025, Number(z) - 2.1],
                [5, 0.025, Number(z) + 2.1],
                [-9.5, 0.025, Number(z) + 2.1],
                [-9.5, 0.025, Number(z) - 2.1],
              ]}
              color="#efcc66"
              lineWidth={3}
            />
            <Pipe
              points={[
                [-6, 0.6, -7],
                [-8.9, 0.6, -6],
                [-8.9, 0.6, Number(z)],
                [-5, 0.9, Number(z)],
              ]}
              color="#4a898b"
              radius={0.08}
            />
            <Pipe
              points={[
                [-5, 0.75, Number(z)],
                [-3.4, 0.75, Number(z)],
                [-3, 0.75, Number(z) - 0.5],
                [-1.5, 0.8, Number(z) - 0.5],
              ]}
            />
          </group>
        ))}
        <Line
          points={[
            [-10, 0.035, 1],
            [6, 0.035, 1],
            [6, 0.035, 8.8],
          ]}
          color="#edece0"
          lineWidth={12}
          dashed
          dashSize={0.7}
          gapSize={0.5}
        />
        {[0, 1, 2].map((n) => (
          <group key={n} position={[8.7, 0, -6.8 + n * 1.8]}>
            <Solid position={[0, 0.18, 0]} size={[1.4, 0.22, 1.25]} color="#937251" />
            <Solid position={[0, 0.67, 0]} size={[1.1, 0.8, 1]} color="#ab9876" metal={0} />
            <Solid position={[0, 0.69, 0.51]} size={[0.42, 0.3, 0.012]} color="#dedbd0" metal={0} />
          </group>
        ))}
        {[6.2, 7.6, 9].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.63, 7.8]} castShadow>
              <cylinderGeometry args={[0.4, 0.4, 1.15, 16]} />
              <meshStandardMaterial color="#587480" roughness={0.5} metalness={0.5} />
            </mesh>
            <mesh position={[x, 1.22, 7.8]}>
              <cylinderGeometry args={[0.4, 0.4, 0.045, 16]} />
              <meshStandardMaterial color="#a1adae" metalness={0.7} roughness={0.4} />
            </mesh>
          </group>
        ))}
        {[-9.7, 10.5].map((x) => (
          <group key={x}>
            <Solid position={[x, 0.95, -7.3]} size={[0.12, 1.9, 0.12]} color="#d6ab4e" />
            <Solid position={[x, 0.075, -7.3]} size={[0.6, 0.15, 0.6]} color="#333f43" />
          </group>
        ))}
      </group>
    </StaticBoxes>
  );
});
