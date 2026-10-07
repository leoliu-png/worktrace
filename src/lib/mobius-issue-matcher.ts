import { isPlannedWorkEntry, matchingTerms, matchWorkLogEntry, type MobiusIssue, type MobiusIssueMatch, type WorkLogEntry } from './mobius-work-log';
import type { MobiusParticipatingScope } from './mobius-participating-scope';
import { JevMatchingError, jevMaxCandidateIssues, matchEntriesWithJev } from './jev-issue-matcher';

type ToolCall = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

function asIssue(value: unknown): MobiusIssue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const issue = value as Partial<MobiusIssue>;
  return typeof issue.identifier === 'string' && typeof issue.title === 'string' ? issue as MobiusIssue : undefined;
}

// Matching reads only issues from the token owner's My issues -> Participating.
export function createMobiusIssueMatcher(call: ToolCall, scope: Pick<MobiusParticipatingScope, 'list'>) {
  const issues = new Map<string, Promise<MobiusIssue | undefined>>();
  const prepared = new Map<string, { match?: MobiusIssueMatch; error?: unknown }>();
  const mode = process.env.MOBIUS_MATCHER?.trim() || 'rules';
  let candidates: Promise<MobiusIssue[]> | undefined;

  function identifiers(entry: WorkLogEntry) {
    return [...new Set([...entry.text.matchAll(/\b([A-Z][A-Z0-9]{1,11}-\d+)\b/gi)].map((match) => match[1].toUpperCase()))];
  }

  function getIssue(identifier: string) {
    if (!issues.has(identifier)) issues.set(identifier, call('get_issue', { identifier }).then(asIssue));
    return issues.get(identifier)!;
  }

  async function hydrate(summaries: MobiusIssue[]) {
    const results: MobiusIssue[] = [];
    let index = 0;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(4, summaries.length) }, async () => {
      while (index < summaries.length) {
        const summary = summaries[index++];
        try {
          const issue = await getIssue(summary.identifier);
          if (!issue || issue.identifier.toUpperCase() !== summary.identifier.toUpperCase()) throw new Error('A Participating issue could not be loaded.');
          // Preserve state type from the collection when MCP only returns a name.
          results.push({ ...summary, ...issue, stateType: issue.stateType ?? summary.stateType });
        } catch (error) {
          index = summaries.length;
          throw error;
        }
      }
    }));
    const failure = workers.find((worker) => worker.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return results.sort((a, b) => a.identifier.localeCompare(b.identifier));
  }

  async function prepare(entries: WorkLogEntry[]) {
    if (mode === 'rules') return;
    const semantic = [...new Map(entries.filter((entry) => !isPlannedWorkEntry(entry) && !identifiers(entry).length)
      .map((entry) => [JSON.stringify(entry), entry])).values()];
    if (!semantic.length) return;
    try {
      if (mode !== 'jev') throw new JevMatchingError('jev_invalid_configuration');
      if (!process.env.OPENROUTER_API_KEY?.trim()) throw new JevMatchingError('jev_not_configured');
      candidates ??= scope.list().then((summaries) => {
        if (summaries.length > jevMaxCandidateIssues) throw new JevMatchingError('jev_context_limit');
        return hydrate(summaries);
      });
      const matches = await matchEntriesWithJev(semantic, await candidates);
      semantic.forEach((entry, index) => prepared.set(JSON.stringify(entry), { match: matches[index] }));
    } catch (error) {
      semantic.forEach((entry) => prepared.set(JSON.stringify(entry), error instanceof JevMatchingError
        ? { match: { reason: error.reason, decision: { entry, method: 'jev' } } } : { error }));
    }
  }

  async function findIssue(entry: WorkLogEntry): Promise<MobiusIssueMatch> {
    if (isPlannedWorkEntry(entry)) return { reason: 'planned_work' };
    const ids = identifiers(entry);
    const decision = { entry, method: 'identifier' as const, selected: ids[0] };
    if (ids.length > 1) return { reason: 'multiple_ids', decision };
    if (!ids.length && mode !== 'rules') {
      if (!prepared.has(JSON.stringify(entry))) await prepare([entry]);
      const result = prepared.get(JSON.stringify(entry))!;
      if (result.error) throw result.error;
      return result.match!;
    }
    if (!ids.length && matchingTerms(entry.text).length < 2) return { reason: 'no_match', decision: { entry, method: 'rules' } };
    const participating = await scope.list();
    if (ids.length === 1) {
      const summary = participating.find((issue) => issue.identifier.toUpperCase() === ids[0]);
      if (!summary) return { reason: 'not_related', decision };
      const issue = await getIssue(summary.identifier);
      return { ...matchWorkLogEntry(entry, issue ? [{ ...summary, ...issue, stateType: issue.stateType ?? summary.stateType }] : []), decision };
    }
    // Keep Done candidates to reject a completed best match without redirecting
    // its progress report to a weaker active issue. No workspace-wide search.
    candidates ??= hydrate(participating);
    return { ...matchWorkLogEntry(entry, await candidates), decision: { entry, method: 'rules' } };
  }
  return Object.assign(findIssue, { prepare });
}
