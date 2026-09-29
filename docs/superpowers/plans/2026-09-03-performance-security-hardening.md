# Performance, Search, and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make console navigation and log search scale with growing data while hardening work-log API authorization, retries, validation, concurrent writes, and secret handling.

**Architecture:** SQLite becomes the source of truth for filtered and paginated work-log queries instead of loading every row into React server components. Database initialization enables safe single-instance concurrency and creates query indexes plus an FTS5 search index. API ingestion authenticates before parsing bounded input, supports idempotency, and returns generic operational errors without secrets or stack traces.

**Tech Stack:** Next.js 15 App Router, React 19 server components, TypeScript, Vitest, better-sqlite3/SQLite FTS5, Zod, NextAuth.

**Spec:** `docs/superpowers/specs/2026-09-03-performance-security-design.md`

## Global Constraints

- Keep the existing Google login and API Key user interface behavior.
- SQLite guarantees apply to one application instance; multi-instance deployments require a shared Redis or database service for rate limiting and idempotency.
- Never return API Key plaintext, encrypted key blobs, raw SQL errors, or exception stacks in API responses or audit data.
- Run all current tests and `npm run build` after each completed task.

---

### Task 1: Database safety, indexes, and request-scoped user cache

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/session.ts`
- Modify: `src/lib/db.test.ts`
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Produces `createDatabase()` configured with `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, and `PRAGMA busy_timeout = 5000`.
- Produces a cached `currentConsoleUser(): Promise<LocalUser | undefined>` within one React server render.

- [ ] **Step 1: Write the failing database configuration test**

```ts
it('configures SQLite for foreign keys, WAL reads, and busy retries', () => {
  const db = createDatabase(':memory:');
  expect(db.diagnostics()).toMatchObject({ foreignKeys: 1, busyTimeout: 5000 });
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/db.test.ts`

Expected: FAIL because `diagnostics` does not exist.

- [ ] **Step 3: Implement the configuration and diagnostic method**

```ts
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

diagnostics() {
  return {
    foreignKeys: (sqlite.pragma('foreign_keys', { simple: true }) as number),
    busyTimeout: (sqlite.pragma('busy_timeout', { simple: true }) as number),
  };
}
```

Wrap `currentConsoleUser` in React `cache` so the page and `ConsolePageFrame` use the same per-render result.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npm test -- src/lib/db.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/session.ts src/lib/db.test.ts
git commit -m "perf: configure SQLite and cache console user"
```

### Task 2: Indexed, cursor-paginated log queries

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/worktrace-data.ts`
- Modify: `src/lib/worktrace-data.test.ts`
- Modify: `src/app/console/logs/page.tsx`
- Modify: `src/app/console/my-logs/page.tsx`
- Modify: `src/app/console/admin/logs/page.tsx`
- Modify: `src/components/log-list.tsx`
- Modify: `src/app/styles.css`

**Interfaces:**
- Produces `queryWorkLogs(options): { items: LocalWorkLog[]; nextCursor: string | null }`.
- `options` is `{ authorId?: string; query?: string; from?: string; to?: string; cursor?: string; limit?: number }`.
- The cursor is base64url JSON of `{ createdAt: string; id: string }` and defaults to a maximum limit of 50.

- [ ] **Step 1: Write failing pagination and combined-filter tests**

```ts
it('returns a stable next cursor without loading every matching log', () => {
  const first = db.queryWorkLogs({ authorId: user.id, limit: 2 });
  const second = db.queryWorkLogs({ authorId: user.id, limit: 2, cursor: first.nextCursor! });
  expect(first.items).toHaveLength(2);
  expect(second.items.map((item) => item.id)).not.toContain(first.items[0].id);
});

it('combines author, date, and full-text query filters', () => {
  const result = db.queryWorkLogs({ authorId: user.id, query: 'vendor', from: '2026-09-03T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' });
  expect(result.items.map((item) => item.title)).toEqual(['Release checklist']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/db.test.ts`

Expected: FAIL because `queryWorkLogs` does not exist.

- [ ] **Step 3: Add indexes, FTS5 maintenance, and database query method**

```sql
CREATE INDEX IF NOT EXISTS idx_work_logs_author_created ON work_logs(author_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_work_logs_created ON work_logs(created_at DESC, id DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS work_logs_fts USING fts5(title, completed, in_progress, blockers, next_plan, content='work_logs', content_rowid='rowid');
```

Add insert, update, and delete triggers that maintain `work_logs_fts`. Query with indexed predicates and `(created_at < ? OR (created_at = ? AND id < ?))`, requesting `limit + 1` rows to determine `nextCursor`. Escape FTS terms by treating every whitespace-separated word as a quoted phrase.

- [ ] **Step 4: Replace in-memory list filtering in console pages**

Use the new query method in all-logs, my-logs, and admin-logs pages. Preserve `member`, `range`, and `q` URL parameters, add `cursor`, and render a `Link` labelled `加载更多` only when `nextCursor` exists. Do not pass all logs into `LogList`.

- [ ] **Step 5: Run verification**

Run: `npm test -- src/lib/db.test.ts src/lib/worktrace-data.test.ts && npm run build`

