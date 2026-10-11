'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { guideFor, machineAddress } from '@/features/memory/lib/plant-guide';
import pageStyles from '@/components/layout/workspace.module.css';
import styles from '@/features/monitoring/components/machine-records.module.css';

export function PlantGuidePage({ assetId }: { assetId: string }) {
  const { state } = usePlant();
  const asset = state?.assets.find((item) => item.id === assetId);
  if (!state) return null;
  if (!asset)
    return (
      <div className={pageStyles.page}>
        <h1>Guide not found</h1>
        <Link className="secondary" href="/memory">
          <ArrowLeft size={15} /> Back to plant guide
        </Link>
      </div>
    );
  const area = state.areas.find((item) => item.id === asset.area_id);
  const guide = guideFor(asset.type);
  return (
    <div className={pageStyles.page}>
      <header className={pageStyles.heading}>
        <div>
          <span className="eyebrow">PLANT GUIDE · {asset.id}</span>
          <h1>{asset.name}</h1>
          <p>{machineAddress(asset, area?.name)}</p>
        </div>
        <Link className="secondary" href="/memory">
          <ArrowLeft size={15} /> All machines
        </Link>
      </header>
      <section className={styles.detail}>
        <p>{guide.summary}</p>
        <small>{guide.addressHint}</small>
        <p>{asset.purpose}</p>
        <h2>What can break</h2>
        <ul>
          {guide.canBreak.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2>What can be fixed</h2>
        <ul>
          {guide.canFix.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2>User guide</h2>
        <ol>
          {guide.guide.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <p className="muted">
          This guide is plant knowledge for the labeled station. It does not authorize work or
          replace a reviewed source.
        </p>
        <div className={styles.actions}>
          <Link className="secondary" href={`/monitoring/${encodeURIComponent(asset.id)}`}>
            Machine records
          </Link>
          <Link className="primary" href="/plant">
            Find on plant floor
          </Link>
        </div>
      </section>
    </div>
  );
}
