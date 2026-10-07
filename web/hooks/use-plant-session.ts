'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  advanceSession,
  askQuestion,
  getSession,
  loadSession,
  sendCommand,
} from '@/lib/api';
import type { Command, CommandBodies, QuestionAnswer } from '@/lib/api';
import type { State } from '@/lib/types';

type EmptyCommand =
  '/reset' | '/investigation/retry' | '/reject' | '/reopen' | '/repair/start' | '/repair/reopen';
type ActionArgs<K extends Command> = K extends EmptyCommand
  ? [body?: CommandBodies[K]]
  : [body: CommandBodies[K]];

/** Serializes polling and mutations so an older response cannot replace a newer state. */
export function usePlantSession(enabled = true) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const current = useRef<State | null>(null);
  const mounted = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const actionPending = useRef(false);
  const pollPending = useRef(false);
  const approvalKeys = useRef(new Map<string, string>());

  const serialize = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(operation);
    queue.current = result.catch(() => undefined);
    return result;
  }, []);

  const publish = useCallback((next: State) => {
    if (!mounted.current) return;
    current.current = next;
    setState(next);
    setConnected(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    mounted.current = true;
    loadSession()
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
  }, [enabled, publish]);

  useEffect(() => {
    if (!enabled || !state?.id) return;
    const id = state.id;
    const timer = setInterval(() => {
      if (actionPending.current || pollPending.current || document.hidden) return;
      pollPending.current = true;
      serialize(async () => {
        if (!mounted.current) return;
        publish(await advanceSession(id));
      })
        .catch((cause) => {
          if (!mounted.current) return;
          setConnected(false);
          setError(cause instanceof Error ? cause.message : 'Connection interrupted');
        })
        .finally(() => {
          pollPending.current = false;
        });
    }, 2000);
    return () => clearInterval(timer);
  }, [enabled, state?.id, publish, serialize]);

  const perform = useCallback(
    async <T>(operation: (session: State) => Promise<T>): Promise<T | undefined> => {
      if (actionPending.current || !current.current) return undefined;
      actionPending.current = true;
      setBusy(true);
      setError('');
      try {
        return await serialize(async () => {
          const session = current.current!;
          try {
            const result = await operation(session);
            publish(await getSession(session.id));
            return result;
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 409) {
              // A rejected approval may have committed newly observed constraints.
              try {
                publish(await getSession(session.id));
              } catch {
                if (mounted.current) setConnected(false);
              }
            }
            throw cause;
          }
        });
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : 'Action failed');
        return undefined;
      } finally {
        actionPending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [publish, serialize],
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
        await sendCommand(session.id, command, body, undefined, expectedIncidentId || undefined);
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
      await sendCommand(session.id, '/approve', body, key, expectedIncidentId);
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
    return perform((session) => askQuestion(session.id, question));
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
    dismissError: () => setError(''),
  };
}
