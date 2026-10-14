'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Mic, Square, Volume2, X } from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import type { components } from '@/lib/generated/api-schema';
import { startRecording } from './recording';
import styles from './assistant.module.css';
import { simulationCaseStatus } from '@/features/incidents/lib/simulation-case';

type Schema = components['schemas'];
type Turn = { question: string; response: Schema['AssistantAnswer'] };

function invalidateVoice(epoch: { current: number }) {
  epoch.current++;
}

export function AssistantPanel() {
  const { state } = usePlant();
  const pathname = usePathname();
  const query = useSearchParams();
  if (!state?.workspace) return null;
  return (
    <Panel
      key={`${state.workspace.user.id}:${state.workspace.id}:${pathname}:${query.get('view')}:${query.get('case')}:${query.get('assignment')}:${query.get('incident')}`}
    />
  );
}

function Panel() {
  const { state, selected, assistantRequest, busy } = usePlant();
  const pathname = usePathname();
  const query = useSearchParams();
  const simulation = usePreviewDispatch();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState('');
  const alive = useRef(true);
  const stopRecording = useRef<((discard?: boolean) => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const retry = useRef<{ intent: string; key: string; body: Schema['AssistantQuestion'] } | null>(
    null,
  );
  const voiceEpoch = useRef(0);
  const screen = useRef(pathname);
  screen.current = pathname;
  const incidentScreen =
    pathname === '/incidents' ||
    pathname === '/maintenance' ||
    (pathname === '/memory' && !!query.get('incident'));
  const synthetic =
    !query.get('incident') &&
    query.get('view') !== 'observations' &&
    (pathname === '/plant' ||
      pathname.startsWith('/monitoring') ||
      pathname === '/operators' ||
      (pathname === '/incidents' && !!query.get('case')));
  const selectedCase = simulation.ledger.cases.find(
    (c) => c.id === (query.get('case') || query.get('assignment')),
  );
  const machineRoute = pathname.startsWith('/monitoring/') ? pathname.split('/')[2] : null;
  const assetId =
    selectedCase?.assetId ||
    state?.assets.find((a) => a.id === machineRoute)?.id ||
    (incidentScreen && state?.incident ? state.incident.asset_id : selected);
  const context = {
    incident_id:
      !synthetic &&
      query.get('incident') === state?.incident?.id &&
      state?.incident?.asset_id === assetId
        ? state.incident.id
        : null,
    asset_id: state?.assets.some((a) => a.id === assetId) ? assetId : null,
  };
  const currentContext = useRef(JSON.stringify({ ...context, case: selectedCase?.id }));
  currentContext.current = JSON.stringify({ ...context, case: selectedCase?.id });
  const selectedCaseId = selectedCase?.id;

  useEffect(() => {
    if (query.get('ask') === 'case' && selectedCaseId) {
      setOpen(true);
      setInput(
        'Explain this simulated case from its saved detection evidence. What remains unconfirmed, and how does scenario recovery differ from operational verification?',
      );
    }
  }, [query, selectedCaseId]);

  function stopPlayback() {
    player.current?.pause();
    player.current = null;
    setPlaying('');
  }
  useEffect(() => {
    alive.current = true;
    const audioUrls = urls.current;
    return () => {
      alive.current = false;
      invalidateVoice(voiceEpoch);
      stopRecording.current?.(true);
      player.current?.pause();
      for (const url of audioUrls.values()) URL.revokeObjectURL(url);
      audioUrls.clear();
    };
  }, []);

  useEffect(() => {
    voiceEpoch.current++;
    stopRecording.current?.(true);
    stopRecording.current = null;
    player.current?.pause();
    player.current = null;
    setRecording(false);
    setPlaying('');
  }, [pathname, selected]);

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      voiceEpoch.current++;
      stopRecording.current?.(true);
      stopRecording.current = null;
      setRecording(false);
      stopPlayback();
    }
  }

  async function send() {
    if (!input.trim() || pending || recording || busy) return;
    if (
      selectedCase &&
      [
        selectedCase.occurredAt,
        selectedCase.attendedAt,
        selectedCase.fixedAt,
        selectedCase.clearedAt,
      ].some((at) => at !== null && !Number.isFinite(new Date(at).getTime()))
    ) {
      setError(
        'Saved case timestamps are invalid. This case cannot be submitted to the assistant.',
      );
      return;
    }
    const question = input.trim();
    const base = {
      ...context,
      question,
      screen: pathname.split('/')[1] as Schema['AssistantQuestion']['screen'],
      history: turns.slice(-6).map((t) => ({ question: t.question, answer: t.response.answer })),
    };
    const simulationContext: Schema['SimulationContext'] | undefined = synthetic
      ? {
          captured_at: new Date().toISOString(),
          selected_case_id: selectedCase?.id ?? null,
          equipment: (state?.assets ?? []).slice(0, 36).map((a) => ({
            asset_id: a.id,
            readings: (simulation.readings[a.id] ?? []).slice(0, 8),
          })),
          assignments: simulation.assignments.slice(0, 5).map((a) => ({
            id: a.id,
            asset_id: a.assetId,
            operator_id: a.operatorId,
            status: a.phase,
            note: 'Simulated operator assignment',
          })),
          cases: [
            ...(selectedCase ? [selectedCase] : []),
            ...simulation.ledger.cases.filter((c) => c.id !== selectedCase?.id),
          ]
            .slice(0, 10)
            .map((c) => ({
              id: c.id,
              asset_id: c.assetId,
              operator_id: c.operatorId,
              status: simulationCaseStatus(c),
              note: c.message.slice(0, 600),
            })),
          case_evidence: selectedCase
            ? {
                case_id: selectedCase.id,
                asset_id: selectedCase.assetId,
                occurred_at: new Date(selectedCase.occurredAt).toISOString(),
                attended_at: selectedCase.attendedAt
                  ? new Date(selectedCase.attendedAt).toISOString()
                  : null,
                fixed_at: selectedCase.fixedAt
                  ? new Date(selectedCase.fixedAt).toISOString()
                  : null,
                recovered_at: selectedCase.clearedAt
                  ? new Date(selectedCase.clearedAt).toISOString()
                  : null,
                interrupted: !!selectedCase.interrupted,
                detection: {
                  signal_id: selectedCase.signalId,
                  value: selectedCase.value,
                  unit: selectedCase.unit,
                  low: selectedCase.metadata.low,
                  high: selectedCase.metadata.high,
                  ooc:
                    selectedCase.value < selectedCase.metadata.low ||
                    selectedCase.value > selectedCase.metadata.high,
                },
                topology_captured: !!selectedCase.context,
                affected_asset_ids: selectedCase.context?.affected.map((a) => a.id) ?? [],
                lines:
                  selectedCase.context?.lines.map((a) => ({
                    id: a.id,
                    name: a.name,
                    capacity_per_hour: a.capacity,
                  })) ?? [],
                recovery_basis: 'scenario_timer',
              }
            : null,
        }
      : undefined;
    const intent = JSON.stringify({
      ...base,
      synthetic,
      selected_case_id: selectedCase?.id ?? null,
    });
    const body: Schema['AssistantQuestion'] =
      retry.current?.intent === intent
        ? retry.current.body
        : { ...base, ...(simulationContext ? { simulation_context: simulationContext } : {}) };
    const key = retry.current?.intent === intent ? retry.current.key : crypto.randomUUID();
    retry.current = { intent, key, body };
    setPending('Answering from plant evidence…');
    setError('');
    const expected = currentContext.current;
    const expectedScreen = pathname;
    try {
      const response = await assistantRequest<Schema['AssistantAnswer']>('questions', body, key);
      if (
        !alive.current ||
        currentContext.current !== expected ||
        screen.current !== expectedScreen
      )
        return;
      setTurns((previous) => [...previous, { question, response }].slice(-6));
      setInput('');
      retry.current = null;
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('receipt expired or failed'))
        retry.current = null;
      if (alive.current)
        setError(cause instanceof Error ? cause.message : 'Assistant unavailable.');
    } finally {
      if (alive.current) setPending('');
    }
  }

  async function record() {
    if (pending || busy) return;
    if (recording) {
      stopRecording.current?.();
      stopRecording.current = null;
      setRecording(false);
      return;
    }
    setError('');
    const epoch = ++voiceEpoch.current;
    const expected = currentContext.current;
    try {
      setPending('Waiting for microphone permission…');
      const stop = await startRecording(async (audio_base64) => {
        if (!alive.current || epoch !== voiceEpoch.current || expected !== currentContext.current)
          return;
        setRecording(false);
        setPending('Transcribing with Google…');
        try {
          const response = await assistantRequest<Schema['TranscriptionResponse']>(
            'transcriptions',
            { ...context, audio_base64 },
            crypto.randomUUID(),
          );
          if (alive.current && epoch === voiceEpoch.current && expected === currentContext.current)
            setInput(response.transcript);
        } catch (cause) {
          if (alive.current && epoch === voiceEpoch.current)
            setError(
              cause instanceof Error
                ? cause.message
                : 'Transcription failed. Type your question instead.',
            );
        } finally {
          if (alive.current) setPending('');
        }
      });
      if (!alive.current || epoch !== voiceEpoch.current) {
        stop(true);
        return;
      }
      stopRecording.current = stop;
      setRecording(true);
    } catch {
      if (alive.current)
        setError('Microphone unavailable or permission denied. Type your question instead.');
    } finally {
      if (alive.current) setPending('');
    }
  }

  async function play(response: Schema['AssistantAnswer']) {
    if (playing === response.answer_reference) {
      stopPlayback();
      return;
    }
    if (pending || recording || busy) return;
    if (
      response.configuration_version !== state?.configuration_version ||
      response.calculation_version !==
        (context.incident_id ? state?.incident?.calculation_version : null)
    ) {
      setError('Context changed. Ask again before playing the saved answer.');
      return;
    }
    stopPlayback();
    setError('');
    const epoch = voiceEpoch.current;
    try {
      let url = urls.current.get(response.answer_reference);
      if (!url) {
        setPending('Preparing voice…');
        const data = await assistantRequest<Schema['SpeechResponse']>(
          'speech',
          {
            incident_id: response.incident_id,
            asset_id: response.asset_id,
            answer_reference: response.answer_reference,
          },
          response.answer_reference,
        );
        if (!alive.current || epoch !== voiceEpoch.current) return;
        const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: data.mime_type }));
        urls.current.set(response.answer_reference, url);
        while (urls.current.size > 6) {
          const oldest = urls.current.keys().next().value!;
          URL.revokeObjectURL(urls.current.get(oldest)!);
          urls.current.delete(oldest);
        }
      }
      const audio = new Audio(url);
      player.current = audio;
      audio.onended = () => {
        if (alive.current) setPlaying('');
      };
      setPlaying(response.answer_reference);
      await audio.play();
    } catch (cause) {
      if (alive.current) {
        stopPlayback();
        setError(
          cause instanceof Error ? cause.message : 'Playback unavailable. Read the answer below.',
        );
      }
    } finally {
      if (alive.current) setPending('');
    }
  }

  const suggestions = selectedCase
    ? [
        'Explain this simulated case from its saved detection evidence.',
        'What remains unconfirmed about the mechanical cause?',
        'How does scenario recovery differ from operational verification?',
      ]
    : pathname === '/memory'
      ? ['What verified repairs exist for this equipment?', 'What was corrected after repair?']
      : pathname === '/incidents' || pathname === '/maintenance'
        ? [
            'What evidence supports this incident?',
            'What blocks approval?',
            'Explain the saved intervention costs.',
          ]
        : [
            'Which current readings are missing?',
            'Explain the selected equipment.',
            'How do measured output and rated capacity differ?',
          ];
  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Trigger className={styles.trigger}>
        <MessageCircle size={16} /> Ask PlantSense
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel}>
          <div className={styles.heading}>
            <Dialog.Title>Ask PlantSense</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close assistant">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.context}>
            {state?.plant.name} · {context.asset_id || 'All equipment'} ·{' '}
            {selectedCase
              ? `Simulated case ${selectedCase.id}`
              : context.incident_id
                ? `Incident ${context.incident_id.slice(0, 8)}`
                : 'No selected case'}
          </Dialog.Description>
          <p className={styles.note}>
            {synthetic
              ? 'Synthetic screen context. Saved case detection is historical; current readings may differ. Scenario recovery is not operational verification.'
              : 'Operational context only. Missing observations remain unknown. Saved evidence and calculations retain their own provenance.'}{' '}
            Read-only help; approvals remain in existing controls.
          </p>
          <div className={styles.conversation} aria-live="polite">
            {!turns.length && (
              <div className={styles.suggestions}>
                {suggestions.map((q) => (
                  <button key={q} onClick={() => setInput(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {turns.map((turn) => (
              <article key={turn.response.answer_reference} className={styles.turn}>
                <p className={styles.question}>{turn.question}</p>
                <p>{turn.response.answer}</p>
                <small>
                  {turn.response.provider} · Configuration {turn.response.configuration_version}
                  {turn.response.calculation_version &&
                    ` · Calculation ${turn.response.calculation_version}`}
                </small>
                {turn.response.costs.length > 0 && (
                  <div className={styles.costs}>
                    <strong>Saved comparison · INR · eight-hour horizon</strong>
                    <span>
                      Synthetic planning assumptions; not measured losses or calibrated failure
                      risk.
                    </span>
                    {turn.response.costs.map((cost) => (
                      <div key={cost.option_id}>
                        {cost.name}: ₹
                        {(cost.total_paise / 100).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        {cost.feasible ? '' : '· Not feasible'}
                      </div>
                    ))}
                  </div>
                )}
                {turn.response.citations.map((source) => (
                  <details key={source.id}>
                    <summary>
                      {source.title} · {source.id}
                    </summary>
                    <pre>{source.text}</pre>
                  </details>
                ))}
                <div className={styles.links}>
                  {turn.response.navigation.map((href) => (
                    <Link key={href} href={href} onClick={() => close(false)}>
                      {href.split('?')[0].slice(1).replace('-', ' ')}
                    </Link>
                  ))}
                </div>
                <button
                  className="secondary"
                  disabled={
                    playing !== turn.response.answer_reference && (!!pending || recording || busy)
                  }
                  onClick={() => void play(turn.response)}
                >
                  {playing === turn.response.answer_reference ? (
                    <Square size={14} />
                  ) : (
                    <Volume2 size={14} />
                  )}
                  {playing === turn.response.answer_reference ? 'Stop' : 'Play answer'}
                </button>
                {turn.response.usage && (
                  <p className={styles.note}>
                    Estimated AI cost:{' '}
                    {(turn.response.usage.charged_micro_usd / 1000000).toFixed(6)} USD ·{' '}
                    {turn.response.usage.status}
                  </p>
                )}
              </article>
            ))}
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {pending && <p role="status">{pending}</p>}
          {recording && <p role="status">Recording · stops after 15 seconds</p>}
          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="assistant-question">Question or editable transcript</label>
            <textarea
              id="assistant-question"
              value={input}
              maxLength={1000}
              rows={3}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about this plant…"
            />
            <div className={styles.actions}>
              <button
                type="button"
                className="secondary"
                onClick={() => void record()}
                disabled={!!pending || busy}
              >
                {recording ? <Square size={16} /> : <Mic size={16} />}
                {recording ? 'Stop recording' : 'Record question'}
              </button>
              <button
                className="primary"
                disabled={!input.trim() || !!pending || recording || busy}
              >
                Send question
              </button>
            </div>
            <small>
              Check equipment IDs, numbers, and units before sending. Recordings go to Google for
              transcription. Edit before sending. Chat stays in this tab; no permanent audio
              archive.
            </small>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
