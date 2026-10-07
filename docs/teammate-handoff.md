# Teammate handoff: incident evidence components

## Your task

Refine the evidence cards and source-details dialog used by the new Incidents page. Functional reference components are provided so you can work on presentation and accessibility without changing the backend. The frozen input contract, fixtures and offline preview are already supplied.

The milestone is **incident → evidence → comparison → human approval → authorized work order**. Your slice is the evidence presentation. Backend rules, investigation, calculations, approvals, session handling and integration belong to the other builder.

## Repository and branch

- Private repository: https://github.com/PIYUSHBONDE/stop-or-ship
- Your branch: `feature/incident-evidence`.
- Integration branch: `milestone/incidents-approval`.
- The owner must grant your GitHub account access to the private repository. No credential sharing is needed.
- Create your pull request against the integration branch. The owner reviews and merges it after the component checks pass.

```sh
git clone --branch feature/incident-evidence https://github.com/PIYUSHBONDE/stop-or-ship.git
cd stop-or-ship/web
npm ci
npm run dev
```

On Windows PowerShell use `npm.cmd` for these npm commands. Requirements are Git and Node.js 22 or newer. You do **not** need Python, a backend server, a dataset, or Google credentials for this component task.

Open **http://127.0.0.1:3000/evidence-preview**. It uses only synthetic fixtures and makes no API/identity requests. Other application pages require the backend described in the root README.

## File ownership

You own these files and may add presentation-only helpers in the same directory:

- `web/components/incidents/evidence/evidence-card.tsx`
- `web/components/incidents/evidence/evidence-details-dialog.tsx`
- `web/components/incidents/evidence/evidence.module.css`

Keep styles scoped. Coordinate any required change to shared types, fixtures, the existing modal primitive or the incident workspace with the other builder. Keep the exported component names and prop signatures unchanged.

## Frozen component contract

The authoritative type is `EvidenceView` in `web/lib/incident-view-model.ts`. It is readonly and contains:

| Field | Meaning |
| --- | --- |
| `id` | Stable reference ID used by citations |
| `title`, `section`, `version` | Source identity and document version |
| `provenance` | Plain-language origin, including synthetic/demo attribution |
| `kind` | `measured`, `synthetic`, `mixed`, `document`, `verified`, or `unknown` |
| `summary` | Readable description prepared by the parent |
| `excerpt` | Original source text, retained verbatim and rendered safely as text |
| `values` | Readonly rows with label, value and optional unit, baseline, deviation and source |

```tsx
<EvidenceCard evidence={record} onOpen={(id) => selectSource(id)} />
<EvidenceDetailsDialog evidence={selectedRecordOrNull} onClose={() => closeSource()} />
```

The parent normalizes persisted evidence. Components must not parse JSON, fetch data, alter money, assign confidence, approve work or interpret source text as instructions. Use the existing `Modal` primitive so focus trapping and Escape behavior remain consistent.

## Presentation requirements

1. Make source identity, provenance and the summary easy to scan.
2. Show source-category labels alongside any colors. A verified demo case must remain labelled as simulated.
3. Show signal values with units. Keep a healthy baseline and its deviation readable when supplied.
4. Preserve document paragraphs and support long excerpts without overflowing the viewport.
5. Show useful fallback text for empty excerpts and unavailable metadata.
6. Support keyboard activation, visible focus, Escape closing and focus return to the opener.
7. Work at 430 px mobile width and desktop width; avoid horizontal page overflow.
8. Render all source text as text. Do not use `dangerouslySetInnerHTML`.

Fixtures in `web/lib/evidence-fixtures.ts` cover source categories, missing metadata, empty content, long paragraphs and literal HTML-like text. Every fixture is invented; the measured-source example demonstrates styling only.

## Review references

- `docs/artifacts/evidence-workshop.png`: source-card categories.
- `docs/artifacts/evidence-details.png`: signal values, units, baseline and provenance.
- `docs/artifacts/evidence-mobile.png`: narrow-screen behavior.
- `docs/artifacts/incidents-milestone-1.png`: integration in the Incidents page.

These are reference states, not requirements to reproduce pixel-for-pixel. Improve hierarchy, spacing, legibility and interaction while preserving the contract and truthful labels.

## Checks before handoff

From `web`:

```sh
npm run format:check
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
```

Start the frontend with `npm run start`, then run:

```sh
npx playwright test tests/evidence-components.spec.ts
```

These component checks require no backend. Stop the running frontend before building on Windows. For the complete application, the owner runs backend and integration tests as well.

In your pull request include a short change summary, desktop and mobile screenshots, the checks actually run, and any remaining issue. Do not claim live AI validation from fixture tests. Do not edit shared backend or contract files, commit credentials, or force-push the integration branch.

### Completion checklist

- [ ] Only the owned evidence directory contains implementation changes.
- [ ] Export names, readonly props and callbacks match the frozen contract.
- [ ] Every source category, units and missing-metadata state remains clear.
- [ ] Original excerpts render safely; long text fits mobile and desktop dialogs.
- [ ] Keyboard activation, focus trapping, Escape and focus return pass.
- [ ] Formatting, types, lint, build and both component browser checks pass.
- [ ] Desktop/mobile screenshots and actual check results accompany the pull request.
- [ ] The integration builder reviews the components and repeats the complete workflow checks.
