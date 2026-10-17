'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import Sparkline from '@/components/ui/sparkline';
import { usePlant } from '@/providers/plant-session-provider';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import {
  diagnosePreview,
  limitWords,
  readingEpisodes,
} from '@/features/monitoring/lib/preview-diagnosis';
import { seriesFor } from '@/features/monitoring/lib/preview-records';
import styles from '@/features/monitoring/components/machine-records.module.css';
import pageStyles from '@/components/layout/workspace.module.css';

const SAMPLE_PAGE = 6;
const CASE_PAGE = 3;

export function MachineRecordPage({ assetId }: { assetId: string }) {
  const { state, selectAsset } = usePlant();
  const preview = usePreviewDispatch();
  const [samplePage, setSamplePage] = useState(0);
  const [casePage, setCasePage] = useState(0);
  const [detailPage, setDetailPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const asset = state?.assets.find((item) => item.id === assetId);
  useEffect(() => {
    if (assetId) selectAsset(assetId);
    setSamplePage(0);
    setCasePage(0);
    setDetailId(null);
  }, [assetId, selectAsset]);
  useEffect(() => {
    const dialog = detailDialog.current;
    if (!dialog) return;
    if (detailId && !dialog.open) dialog.showModal();
    else if (!detailId && dialog.open) dialog.close();
  }, [detailId]);
  if (!state) return null;
  if (!asset)
    return (
      <div className={pageStyles.page}>
        <h1>Machine not found</h1>
        <p>That equipment is not in this plant catalog.</p>
        <Link className="secondary" href="/monitoring">
          <ArrowLeft size={15} /> Back to lines
        </Link>
      </div>
    );
  const samples = preview.ledger.samples[asset.id] || [];
  const latest = samples.at(-1)?.readings || preview.readings[asset.id] || [];
  const cases = preview.ledger.cases.filter((item) => item.assetId === asset.id);
  const ooc = preview.oocIds.includes(asset.id);
  const episodes = [...readingEpisodes(samples)].reverse();
  const diagnosis = diagnosePreview(
    asset.type,
    samples,
    cases.map((item) => ({
      id: item.id,
      signalId: item.signalId,
      fixed: !item.interrupted && !!item.fixedAt,
      taskTitle: item.message,
    })),
  );
  const area = state.areas.find((item) => item.id === asset.area_id);
  const matched = diagnosis.branches.find((branch) => branch.matched);
  const suggested = matched?.tasks.find((task) => task.state === 'suggested');
  const used = matched?.tasks.filter((task) => task.state === 'done') ?? [];
  const later = matched?.tasks.filter((task) => task.state === 'later') ?? [];
  const otherBranches = diagnosis.branches.filter((branch) => !branch.matched);
  const openDetails = (id: string) => {
    setDetailPage(0);
    setDetailId(id);
  };
  const detailEpisode = episodes.find((episode) => episode.id === detailId);
  const detailSamples = [
    ...(detailId === 'all' ? samples : (detailEpisode?.samples ?? [])),
  ].reverse();
  return (
    <div className={pageStyles.page}>
      <header className={pageStyles.heading}>
        <div>
          <span className="eyebrow">
            {area?.name || asset.area_id} <span className="live-tag">{asset.id}</span>
          </span>
          <h1>{asset.name}</h1>
          <p>
            {samples.length} stored records · {ooc ? 'outside the limit' : 'inside the limit'}.
            These readings do not authorize work.
          </p>
        </div>
        <Link className="secondary" href="/monitoring">
          <ArrowLeft size={15} /> All lines
        </Link>
      </header>

      <section className={styles.panel} aria-labelledby="machine-overview">
        <h2 id="machine-overview">Current readings</h2>
        <p>The latest number for each signal. The chart for that signal is below.</p>
        <div className={styles.readings}>
          {latest.map((reading) => (
            <div className={styles.factor} key={reading.signal_id}>
              <strong>
                {reading.signal_id.replaceAll('_', ' ')}
                <b>
                  {reading.value} {reading.unit}
                </b>
              </strong>
              <small>{limitWords(reading)}</small>
            </div>
          ))}
          {!latest.length && <p>Waiting for the first reading.</p>}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="machine-signals">
        <h2 id="machine-signals">Signals</h2>
        <p>One chart per signal, all on this page.</p>
        <div className={styles.signalGrid}>
          {latest.map((reading) => (
            <article className={styles.signal} key={reading.signal_id}>
              <header>
                <h3>{reading.signal_id.replaceAll('_', ' ')}</h3>
                <strong className={reading.ooc ? styles.oocMark : undefined}>
                  {reading.value} {reading.unit}
                </strong>
                <small>{limitWords(reading)}</small>
              </header>
              <Sparkline
                label={`${asset.id} ${reading.signal_id} history`}
                color={reading.ooc ? '#ff8a5b' : '#73d8b7'}
                values={seriesFor(samples, reading.signal_id)}
              />
            </article>
          ))}
          {!latest.length && <p>Waiting for the first reading.</p>}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="machine-cause">
        <h2 id="machine-cause">What the readings point to</h2>
        {!diagnosis.active || !matched ? (
          <p>{diagnosis.summary}</p>
        ) : (
          <div className={styles.causeStack}>
            <div>
              <h3>What is wrong</h3>
              <p>
                {matched.title}. {matched.when}.
              </p>
            </div>
            <div>
              <h3>Signals it points at</h3>
              <ul className={styles.points}>
                {matched.points
                  .filter((point) => point.pointed)
                  .map((point) => (
                    <li key={point.signalId} data-pointed="true">
                      {point.label}
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <h3>Do this now</h3>
              {suggested ? (
                <p>
                  <strong>{suggested.title}</strong>
                  <small>{suggested.why}</small>
                </p>
              ) : (
                <p>
                  Those checks are already recorded, and the readings are still outside the limit.
                  Inspect the whole machine.
                </p>
              )}
            </div>
            {used.length > 0 && (
              <div>
                <h3>Already used</h3>
                <ul className={styles.tasks}>
                  {used.map((task) => (
                    <li key={task.title} data-state="done">
                      <strong>{task.title}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(later.length > 0 || otherBranches.length > 0) && (
              <details className={styles.otherChecks}>
                <summary>Other checks</summary>
                {later.length > 0 && (
                  <ul className={styles.tasks}>
                    {later.map((task) => (
                      <li key={task.title} data-state="later">
                        <strong>{task.title}</strong>
                        <small>{task.why}</small>
                      </li>
                    ))}
                  </ul>
                )}
                {otherBranches.length > 0 && (
                  <ul className={styles.otherBranches}>
                    {otherBranches.map((branch) => (
                      <li key={branch.id}>
                        <strong>{branch.title}</strong>
                        <small>Not this pattern. {branch.when}.</small>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="machine-samples">
        <h2 id="machine-samples">What changed</h2>
        <p>Consecutive samples with the same pattern are one stretch, newest first.</p>
        <button type="button" className={styles.detailLink} onClick={() => openDetails('all')}>
          Details · {samples.length} hidden sample{samples.length === 1 ? '' : 's'}
        </button>
        <Pager
          label="Reading stretches"
          page={samplePage}
          total={episodes.length}
          pageSize={SAMPLE_PAGE}
          onPage={setSamplePage}
        />
        <div className={styles.episodes}>
          {pageOf(episodes, samplePage, SAMPLE_PAGE).map((episode) => (
            <article key={episode.id} className={styles.episode}>
              <strong>{episode.title}</strong>
              <small>
                {clock(episode.from)}
                {episode.to !== episode.from ? ` – ${clock(episode.to)}` : ''} · {episode.count}{' '}
                sample{episode.count === 1 ? '' : 's'}
              </small>
              <p>{episode.summary}</p>
              <button
                type="button"
                className={styles.detailLink}
                onClick={() => openDetails(episode.id)}
              >
                Details · {episode.count} sample{episode.count === 1 ? '' : 's'}
              </button>
            </article>
          ))}
          {!episodes.length && <p>Waiting for the first reading.</p>}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="machine-cases">
        <h2 id="machine-cases">Case history</h2>
        <p>Preview assignments for this machine only.</p>
        <Pager
          label="Case pages"
          page={casePage}
          total={cases.length}
          pageSize={CASE_PAGE}
          onPage={setCasePage}
        />
        <div className={styles.cases}>
          {pageOf(cases, casePage, CASE_PAGE).map((item) => (
            <article className={styles.case} key={item.id}>
              <strong>
                {item.id} · {item.operatorId} {item.operatorName}
              </strong>
              <small>
                {item.signalId.replaceAll('_', ' ')} {item.value} {item.unit} · {item.severity} ·{' '}
                {item.interrupted
                  ? 'interrupted simulation'
                  : item.clearedAt
                    ? `recovered ${clock(item.clearedAt)}`
                    : item.fixedAt
                      ? `checking recovery · repaired ${clock(item.fixedAt)}`
                      : `assigned ${clock(item.openedAt)} · fix takes at least 2 minutes`}
              </small>
              <Link href={`/incidents?case=${item.id}`}>Open case</Link>
            </article>
          ))}
          {!cases.length && <p>No operator has taken a case on this machine yet.</p>}
        </div>
      </section>
      <dialog
        ref={detailDialog}
        className={styles.detailDialog}
        aria-label="Hidden sample list"
        onClose={() => setDetailId(null)}
      >
        <header>
          <h2>{detailId === 'all' ? 'All stored samples' : detailEpisode?.title || 'Samples'}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close details"
            onClick={() => setDetailId(null)}
          >
            <X size={16} />
          </button>
        </header>
        <p>
          {detailId === 'all'
            ? 'Every preview sample that the stretches above collapse.'
            : 'The individual samples hidden inside this stretch.'}{' '}
          Newest first.
        </p>
        <Pager
          label="Hidden sample pages"
          page={detailPage}
          total={detailSamples.length}
          pageSize={SAMPLE_PAGE}
          onPage={setDetailPage}
        />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Record</th>
                <th>Time</th>
                <th>Readings</th>
              </tr>
            </thead>
            <tbody>
              {pageOf(detailSamples, detailPage, SAMPLE_PAGE).map((sample) => (
                <tr key={sample.id}>
                  <td>{sample.id}</td>
                  <td>{clock(sample.at)}</td>
                  <td>
                    <ul className={styles.sampleMetrics}>
                      {sample.readings.map((reading) => (
                        <li
                          key={reading.signal_id}
                          className={reading.ooc ? styles.oocChip : undefined}
                        >
                          {reading.signal_id.replaceAll('_', ' ')} {reading.value} ·{' '}
                          {limitWords(reading)}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
              {!detailSamples.length && (
                <tr>
                  <td colSpan={3}>No hidden samples.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </dialog>
    </div>
  );
}

function pageOf<T>(items: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  return items.slice(current * pageSize, current * pageSize + pageSize);
}

function Pager({
  label,
  page,
  total,
  pageSize,
  onPage,
}: {
  label: string;
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages - 1);
  if (total <= pageSize) return null;
  const start = current * pageSize + 1;
  const end = Math.min(total, (current + 1) * pageSize);
  return (
    <nav className={styles.pager} aria-label={label}>
      <strong>
        {start}–{end} of {total}
      </strong>
      <div className={styles.pagerControls}>
        <button type="button" disabled={current === 0} onClick={() => onPage(current - 1)}>
          <ChevronLeft size={16} /> Previous
        </button>
        <span>
          Page {current + 1} of {pages}
        </span>
        <button type="button" disabled={current >= pages - 1} onClick={() => onPage(current + 1)}>
          Next <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
