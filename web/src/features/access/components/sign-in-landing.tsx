'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Workflow } from 'lucide-react';
import { staffApi } from '@/lib/api/staff-client';
import type { AccessState } from '@/lib/api/staff-client';
import { identityFromEmail } from '@/features/access/lib/identity';
import styles from '@/features/access/components/home.module.css';

type Mode = 'sso' | 'credentials' | 'invitation';
type Provider = 'google' | 'microsoft';

export function SignInLanding({
  onSignedIn,
  inviteOnly = false,
}: {
  onSignedIn?: (access: AccessState) => void;
  inviteOnly?: boolean;
}) {
  const router = useRouter();
  const [access, setAccess] = useState<AccessState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(inviteOnly ? 'invitation' : 'sso');
  const [provider, setProvider] = useState<Provider>('google');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  useEffect(() => {
    let active = true;
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if (invite) {
      setToken(invite);
      setMode('invitation');
      history.replaceState(null, '', window.location.pathname);
    }
    staffApi
      .access()
      .then((next) => {
        if (!active) return;
        setAccess(next);
        if (next.user && !invite && !inviteOnly) {
          onSignedInRef.current?.(next);
          if (!onSignedInRef.current) router.replace('/workspace');
        }
      })
      .catch((caught) => {
        if (active) setError(caught.message);
      });
    return () => {
      active = false;
    };
  }, [inviteOnly, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !access) return;
    setBusy(true);
    setError('');
    try {
      const identity = identityFromEmail(email);
      const next =
        mode === 'invitation'
          ? await staffApi.accept({ email, password, display_name: identity.display_name, token })
          : access.setup_required
            ? await staffApi.setup({ email, password, ...identity })
            : await staffApi.signIn({ email, password });
      setPassword('');
      setToken('');
      setMode('sso');
      setAccess(next);
      onSignedInRef.current?.(next);
      if (!onSignedInRef.current) router.replace('/workspace');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Staff access failed');
    } finally {
      setBusy(false);
    }
  }

  function openProvider(next: Provider) {
    setProvider(next);
    setMode('credentials');
    setError('');
  }

  const enrolling = mode === 'invitation' || Boolean(access?.setup_required);
  return (
    <main className={styles.stage}>
      <div className={styles.glow} />
      <div className={styles.glowSecond} />
      <div className={styles.grid} />
      <section className={styles.card} aria-labelledby="signin-heading">
        <div className={styles.brand}>
          <span className={styles.mark}>
            <Workflow size={18} />
          </span>
          PlantSense
        </div>
        <h1 id="signin-heading">
          {mode === 'invitation'
            ? 'Join your plant'
            : access?.setup_required
              ? 'Start your plant'
              : 'Welcome back'}
        </h1>
        <p className={styles.lead}>
          {mode === 'invitation'
            ? 'Accept your invitation with the same work email that received it.'
            : 'Sign in with your organization and open the plant workspace.'}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!access ? (
          <div className={styles.status} role="status">
            <LoaderCircle className="spin" />
            Connecting…
            {error && (
              <button className={styles.retry} onClick={() => location.reload()}>
                Retry connection
              </button>
            )}
          </div>
        ) : !access.available ? (
          <p className={styles.hint}>
            Staff access currently runs locally. Managed cloud identity requires its deployment
            gate.
          </p>
        ) : (
          <>
            {mode === 'sso' && (
              <div className={styles.methods}>
                <button className={styles.sso} type="button" onClick={() => openProvider('google')}>
                  <GoogleMark />
                  Continue with Google
                </button>
                <button
                  className={`${styles.sso} ${styles.microsoft}`}
                  type="button"
                  onClick={() => openProvider('microsoft')}
                >
                  <MicrosoftMark />
                  Continue with Microsoft
                </button>
              </div>
            )}
            {mode !== 'sso' && (
              <form className={styles.form} onSubmit={submit}>
                {mode === 'credentials' && (
                  <p className={styles.hint}>
                    Continue with {provider === 'google' ? 'Google' : 'Microsoft'} using your work
                    email.
                  </p>
                )}
                {mode === 'invitation' && (
                  <label>
                    Invitation code
                    <input
                      required
                      value={token}
                      minLength={32}
                      maxLength={100}
                      autoComplete="off"
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    maxLength={254}
                    autoComplete="username"
                    autoFocus
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    required
                    value={password}
                    minLength={enrolling ? 15 : 1}
                    maxLength={128}
                    autoComplete={enrolling ? 'new-password' : 'current-password'}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {enrolling && (
                  <p className={styles.hint}>Use a unique passphrase of at least 15 characters.</p>
                )}
                <button className={styles.submit} disabled={busy}>
                  {busy
                    ? 'Signing in…'
                    : mode === 'invitation'
                      ? 'Accept invitation'
                      : access.setup_required
                        ? 'Get started'
                        : 'Sign in'}
                </button>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setMode('sso');
                    setError('');
                  }}
                >
                  Back to SSO
                </button>
              </form>
            )}
            {mode === 'sso' && (
              <>
                <p className={styles.note}>
                  Continue with your work email for this local workspace.
                </p>
                <div className={styles.footer}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => {
                      setMode('invitation');
                      setError('');
                    }}
                  >
                    I have an invitation
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <div className={styles.footer}>
          <p className={styles.hint}>Staff sessions expire after eight hours.</p>
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M9 7.3v3.5h4.9c-.2 1.2-1.5 3.5-4.9 3.5A5.4 5.4 0 1 1 9 3.6c1.5 0 2.5.6 3.1 1.2l2.1-2.1C12.8 1.3 11.1.5 9 .5 4.6.5 1 4.1 1 8.5S4.6 16.5 9 16.5c4.6 0 7.6-3.2 7.6-7.7 0-.5 0-.9-.1-1.3H9Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect fill="#F25022" x="0" y="0" width="7.4" height="7.4" />
      <rect fill="#7FBA00" x="8.6" y="0" width="7.4" height="7.4" />
      <rect fill="#00A4EF" x="0" y="8.6" width="7.4" height="7.4" />
      <rect fill="#FFB900" x="8.6" y="8.6" width="7.4" height="7.4" />
    </svg>
  );
}
