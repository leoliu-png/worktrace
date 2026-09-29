export const WORKTRACE_TIME_ZONE = 'Asia/Shanghai';

export type ReportDateCalendarDay = {
  date: string;
  day: number;
  inCurrentMonth: boolean;
  disabled: boolean;
};

export function workTraceReportDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKTRACE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isRealCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveReportDate(value: string | undefined, now = new Date()) {
  const reportDate = value?.trim() || workTraceReportDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('Report date must use YYYY-MM-DD.');
  if (!isRealCalendarDate(reportDate)) throw new Error('Report date must be a valid calendar date.');
  if (reportDate > workTraceReportDate(now)) throw new Error('Report date cannot be in the future.');
  return reportDate;
}

export function reportDateRange(range: 'all' | 'today' | 'week' | 'month', now = new Date()) {
  if (range === 'all') return {};
  const today = workTraceReportDate(now);
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  if (range === 'week') {
    const weekday = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  }
  if (range === 'month') start.setUTCDate(1);

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function buildReportDateCalendar(viewDate: string, maxDate: string): ReportDateCalendarDay[] {
  const [year, month] = viewDate.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const value = date.toISOString().slice(0, 10);
    return {
      date: value,
      day: date.getUTCDate(),
      inCurrentMonth: date.getUTCFullYear() === year && date.getUTCMonth() === month - 1,
      disabled: value > maxDate,
    };
  });
}
