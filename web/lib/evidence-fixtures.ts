import type { EvidenceView } from './incident-view-model';

/** All values are invented UI fixtures, including examples of the measured-source category. */
export const evidenceFixtures: readonly EvidenceView[] = [
  {
    id: 'fixture-telemetry',
    title: 'P-107 telemetry snapshot',
    section: 'Cycle summary and healthy baseline',
    version: 'Fixture 1.0',
    provenance:
      'Synthetic UI fixture demonstrating measured-replay presentation; no real measurements.',
    kind: 'measured',
    summary:
      'Pressure and flow differ from a reference envelope. These invented values demonstrate a saved evidence snapshot.',
    excerpt:
      'Synthetic fixture. Pressure: 125 bar; healthy reference: 150 bar. Flow: 3.5 L/min; healthy reference: 6 L/min.',
    values: [
      {
        label: 'Pressure',
        value: '125',
        unit: 'bar',
        baseline: '150',
        deviation: '-16.67%',
        source: 'Illustrative cycle 42',
      },
      {
        label: 'Flow',
        value: '3.5',
        unit: 'L/min',
        baseline: '6',
        deviation: '-41.67%',
        source: 'Illustrative cycle 42',
      },
    ],
  },
  {
    id: 'fixture-economics',
    title: 'Configured production assumptions',
    section: 'Eight-hour comparison',
    version: 'Fixture 1.0',
    provenance: 'Synthetic UI fixture; amounts are fictional configured inputs.',
    kind: 'synthetic',
    summary:
      'A contribution margin and repair duration support a comparison over the same horizon.',
    excerpt: 'The configured values are assumptions, not measured production economics.',
    values: [
      { label: 'Contribution margin', value: '₹250', unit: '/ part' },
      { label: 'Repair duration', value: '60', unit: 'min' },
    ],
  },
  {
    id: 'fixture-document',
    title: 'Hydraulic inspection procedure',
    section: '4.2 · Independent confirmation',
    version: 'Demo SOP 1.0',
    provenance: 'Invented demonstration procedure; not a manufacturer instruction.',
    kind: 'document',
    summary: 'Confirm pressure with an independent instrument before assigning a mechanical cause.',
    excerpt:
      'Inspect the reported pressure with an independent instrument. Record the operating load, temperature and flow. A single inconsistent sensor does not establish component failure.\n\nThis text is a synthetic UI fixture.',
    values: [],
  },
  {
    id: 'fixture-repair',
    title: 'Verified valve bypass repair',
    section: 'Technician correction and recovery',
    version: 'Fixture 1.0',
    provenance: 'Synthetic UI fixture representing a repair verified in a simulated plant.',
    kind: 'verified',
    summary:
      'The technician corrected the original pump hypothesis; three simulated healthy windows established recovery.',
    excerpt:
      'Observed cause: valve bypass. Replaced a bypass seal. Recovery was verified in simulation; this fixture is not a real repair record.',
    values: [
      { label: 'Observed cause', value: 'Valve bypass' },
      { label: 'Repair', value: 'Replaced bypass seal' },
      { label: 'Verification', value: '3 consecutive healthy windows' },
    ],
  },
  {
    id: 'fixture-mixed',
    title: 'Sensor disagreement',
    section: 'Measured and injected signal example',
    version: 'Fixture 1.0',
    provenance: 'All fixture values are synthetic; this example illustrates a mixed-source label.',
    kind: 'mixed',
    summary:
      'The pressure value is an injected example while other signals demonstrate the measured-replay category.',
    excerpt:
      'Treat inconsistent pressure as unresolved evidence. Independently confirm the sensor before identifying a cause.',
    values: [
      { label: 'Pressure', value: '270', unit: 'bar', source: 'Synthetic override (fixture)' },
    ],
  },
  {
    id: 'fixture-missing',
    title: 'Untitled evidence',
    section: 'Section unavailable',
    version: 'Version unavailable',
    provenance: 'Provenance unavailable',
    kind: 'unknown',
    summary: 'This source has no excerpt.',
    excerpt: '',
    values: [],
  },
  {
    id: 'fixture-long',
    title: 'Extended inspection notes',
    section: 'Long content and safe rendering',
    version: 'Fixture 1.0',
    provenance: 'Synthetic text fixture.',
    kind: 'document',
    summary:
      'Long excerpts must wrap, scroll, and preserve keyboard access. Source text is always rendered as text.',
    excerpt: `${'Long inspection notes describe operating context and independent confirmation. '.repeat(70)}\n\nLiteral source content: <script>this is text, not executable code</script>`,
    values: [],
  },
];
