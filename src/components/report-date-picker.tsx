'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildReportDateCalendar } from '../lib/report-date';

type Props = {
  defaultValue: string;
  maxDate: string;
};

function moveMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`));
}

function displayDate(value: string) {
  return value.replaceAll('-', '/');
}

export function ReportDatePicker({ defaultValue, maxDate }: Props) {
  const [selected, setSelected] = useState(defaultValue);
  const [viewDate, setViewDate] = useState(`${defaultValue.slice(0, 7)}-01`);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const days = useMemo(() => buildReportDateCalendar(viewDate, maxDate), [viewDate, maxDate]);
  const nextMonth = moveMonth(viewDate, 1);
  const canMoveNext = nextMonth.slice(0, 7) <= maxDate.slice(0, 7);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <div className="wt-report-date-picker" ref={root}>
    <input type="hidden" name="reportDate" value={selected} />
    <button
      type="button"
      className="wt-report-date-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen((visible) => !visible)}
    >
      <span>{displayDate(selected)}</span>
      <span className="wt-report-date-icon" aria-hidden="true">▦</span>
    </button>
    {open && <div className="wt-report-date-calendar" role="dialog" aria-label="选择日报日期">
      <div className="wt-report-date-calendar-header">
        <button type="button" aria-label="上个月" onClick={() => setViewDate(moveMonth(viewDate, -1))}>‹</button>
        <strong>{monthLabel(viewDate)}</strong>
        <button type="button" aria-label="下个月" disabled={!canMoveNext} onClick={() => setViewDate(nextMonth)}>›</button>
      </div>
      <div className="wt-report-date-weekdays" aria-hidden="true">
        {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="wt-report-date-days">
        {days.map((day) => <button
          type="button"
          key={day.date}
          disabled={day.disabled}
          className={`${day.inCurrentMonth ? '' : 'is-outside'}${day.date === selected ? ' is-selected' : ''}`}
          aria-label={displayDate(day.date)}
          aria-pressed={day.date === selected}
          onClick={() => {
            setSelected(day.date);
            setViewDate(`${day.date.slice(0, 7)}-01`);
            setOpen(false);
          }}
        >{day.day}</button>)}
      </div>
      <p>可选择今天或过去日期</p>
    </div>}
  </div>;
}
