'use client';

import { useParams } from 'next/navigation';
import { MachineRecordPage } from '@/features/monitoring/components/machine-record-page';

export default function Page() {
  const assetId = decodeURIComponent(String(useParams().assetId || ''));
  return <MachineRecordPage assetId={assetId} />;
}
