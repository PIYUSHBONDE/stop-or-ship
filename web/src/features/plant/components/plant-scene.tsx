'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { createInstances, Line, OrbitControls } from '@react-three/drei';
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Asset, State } from '@/lib/types';
import { FactoryEnvironment } from '@/features/plant/components/factory-environment';
import { ConfiguredEnvironment } from '@/features/plant/components/configured-environment';
import { plantBounds } from '@/lib/plant-layout';
import { PlantPlan } from './plant-plan';
import { PreviewMarker } from '@/features/plant/components/preview-marker';
import { OocHalo } from '@/features/plant/components/ooc-halo';
import { OperatorFigure } from '@/features/plant/components/operator-figure';
import type { PreviewReading } from '@/features/plant/lib/preview-telemetry';
import type { FloorActor } from '@/features/operators/lib/preview-dispatch';

const [BoxInstances, BoxInstance] = createInstances();
const [CylinderInstances, CylinderInstance] = createInstances();

function ContextLossFallback({ onLoss }: { onLoss: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onLoss();
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, onLoss]);
  return null;
}

export type PlantPreview = {
  focusId: string | null;
  scannedId: string | null;
  oocIds: string[];
  readings: Record<string, PreviewReading[]>;
  actors?: FloorActor[];
  onHover: (id: string | null) => void;
};

const statusColors: Record<string, string> = {
  unknown: '#91a0b5',
  healthy: '#63d9ad',
  degrading: '#ffb05c',
  investigating: '#8daeff',
  critical: '#ff6776',
  affected: '#eaa865',
  stopped: '#ff6776',
  verifying: '#a6a0ff',
};

function AssetLabel({
  id,
  color,
  selected,
  y,
}: {
  id: string;
  color: string;
  selected: boolean;
  y: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = selected ? '#294754' : '#1a303b';
    context.fillRect(0, 0, 256, 80);
    context.strokeStyle = selected ? '#b4d5e5' : '#537482';
    context.lineWidth = 4;
    context.strokeRect(2, 2, 252, 76);
    context.fillStyle = color;
    context.beginPath();
    context.arc(25, 40, 7, 0, Math.PI * 2);
    context.fill();
    context.font = '34px Arial';
    context.fillStyle = '#e2eff5';
    context.fillText(id, 48, 52);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [id, color, selected]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={[0, y, 0]} scale={[1.8, 0.56, 1]}>
      <spriteMaterial map={texture} depthTest={false} />
    </sprite>
  );
}

function Box({
  position,
  size,
  color,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  metal?: boolean;
}) {
  return <BoxInstance position={position} scale={size} color={color} />;
}
function Cylinder({
  position,
  radius,
  length,
  color,
  rotate = false,
}: {
  position: [number, number, number];
  radius: number;
  length: number;
  color: string;
  rotate?: boolean;
}) {
  return (
    <CylinderInstance
      position={position}
      scale={[radius, length, radius]}
      color={color}
      rotation={rotate ? [0, 0, Math.PI / 2] : [0, 0, 0]}
    />
  );
}