Expected: PASS and production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/worktrace-data.ts src/lib/db.test.ts src/lib/worktrace-data.test.ts src/app/console src/components/log-list.tsx src/app/styles.css
git commit -m "perf: query and paginate logs in SQLite"
```

### Task 3: Harden API Key lookup and work-log ingestion

**Files:**
- Modify: `src/lib/api-keys.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/request-auth.ts`
- Modify: `src/app/api/v1/work-logs/route.ts`
- Modify: `src/lib/request-auth.test.ts`
- Create: `src/app/api/v1/work-logs/route.test.ts`

**Interfaces:**
- `authenticateApiKey(secret)` performs one candidate lookup by `lookup_prefix` and a timing-safe hash check.
- `createWorkLogIdempotent(authorId, input, idempotencyKey)` returns `{ log: LocalWorkLog; created: boolean }`.
- API POST accepts optional header `Idempotency-Key` with 1–128 printable characters.

- [ ] **Step 1: Write failing security and retry tests**

```ts
it('only authenticates a key after matching its lookup prefix', () => {
  expect(db.authenticateApiKey('wtk_unknown')).toBeUndefined();
});

it('returns the same log for a repeated idempotency key', () => {
  const first = db.createWorkLogIdempotent(user.id, input, 'upload-001');
  const retry = db.createWorkLogIdempotent(user.id, input, 'upload-001');
  expect(retry).toMatchObject({ created: false, log: { id: first.log.id } });
});
```

Route tests must assert: malformed JSON returns `400 INVALID_JSON`; a payload over the configured byte limit returns `413 PAYLOAD_TOO_LARGE`; a non-admin API key cannot request team logs; API errors do not contain the supplied bearer secret.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/request-auth.test.ts src/app/api/v1/work-logs/route.test.ts`

Expected: FAIL because prefix lookup, idempotency, and error contracts do not exist.

- [ ] **Step 3: Implement API Key prefix lookup and idempotency storage**

Add `lookup_prefix TEXT` and `idempotency_key TEXT` columns with migrations. Add unique indexes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_lookup_prefix ON api_keys(lookup_prefix);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_idempotency ON work_logs(author_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

Generate a lookup prefix with `secret.slice(0, 16)`. In a transaction, insert the work log with the idempotency key; on unique-key conflict, select and return the existing log. Keep API Key plaintext out of database queries, audit rows, and responses except the one-time creation response.

- [ ] **Step 4: Implement bounded route parsing, authorization, and safe errors**

Authenticate before body parsing. Reject content length above `64 * 1024`; parse `await request.text()` inside `try/catch`; validate title and every structured field with trimmed Zod strings capped at 10,000 characters. Let API keys read only `mine=true` by default; only `ADMIN` can request team logs. Return only `{ code, message }` for operational errors and never return `error.message` from SQLite or crypto operations.

- [ ] **Step 5: Run verification**

Run: `npm test -- src/lib/request-auth.test.ts src/app/api/v1/work-logs/route.test.ts src/lib/db.test.ts && npm run build`

Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-keys.ts src/lib/db.ts src/lib/request-auth.ts src/app/api/v1/work-logs/route.ts src/lib/request-auth.test.ts src/app/api/v1/work-logs/route.test.ts
git commit -m "security: harden API key log ingestion"
```

### Task 4: Production configuration and concurrency safeguards

**Files:**
- Modify: `src/lib/api-keys.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/admin.test.ts`
- Modify: `src/lib/api-keys.test.ts`
- Create: `.env.example`

**Interfaces:**
- `encryptionKey()` throws `KEY_ENCRYPTION_SECRET is required in production` outside development if the variable is absent.
- Admin role mutation and deletion run under one immediate SQLite transaction.

- [ ] **Step 1: Write failing production-secret and admin transaction tests**

```ts
it('rejects the development encryption fallback outside development', () => {
  expect(() => encryptionKeyForEnvironment({ NODE_ENV: 'production' })).toThrow('KEY_ENCRYPTION_SECRET is required in production');
});

it('does not permit removal of the final administrator', () => {
  expect(() => db.setUserRole(lastAdmin.id, 'MEMBER', otherAdmin.id)).toThrow('Cannot remove the last administrator');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/api-keys.test.ts src/lib/admin.test.ts`

Expected: FAIL because production fallback handling is not exposed and role mutation is not an immediate transaction.

- [ ] **Step 3: Implement environment validation and transaction wrapping**

Export a pure `encryptionKeyForEnvironment(env)` for the test and call it from encryption. Preserve the local fallback only when `NODE_ENV === 'development'`. Wrap administrator count plus mutation in `sqlite.transaction` preceded by `BEGIN IMMEDIATE` through a focused helper, and ensure all database handles close through `try/finally` in request routes.

- [ ] **Step 4: Add `.env.example`**

```dotenv
AUTH_SECRET=replace-with-a-long-random-value
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
KEY_ENCRYPTION_SECRET=replace-with-a-different-long-random-value
LOCAL_DATABASE_PATH=/var/lib/worktrace/worktrace.db
```

- [ ] **Step 5: Run final verification**

Run: `npm test && npm run build`

Expected: all tests pass and production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-keys.ts src/lib/db.ts src/lib/admin.test.ts src/lib/api-keys.test.ts .env.example
git commit -m "security: enforce production secrets and atomic admin changes"
```

## Self-review

- Spec coverage: Tasks 1–2 cover navigation data cost, SQLite configuration, indexing, full-text filtering, and pagination. Task 3 covers API authorization, bounded parsing, retries, safe errors, and API Key performance. Task 4 covers secret configuration and concurrent admin mutation safety.
- Placeholder scan: no TODO/TBD or unspecified validation behavior remains.
- Type consistency: `queryWorkLogs`, `createWorkLogIdempotent`, and their return types are introduced before their page and route consumers.
