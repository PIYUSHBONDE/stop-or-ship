'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Users } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import {
  OPERATORS,
  PHASE_COPY,
  type LiveAssignment,
} from '@/features/operators/lib/preview-dispatch';
import { plantBounds, planPoint, planPosition } from '@/lib/plant-layout';
import styles from '@/features/operators/components/operators.module.css';

export function OperatorsWorkspace() {
  const { state, selectAsset } = usePlant();
  const preview = usePreviewDispatch();
  const query = useSearchParams();
  const requested = query.get('assignment') || query.get('operator');
  const selected =
    preview.assignments.find((item) => item.id === requested || item.operatorId === requested) ||
    preview.assignments[0] ||
    preview.history.find((item) => item.id === requested || item.operatorId === requested);
  if (!state) return null;
  const bounds = plantBounds(state.assets);
  const available = OPERATORS.filter(
    (operator) => !preview.assignments.some((item) => item.operatorId === operator.id),
  ).length;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">
            SYNTHETIC DISPATCH <span className="live-tag">LIVE MONITOR</span>
          </span>
          <h1>Operators</h1>
          <p>
            Preview OOC cells assign a named operator from experience and severity. IDs stay on this
            board while the person walks the plant floor and clears the excursion. This does not
            authorize maintenance or write work orders.
          </p>
        </div>
        <Link className="secondary" href="/plant">
          Watch plant floor <ArrowRight size={15} />
        </Link>
      </header>
      <div className={styles.metrics}>
        <div>
          <small>Available operators</small>
          <strong>
            {available} / {OPERATORS.length}
          </strong>
        </div>
        <div>
          <small>Open assignments</small>
          <strong>{preview.assignments.length}</strong>
        </div>
        <div>
          <small>Preview OOC cells</small>
          <strong>{preview.oocIds.length}</strong>
        </div>
        <div>
          <small>Cleared this session</small>
          <strong>{preview.history.length}</strong>
        </div>
      </div>
      <div className={styles.grid}>
        <section className={styles.panel} aria-label="Live assignments">
          <h2>Assignment IDs</h2>
          {preview.assignments.length ? (
            preview.assignments.map((item) => (
              <AssignmentCard key={item.id} item={item} active={selected?.id === item.id} />
            ))
          ) : (
            <p className="muted">Waiting for the next preview OOC. Operators stay on standby.</p>
          )}
          {selected && <LiveDetail item={selected} onWatch={() => selectAsset(selected.assetId)} />}
          {preview.history.length > 0 && (
            <ol className={styles.history}>
              {preview.history.map((item) => {
                const operator = OPERATORS.find((person) => person.id === item.operatorId);
                return (
                  <li key={item.id}>
                    <span>
                      {item.id} · {operator?.name} cleared {item.assetId}
                    </span>
                    <span>{item.severity}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <aside>
          <section className={styles.panel} aria-label="Operator roster">
            <h2>
              <Users size={18} /> Roster
            </h2>
            <div className={styles.roster}>
              {OPERATORS.map((operator) => {
                const job = preview.assignments.find((item) => item.operatorId === operator.id);
                return (
                  <div className={styles.operator} key={operator.id}>
                    <div>
                      <strong>
                        {operator.id} · {operator.name}
                      </strong>
                      <small>
                        {operator.years} years · {operator.craft}
                      </small>
                    </div>
                    <span className={styles.badge}>
                      {job ? `${PHASE_COPY[job.phase]} · ${job.id}` : 'Standby'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className={styles.map} aria-label="Live operator map">
            <h2>Floor track</h2>
            <p className="muted">Operator IDs move to the flashing cell, then return.</p>
            <div className={styles.board}>
              {state.assets.map((asset) => {
                const point = planPosition(asset, bounds);
                return (
                  <span
                    key={asset.id}
                    className={`${styles.cell} ${preview.oocIds.includes(asset.id) ? styles.ooc : ''}`}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  >
                    {asset.id}
                  </span>
                );
              })}
              {preview.actors.map((actor) => {
                const point = planPoint(actor.position, bounds);
                return (
                  <span
                    key={actor.id}
                    className={styles.actor}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    title={`${actor.id} ${PHASE_COPY[actor.phase]}`}
                  >
                    {actor.id}
                  </span>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function AssignmentCard({ item, active }: { item: LiveAssignment; active: boolean }) {
  const operator = OPERATORS.find((person) => person.id === item.operatorId);
  return (
    <Link
      href={`/operators?assignment=${item.id}`}
      className={`${styles.card} ${active ? styles.active : ''}`}
    >
      <strong>{item.id}</strong>
      <small>
        {operator?.id} {operator?.name} · {operator?.years}y · {item.severity}
      </small>
      <small>
        {PHASE_COPY[item.phase]} · {item.assetId} · {item.signalId.replaceAll('_', ' ')}{' '}
        {item.value} {item.unit}
      </small>
    </Link>
  );
}

function LiveDetail({ item, onWatch }: { item: LiveAssignment; onWatch: () => void }) {
  const operator = OPERATORS.find((person) => person.id === item.operatorId);
  const total = item.elapsedMs + item.remainingMs;
  const ratio = total ? Math.min(1, item.elapsedMs / total) : 0;
  const copy = useMemo(() => {
    if (item.phase === 'en_route' || item.phase === 'dispatched')
      return `${operator?.id} is going to ${item.assetId} to correct ${item.signalId.replaceAll('_', ' ')} OOC.`;
    if (item.phase === 'on_site' || item.phase === 'correcting')
      return `${operator?.id} is on ${item.assetId} correcting the preview excursion.`;
    if (item.phase === 'cleared') return `${item.id} cleared. ${operator?.id} is leaving the cell.`;
    if (item.phase === 'returning')
      return `${operator?.id} is returning to station after ${item.id}.`;
    return `${item.id} is complete.`;
  }, [item, operator?.id]);
  return (
    <div className={styles.live} role="status">
      <strong>
        {item.id} · {PHASE_COPY[item.phase]}
      </strong>
      <small>{copy}</small>
      <div className={styles.track} aria-hidden="true">
        <i className={styles.pip} style={{ left: `${ratio * 100}%` }} />
      </div>
      <small>
        {item.severity} · {item.signalId.replaceAll('_', ' ')} {item.value} {item.unit} outside{' '}
        {item.low}–{item.high} · synthetic dispatch
      </small>
      <Link className="secondary" href="/plant" onClick={onWatch}>
        Watch {operator?.id} on the plant floor <ArrowRight size={14} />
      </Link>
    </div>
  );
}
