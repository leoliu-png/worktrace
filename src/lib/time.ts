export const WORKTRACE_TIME_ZONE = 'Asia/Shanghai';

export function formatWorkTraceDateTime(
  value: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: WORKTRACE_TIME_ZONE,
  }).format(new Date(value));
}
