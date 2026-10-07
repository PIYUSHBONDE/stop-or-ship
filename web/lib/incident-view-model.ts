import type { Evidence } from './types';

/** Frozen teammate contract. Values are presentation strings, never executable source content. */
export type EvidenceKind = 'measured' | 'synthetic' | 'mixed' | 'document' | 'verified' | 'unknown';
export type EvidenceValue = Readonly<{
  label: string;
  value: string;
  unit?: string;
  baseline?: string;
  deviation?: string;
  source?: string;
}>;
export type EvidenceView = Readonly<{
  id: string;
  title: string;
  section: string;
  version: string;
  provenance: string;
  kind: EvidenceKind;
  summary: string;
  excerpt: string;
  values: readonly EvidenceValue[];
}>;

export const evidenceKindNames: Record<EvidenceKind, string> = {
  measured: 'Measured replay',
  synthetic: 'Synthetic context',
  mixed: 'Mixed measured / synthetic',
  document: 'Document',
  verified: 'Verified demo repair',
  unknown: 'Provenance unavailable',
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function display(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}
function names(value: unknown): string {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(', ') : '';
}
function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
}

/** Read the persisted investigation snapshot; never replace it with live telemetry. */
export function toEvidenceView(evidence: Evidence): EvidenceView {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = object(JSON.parse(evidence.text));
  } catch {
    // Plain document excerpts are the normal case, not a parsing error shown to operators.
  }
  let kind: EvidenceKind = !evidence.provenance
    ? 'unknown'
    : evidence.id === 'decision-model' || evidence.id === 'plant-impact'
      ? 'synthetic'
      : 'document';
  let summary = evidence.text.trim().slice(0, 220) || 'This source has no excerpt.';
  const values: EvidenceValue[] = [];
  if (evidence.id === 'telemetry-current' && payload && Array.isArray(payload.signals)) {
    const baseline = object(payload.baseline);
    const deviations = object(payload.deviations);
    const provenances = new Set<string>();
    for (const candidate of payload.signals) {
      const signal = object(candidate);
      if (!signal || number(signal.value) === undefined || typeof signal.signal_id !== 'string')
        continue;
      const reference = number(baseline?.[signal.signal_id]);
      const deviation = number(deviations?.[signal.signal_id]);
      const provenance = text(signal.provenance);
      provenances.add(provenance);
      values.push({
        label: label(signal.signal_id),
        value: display(signal.value as number),
        unit: text(signal.unit, 'Unit unavailable'),
        baseline: reference === undefined ? undefined : display(reference),
        deviation:
          deviation === undefined
            ? undefined
            : `${deviation >= 0 ? '+' : ''}${display(deviation * 100)}%`,
        source: [
          provenance === 'measured_replay'
            ? 'Measured replay'
            : provenance === 'synthetic'
              ? 'Synthetic signal'
              : 'Provenance unavailable',
          text(signal.source_dataset_id),
          text(signal.source_record_id) ||
            (number(signal.source_cycle_id) === undefined ? '' : String(signal.source_cycle_id)),
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
    kind =
      provenances.size > 1
        ? 'mixed'
        : provenances.has('measured_replay')
          ? 'measured'
          : provenances.has('synthetic')
            ? 'synthetic'
            : 'unknown';
    summary = `${values.length} signal readings saved when this investigation collected evidence. Baselines and deviations belong to that same snapshot.`;
  } else if (payload && evidence.id === 'plant-impact') {
    kind = 'synthetic';
    values.push(
      { label: 'Source equipment', value: text(payload.source, 'Unavailable') },
      {
        label: 'Affected production lines',
        value: names(payload.affected_lines) || 'None recorded',
      },
      { label: 'Dependent equipment', value: names(payload.affected_assets) || 'None recorded' },
    );
    summary = 'Production impact follows the fictional plant’s configured equipment dependencies.';
  } else if (evidence.id.startsWith('case-')) {
    kind = 'verified';
    if (payload) {
      for (const key of ['observed_cause', 'fix', 'parts', 'outcome', 'verified_at']) {
        if (text(payload[key])) values.push({ label: label(key), value: text(payload[key]) });
      }
    }
    summary =
      'A repair verified through simulated telemetry recovery. The technician’s correction is retained.';
  }
  return {
    id: evidence.id,
    title: evidence.source.trim() || 'Untitled evidence',
    section: evidence.section.trim() || 'Section unavailable',
    version: evidence.version.trim() || 'Version unavailable',
    provenance: evidence.provenance.trim() || 'Provenance unavailable',
    kind,
    summary,
    excerpt: evidence.text,
    values,
  };
}
