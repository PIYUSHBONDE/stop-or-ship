import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './workspace.module.css';

export function WorkspaceFrame({
  plantName,
  title,
  description,
  children,
}: {
  plantName: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">{plantName.toUpperCase()}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Link className="secondary" href="/plant">
          Open plant <ArrowRight size={15} />
        </Link>
      </header>
      {children}
    </div>
  );
}