function Equipment({
  asset,
  selected,
  scanned,
  ooc,
  onSelect,
  onHover,
  reduced,
}: {
  asset: Asset;
  selected: boolean;
  scanned: boolean;
  ooc: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  reduced: boolean;
}) {
  const color = statusColors[asset.status] || statusColors.unknown;
  const moving = useRef<THREE.Group>(null);
  const ram = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (reduced || asset.status === 'stopped') return;
    if (moving.current)
      moving.current.children.forEach((box, index) => {
        box.position.x = ((clock.elapsedTime * 0.45 + index * 0.85) % 2.5) - 1.25;
      });
    if (ram.current) ram.current.position.y = Math.sin(clock.elapsedTime * 1.2) * 0.16;
  });
  return (
    <group
      position={[asset.position[0], asset.position[1], asset.position[2]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(asset.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(asset.id);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
    >
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[2.8, 2.6, 2.5]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Box
        position={[0, 0.08, 0]}
        size={[2.6, 0.16, 2.4]}
        color={selected ? '#405566' : '#2b4050'}
      />
      {ooc && <OocHalo reduced={reduced} />}
      {(selected || scanned) && !ooc && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]}>
          <ringGeometry args={[1.55, 1.59, 48]} />
          <meshBasicMaterial
            color={selected ? '#93bcf0' : '#b7f08a'}
            transparent
            opacity={selected ? 0.8 : 0.55}
          />
        </mesh>
      )}
      {asset.type === 'press' && (
        <>
          <Box position={[0, 0.4, 0]} size={[2, 0.55, 1.9]} color="#728592" metal />
          {[-0.8, 0.8].map((x) => (
            <Box key={x} position={[x, 1.55, 0]} size={[0.28, 2.15, 1.5]} color="#657b87" metal />
          ))}
          <Box position={[0, 2.6, 0]} size={[2.2, 0.6, 1.9]} color="#d7a474" />
          <Cylinder position={[0, 1.9, 0]} radius={0.28} length={0.8} color="#c7d1d5" />
          <group ref={ram}>
            <Box position={[0, 1.35, 0]} size={[1.55, 0.22, 1.2]} color="#c1ccd1" metal />
          </group>
          <Box position={[1.2, 1.5, 0.5]} size={[0.45, 0.8, 0.45]} color="#344951" />
        </>
      )}
      {asset.type === 'pump' && (
        <>
          <Box position={[0, 0.42, 0]} size={[1.8, 0.55, 1.2]} color="#657e8d" metal />
          <Cylinder position={[-0.2, 0.94, 0]} radius={0.55} length={1.4} color="#94a8b2" rotate />
          <Cylinder position={[0.8, 1.35, 0]} radius={0.17} length={0.8} color="#a5b5bf" />
          <Cylinder position={[-1, 0.92, 0]} radius={0.2} length={0.8} color="#a5b5bf" rotate />
          <Box position={[0.7, 0.9, 0.58]} size={[0.5, 0.6, 0.18]} color="#d3a478" />
        </>
      )}
      {asset.type === 'motor' && (
        <>
          <Box position={[0, 0.4, 0]} size={[1.9, 0.5, 1.4]} color="#657c8b" metal />
          <Cylinder position={[0, 0.95, 0]} radius={0.55} length={1.6} color="#6a939c" rotate />
          {[-0.6, -0.3, 0, 0.3, 0.6].map((x) => (
            <Cylinder
              key={x}
              position={[x, 0.95, 0]}
              radius={0.6}
              length={0.07}
              color="#99afb5"
              rotate
            />
          ))}
          <Box position={[0, 1.5, 0]} size={[0.6, 0.35, 0.6]} color="#6c8795" />
        </>
      )}
      {asset.type === 'conveyor' && (
        <>
          <Box position={[0, 0.7, 0]} size={[3.1, 0.2, 1.25]} color="#536c7b" />
          <Box position={[0, 0.84, 0]} size={[2.9, 0.08, 1.1]} color="#27383f" />
          {[-1.25, 1.25].flatMap((x) =>
            [-0.45, 0.45].map((z) => (
              <Box
                key={`${x}-${z}`}
                position={[x, 0.4, z]}
                size={[0.12, 0.65, 0.12]}
                color="#93a5ad"
                metal
              />
            )),
          )}
          <group ref={moving}>
            {[-0.65, 0.2, 0.85].map((x) => (
              <Box key={x} position={[x, 1.02, 0]} size={[0.4, 0.28, 0.55]} color="#c8b79d" />
            ))}
          </group>
        </>
      )}
      {asset.type === 'cooling' && (
        <>
          <Box position={[0, 0.85, 0]} size={[2, 1.5, 1.6]} color="#9aadb6" />
          {[-0.55, 0.55].map((x) => (
            <Cylinder key={x} position={[x, 1.65, 0]} radius={0.4} length={0.2} color="#354b5a" />
          ))}
          {[-0.4, -0.1, 0.2, 0.5].map((y) => (
            <Box key={y} position={[0, 0.9 + y, 0.81]} size={[1.6, 0.04, 0.05]} color="#405867" />
          ))}
        </>
      )}
      {asset.type === 'compressor' && (
        <>
          <Cylinder position={[0, 0.8, 0]} radius={0.6} length={1.8} color="#7a9daa" rotate />
          <Box position={[0, 1.5, 0]} size={[1.2, 0.6, 0.8]} color="#b9c4c7" />
          <Box position={[0, 0.25, 0]} size={[2.1, 0.3, 1.2]} color="#556e7c" />
        </>
      )}
      {asset.type === 'electrical' && (
        <>
          <Box position={[0, 1.25, 0]} size={[1.7, 2.3, 0.8]} color="#a3b3bb" />
          {[-0.42, 0.42].map((x) => (
            <Box key={x} position={[x, 1.3, 0.42]} size={[0.73, 1.95, 0.05]} color="#889eaa" />
          ))}
          <Box position={[0.3, 1.7, 0.47]} size={[0.25, 0.35, 0.05]} color="#304655" />
        </>
      )}
      {asset.type === 'goods' && (
        <>
          <Box position={[0, 0.3, 0]} size={[2, 0.28, 1.8]} color="#8b7963" />
          {[-0.5, 0.5].flatMap((x) =>
            [-0.4, 0.4].map((z) => (
              <Box
                key={`${x}-${z}`}
                position={[x, 0.87, z]}
                size={[0.85, 0.9, 0.65]}
                color="#b3a18a"
              />
            )),
          )}
        </>
      )}
      <mesh position={[0.95, 0.3, -0.95]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial
          color={ooc ? '#ff6b78' : color}
          emissive={ooc ? '#ff6b78' : color}
          emissiveIntensity={ooc ? 2.4 : 1.5}
        />
      </mesh>
      <AssetLabel
        id={asset.id}
        color={ooc ? '#ff6b78' : color}
        selected={selected || ooc}
        y={asset.type === 'press' ? 3.3 : 2.25}
      />
    </group>
  );
}

