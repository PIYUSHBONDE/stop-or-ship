'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { PreviewCaseDetail } from '@/features/incidents/components/preview-case-detail';
import { stateNames } from '@/lib/workflow';
import type { Incident, State } from '@/lib/types';
import type { MachineCase } from '@/features/monitoring/lib/preview-records';
import styles from '@/features/incidents/components/incidents.module.css';

const PAGE_SIZE = 5;

type Row =
  | { kind: 'preview'; id: string; sort: number; item: MachineCase }
  | { kind: 'operational'; id: string; sort: number; item: Incident };

export function IncidentsTable({
  state,
  IncidentDetail,
}: {
  state: State;
  IncidentDetail: ComponentType<{ state: State; incident: Incident; readOnly: boolean }>;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const preview = usePreviewDispatch();
  const requested = query.get('incident');
  const requestedCase = query.get('case');
  const rows = useMemo<Row[]>(() => {
    const previewRows: Row[] = preview.ledger.cases.map((item) => ({
      kind: 'preview',
      id: item.id,
      sort: item.occurredAt,
      item,
    }));
    const operational: Row[] = state.incidents.map((item) => ({
      kind: 'operational',
      id: item.id,
      sort: new Date(item.created_at).getTime(),
      item,
    }));
    return [...previewRows, ...operational].sort((left, right) => right.sort - left.sort);
  }, [preview.ledger.cases, state.incidents]);
  const expandedId = requested || requestedCase;
  const expandedIndex = rows.findIndex((row) => row.id === expandedId);
  const [page, setPage] = useState(() =>
    expandedIndex >= 0 ? Math.floor(expandedIndex / PAGE_SIZE) : 0,
  );
  useEffect(() => {
    if (expandedIndex >= 0) setPage(Math.floor(expandedIndex / PAGE_SIZE));
  }, [expandedIndex]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function toggle(row: Row) {
    if (expandedId === row.id) {
      router.replace('/incidents', { scroll: false });
      return;
    }
    const next = row.kind === 'preview' ? `preview=1&case=${row.id}` : `incident=${row.id}`;
    router.replace(`/incidents?${next}`, { scroll: false });
  }

  const numbers = Array.from({ length: pages }, (_, index) => index);
  return (
    <div className={styles.tableWrap}>
      <nav className={styles.pager} aria-label="Incident pages">
        <strong>
          {rows.length
            ? `Showing ${current * PAGE_SIZE + 1}–${Math.min(rows.length, (current + 1) * PAGE_SIZE)} of ${rows.length} cases`
            : 'No cases yet'}
        </strong>
        <div className={styles.pagerControls}>
          <button
            type="button"
            className={styles.pageButton}
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          {numbers.map((index) => (
            <button
              type="button"
              key={index}
              className={`${styles.pageButton} ${index === current ? styles.pageCurrent : ''}`}
              aria-current={index === current ? 'page' : undefined}
              onClick={() => setPage(index)}
            >
              {index + 1}
            </button>
          ))}
          <button
            type="button"
            className={styles.pageButton}
            aria-label="Next page"
            disabled={current >= pages - 1}
            onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </nav>
      <table className={styles.table}>
        <caption className="eyebrow">CASE TABLE</caption>
        <thead>
          <tr>
            <th />
            <th>Case</th>
            <th>Machine</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Occurred</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const open = expandedId === row.id;
            return (
              <CaseRows
                key={row.id}
                row={row}
                open={open}
                onToggle={() => toggle(row)}
                state={state}
                IncidentDetail={IncidentDetail}
              />
            );
          })}
          {!visible.length && (
            <tr>
              <td colSpan={6}>No preview OOC cases or operational incidents yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CaseRows({
  row,
  open,
  onToggle,
  state,
  IncidentDetail,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
  state: State;
  IncidentDetail: ComponentType<{ state: State; incident: Incident; readOnly: boolean }>;
}) {
  const preview = row.kind === 'preview' ? row.item : null;
  const incident = row.kind === 'operational' ? row.item : null;
  const machine = preview?.assetId || incident?.asset_id || '';
  const name = state.assets.find((asset) => asset.id === machine)?.name || machine;
  const owner = preview ? `${preview.operatorId} ${preview.operatorName}` : 'Operational case';
  const status = preview
    ? preview.interrupted
      ? 'interrupted'
      : preview.clearedAt
        ? 'cleared'
        : preview.fixedAt
          ? 'recovering'
          : preview.attendedAt
            ? 'attended'
            : 'assigned'
    : incident
      ? stateNames[incident.state]
      : '';
  const occurred = preview
    ? clock(preview.occurredAt)
    : incident
      ? new Date(incident.created_at).toLocaleString()
      : '';
  return (
    <>
      <tr className={open ? styles.rowOpen : undefined}>
        <td>
          <button
            className={styles.expand}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${row.id} details`}
            onClick={onToggle}
          >
            <ChevronDown size={18} />
          </button>
        </td>
        <td>
          <strong>{row.kind === 'preview' ? row.id : row.id.slice(0, 8).toUpperCase()}</strong>
          <small>{row.kind === 'preview' ? preview?.severity : 'operational'}</small>
        </td>
        <td>
          {machine}
          <small>{name}</small>
        </td>
        <td>{owner}</td>
        <td>{status}</td>
        <td>{occurred}</td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            {preview ? (
              <PreviewCaseDetail item={preview} />
            ) : incident ? (
              <IncidentDetail
                state={state}
                incident={incident}
                readOnly={
                  incident.id !== state.incident?.id ||
                  incident.state === 'resolved' ||
                  incident.record_origin !== 'plant_observation'
                }
              />
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
}

function clock(at: number) {
  return new Date(at).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}
