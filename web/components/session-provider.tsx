'use client';

import { createContext, useContext, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePlantSession } from '@/hooks/use-plant-session';

type SessionController = ReturnType<typeof usePlantSession> & {
  selected: string;
  selectAsset: (id: string) => void;
};
const SessionContext = createContext<SessionController | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const controller = usePlantSession(pathname !== '/evidence-preview');
  const [selected, selectAsset] = useState('P-107');
  return (
    <SessionContext.Provider value={{ ...controller, selected, selectAsset }}>
      {children}
    </SessionContext.Provider>
  );
}

export function usePlant() {
  const controller = useContext(SessionContext);
  if (!controller) throw new Error('Plant workspaces require SessionProvider');
  return controller;
}
