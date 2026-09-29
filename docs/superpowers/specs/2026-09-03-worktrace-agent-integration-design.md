# WorkTrace Agent Integration Design

## Goal

Provide deployable MCP and Skill integration so an AI Agent can summarize raw work notes, create structured work logs, query team logs, and report daily submission status.

## Decisions

- MCP uses HTTP transport and accepts `WORKTRACE_API_BASE_URL` plus `WORKTRACE_API_KEY` in client configuration.
- Skill targets Codex and generic Skill-capable agents. It performs summarization in the calling Agent, not on the WorkTrace server.
- A valid personal API key may read team logs through REST and MCP, and writes are attributed to the API-key owner.
- Daily calculations use `Asia/Shanghai`.
- Required log fields are `title` and non-empty `completed`; `inProgress`, `blockers`, and `nextPlan` are optional and must not be invented by the Agent.

## MCP tools

- `prepare_work_log`: accepts raw notes and instructs the client Agent to return a structured draft for user confirmation.
- `create_work_log`: validates and stores a structured log, with optional idempotency key.
- `list_work_logs`: returns paged team log summaries filtered by text, member, and date range.
- `get_work_log`: returns a single full log by id.
- `get_daily_submission_status`: returns every member's submitted/not-submitted state, count, and log ids for a supplied date or the current Shanghai date.

## Public artifacts and UI

- Serve a stable `SKILL.md` resource and a streamable HTTP MCP endpoint from the deployed site.
- Replace the home connection cards with expandable Skill and MCP integration panels. Each panel contains a copy button and deployment-safe placeholders rather than localhost values.

## Safety and operations

- Keep API keys in environment variables or secure client settings, never rendered as values in the homepage.
- Enforce request-size and schema limits, cursor paging, per-request timeout, idempotency, generic service errors, and audit events for agent actions.
- Deployment requires HTTPS, a public base URL, Google OAuth redirect configuration, and the existing key-encryption environment configuration.
