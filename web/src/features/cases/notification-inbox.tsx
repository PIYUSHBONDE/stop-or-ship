'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, X, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import styles from './cases.module.css';

type Page = components['schemas']['NotificationPage'];
export function NotificationInbox({
  triggerClassName,
  onNavigate,
}: {
  triggerClassName: string;
  onNavigate?: () => void;
}) {
  const { caseRequest } = usePlant();
  const router = useRouter();
  const controller = useRef(caseRequest);
  controller.current = caseRequest;
  const epoch = useRef(0);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function load() {
    const version = ++epoch.current;
    try {
      const data = await controller.current<Page>(`/notifications?cursor=${cursor}`);
      if (version === epoch.current) {
        setPage(data);
        setError('');
      }
    } catch (cause) {
      if (version === epoch.current)
        setError(cause instanceof Error ? cause.message : 'Unable to load notifications.');
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(
      () => {
        if (!document.hidden) void load();
      },
      open ? 10000 : 20000,
    );
    return () => {
      // Invalidate pending reads deliberately; this ref is a generation counter, not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      clearInterval(timer);
    };
    // Every read/mutation uses the shared serialized plant controller. Scope changes remount this inbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cursor]);
  async function markRead(id: string) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await controller.current('/notifications/read', { notification_id: id });
      setFeedback('Marked as read. No task or case action was taken.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save read state. Retry.');
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={triggerClassName}
        aria-label="Notifications"
        aria-describedby="notification-unread-count"
      >
        <Bell size={17} aria-hidden="true" />
        <span>Notifications</span>
        {!!page?.unread_count && (
          <b className={styles.noticeCount} aria-hidden="true">
            {page.unread_count > 99 ? '99+' : page.unread_count}
          </b>
        )}
        <span id="notification-unread-count" className="sr-only">
          {page?.unread_count ?? 0} unread notifications
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.inbox}>
          <div className={styles.line}>
            <Dialog.Title>Notifications</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close notifications">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Actionable updates for your current plant and role. Reading an update does not claim
            work or approve a decision.
          </Dialog.Description>
          <button className="secondary" onClick={() => void load()}>
            Refresh notifications
          </button>
          {feedback && (
            <p role="status" className={styles.success}>
              {feedback}
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {!page && !error && <p role="status">Loading notifications…</p>}
          {page && !page.items.length && (
            <p>
              No actionable notifications. New requests, review-ready cases and blockers will appear
              here.
            </p>
          )}
          {page?.items.map((item) => (
            <article className={styles.notice} key={item.id} data-unread={!item.read}>
              <div className={styles.line}>
                <strong>{item.title}</strong>
                <span className={styles.taskState}>{item.read ? 'Read' : 'Unread'}</span>
              </div>
              <p>{item.message}</p>
              {item.ai_summary && (
                <details>
                  <summary>Saved AI assessment</summary>
                  <p>{item.ai_summary}</p>
                </details>
              )}
              <small className={styles.note}>
                {item.asset_id || 'Plant-wide'} ·{' '}
                <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
              </small>
              <div className={styles.line}>
                <Link
                  href={`/incidents?workcase=${encodeURIComponent(item.case_id)}`}
                  onNavigate={(event) => {
                    event.preventDefault();
                    router.push(`/incidents?workcase=${encodeURIComponent(item.case_id)}`);
                    queueMicrotask(() => {
                      setOpen(false);
                      onNavigate?.();
                    });
                  }}
                >
                  {item.kind === 'human_request'
                    ? 'Open request'
                    : item.kind === 'recurring_issue'
                      ? 'Review equipment history'
                      : item.kind === 'blocked'
                        ? 'View blocker'
                        : 'Review assessment'}{' '}
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
                {!item.read && (
                  <button
                    className={styles.textButton}
                    disabled={pending}
                    onClick={() => void markRead(item.id)}
                  >
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          ))}
          <div className={styles.line}>
            <button
              className="secondary"
              disabled={!cursor}
              onClick={() => setCursor(Math.max(0, cursor - 25))}
            >
              Previous notifications
            </button>
            <button
              className="secondary"
              disabled={page?.next_cursor == null}
              onClick={() => setCursor(page!.next_cursor!)}
            >
              Next notifications
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
