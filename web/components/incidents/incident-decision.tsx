'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react';
import { usePlant } from '@/components/session-provider';
import { money } from '@/lib/api';
import type { Calculation, Incident, Option } from '@/lib/types';
import styles from './incidents.module.css';

function assumptionRows(calculation: Calculation): { label: string; value: string }[] {
  const values = calculation.assumptions;
  const definitions = [
    ['horizon_minutes', 'Comparison horizon', 'min'],
    ['line_units_per_hour', 'Nominal capacity per line', 'parts / h'],
    ['degraded_line_units_per_hour', 'Degraded capacity per line', 'parts / h'],
    ['derated_line_units_per_hour', 'Derated capacity per line', 'parts / h'],
    ['margin_per_unit_paise', 'Contribution margin per part', 'INR'],
    ['repair_cost_paise', 'Planned repair expense', 'INR'],
    ['planned_repair_minutes', 'Planned repair duration', 'min'],
    ['window_in_minutes', 'Configured maintenance window', 'min from decision'],
    ['delivery_target_units', 'Delivery target per affected line', 'parts'],
    ['penalty_per_missing_unit_paise', 'Penalty per missing part', 'INR'],
    ['failure_extra_downtime_minutes', 'Additional failure downtime', 'min'],
    ['failure_damage_paise', 'Configured failure damage expense', 'INR'],
  ];
  return definitions.flatMap(([key, label, unit]) => {
    const value = values[key];
    return typeof value === 'number'
      ? [
          {
            label,
            value: unit === 'INR' ? money(value) : `${value.toLocaleString('en-IN')} ${unit}`,
          },
        ]
      : [];
  });
}

