import { describe, expect, it } from 'vitest';
import { formatWorkTraceDateTime } from './time';

describe('WorkTrace time formatting', () => {
  it('renders stored UTC timestamps in China Standard Time', () => {
    const rendered = formatWorkTraceDateTime('2026-09-07T12:25:00.000Z', 'zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    expect(rendered).toContain('20:25');
  });
});