function CameraFocus({
  state,
  selected,
  focusRequest,
  preset,
  reduced,
}: {
  state: State;
  selected: string;
  focusRequest: number;
  preset: string;
  reduced: boolean;
}) {
  const { camera, controls } = useThree();
  const asset = state.assets.find((a) => a.id === selected) || state.assets[0];
  const [x, y, z] = asset.position;
  const bounds = plantBounds(state.assets);
  const group = state.assets.filter((item) => item.area_id === preset);
  const targetX = group.length
    ? group.reduce((sum, item) => sum + item.position[0], 0) / group.length
    : bounds.x;
  const targetZ = group.length
    ? group.reduce((sum, item) => sum + item.position[2], 0) / group.length
    : bounds.z;
  const overviewDistance = Math.max(bounds.width, bounds.depth) * 0.95;
  const destination = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useEffect(() => {
    if (!focusRequest || !controls) return;
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
    const target = preset === 'asset' ? [x, y + 0.8, z] : [targetX, 0, targetZ];
    const offset =
      preset === 'asset'
        ? [5, 4, 6]
        : preset === 'overview'
          ? [overviewDistance, overviewDistance, overviewDistance]
          : [10, 11, 14];
    const position = new THREE.Vector3(
      target[0] + offset[0],
      target[1] + offset[1],
      target[2] + offset[2],
    );
    destination.current = { position, target: new THREE.Vector3(...target) };
    if (reduced) {
      camera.position.copy(position);
      orbit.target.copy(destination.current.target);
      orbit.update();
      destination.current = null;
    }
  }, [
    camera,
    controls,
    focusRequest,
    selected,
    x,
    y,
    z,
    preset,
    reduced,
    targetX,
    targetZ,
    overviewDistance,
  ]);
  useFrame((_, delta) => {
    if (!destination.current || !controls) return;
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
    const alpha = 1 - Math.exp(-delta * 6);
    camera.position.lerp(destination.current.position, alpha);
    orbit.target.lerp(destination.current.target, alpha);
    orbit.update();
    if (camera.position.distanceTo(destination.current.position) < 0.02) destination.current = null;
  });
  return null;
}

