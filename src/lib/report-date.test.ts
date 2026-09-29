import { describe, expect, it } from 'vitest';
import { buildReportDateCalendar, reportDateRange, resolveReportDate, workTraceReportDate } from './report-date';

describe('work-log report dates', () => {
  it('defaults to the current Shanghai calendar date at the UTC day boundary', () => {
    expect(workTraceReportDate(new Date('2026-09-15T16:30:00.000Z'))).toBe('2026-09-16');
    expect(resolveReportDate(undefined, new Date('2026-09-15T16:30:00.000Z'))).toBe('2026-09-16');
  });

  it('accepts real past dates and rejects malformed or future dates', () => {
    const now = new Date('2026-09-16T12:00:00+08:00');

    expect(resolveReportDate('2026-09-14', now)).toBe('2026-09-14');
    expect(() => resolveReportDate('2026-02-30', now)).toThrow('valid calendar date');
    expect(() => resolveReportDate('2026/09/14', now)).toThrow('YYYY-MM-DD');
    expect(() => resolveReportDate('2026-09-17', now)).toThrow('future');
  });

  it('builds a six-week calendar and disables dates after the allowed maximum', () => {
    const days = buildReportDateCalendar('2026-09-01', '2026-09-16');

    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ date: '2026-08-30', inCurrentMonth: false, disabled: false });
    expect(days.find((day) => day.date === '2026-09-14')).toMatchObject({ inCurrentMonth: true, disabled: false });
    expect(days.find((day) => day.date === '2026-09-17')).toMatchObject({ inCurrentMonth: true, disabled: true });
  });

  it('builds today, week, and month ranges from the Shanghai calendar rather than the server timezone', () => {
    const now = new Date('2026-09-13T16:30:00.000Z');

    expect(reportDateRange('today', now)).toEqual({ from: '2026-09-14', to: '2026-09-15' });
    expect(reportDateRange('week', now)).toEqual({ from: '2026-09-14', to: '2026-09-15' });
    expect(reportDateRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(reportDateRange('all', now)).toEqual({});
  });
});
