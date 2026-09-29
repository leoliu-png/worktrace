export const maxMarkdownCharacters = 50_000;

type WorkLogContent = {
  title: string;
  completed: string[];
  inProgress?: string;
  blockers?: string;
  nextPlan?: string;
  markdownContent?: string;
};

export function workLogMarkdownContent(log: WorkLogContent): string {
  if (log.markdownContent?.trim()) return log.markdownContent;

  const sections = [`# ${log.title.replace(/\s+/g, ' ').trim() || '工作日志'}`];
  const completed = log.completed.map((item) => item.trim()).filter(Boolean);
  if (completed.length) {
    sections.push(`## 完成事项\n${completed.map((item) => `- ${item.replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ')}`).join('\n')}`);
  }
  for (const [heading, content] of [
    ['进行中', log.inProgress],
    ['阻塞 / 风险', log.blockers],
    ['明日计划', log.nextPlan],
  ]) {
    if (content?.trim()) sections.push(`## ${heading}\n${content.trim()}`);
  }
  return sections.join('\n\n');
}

function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function parseMarkdownWorkLog(value: string) {
  const markdownContent = value.replace(/\r\n?/g, '\n');
  if (!markdownContent.trim() || markdownContent.length > maxMarkdownCharacters) return undefined;

  const lines = markdownContent.split('\n');
  const heading = lines.find((line) => /^\s*#\s+\S/.test(line));
  const firstContent = lines.find((line) => line.trim() && !/^\s*(?:```|~~~|---+$)/.test(line));
  const title = plainText((heading ?? firstContent ?? '').replace(/^\s*#{1,6}\s+/, '')).slice(0, 140) || '工作日志';

  const completed: string[] = [];
  const otherSections = { inProgress: [] as string[], blockers: [] as string[], nextPlan: [] as string[] };
  let currentSection: 'completed' | keyof typeof otherSections | undefined;
  for (const line of lines) {
    const section = line.match(/^\s*#{1,6}\s+(.+)$/);
    if (section) {
      const name = section[1].trim();
      currentSection = /完成|completed|done/i.test(name) ? 'completed'
        : /进行中|in progress/i.test(name) ? 'inProgress'
        : /阻塞|风险|blockers?|risks?/i.test(name) ? 'blockers'
        : /计划|下一步|next plan/i.test(name) ? 'nextPlan'
        : undefined;
      continue;
    }
    if (currentSection === 'completed') {
      const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/);
      if (item) completed.push(plainText(item[1]));
    } else if (currentSection) {
      otherSections[currentSection].push(line);
    }
  }

  return {
    title,
    completed: completed.filter(Boolean).slice(0, 100),
    inProgress: otherSections.inProgress.join('\n').trim(),
    blockers: otherSections.blockers.join('\n').trim(),
    nextPlan: otherSections.nextPlan.join('\n').trim(),
    markdownContent,
  };
}

export function markdownPreviewText(value: string, maxLength = 160): string {
  const lines = value.split(/\r?\n/);
  const excerpt = lines
    .filter((line) => !/^\s*(?:#{1,6}\s+|```|~~~|---+$)/.test(line))
    .map(plainText)
    .filter(Boolean)
    .join(' · ');
  return excerpt.slice(0, maxLength) || 'Markdown 日志';
}
