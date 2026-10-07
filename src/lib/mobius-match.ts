import type { WorkLogEntry } from './mobius-work-log';

export type JevFailureReason = 'jev_not_configured' | 'jev_invalid_configuration' | 'jev_unavailable' | 'jev_invalid_response' | 'jev_context_limit';

export type MobiusMatchDecision = {
  entry: WorkLogEntry;
  method: 'jev' | 'rules' | 'identifier';
  model?: string;
  requestId?: string;
  selected?: string;
  probability?: number;
  confidence?: number;
  margin?: number;
  candidateCount?: number;
  thresholds?: { probability: number; confidence: number; margin: number };
  candidates?: Array<{ identifier: string; title?: string; probability: number }>;
};
