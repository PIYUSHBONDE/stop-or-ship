'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ClipboardList, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import { HumanTaskCard } from './human-task';
import styles from './cases.module.css';

type Page = components['schemas']['TaskPage'];
export function TaskInbox({ triggerClassName }: { triggerClassName?: string }) {
  const { caseRequest } = usePlant();
  const controller = useRef(caseRequest);
  controller.current = caseRequest;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  function invalidateReads() {
    epoch.current++;
  }
  async function load() {
    const version = ++epoch.current;
    try {
      const next = await controller.current<Page>(`/tasks?cursor=${cursor}`);
      if (epoch.current === version) {
        setPage(next);
        setError('');
      }
    } catch (cause) {
      if (epoch.current === version)
        setError(cause instanceof Error ? cause.message : 'Unable to load requests.');
    }
  }
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);
    return () => {
      invalidateReads();
      clearInterval(timer);
    };
    // Scope changes remount this panel; queued reads use the current shared controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cursor]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={triggerClassName || styles.inboxTrigger}
        aria-label="Human requests"
      >
        <ClipboardList size={17} />
        <span>Requests</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.inbox}>
          <div className={styles.line}>
            <Dialog.Title>Human requests</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close requests">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Requests for your plant role. Claim ownership before recording a finding.
          </Dialog.Description>
          <button className="secondary" onClick={() => void load()}>
            Refresh requests
          </button>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {page?.items.map((task) => (
            <HumanTaskCard
              key={task.id}
              task={task}
              onChanged={() => void load()}
              onNavigate={() => setOpen(false)}
            />
          ))}
          {page && !page.items.length && <p>No open requests for your role.</p>}
          <div className={styles.line}>
            <button
              className="secondary"
              disabled={!cursor}
              onClick={() => setCursor(Math.max(0, cursor - 25))}
            >
              Previous requests
            </button>
            <button
              className="secondary"
              disabled={page?.next_cursor == null}
              onClick={() => setCursor(page!.next_cursor!)}
            >
              Next requests
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
