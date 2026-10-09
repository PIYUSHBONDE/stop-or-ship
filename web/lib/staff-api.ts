import type { components } from './api-schema';
import { ApiError } from './api';

type Schema = components['schemas'];
export type AccessState = Schema['AccessState'];
export type Member = Schema['Member'];
export type PlantAccess = Schema['PlantAccess'];
export type AuditPage = Schema['AuditPage'];

export async function staffRequest<T>(
  path: string,
  body?: unknown,
  key?: string,
  incidentId?: string,
): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(incidentId ? { 'X-Incident-ID': incidentId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  });
  const data = await response.json();
  const validation = Array.isArray(data.detail)
    ? data.detail
        .slice(0, 3)
        .map(
          (entry: { loc?: (string | number)[]; msg?: string }) =>
            `${entry.loc?.filter((part) => part !== 'body').join('.') || 'Configuration'}: ${entry.msg || 'Invalid value'}`,
        )
        .join(' · ')
    : '';
  if (!response.ok)
    throw new ApiError(
      typeof data.detail === 'string'
        ? data.detail
        : validation || 'Please check the supplied fields.',
      response.status,
      response.headers.get('X-Request-ID') || undefined,
    );
  return data as T;
}

export const staffApi = {
  access: () => staffRequest<AccessState>('/access/state'),
  setup: (body: Schema['SetupRequest']) => staffRequest<AccessState>('/access/setup', body),
  signIn: (body: Schema['Credentials']) => staffRequest<AccessState>('/access/sign-in', body),
  signOut: () => staffRequest('/access/sign-out', {}),
  accept: (body: Schema['AcceptInvitation']) =>
    staffRequest<AccessState>('/access/accept-invitation', body),
  members: (id: string) => staffRequest<Member[]>(`/plants/${encodeURIComponent(id)}/members`),
  invite: (id: string, body: Schema['InviteRequest']) =>
    staffRequest<Schema['InvitationReceipt']>(
      `/plants/${encodeURIComponent(id)}/invitations`,
      body,
    ),
  updateMember: (plant: string, user: string, body: Schema['MembershipUpdate']) =>
    staffRequest<AccessState>(
      `/plants/${encodeURIComponent(plant)}/members/${encodeURIComponent(user)}`,
      body,
    ),
  audit: (id: string, cursor?: number) =>
    staffRequest<AuditPage>(
      `/plants/${encodeURIComponent(id)}/audit${cursor ? `?cursor=${cursor}` : ''}`,
    ),
};

export function sharedSnapshot(plantId: string, incidentId?: string | null) {
  return staffRequest<Schema['SharedPlantSnapshot']>(
    `/plants/${encodeURIComponent(plantId)}/snapshot${incidentId ? `?incident=${encodeURIComponent(incidentId)}` : ''}`,
  );
}
