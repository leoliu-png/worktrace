import type { TimeOffReason } from './time-off-types';

export class TimeOffError extends Error {
  constructor(public readonly reason: TimeOffReason) { super(reason); this.name = 'TimeOffError'; }
}

export function createTimeOffClient(token: string) {
  let origin: string;
  try {
    const url = new URL(process.env.TIME_OFF_BASE_URL ?? 'https://time-off.feedmob.com');
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    origin = url.origin;
  } catch { throw new TimeOffError('configuration'); }

  async function request(path: string, content?: string) {
    try {
      const response = await fetch(`${origin}${path}`, {
        method: content === undefined ? 'GET' : 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(content === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(content === undefined ? {} : { body: JSON.stringify({ content }) }),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new TimeOffError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'rejected');
      if (!response.headers.get('content-type')?.includes('application/json')) {
        if (content !== undefined) { await response.body?.cancel(); return {}; }
        throw new TimeOffError('invalid_response');
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > 1024 * 1024) throw new TimeOffError('invalid_response');
      if (!text && content !== undefined) return {};
      try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
      } catch { throw new TimeOffError('invalid_response'); }
    } catch (error) {
      if (error instanceof TimeOffError) throw error;
      throw new TimeOffError('unavailable');
    }
  }

  return {
    async identity() {
      const result = await request('/api/v1/me');
      const user = result.user as { id?: unknown; email?: unknown } | undefined;
      if (!user || typeof user.email !== 'string' || !['string', 'number'].includes(typeof user.id)) throw new TimeOffError('invalid_response');
      return { id: String(user.id), email: user.email.trim().toLowerCase() };
    },
    async upsertJournal(date: string, content: string, authorEmail: string) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !content.trim()) throw new TimeOffError('rejected');
      const result = await request(`/api/v1/journals/${date}`, content);
      type Journal = { id?: unknown; date?: unknown; content?: unknown; user?: { email?: unknown } };
      const verified = (value: unknown): value is Journal => {
        if (!value || typeof value !== 'object') return false;
        const journal = value as Journal;
        return journal.date === date && typeof journal.content === 'string'
          && journal.content.replace(/\r\n?/g, '\n').trimEnd() === content.replace(/\r\n?/g, '\n').trimEnd()
          && (journal.user?.email === undefined || String(journal.user.email).trim().toLowerCase() === authorEmail);
      };
      let journal: unknown = result.journal ?? result;
      // Some API versions only acknowledge PUT. Confirm the persisted body with
      // the documented read endpoint rather than assuming that 2xx means saved.
      if (!verified(journal)) {
        const saved = await request(`/api/v1/journals?start_date=${date}&end_date=${date}`);
        journal = Array.isArray(saved.journals) ? saved.journals.find((item) => verified(item)) : undefined;
      }
      if (!verified(journal)) throw new TimeOffError('invalid_response');
      return { journalId: typeof journal.id === 'string' || typeof journal.id === 'number' ? String(journal.id) : undefined };
    },
  };
}
