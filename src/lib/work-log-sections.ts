export type WorkLogSection = 'completed' | 'inProgress' | 'blockers' | 'nextPlan';

export function workLogSectionHeading(value: string, allowDetails = false): WorkLogSection | undefined {
  const name = value.normalize('NFKC').replace(/[`*_]/g, '').trim().replace(/[:：]\s*$/, '').trim();
  if (!allowDetails && /[:：]\s*\S/.test(name)) return undefined;
  if (/^(?:todos?|to[\s-]?dos?|待办(?:事项|任务)?|待做(?:事项|任务)?|计划(?:事项|任务)?|明日(?:计划|工作|安排|任务)?|明天(?:计划|工作|安排|任务)?|下一步(?:计划|工作)?|next\s+(?:plan|steps?)|tomorrow(?:\s+plan)?)(?:$|\s*[/|:(])/i.test(name)) return 'nextPlan';
  if (/^(?:done|completed|已完成|完成(?:事项|工作|任务)?)(?:$|\s*[/|:(])/i.test(name)) return 'completed';
  if (/^(?:进行中|in\s+progress)(?:$|\s*[/|:(])/i.test(name)) return 'inProgress';
  if (/^(?:阻塞|风险|blockers?|risks?)(?:$|\s*[/|:(])/i.test(name)) return 'blockers';
  return undefined;
}

export function isPlannedWorkItem(value: string) {
  const line = value.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
  return /^\[\s*\]\s+/.test(line)
    || /^(?:todos?|to[\s-]?dos?|待办(?:事项|任务)?|待做(?:事项|任务)?|明日计划|明天计划|计划|下一步)\s*[:：]\s*\S/i.test(line.replace(/[`*_]/g, ''));
}
