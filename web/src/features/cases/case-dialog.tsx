'use client';

import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import Modal from '@/components/ui/modal';
import styles from './cases.module.css';

export function CaseDialog({
  title,
  children,
  onClose,
  pending = false,
  error,
  returnFocusRef,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  pending?: boolean;
  error?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Modal
      title={title}
      returnFocusRef={returnFocusRef}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div className={styles.dialogContent}>
        <header className={styles.dialogHeading}>
          <strong>{title}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${title.toLowerCase()}`}
            disabled={pending}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function CaseAction({
  title,
  label = title,
  open,
  onOpen,
  onClose,
  pending,
  error,
  children,
}: {
  title: string;
  label?: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  pending?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <>
      <button type="button" className="secondary" aria-haspopup="dialog" onClick={onOpen}>
        {label}
      </button>
      {open && (
        <CaseDialog title={title} onClose={onClose} pending={pending} error={error}>
          {children}
        </CaseDialog>
      )}
    </>
  );
}
