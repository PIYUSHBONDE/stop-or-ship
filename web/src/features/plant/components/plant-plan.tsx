'use client';

import { useEffect, useRef } from 'react';
import type { State } from '@/lib/types';
import { plantBounds, planPoint, planPosition } from '@/lib/plant-layout';
import type { PlantPreview } from './plant-scene';
import { PreviewCard } from './preview-card';
import styles from './plant-plan.module.css';
import previewStyles from './plant-preview.module.css';

export function PlantPlan({
  state,
  selected,
  onSelect,
  preview,
  focusRequest,
}: {
  state: State;
  selected: string;
  onSelect: (id: string) => void;
  preview?: PlantPreview;
  focusRequest: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const selectedNode = useRef<HTMLButtonElement>(null);
  const bounds = plantBounds(state.assets);
  useEffect(() => {
    const container = viewport.current;
    const node = selectedNode.current;
    if (container && node) {
      container.scrollTo({
        left: node.offsetLeft - container.clientWidth / 2,
        top: node.offsetTop - container.clientHeight / 2,
      });
    }
  }, [selected, focusRequest]);

  return (
    <div className={`plan-view ${styles.plan}`} role="region" aria-label="Accessible plant plan">
      <div
        className={styles.viewport}
        ref={viewport}
        tabIndex={0}
        aria-label="Plant floor map; scroll to explore"
      >
        <div className={styles.board}>
          {state.areas.map((area) => {
            const points = state.assets
              .filter((asset) => asset.area_id === area.id)
              .map((asset) => planPosition(asset, bounds));
            if (!points.length) return null;
            const left = Math.min(...points.map((p) => p.x)) - 5;
            const top = Math.min(...points.map((p) => p.y)) - 9;
            return (
              <div
                key={area.id}
                className={styles.area}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${Math.max(...points.map((p) => p.x)) - left + 5}%`,
                  height: `${Math.max(...points.map((p) => p.y)) - top + 9}%`,
                }}
              >
                <span>{area.name}</span>
              </div>
            );
          })}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {state.dependencies.map((dependency) => {
              const source = state.assets.find((asset) => asset.id === dependency.source);
              const target = state.assets.find((asset) => asset.id === dependency.target);
              if (!source || !target) return null;
              const active = source.id === selected || target.id === selected;
              const utility =
                source.area_id !== target.area_id &&
                source.area_id !== 'line-a' &&
                source.area_id !== 'line-b';
              if (utility && !active) return null;
              const a = planPosition(source, bounds);
              const b = planPosition(target, bounds);
              const middle = (a.x + b.x) / 2;
              return (
                <path
                  key={`${source.id}:${target.id}`}
                  d={`M ${a.x} ${a.y} H ${middle} V ${b.y} H ${b.x}`}
                  className={`${styles.connection} ${active ? styles.activeConnection : ''} ${utility ? styles.utilityConnection : ''}`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {state.assets.map((asset) => {
            const p = planPosition(asset, bounds);
            const isSelected = selected === asset.id;
            return (
              <button
                key={asset.id}
                ref={isSelected ? selectedNode : undefined}
                aria-label={`${asset.id} ${asset.name}`}
                aria-pressed={isSelected}
                data-showing-readings={preview?.focusId === asset.id || undefined}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                className={`plan-asset ${isSelected ? 'selected' : ''} ${preview?.oocIds.includes(asset.id) ? previewStyles.planOoc : ''}`}
                onClick={() => onSelect(asset.id)}
                onMouseEnter={() => preview?.onHover(asset.id)}
                onMouseLeave={() => preview?.onHover(null)}
                onFocus={() => preview?.onHover(asset.id)}
                onBlur={() => preview?.onHover(null)}
              >
                {preview?.focusId === asset.id && (
                  <div className={previewStyles.planTip}>
                    <PreviewCard
                      id={asset.id}
                      name={asset.name}
                      readings={preview.readings[asset.id] || []}
                    />
                  </div>
                )}
                <span className={`dot ${asset.status}`} />
                <strong>{asset.id}</strong>
                <small>{asset.name}</small>
              </button>
            );
          })}
          {preview?.actors?.map((actor) => {
            const p = planPoint(actor.position, bounds);
            return (
              <span
                key={actor.id}
                className={styles.operator}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={actor.name}
              >
                {actor.label}
              </span>
            );
          })}
        </div>
      </div>
      <p className={styles.mapNote}>2D floor plan · Scroll to explore</p>
    </div>
  );
}
