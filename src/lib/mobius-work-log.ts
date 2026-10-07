import type { LocalWorkLog } from './db';
import { workTraceReportDate } from './report-date';
import type { JevFailureReason, MobiusMatchDecision } from './mobius-match';
import { isPlannedWorkItem, workLogSectionHeading } from './work-log-sections';

export type MobiusIssue = {
  identifier: string;
  title: string;
  description?: string | null;
  state?: string | null;
  stateType?: string | null;
  assignee?: string | { name?: string | null; email?: string | null } | null;
  assigneeEmail?: string | null;
  collaborators?: Array<{ name?: string | null; email?: string | null }>;
  updatedAt?: string | null;
  agentStopRequested?: boolean;
  comments?: Array<{ at?: string; body?: string }>;
  activity?: Array<{ at?: string }>;
};

export type WorkLogEntry = { section: string; text: string };

const englishStopWords = new Set([
  'about', 'after', 'again', 'already', 'also', 'and', 'auto', 'automated', 'automation',
  'agent', 'before', 'completed', 'daily', 'data', 'done', 'from', 'issue', 'issues', 'log', 'logs',
  'manual', 'more', 'project', 'report', 'spend', 'system', 'task', 'test', 'testing',
  'that', 'the', 'this', 'today', 'update', 'updated', 'using', 'with', 'work',
]);
const chineseStopWords = new Set([
  '已经', '今日', '今天', '任务', '使用', '可以', '功能', '完成', '工作', '手动', '提交',
  '数据', '明日', '更新', '正在', '目前', '相关', '系统', '自动', '计划', '跟踪',
  '进行', '重新', '问题', '验证', '录入', '部分', '优化',
  '一个', '做了', '内容', '匹配', '添加', '继续', '情况', '统计', '专用', '主题',
  '对比', '效果', '更好', '生动', '形象',
]);

function cleanEntry(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 600);
}

