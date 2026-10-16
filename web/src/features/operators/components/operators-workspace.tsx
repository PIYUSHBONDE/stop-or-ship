'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ChevronDown, MapPin } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import {
  OPERATORS,
  PHASE_COPY,
  selectAssignment,
  type AssignmentPhase,
} from '@/features/operators/lib/preview-dispatch';
import { FloorPositionMap } from './floor-position-map';
import styles from './operators.module.css';

const STEPS = ['Assigned', 'Travel', 'Inspect', 'Correct', 'Verify', 'Return'];
const PHASE_STEP: Record<AssignmentPhase, number> = {
  dispatched: 0,
  en_route: 1,
  on_site: 2,
  correcting: 3,
  recovering: 4,
  cleared: 5,
  returning: 5,
  returned: 6,
};

function number(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function signalLabel(id: string) {
  const label = id.replaceAll('_', ' ');
  return (label[0]?.toUpperCase() ?? '') + label.slice(1);
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export function OperatorsWorkspace() {
  const { state, selectAsset } = usePlant();
  const preview = usePreviewDispatch();
  const query = useSearchParams();
  const selected = selectAssignment(
    preview.assignments,
    preview.history,
    query.get('assignment') || query.get('operator'),
  );
  if (!state) return null;

  const available = OPERATORS.filter(
    (operator) => !preview.assignments.some((item) => item.operatorId === operator.id),
  ).length;
  const historical = selected ? preview.history.some((item) => item.id === selected.id) : false;
  const asset = selected ? state.assets.find((item) => item.id === selected.assetId) : null;
  const person = selected
    ? OPERATORS.find((operator) => operator.id === selected.operatorId)
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Operators</h1>
          <p>Follow the simulated response from assignment through recovery.</p>
        </div>
        <Link className={styles.plantLink} href="/plant">
          View plant floor <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>

      <p className={styles.sourceNote}>
        <span className={styles.sourceDot} aria-hidden="true" />
        <span>
          <strong>{preview.process?.paused ? 'Simulation paused.' : 'Simulation running.'}</strong>{' '}
          Assignments and movement are generated in this browser; no staff are dispatched.
        </span>
      </p>

      <div className={styles.summary} aria-label="Simulated dispatch summary">
        <div>
          <strong>{preview.assignments.length} active</strong>
          <span>{preview.assignments.length === 1 ? 'assignment' : 'assignments'}</span>
        </div>
        <div>
          <strong>
            {available} of {OPERATORS.length}
          </strong>
          <span>available</span>
        </div>
        <div>
          <strong>{preview.oocIds.length}</strong>
          <span>equipment out of range now</span>
        </div>
        <p>Assignments can remain open while readings recover and the operator returns.</p>
      </div>

      <div className={`${styles.layout} ${!selected ? styles.layoutIdle : ''}`}>
        <section className={styles.response} aria-label="Simulated response">
          {selected ? (
            <>
              <div className={styles.responseHeader}>
                <h2>{historical ? 'Completed response' : 'Active response'}</h2>
                <span className={styles.phaseBadge} role="status">
                  {selected.id} · {PHASE_COPY[selected.phase]}
                </span>
              </div>
              <div className={styles.responseBody}>
                <h3>{asset?.name || selected.assetId}</h3>
                <p className={styles.assignmentMeta}>
                  {selected.assetId} ·{' '}
                  <Link href={`/operators?assignment=${encodeURIComponent(selected.id)}`}>
                    {selected.id}
                  </Link>{' '}
                  · {selected.severity} severity
                </p>
                <div className={styles.reading}>
                  <div>
                    <span>{signalLabel(selected.signalId)} at detection</span>
                    <strong>
                      {number(selected.value)} <small>{selected.unit}</small>
                    </strong>
                  </div>
                  <div className={styles.reference}>
                    <span>Synthetic reference</span>
                    <strong>
                      {number(selected.low)}–{number(selected.high)} {selected.unit}
                    </strong>
                  </div>
                </div>
                <div className={styles.assignee}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(person?.name || selected.operatorId)}
                  </span>
                  <div>
                    <strong>
                      {person?.name || selected.operatorId} · {selected.operatorId}
                    </strong>
                    <span>
                      {person?.craft || 'Operator'}
                      {person ? ` · ${person.years} years` : ''}
                    </span>
                  </div>
                  <span className={styles.assigneeState}>{PHASE_COPY[selected.phase]}</span>
                </div>
              </div>
              <div className={styles.timelineWrap}>
                <div className={styles.timelineHeading}>
                  <strong>Response progress</strong>
                  <span>Simulated phases</span>
                </div>
                <ol className={styles.timeline} aria-label="Response phases">
                  {STEPS.map((step, index) => (
                    <li
                      key={step}
                      className={
                        index < PHASE_STEP[selected.phase]
                          ? styles.stepDone
                          : index === PHASE_STEP[selected.phase]
                            ? styles.stepCurrent
                            : ''
                      }
                      aria-current={index === PHASE_STEP[selected.phase] ? 'step' : undefined}
                    >
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
              <div className={styles.responseFooter}>
                <small>This simulated dispatch does not create a work order.</small>
                <Link href="/plant" onClick={() => selectAsset(selected.assetId)}>
                  See {selected.assetId} in Plant <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </>
          ) : (
            <div className={styles.emptyResponse}>
              <h2>No active response</h2>
              <p>
                {preview.oocIds.length
                  ? 'Synthetic readings are out of range, but no assignment is open. Check the affected equipment in Plant.'
                  : 'The team is available. The next simulated equipment fault will create an assignment here.'}
              </p>
              <Link href="/plant">
                View plant floor <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          )}
          {preview.assignments.length > 1 && (
            <div className={styles.otherAssignments}>
              <h3>Other active responses</h3>
              {preview.assignments
                .filter((item) => item.id !== selected?.id)
                .map((item) => (
                  <Link key={item.id} href={`/operators?assignment=${encodeURIComponent(item.id)}`}>
                    <strong>{item.assetId}</strong>
                    <span>{PHASE_COPY[item.phase]}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                ))}
            </div>
          )}
        </section>

        <aside className={styles.side}>
          <section className={styles.rosterPanel} aria-label="Operator roster">
            <h2>Team availability</h2>
            <p>Five named operators in this simulated plant.</p>
            <div className={styles.roster}>
              {OPERATORS.map((operator) => {
                const job = preview.assignments.find((item) => item.operatorId === operator.id);
                const content = (
                  <>
                    <span
                      className={`${styles.avatar} ${job ? styles.avatarBusy : ''}`}
                      aria-hidden="true"
                    >
                      {initials(operator.name)}
                    </span>
                    <span className={styles.rosterPerson}>
                      <strong>
                        {operator.name} · {operator.id}
                      </strong>
                      <small>
                        {operator.craft} · {operator.years} years
                      </small>
                    </span>
                    <span className={`${styles.rosterState} ${job ? styles.rosterBusy : ''}`}>
                      {job ? `On ${job.assetId}` : 'Available'}
                    </span>
                  </>
                );
                return job ? (
                  <Link
                    className={styles.rosterRow}
                    href={`/operators?assignment=${encodeURIComponent(job.id)}`}
                    key={operator.id}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className={styles.rosterRow} key={operator.id}>
                    {content}
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.mapPanel} aria-label="Simulated operator positions">
            <h2>Floor position</h2>
            <p>Schematic positions of equipment and simulated operators.</p>
            <FloorPositionMap
              assets={state.assets}
              actors={preview.actors}
              selectedAsset={selected?.assetId}
              selectedOperator={selected?.operatorId}
              oocIds={preview.oocIds}
            />
            <div className={styles.mapFooter}>
              <span>
                <MapPin size={13} aria-hidden="true" />
                {selected
                  ? `${selected.operatorId} · ${PHASE_COPY[selected.phase]} at ${selected.assetId}`
                  : 'Operators at their stations'}
              </span>
              <Link href="/plant" onClick={() => selected && selectAsset(selected.assetId)}>
                Open full plant <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
          </section>
        </aside>

        <section className={styles.historyPanel} aria-label="Recent simulated responses">
          {preview.history.length > 0 ? (
            <details className={styles.historyDisclosure}>
              <summary>
                <span>
                  <h2>Recent simulated responses</h2>
                  <span className={styles.historyDescription}>
                    {preview.history.length} saved responses. Select one to review its assignment.
                  </span>
                </span>
                <span className={styles.historyToggle}>
                  View history <ChevronDown size={15} aria-hidden="true" />
                </span>
              </summary>
              <ol>
                {preview.history.map((item) => {
                  const operator = OPERATORS.find((person) => person.id === item.operatorId);
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/operators?assignment=${encodeURIComponent(item.id)}`}
                        aria-current={selected?.id === item.id ? 'true' : undefined}
                      >
                        <strong>{item.assetId}</strong>
                        <span className={styles.historyPerson}>
                          {operator?.name || item.operatorId}
                        </span>
                        <span>{item.id}</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </details>
          ) : (
            <div>
              <h2>Recent simulated responses</h2>
              <p>No completed responses yet. Finished assignments will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
