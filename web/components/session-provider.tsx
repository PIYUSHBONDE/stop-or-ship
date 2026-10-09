'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePlantSession } from '@/hooks/use-plant-session';

type SessionController = ReturnType<typeof usePlantSession> & {
  selected: string;
  selectAsset: (id: string) => void;
};
const SessionContext = createContext<SessionController | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const [mode, setMode] = useState<{ plantId: string } | false | null>(null);
  useEffect(() => {
    const plantId = localStorage.getItem('plantsense-workspace');
    setMode(plantId ? { plantId } : false);
  }, [pathname]);
  const controller = usePlantSession(
    mode !== null && pathname !== '/evidence-preview' && pathname !== '/workspace',
    mode ? { plantId: mode.plantId, incidentId: query.get('incident') } : undefined,
  );
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
