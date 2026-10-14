'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  Factory,
  BookOpen,
  Workflow,
  Radio,
  LoaderCircle,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { AssistantPanel } from '@/features/assistant/assistant-panel';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';

const destinations = [
  { href: '/plant', name: 'Plant', icon: Factory },
  { href: '/operators', name: 'Operators', icon: Users },
  { href: '/monitoring', name: 'Monitor', icon: Radio },
  { href: '/incidents', name: 'Incidents', icon: Activity },
  { href: '/memory', name: 'Memory', icon: BookOpen },
  { href: '/plant-setup', name: 'Setup', icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const operational =
    query.get('view') === 'observations' ||
    pathname === '/maintenance' ||
    (pathname === '/incidents' && !!query.get('incident'));
  const { state, connected, error, busy, dismissError } = usePlant();
  const preview = usePreviewDispatch();
  if (pathname === '/' || pathname === '/evidence-preview' || pathname === '/workspace')
    return children;
  if (!state)
    return (
      <main className="boot">
        <Workflow size={38} />
        <h1>PlantSense</h1>
        <p>Connecting to your plant workspace</p>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Link className="secondary" href="/">
              Sign in to your plant
            </Link>
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
            {name === 'Incidents' &&
              ((state.incident && state.incident.state !== 'resolved') ||
                preview.ledger.cases.some((item) => !item.clearedAt && !item.interrupted)) && (
                <i className="rail-dot" />
              )}
            {name === 'Operators' && preview.assignments.length > 0 && <i className="rail-dot" />}
          </Link>
        ))}
        <div className="rail-bottom">
          <Link href="/workspace" className="rail-button" aria-label="Staff and plant access">
            <span className="avatar">
              {state.workspace?.user.display_name.slice(0, 2).toUpperCase() || 'NP'}
            </span>
            <span>Access</span>
          </Link>
        </div>
      </nav>
      <div className="workspace v2-workspace">
        <header className="topbar">
          <div className="wordmark">
            PlantSense<span> / </span>
            <small>{state.plant.name.toUpperCase()}</small>
          </div>
          <div className="topbar-right">
            <AssistantPanel />
            <span className="demo-pill">
              {operational
                ? 'Operational case / observations'
                : pathname === '/memory'
                  ? 'Guides and repair memory'
                  : pathname === '/incidents' && !query.get('case')
                    ? 'Case records'
                    : pathname === '/plant-setup'
                      ? 'Plant configuration'
                      : 'Simulated plant'}
            </span>
            <span className="demo-pill operational-status">
              {state.sources?.some(
                (source) =>
                  source.configuration.kind === 'operational' && source.quality === 'fresh',
              )
                ? 'OPERATIONAL OBSERVATIONS'
                : 'NO OPERATIONAL DATA'}
            </span>
            {state.workspace && (
              <span className="connection">
                {state.workspace.user.display_name} · {state.workspace.role}
              </span>
            )}
            <span className="connection">
              <Radio size={13} />
              {connected ? 'API connected' : 'Reconnecting…'}
            </span>
          </div>
        </header>
        {preview.storageError && <p role="status">{preview.storageError}</p>}
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
