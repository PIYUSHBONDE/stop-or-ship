'use client';

import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Factory,
  BookOpen,
  Workflow,
  Radio,
  LoaderCircle,
  Settings2,
  X,
  PanelLeftOpen,
  PanelLeftClose,
  SlidersHorizontal,
  Menu,
} from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { AssistantPanel } from '@/features/assistant/assistant-panel';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { FrameStatus } from './frame-status';
import { PlantControlsContext } from './plant-controls-context';
import styles from './app-shell.module.css';

const destinations = [
  { href: '/plant', name: 'Plant', icon: Factory },
  { href: '/operations', name: 'Operations', icon: Workflow },
  { href: '/maintenance', name: 'Maintenance', icon: Settings2 },
  { href: '/monitoring', name: 'Monitor', icon: Radio },
  { href: '/incidents', name: 'Incidents', icon: Activity },
  { href: '/memory', name: 'Memory', icon: BookOpen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const operational = query.get('view') === 'observations';
  const simulationPage = pathname === '/plant' && !operational;
  const { state, error, busy, dismissError } = usePlant();
  const preview = usePreviewDispatch();
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const controlsTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width: 760px)');
    const update = () => {
      setMobile(media.matches);
      setMenuOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setMenuOpen(false);
    setControlsOpen(false);
  }, [pathname, operational]);
  const returnControlFocus = () => {
    if (mobile) menuTrigger.current?.focus();
    else controlsTrigger.current?.focus();
  };
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

  const navLink = (href: string, name: string, Icon: typeof Factory, count = 0) => (
    <Link
      key={href}
      href={state.workspace && state.incident ? `${href}?incident=${state.incident.id}` : href}
      className={styles.item}
      aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined}
      aria-label={name}
      aria-describedby={count ? `rail-count-${name}` : undefined}
      onNavigate={(event) => {
        event.preventDefault();
        router.push(
          state.workspace && state.incident ? `${href}?incident=${state.incident.id}` : href,
        );
        queueMicrotask(() => setMenuOpen(false));
      }}
    >
      <Icon size={20} />
      <span>{name}</span>
      {count > 0 && (
        <>
          <span className={styles.count} aria-hidden="true">
            {count}
          </span>
          <span className="frame-sr-only" id={`rail-count-${name}`}>
            {count} active {name === 'Operators' ? 'jobs' : 'cases'}
          </span>
        </>
      )}
    </Link>
  );
  const navigation = (
    <>
      <Link
        className={styles.brand}
        href="/plant"
        aria-label="PlantSense home"
        onNavigate={() => queueMicrotask(() => setMenuOpen(false))}
      >
        <span className={styles.brandMark}>
          <Workflow size={23} />
        </Link>
        {destinations.map(({ href, name, icon: Icon }) => (
          <Link
            key={href}
            href={
              state.workspace && state.incident ? `${href}?incident=${state.incident.id}` : href
            }
            className={`rail-button ${pathname.startsWith(href) ? 'active' : ''}`}
            aria-current={pathname.startsWith(href) ? 'page' : undefined}
          >
            <Icon size={21} />
            <span>{name}</span>
            {name === 'Incidents' &&
              ((state.incident && state.incident.state !== 'resolved') ||
                preview.ledger.cases.some((item) => !item.fixedAt)) && <i className="rail-dot" />}
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
              {state.sources?.some(
                (source) =>
                  source.configuration.kind === 'operational' && source.quality === 'fresh',
              )
                ? 'OBSERVATIONS AVAILABLE'
                : 'NO CURRENT DATA'}
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
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={dismissError} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
      <div className={styles.utilities}>
        {state.workspace && (
          <NotificationInbox
            key={`${state.workspace.id}:${state.workspace.user.id}`}
            triggerClassName={styles.item}
            onNavigate={() => setMenuOpen(false)}
          />
        )}
        {state.workspace && <TaskInbox triggerClassName={styles.item} />}
        {simulationPage && (
          <>
            <button
              ref={controlsTrigger}
              className={styles.item}
              aria-label="Simulation controls"
              aria-expanded={controlsOpen}
              aria-controls="plant-controls"
              onClick={() => {
                setControlsOpen(!controlsOpen);
                setMenuOpen(false);
              }}
            >
              <SlidersHorizontal size={20} />
              <span>Controls</span>
            </button>
          </>
        )}
        {navLink('/plant-setup', 'Setup', Settings2)}
        <FrameStatus
          expanded={expanded || mobile}
          operational={operational}
          simulation={
            simulationPage ||
            pathname === '/operators' ||
            pathname.startsWith('/monitoring') ||
            (pathname === '/incidents' &&
              preview.ledger.cases.some((c) => c.id === query.get('case')))
          }
        />
        <button
          className={`${styles.item} ${styles.expand}`}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span className={styles.itemLabel}>Collapse sidebar</span>
        </button>
      </div>
    </>
  );

  return (
    <PlantControlsContext.Provider
      value={{ open: controlsOpen, setOpen: setControlsOpen, returnFocus: returnControlFocus }}
    >
      <div className={styles.shell} data-expanded={expanded}>
        <a className="skip-link" href="#workspace-content">
          Skip to workspace
        </a>
        {mobile ? (
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger
              ref={menuTrigger}
              className={styles.mobileTrigger}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.overlay} />
              <Dialog.Content
                className={styles.rail}
                data-expanded="true"
                aria-describedby={undefined}
                onEscapeKeyDown={(event) => {
                  if (document.querySelector('details[data-sidebar-menu][open]'))
                    event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                  if (controlsOpen) event.preventDefault();
                }}
              >
                <Dialog.Title className="frame-sr-only">PlantSense navigation</Dialog.Title>
                <Dialog.Close className={styles.mobileClose} aria-label="Close navigation">
                  <X size={19} />
                </Dialog.Close>
                <nav aria-label="Application navigation" style={{ display: 'contents' }}>
                  {navigation}
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : (
          <nav className={styles.rail} data-expanded={expanded} aria-label="Application navigation">
            {navigation}
          </nav>
        )}
        <div className={styles.workspace}>
          <div className={styles.feedback}>
            {preview.storageError && (
              <p className="storage-notice" role="status">
                {preview.storageError}
              </p>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {error}
                <button onClick={dismissError} aria-label="Dismiss error">
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
          {busy && (
            <div className={styles.saving} role="status">
              <LoaderCircle className="spin" size={14} />
              Saving your action…
            </div>
          )}
          <main
            id="workspace-content"
            tabIndex={-1}
            className={`${styles.main} ${pathname === '/plant' ? styles.canvasMain : ''}`}
          >
            {children}
          </main>
        </div>
        <AssistantPanel />
      </div>
    </PlantControlsContext.Provider>
  );
}
