export function taskPolicy(task,used,limit=3){
 const remaining=Math.max(0,limit-used),manualRetries=task.metadata.manualRetryCount||0,canContinue=canContinueTask(task,used,limit);
 let retryDisabledReason='';
 if(!['ESCALATED','REJECTED'].includes(task.state))retryDisabledReason='当前任务不需要人工恢复。';
 else if(task.metadata.handlingMode==='HUMAN')retryDisabledReason='此反馈已标记人工处理。如需 Agent 继续，请在反馈管理中切换为 Agent 处理；补充要求可不填。';
 else if(!canContinue)retryDisabledReason=`有效代码修复已达到 ${limit} 轮上限，需人工处理；连接失败不占修复轮次。`;
 else if(manualRetries>=1)retryDisabledReason='已使用一次人工恢复机会，仍未解决的问题需人工处理。';
 return {used,limit,remaining,manualRetries,canContinue,retryAllowed:!retryDisabledReason,retryDisabledReason,canClose:['ESCALATED','REJECTED'].includes(task.state)};
}
export function canContinueTask(task,used,limit){return used<limit||['VERIFYING','REVIEWING','STAGING'].includes(task.metadata.resumeStage)||task.metadata.repairPending===true&&Number.isInteger(task.metadata.resumeRound)&&task.metadata.resumeRound<=limit;}

export function processingBlock(config,store,task=null){
 if(!store.get('appReady'))return '本地应用正在准备，请就绪后再处理反馈。';
 if(task?.metadata.handlingMode==='HUMAN')return '此反馈已标记人工处理，Agent 会跳过；可在反馈管理中改回 Agent 处理并补充要求。';
 const active=store.active();
 if(active)return active.state==='WAITING_ACCEPTANCE'?'已有测试版等待真人验收，请先完成验收。':'已有优化任务正在执行，请等待当前任务结束。';
 if(task&&task.state!=='QUEUED')return '只能处理等待执行的反馈，已转人工的任务不会重新执行。';
 if(task&&!canContinueTask(task,store.repairRoundsUsed(task.id),config.maxRepairRounds))return '此反馈已达到有效修复轮次上限，需要人工处理。';
 if(store.countRunsToday()>=config.maxAgentRunsPerDay)return '今日 Agent 调用额度已用完，请在北京时间次日额度恢复后处理。';
 if(store.countTasksToday()>=config.maxTasksPerDay&&(!task||!store.taskRanToday(task.id)))return '今日开发任务额度已用完，手动处理也需要遵守此上限。';
 const until=store.get('backoffUntil');
 if(until&&Date.parse(until)>Date.now())return '服务正在等待临时故障的重试间隔结束，请稍后再处理。';
 return '';
}