function sectionEntries(value: string, defaultSection: string, plansOnly = false) {
  const entries: WorkLogEntry[] = [];
  let section = defaultSection;
  let planDepth: number | undefined = plansOnly ? 0 : undefined;
  let fence: string | undefined;
  const labels = { completed: '完成事项', inProgress: '进行中', blockers: '阻塞 / 风险', nextPlan: '明日计划' };
  for (const line of value.split(/\r?\n/)) {
    const codeFence = line.match(/^\s*(`{3,}|~{3,})/);
    if (codeFence) {
      if (!fence) fence = codeFence[1][0];
      else if (codeFence[1][0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const named = workLogSectionHeading(heading?.[2] ?? line, Boolean(heading));
    if (heading || named) {
      const depth = heading?.[1].length ?? 0;
      if (heading && planDepth !== undefined && planDepth > 0 && depth > planDepth) continue;
      planDepth = plansOnly || named === 'nextPlan' ? depth : undefined;
      section = named ? labels[named] : defaultSection;
      continue;
    }
    const planned = planDepth !== undefined || isPlannedWorkItem(line);
    const text = cleanEntry(line);
    if (text.length >= 5) entries.push({ section: planned ? '明日计划' : section, text });
  }
  return entries;
}

type EntryLog = Pick<LocalWorkLog, 'completed' | 'inProgress' | 'blockers' | 'nextPlan' | 'markdownContent'>;

function submittedEntries(log: EntryLog) {
  const structured = [
    ...sectionEntries(log.completed.join('\n'), '完成事项'),
    ...sectionEntries(log.inProgress, '进行中'),
    ...sectionEntries(log.blockers, '阻塞 / 风险'),
    ...sectionEntries(log.nextPlan, '明日计划', true),
  ];
  // Markdown is also examined for Todo blocks the legacy parser did not map.
  const markdown = sectionEntries(log.markdownContent, '日志内容');
  const actual = structured.filter((entry) => entry.section !== '明日计划');
  const planned = [...structured, ...markdown].filter((entry) => entry.section === '明日计划');
  const entries = [...(actual.length ? actual : markdown.filter((entry) => entry.section !== '明日计划')), ...planned];
  return entries.filter((entry, index) => entries.findIndex((other) => other.section === entry.section && other.text === entry.text) === index);
}

export function workLogEntries(log: EntryLog) {
  return submittedEntries(log).filter((entry) => entry.section !== '明日计划');
}

export function plannedWorkLogEntries(log: EntryLog) {
  return submittedEntries(log).filter((entry) => entry.section === '明日计划');
}

export function isPlannedWorkEntry(entry: WorkLogEntry) {
  return workLogSectionHeading(entry.section, true) === 'nextPlan' || isPlannedWorkItem(entry.text);
}

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/\b([a-z]{3,})\s+(\d+(?:\.\d+)+)\b/g, '$1$2');
}

export function issueIsDone(issue: MobiusIssue) {
  return [issue.state, issue.stateType].some((value) => /^(done|completed)$/i.test(value?.trim() ?? ''));
}

export function matchingTerms(value: string) {
  const text = normalized(value).replace(/https?:\/\/\S+/g, '');
  const english = text.match(/[a-z][a-z0-9]{3,}(?:\.\d+)*/g) ?? [];
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  const chinese = [...segmenter.segment(text)]
    .filter((part) => part.isWordLike && /^[\p{Script=Han}]{2,}$/u.test(part.segment))
    .map((part) => part.segment);
  return [...new Set([...english.filter((term) => !englishStopWords.has(term)), ...chinese.filter((term) => !chineseStopWords.has(term))])];
}

function containsTerm(text: string, term: string) {
  if (/^[a-z]/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9]|\\.\\d)`, 'i').test(text);
  }
  return text.includes(term);
}

function termWeight(term: string) { return /^[a-z]/.test(term) ? 3 : 1; }
function termsWeight(terms: string[]) { return terms.reduce((sum, term) => sum + termWeight(term), 0); }

function windowCoverage(text: string, terms: string[]) {
  const value = normalized(text);
  if (!value) return 0;
  let highest = 0;
  for (let start = 0; start < value.length; start += 180) {
    const window = value.slice(start, start + 360);
    highest = Math.max(highest, termsWeight(terms.filter((term) => containsTerm(window, term))));
    if (highest === termsWeight(terms)) break;
  }
  return highest / termsWeight(terms);
}

export function issueMatchScore(entry: WorkLogEntry, issue: MobiusIssue) {
  const terms = matchingTerms(entry.text);
  if (terms.length < 2 || issue.agentStopRequested) return 0;
  const title = normalized(issue.title);
  const titleTerms = matchingTerms(issue.title);
  const titleHits = terms.filter((term) => containsTerm(title, term));
  const description = issue.description ?? '';
  const [written, generated = ''] = description.split('<!-- ai-context:start -->', 2);
  // Generated context and previous WorkTrace comments must not confirm themselves.
  const comments = (issue.comments ?? []).map((comment) => comment.body ?? '')
    .filter((body) => !/<!--\s*worktrace-log:/.test(body));
  const humanText = normalized([written, ...comments].join('\n'));
  const humanHits = terms.filter((term) => containsTerm(humanText, term));
  if (new Set([...titleHits, ...humanHits]).size < 2) return 0;
  const writtenCoverage = windowCoverage(written, terms);
  const commentCoverage = Math.max(0, ...comments.map((body) => windowCoverage(body, terms)));
  const generatedCoverage = windowCoverage(generated, terms);
  // Compare the core title with a longer progress report, instead of penalizing
  // every additional action/detail in the report as an unmatched keyword.
  const titleScore = titleHits.length >= 2
    ? termsWeight(titleHits) / Math.max(1, Math.min(termsWeight(terms), termsWeight(titleTerms))) : 0;
  const contextualAnchor = humanHits.some((term) => /^[a-z]/.test(term));
  const titleTopic = titleHits.some((term) => !/^[a-z]/.test(term));
  const conflictingTitleEntities = titleTerms.filter((term) => /^[a-z]/.test(term) && !terms.includes(term)).length;
  // A project name in human comments can establish the context of a Chinese
  // title. Other named projects/people in the title reduce this evidence.
  const contextScore = contextualAnchor && titleTopic ? 0.88 / (1 + conflictingTitleEntities * 0.5) : 0;
  const score = Math.min(1, Math.max(titleScore, writtenCoverage * 0.8, commentCoverage * 0.8, generatedCoverage * 0.35, contextScore));
  const closed = /^(canceled|cancelled|duplicate)$/i.test(issue.state ?? '');
  return closed ? score * 0.85 : score;
}

export type MobiusIssueMatch = {
  issue?: MobiusIssue;
  reason?: 'multiple_ids' | 'no_match' | 'ambiguous' | 'done' | 'stopped' | 'not_related' | 'low_confidence' | 'planned_work' | JevFailureReason;
  decision?: MobiusMatchDecision;
};

export function matchWorkLogEntry(entry: WorkLogEntry, issues: MobiusIssue[]): MobiusIssueMatch {
  if (isPlannedWorkEntry(entry)) return { reason: 'planned_work' };
  const explicit = [...new Set([...entry.text.matchAll(/\b([A-Z][A-Z0-9]{1,11}-\d+)\b/gi)].map((match) => match[1].toUpperCase()))];
  if (explicit.length === 1) {
    const issue = issues.find((candidate) => candidate.identifier.toUpperCase() === explicit[0]);
    if (!issue) return { reason: 'no_match' };
    if (issueIsDone(issue)) return { issue, reason: 'done' };
    if (issue.agentStopRequested) return { issue, reason: 'stopped' };
    return { issue };
  }
  if (explicit.length > 1) return { reason: 'multiple_ids' };
  const ranked = issues.map((issue) => ({ issue, score: issueMatchScore(entry, issue) })).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.72) return { reason: 'no_match' };
  if (issueIsDone(ranked[0].issue)) return { issue: ranked[0].issue, reason: 'done' };
  if (ranked[0].score - (ranked[1]?.score ?? 0) < 0.2) return { reason: 'ambiguous' };
  return { issue: ranked[0].issue };
}

export function selectMatchingIssue(entry: WorkLogEntry, issues: MobiusIssue[]) {
  const match = matchWorkLogEntry(entry, issues);
  return match.reason ? undefined : match.issue;
}

export function issueUpdatedToday(issue: MobiusIssue, now = new Date()) {
  const today = workTraceReportDate(now);
  const timestamps = [issue.updatedAt, ...(issue.comments ?? []).map((comment) => comment.at), ...(issue.activity ?? []).map((event) => event.at)];
  return timestamps.some((value) => {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && workTraceReportDate(date) >= today;
  });
}

export function mobiusCommentBody(log: Pick<LocalWorkLog, 'id' | 'reportDate'>, entries: WorkLogEntry[], authorName: string, appUrl?: string) {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) grouped.set(entry.section, [...(grouped.get(entry.section) ?? []), entry.text]);
  const sections = [...grouped].map(([section, lines]) => `**${section}**\n${lines.map((line) => `- ${line}`).join('\n')}`);
  const base = appUrl?.replace(/\/$/, '');
  const link = base ? `\n\n[查看 WorkTrace 工作日志](${base}/console/logs/${encodeURIComponent(log.id)})` : '';
  return `来自 ${authorName} 的 WorkTrace 工作日志（${log.reportDate}）：\n\n${sections.join('\n\n')}${link}\n\n<!-- worktrace-log:${log.id} -->`;
}
