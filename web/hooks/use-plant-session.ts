'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceSession, askQuestion, getSession, loadSession, sendCommand } from '@/lib/api';
import type { Command, CommandBodies, QuestionAnswer } from '@/lib/api';
import type { State } from '@/lib/types';

type EmptyCommand =
  '/reset' | '/investigation/retry' | '/reject' | '/reopen' | '/repair/start' | '/repair/reopen';
type ActionArgs<K extends Command> = K extends EmptyCommand
  ? [body?: CommandBodies[K]]
  : [body: CommandBodies[K]];

/** Serializes polling and mutations so an older response cannot replace a newer state. */
export function usePlantSession() {
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
  }, [publish]);

  useEffect(() => {
    if (!state?.id) return;
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
  }, [state?.id, publish, serialize]);

  const perform = useCallback(
    async <T>(operation: (session: State) => Promise<T>): Promise<T | undefined> => {
      if (actionPending.current || !current.current) return undefined;
      actionPending.current = true;
      setBusy(true);
      setError('');
      try {
        return await serialize(async () => {
          const session = current.current!;
          const result = await operation(session);
          publish(await getSession(session.id));
          return result;
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
    const body = (args[0] || {}) as CommandBodies[K];
    const incidentId = state?.incident?.id;
    return (
      (await perform(async (session) => {
        await sendCommand(session.id, command, body, undefined, incidentId);
        return true;
      })) === true
    );
  }

  async function approve(body: CommandBodies['/approve']): Promise<boolean> {
    // A timeout can happen after commit. Retrying the same intent reuses its key.
    const intent = JSON.stringify([current.current?.id, current.current?.generation, body]);
    const incidentId = state?.incident?.id;
    const key = approvalKeys.current.get(intent) || crypto.randomUUID();
    approvalKeys.current.set(intent, key);
    const succeeded = await perform(async (session) => {
      await sendCommand(session.id, '/approve', body, key, incidentId);
      return true;
    });
    if (succeeded) approvalKeys.current.delete(intent);
    return succeeded === true;
  }

  async function ask(question: string): Promise<QuestionAnswer | undefined> {
    return perform((session) => askQuestion(session.id, question));
  }

  return { state, error, busy, connected, act, approve, ask, dismissError: () => setError('') };
}
