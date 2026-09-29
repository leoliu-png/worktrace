import { z } from 'zod';
import type { LocalUser, WorkLogInput } from './db';
import { resolveReportDate, workTraceReportDate } from './report-date';

const text = z.string().trim().max(10_000);
export const workLogSectionInputSchema = z.union([text, z.array(text.min(1)).min(1).max(100)]);

export function normalizeWorkLogSection(value: z.input<typeof workLogSectionInputSchema> | undefined): string {
  const entries = (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((entry) => entry.split(/\r?\n|；/))
    .map((entry) => entry.trim().replace(/^([-*+]|\d+[.)])\s+/, ''))
    .filter(Boolean);
  return entries.map((entry) => `- ${entry}`).join('\n');
}

const optionalWorkLogSection = workLogSectionInputSchema.optional().transform(normalizeWorkLogSection);
function createAgentWorkLogSchema(now = new Date()) {
  return z.object({
    reportDate: z.string().trim().optional().transform((value, context) => {
      try { return resolveReportDate(value, now); }
      catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Report date is invalid.' }); return z.NEVER; }
    }),
    title: text.min(1).max(140),
    completed: z.array(text.min(1)).min(1).max(100),
    inProgress: optionalWorkLogSection,
    blockers: optionalWorkLogSection,
    nextPlan: optionalWorkLogSection,
  });
}
export const agentWorkLogSchema = createAgentWorkLogSchema();

export function validateAgentWorkLog(input: unknown, now = new Date()) {
  return createAgentWorkLogSchema(now).safeParse(input);
}

type DailyDatabase = {
  listUsers(): LocalUser[];
  queryWorkLogs(options: { reportDate?: string; limit?: number }): { items: Array<{ id: string; authorId: string }> };
};

export function shanghaiDate(now = new Date()) {
  return workTraceReportDate(now);
}

export function dailySubmissionStatus(database: DailyDatabase, date = shanghaiDate(), _now = new Date()) {
  const reportDate = resolveReportDate(date, _now);
  const logs = database.queryWorkLogs({ reportDate, limit: 50 }).items;
  const byMember = new Map<string, string[]>();
  for (const log of logs) byMember.set(log.authorId, [...(byMember.get(log.authorId) ?? []), log.id]);
  return { date: reportDate, timezone: 'Asia/Shanghai', members: database.listUsers().map((member) => {
    const logIds = byMember.get(member.id) ?? [];
    return { id: member.id, name: member.name, email: member.email, submitted: logIds.length > 0, count: logIds.length, logIds };
  }) };
}

export type AgentWorkLogInput = z.infer<typeof agentWorkLogSchema> & WorkLogInput;
