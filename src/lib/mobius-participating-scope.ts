import type { MobiusIssue } from './mobius-work-log';

export type MobiusParticipatingScope = {
  list: () => Promise<MobiusIssue[]>;
  contains: (identifier: string) => Promise<boolean>;
};

export class MobiusParticipatingScopeError extends Error {
  constructor(message: string) { super(message); this.name = 'MobiusParticipatingScopeError'; }
}

function asParticipatingIssue(value: unknown): MobiusIssue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.identifier !== 'string' || typeof row.title !== 'string') return undefined;
  if (row.archived === true) return undefined;
  const state = row.state && typeof row.state === 'object' ? row.state as Record<string, unknown> : undefined;
  return {
    identifier: row.identifier,
    title: row.title,
    description: typeof row.description === 'string' ? row.description : null,
    state: typeof row.state === 'string' ? row.state : typeof state?.name === 'string' ? state.name : null,
    stateType: typeof state?.type === 'string' ? state.type : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    agentStopRequested: Boolean(row.agentStopRequestedAt),
  };
}

// Participating is Mobius's subscription collection, not an inferred union of
// assignees, collaborators, creators, or comment authors. The current MCP issue
// list has no subscriber filter, so read the same collection as /my with the
// current token owner's ID; issue details and comments still use Mobius MCP.
export function createMobiusParticipatingScope(token: string, identity: { id?: unknown }, mcpUrl = process.env.MOBIUS_MCP_URL ?? 'https://mobius.feedmob.com/api/mcp'): MobiusParticipatingScope {
  if (typeof identity.id !== 'string' || !identity.id.trim()) throw new MobiusParticipatingScopeError('Mobius did not return the current user ID.');
  const endpoint = new URL('issues', mcpUrl);
  if (endpoint.protocol !== 'https:') throw new MobiusParticipatingScopeError('Mobius Participating requires HTTPS.');
  let validated: Promise<void> | undefined;
  let snapshot: Promise<MobiusIssue[]> | undefined;

  async function read(subscriberId: string) {
    const url = new URL(endpoint);
    url.searchParams.set('subscriberId', subscriberId);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok) throw new MobiusParticipatingScopeError(`Cannot read Mobius Participating (HTTP ${response.status}).`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new MobiusParticipatingScopeError('Mobius returned an invalid Participating collection.');
      return data;
    } catch (error) {
      if (error instanceof MobiusParticipatingScopeError) throw error;
      throw new MobiusParticipatingScopeError('Cannot verify the Mobius Participating collection.');
    }
  }

  function verifySubscriberFilter() {
    // Older APIs can silently ignore unknown query parameters. Verify that the
    // filter works before accepting any collection as this person's scope.
    validated ??= read('__worktrace_no_such_subscriber__').then((rows) => {
      if (rows.length) throw new MobiusParticipatingScopeError('Mobius does not support the subscriber scope filter.');
    });
    return validated;
  }

  async function load() {
    await verifySubscriberFilter();
    const rows = await read(identity.id as string);
    const issues: MobiusIssue[] = [];
    for (const row of rows) {
      const issue = asParticipatingIssue(row);
      if (issue) issues.push(issue);
      else if (!row || typeof row !== 'object' || (row as Record<string, unknown>).archived !== true) {
        throw new MobiusParticipatingScopeError('Mobius returned an invalid Participating issue.');
      }
    }
    return issues;
  }

  return {
    list: () => snapshot ??= load(),
    contains: async (identifier) => {
      // Re-read before each posting check, so unsubscribing removes permission
      // to sync even if the issue was in the initial matching snapshot.
      snapshot = load();
      return (await snapshot).some((issue) => issue.identifier.toUpperCase() === identifier.toUpperCase());
    },
  };
}
