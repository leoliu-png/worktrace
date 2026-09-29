import { describe, expect, it } from 'vitest';
import { workTraceSkillMarkdown } from './worktrace-skill';

describe('WorkTrace Skill', () => {
  it('requires confirmation and completed items before an Agent uploads a summary', () => {
    const markdown = workTraceSkillMarkdown('https://worktrace.example.com');
    expect(markdown).toContain('completed');
    expect(markdown).toContain('Do not invent');
    expect(markdown).toContain('confirm');
    expect(markdown).toContain('https://worktrace.example.com/mcp');
    expect(markdown).toContain('reportDate');
    expect(markdown).toContain('Asia/Shanghai');
    expect(markdown).toContain('future dates');
  });
});
