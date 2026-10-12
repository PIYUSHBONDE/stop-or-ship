'use client';

import { useParams } from 'next/navigation';
import { PlantGuidePage } from '@/features/memory/components/plant-guide-page';

export default function Page() {
  const assetId = decodeURIComponent(String(useParams().assetId || ''));
  return <PlantGuidePage assetId={assetId} />;
}
