'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePreviewDispatch } from '@/features/operators/lib/preview-dispatch-provider';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  MessageCircle,
  Mic,
  Square,
  Volume2,
  X,
  History,
  Workflow,
  ArrowUp,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { usePlant } from '@/providers/plant-session-provider';
import { ApiError } from '@/lib/api/client';
import type { components } from '@/lib/generated/api-schema';
import { startRecording } from './recording';
import styles from './assistant.module.css';
import { assistantSelection, captureSimulationContext } from './context';
import { ChatAnswer } from './chat-answer';
import { CaseIntake } from '@/features/cases/case-intake';

function subscribeMobile(change: () => void) {
  const media = window.matchMedia('(max-width: 760px)');
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
const mobileSnapshot = () => window.matchMedia('(max-width: 760px)').matches;
const serverSnapshot = () => false;

type Schema = components['schemas'];
type Turn = {
  question: string;
  response: Schema['AssistantAnswer'];
  scope: string;
  capturedAt?: string;
  assignmentId?: string;
  contextLabel?: string;
  contextVersion?: string;
};

function sourceLabel(id: string, title: string) {
  return (
    (
      {
        'plant-state': 'Plant records',
        'factory-case': 'Selected case, tasks and findings',
        'browser-simulation': 'Simulated readings',
        'browser-simulation-process': 'Simulated production and response',
        'browser-simulation-case': 'Saved simulated case',
      } as Record<string, string>
    )[id] || title
  );
}

function invalidateVoice(epoch: { current: number }) {
  epoch.current++;
}

export function AssistantPanel() {
  const { state } = usePlant();
  if (!state?.workspace) return null;
  return <Panel key={`${state.workspace.user.id}:${state.workspace.id}`} />;
}

function Panel() {
  const { state, selected, assistantRequest, caseRequest, busy } = usePlant();
  const pathname = usePathname();
  const query = useSearchParams();
  const simulation = usePreviewDispatch();
  const [open, setOpen] = useState(false);
  const [intake, setIntake] = useState(false);
  const [createdCase, setCreatedCase] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const openState = useRef(false);
  const layoutScroll = useRef<number | null>(null);
  const expandControl = useRef<HTMLButtonElement>(null);
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const [historyOpen, setHistoryOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const plantScreen = pathname === '/plant' && query.get('view') !== 'observations';
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState('');
  const [caseDetail, setCaseDetail] = useState<Schema['CaseDetail'] | null>(null);
  const [caseError, setCaseError] = useState('');
  const caseController = useRef(caseRequest);
  caseController.current = caseRequest;
  const factoryCaseId = pathname === '/incidents' ? query.get('workcase') : null;
  useEffect(() => {
    let active = true;
    setCaseDetail(null);
    setCaseError('');
    if (!factoryCaseId) return;
    const load = async () => {
      try {
        const value = await caseController.current<Schema['CaseDetail']>(
          `/cases/${encodeURIComponent(factoryCaseId)}`,
        );
        if (active) {
          setCaseDetail(value);
          setCaseError('');
        }
      } catch (cause) {
        if (active)
          setCaseError(cause instanceof Error ? cause.message : 'Case records unavailable.');
      }
    };
    void load();
    const timer = open
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, 10000)
      : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [factoryCaseId, open]);
  const alive = useRef(true);
  const stopRecording = useRef<((discard?: boolean) => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const retry = useRef<{
    intent: string;
    key: string;
    body: Schema['AssistantQuestion'];
    newAttempt?: boolean;
  } | null>(null);
  const voiceEpoch = useRef(0);
  const screen = useRef(pathname);
  screen.current = pathname;
  const selection = assistantSelection(
    pathname,
    query,
    selected,
    { assets: state?.assets ?? [], incident: state?.incident ?? null },
    simulation,
    caseDetail?.case,
  );
  const { context, synthetic } = selection;
  const currentContext = useRef(selection.key);
  currentContext.current = selection.key;
  const contextLabel =
    caseDetail?.case.id === factoryCaseId
      ? caseDetail.case.title
      : state?.assets.find((asset) => asset.id === context.asset_id)?.name || 'All equipment';
  const contextVersion = JSON.stringify([
    state?.configuration_version,
    caseDetail?.case.revision,
    synthetic ? simulation.process?.stage : null,
    context.incident_id ? state?.incident?.calculation_version : null,
  ]);

  function changeLayout(next: boolean) {
    layoutScroll.current = conversation.current?.scrollTop ?? 0;
    setExpanded(next);
  }
  useLayoutEffect(() => {
    if (layoutScroll.current === null) return;
    const top = layoutScroll.current;
    const frame = requestAnimationFrame(() => {
      conversation.current?.scrollTo({ top });
      expandControl.current?.focus({ preventScroll: true });
      layoutScroll.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  useEffect(() => {
    conversation.current?.scrollTo({ top: conversation.current.scrollHeight });
  }, [turns.length, pending]);

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
  }, [selection.key]);

  function close(next: boolean) {
    openState.current = next;
    setOpen(next);
    if (!next) {
      setExpanded(false);
      voiceEpoch.current++;
      stopRecording.current?.(true);
      stopRecording.current = null;
      setRecording(false);
      stopPlayback();
    }
  }

  async function send() {
    if (!input.trim() || pending || recording || busy) return;
    if (selection.error || caseError) {
      setError(caseError || selection.error || 'Case unavailable.');
      return;
    }
    const question = input.trim();
    const base = {
      ...context,
      question,
      screen: pathname.split('/')[1] as Schema['AssistantQuestion']['screen'],
      history: turns
        .filter((t) => t.scope === selection.key)
        .slice(-6)
        .map((t) => ({ question: t.question, answer: t.response.answer.slice(0, 3000) })),
    };
    const simulationContext = captureSimulationContext(
      { assets: state?.assets ?? [], areas: state?.areas ?? [] },
      simulation,
      selection,
    );
    const intent = JSON.stringify({
      ...base,
      synthetic,
      selection: selection.key,
    });
    const body: Schema['AssistantQuestion'] =
      retry.current?.intent === intent
        ? retry.current.body
        : { ...base, ...(synthetic ? { simulation_context: simulationContext } : {}) };
    const key =
      retry.current?.intent === intent && !retry.current.newAttempt
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { intent, key, body };
    setPending('Thinking…');
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
      setTurns((previous) =>
        [
          ...previous,
          {
            question,
            response,
            scope: expected,
            capturedAt:
              response.captured_at ||
              body.simulation_context?.captured_at ||
              new Date().toISOString(),
            contextLabel,
            contextVersion: JSON.stringify([
              response.configuration_version,
              response.case_revision ?? caseDetail?.case.revision,
              body.simulation_context?.process?.phase ?? null,
              response.calculation_version,
            ]),
            assignmentId:
              body.simulation_context?.selected_assignment_id ||
              body.simulation_context?.selected_case_id ||
              undefined,
          },
        ].slice(-6),
      );
      setInput('');
      retry.current = null;
    } catch (cause) {
      if (
        retry.current &&
        cause instanceof Error &&
        (cause.message.includes('receipt expired or failed') ||
          (cause instanceof ApiError &&
            [502, 503, 504].includes(cause.status) &&
            cause.message.startsWith('AI ')))
      )
        retry.current.newAttempt = true;
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
            case_id: response.case_id,
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

  const suggestions =
    pathname === '/memory'
      ? ['What verified repairs exist for this equipment?', 'What was corrected after repair?']
      : pathname === '/incidents' || pathname === '/maintenance'
        ? [
            'What evidence supports this incident?',
            'What blocks approval?',
            'Explain the saved intervention costs.',
          ]
        : synthetic
          ? ["What's happening here?", 'Who is responding?', 'How is production affected?']
          : [
              'Which current readings are missing?',
              'Explain the selected equipment.',
              'How do measured output and rated capacity differ?',
            ];
  return (
    <Dialog.Root open={open} onOpenChange={close} modal={mobile || expanded}>
      <Dialog.Trigger
        ref={trigger}
        className={styles.trigger}
        data-plant={plantScreen}
        aria-label="Ask PlantSense"
        title="Ask PlantSense"
      >
        <MessageCircle size={19} />
        <span>Ask PlantSense</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.panel}
          data-plant={plantScreen}
          data-expanded={expanded && !mobile}
          onEscapeKeyDown={(event) => {
            if (expanded && !mobile) {
              event.preventDefault();
              changeLayout(false);
            }
          }}
          onInteractOutside={(event) => {
            if (!mobile && !expanded) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (layoutScroll.current === null) composer.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!openState.current) trigger.current?.focus();
          }}
        >
          <div className={styles.heading}>
            <span className={styles.mark}>
              <Workflow size={18} />
            </span>
            <div className={styles.title}>
              <Dialog.Title>Ask PlantSense</Dialog.Title>
              <small>
                {turns.at(-1)?.response.provider.toLowerCase().startsWith('scripted')
                  ? 'Read-only · Scripted provider'
                  : 'Read-only assistant'}
              </small>
            </div>
            {!mobile && (
              <button
                ref={expandControl}
                className={styles.historyTrigger}
                aria-label={expanded ? 'Collapse chat' : 'Expand chat'}
                aria-expanded={expanded}
                onClick={() => changeLayout(!expanded)}
              >
                {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            )}
            <button
              className={styles.historyTrigger}
              aria-label="Conversation history"
              aria-expanded={historyOpen}
              aria-controls="assistant-history"
              onClick={() => setHistoryOpen(!historyOpen)}
            >
              <History size={17} />
            </button>
            <Dialog.Close className="icon-button" aria-label="Close assistant">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.context}>
            {factoryCaseId ? `Case: ${caseDetail?.case.title || 'Loading selected case…'} · ` : ''}
            {state?.assets.find((a) => a.id === context.asset_id)?.name || state?.plant.name} ·{' '}
            {context.asset_id || 'All equipment'}{' '}
            {context.incident_id ? `· Incident ${context.incident_id.slice(0, 8)}` : ''}
          </Dialog.Description>
          <details className={styles.provenance}>
            <summary>{synthetic ? 'Screen data' : 'Plant records'}</summary>
            <p>
              {synthetic
                ? 'Readings and operator responses are generated in this browser, not verified sensor data. They cannot verify a physical repair or authorize work.'
                : 'Answers use saved plant records. Historical evidence does not establish current equipment condition.'}
            </p>
            <p>
              {turns.at(-1)?.scope === selection.key && turns.at(-1)?.capturedAt ? (
                <>
                  Last question captured:{' '}
                  <time dateTime={turns.at(-1)!.capturedAt}>
                    {new Date(turns.at(-1)!.capturedAt!).toLocaleString()}
                  </time>
                </>
              ) : (
                'Current context is captured when you send a question.'
              )}
            </p>
          </details>
          {historyOpen && (
            <div id="assistant-history" className={styles.history}>
              <strong>Questions in this tab</strong>
              {turns.length ? (
                turns.map((turn) => (
                  <button
                    key={turn.response.answer_reference}
                    onClick={() => {
                      setHistoryOpen(false);
                      requestAnimationFrame(() =>
                        document
                          .getElementById(`assistant-turn-${turn.response.answer_reference}`)
                          ?.scrollIntoView({ block: 'nearest' }),
                      );
                    }}
                  >
                    {turn.question}
                    <small>{turn.response.asset_id || 'All equipment'}</small>
                  </button>
                ))
              ) : (
                <p>No questions in this tab yet.</p>
              )}
            </div>
          )}
          <div ref={conversation} className={styles.conversation} aria-live="polite">
            {!turns.length && (
              <div className={styles.welcome}>
                <MessageCircle size={24} />
                <h3>What needs your attention?</h3>
                <p>Ask about equipment, production or the response in progress.</p>
                <div className={styles.suggestions}>
                  {suggestions.map((q) => (
                    <button key={q} onClick={() => setInput(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((turn) => (
              <article
                key={turn.response.answer_reference}
                id={`assistant-turn-${turn.response.answer_reference}`}
                className={styles.turn}
              >
                <div className={styles.answerMeta}>
                  <span>
                    Saved answer · {turn.contextLabel || turn.response.asset_id || 'Plant'}
                  </span>
                  {turn.capturedAt && (
                    <time dateTime={turn.capturedAt}>
                      {new Date(turn.capturedAt).toLocaleString()}
                    </time>
                  )}
                </div>
                {(turn.scope !== selection.key || turn.contextVersion !== contextVersion) && (
                  <p className={styles.contextChanged}>
                    Context changed since this answer.{' '}
                    <button
                      onClick={() => {
                        setInput(turn.question);
                        composer.current?.focus();
                      }}
                    >
                      Ask for an update
                    </button>
                  </p>
                )}
                <p className={styles.question}>{turn.question}</p>
                <div className={styles.answer}>
                  <ChatAnswer
                    text={turn.response.answer}
                    id={`answer-${turn.response.answer_reference}`}
                  />
                </div>
                <div className={styles.links}>
                  {turn.response.asset_id &&
                    state?.assets.some((a) => a.id === turn.response.asset_id) && (
                      <Link
                        href={`/monitoring/${encodeURIComponent(turn.response.asset_id)}`}
                        onClick={() => close(false)}
                      >
                        View machine
                      </Link>
                    )}
                  {turn.assignmentId ? (
                    <Link
                      href={`/operators?assignment=${encodeURIComponent(turn.assignmentId)}`}
                      onClick={() => close(false)}
                    >
                      View response
                    </Link>
                  ) : turn.response.incident_id ? (
                    <Link
                      href={`/incidents?incident=${encodeURIComponent(turn.response.incident_id)}`}
                      onClick={() => close(false)}
                    >
                      View incident
                    </Link>
                  ) : null}
                </div>
                {turn.response.costs.length > 0 && (
                  <details className={styles.costs}>
                    <summary>Saved cost comparison</summary>
                    <strong>INR · eight-hour horizon</strong>
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
                  </details>
                )}
                <div className={styles.messageActions}>
                  <details className={styles.sources}>
                    <summary>Sources ({turn.response.citations.length})</summary>
                    <div className={styles.sourceList}>
                      {turn.response.citations.map((source) => (
                        <details key={source.id}>
                          <summary>{sourceLabel(source.id, source.title)}</summary>
                          <small>{source.id}</small>
                          <pre>{source.text}</pre>
                        </details>
                      ))}
                      {turn.capturedAt && (
                        <p className={styles.note}>
                          Screen data captured:{' '}
                          <time dateTime={turn.capturedAt}>
                            {new Date(turn.capturedAt).toLocaleString()}
                          </time>
                          . Browser-generated values are not sensor-verified.
                        </p>
                      )}
                      <details>
                        <summary>Response details</summary>
                        <small>
                          {turn.response.provider} · Configuration{' '}
                          {turn.response.configuration_version}
                          {turn.response.calculation_version &&
                            ` · Calculation ${turn.response.calculation_version}`}
                        </small>
                        {turn.response.usage && (
                          <p className={styles.note}>
                            Estimated AI cost:{' '}
                            {(turn.response.usage.charged_micro_usd / 1000000).toFixed(6)} USD ·{' '}
                            {turn.response.usage.status}
                          </p>
                        )}
                        <p className={styles.note}>
                          Read-only help. Simulation is not operational evidence; approvals stay in
                          existing controls.
                        </p>
                      </details>
                    </div>
                  </details>
                  <button
                    className="secondary"
                    aria-label={playing === turn.response.answer_reference ? 'Stop' : 'Play answer'}
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
                    {playing === turn.response.answer_reference ? 'Stop' : 'Listen'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
              {retry.current && input.trim() === retry.current.body.question && (
                <button disabled={!!pending || recording || busy} onClick={() => void send()}>
                  {retry.current.newAttempt ? 'Try as new request' : 'Retry question'}
                </button>
              )}
            </p>
          )}
          {pending && <p role="status">{pending}</p>}
          {recording && <p role="status">Recording · stops after 15 seconds</p>}
          {intake && (
            <div className={styles.caseIntake}>
              <CaseIntake
                assetId={context.asset_id}
                description={input || turns.at(-1)?.question || ''}
                onCreated={(item) => {
                  setCreatedCase(item.id);
                  setIntake(false);
                }}
              />
            </div>
          )}
          {state?.workspace?.role !== 'viewer' && (
            <div className={styles.caseActions}>
              {!factoryCaseId && (
                <button onClick={() => setIntake(!intake)}>
                  {intake ? 'Close case form' : 'Start case'}
                </button>
              )}
              {factoryCaseId && (
                <span>
                  Following this case ·{' '}
                  {caseDetail?.case.phase.replaceAll('_', ' ') || 'Loading records'}
                </span>
              )}
              {createdCase && (
                <Link
                  href={`/incidents?workcase=${encodeURIComponent(createdCase)}`}
                  onNavigate={() => queueMicrotask(() => close(false))}
                >
                  Open recorded case
                </Link>
              )}
            </div>
          )}
          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="assistant-question" className={styles.composerLabel}>
              Message PlantSense
            </label>
            <textarea
              ref={composer}
              id="assistant-question"
              aria-label="Question or editable transcript"
              value={input}
              maxLength={1000}
              rows={2}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask PlantSense…"
            />
            <div className={styles.actions}>
              <button
                type="button"
                aria-label={recording ? 'Stop recording' : 'Record question'}
                className="secondary"
                onClick={() => void record()}
                disabled={!!pending || busy}
              >
                {recording ? <Square size={16} /> : <Mic size={16} />}
                {recording ? 'Stop recording' : 'Voice'}
              </button>
              <button
                className="primary"
                aria-label="Send question"
                disabled={!input.trim() || !!pending || recording || busy}
              >
                <ArrowUp size={16} />
                <span>Send</span>
              </button>
            </div>
            <small>Voice goes to Google. Review the transcript before sending.</small>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