export function IncidentDecision({
  incident,
  readOnly,
}: {
  incident: Incident;
  readOnly: boolean;
}) {
  const { busy, connected, actForIncident, approve } = usePlant();
  const calculation = incident.calculation;
  const version = incident.calculation_version;
  const [draft, setDraft] = useState({ version, risk: calculation.risk_multiplier });
  const [selection, setSelection] = useState<{ version: string; id: Option['id'] | '' }>({
    version,
    id: '',
  });
  const [approver, setApprover] = useState('Maintenance manager');
  const [announcement, setAnnouncement] = useState('');
  const risk = draft.version === version ? draft.risk : calculation.risk_multiplier;
  const dirty = risk !== calculation.risk_multiplier;
  const selectedId =
    selection.version === version && selection.id
      ? selection.id
      : incident.work_order?.approval.option_id || calculation.recommended;
  const selected = calculation.options.find((option) => option.id === selectedId);
  const editable = !readOnly && ['awaiting_approval', 'approved'].includes(incident.state);
  const unavailable = busy || !connected;
  const rolesStale = incident.roles_calculation_version !== version;
  const authorized =
    !readOnly &&
    !dirty &&
    incident.state === 'approved' &&
    incident.work_order?.status === 'approved' &&
    incident.work_order.approval.calculation_version === version;
  const ready =
    !readOnly &&
    !unavailable &&
    !dirty &&
    incident.state === 'awaiting_approval' &&
    selected?.feasible &&
    approver.trim().length >= 2;

  async function submitApproval() {
    if (!ready || !selected) return;
    const succeeded = await approve(
      { option_id: selected.id, calculation_version: version, approver },
      incident.id,
    );
    setAnnouncement(
      succeeded
        ? 'Intervention approved. The current authorized work order is ready in Maintenance.'
        : 'Review the current decision and approval status before continuing.',
    );
  }

  return (
    <section id="decision-section" className={styles.section} aria-labelledby="decision-heading">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>02 / INTERVENTION</span>
          <h2 id="decision-heading" tabIndex={-1}>
            Choose the next move
          </h2>
        </div>
        <span className={styles.meta}>
          {Number(calculation.assumptions.horizon_minutes) / 60}-hour comparison · INR
        </span>
      </div>
      <p className={styles.intro}>
        Compare the same operating horizon. Apply hard constraints first, then consider the lowest
        configured expected cost.
      </p>
      {(incident.safety_stop || incident.safety_evidence.length > 0) && (
        <div className={styles.warning}>
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>
              {readOnly || incident.state === 'resolved'
                ? 'Recorded demo temperature constraint'
                : 'Demo temperature constraint is latched'}
            </strong>
            <p>
              {incident.safety_evidence
                .map((signal) => `${signal.value} ${signal.unit} on ${signal.asset_id}`)
                .join('; ') || 'Temperature threshold breached'}{' '}
              · configured limit{' '}
              {String(calculation.assumptions.configured_temperature_stop_celsius)} °C.
              Continued-operation options are unavailable until verified recovery. This is a
              simulated rule.
            </p>
          </div>
        </div>
      )}
      {incident.decision_changed_reason && (
        <p className={styles.changeNotice}>
          <TriangleAlert size={14} aria-hidden="true" />
          {incident.decision_changed_reason}
        </p>
      )}
      <div className={styles.roles}>
        {incident.diagnosis?.roles.length ? (
          incident.diagnosis.roles.map((role) => (
            <article key={role.role}>
              <span className={styles.eyebrow}>{role.role.toUpperCase()}</span>
              <h3>
                {calculation.options.find((option) => option.id === role.preferred_option)?.name ||
                  'Position unavailable'}
              </h3>
              <p>{role.explanation}</p>
              {rolesStale && (
                <span className={styles.stale}>Earlier comparison · explanation needs review</span>
              )}
            </article>
          ))
        ) : (
          <p className={styles.note}>
            Specialist explanations are unavailable. The calculated comparison remains available.
          </p>
        )}
      </div>
      <div
        className={styles.tableScroll}
        role="region"
        aria-label="Intervention cost comparison"
        tabIndex={0}
      >
        <table className={styles.optionTable}>
          <caption className="sr-only">
            Configured expected costs in Indian rupees, over the same eight-hour horizon
          </caption>
          <thead>
            <tr>
              <th scope="col">Intervention</th>
              <th scope="col">Repair</th>
              <th scope="col">Lost margin</th>
              <th scope="col">Penalty</th>
              <th scope="col">Failure exposure</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {calculation.options.map((option) => (
              <tr
                key={option.id}
                data-selected={selectedId === option.id}
                data-feasible={option.feasible}
              >
                <th scope="row">
                  <label className={styles.optionLabel}>
                    <input
                      type="radio"
                      name={`option-${incident.id}`}
                      aria-label={option.name}
                      checked={selectedId === option.id}
                      disabled={!editable || unavailable || !option.feasible}
                      onChange={() => setSelection({ version, id: option.id })}
                    />
                    <span>
                      <strong>{option.name}</strong>
                      {option.id === calculation.recommended && (
                        <small className={styles.lowest}>Lowest feasible cost</small>
                      )}
                      <small>
                        {option.downtime_minutes} min planned outage · {option.lost_units} parts
                        shortfall
                      </small>
                      <small>
                        {(option.failure_probability * 100).toLocaleString('en-IN', {
                          maximumFractionDigits: 2,
                        })}
                        % assumed failure risk
                      </small>
                      {option.constraint && (
                        <small className={styles.constraint}>{option.constraint}</small>
                      )}
                    </span>
                  </label>
                </th>
                <td>{money(option.repair_cost_paise)}</td>
                <td>{money(option.lost_margin_paise)}</td>
                <td>{money(option.penalty_paise)}</td>
                <td>{money(option.failure_exposure_paise)}</td>
                <td>
                  <strong>{money(option.total_paise)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className={styles.assumptions}>
        <summary>
          <ChevronDown size={15} aria-hidden="true" />
          Calculation assumptions and sensitivity
        </summary>
        <p className={styles.note}>
          Production economics, durations and failure probabilities are configured assumptions, not
          calibrated predictions. Each affected line is counted once; failure exposure includes only
          additional loss.
        </p>
        <dl>
          {assumptionRows(calculation).map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        {calculation.sensitivity.length > 0 && (
          <div className={styles.sensitivity}>
            {calculation.sensitivity.map((entry) => (
              <p key={entry.multiplier}>
                {entry.multiplier}× assumed risk →{' '}
                {calculation.options.find((option) => option.id === entry.recommended)?.name}
              </p>
            ))}
          </div>
        )}
      </details>
      {editable && (
        <div className={styles.riskControls}>
          <label htmlFor="incident-risk">
            Risk assumption multiplier <strong>{risk.toFixed(2)}×</strong>
            <input
              id="incident-risk"
              type="range"
              min="0.25"
              max="3"
              step="0.25"
              value={risk}
              disabled={unavailable}
              onChange={(event) => {
                setDraft({ version, risk: Number(event.target.value) });
                setAnnouncement('');
              }}
            />
          </label>
          <div>
            <button
              className="secondary"
              disabled={unavailable || !dirty}
              onClick={async () => {
                setAnnouncement('');
                await actForIncident(incident.id, '/calculate', { risk_multiplier: risk });
              }}
            >
              Recalculate
            </button>
            <button
              className="text-button"
              disabled={unavailable || !dirty}
              onClick={() => setDraft({ version, risk: calculation.risk_multiplier })}
            >
              Discard changes
            </button>
          </div>
          {dirty && (
            <p className={styles.dirty} role="alert">
              Unapplied changes. Recalculate or discard them before approval.
            </p>
          )}
        </div>
      )}
      {!readOnly && (
        <div className={styles.approval}>
          {authorized ? (
            <div className={styles.authorized}>
              <Check size={22} aria-hidden="true" />
              <div>
                <strong>{incident.work_order?.id} authorized</strong>
                <p>
                  {incident.work_order?.option.name} · approved by{' '}
                  {incident.work_order?.approval.approver}
                </p>
              </div>
              <Link className="primary" href={`/maintenance?incident=${incident.id}`}>
                <Wrench size={15} />
                Open authorized work order
              </Link>
            </div>
          ) : (
            <>
              <div className={styles.approvalSummary}>
                <span className={styles.eyebrow}>HUMAN APPROVAL</span>
                <strong>
                  {selected?.name} · {selected ? money(selected.total_paise) : 'Unavailable'}
                </strong>
                <p>
                  Saved risk assumption {calculation.risk_multiplier.toFixed(2)}× · comparison
                  revision {incident.calculation_revision}
                </p>
              </div>
              <label className="field-label">
                Approver
                <input
                  aria-label="Approver"
                  value={approver}
                  maxLength={80}
                  disabled={readOnly || unavailable || incident.state !== 'awaiting_approval'}
                  onChange={(event) => setApprover(event.target.value)}
                />
              </label>
              <div className={styles.approvalButtons}>
                <button className="primary" disabled={!ready} onClick={submitApproval}>
                  <ShieldCheck size={16} />
                  Approve selected intervention
                </button>
                <button
                  className="text-button"
                  disabled={unavailable || incident.state !== 'awaiting_approval'}
                  onClick={() => actForIncident(incident.id, '/reject')}
                >
                  Reject proposal
                </button>
              </div>
              {incident.state === 'proposal_rejected' && (
                <button
                  className="secondary"
                  disabled={unavailable}
                  onClick={() => actForIncident(incident.id, '/reopen')}
                >
                  Reopen for review
                </button>
              )}
              {!['awaiting_approval', 'approved', 'proposal_rejected'].includes(incident.state) && (
                <p className={styles.note}>
                  {['repairing', 'verifying', 'resolved'].includes(incident.state)
                    ? 'This intervention has progressed beyond approval. Its original authorization remains in the work order.'
                    : 'Approval becomes available after the investigation completes.'}
                </p>
              )}
            </>
          )}
          {announcement && (
            <p className={styles.note} aria-live="polite">
              {announcement}
            </p>
          )}
          <p className={styles.note}>
            Approval authorizes simulated maintenance only. Calculations and workflow transitions
            are controlled by the application.
          </p>
        </div>
      )}
      {readOnly && (
        <p className={styles.readOnly}>Historical comparison and authorization · read-only case</p>
      )}
      {readOnly && incident.work_order && (
        <div className={styles.approvalSummary}>
          <span className={styles.eyebrow}>RECORDED AUTHORIZATION</span>
          <strong>
            {incident.work_order.id} · {incident.work_order.option.name}
          </strong>
          <p>
            Approved by {incident.work_order.approval.approver} ·{' '}
            {new Date(incident.work_order.approval.timestamp).toLocaleString('en-IN')} ·{' '}
            {incident.work_order.status.replaceAll('_', ' ')}
          </p>
        </div>
      )}
      {incident.superseded_work_orders.length > 0 && (
        <details className={styles.audit}>
          <summary>Superseded authorizations · {incident.superseded_work_orders.length}</summary>
          {incident.superseded_work_orders.map((order) => (
            <p key={order.approval.calculation_version}>
              {order.id} · {order.option.name}
              <small>
                {order.superseded_reason} · inactive · approved by {order.approval.approver}
              </small>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
