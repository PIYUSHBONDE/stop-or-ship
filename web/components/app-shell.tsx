'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Factory,
  Gauge,
  Wrench,
  BookOpen,
  Workflow,
  Radio,
  LoaderCircle,
  X,
} from 'lucide-react';
import { usePlant } from './session-provider';

const destinations = [
  { href: '/plant', name: 'Plant', icon: Factory },
  { href: '/operations', name: 'Operations', icon: Gauge },
  { href: '/incidents', name: 'Incidents', icon: Activity },
  { href: '/maintenance', name: 'Maintenance', icon: Wrench },
  { href: '/memory', name: 'Memory', icon: BookOpen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, connected, error, busy, dismissError } = usePlant();
  if (!state)
    return (
      <main className="boot">
        <Workflow size={38} />
        <h1>PlantSense</h1>
        <p>Connecting to your demo plant</p>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => location.reload()}>
              Retry connection
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </main>
    );
  return (
    <div className="app-shell v2-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <nav className="rail v2-rail" aria-label="Application navigation">
        <Link className="brand-mark" href="/plant" aria-label="PlantSense home">
          <Workflow size={23} />
        </Link>
        {destinations.map(({ href, name, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`rail-button ${pathname.startsWith(href) ? 'active' : ''}`}
            aria-current={pathname.startsWith(href) ? 'page' : undefined}
          >
            <Icon size={21} />
            <span>{name}</span>
            {name === 'Incidents' && state.incident && state.incident.state !== 'resolved' && (
              <i className="rail-dot" />
            )}
          </Link>
        ))}
        <div className="rail-bottom">
          <span className="avatar">NP</span>
        </div>
      </nav>
      <div className="workspace v2-workspace">
        <header className="topbar">
          <div className="wordmark">
            PlantSense<span> / </span>
            <small>NARMADA PRECISION WORKS</small>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">SIMULATED DEMO PLANT</span>
            <span className="connection">
              <Radio size={13} />
              {connected ? 'API connected' : 'Reconnecting…'}
            </span>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={dismissError} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <div className="global-busy" role="status">
            <LoaderCircle className="spin" size={14} />
            Saving your action…
          </div>
        )}
        <main
          id="workspace-content"
          className={pathname === '/plant' ? 'factory-workspace' : 'workspace-content'}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
