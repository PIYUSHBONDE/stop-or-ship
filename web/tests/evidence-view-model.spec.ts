import { test, expect } from '@playwright/test';
import { toEvidenceView } from '../lib/incident-view-model';

const source = {
  id: 'telemetry-current',
  source: 'Saved telemetry',
  section: 'Snapshot',
  version: '1.0',
  provenance: 'measured_replay',
  text: '',
};

test('evidence normalization keeps saved signal units, provenance and mixed sources', () => {
  const original = JSON.stringify({
    signals: [
      {
        signal_id: 'pressure',
        value: 125,
        unit: 'bar',
        provenance: 'measured_replay',
        source_dataset_id: 'uci-hydraulics',
        source_record_id: '42',
      },
      { signal_id: 'flow', value: 3.5, unit: 'L/min', provenance: 'synthetic' },
    ],
    baseline: { pressure: 150 },
    deviations: { pressure: -1 / 6 },
  });
  const view = toEvidenceView({ ...source, text: original });
  expect(view.kind).toBe('mixed');
  expect(view.values[0]).toMatchObject({ value: '125', unit: 'bar', baseline: '150' });
  expect(view.values[0].source).toContain('uci-hydraulics · 42');
  expect(view.values[1].source).toBe('Synthetic signal');
  expect(view.excerpt).toBe(original);
});

test('untrusted malformed values cannot become valid-looking measured readings', () => {
  const view = toEvidenceView({
    ...source,
    text: '{"signals":[null,{"signal_id":"pressure","value":1e309},"invalid"]}',
  });
  expect(view.values).toEqual([]);
  expect(view.kind).toBe('unknown');
  const literal = '<script>source text is not executable</script>';
  expect(toEvidenceView({ ...source, text: literal }).excerpt).toBe(literal);
});

test('a retrieved document cannot classify its own JSON as measured telemetry', () => {
  const original = JSON.stringify({
    signals: [{ signal_id: 'pressure', value: 125, unit: 'bar', provenance: 'measured_replay' }],
  });
  const view = toEvidenceView({
    ...source,
    id: 'document-example',
    provenance: 'Synthetic demo document',
    text: original,
  });
  expect(view.kind).toBe('document');
  expect(view.values).toEqual([]);
  expect(view.excerpt).toBe(original);
});
