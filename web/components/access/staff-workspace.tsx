'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  Factory,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { staffApi } from '@/lib/staff-api';
import type { AccessState, AuditPage, Member, PlantAccess } from '@/lib/staff-api';
import styles from './access.module.css';

const roles = ['admin', 'manager', 'reliability', 'technician', 'viewer'] as const;
type Role = (typeof roles)[number];

function MemberRow({
  member,
  saving,
  onSave,
}: {
  member: Member;
  saving: boolean;
  onSave: (member: Member, role: Role, active: boolean) => void;
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [active, setActive] = useState(member.active);
  return (
    <div className={styles.member}>
      <div>
        <strong>{member.display_name}</strong>
        <small>{member.email}</small>
      </div>
      <label>
        Role
        <select
          aria-label={`Role for ${member.email}`}
          value={role}
          disabled={saving}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          {roles.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={active}
          disabled={saving}
          onChange={(event) => setActive(event.target.checked)}
        />
        Active
      </label>
      <button
        className="secondary"
        disabled={saving || (role === member.role && active === member.active)}
        onClick={() => onSave(member, role, active)}
      >
        Save access
      </button>
    </div>
  );
}

function PlantAdministration({
  plant,
  onError,
  onAccessChanged,
}: {
  plant: PlantAccess;
  onError: (message: string) => void;
  onAccessChanged: (access: AccessState) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<AuditPage | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const admin = plant.permissions.includes('staff.manage');

  useEffect(() => {
    let active = true;
    if (admin)
      staffApi
        .members(plant.id)
        .then((next) => {
          if (active) setMembers(next);
        })
        .catch((error) => {
          if (active) onError(error.message);
        });
    return () => {
      active = false;
    };
  }, [admin, plant.id, onError]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setLink('');
    setCopied(false);
    onError('');
    try {
      const receipt = await staffApi.invite(plant.id, { email, role });
      const url = new URL('/workspace', window.location.origin);
      // The secret stays in the fragment, outside HTTP URLs and referrer headers.
      url.hash = 'invite=' + receipt.token;
      setLink(url.href);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Invitation failed');
    } finally {
      setSaving(false);
    }
  }

  async function update(member: Member, role: Role, active: boolean) {
    if (saving) return;
    setSaving(true);
    onError('');
    try {
      const next = await staffApi.updateMember(plant.id, member.id, { role, active });
      onAccessChanged(next);
      if (next.plants.find((item) => item.id === plant.id)?.permissions.includes('staff.manage'))
        setMembers(await staffApi.members(plant.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Access update failed');
    } finally {
      setSaving(false);
    }
  }

  async function loadAudit(cursor?: number) {
    if (loadingAudit) return;
    setLoadingAudit(true);
    onError('');
    try {
      const next = await staffApi.audit(plant.id, cursor);
      setHistory((previous) =>
        cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Audit could not be loaded');
    } finally {
      setLoadingAudit(false);
    }
  }

  return (
    <>
      {admin && (
        <section className={styles.panel} aria-labelledby="staff-heading">
          <div className={styles.sectionHeading}>
            <Users size={20} />
            <h2 id="staff-heading">Plant staff</h2>
          </div>
          <p className={styles.muted}>
            Invite staff to this plant. Permissions are enforced on every protected action.
          </p>
          <form onSubmit={invite} className={styles.inviteForm}>
            <label>
              Staff email
              <input
                type="email"
                required
                value={email}
                autoComplete="off"
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Invitation role
              <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={saving}>
              Create invitation
            </button>
          </form>
          {link && (
            <div className={styles.receipt} role="status">
              <label>
                Invitation link
                <input readOnly value={link} onFocus={(event) => event.target.select()} />
              </label>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    onError('Select and copy the invitation link manually.');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <p>
                This link grants the selected access to the invited email. Share it privately. It
                expires in 48 hours and can be accepted once.
              </p>
            </div>
          )}
          <div className={styles.members}>
            {members.map((member) => (
              <MemberRow key={member.id} member={member} saving={saving} onSave={update} />
            ))}
          </div>
          <p className={styles.muted}>
            Admin: staff and configuration. Manager: decisions and repairs. Reliability: investigate
            and recalculate. Technician: approved repairs. Viewer: inspect.
          </p>
        </section>
      )}
      <section className={styles.panel} aria-labelledby="audit-heading">
        <div className={styles.sectionHeading}>
          <ShieldCheck size={20} />
          <h2 id="audit-heading">Audit history</h2>
        </div>
        <p className={styles.muted}>
          Retained actions, actors and decision versions. Older records are loaded in pages.
        </p>
        <button className="secondary" disabled={loadingAudit} onClick={() => loadAudit()}>
          Refresh audit history
        </button>
        {history && (
          <ol className={styles.audit}>
            {history.items.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.message}</strong>
                <span>
                  {entry.actor_name} · {entry.action} · {new Date(entry.at).toLocaleString('en-IN')}
                </span>
                {entry.calculation_version && (
                  <small>Decision version {entry.calculation_version}</small>
                )}
              </li>
            ))}
          </ol>
        )}
        {history?.next_cursor && (
          <button
            className="secondary"
            disabled={loadingAudit}
            onClick={() => loadAudit(history.next_cursor!)}
          >
            Load older records
          </button>
        )}
      </section>
    </>
  );
}

export function StaffWorkspace() {
  const router = useRouter();
  const [access, setAccess] = useState<AccessState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'sign-in' | 'invitation'>('sign-in');
  const [token, setToken] = useState('');
  const [plantId, setPlantId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [plantName, setPlantName] = useState('');

  useEffect(() => {
    let active = true;
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if (invite) {
      setToken(invite);
      setMode('invitation');
      history.replaceState(null, '', window.location.pathname);
    }
    setPlantId(localStorage.getItem('plantsense-workspace') || '');
    staffApi
      .access()
      .then((next) => {
        if (active) setAccess(next);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !access) return;
    setBusy(true);
    setError('');
    try {
      const next =
        mode === 'invitation'
          ? await staffApi.accept({ email, password, display_name: name, token })
          : access.setup_required
            ? await staffApi.setup({
                email,
                password,
                display_name: name,
                organization_name: organization,
                plant_name: plantName,
              })
            : await staffApi.signIn({ email, password });
      setAccess(next);
      setPassword('');
      setToken('');
      setMode('sign-in');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Staff access failed');
    } finally {
      setBusy(false);
    }
  }

  function openPlant(plant: PlantAccess) {
    localStorage.setItem('plantsense-workspace', plant.id);
    router.push('/plant');
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await staffApi.signOut();
      localStorage.removeItem('plantsense-workspace');
      setAccess(await staffApi.access());
      setPlantId('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign-out failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedPlant = access?.plants.find((plant) => plant.id === plantId) || access?.plants[0];
  const enrolling = mode === 'invitation' || access?.setup_required;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Workflow size={27} />
          <strong>PlantSense</strong>
          <span>Plant access</span>
        </div>
        {access?.user && (
          <button className="secondary" disabled={busy} onClick={signOut}>
            <LogOut size={15} />
            Sign out
          </button>
        )}
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!access ? (
        <section className={styles.panel} role="status">
          <LoaderCircle className="spin" />
          Loading staff access…
          {error && (
            <button className="secondary" onClick={() => location.reload()}>
              Retry connection
            </button>
          )}
        </section>
      ) : !access.available ? (
        <section className={styles.panel}>
          <h1>Staff workspace unavailable</h1>
          <p>
            The shared staff foundation currently runs locally. Managed cloud identity and
            persistence require their deployment gate.
          </p>
        </section>
      ) : !access.user || mode === 'invitation' ? (
        <div className={styles.entry}>
          <section className={styles.introduction}>
            <span className={styles.eyebrow}>SHARED PLANT WORKSPACE</span>
            <h1>
              {mode === 'invitation'
                ? 'Join your plant team.'
                : access.setup_required
                  ? 'Set up your plant workspace.'
                  : 'Sign in to your plant.'}
            </h1>
            <p>
              Inspect equipment, review evidence and keep maintenance decisions accountable to your
              team.
            </p>
            <div className={styles.benefits}>
              <p>
                <Check size={18} />
                Shared incidents and repair history
              </p>
              <p>
                <Check size={18} />
                Role-based approval and maintenance
              </p>
              <p>
                <Check size={18} />
                Retained audit records
              </p>
            </div>
            <p className={styles.sourceNote}>
              Connect observation sources or import attributed historical datasets in Monitor.
              Equipment without current data remains unknown. Live AI evaluation follows this
              milestone.
            </p>
          </section>
          <section className={styles.panel}>
            <h2>
              {mode === 'invitation'
                ? 'Accept invitation'
                : access.setup_required
                  ? 'Initial administrator'
                  : 'Staff sign-in'}
            </h2>
            <form className={styles.form} onSubmit={submit}>
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
              {enrolling && (
                <label>
                  Your name
                  <input
                    required
                    value={name}
                    minLength={2}
                    maxLength={80}
                    autoComplete="name"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              {access.setup_required && mode !== 'invitation' && (
                <>
                  <label>
                    Organization name
                    <input
                      required
                      value={organization}
                      minLength={2}
                      maxLength={80}
                      onChange={(event) => setOrganization(event.target.value)}
                    />
                  </label>
                  <label>
                    Plant name
                    <input
                      required
                      value={plantName}
                      minLength={2}
                      maxLength={80}
                      onChange={(event) => setPlantName(event.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                Email
                <input
                  type="email"
                  required
                  value={email}
                  maxLength={254}
                  autoComplete="username"
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
              {enrolling && <small>Use a unique passphrase of at least 15 characters.</small>}
              <button className="primary" disabled={busy}>
                {busy
                  ? 'Saving…'
                  : mode === 'invitation'
                    ? 'Accept invitation'
                    : access.setup_required
                      ? 'Create plant workspace'
                      : 'Sign in'}
                <ArrowRight size={16} />
              </button>
            </form>
            {!access.setup_required && (
              <button
                className="text-button"
                onClick={() => {
                  setMode(mode === 'invitation' ? 'sign-in' : 'invitation');
                  setError('');
                }}
              >
                {mode === 'invitation' ? 'Back to sign-in' : 'I have an invitation'}
              </button>
            )}
          </section>
        </div>
      ) : (
        <>
          <div className={styles.welcome}>
            <span className={styles.eyebrow}>YOUR PLANTS</span>
            <h1>Welcome, {access.user.display_name}</h1>
            <p>Choose a plant. Your role controls the actions available there.</p>
          </div>
          <div className={styles.plants}>
            {access.plants.map((plant) => (
              <section className={styles.panel} key={plant.id}>
                <Factory size={25} />
                <small>{plant.organization_name}</small>
                <h2>{plant.name}</h2>
                <span className={styles.role}>{plant.role}</span>
                <button className="primary" onClick={() => openPlant(plant)}>
                  Open plant
                  <ArrowRight size={16} />
                </button>
                {access.plants.length > 1 && (
                  <button className="text-button" onClick={() => setPlantId(plant.id)}>
                    Manage this plant
                  </button>
                )}
              </section>
            ))}
          </div>
          {!access.plants.length && (
            <section className={styles.panel}>
              <h2>No active plant access</h2>
              <p>Ask your plant administrator to grant access or send an invitation.</p>
              <button className="secondary" onClick={() => setMode('invitation')}>
                Accept an invitation
              </button>
            </section>
          )}
          {selectedPlant && (
            <PlantAdministration
              key={selectedPlant.id}
              plant={selectedPlant}
              onError={setError}
              onAccessChanged={setAccess}
            />
          )}
        </>
      )}
      <footer className={styles.footer}>Staff sessions expire after eight hours.</footer>
    </main>
  );
}
