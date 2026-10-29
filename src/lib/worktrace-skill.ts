export function workTraceSkillMarkdown(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, '');
  return `# WorkTrace Skill

Use WorkTrace to record, search, and review team work logs.

## Configuration

Configure the WorkTrace MCP server at \`${normalized}/mcp\`. Store the user's API key only in \`WORKTRACE_API_KEY\`; never place it in a chat message or a work-log field.

## Create a log

When the user provides raw work notes, summarize them into \`title\`, \`completed\`, \`inProgress\`, \`blockers\`, and \`nextPlan\`. \`title\` and a non-empty \`completed\` list are required. When the user explicitly says the log is for an earlier or specific day, include \`reportDate\` in \`YYYY-MM-DD\` format using the Asia/Shanghai calendar. Otherwise omit \`reportDate\` so WorkTrace uses today. Never submit future dates. When present, \`inProgress\`, \`blockers\`, and \`nextPlan\` must each be arrays of concise items, never a semicolon-separated paragraph. Do not invent optional fields. Show the draft, including its report date, and ask the user to confirm before calling \`create_work_log\`.

## Read logs

Use \`list_work_logs\` for filtered team summaries, \`get_work_log\` for details, and \`get_daily_submission_status\` to report submitted and missing members using Asia/Shanghai dates.

Use \`get_work_log_sync_status\` to read the latest Mobius and Time off results for the user's log by id or reportDate. Include posted Issue identifiers and actual comment bodies, and explain skipped or failed items without inventing results.

Use \`append_work_log\` to append a user's item to an existing log without replacing its other sections. Supply a unique idempotencyKey for the same request when retrying and include expectedUpdatedAt when working from an already-read version. The normal sync runs after the append.

Use \`submit_markdown_work_log\` for complete Markdown. If a log already exists for the date, read it first and provide its updatedAt as expectedUpdatedAt only after the replacement is authorized. This tool does not upload local images; preserve existing accessible image URLs.

## Feedback and automated improvement

Use \`create_feedback\` to submit the user's own suggestion or issue with category, title, and description. Do not invent details. Administrators can use \`list_feedback\` to review all feedback and \`get_rsi_status\` to inspect the local automated improvement service. These administrative tools are read-only; report an unavailable service honestly.
`;
}
