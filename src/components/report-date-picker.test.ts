import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportDatePicker } from './report-date-picker';

describe('ReportDatePicker', () => {
  it('posts the selected ISO date while presenting a WorkTrace calendar trigger', () => {
    const html = renderToStaticMarkup(createElement(ReportDatePicker, { defaultValue: '2026-09-16', maxDate: '2026-09-16' }));

    expect(html).toContain('name="reportDate"');
    expect(html).toContain('value="2026-09-16"');
    expect(html).toContain('2026/09/16');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('wt-report-date-picker');
  });
});
