import type { WorkLogEntry } from './mobius-work-log';

export type MobiusSyncSource = 'web' | 'mcp' | 'api';
export type MobiusSyncReason = 'not_configured' | 'author_not_enabled' | 'different_author' | 'past_report_date' | 'empty' | 'entry_limit' | 'multiple_ids' | 'no_match' | 'ambiguous' | 'done' | 'not_related' | 'stopped' | 'updated_today' | 'duplicate' | 'matching_failed' | 'comment_failed' | 'connection_failed' | 'token_account_mismatch' | 'no_comment_permission' | 'persistence_failed' | 'participating_unavailable';
export type MobiusSyncItem = {
  status: 'posted' | 'skipped' | 'unmatched' | 'error';
  entries: WorkLogEntry[];
  identifier?: string;
  title?: string;
  issueState?: string | null;
  reason?: MobiusSyncReason;
  commentBody?: string;
};
export type MobiusSyncResult = {
  status: 'disabled' | 'skipped' | 'posted' | 'partial' | 'error';
  posted: number;
  alreadyUpdated: number;
  unmatched: number;
  failed: number;
  runId?: string;
  reason?: MobiusSyncReason;
  postedComments: Array<{ identifier: string; body: string }>;
  items: MobiusSyncItem[];
};
export type MobiusSyncRun = {
  id: string;
  workLogId: string;
  logTitle: string;
  reportDate: string;
  source: MobiusSyncSource;
  status: MobiusSyncResult['status'] | 'matching';
  createdAt: string;
  finishedAt: string | null;
  result: MobiusSyncResult | null;
};
