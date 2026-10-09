'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';

export default function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  const opener = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className="modal"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
