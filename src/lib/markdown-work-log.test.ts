import { describe, expect, it } from 'vitest';
import { parseMarkdownWorkLog, workLogMarkdownContent } from './markdown-work-log';

describe('Markdown work item hierarchy', () => {
  it('stores each numbered work item with all of its nested details', () => {
    const markdown = [
      '## Done',
      '1. 完成 spend 数据录入',
      '2. 检查 RSI 运行失败',
      '3. AI-2593：长期运行的内部信息智能平台，继续优化',
      '   - 修复风险复核反复失败：改进引用匹配、重试提示和中文错误信息。',
      '   - 清理过期任务：清理了 9 条旧记录。',
      '     1. 补充操作说明',
      '     2. 验证清理结果',
      '',
      '   新增首页今日关键结论，并同步到日报。',
      '4. WorkTrace 改进 Issue 匹配',
      '## Todos',
      '- 明日继续检查平台',
    ].join('\n');
    const parsed = parseMarkdownWorkLog(markdown)!;
    expect(parsed.completed).toHaveLength(4);
    expect(parsed.completed[2]).toBe([
      'AI-2593：长期运行的内部信息智能平台，继续优化',
      '- 修复风险复核反复失败：改进引用匹配、重试提示和中文错误信息。',
      '- 清理过期任务：清理了 9 条旧记录。',
      '  1. 补充操作说明',
      '  2. 验证清理结果',
      '',
      '新增首页今日关键结论，并同步到日报。',
    ].join('\n'));
    expect(parsed.nextPlan).toBe('- 明日继续检查平台');
    expect(parsed.markdownContent).toBe(markdown);
  });

  it('preserves the hierarchy when structured work items are rendered and parsed again', () => {
    const completed = ['AI-2593 平台持续优化\n- 修复复核流程\n  - 验证重试结果\n- 新增首页结论', '完成每日录入'];
    const markdown = workLogMarkdownContent({ title: '工作日志', completed });
    expect(parseMarkdownWorkLog(markdown)?.completed).toEqual(completed);
  });

  it('does not turn list syntax inside fenced examples into completed work', () => {
    const markdown = '## Done\n```markdown\n1. AI-9999 示例任务\n   - 示例子任务\n```\n1. AI-2593 优化真实的平台任务';
    expect(parseMarkdownWorkLog(markdown)?.completed).toEqual(['AI-2593 优化真实的平台任务']);
  });
});
