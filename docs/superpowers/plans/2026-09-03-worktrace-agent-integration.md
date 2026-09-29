# WorkTrace Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deployable MCP and Skill integrations plus an expandable homepage integration UI.

**Architecture:** A shared agent service owns schema validation, API-key authentication, team querying and Shanghai daily status. The REST route and MCP HTTP route use that service; the Skill only instructs a client Agent to prepare a user-confirmed draft and invoke the MCP tools.

**Tech Stack:** Next.js route handlers, TypeScript, Zod, better-sqlite3, Vitest, Model Context Protocol TypeScript SDK.

**Spec:** `docs/superpowers/specs/2026-09-03-worktrace-agent-integration-design.md`

## Global Constraints

- Use `Asia/Shanghai` for daily status.
- `title` and at least one `completed` item are required for writes.
- Team reads are allowed for each active personal API key through REST and MCP.
- Do not send raw notes to a server-side LLM.

---

### Task 1: Shared agent log service

**Files:**
- Create: `src/lib/agent-work-logs.ts`, `src/lib/agent-work-logs.test.ts`
- Modify: `src/lib/db.ts`, `src/app/api/v1/work-logs/route.ts`

- [ ] Write failing tests for structured write validation, paged team reads, and Shanghai daily status.
- [ ] Add the shared service and database query methods.
- [ ] Move REST route read/write authorization onto the shared service while preserving response codes.
- [ ] Run targeted tests.

### Task 2: MCP HTTP server

**Files:**
- Create: `src/app/mcp/route.ts`, `src/lib/worktrace-mcp.ts`, `src/lib/worktrace-mcp.test.ts`
- Modify: `package.json`, lockfile

- [ ] Write failing tool-contract tests for `prepare_work_log`, `create_work_log`, `list_work_logs`, `get_work_log`, and `get_daily_submission_status`.
- [ ] Add the MCP SDK and streamable HTTP endpoint.
- [ ] Bind API-key authentication and shared service operations to tools.
- [ ] Run MCP tests.

### Task 3: Skill artifact and home integrations

**Files:**
- Create: `src/app/skill/worktrace/route.ts`, `src/lib/worktrace-skill.ts`, `src/lib/worktrace-skill.test.ts`
- Modify: `src/app/page.tsx`, `src/lib/locale.ts`, `src/app/styles.css`

- [ ] Write failing tests asserting Skill instructions and homepage integration copy.
- [ ] Serve the generated Skill markdown.
- [ ] Implement accessible expandable connection panels and copy feedback.
- [ ] Run UI/source tests.

### Task 4: Regression verification

**Files:**
- Test: all `src/**/*.test.ts`

- [ ] Run full test suite.
- [ ] Run production build.
- [ ] Verify homepage uses deployable placeholders and never embeds an API-key value.
