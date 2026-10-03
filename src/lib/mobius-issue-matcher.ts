import { matchingTerms, matchWorkLogEntry, type MobiusIssue, type MobiusIssueMatch, type WorkLogEntry } from './mobius-work-log';
import type { MobiusParticipatingScope } from './mobius-participating-scope';

type ToolCall = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

function asIssue(value: unknown): MobiusIssue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const issue = value as Partial<MobiusIssue>;
  return typeof issue.identifier === 'string' && typeof issue.title === 'string' ? issue as MobiusIssue : undefined;
}

// Matching reads only issues from the token owner's My issues -> Participating.
export function createMobiusIssueMatcher(call: ToolCall, scope: Pick<MobiusParticipatingScope, 'list'>) {
  const issues = new Map<string, Promise<MobiusIssue | undefined>>();
  let candidates: Promise<MobiusIssue[]> | undefined;

  function getIssue(identifier: string) {
    if (!issues.has(identifier)) issues.set(identifier, call('get_issue', { identifier }).then(asIssue));
    return issues.get(identifier)!;
  }

  async function hydrate(summaries: MobiusIssue[]) {
    const results: MobiusIssue[] = [];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, summaries.length) }, async () => {
      while (index < summaries.length) {
        const summary = summaries[index++];
        const issue = await getIssue(summary.identifier);
        if (issue && issue.identifier.toUpperCase() === summary.identifier.toUpperCase()) results.push(issue);
      }
    }));
    return results.sort((a, b) => a.identifier.localeCompare(b.identifier));
  }

  return async function findIssue(entry: WorkLogEntry): Promise<MobiusIssueMatch> {
    const ids = [...entry.text.matchAll(/\b([A-Z][A-Z0-9]{1,11}-\d+)\b/gi)].map((match) => match[1].toUpperCase());
    if (ids.length > 1) return { reason: 'multiple_ids' };
    if (!ids.length && matchingTerms(entry.text).length < 2) return { reason: 'no_match' };
    const participating = await scope.list();
    if (ids.length === 1) {
      const summary = participating.find((issue) => issue.identifier.toUpperCase() === ids[0]);
      if (!summary) return { reason: 'not_related' };
      const issue = await getIssue(summary.identifier);
      return matchWorkLogEntry(entry, issue ? [issue] : []);
    }
    // Keep Done candidates to reject a completed best match without redirecting
    // its progress report to a weaker active issue. No workspace-wide search.
    candidates ??= hydrate(participating);
    return matchWorkLogEntry(entry, await candidates);
  };
}
