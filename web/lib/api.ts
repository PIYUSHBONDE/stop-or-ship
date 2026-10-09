import { initializeApp, getApps } from '@firebase/app';
import { getAuth, signInAnonymously } from '@firebase/auth';
import createClient from 'openapi-fetch';
import type { paths, components } from './api-schema';
import type { State } from './types';

type Schema = components['schemas'];
export type CommandBodies = {
  '/reset': Record<string, never>;
  '/scenarios': Schema['WorkspaceSourceRequest'];
  '/replay': Schema['ReplayRequest'];
  '/investigation/retry': Record<string, never>;
  '/calculate': Schema['CalculationRequest'];
  '/approve': Schema['ApprovalRequest'];
  '/reject': Record<string, never>;
  '/reopen': Record<string, never>;
  '/repair/start': Record<string, never>;
  '/repair/reopen': Record<string, never>;
  '/repair/complete': Schema['RepairRequest'];
};
export type Command = keyof CommandBodies;
export type QuestionAnswer = Schema['QuestionResponse'];

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Bootstrap calls may overlap during React Strict Mode or page initialization.
let identityPending: Promise<string> | null = null;
let sessionPending: Promise<State> | null = null;

async function createIdentity(): Promise<string> {
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    const app =
      getApps()[0] ||
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    const auth = getAuth(app);
    await auth.authStateReady();
    const user = auth.currentUser || (await signInAnonymously(auth)).user;
    return user.getIdToken();
  }
  let token = localStorage.getItem('plantsense-token');
  if (!token) {
    const response = await fetchWithDeadline('/api/v1/local-identity', { method: 'POST' });
    if (!response.ok)
      throw new ApiError(
        'Could not create demo identity. Check the backend connection.',
        response.status,
      );
    const result: { token: string } = await response.json();
    token = result.token;
    localStorage.setItem('plantsense-token', token);
  }
  return token;
}

function identity(): Promise<string> {
  if (!identityPending)
    identityPending = createIdentity().finally(() => {
      identityPending = null;
    });
  return identityPending;
}

async function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const original = init?.signal || (input instanceof Request ? input.signal : undefined);
  const timeout = AbortSignal.timeout(65000);
  return fetch(input, {
    ...init,
    cache: 'no-store',
    signal: original ? AbortSignal.any([original, timeout]) : timeout,
  });
}

export const api = createClient<paths>({ fetch: fetchWithDeadline });
api.use({
  onRequest: async ({ request }) => {
    request.headers.set('Authorization', `Bearer ${await identity()}`);
    return request;
  },
});

async function request<T>(
  path: string,
  body?: unknown,
  key?: string,
  incidentId?: string,
): Promise<T> {
  const token = await identity();
  const response = await fetchWithDeadline('/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(incidentId ? { 'X-Incident-ID': incidentId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const requestId = response.headers.get('X-Request-ID') || undefined;
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('The API returned an unreadable response.', response.status, requestId);
  }
  if (!response.ok)
    throw new ApiError(
      typeof data.detail === 'string' ? data.detail : 'The request could not be validated.',
      response.status,
      requestId,
    );
  return data as T;
}

export function getSession(id: string) {
  return request<State>(`/sessions/${encodeURIComponent(id)}`);
}
export function advanceSession(id: string) {
  return request<State>(`/sessions/${encodeURIComponent(id)}/advance`, {});
}
export function sendCommand<K extends Command>(
  id: string,
  command: K,
  body: CommandBodies[K],
  key?: string,
  incidentId?: string,
) {
  return request<State | Schema['WorkOrder']>(
    `/sessions/${encodeURIComponent(id)}${command}`,
    body,
    key,
    incidentId,
  );
}
export function askQuestion(id: string, question: string) {
  return request<QuestionAnswer>(`/sessions/${encodeURIComponent(id)}/questions`, { question });
}

export function loadSession(): Promise<State> {
  if (!sessionPending)
    sessionPending = restoreSession().finally(() => {
      sessionPending = null;
    });
  return sessionPending;
}

async function restoreSession(): Promise<State> {
  const id = localStorage.getItem('plantsense-session');
  if (id) {
    const result = await api.GET('/api/v1/sessions/{sid}', { params: { path: { sid: id } } });
    if (result.data) return result.data;
    if (result.response.status !== 404)
      throw new ApiError(
        'Could not restore the saved session. Check the API connection.',
        result.response.status,
      );
  }
  const result = await api.POST('/api/v1/sessions');
  if (!result.data)
    throw new ApiError(
      'Could not create demo session. Check the API connection.',
      result.response.status,
    );
  localStorage.setItem('plantsense-session', result.data.id);
  return result.data;
}

export function money(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
