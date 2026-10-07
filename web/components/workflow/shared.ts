import type { usePlant } from '../session-provider';
export type SessionActions = Pick<ReturnType<typeof usePlant>, 'act' | 'busy'>;
export const stateNames: Record<string, string> = {
  detected: 'Anomaly detected',
  investigating: 'Investigating',
  awaiting_approval: 'Review decision',
  approved: 'Intervention approved',
  repairing: 'Repair in progress',
  verifying: 'Verifying recovery',
  resolved: 'Repair verified',
  investigation_failed: 'Investigation incomplete',
  proposal_rejected: 'Proposal rejected',
};
export type Tab = 'Investigation' | 'Decision' | 'Work order' | 'Memory';
