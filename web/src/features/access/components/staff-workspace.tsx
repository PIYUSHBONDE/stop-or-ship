'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Factory, LogOut, ShieldCheck, Users, Workflow } from 'lucide-react';
import { staffApi } from '@/lib/api/staff-client';
import type { AccessState, AuditPage, Member, PlantAccess } from '@/lib/api/staff-client';
import { SignInLanding } from '@/features/access/components/sign-in-landing';
import styles from '@/features/access/components/access.module.css';

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
  const [plantId, setPlantId] = useState('');

  useEffect(() => {
    let active = true;
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if (invite) setMode('invitation');
    setPlantId(localStorage.getItem('plantsense-workspace') || '');
    staffApi
      .access()
      .then((next) => {
        if (active) setAccess(next);
      })
      .catch((caught) => {
        if (active) setError(caught.message);
      });
    return () => {
      active = false;
    };
  }, []);

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-out failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedPlant = access?.plants.find((plant) => plant.id === plantId) || access?.plants[0];
  if (!access?.user || mode === 'invitation')
    return (
      <SignInLanding
        inviteOnly={mode === 'invitation' && Boolean(access?.user)}
        onSignedIn={(next) => {
          setAccess(next);
          setMode('sign-in');
        }}
      />
    );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Workflow size={27} />
          <strong>PlantSense</strong>
          <span>Plant access</span>
        </div>
        <button className="secondary" disabled={busy} onClick={signOut}>
          <LogOut size={15} />
          Sign out
        </button>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
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
      <footer className={styles.footer}>Staff sessions expire after eight hours.</footer>
    </main>
  );
}
