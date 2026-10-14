'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { usePlantSession } from '@/hooks/use-plant-session';

type SessionController = ReturnType<typeof usePlantSession> & {
  selected: string;
  selectAsset: (id: string) => void;
};
const SessionContext = createContext<SessionController | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<{ plantId: string } | false | null>(null);
  useEffect(() => {
    const plantId = localStorage.getItem('plantsense-workspace');
    setMode(plantId ? { plantId } : false);
    if (
      !plantId &&
      pathname !== '/' &&
      pathname !== '/workspace' &&
      pathname !== '/evidence-preview'
    )
      router.replace('/');
  }, [pathname, router]);
  const controller = usePlantSession(
    !!mode && pathname !== '/' && pathname !== '/evidence-preview' && pathname !== '/workspace',
    mode ? { plantId: mode.plantId, incidentId: query.get('incident') } : undefined,
  );
  const [selected, selectAsset] = useState('P-107');
  const requestedAsset = query.get('asset');
  const appliedSelection = useRef('');
  const selectionKey = requestedAsset ? `${controller.state?.plant.id}:${requestedAsset}` : '';
  useEffect(() => {
    if (!requestedAsset) appliedSelection.current = '';
    if (
      requestedAsset &&
      appliedSelection.current !== selectionKey &&
      controller.state?.assets.some((a) => a.id === requestedAsset)
    ) {
      appliedSelection.current = selectionKey;
      selectAsset(requestedAsset);
    }
  }, [requestedAsset, selectionKey, controller.state?.assets]);
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
