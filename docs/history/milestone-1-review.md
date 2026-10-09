# Milestone 1: local review guide

## Review the experience

Start both local services using the root README. Open Plant, choose **Pump degradation**, start the scenario and pause replay. Advance six windows, then open **Incidents**. The selected case is retained in the URL.

1. Read the hypotheses and missing information. Open a Telemetry citation and check the saved values, units, baseline, source IDs and provenance.
2. Inspect the production dependency branch. The shared-cooler scenario shows a separate branch for each affected line and a shared finished-goods destination.
3. Use **Compare interventions** to reach the four-option table. Inspect the same eight-hour horizon, itemized INR costs and configured assumptions.
4. Change the risk multiplier. Approval is disabled until **Recalculate** or **Discard changes**. Recalculation marks the existing specialist explanations stale. Refresh preserves the saved risk and case selection.
5. Approve a feasible intervention. **Open authorized work order** appears only for the current approved calculation and links to the matching incident in Maintenance.
6. Start repair, record the observed cause and repair, then complete it. Three healthy replay windows are required before the outcome enters verified memory. Try **fault persists** separately to see an unsuccessful verification.
7. Replay a similar incident. Reopen the earlier case through the case list: it remains read-only, and a Maintenance deep link for that historical case cannot open the active case's order.

The investigator is scripted in the default local setup. Dataset availability is labelled in Plant; the evidence workshop uses only invented fixtures. These local checks do not establish live Gemini grounding or cloud deployment readiness.

## Acceptance coverage

| Requirement | Evidence |
| --- | --- |
| A later temperature breach retires prior approval | Backend decision-rule tests capture the first signal, retire the original order and preserve its approval snapshot |
| A stale conflict still persists the constraint | Approval and repair-start transaction tests, plus an HTTP approval test |
| A latch requires verified recovery | Hot windows cannot count toward recovery, even when the anomaly flag is false; three cool healthy windows resolve the case |
| Retry cannot reactivate superseded work | Original idempotency receipts remain stable while the retired order stays inactive |
| Dirty edits cannot authorize work | Browser keyboard risk-edit, discard, recalculation and refresh checks |
| Infeasible, stale, historical and cross-session requests are blocked | Workflow/API guards and concurrent-change browser check |
| Duplicate approval creates one order | Existing concurrent atomic-approval backend test |
| Displayed totals match backend paise | Browser assertions against all four option totals; deterministic economics tests |
| Evidence remains tied to saved sources | Central normalization tests and citation dialog checks |
| Shared cooling affects both lines | Browser assertions on distinct canonical dependency branches |
| Keyboard/dialog/mobile behavior | Offline component checks, focus-return checks and narrow-screen incident check |
| Failure and stale explanations remain clear | Incomplete-investigation browser fixture and stale-position recalculation check |
| Existing repair and memory flow stays intact | Five consecutive dedicated incident workflows and retained plant/workflow regression tests |

The temperature tests insert synthetic hot windows into isolated test sessions. They do not claim that the measured dataset documents a later temperature breach or a real repair. The configured 85 °C limit is a demo assumption.

Exact automated results and outstanding release limits are recorded in `docs/status.md`.
