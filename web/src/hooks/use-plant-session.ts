'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  advanceSession,
  askQuestion,
  getSession,
  loadSession,
  sendCommand,
} from '@/lib/api/client';
import type { Command, CommandBodies, QuestionAnswer } from '@/lib/api/client';
import type { State } from '@/lib/types';
import { sharedSnapshot, staffRequest } from '@/lib/api/staff-client';
import type { components } from '@/lib/generated/api-schema';

type EmptyCommand =
  '/reset' | '/investigation/retry' | '/reject' | '/reopen' | '/repair/start' | '/repair/reopen';
type ActionArgs<K extends Command> = K extends EmptyCommand
  ? [body?: CommandBodies[K]]
  : [body: CommandBodies[K]];

/** Serializes polling and mutations so an older response cannot replace a newer state. */
export function usePlantSession(
  enabled = true,
  workspace?: { plantId: string; incidentId?: string | null },
) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const current = useRef<State | null>(null);
  const mounted = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const actionPending = useRef(false);
  const pollPending = useRef(false);
  const assistantPending = useRef(false);
  const approvalKeys = useRef(new Map<string, string>());
  const caseKeys = useRef(new Map<string, string>());
  const plantId = workspace?.plantId;
  const incidentId = workspace?.incidentId;
  const contextKey = JSON.stringify([enabled, plantId, incidentId]);
  const context = useRef(contextKey);
  context.current = contextKey;

  const refresh = useCallback(
    (id: string) => (plantId ? sharedSnapshot(plantId, incidentId) : getSession(id)),
    [plantId, incidentId],
  );

  const commandRequest = useCallback(
    (session: State, command: Command, body: unknown, key?: string, expectedId?: string) => {
      if (!session.workspace)
        return sendCommand(session.id, command, body as never, key, expectedId);
      if (command === '/reset') throw new ApiError('Shared plant history cannot be reset.', 403);
      const input =
        command === '/approve'
          ? {
              option_id: (body as CommandBodies['/approve']).option_id,
              calculation_version: (body as CommandBodies['/approve']).calculation_version,
            }
          : body;
      return staffRequest(
        `/plants/${encodeURIComponent(session.workspace.id)}${command}`,
        input,
        key,
        expectedId,
      );
    },
    [],
  );

  const serialize = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(operation);
    queue.current = result.catch(() => undefined);
    return result;
  }, []);

  const publish = useCallback(
    (next: State) => {
      if (!mounted.current || context.current !== contextKey) return;
      current.current = next;
      setState(next);
      setConnected(true);
    },
    [contextKey],
  );

  useEffect(() => {
    if (!enabled) {
      current.current = null;
      setState(null);
      setConnected(false);
      return;
    }
    let active = true;
    mounted.current = true;
    setState(null);
    setError('');
    setConnected(false);
    current.current = null;
    serialize(() => (plantId ? sharedSnapshot(plantId, incidentId) : loadSession()))
      .then((next) => {
        if (active) publish(next);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Connection interrupted');
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [enabled, publish, serialize, plantId, incidentId]);

  useEffect(() => {
    if (!enabled || !state?.id) return;
    const id = state.id;
    let active = true;
    const timer = setInterval(() => {
      if (
        actionPending.current ||
        assistantPending.current ||
        pollPending.current ||
        document.hidden
      )
        return;
      pollPending.current = true;
      serialize(async () => {
        if (!mounted.current) return;
        const next = plantId ? await refresh(id) : await advanceSession(id);
        if (active) publish(next);
      })
        .catch((cause) => {
          if (!mounted.current || !active) return;
          setConnected(false);
          if (plantId && cause instanceof ApiError && [401, 404].includes(cause.status)) {
            current.current = null;
            setState(null);
          }
          setError(cause instanceof Error ? cause.message : 'Connection interrupted');
        })
        .finally(() => {
          pollPending.current = false;
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, state?.id, publish, serialize, plantId, refresh]);

  const perform = useCallback(
    async <T>(operation: (session: State) => Promise<T>): Promise<T | undefined> => {
      if (actionPending.current || !current.current) return undefined;
      if (assistantPending.current) {
        setError('Assistant request in progress. Wait for completion before saving an action.');
        return undefined;
      }
      actionPending.current = true;
      setBusy(true);
      setError('');
      try {
        return await serialize(async () => {
          // Navigation can change the displayed case while an older action is queued.
          if (context.current !== contextKey || !current.current) return undefined;
          const session = current.current!;
          try {
            const result = await operation(session);
            publish(await refresh(session.id));
            return result;
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 409) {
              // A rejected approval may have committed newly observed constraints.
              try {
                publish(await refresh(session.id));
              } catch {
                if (mounted.current) setConnected(false);
              }
            }
            throw cause;
          }
        });
      } catch (cause) {
        if (mounted.current && context.current === contextKey) {
          if (plantId && cause instanceof ApiError && [401, 404].includes(cause.status)) {
            current.current = null;
            setState(null);
            setConnected(false);
          }
          setError(cause instanceof Error ? cause.message : 'Action failed');
        }
        return undefined;
      } finally {
        actionPending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [publish, serialize, refresh, contextKey, plantId],
  );

  async function act<K extends Command>(command: K, ...args: ActionArgs<K>): Promise<boolean> {
    return actForIncident(state?.incident?.id || '', command, ...args);
  }

  async function actForIncident<K extends Command>(
    expectedIncidentId: string,
    command: K,
    ...args: ActionArgs<K>
  ): Promise<boolean> {
    const body = (args[0] || {}) as CommandBodies[K];
    return (
      (await perform(async (session) => {
        if (expectedIncidentId && session.incident?.id !== expectedIncidentId)
          throw new ApiError('Incident changed; reopen the current incident before acting.', 409);
        await commandRequest(session, command, body, undefined, expectedIncidentId || undefined);
        return true;
      })) === true
    );
  }

  async function approve(
    body: CommandBodies['/approve'],
    expectedIncidentId = state?.incident?.id,
  ): Promise<boolean> {
    // A timeout can happen after commit. Retrying the same intent reuses its key.
    const intent = JSON.stringify([current.current?.id, current.current?.generation, body]);
    const key = approvalKeys.current.get(intent) || crypto.randomUUID();
    approvalKeys.current.set(intent, key);
    const succeeded = await perform(async (session) => {
      if (!expectedIncidentId || session.incident?.id !== expectedIncidentId)
        throw new ApiError('Incident changed; reopen the current incident before acting.', 409);
      await commandRequest(session, '/approve', body, key, expectedIncidentId);
      return true;
    });
    if (succeeded) approvalKeys.current.delete(intent);
    const active = current.current?.incident;
    return (
      succeeded === true &&
      !!active &&
      active.id === expectedIncidentId &&
      active.state === 'approved' &&
      active.work_order?.status === 'approved' &&
      active.work_order.approval.calculation_version === body.calculation_version
    );
  }

  async function ask(question: string): Promise<QuestionAnswer | undefined> {
    if (current.current?.workspace) {
      setError(
        'Shared plant questions will be enabled with the live AI milestone. Evidence is available in Incidents.',
      );
      return undefined;
    }
    return perform((session) => askQuestion(session.id, question));
  }

  async function assistantRequest<T>(
    operation: 'questions' | 'transcriptions' | 'speech',
    body: unknown,
    key: string,
  ): Promise<T> {
    if (actionPending.current || assistantPending.current || !current.current?.workspace)
      throw new ApiError('Another request is in progress. Try again after it completes.', 409);
    assistantPending.current = true;
    try {
      return await serialize(async () => {
        if (context.current !== contextKey || !current.current?.workspace)
          throw new ApiError('Plant context changed. Ask again in the current workspace.', 409);
        const result = await staffRequest<T>(
          `/plants/${current.current.workspace.id}/assistant/${operation}`,
          body,
          key,
        );
        if (!mounted.current || context.current !== contextKey)
          throw new ApiError('Plant context changed. Previous response discarded.', 409);
        return result;
      });
    } finally {
      assistantPending.current = false;
    }
  }

  async function caseRequest<T>(path: string, body?: unknown, key?: string): Promise<T> {
    const mutating = body !== undefined;
    if (!/^\/(?:cases|tasks|automation-policy|notifications)(?:[/?]|$)/.test(path))
      throw new ApiError('Unsupported case operation.', 400);
    if (
      (mutating && (actionPending.current || assistantPending.current)) ||
      !current.current?.workspace
    )
      throw new ApiError('Another request is in progress. Try again after it completes.', 409);
    if (mutating) assistantPending.current = true;
    const intent = JSON.stringify([
      current.current.workspace.id,
      current.current.workspace.user.id,
      path,
      body,
    ]);
    const requestKey =
      body === undefined ? undefined : key || caseKeys.current.get(intent) || crypto.randomUUID();
    if (requestKey) caseKeys.current.set(intent, requestKey);
    try {
      return await serialize(async () => {
        if (context.current !== contextKey || !current.current?.workspace)
          throw new ApiError('Plant context changed. Reopen the current case.', 409);
        const result = await staffRequest<T>(
          `/plants/${encodeURIComponent(current.current.workspace.id)}${path}`,
          body,
          requestKey,
        );
        if (!mounted.current || context.current !== contextKey)
          throw new ApiError('Plant context changed. Previous case response discarded.', 409);
        caseKeys.current.delete(intent);
        return result;
      });
    } finally {
      if (mutating) assistantPending.current = false;
    }
  }

  async function configuration() {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Plant configuration requires staff access.', 403);
      return staffRequest<components['schemas']['ConfigurationView']>(
        `/plants/${session.workspace.id}/configuration`,
      );
    });
  }

  async function configurationTemplate(lines: number, name: string) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Plant configuration requires staff access.', 403);
      return staffRequest<components['schemas']['PlantConfiguration']>(
        `/plants/${session.workspace.id}/configuration/template`,
        { lines, name },
      );
    });
  }

  async function saveConfiguration(body: components['schemas']['ConfigurationUpdate']) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Plant configuration requires staff access.', 403);
      return staffRequest<components['schemas']['ConfigurationView']>(
        `/plants/${session.workspace.id}/configuration`,
        body,
      );
    });
  }

  async function validateConfiguration(body: components['schemas']['PlantConfiguration']) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Plant configuration requires staff access.', 403);
      return staffRequest<components['schemas']['PlantConfiguration']>(
        `/plants/${session.workspace.id}/configuration/validate`,
        body,
      );
    });
  }

  async function saveMonitoring(body: components['schemas']['MonitoringUpdate']) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Monitoring requires staff access.', 403);
      return staffRequest<components['schemas']['MonitoringView']>(
        `/plants/${session.workspace.id}/monitoring`,
        body,
      );
    });
  }

  async function controlMonitoring(action: components['schemas']['MonitoringControl']['action']) {
    return perform((session) => {
      if (!session.workspace || !session.monitoring)
        throw new ApiError('Monitoring requires staff access.', 403);
      return staffRequest<components['schemas']['MonitoringView']>(
        `/plants/${session.workspace.id}/monitoring/clock`,
        {
          action,
          expected_tick: session.monitoring.tick,
          expected_version: session.monitoring.version,
        },
        crypto.randomUUID(),
      );
    });
  }

  async function saveSource(body: components['schemas']['SourceConfiguration'], sourceId?: string) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Staff access required.', 403);
      return staffRequest<components['schemas']['SourceView']>(
        `/plants/${session.workspace.id}/sources${sourceId ? '/' + encodeURIComponent(sourceId) : ''}`,
        body,
      );
    });
  }

  async function previewImport(sourceId: string, body: components['schemas']['ImportRequest']) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Staff access required.', 403);
      return staffRequest<components['schemas']['ImportPreview']>(
        `/plants/${session.workspace.id}/sources/${encodeURIComponent(sourceId)}/imports/preview`,
        body,
      );
    });
  }

  async function commitImport(
    sourceId: string,
    body: components['schemas']['ImportRequest'],
    key: string,
  ) {
    return perform((session) => {
      if (!session.workspace) throw new ApiError('Staff access required.', 403);
      return staffRequest<components['schemas']['IngestionResult']>(
        `/plants/${session.workspace.id}/sources/${encodeURIComponent(sourceId)}/imports/commit`,
        body,
        key,
      );
    });
  }

  return {
    state,
    error,
    busy,
    connected,
    act,
    actForIncident,
    approve,
    ask,
    assistantRequest,
    caseRequest,
    configuration,
    configurationTemplate,
    saveConfiguration,
    validateConfiguration,
    saveMonitoring,
    controlMonitoring,
    saveSource,
    previewImport,
    commitImport,
    can: (permission: string) =>
      !state?.workspace || state.workspace.permissions.includes(permission),
    dismissError: () => setError(''),
  };
}