function RenderBudget({ onSlowDevice }: { onSlowDevice?: () => void }) {
  const sample = useRef({ seconds: 0, frames: 0, checked: false });
  useEffect(() => {
    sample.current = { seconds: 0, frames: 0, checked: false };
  }, [onSlowDevice]);
  useFrame((_, delta) => {
    if (!onSlowDevice || sample.current.checked) return;
    sample.current.seconds += delta;
    sample.current.frames += 1;
    if (sample.current.seconds >= 2.5) {
      sample.current.checked = true;
      if (sample.current.frames / sample.current.seconds < 24) onSlowDevice();
    }
  });
  return null;
}

function SceneContent({
  state,
  selected,
  onSelect,
  reduced,
  focusRequest,
  preset,
  overlay,
  onSlowDevice,
  preview,
  isSimulation,
  simulationPaused,
}: {
  state: State;
  selected: string;
  onSelect: (id: string) => void;
  reduced: boolean;
  focusRequest: number;
  preset: string;
  overlay: 'health' | 'impact';
  onSlowDevice?: () => void;
  preview?: PlantPreview;
  isSimulation?: boolean;
  simulationPaused?: boolean;
}) {
  const { gl } = useThree();
  const bounds = plantBounds(state.assets);
  useEffect(() => {
    gl.domElement.setAttribute('aria-label', 'Interactive 3D manufacturing plant');
  }, [gl]);
  return (
    <>
      <color attach="background" args={['#b8c3c3']} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#e7f3fa', '#687976', 1.5]} />
      <directionalLight
        position={[bounds.x + 4, Math.max(16, bounds.depth), bounds.z + 8]}
        intensity={2.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-Math.max(bounds.width, bounds.depth)}
        shadow-camera-right={Math.max(bounds.width, bounds.depth)}
        shadow-camera-top={Math.max(bounds.width, bounds.depth)}
        shadow-camera-bottom={-Math.max(bounds.width, bounds.depth)}
        shadow-camera-far={1000}
        shadow-bias={-0.0005}
        shadow-autoUpdate={false}
        shadow-needsUpdate
      />
      <directionalLight position={[-10, 5, -3]} intensity={0.8} color="#8eb9d0" />
      {(state.configuration_version || 1) > 1 ? (
        <ConfiguredEnvironment key={state.configuration_version} state={state} />
      ) : (
        <FactoryEnvironment />
      )}
      <RenderBudget onSlowDevice={onSlowDevice} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.x, -0.4, bounds.z]} receiveShadow>
        <planeGeometry args={[bounds.width, bounds.depth]} />
        <meshStandardMaterial color="#293c46" roughness={0.9} />
      </mesh>
      {state.dependencies
        .filter(
          (d) =>
            state.affected.includes(d.target) &&
            (d.source === state.incident?.asset_id || state.affected.includes(d.source)) &&
            overlay === 'impact',
        )
        .map((d) => {
          const a = state.assets.find((a) => a.id === d.source)!;
          const b = state.assets.find((a) => a.id === d.target)!;
          return (
            <Line
              key={d.source + d.target}
              points={[
                [a.position[0], 0.22, a.position[2]],
                [b.position[0], 0.22, b.position[2]],
              ]}
              color="#ecaa67"
              lineWidth={3}
              dashed
              dashSize={0.35}
              gapSize={0.15}
            />
          );
        })}
      <BoxInstances limit={Math.max(160, state.assets.length * 20)} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial metalness={0.35} roughness={0.48} />
        <CylinderInstances limit={Math.max(100, state.assets.length * 12)} castShadow receiveShadow>
          <cylinderGeometry args={[1, 1, 1, 20]} />
          <meshStandardMaterial metalness={0.5} roughness={0.5} />
          {state.assets.map((a) => (
            <Equipment
              key={a.id}
              asset={a}
              selected={selected === a.id}
              scanned={preview?.scannedId === a.id}
              ooc={preview?.oocIds.includes(a.id) || false}
              onSelect={onSelect}
              onHover={preview?.onHover || (() => undefined)}
              reduced={
                reduced ||
                !!simulationPaused ||
                (!isSimulation && !!state.workspace) ||
                ['unknown', 'stopped', 'investigating'].includes(a.status)
              }
            />
          ))}
        </CylinderInstances>
      </BoxInstances>
      {preview?.actors?.map((actor) => (
        <OperatorFigure key={actor.id} actor={actor} reduced={reduced || !!simulationPaused} />
      ))}
      {preview?.focusId &&
        state.assets
          .filter((asset) => asset.id === preview.focusId)
          .map((asset) => (
            <PreviewMarker
              key={asset.id}
              asset={asset}
              readings={preview.readings[asset.id] || []}
            />
          ))}
      <OrbitControls
        makeDefault
        enablePan
        minDistance={3}
        maxDistance={Math.max(55, bounds.depth * 3, bounds.width * 3)}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.3}
        target={[bounds.x, 0, bounds.z]}
      />
      <CameraFocus
        state={state}
        selected={selected}
        focusRequest={focusRequest}
        preset={preset}
        reduced={reduced}
      />
    </>
  );
}

class SceneBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function PlantScene({
  state,
  selected,
  onSelect,
  planView,
  focusRequest,
  preset = 'asset',
  overlay = 'impact',
  quality = 'detail',
  onSlowDevice,
  preview,
  isSimulation = false,
  simulationPaused = false,
}: {
  state: State;
  selected: string;
  onSelect: (id: string) => void;
  planView: boolean;
  focusRequest: number;
  preset?: string;
  overlay?: 'health' | 'impact';
  quality?: 'detail' | 'balanced';
  onSlowDevice?: () => void;
  preview?: PlantPreview;
  isSimulation?: boolean;
  simulationPaused?: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const bounds = plantBounds(state.assets);
  const distance = Math.max(bounds.width, bounds.depth) * 0.95;
  useEffect(() => {
    const c = document.createElement('canvas');
    // Browser-only capability and preference detection; no subscription feedback loop.
    const probe = c.getContext('webgl2');
    setSupported(!!probe);
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const fallback = (
    <PlantPlan
      state={state}
      selected={selected}
      onSelect={onSelect}
      preview={preview}
      focusRequest={focusRequest}
    />
  );
  if (planView || !supported) return fallback;
  return (
    <SceneBoundary fallback={fallback}>
      <Canvas
        shadows={quality === 'detail'}
        key={state.configuration_version || 'demo'}
        camera={{
          position: [bounds.x + distance, distance, bounds.z + distance],
          fov: 42,
          near: 0.1,
          far: 1000,
        }}
        dpr={quality === 'detail' ? [1, 1.5] : 0.7}
        gl={{ antialias: false }}
      >
        <ContextLossFallback onLoss={() => setSupported(false)} />
        <SceneContent
          state={state}
          selected={selected}
          onSelect={onSelect}
          reduced={reduced}
          focusRequest={focusRequest}
          preset={preset}
          overlay={overlay}
          onSlowDevice={onSlowDevice}
          preview={preview}
          isSimulation={isSimulation}
          simulationPaused={simulationPaused}
        />
      </Canvas>
    </SceneBoundary>
  );
}
