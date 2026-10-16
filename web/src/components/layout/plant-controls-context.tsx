'use client';

import { createContext, useContext } from 'react';

// Presentation state only. Simulation commands stay with the existing plant provider.
export const PlantControlsContext = createContext<{
  open: boolean;
  setOpen: (value: boolean) => void;
  returnFocus: () => void;
} | null>(null);

export function usePlantControls() {
  const context = useContext(PlantControlsContext);
  if (!context) throw new Error('Plant controls require the application shell.');
  return context;
}
