import { describe, expect, it } from 'vitest';
import { appendMarkdownWorkItem } from './mcp-markdown-append';
import { workLogEntries, plannedWorkLogEntries } from './mobius-work-log';
import { parseMarkdownWorkLog } from './markdown-work-log';

describe('append work item to Markdown', () => {
  it('keeps the item inside Done before subheadings and excludes Todo from matching', () => {
    const source = '# 日志\n\n## Done\n- 完成 A\n\n### 笔记\n示例\n\n## Todos\n- [ ] 等待处理\n';
    const done = appendMarkdownWorkItem(source, 'completed', '完成 B 事项');
    expect(done).toContain('- 完成 A\n- 完成 B 事项\n\n### 笔记');
    const updated = appendMarkdownWorkItem(done, 'nextPlan', '明天处理工作');
    const parsed = parseMarkdownWorkLog(updated)!;
    expect(workLogEntries(parsed).map((entry) => entry.text)).toContain('完成 B 事项');
    expect(plannedWorkLogEntries(parsed).map((entry) => entry.text)).toContain('明天处理工作');
  });
  it('ignores headings inside fenced code and creates a missing section', () => {
    const source = '# 日志\n\n```markdown\n## Done\n- 代码示例\n```\n';
    expect(appendMarkdownWorkItem(source, 'completed', '真实事项')).toBe('# 日志\n\n```markdown\n## Done\n- 代码示例\n```\n\n## 完成事项\n- 真实事项\n');
  });
});
